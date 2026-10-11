/**
 * Pure simulation core. `stepWorld(world, inputs)` advances the cabin by one
 * 2-second tick and returns a new world. No timers, no React, no globals —
 * the store drives it live and the ML Lab replays it offline.
 */
import { createRng, clamp } from './rng'
import { computeAqi, bandOf, type AqiBand, LIMITS } from './aqi'
import { predict, lcdResult, replyFrame, HEADS, type Prediction, type Thresholds, type Bit, type HeadKey } from './model'
import { scenarioById, envelope, type ScenarioId } from './scenarios'
import { trainPosition, STATIONS, type TrainPos } from './route'
import { GROUPS, STAFF_PRELOAD, type GroupId } from './exposure'
import { APP } from '../config'

export const TICK_S = 2
export const HISTORY_LEN = 150 // 5 min at 2 s
export const HEAT_LEN = 72

export interface Reading {
  t: number
  temp: number
  hum: number
  gas: Bit
  co2: Bit
  pm1: number
  pm25: number
  pm10: number
  aqi: number
}

export interface CoachDef {
  no: number
  code: string
  kind: string
  factor: number
  capacity: number
}

export const COACHES: CoachDef[] = [
  { no: 1, code: 'SLR', kind: 'Guard + luggage', factor: 1.2, capacity: 30 },
  { no: 2, code: 'GS', kind: 'General', factor: 1.35, capacity: 90 },
  { no: 3, code: 'S1', kind: 'Sleeper', factor: 1.15, capacity: 72 },
  { no: 4, code: 'S2', kind: 'Sleeper', factor: 1.1, capacity: 72 },
  { no: 5, code: 'S3', kind: 'Sleeper', factor: 1.05, capacity: 72 },
  { no: 6, code: 'B1', kind: 'AC 3-tier', factor: 0.9, capacity: 72 },
  { no: 7, code: 'B2', kind: 'AC 3-tier · prototype', factor: 1, capacity: 72 },
  { no: 8, code: 'B3', kind: 'AC 3-tier', factor: 0.85, capacity: 72 },
  { no: 9, code: 'PC', kind: 'Pantry car', factor: 1.3, capacity: 12 },
  { no: 10, code: 'A1', kind: 'AC 2-tier', factor: 0.75, capacity: 48 },
  { no: 11, code: 'B4', kind: 'AC 3-tier · HEPA retrofit', factor: 0.55, capacity: 72 },
  { no: 12, code: 'EOG', kind: 'Power car', factor: 1.25, capacity: 4 },
]
export const INSTRUMENTED = 6 // index of B2

export interface CoachState {
  pm25: number
  pm10: number
  temp: number
  aqi: number
  occupancy: number
  fan: boolean
  ozone: 'off' | 'blocked' | 'on'
  heat: number[]
}

export interface Actuators {
  fanOn: boolean
  fanRpm: number
  fanReason: string
  oz1Req: boolean
  oz2Req: boolean
  oz1On: boolean
  oz2On: boolean
  runtime: { fan: number; oz1: number; oz2: number }
}

export interface InterlockEvent {
  id: number
  t: number
  gen: 1 | 2
  verdict: 'blocked' | 'allowed' | 'released'
  reason: string
}

export type ConsoleKind = 'sys' | 'rule' | 'title' | 'frame' | 'field' | 'ok' | 'head' | 'pred' | 'msg' | 'bad' | 'reply' | 'blank' | 'sim'
export interface ConsoleLine {
  id: number
  text: string
  kind: ConsoleKind
}

export interface AlertRule {
  id: string
  when: string
  then: string
  enabled: boolean
  holdS: number
}
export interface RuleState {
  heldFor: number
  firing: boolean
  lastFired: number | null
  count: number
}
export interface AlertEvent {
  id: number
  t: number
  ruleId: string
  text: string
}

