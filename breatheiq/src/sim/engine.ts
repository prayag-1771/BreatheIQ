import { create } from 'zustand'
import {
  createWorld, stepWorld, activateBadDay, deactivateBadDay, ALERT_RULES, TICK_S,
  type World, type StepInputs,
} from './core'
import { DEFAULT_THRESHOLDS, type Thresholds, type Bit } from './model'
import type { ScenarioId } from './scenarios'
import type { HeadKey } from './model'
import { storage } from '../lib/storage'

export type Speed = 1 | 2 | 5 | 10
export const SPEEDS: Speed[] = [1, 2, 5, 10]

interface SimState extends StepInputs {
  world: World
  running: boolean
  speed: Speed
  lastTickAt: number
  serialStatus: 'idle' | 'connecting' | 'connected' | 'error' | 'unsupported'
  serialMessage: string
  tick: () => void
  setScenario: (id: ScenarioId, sustain?: boolean) => void
  setSpeed: (s: Speed) => void
  setRunning: (r: boolean) => void
  reset: () => void
  setMode: (m: 'auto' | 'manual') => void
  setManual: (k: 'fan' | 'oz1' | 'oz2', v: boolean) => void
  setThresholds: (t: Partial<Thresholds>) => void
  setRule: (id: string, on: boolean) => void
  setOccupiedOverride: (unoccupied: boolean) => void
  setBadDay: (on: boolean) => void
  ingestHardware: (f: { temp: number; gas: Bit; co2: Bit; pm1: number }) => void
  ingestCloud: (f: Omit<NonNullable<World['hw']>, 'at' | 'pred'>) => void
  ingestCloudPred: (pred: Record<HeadKey, { value: Bit; p: number }>) => void
  releaseCloud: () => void
  syncScenario: (id: ScenarioId) => void
  applyControl: (c: Command) => void
  setSource: (s: 'mock' | 'serial') => void
  setSerialStatus: (s: SimState['serialStatus'], msg?: string) => void
}

/** Operator actions are mirrored to the cloud pipeline through this sink (see cloud/commands.ts). */
export type Command = Partial<{
  scenario: ScenarioId; sustain: boolean; badDay: boolean; occupiedOverride: boolean
  mode: 'auto' | 'manual'; manual: StepInputs['manual']; thresholds: Thresholds; rulesEnabled: Record<string, boolean>
}>
let sink: ((c: Command) => void) | null = null
// a scenario picked here wins over the cloud's echo until the coach has caught up
let scenarioSetAt = 0
export const setCommandSink = (fn: typeof sink) => { sink = fn }

const saved = storage.get<{ scenario?: ScenarioId; speed?: Speed }>('breatheiq.sim', {})

function initialWorld() {
  const w = createWorld(12)
  if (saved.scenario && saved.scenario !== 1) w.scenario = { id: saved.scenario, startedAt: w.t, sustain: false }
  return w
}

const inputsOf = (s: SimState): StepInputs => ({
  thresholds: s.thresholds, mode: s.mode, manual: s.manual, rulesEnabled: s.rulesEnabled, source: s.source,
})

const mutate = (w: World, fn: (draft: World) => void) => {
  const draft = structuredClone(w)
  fn(draft)
  return draft
}

