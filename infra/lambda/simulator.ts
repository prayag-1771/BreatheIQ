/**
 * device-simulator: the always-on device for coach B2. Runs the same pure
 * `stepWorld` engine as the dashboard and publishes one telemetry frame every
 * 2 s to AWS IoT Core. EventBridge Scheduler invokes it once a minute; each
 * invocation holds a lease and publishes until 3 s before the next minute, so runs never overlap.
 */
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { createWorld, stepWorld, activateBadDay, deactivateBadDay, ALERT_RULES, COACHES, type World, type StepInputs } from '../../breatheiq/src/sim/core'
import { STATIONS } from '../../breatheiq/src/sim/route'
import { trainLngLat } from '../../breatheiq/src/sim/geo'
import type { ScenarioId } from '../../breatheiq/src/sim/scenarios'
import { doc, T, TRAIN_ID, COACH, getControl, publish, sleep, type Control } from './shared'

const WORLD_KEY = `${TRAIN_ID}#SIMWORLD`
const LEASE_KEY = `${TRAIN_ID}#SIMLEASE`
const MINUTE = 60_000
const TICK_MS = 2000

let world: World | null = null
let applied = { scenarioSeq: -1, badDaySeq: -1 }

async function loadWorld() {
  const r = await doc.send(new GetCommand({ TableName: T.state, Key: { pk: WORLD_KEY } }))
  if (!r.Item?.json) return null
  applied = r.Item.applied ?? applied
  return JSON.parse(r.Item.json) as World
}

const saveWorld = (w: World) =>
  doc.send(new PutCommand({ TableName: T.state, Item: { pk: WORLD_KEY, json: JSON.stringify({ ...w, console: [] }), applied, updatedAt: Date.now() } }))

function applyControl(w: World, c: Control) {
  if (c.scenarioSeq !== applied.scenarioSeq) {
    if (applied.scenarioSeq !== -1 || c.scenarioSeq > 0) w.scenario = { id: c.scenario as ScenarioId, startedAt: w.t, sustain: c.sustain }
    applied.scenarioSeq = c.scenarioSeq
  }
  if (c.badDaySeq !== applied.badDaySeq) {
    if (applied.badDaySeq !== -1 || c.badDaySeq > 0) {
      if (c.badDay && !w.badDay.active) activateBadDay(w, 'Operator switched on Bad Day Mode')
      if (c.badDay === false) deactivateBadDay(w)
    }
    applied.badDaySeq = c.badDaySeq
  }
  w.interlock.occupiedOverride = c.occupiedOverride
}

const inputsOf = (c: Control): StepInputs => ({
  thresholds: c.thresholds,
  mode: c.mode,
  manual: c.manual,
  rulesEnabled: { ...Object.fromEntries(ALERT_RULES.map((r) => [r.id, r.enabled])), ...c.rulesEnabled },
  source: 'mock',
})

function telemetry(w: World) {
  const r = w.reading
  return {
    trainId: TRAIN_ID,
    coach: COACH,
    device: 'cloud-simulator',
    ts: Date.now(),
    simT: w.t,
    frame: `a${r.temp.toFixed(2)}b${r.gas}c${r.co2}d${r.pm1}e`,
    temp: r.temp, gas: r.gas, co2: r.co2, pm1: r.pm1,
    hum: r.hum, pm25: r.pm25, pm10: r.pm10,
    occupancy: Math.round(w.latent.occ),
    occupied: w.interlock.occupied,
    o3ppm: Math.round(w.interlock.ppm * 10000) / 10000,
    o3ppm8h: Math.round(w.interlock.ppm8h * 10000) / 10000,
    scenario: w.scenario.id,
    station: STATIONS[Math.min(w.train.stationIdx, STATIONS.length - 1)].name,
    atStation: w.train.atStation,
    routeT: w.routeT,
    position: trainLngLat(w.train).map((v) => Math.round(v * 1e5) / 1e5),
    zone: w.train.zone?.label ?? null,
    segment: w.train.segment,
    operatorBadDay: w.badDay.active && w.badDay.incident?.auto === false,
    exposure: {
      minutes: Math.round(w.exposure.minutes * 10) / 10,
      dose: Object.fromEntries(Object.entries(w.exposure.dose).map(([k, v]) => [k, Math.round(v)])),
      doseRate: Object.fromEntries(Object.entries(w.exposure.doseRate).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      band: Object.fromEntries(Object.entries(w.exposure.band).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      peakAqi: w.exposure.peakAqi,
    },
    fleet: w.coaches.map((c, i) => ({ code: COACHES[i].code, kind: COACHES[i].kind, aqi: Math.round(c.aqi), pm25: Math.round(c.pm25), occupancy: c.occupancy })),
  }
}

/** Publish until 3 s before the next scheduled run (or the one after, if this run started late). */
function deadlineFor(start: number) {
  let end = Math.ceil(start / MINUTE) * MINUTE - 3000
  if (end - start < 20_000) end += MINUTE
  return end
}

async function takeLease(owner: string, now: number, until: number) {
  try {
    await doc.send(new PutCommand({
      TableName: T.state, Item: { pk: LEASE_KEY, owner, until },
      ConditionExpression: 'attribute_not_exists(pk) OR #until < :now',
      ExpressionAttributeNames: { '#until': 'until' }, ExpressionAttributeValues: { ':now': now },
    }))
    return true
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false
    throw e
  }
}

export const handler = async (_event?: unknown, context?: { awsRequestId?: string }) => {
  let control = await getControl()
  if (!control.simEnabled) return { skipped: 'simulator paused' }
  const start = Date.now()
  const owner = context?.awsRequestId ?? String(start)
  const deadline = deadlineFor(start)
  if (!(await takeLease(owner, start, deadline + 1000))) return { skipped: 'another run is publishing' }
  // a warm instance may hold an older world if another instance ran meanwhile
  world = (await loadWorld()) ?? world ?? createWorld(12)

  let frames = 0
  for (let i = 0; start + i * TICK_MS < deadline; i++) {
    await sleep(start + i * TICK_MS - Date.now())
    if (i > 0 && i % 3 === 0) control = await getControl()
    if (!control.simEnabled) break
    applyControl(world, control)
    world = stepWorld(world, inputsOf(control), { quiet: true })
    await publish('telemetry', telemetry(world))
    frames += 1
  }
  await saveWorld(world)
  await doc.send(new DeleteCommand({ TableName: T.state, Key: { pk: LEASE_KEY }, ConditionExpression: '#owner = :me', ExpressionAttributeNames: { '#owner': 'owner' }, ExpressionAttributeValues: { ':me': owner } })).catch(() => undefined)
  return { frames, simT: world.t, aqi: world.reading.aqi }
}