export const ALERT_RULES: AlertRule[] = [
  { id: 'pm60', when: 'PM2.5 > 60 µg/m³ for 2 min', then: 'Boost ventilation', enabled: true, holdS: 120 },
  { id: 'temp34', when: 'Temperature ≥ 34 °C', then: 'Exhaust fan on', enabled: true, holdS: 0 },
  { id: 'aqi300', when: 'AQI > 300 for 1 min', then: 'Warn sensitive passengers', enabled: true, holdS: 60 },
  { id: 'aqi500', when: 'AQI > 500 (off the chart)', then: 'Enter Bad Day Mode', enabled: true, holdS: 0 },
  { id: 'gas10', when: 'MQ-2 detects gas for 10 s', then: 'Page train staff to coach', enabled: true, holdS: 10 },
  { id: 'o3', when: 'Est. ozone > 0.05 ppm', then: 'Pre-warn interlock, purge cabin', enabled: true, holdS: 0 },
]

export interface Snapshot {
  aqi: number
  pm25: number
  fanRpm: number
  ozone: string
  advisories: number
  sensitiveInWorst: number
  achPerHour: number
}

export interface PlaybookAction {
  t: number
  step: number
  title: string
  detail: string
}

export interface Incident {
  id: number
  startedAt: number
  endedAt: number | null
  trigger: string
  auto: boolean
  before: Snapshot
  peakAqi: number
  actions: PlaybookAction[]
  station: string
  worstCoach: string
  cleanCoach: string
}

export interface World {
  rngState: number
  t: number // simulated seconds
  tick: number
  routeT: number
  scenario: { id: ScenarioId; startedAt: number; sustain: boolean }
  intensity: number
  latent: { temp: number; hum: number; pm25: number; ratio: number; spike: number; gasLvl: number; co2Lvl: number; gas: Bit; co2: Bit; occ: number }
  reading: Reading
  history: Reading[]
  pred: Prediction
  lcd: [string, string]
  act: Actuators
  interlock: { occupiedOverride: boolean; occupied: boolean; ppm: number; ppm8h: number; log: InterlockEvent[]; last: Record<1 | 2, string> }
  coaches: CoachState[]
  train: TrainPos
  exposure: { minutes: number; band: Record<AqiBand, number>; peakAqi: number; dose: Record<GroupId, number>; doseRate: Record<GroupId, number> }
  console: ConsoleLine[]
  rules: Record<string, RuleState>
  alerts: AlertEvent[]
  badDay: { active: boolean; incident: Incident | null; calmFor: number }
  /** latest frame from a device: the Arduino over Web Serial, or the coach on AWS IoT Core */
  hw: {
    temp: number; gas: Bit; co2: Bit; pm1: number; at: number
    hum?: number; pm25?: number; pm10?: number; occ?: number
    pred?: Record<HeadKey, { value: Bit; p: number }>
    o3?: number; o3_8h?: number; routeT?: number
    fleet?: { aqi: number; pm25: number; occupancy: number }[]
    exposure?: { minutes: number; dose: Record<GroupId, number>; doseRate: Record<GroupId, number>; band?: Record<AqiBand, number>; peakAqi?: number }
  } | null
  segPeak: Record<number, number> // peak cabin AQI per route segment
  seq: number
}

export interface StepInputs {
  thresholds: Thresholds
  mode: 'auto' | 'manual'
  manual: { fan: boolean; oz1: boolean; oz2: boolean }
  rulesEnabled: Record<string, boolean>
  source: 'mock' | 'serial' | 'aws'
}

const zeroBands = (): Record<AqiBand, number> => ({
  good: 0, satisfactory: 0, moderate: 0, poor: 0, verypoor: 0, severe: 0, offchart: 0,
})

