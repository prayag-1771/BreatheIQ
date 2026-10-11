import { Sparkles, X } from 'lucide-react'
import { Button, ServiceChip } from '../ui/primitives'
import type { Explanation } from './useExplain'

export function ExplainButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <Button variant="secondary" className="!px-2 !py-1 text-xs" icon={<Sparkles size={12} className={busy ? 'pulse-soft' : ''} />} onClick={onClick} disabled={busy}>
      {busy ? 'Explaining…' : 'Explain'}
    </Button>
  )
}

export function ExplainResult({ result, onClose }: { result: Explanation | null; onClose: () => void }) {
  if (!result) return null
  const bedrock = result.meta.engine === 'bedrock'
  return (
    <div className="mt-4 rounded-card border border-accent/40 bg-accent/5 p-3" role="status">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <p className="micro text-accent">Why the heads decided this</p>
        {bedrock ? (
          <>
            <ServiceChip name="Bedrock" />
            <ServiceChip name="Guardrails" />
          </>
        ) : (
          <span className="font-mono text-[0.625rem] text-muted">From the model's votes</span>
        )}
        <button type="button" onClick={onClose} className="ml-auto text-muted hover:text-ink" aria-label="Close explanation">
          <X size={12} />
        </button>
      </div>
      <p className="text-sm leading-relaxed">{result.text}</p>
      {bedrock && (
        <p className="mt-1.5 font-mono text-[0.625rem] text-muted">
          {result.meta.modelId} · {result.meta.latencyMs} ms · {result.meta.outputTokens ?? 0} tokens
        </p>
      )}
    </div>
  )
}