export const useSim = create<SimState>((set, get) => ({
  world: initialWorld(),
  running: true,
  speed: saved.speed && [1, 2, 5, 10].includes(saved.speed) ? saved.speed : 1,
  lastTickAt: Date.now(),
  thresholds: DEFAULT_THRESHOLDS,
  mode: 'auto',
  manual: { fan: false, oz1: false, oz2: false },
  rulesEnabled: Object.fromEntries(ALERT_RULES.map((r) => [r.id, r.enabled])),
  source: 'mock',
  serialStatus: 'idle',
  serialMessage: '',

  tick: () => {
    const s = get()
    set({ world: stepWorld(s.world, inputsOf(s)), lastTickAt: Date.now() })
  },
  setScenario: (id, sustain = false) => {
    set((s) => ({ world: mutate(s.world, (w) => { w.scenario = { id, startedAt: w.t, sustain } }) }))
    storage.set('breatheiq.sim', { scenario: id, speed: get().speed })
    scenarioSetAt = Date.now()
    sink?.({ scenario: id, sustain })
  },
  setSpeed: (speed) => {
    set({ speed })
    storage.set('breatheiq.sim', { scenario: get().world.scenario.id, speed })
  },
  setRunning: (running) => set({ running }),
  reset: () => {
    set({
      world: createWorld(12), running: true, mode: 'auto', manual: { fan: false, oz1: false, oz2: false },
      thresholds: DEFAULT_THRESHOLDS, rulesEnabled: Object.fromEntries(ALERT_RULES.map((r) => [r.id, r.enabled])),
    })
    storage.set('breatheiq.sim', { scenario: 1, speed: get().speed })
    sink?.({ scenario: 1, sustain: false, badDay: false })
  },
  setMode: (mode) => { set({ mode }); sink?.({ mode }) },
  setManual: (k, v) => { set((s) => ({ manual: { ...s.manual, [k]: v } })); sink?.({ manual: get().manual }) },
  setThresholds: (t) => { set((s) => ({ thresholds: { ...s.thresholds, ...t } })); sink?.({ thresholds: get().thresholds }) },
  setRule: (id, on) => { set((s) => ({ rulesEnabled: { ...s.rulesEnabled, [id]: on } })); sink?.({ rulesEnabled: get().rulesEnabled }) },
  setOccupiedOverride: (v) => {
    set((s) => ({ world: mutate(s.world, (w) => { w.interlock.occupiedOverride = v }) }))
    sink?.({ occupiedOverride: v })
  },
  setBadDay: (on) => {
    set((s) => ({
      world: mutate(s.world, (w) => {
        if (on && !w.badDay.active) activateBadDay(w, 'Operator switched on Bad Day Mode')
        if (!on) deactivateBadDay(w)
      }),
    }))
    sink?.({ badDay: on })
  },
  ingestHardware: (f) => set((s) => ({ world: mutate(s.world, (w) => { w.hw = { ...f, at: Date.now() } }) })),
  // a connected Arduino always wins over the cloud feed
  ingestCloud: (f) => set((s) => (s.source === 'serial' ? s : { source: 'aws', world: mutate(s.world, (w) => { w.hw = { ...f, pred: w.hw?.pred, at: Date.now() } }) })),
  ingestCloudPred: (pred) => set((s) => (s.source === 'aws' && s.world.hw ? { world: mutate(s.world, (w) => { w.hw!.pred = pred }) } : s)),
  releaseCloud: () => set((s) => (s.source === 'aws' ? { source: 'mock', world: mutate(s.world, (w) => { w.hw = null }) } : s)),
  syncScenario: (id) => {
    if (Date.now() - scenarioSetAt < 15_000) return
    set((s) => ({ world: mutate(s.world, (w) => { w.scenario = { id, startedAt: w.t, sustain: w.scenario.sustain } }) }))
  },
  // settings loaded from the cloud: applied without echoing them back
  applyControl: (c) =>
    set((s) => ({
      thresholds: c.thresholds ?? s.thresholds,
      rulesEnabled: { ...s.rulesEnabled, ...(c.rulesEnabled ?? {}) },
      mode: c.mode ?? s.mode,
      manual: c.manual ?? s.manual,
      world: c.occupiedOverride === undefined ? s.world : mutate(s.world, (w) => { w.interlock.occupiedOverride = c.occupiedOverride! }),
    })),
  setSource: (source) => set({ source }),
  setSerialStatus: (serialStatus, serialMessage = '') => set({ serialStatus, serialMessage }),
}))

// ── loop ───────────────────────────────────────────────────────────
let timer: number | undefined
let appliedSpeed = 0

function schedule() {
  const { running, speed } = useSim.getState()
  if (timer !== undefined && (appliedSpeed !== speed || !running)) {
    window.clearInterval(timer)
    timer = undefined
  }
  if (running && timer === undefined) {
    appliedSpeed = speed
    timer = window.setInterval(() => useSim.getState().tick(), (TICK_S * 1000) / speed)
  }
}

let unsub: (() => void) | undefined
export function startEngine() {
  if (unsub) return
  schedule()
  unsub = useSim.subscribe((s, p) => {
    if (s.running !== p.running || s.speed !== p.speed) schedule()
  })
}

export function stopEngine() {
  unsub?.()
  unsub = undefined
  if (timer !== undefined) window.clearInterval(timer)
  timer = undefined
}

/** Format simulated seconds as an on-board clock starting 08:42:00. */
export function clock(t: number) {
  const base = 8 * 3600 + 42 * 60
  const s = Math.floor(base + t) % 86400
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