export function createWorld(seed = 12): World {
  const rng = createRng(seed)
  const latent = { temp: 28.4, hum: 56, pm25: 24, ratio: 0.68, spike: 0, gasLvl: 0.1, co2Lvl: 0.15, gas: 1 as Bit, co2: 1 as Bit, occ: 52 }
  const reading = toReading(0, latent)
  const pred = predict({ temp: reading.temp, gas: reading.gas, co2: reading.co2, pms: reading.pm1 }, { tempC: 34.5, pm: 80 })
  const world: World = {
    rngState: rng.getState(),
    t: 0,
    tick: 0,
    routeT: 110,
    scenario: { id: 1, startedAt: 0, sustain: false },
    intensity: 0,
    latent,
    reading,
    history: [],
    pred,
    lcd: ['AIR QUALITY', 'Monitoring in Train'],
    act: { fanOn: false, fanRpm: 0, fanReason: 'Idle — all heads normal', oz1Req: false, oz2Req: false, oz1On: false, oz2On: false, runtime: { fan: 0, oz1: 0, oz2: 0 } },
    interlock: { occupiedOverride: false, occupied: true, ppm: 0.008, ppm8h: 0.012, log: [], last: { 1: 'idle', 2: 'idle' } },
    coaches: COACHES.map((c) => ({
      pm25: 34 * c.factor, pm10: (34 * c.factor) / 0.68, temp: 28, aqi: computeAqi(34 * c.factor, (34 * c.factor) / 0.68).aqi,
      occupancy: Math.round(c.capacity * 0.7), fan: false, ozone: 'off', heat: [],
    })),
    train: trainPosition(110),
    exposure: {
      minutes: 0, band: zeroBands(), peakAqi: reading.aqi,
      dose: Object.fromEntries(GROUPS.map((g) => [g.id, g.id === 'staff' ? STAFF_PRELOAD : 0])) as Record<GroupId, number>,
      doseRate: Object.fromEntries(GROUPS.map((g) => [g.id, 0])) as Record<GroupId, number>,
    },
    console: [],
    rules: Object.fromEntries(ALERT_RULES.map((r) => [r.id, { heldFor: 0, firing: false, lastFired: null, count: 0 }])),
    alerts: [],
    badDay: { active: false, incident: null, calmFor: 0 },
    hw: null,
    segPeak: {},
    seq: 1,
  }
  world.console = [{ id: world.seq++, text: 'Serial connection opened successfully!', kind: 'sys' }]
  // pre-fill a minute of calm history so charts are never empty
  let w = world
  const inputs: StepInputs = {
    thresholds: { tempC: 34.5, pm: 80 }, mode: 'auto', manual: { fan: false, oz1: false, oz2: false },
    rulesEnabled: Object.fromEntries(ALERT_RULES.map((r) => [r.id, true])), source: 'mock',
  }
  for (let i = 0; i < 30; i++) w = stepWorld(w, inputs, { quiet: true })
  return { ...w, console: w.console.slice(-1) }
}

function toReading(t: number, l: World['latent']): Reading {
  const pm25 = Math.max(2, l.pm25 + l.spike)
  const pm10 = pm25 / l.ratio
  const pm1 = pm25 * 0.62
  return {
    t,
    temp: Math.round(l.temp * 100) / 100,
    hum: Math.round(l.hum),
    gas: l.gas,
    co2: l.co2,
    pm1: Math.round(pm1),
    pm25: Math.round(pm25),
    pm10: Math.round(pm10),
    aqi: computeAqi(pm25, pm10).aqi,
  }
}

const cap = <T,>(arr: T[], n: number) => (arr.length > n ? arr.slice(arr.length - n) : arr)

