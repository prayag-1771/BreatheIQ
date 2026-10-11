import { useEffect, useState } from 'react'
import { useSim } from '../../sim/engine'

const pad = (s: string) => s.slice(0, 16).padEnd(16, ' ')

/** 16×2 HD44780 emulator that cycles screens in the same order as the sketch's loop(). */
export function LcdEmulator({ compact = false }: { compact?: boolean }) {
  const r = useSim((s) => s.world.reading)
  const pred = useSim((s) => s.world.pred)
  const result = useSim((s) => s.world.lcd)
  const running = useSim((s) => s.running)
  const [screen, setScreen] = useState(0)

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setScreen((n) => (n + 1) % 6), 1700)
    return () => window.clearInterval(id)
  }, [running])

  const screens: [string, string][] = [
    ['AIR QUALITY', 'Monitoring Train'],
    [`PMS ${r.pm1}`, `PMS 2.5 ${r.pm25}`],
    [`Temp:  ${r.temp.toFixed(2)}`, `humidity  ${r.hum.toFixed(2)}`],
    [`Gas Val ${r.gas}`, `CO2Pin_val ${r.co2}`],
    [`a${pred.x.value}b${pred.y.value}`, `c${pred.z.value}d${pred.w.value}`],
    result,
  ]
  const [l1, l2] = screens[screen]
  const lines = [pad(l1), pad(l2)]

  return (
    <div className="mx-auto max-w-[560px]">
      <div
        className="rounded-[6px] border-[6px] border-[#1d3a6b] bg-[var(--lcd-bg)] p-2.5 shadow-[inset_0_0_24px_rgba(0,0,0,0.6)]"
        role="img"
        aria-label={`LCD showing: ${l1.trim()} / ${l2.trim()}`}
      >
        {lines.map((line, row) => (
          <div key={row} className="grid grid-cols-16 gap-[2px] [&+&]:mt-[2px]" aria-hidden>
            {line.split('').map((ch, i) => (
              <span
                key={i}
                className={`flex aspect-[5/8] items-center justify-center rounded-[1px] font-mono leading-none font-semibold ${compact ? 'text-[0.7rem]' : 'text-[0.8rem] sm:text-[0.95rem]'}`}
                style={{ background: 'var(--lcd-off)', color: 'var(--lcd-on)', textShadow: '0 0 6px rgba(156,255,122,.55)' }}
              >
                {ch === ' ' ? ' ' : ch}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {screens.map((_, i) => (
          <span key={i} className={`h-0.5 flex-1 rounded-full ${i === screen ? 'bg-accent' : 'bg-line'}`} />
        ))}
      </div>
    </div>
  )
}
