/**
 * process-frame: invoked by the IoT Rule for every telemetry frame.
 * model predictions → AQI → ozone safety interlock → alert rules →
 * DynamoDB → command frame back to the coach → domain events.
 *
 * Several copies can run at once (a cold start lets frames pile up), so the coach's state is
 * read from DynamoDB on every frame, late frames are skipped, and an incident is opened through
 * a conditional write that only one copy can win.
 */
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { LocationClient, BatchUpdateDevicePositionCommand } from '@aws-sdk/client-location'
import { computeAqi, bandOf, LIMITS } from '../../breatheiq/src/sim/aqi'
import { ALERT_RULES } from '../../breatheiq/src/sim/core'
import { GROUPS } from '../../breatheiq/src/sim/exposure'
import { doc, T, KEY, TRAIN_ID, COACH, env, getControl, publish, emit, ttl, topic, type Control } from './shared'

const lambda = new LambdaClient({})
const location = new LocationClient({})
const PREVENT_KEY = `${TRAIN_ID}#PREVENT`
const TICK_S = 2

interface Head { value: 0 | 1; p: number }
interface Pred { x: Head; y: Head; z: Head; w: Head; modelVersion: string; inferenceMs: number }
interface Persisted {
  rules: Record<string, { heldFor: number; firing: boolean; count: number }>
  interlock: Record<'1' | '2', string>
  badDay: { active: boolean; incidentId: string | null; startedAt: number | null; peakAqi: number; calmFor: number; auto: boolean }
  frames: number
  lastTs: number
}

const OPEN_KEY = `${KEY}#OPEN-INCIDENT`
let control: Control | null = null
let controlAt = 0
let preVent: { active: boolean; zone: string } = { active: false, zone: '' }

const fresh = (): Persisted => ({
  rules: Object.fromEntries(ALERT_RULES.map((r) => [r.id, { heldFor: 0, firing: false, count: 0 }])),
  interlock: { 1: 'idle', 2: 'idle' },
  badDay: { active: false, incidentId: null, startedAt: null, peakAqi: 0, calmFor: 0, auto: false },
  frames: 0,
  lastTs: 0,
})

async function loadState() {
  const r = await doc.send(new GetCommand({ TableName: T.state, Key: { pk: KEY } }))
  return { ...fresh(), ...(r.Item?.persisted ?? {}) } as Persisted
}

async function infer(f: { temp: number; gas: number; co2: number; pm1: number }): Promise<Pred> {
  const t0 = Date.now()
  const res = await lambda.send(new InvokeCommand({
    FunctionName: env('INFERENCE_FN'),
    Payload: Buffer.from(JSON.stringify({ action: 'predict', temp: f.temp, gas: f.gas, co2: f.co2, pms: f.pm1 })),
  }))
  const out = JSON.parse(Buffer.from(res.Payload ?? []).toString() || '{}')
  if (res.FunctionError || !out.heads) throw new Error(`inference failed: ${JSON.stringify(out).slice(0, 200)}`)
  return { ...out.heads, modelVersion: out.modelVersion, inferenceMs: Date.now() - t0 }
}

/** Only one copy may open an incident; a stale claim (over an hour old) can be taken over. */
async function claimIncident(incidentId: string, ts: number) {
  try {
    await doc.send(new PutCommand({
      TableName: T.state, Item: { pk: OPEN_KEY, incidentId, at: ts },
      ConditionExpression: 'attribute_not_exists(pk) OR #at < :stale',
      ExpressionAttributeNames: { '#at': 'at' }, ExpressionAttributeValues: { ':stale': ts - 3_600_000 },
    }))
    return true
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false
    throw e
  }
}