export function stepWorld(prev: World, inputs: StepInputs, opts: { quiet?: boolean } = {}): World {
  const rng = createRng(prev.rngState)
  const w: World = structuredClone(prev)
  w.t += TICK_S
  w.tick += 1
  // on AWS the train is wherever the coach reports it
  w.routeT = inputs.source === 'aws' && prev.hw?.routeT !== undefined ? prev.hw.routeT : w.routeT + TICK_S
  w.train = trainPosition(w.routeT)
  const push = (text: string, kind: ConsoleKind) => {
    if (!opts.quiet) w.console.push({ id: w.seq++, text, kind })
  }

  // ── 1. scenario + route forcing ──────────────────────────────────
  const def = scenarioById(w.scenario.id)
  const k = envelope(def, w.t - w.scenario.startedAt, w.scenario.sustain)
  w.intensity = k
  const p = def.profile
  const zone = w.train.zone
  const doorOpen = w.train.atStation
  const playbook = w.badDay.active ? 0.78 : 1 // recirculation + filtration in Bad Day Mode

  // ── 2. latent cabin state (mean-reverting random walks) ─────────
  const L = w.latent
  const drift = Math.sin(w.t / 260) * 1.2
  const targetOcc = 48 + (doorOpen ? 10 : 0) + p.occupancy * k
  L.occ = clamp(L.occ + (targetOcc - L.occ) * 0.15 + rng.normal() * 0.8, 0, 90)
  const crowdHeat = (L.occ - 50) * 0.03
  const tempTarget = 28.4 + drift + crowdHeat + p.temp * k
  L.temp += (tempTarget - L.temp) * 0.14 + rng.normal() * 0.06
  const humTarget = 56 + Math.sin(w.t / 410) * 6 + p.hum * k + (doorOpen ? 4 : 0)
  L.hum = clamp(L.hum + (humTarget - L.hum) * 0.12 + rng.normal() * 0.4, 30, 92)

  const pmTarget = (24 + Math.sin(w.t / 180) * 4 + (doorOpen ? 9 : 0) + (zone?.pm25 ?? 0) + p.pm25 * k) * playbook
  L.pm25 += (pmTarget - L.pm25) * 0.16 + rng.normal() * Math.max(0.6, L.pm25 * 0.025)
  L.pm25 = Math.max(3, L.pm25)
  if (L.spike > 0.5) L.spike *= 0.7
  else L.spike = 0
  if (rng.chance(doorOpen ? 0.05 : 0.02)) L.spike += rng.range(6, 18) // door, crowd, someone walking past with a bidi
  const coarse = (zone?.pm10Extra ?? 0) + p.pm10Extra * k
  const ratioTarget = clamp(0.7 - coarse / (L.pm25 + coarse + 60) * 0.35, 0.42, 0.78)
  L.ratio += (ratioTarget - L.ratio) * 0.2 + rng.normal() * 0.004

  // digital gas sensors with hysteresis (latent level, trip 0.6 / clear 0.4)
  const gasTarget = 0.12 + (p.gas - 0.12) * k
  L.gasLvl = clamp(L.gasLvl + (gasTarget - L.gasLvl) * 0.22 + rng.normal() * 0.03, 0, 1)
  if (L.gas === 1 && L.gasLvl > 0.6) L.gas = 0
  else if (L.gas === 0 && L.gasLvl < 0.4) L.gas = 1
  const co2Target = 0.15 + (L.occ - 50) * 0.004 + (p.co2 - 0.15) * k
  L.co2Lvl = clamp(L.co2Lvl + (co2Target - L.co2Lvl) * 0.2 + rng.normal() * 0.03, 0, 1)
  if (L.co2 === 1 && L.co2Lvl > 0.6) L.co2 = 0
  else if (L.co2 === 0 && L.co2Lvl < 0.4) L.co2 = 1

  let r = toReading(w.t, L)
  // a connected device overrides the fields it reports; the rest keep coming from the model
  if (inputs.source !== 'mock' && w.hw) {
    const pm25 = w.hw.pm25 ?? Math.round(w.hw.pm1 / 0.62)
    const pm10 = w.hw.pm10 ?? Math.round(pm25 / L.ratio)
    r = { ...r, temp: w.hw.temp, hum: w.hw.hum ?? r.hum, gas: w.hw.gas, co2: w.hw.co2, pm1: w.hw.pm1, pm25, pm10, aqi: computeAqi(pm25, pm10).aqi }
    if (w.hw.occ !== undefined) L.occ = w.hw.occ
  }
  w.reading = r
  if (!w.train.atStation) w.segPeak[w.train.segment] = Math.max(w.segPeak[w.train.segment] ?? 0, r.aqi)
  w.history = cap([...w.history, r], HISTORY_LEN)

  // ── 3. ML heads ──────────────────────────────────────────────────
  const wobble = { x: rng.normal() * 0.6, y: rng.normal() * 0.6, z: rng.normal() * 0.6, w: rng.normal() * 0.6 }
  w.pred = predict({ temp: r.temp, gas: r.gas, co2: r.co2, pms: r.pm1 }, inputs.thresholds, wobble)
  // on AWS the verdict comes from the SageMaker-trained forest served by Lambda
  const cloudPred = inputs.source === 'aws' ? w.hw?.pred : undefined
  if (cloudPred) for (const h of HEADS) w.pred[h.key] = { value: cloudPred[h.key].value, pAbnormal: cloudPred[h.key].p, conf: cloudPred[h.key].value ? cloudPred[h.key].p : 1 - cloudPred[h.key].p }
  w.lcd = lcdResult(w.pred)

  // ── 4. alert rules ───────────────────────────────────────────────
  const fire: string[] = []
  const conds: Record<string, boolean> = {
    pm60: r.pm25 > 60,
    temp34: r.temp >= 34,
    aqi300: r.aqi > 300,
    aqi500: r.aqi > 500,
    gas10: r.gas === 0,
    o3: w.interlock.ppm > 0.05,
  }
  for (const rule of ALERT_RULES) {
    const st = w.rules[rule.id]
    const on = inputs.rulesEnabled[rule.id] !== false && conds[rule.id]
    st.heldFor = on ? st.heldFor + TICK_S : 0
    const nowFiring = on && st.heldFor >= rule.holdS
    if (nowFiring && !st.firing) {
      st.lastFired = w.t
      st.count += 1
      fire.push(rule.id)
      w.alerts = cap([...w.alerts, { id: w.seq++, t: w.t, ruleId: rule.id, text: `${rule.when} → ${rule.then}` }], 60)
    }
    st.firing = nowFiring
  }

  // ── 5. actuators + ozone safety interlock ───────────────────────
  const A = w.act
  const P = w.pred
  const fanReq = inputs.mode === 'auto' ? P.x.value === 1 : inputs.manual.fan
  A.oz1Req = inputs.mode === 'auto' ? P.z.value === 1 || P.w.value === 1 : inputs.manual.oz1
  A.oz2Req = inputs.mode === 'auto' ? P.y.value === 1 || P.w.value === 1 : inputs.manual.oz2
  const occupied = !w.interlock.occupiedOverride && L.occ > 0.5
  w.interlock.occupied = occupied
  const o3ok = w.interlock.ppm8h < LIMITS.ozonePpm8h && w.interlock.ppm < 0.1
  const allowed = !occupied && o3ok
  const blockReason = occupied ? 'cabin occupied' : 'ozone above 0.07 ppm'
  A.oz1On = A.oz1Req && allowed
  A.oz2On = A.oz2Req && allowed
  const ozBlocked = (A.oz1Req || A.oz2Req) && !allowed
  const ventBoost = w.badDay.active || w.rules.pm60.firing
  A.fanOn = fanReq || ozBlocked || ventBoost || (inputs.mode === 'auto' && w.rules.temp34.firing)
  A.fanRpm = !A.fanOn ? 0 : ventBoost ? 2400 : 1450
  A.fanReason = !A.fanOn
    ? 'Idle — temperature head normal'
    : w.badDay.active
      ? 'Bad Day Mode — ventilation boost'
      : ventBoost
        ? 'Rule: PM2.5 > 60 for 2 min — boost'
        : fanReq
          ? inputs.mode === 'auto' ? 'ML head X: temperature abnormal' : 'Manual override'
          : 'Fallback — ozone blocked by interlock'
  if (A.fanOn) A.runtime.fan += TICK_S
  if (A.oz1On) A.runtime.oz1 += TICK_S
  if (A.oz2On) A.runtime.oz2 += TICK_S

  for (const gen of [1, 2] as const) {
    const req = gen === 1 ? A.oz1Req : A.oz2Req
    const state = !req ? 'idle' : allowed ? 'allowed' : `blocked:${blockReason}`
    const lastState = w.interlock.last[gen]
    if (state !== lastState) {
      if (state === 'idle' && lastState !== 'idle') {
        w.interlock.log = cap([...w.interlock.log, { id: w.seq++, t: w.t, gen, verdict: 'released', reason: 'request withdrawn' }], 80)
      } else if (state === 'allowed') {
        w.interlock.log = cap([...w.interlock.log, { id: w.seq++, t: w.t, gen, verdict: 'allowed', reason: 'cabin unoccupied · O₃ under 0.07 ppm' }], 80)
      } else if (state.startsWith('blocked')) {
        w.interlock.log = cap([...w.interlock.log, { id: w.seq++, t: w.t, gen, verdict: 'blocked', reason: blockReason }], 80)
      }
      w.interlock.last[gen] = state
    }
  }

  // ozone estimate (SIM): generators add, ventilation and decay remove
  const gens = (A.oz1On ? 1 : 0) + (A.oz2On ? 1 : 0)
  const decay = A.fanOn ? 0.82 : 0.9
  w.interlock.ppm = clamp(0.008 + (w.interlock.ppm - 0.008) * decay + gens * 0.011 + rng.normal() * 0.0008, 0.004, 0.25)
  w.interlock.ppm8h += (w.interlock.ppm - w.interlock.ppm8h) * 0.03
  if (inputs.source === 'aws' && w.hw?.o3 !== undefined) {
    w.interlock.ppm = w.hw.o3
    w.interlock.ppm8h = w.hw.o3_8h ?? w.interlock.ppm8h
  }

  // ── 6. fleet ─────────────────────────────────────────────────────
  w.coaches = w.coaches.map((c, i) => {
    const d = COACHES[i]
    let pm25: number, pm10: number, temp: number, occupancy: number
    if (i === INSTRUMENTED) {
      pm25 = r.pm25; pm10 = r.pm10; temp = r.temp; occupancy = Math.round(L.occ)
    } else {
      const target = r.pm25 * d.factor * (1 + Math.sin(w.t / 90 + i) * 0.08)
      pm25 = Math.max(3, c.pm25 + (target - c.pm25) * 0.25 + rng.normal() * 1.5)
      pm10 = pm25 / clamp(L.ratio + (i % 3) * 0.02 - 0.02, 0.4, 0.8)
      temp = c.temp + (r.temp + (d.factor - 1) * 3 - c.temp) * 0.2 + rng.normal() * 0.05
      const occTarget = d.capacity * clamp(0.62 + (doorOpen ? 0.12 : 0) + p.occupancy * k / 120, 0, 1.25)
      occupancy = Math.round(clamp(c.occupancy + (occTarget - c.occupancy) * 0.1 + rng.normal() * 0.6, 0, d.capacity * 1.4))
    }
    // on AWS the other eleven coaches come from the coach feed too, so every page agrees
    const cf = inputs.source === 'aws' && i !== INSTRUMENTED ? w.hw?.fleet?.[i] : undefined
    if (cf) {
      pm25 = cf.pm25
      pm10 = cf.pm25 / clamp(L.ratio + (i % 3) * 0.02 - 0.02, 0.4, 0.8)
      occupancy = cf.occupancy
    }
    const aqi = cf ? cf.aqi : computeAqi(pm25, pm10).aqi
    const wantsOzone = i === INSTRUMENTED ? A.oz1Req || A.oz2Req : aqi > 220
    const ozone: CoachState['ozone'] = !wantsOzone ? 'off' : occupancy > 0 ? 'blocked' : 'on'
    const fan = i === INSTRUMENTED ? A.fanOn : aqi > 180 || w.badDay.active
    return { pm25, pm10, temp, aqi, occupancy, fan, ozone, heat: w.tick % 2 === 0 ? cap([...c.heat, aqi], HEAT_LEN) : c.heat }
  })

  // ── 7. exposure ──────────────────────────────────────────────────
  const minutes = TICK_S / 60
  const E = w.exposure
  E.minutes += minutes
  E.band[bandOf(r.aqi)] += minutes
  E.peakAqi = Math.max(E.peakAqi, r.aqi)
  const fleetPm = w.coaches.reduce((s, c) => s + c.pm25, 0) / w.coaches.length
  for (const g of GROUPS) {
    const pm = g.id === 'staff' ? fleetPm : r.pm25
    E.doseRate[g.id] = pm * g.factor
    E.dose[g.id] += pm * g.factor * minutes
  }
  const ce = inputs.source === 'aws' ? w.hw?.exposure : undefined
  if (ce) {
    E.minutes = ce.minutes
    Object.assign(E.dose, ce.dose)
    Object.assign(E.doseRate, ce.doseRate)
    if (ce.band) Object.assign(E.band, ce.band)
    if (ce.peakAqi !== undefined) E.peakAqi = ce.peakAqi
  }

  // ── 8. Bad Day Mode ──────────────────────────────────────────────
  if (fire.includes('aqi500') && !w.badDay.active) activateBadDay(w, `AQI ${r.aqi} — off the chart`, true)
  if (w.badDay.active && w.badDay.incident) {
    const inc = w.badDay.incident
    inc.peakAqi = Math.max(inc.peakAqi, r.aqi)
    advancePlaybook(w)
    w.badDay.calmFor = r.aqi < 250 ? w.badDay.calmFor + TICK_S : 0
    if (inc.auto && w.badDay.calmFor >= 20 && !w.scenario.sustain) {
      w.badDay.active = false
      inc.endedAt = w.t
      inc.actions.push({ t: w.t, step: 99, title: 'Stand down', detail: `AQI back to ${r.aqi} for 20 s. Ventilation returns to normal; advisories marked resolved.` })
    }
  }

  // ── 9. serial console (format mirrors final.py) ─────────────────
  if (!opts.quiet) {
    const frame = `a${r.temp.toFixed(2)}b${r.gas}c${r.co2}d${r.pm1}e`
    push('------------------------------', 'rule')
    push('     -= Data Received =-', 'title')
    push('------------------------------', 'rule')
    if (inputs.source === 'aws') push(`[iot] ${APP.telemetryTopic} → IoT Rule → Lambda`, 'sim')
    push(`Data: ${frame}`, 'frame')
    push('', 'blank')
    push(`Temperature: ${+r.temp.toFixed(2)}`, 'field')
    push(`Gas: ${r.gas}`, 'field')
    push(`CO2: ${r.co2}`, 'field')
    push(`Pms: ${r.pm1}`, 'field')
    push('Uploading data to webserver....', 'field')
    push('Data Successfully Uploaded!', 'ok')
    push('', 'blank')
    push('Predictions:', 'head')
    for (const h of HEADS) push(`${h.letter} Prediction: ${P[h.key].value}`, 'pred')
    for (const h of HEADS) push(P[h.key].value ? h.abnormal : h.normal, P[h.key].value ? 'bad' : 'msg')
    push(replyFrame(P), 'reply')
    if (inputs.source === 'aws') push(`[iot] ${APP.commandTopic} ← ${replyFrame(P)}`, 'sim')
    if (ozBlocked) push(`[dashboard] ML requested ozone · BLOCKED by interlock (${blockReason}) → fan + filtration`, 'sim')
    w.console = cap(w.console, 420)
  }

  w.rngState = rng.getState()
  return w
}

