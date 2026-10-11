import { useState } from 'react'
import { api, type CallMeta } from '../../cloud/api'
import { useCloud } from '../../cloud/store'
import { explainTemplate, type ExplainInput } from '../../sim/explain'
import type { Prediction, Thresholds } from '../../sim/model'

export interface Explanation {
  text: string
  meta: CallMeta
}

export const toExplainPred = (p: Prediction): ExplainInput['pred'] => ({
  x: { value: p.x.value, p: p.x.pAbnormal },
  y: { value: p.y.value, p: p.y.pAbnormal },
  z: { value: p.z.value, p: p.z.pAbnormal },
  w: { value: p.w.value, p: p.w.pAbnormal },
})

/** "Explain this decision": Amazon Bedrock when reachable, otherwise written from the numbers. */
export function useExplain() {
  const [result, setResult] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (input: ExplainInput & { thresholds: Thresholds }) => {
    setBusy(true)
    try {
      if (!useCloud.getState().config) throw new Error('offline')
      setResult(await api.post<Explanation>('/explain', input))
    } catch {
      setResult({ text: explainTemplate(input), meta: { engine: 'template', error: 'offline' } })
    } finally {
      setBusy(false)
    }
  }
  return { result, busy, run, clear: () => setResult(null) }
}
