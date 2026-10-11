import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Pause, Play } from 'lucide-react'
import { useSim } from '../../sim/engine'
import type { ConsoleKind } from '../../sim/core'
import { Card } from '../ui/primitives'

const KIND: Record<ConsoleKind, string> = {
  sys: 'text-accent',
  rule: 'text-muted',
  title: 'text-ink font-semibold',
  frame: 'text-ink',
  field: 'text-ink/85',
  ok: 'text-ok',
  head: 'text-ink font-semibold',
  pred: 'text-ink/85',
  msg: 'text-ink/70',
  bad: 'text-bad font-semibold',
  reply: 'text-accent',
  blank: '',
  sim: 'text-warn',
}

const NODES = {
  local: ['Arduino', 'PC · RF', 'Arduino', 'ThingSpeak'],
  aws: ['Coach B2', 'IoT Core', 'Lambda · RF', 'Coach B2'],
}

/** A dot that follows each frame: coach → IoT Core → model → command back (or the bench path). */
function PacketFlow() {
  const tick = useSim((s) => s.world.tick)
  const aws = useSim((s) => s.source === 'aws')
  return (
    <div className="relative mb-3 flex items-center justify-between px-1" aria-hidden>
      <div className="absolute top-1/2 right-6 left-6 h-px -translate-y-1/2 bg-line" />
      {NODES[aws ? 'aws' : 'local'].map((n, i) => (
        <span key={i} className="micro relative z-10 rounded-[4px] border border-line bg-surface px-1.5 py-0.5 text-[0.5625rem] text-muted">
          {n}
        </span>
      ))}
      <motion.span
        key={tick}
        className="absolute top-1/2 z-20 h-2 w-2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
        initial={{ left: '6%', opacity: 1 }}
        animate={{ left: ['6%', '36%', '64%', '92%'], opacity: [1, 1, 1, 0] }}
        transition={{ duration: 1.6, times: [0, 0.33, 0.66, 1], ease: 'easeInOut' }}
      />
    </div>
  )
}

export function SerialConsole({ height = 360 }: { height?: number }) {
  const lines = useSim((s) => s.world.console)
  const aws = useSim((s) => s.source === 'aws')
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState(lines)
  const ref = useRef<HTMLDivElement>(null)
  const shown = paused ? frozen : lines

  useEffect(() => {
    if (!paused && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [shown, paused])

  return (
    <Card
      title={aws ? 'Frame console · MQTT' : 'Serial console · COM5 · 115200'}
      source="SENSOR"
      service={aws ? 'IoT Core' : undefined}
      tour="console"
      actions={
        <button
          type="button"
          onClick={() => {
            setFrozen(lines)
            setPaused(!paused)
          }}
          className="micro inline-flex items-center gap-1 rounded-[4px] border border-line px-1.5 py-[1px] text-[0.625rem] text-muted hover:text-ink"
          aria-pressed={paused}
        >
          {paused ? <Play size={10} /> : <Pause size={10} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      }
    >
      <PacketFlow />
      <div
        ref={ref}
        className="scroll-thin overflow-y-auto rounded-[5px] border border-line bg-bg p-3 font-mono text-[0.75rem] leading-[1.45]"
        style={{ height }}
        role="log"
        aria-live="off"
        aria-label="Python serial output"
        tabIndex={0}
      >
        {shown.map((l) => (
          <div key={l.id} className={clsx('whitespace-pre', KIND[l.kind])}>
            {l.kind === 'frame' ? (
              <>
                Data: <mark className="rounded-[3px] bg-accent/15 px-1 text-accent">{l.text.slice(6)}</mark>
              </>
            ) : l.kind === 'reply' ? (
              <>
                <span className="text-muted">→ serial.write </span>
                <mark className="rounded-[3px] bg-accent/15 px-1 text-accent">{l.text}</mark>
              </>
            ) : (
              l.text || ' '
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
