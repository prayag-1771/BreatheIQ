import { MessageCircle } from 'lucide-react'
import { useUi } from '../../lib/ui'

/** Floating entry point to "Ask BreatheIQ" on every page (also the J key). */
export function AskButton() {
  const open = useUi((s) => s.askOpen)
  const setAsk = useUi((s) => s.setAsk)
  if (open) return null
  return (
    <button
      type="button"
      onClick={() => setAsk(true)}
      className="fixed right-4 bottom-4 z-40 inline-flex h-11 items-center gap-2 rounded-full border border-accent/50 bg-surface px-4 text-sm font-medium shadow-xl hover:border-accent hover:text-accent no-print"
      aria-keyshortcuts="J"
      aria-label="Ask BreatheIQ"
    >
      <MessageCircle size={16} className="text-accent" aria-hidden />
      <span className="hidden sm:inline">Ask BreatheIQ</span>
      <kbd className="hidden rounded-[3px] border border-line px-1 font-mono text-[0.625rem] text-muted sm:inline">J</kbd>
    </button>
  )
}