function snapshot(w: World): Snapshot {
  const worst = w.coaches.reduce((a, c, i) => (c.aqi > w.coaches[a].aqi ? i : a), 0)
  return {
    aqi: w.reading.aqi,
    pm25: w.reading.pm25,
    fanRpm: w.act.fanRpm,
    ozone: w.act.oz1Req || w.act.oz2Req ? 'Requested by ML' : 'Off',
    advisories: 0,
    sensitiveInWorst: Math.round(w.coaches[worst].occupancy * 0.31),
    achPerHour: w.act.fanOn ? 10 : 8,
  }
}

export function coachExtremes(w: World) {
  let worst = 0, clean = 0
  w.coaches.forEach((c, i) => {
    if (c.aqi > w.coaches[worst].aqi) worst = i
    if (c.aqi < w.coaches[clean].aqi) clean = i
  })
  return { worst, clean }
}

export function activateBadDay(w: World, trigger: string, auto = false) {
  const { worst, clean } = coachExtremes(w)
  const station = STATIONS[Math.min(w.train.stationIdx, STATIONS.length - 1)].name
  w.badDay.active = true
  w.badDay.calmFor = 0
  w.badDay.incident = {
    id: w.seq++,
    startedAt: w.t,
    endedAt: null,
    trigger,
    auto,
    before: snapshot(w),
    peakAqi: w.reading.aqi,
    actions: [],
    station,
    worstCoach: COACHES[worst].code,
    cleanCoach: COACHES[clean].code,
  }
}

