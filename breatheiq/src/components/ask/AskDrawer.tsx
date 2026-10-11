import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { BookOpen, Send, ShieldCheck, Wrench, X } from 'lucide-react'
import { useUi } from '../../lib/ui'
import { useCloud } from '../../cloud/store'
import { askStream, type CallMeta, type ChatEvent } from '../../cloud/api'
import { answer } from '../../ask/assistant'
import { localTools } from '../../ask/localTools'
import { ServiceChip } from '../ui/primitives'

interface Msg {
  id: number
  role: 'user' | 'assistant'
  text: string
  tools: string[]
  citations: { title: string; snippet: string }[]
  guardrail: boolean
  engine?: 'agent' | 'cloud' | 'local'
  meta?: CallMeta
  pending?: boolean
}

const SUGGESTIONS = [
  'Which coach has the worst air and who is in it?',
  'Why was ozone blocked?',
  'Is 0.05 ppm ozone safe for a pregnant passenger?',
  'Start the haze-belt scenario.',
]

const SESSION = `web-${Math.random().toString(36).slice(2, 10)}`
let seq = 0

function EngineNote({ m }: { m: Msg }) {
  if (m.pending || !m.engine) return null
  if (m.engine === 'agent') {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[0.625rem] text-muted">
        <ServiceChip name="Bedrock" />
        <ServiceChip name="Knowledge Base" />
        <ServiceChip name="Guardrails" />
        {m.meta?.latencyMs !== undefined && <span>{m.meta.latencyMs} ms · {m.meta.outputTokens ?? 0} tokens</span>}
      </p>
    )
  }
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[0.625rem] text-muted">
      {m.engine === 'cloud' ? (
        <>
          <ServiceChip name="Lambda" />
          <ServiceChip name="DynamoDB" />
          <span>BreatheIQ assistant · live coach data</span>
        </>
      ) : (
        <span>BreatheIQ assistant · local engine</span>
      )}
    </p>
  )
}

function Bubble({ m }: { m: Msg }) {
  if (m.role === 'user') {
    return <div className="ml-auto max-w-[85%] rounded-card rounded-br-[2px] bg-accent/15 px-3 py-2 text-sm">{m.text}</div>
  }
  return (
    <div className="max-w-[95%]">
      {m.tools.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {m.tools.map((t) => (
            <span key={t} className="micro inline-flex items-center gap-1 rounded-[4px] border border-line px-1.5 py-[1px] text-[0.5625rem] text-muted">
              {t === 'Knowledge Base' ? <BookOpen size={9} aria-hidden /> : <Wrench size={9} aria-hidden />}
              {t === 'Knowledge Base' ? 'searched: Knowledge Base' : `used tool: ${t}`}
            </span>
          ))}
        </div>
      )}
      <div className="rounded-card rounded-tl-[2px] border border-line bg-surface-2 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
        {m.text || (m.pending ? <span className="pulse-soft text-muted">Thinking…</span> : null)}
      </div>
      {m.guardrail && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
          <ShieldCheck size={12} className="mt-0.5 shrink-0 text-ok" aria-hidden />
          A guardrail kept this answer to air-quality guidance. BreatheIQ never diagnoses or suggests medicine.
        </p>
      )}
      {m.citations.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {m.citations.map((c, i) => (
            <li key={`${c.title}-${i}`}>
              <span className="inline-flex items-center gap-1 rounded-[4px] border border-accent/40 px-1.5 py-[1px] text-[0.6875rem] text-accent" title={c.snippet}>
                <BookOpen size={10} aria-hidden />
                {c.title}
              </span>
            </li>
          ))}
        </ul>
      )}
      <EngineNote m={m} />
    </div>
  )
}

export function AskDrawer() {
  const open = useUi((s) => s.askOpen)
  const setAsk = useUi((s) => s.setAsk)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setInput('')
    const id = ++seq * 2
    setMsgs((m) => [
      ...m,
      { id, role: 'user', text: question, tools: [], citations: [], guardrail: false },
      { id: id + 1, role: 'assistant', text: '', tools: [], citations: [], guardrail: false, pending: true },
    ])
    const patch = (fn: (m: Msg) => Msg) => setMsgs((ms) => ms.map((m) => (m.id === id + 1 ? fn(m) : m)))
    const onEvent = (e: ChatEvent) => {
      if (e.type === 'text') patch((m) => ({ ...m, text: m.text + e.delta }))
      else if (e.type === 'tool') patch((m) => (m.tools.includes(e.name) ? m : { ...m, tools: [...m.tools, e.name] }))
      else if (e.type === 'citation') patch((m) => ({ ...m, citations: [...m.citations, { title: e.title, snippet: e.snippet }] }))
      else if (e.type === 'guardrail') patch((m) => ({ ...m, guardrail: true }))
      else patch((m) => ({ ...m, meta: e.meta, engine: e.meta.engine === 'bedrock' ? 'agent' : 'cloud' }))
    }
    let streamed = false
    if (useCloud.getState().config) {
      try {
        await askStream(question, SESSION, (e) => {
          streamed = true
          onEvent(e)
        })
      } catch {
        /* unreachable: answer locally below */
      }
    }
    if (!streamed) {
      await answer(question, localTools, onEvent)
      patch((m) => ({ ...m, engine: 'local' }))
    }
    patch((m) => ({ ...m, pending: false }))
    setBusy(false)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void ask(input)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          role="dialog"
          aria-label="Ask BreatheIQ"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl no-print"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
            <div className="min-w-0">
              <p className="micro text-accent">Ask BreatheIQ</p>
              <p className="truncate text-xs text-muted">Live coach data, the interlock log and the standards, with sources.</p>
            </div>
            <button type="button" onClick={() => setAsk(false)} aria-label="Close Ask BreatheIQ" className="rounded-card p-1 text-muted hover:text-ink">
              <X size={16} />
            </button>
          </div>

          <div ref={listRef} className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
            {msgs.length === 0 && (
              <div>
                <p className="text-sm text-muted">Ask about the air on train 12302. For example:</p>
                <ul className="mt-3 grid gap-2">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button type="button" onClick={() => void ask(s)} className="w-full rounded-card border border-line px-3 py-2 text-left text-sm hover:border-accent/60 hover:text-accent">
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-muted">Air-quality guidance only. BreatheIQ does not diagnose conditions or recommend medicine.</p>
              </div>
            )}
            {msgs.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
            <label className="sr-only" htmlFor="ask-input">Question</label>
            <input
              id="ask-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Which coach has the worst air?"
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-card border border-line-strong bg-bg px-3 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className={clsx('inline-flex h-10 w-10 items-center justify-center rounded-card bg-accent text-accent-ink disabled:opacity-40')}
              aria-label="Send question"
            >
              <Send size={15} />
            </button>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
