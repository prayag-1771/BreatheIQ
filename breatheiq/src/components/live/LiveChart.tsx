import { useState } from 'react'
import clsx from 'clsx'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useSim, clock } from '../../sim/engine'
import { Card } from '../ui/primitives'

const SERIES = [
  { key: 'pm1', label: 'PM1.0', color: 'var(--series-1)' },
  { key: 'pm25', label: 'PM2.5', color: 'var(--series-2)' },
  { key: 'pm10', label: 'PM10', color: 'var(--series-3)' },
] as const
type Key = (typeof SERIES)[number]['key']

const axisTick = { fill: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number; unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-card border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="micro mb-1 text-muted">{clock(label ?? 0)}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center justify-between gap-4 font-mono">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span>
            {Math.round(p.value * 10) / 10} {unit}
          </span>
        </p>
      ))}
    </div>
  )
}

export function LiveChart() {
  const history = useSim((s) => s.world.history)
  const th = useSim((s) => s.thresholds)
  const [on, setOn] = useState<Record<Key, boolean>>({ pm1: true, pm25: true, pm10: true })
  const maxPm = Math.max(140, ...history.map((h) => Math.max(on.pm10 ? h.pm10 : 0, on.pm25 ? h.pm25 : 0, on.pm1 ? h.pm1 : 0)))

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card
        title="Particulates · last 5 min · 2 s ticks"
        source="SENSOR"
        className="lg:col-span-2"
        actions={
          <div className="flex gap-1" role="group" aria-label="Toggle series">
            {SERIES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={on[s.key]}
                onClick={() => setOn({ ...on, [s.key]: !on[s.key] })}
                className={clsx(
                  'flex items-center gap-1.5 rounded-[4px] border px-1.5 py-[1px] font-mono text-[0.625rem]',
                  on[s.key] ? 'border-line-strong text-ink' : 'border-line text-muted line-through',
                )}
              >
                <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="h-64" role="img" aria-label="Line chart of PM1.0, PM2.5 and PM10 over the last five minutes with NAAQS limits marked">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 8, right: 68, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <ReferenceArea y1={0} y2={60} fill="var(--aqi-good)" fillOpacity={0.05} />
              <ReferenceArea y1={250} y2={Math.max(260, maxPm * 1.08)} fill="var(--aqi-severe)" fillOpacity={0.1} />
              <XAxis dataKey="t" tickFormatter={(t) => clock(t).slice(3)} tick={axisTick} stroke="var(--border)" minTickGap={48} />
              <YAxis tick={axisTick} stroke="var(--border)" domain={[0, Math.ceil((maxPm * 1.08) / 20) * 20]} allowDataOverflow />
              <ReferenceLine y={60} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'PM2.5 · 60', position: 'right', fill: 'var(--muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <ReferenceLine y={100} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'PM10 · 100', position: 'right', fill: 'var(--muted)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <ReferenceLine y={th.pm} stroke="var(--accent)" strokeDasharray="2 3" strokeOpacity={0.6} label={{ value: `W ${th.pm}`, position: 'right', fill: 'var(--accent)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <Tooltip content={<ChartTooltip unit="µg/m³" />} cursor={{ stroke: 'var(--border-strong)' }} />
              {SERIES.map((s) =>
                on[s.key] ? (
                  <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                ) : null,
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted">Dashed lines: India NAAQS 24-h limits. Teal line: dust head W boundary on PM1.0. Red band: CPCB Severe and above.</p>
      </Card>

      <Card title="Temperature · last 5 min" source="SENSOR">
        <div className="h-64" role="img" aria-label="Line chart of cabin temperature with the head X boundary marked">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 8, right: 40, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <ReferenceArea y1={th.tempC} y2={45} fill="var(--aqi-verypoor)" fillOpacity={0.07} />
              <XAxis dataKey="t" tickFormatter={(t) => clock(t).slice(3)} tick={axisTick} stroke="var(--border)" minTickGap={48} />
              <YAxis tick={axisTick} stroke="var(--border)" domain={[22, 42]} allowDataOverflow />
              <ReferenceLine y={th.tempC} stroke="var(--accent)" strokeDasharray="2 3" label={{ value: `X ${th.tempC}°`, position: 'right', fill: 'var(--accent)', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <Tooltip content={<ChartTooltip unit="°C" />} cursor={{ stroke: 'var(--border-strong)' }} />
              <Line dataKey="temp" name="Temperature" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted">Shaded: above the head X boundary — the exhaust fan turns on.</p>
      </Card>
    </div>
  )
}
