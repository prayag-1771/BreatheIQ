import { useNow } from '../../lib/hooks'
import { useSim } from '../../sim/engine'
import type { Reading } from '../../sim/core'
import { Pill, Sparkline, SourceChip, StatusPill, Tween } from '../ui/primitives'

interface TileDef {
  key: keyof Reading
  label: string
  sensor: string
  unit: string
  decimals?: number
  digital?: boolean
  abnormal: (v: number, th: { tempC: number; pm: number }) => boolean
  hint: string
}

const TILES: TileDef[] = [
  { key: 'temp', label: 'Temperature', sensor: 'DHT11', unit: '°C', decimals: 1, abnormal: (v, th) => v >= th.tempC, hint: 'Head X boundary' },
  { key: 'hum', label: 'Humidity', sensor: 'DHT11', unit: '%', abnormal: (v) => v > 75, hint: 'Comfort ≤ 75 %' },
  { key: 'gas', label: 'Gas / smoke', sensor: 'MQ-2', unit: '', digital: true, abnormal: (v) => v === 0, hint: 'Digital out · 1 = clear' },
  { key: 'co2', label: 'CO₂ / air gases', sensor: 'MQ-135', unit: '', digital: true, abnormal: (v) => v === 0, hint: 'Digital out · 1 = clear' },
  { key: 'pm1', label: 'PM1.0', sensor: 'PMS7003', unit: 'µg/m³', abnormal: (v, th) => v >= th.pm, hint: 'Sent to the model as Pms' },
  { key: 'pm25', label: 'PM2.5', sensor: 'PMS7003', unit: 'µg/m³', abnormal: (v) => v > 60, hint: 'NAAQS 24-h · 60' },
  { key: 'pm10', label: 'PM10', sensor: 'PMS7003', unit: 'µg/m³', abnormal: (v) => v > 100, hint: 'NAAQS 24-h · 100' },
]

export function SensorTiles() {
  const history = useSim((s) => s.world.history)
  const th = useSim((s) => s.thresholds)
  const lastTickAt = useSim((s) => s.lastTickAt)
  const running = useSim((s) => s.running)
  const now = useNow(1000)
  const r = history[history.length - 1]
  const ago = Math.max(0, Math.round((now - lastTickAt) / 1000))
  if (!r) return null
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7" data-tour="tiles">
      {TILES.map((t) => {
        const v = r[t.key] as number
        const bad = t.abnormal(v, th)
        const series = history.slice(-60).map((h) => h[t.key] as number)
        return (
          <article key={t.key} className="flex min-w-0 flex-col rounded-card border border-line bg-surface p-3">
            <h3 className="micro truncate text-muted" title={t.label}>{t.label}</h3>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="truncate font-mono text-[0.625rem] text-muted/80">{t.sensor}</p>
              <SourceChip kind="SENSOR" />
            </div>
            <p className="mt-2 font-mono text-[1.75rem] leading-none font-medium tracking-tight">
              {t.digital ? (
                <span>{v}</span>
              ) : (
                <Tween value={v} decimals={t.decimals ?? 0} />
              )}
              {t.unit && <span className="ml-1 text-xs text-muted">{t.unit}</span>}
            </p>
            <div className="mt-2">
              {t.digital ? (
                <StatusPill abnormal={bad} labels={['Clear', 'Detected']} />
              ) : (
                <StatusPill abnormal={bad} />
              )}
            </div>
            <div className="mt-auto pt-3">
              <Sparkline
                values={series}
                color={bad ? 'var(--bad)' : 'var(--accent)'}
                label={`${t.label} last 2 minutes`}
                min={t.digital ? -0.1 : undefined}
                max={t.digital ? 1.1 : undefined}
              />
              <p className="mt-1 flex items-center justify-between font-mono text-[0.625rem] text-muted">
                <span className="truncate">{t.hint}</span>
                <span className="shrink-0">{running ? `${ago}s ago` : 'frozen'}</span>
              </p>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export function MiniSourceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <SourceChip kind="SENSOR" /> real prototype hardware
      </span>
      <span className="flex items-center gap-1.5">
        <SourceChip kind="SIM" /> simulated extension
      </span>
      <Pill tone="muted">CPCB AQI · not clamped at 500</Pill>
    </div>
  )
}
