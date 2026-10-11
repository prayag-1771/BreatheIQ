import { useEffect, useState } from 'react'
import { useMotionValueEvent, useReducedMotion, useSpring } from 'framer-motion'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { BANDS, bandInfo, bandOf } from '../../sim/aqi'
import { AqiBadge, Tween } from '../ui/primitives'

const START = -120
const SWEEP = 240
const MAX = 500

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
}
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** Semi-circular CPCB gauge. Past 500 the needle pins beyond the end of the scale. */
export function AqiGauge({ aqi, trend, dominant }: { aqi: number; trend: number; dominant: string }) {
  const reduce = useReducedMotion()
  const off = aqi > MAX
  const angle = off ? START + SWEEP + 14 : START + (Math.max(0, aqi) / MAX) * SWEEP
  const cx = 150
  const cy = 150
  const r = 118
  const info = bandInfo(aqi)
  // spring-driven needle; overshoots harder when it slams past 500
  const spring = useSpring(angle, off ? { stiffness: 140, damping: 9 } : { stiffness: 90, damping: 16 })
  const [needle, setNeedle] = useState(angle)
  useMotionValueEvent(spring, 'change', setNeedle)
  useEffect(() => {
    if (reduce) spring.jump(angle)
    else spring.set(angle)
  }, [angle, reduce, spring])
  const shownAngle = reduce ? angle : needle
  const TrendIcon = trend > 4 ? ArrowUpRight : trend < -4 ? ArrowDownRight : ArrowRight

  return (
    <div className="flex flex-col items-center" role="meter" aria-valuemin={0} aria-valuemax={500} aria-valuenow={aqi} aria-label={`Cabin AQI ${aqi}, ${info.label}`}>
      <svg viewBox="0 0 300 236" className="w-full max-w-[360px]" aria-hidden>
        <defs>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="var(--aqi-severe)" />
            <rect width="4" height="8" fill="var(--aqi-verypoor)" />
          </pattern>
        </defs>
        {/* bands with 2px surface gaps */}
        {BANDS.map((b) => {
          const a0 = START + (b.lo / MAX) * SWEEP + (b.lo ? 0.8 : 0)
          const a1 = START + (Math.min(b.hi, MAX) / MAX) * SWEEP - 0.8
          const active = bandOf(aqi) === b.key
          return (
            <path key={b.key} d={arc(cx, cy, r, a0, a1)} stroke={b.color} strokeWidth={active ? 18 : 12} fill="none" opacity={active || off ? 1 : 0.45} style={{ transition: 'all .4s' }} />
          )
        })}
        {/* off-the-chart overrun segment */}
        <path d={arc(cx, cy, r, START + SWEEP + 1.5, START + SWEEP + 22)} stroke={off ? 'url(#hatch)' : 'var(--border)'} strokeWidth={off ? 18 : 10} fill="none" strokeDasharray={off ? undefined : '3 4'} />
        {[0, 100, 200, 300, 400, 500].map((v) => {
          const [x, y] = polar(cx, cy, r - 26, START + (v / MAX) * SWEEP)
          return (
            <text key={v} x={x} y={y + 3} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">
              {v}
            </text>
          )
        })}
        {(() => {
          const [x, y] = polar(cx, cy, r + 16, START + SWEEP + 12)
          return (
            <text x={x} y={y} textAnchor="middle" fontSize="7.5" fill={off ? 'var(--aqi-severe-ink)' : 'var(--muted)'} fontFamily="var(--font-mono)" letterSpacing="1">
              500+
            </text>
          )
        })()}
        <g transform={`rotate(${shownAngle} ${cx} ${cy})`}>
          <line x1={cx} y1={cy + 10} x2={cx} y2={cy - r + 8} stroke="var(--text)" strokeWidth={2.5} strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r={7} fill="var(--surface)" stroke="var(--text)" strokeWidth={2.5} />
      </svg>
      <div className="-mt-[4.5rem] flex flex-col items-center text-center">
        <p className="micro text-muted">Cabin AQI · CPCB</p>
        <p className="font-mono text-6xl leading-none font-semibold tracking-tight sm:text-7xl" style={{ color: off ? 'var(--aqi-severe-ink)' : undefined }}>
          <Tween value={aqi} />
        </p>
        <div className="mt-2 flex items-center gap-3">
          <AqiBadge aqi={aqi} size="md" />
          <span className="flex items-center gap-1 font-mono text-xs text-muted" aria-label={`Trend ${trend > 0 ? 'rising' : trend < 0 ? 'falling' : 'flat'}`}>
            <TrendIcon size={14} aria-hidden />
            {trend > 0 ? '+' : ''}
            {Math.round(trend)}/min
          </span>
        </div>
        <p className="mt-1 font-mono text-[0.6875rem] text-muted">Driven by {dominant}</p>
      </div>
    </div>
  )
}