export const handler = async (f: any) => {
  const t0 = Date.now()
  const S = await loadState()
  const ts: number = f.ts ?? t0
  if (ts <= S.lastTs) return { skipped: 'late frame', ts, lastTs: S.lastTs }
  S.lastTs = ts
  if (!control || t0 - controlAt > 5000) {
    const [c, pv] = await Promise.all([getControl(), doc.send(new GetCommand({ TableName: T.state, Key: { pk: PREVENT_KEY } }))])
    control = c
    controlAt = t0
    preVent = { active: !!pv.Item?.active && (pv.Item.until ?? 0) > t0, zone: pv.Item?.zone ?? '' }
  }
  const pred = await infer(f)
  const { aqi } = computeAqi(f.pm25, f.pm10)
  const band = bandOf(aqi)

  // ── alert rules (same thresholds and hold times as the dashboard engine) ──
  const conds: Record<string, boolean> = {
    pm60: f.pm25 > 60, temp34: f.temp >= 34, aqi300: aqi > 300, aqi500: aqi > 500, gas10: f.gas === 0, o3: f.o3ppm > 0.05,
  }
  const fired: string[] = []
  for (const rule of ALERT_RULES) {
    const st = (S.rules[rule.id] ??= { heldFor: 0, firing: false, count: 0 })
    const on = control.rulesEnabled[rule.id] !== false && conds[rule.id]
    st.heldFor = on ? st.heldFor + TICK_S : 0
    const now = on && st.heldFor >= rule.holdS
    if (now && !st.firing) { st.count += 1; fired.push(rule.id) }
    st.firing = now
  }

  // ── actuators + ozone safety interlock ──
  const auto = control.mode === 'auto'
  const fanReq = auto ? pred.x.value === 1 : control.manual.fan
  const oz1Req = auto ? pred.z.value === 1 || pred.w.value === 1 : control.manual.oz1
  const oz2Req = auto ? pred.y.value === 1 || pred.w.value === 1 : control.manual.oz2
  const o3ok = f.o3ppm8h < LIMITS.ozonePpm8h && f.o3ppm < 0.1
  const allowed = !f.occupied && o3ok
  const blockReason = f.occupied ? 'cabin occupied' : 'ozone above 0.07 ppm'
  const ozBlocked = (oz1Req || oz2Req) && !allowed
  const ventBoost = S.badDay.active || S.rules.pm60.firing
  const relays = {
    fan: fanReq || ozBlocked || ventBoost || preVent.active || (auto && S.rules.temp34.firing),
    oz1: oz1Req && allowed,
    oz2: oz2Req && allowed,
  }
  const verdict = !(oz1Req || oz2Req) ? 'idle' : allowed ? 'allowed' : 'blocked'

  const writes: Promise<unknown>[] = []
  for (const gen of ['1', '2'] as const) {
    const req = gen === '1' ? oz1Req : oz2Req
    const state = !req ? 'idle' : allowed ? 'allowed' : `blocked:${blockReason}`
    if (state !== S.interlock[gen]) {
      const v = state === 'idle' ? 'released' : state === 'allowed' ? 'allowed' : 'blocked'
      const reason = v === 'released' ? 'request withdrawn' : v === 'allowed' ? 'cabin unoccupied · O₃ under 0.07 ppm' : blockReason
      writes.push(doc.send(new PutCommand({
        TableName: T.interlock,
        Item: { pk: KEY, sk: ts * 10 + Number(gen), ts, gen: Number(gen), verdict: v, reason, aqi, o3ppm: f.o3ppm, occupancy: f.occupancy, ttl: ttl(72) },
      })))
      if (v === 'blocked') writes.push(emit('OzoneBlocked', { trainId: TRAIN_ID, coach: COACH, ts, gen: Number(gen), reason, aqi }))
      S.interlock[gen] = state
    }
  }
  for (const id of fired) {
    const rule = ALERT_RULES.find((r) => r.id === id)!
    writes.push(doc.send(new PutCommand({
      TableName: T.alerts,
      Item: { pk: KEY, sk: ts * 10 + ALERT_RULES.indexOf(rule), ts, ruleId: id, text: `${rule.when} → ${rule.then}`, aqi, ttl: ttl(72) },
    })))
    writes.push(emit('RuleFired', { trainId: TRAIN_ID, coach: COACH, ts, ruleId: id, when: rule.when, then: rule.then, aqi }))
  }

  // ── Bad Day Mode: one incident per excursion, announced once on EventBridge ──
  const B = S.badDay
  const fleet: { code: string; aqi: number; pm25: number; occupancy: number }[] = f.fleet ?? []
  if (!B.active && (fired.includes('aqi500') || f.operatorBadDay) && (await claimIncident(`inc-${ts}`, ts))) {
    const worst = fleet.reduce((a, c) => (c.aqi > a.aqi ? c : a), fleet[0] ?? { code: COACH, aqi, pm25: f.pm25, occupancy: f.occupancy })
    const clean = fleet.reduce((a, c) => (c.aqi < a.aqi ? c : a), fleet[0] ?? worst)
    Object.assign(B, { active: true, incidentId: `inc-${ts}`, startedAt: ts, peakAqi: aqi, calmFor: 0, auto: !f.operatorBadDay })
    writes.push(emit('AqiOffTheChart', {
      incidentId: B.incidentId, trainId: TRAIN_ID, coach: COACH, startedAt: ts,
      trigger: f.operatorBadDay ? 'Operator switched on Bad Day Mode' : `AQI ${aqi} — off the chart`,
      aqi, pm25: f.pm25, pm10: f.pm10, station: f.station,
      worstCoach: worst.code, worstAqi: worst.aqi, cleanCoach: clean.code, cleanAqi: clean.aqi,
      groups: GROUPS.map((g) => ({ id: g.id, name: g.name, count: g.count })),
      interlock: { verdict, reason: verdict === 'blocked' ? blockReason : verdict === 'allowed' ? 'cabin unoccupied' : 'no ozone request' },
    }))
  } else if (B.active) {
    B.peakAqi = Math.max(B.peakAqi, aqi)
    B.calmFor = aqi < 250 ? B.calmFor + TICK_S : 0
    const stand = B.auto ? B.calmFor >= 20 : !f.operatorBadDay
    if (stand) {
      writes.push(emit('IncidentClosed', { incidentId: B.incidentId, trainId: TRAIN_ID, coach: COACH, endedAt: ts, peakAqi: B.peakAqi }))
      writes.push(doc.send(new DeleteCommand({ TableName: T.state, Key: { pk: OPEN_KEY } })))
      Object.assign(B, { active: false, calmFor: 0 })
    }
  }

  const command = `t${pred.x.value}u${pred.y.value}v${pred.z.value}x${pred.w.value}y`
  S.frames += 1
  const processMs = Date.now() - t0
  const state = {
    trainId: TRAIN_ID, coach: COACH, ts, receivedAt: f.receivedAt ?? t0, device: f.device,
    reading: { temp: f.temp, hum: f.hum, gas: f.gas, co2: f.co2, pm1: f.pm1, pm25: f.pm25, pm10: f.pm10, aqi, band },
    occupancy: f.occupancy, occupied: f.occupied, o3ppm: f.o3ppm, o3ppm8h: f.o3ppm8h,
    scenario: f.scenario, station: f.station, atStation: f.atStation, exposure: f.exposure,
    position: f.position, zone: f.zone, segment: f.segment, preVent,
    pred: { x: pred.x, y: pred.y, z: pred.z, w: pred.w }, model: { version: pred.modelVersion, inferenceMs: pred.inferenceMs },
    relays, interlock: { verdict, reason: verdict === 'blocked' ? blockReason : '' },
    command, frame: f.frame, topic: topic('telemetry'), processMs,
    badDay: { active: B.active, incidentId: B.incidentId, peakAqi: B.peakAqi },
  }

  writes.push(doc.send(new PutCommand({
    TableName: T.telemetry,
    Item: { pk: KEY, sk: ts, ...state.reading, occupancy: f.occupancy, o3ppm: f.o3ppm, command, fan: relays.fan, oz1: relays.oz1, oz2: relays.oz2, scenario: f.scenario, ttl: ttl(24) },
  })))
  writes.push(doc.send(new PutCommand({ TableName: T.state, Item: { pk: KEY, ...state, fleet, persisted: S, updatedAt: Date.now() } })))
  writes.push(publish('command', { ...state, commandTopic: topic('command') }))
  // Amazon Location (billed per position write): one position a minute; geofence ENTER/EXIT events come back through EventBridge
  if (env('TRACKER') && f.position && S.frames % 30 === 0) {
    writes.push(location.send(new BatchUpdateDevicePositionCommand({
      TrackerName: env('TRACKER'),
      Updates: [{ DeviceId: `train-${TRAIN_ID}`, Position: f.position, SampleTime: new Date(ts) }],
    })).catch((e) => console.log(JSON.stringify({ level: 'warn', msg: 'tracker update failed', error: String(e) }))))
  }
  await Promise.all(writes)
  return { command, aqi, processMs }
}
