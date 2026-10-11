/**
 * Mirrors operator actions to the cloud pipeline so the coach, not just this browser, acts
 * on them. Scenario and Bad Day Mode are open to every visitor; the Controls settings are
 * sent only for a signed-in operator (the API would refuse them otherwise).
 */
import { setCommandSink, useSim, type Command } from '../sim/engine'
import { api } from './api'
import { useCloud } from './store'

const OPERATOR_KEYS: (keyof Command)[] = ['occupiedOverride', 'mode', 'manual', 'thresholds', 'rulesEnabled']

let pending: Command = {}
let timer: number | undefined

function flush() {
  timer = undefined
  const patch = pending
  pending = {}
  const { config, role } = useCloud.getState()
  if (!config) return
  if (role !== 'operator') for (const k of OPERATOR_KEYS) delete patch[k]
  if (Object.keys(patch).length) void api.post('/control', patch).catch(() => undefined)
}

export function initCloudCommands() {
  setCommandSink((c) => {
    pending = { ...pending, ...c }
    timer ??= window.setTimeout(flush, 250)
  })
}

/** Load the coach's saved settings (thresholds, rules, mode) into this page. */
export async function hydrateControl() {
  if (!useCloud.getState().config) return
  try {
    const r = await api.get<{ control: Command & { simEnabled: boolean } }>('/control')
    useSim.getState().applyControl(r.control)
  } catch {
    /* unreachable: keep the local settings */
  }
}

export const setSimulator = (enabled: boolean) => api.post<{ control: { simEnabled: boolean } }>('/control', { simEnabled: enabled })