export function deactivateBadDay(w: World) {
  if (!w.badDay.active || !w.badDay.incident) return
  w.badDay.active = false
  w.badDay.incident.endedAt = w.t
  w.badDay.incident.actions.push({ t: w.t, step: 99, title: 'Stand down', detail: 'Bad Day Mode switched off by operator.' })
}

const PLAYBOOK: { at: number; title: string; detail: (w: World, inc: Incident) => string }[] = [
  { at: 0, title: 'Bad Day Mode engaged', detail: (_w, inc) => `Trigger: ${inc.trigger}.` },
  { at: 0, title: 'Ventilation boost', detail: () => 'Exhaust fan to 2,400 rpm, fresh-air dampers to recirculate + filter.' },
  {
    at: 2, title: 'Ozone interlock evaluated',
    detail: (w) => w.interlock.occupied
      ? 'Ozone requested by ML but BLOCKED — cabin occupied. Falling back to fan + filtration.'
      : 'Cabin unoccupied, O₃ under 0.07 ppm — ozone purge allowed.',
  },
  { at: 4, title: 'Advisory sent to sensitive passengers', detail: (w) => `${GROUPS.reduce((s, g) => s + g.count, 0) + Math.round(w.coaches.length * 2.5)} passengers flagged at booking received SMS/WhatsApp guidance.` },
  { at: 6, title: 'Platform announcement drafted', detail: (_w, inc) => `Draft queued for ${inc.station} station master.` },
  { at: 8, title: 'Coach re-allocation suggested', detail: (_w, inc) => `Move sensitive passengers from ${inc.worstCoach} to ${inc.cleanCoach} (lowest AQI on the rake).` },
  { at: 10, title: 'Staff mask advisory', detail: () => 'N95 mandatory for TTEs, pantry and cleaning staff; rounds limited to 20 min.' },
]

function advancePlaybook(w: World) {
  const inc = w.badDay.incident!
  const elapsed = w.t - inc.startedAt
  PLAYBOOK.forEach((step, i) => {
    if (elapsed >= step.at && !inc.actions.some((a) => a.step === i)) {
      inc.actions.push({ t: inc.startedAt + step.at, step: i, title: step.title, detail: step.detail(w, inc) })
    }
  })
}

export const advisoriesSent = (inc: Incident | null) => (inc?.actions.some((a) => a.step === 3) ? 34 : 0)
export type { HeadKey }
