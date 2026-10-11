/**
 * Two-sentence explanation of why each Random-Forest head fired, written from the numbers.
 * Used when Amazon Bedrock is not available for "Explain this decision" (cloud and offline).
 */
import type { Bit, HeadKey } from './model'

export interface ExplainInput {
  features: { temp: number; gas: Bit; co2: Bit; pms: number }
  pred: Record<HeadKey, { value: Bit; p: number }>
}

const votes = (p: number) => `${Math.round(p * 100)} of 100 trees voted abnormal`

export function explainTemplate({ features: f, pred: p }: ExplainInput) {
  const x = p.x.value
    ? `Head X fired because ${f.temp.toFixed(1)} °C is on the hot side of what the forest learned (${votes(p.x.p)}), so the exhaust fan runs`
    : `Head X stayed quiet at ${f.temp.toFixed(1)} °C (${votes(p.x.p)}), so the fan is not needed for heat`
  const w = p.w.value ? `head W fired on a dust reading of ${f.pms} (${votes(p.w.p)})` : `head W read ${f.pms} as normal dust (${votes(p.w.p)})`
  const y = p.y.value ? 'MQ-2 reports gas, so head Y asked for ozone generator 2' : 'MQ-2 is clear, so head Y did not fire'
  const z = p.z.value ? 'MQ-135 reports stale air, so head Z asked for ozone generator 1' : 'MQ-135 is clear, so head Z did not fire'
  const gate = p.y.value || p.z.value || p.w.value ? ' — any ozone request still has to pass the safety interlock' : ''
  return `${x}, and ${w}. ${y.charAt(0).toUpperCase()}${y.slice(1)}, and ${z}${gate}.`
}
