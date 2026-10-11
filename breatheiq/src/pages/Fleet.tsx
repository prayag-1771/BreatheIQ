import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Fan, Mountain, Wind, Factory, Flame, X, Users } from 'lucide-react'
import { useSim } from '../sim/engine'
import { COACHES, INSTRUMENTED, type CoachState } from '../sim/core'
import { STATIONS, ZONES, type ZoneKind } from '../sim/route'
import { bandColor, bandInfo, bandOf } from '../sim/aqi'
import { AqiBadge, Card, Pill, Section, SourceChip, Stat } from '../components/ui/primitives'
import { RouteSchematic, type RouteGeo } from '../components/fleet/RouteSchematic'
import { STATION_LNGLAT, ZONE_POLYGONS, trainLngLat } from '../sim/geo'
import { useCloud } from '../cloud/store'
import { api } from '../cloud/api'
import { usePoll } from '../lib/hooks'
import { useUi } from '../lib/ui'
import { APP } from '../config'

const RouteMap = lazy(() => import('../components/fleet/RouteMap'))

const ZONE_ICON: Record<ZoneKind, typeof Flame> = { haze: Flame, tunnel: Mountain, yard: Factory }

function TrainSchematic({ coaches, selected, onSelect }: { coaches: CoachState[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="scroll-thin -mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-w-[860px] items-end gap-1.5" role="listbox" aria-label="Coaches, coloured by AQI">
        <svg viewBox="0 0 70 56" className="h-[56px] w-[70px] shrink-0" aria-hidden>
          <path d="M8 52 V18 Q8 6 22 6 H70 V52 Z" fill="var(--surface-2)" stroke="var(--border-strong)" />
          <rect x="16" y="14" width="18" height="12" rx="2" fill="var(--bg)" />
          <text x="40" y="44" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">LOCO</text>
        </svg>
        {coaches.map((c, i) => {
          const d = COACHES[i]
          const off = c.aqi > 500
          const light = ['satisfactory', 'moderate'].includes(bandOf(c.aqi))
          return (
            <button
              key={d.no}
              type="button"
              role="option"
              aria-selected={selected === i}
              onClick={() => onSelect(i)}
              aria-label={`Coach ${d.code}, AQI ${c.aqi}, ${bandInfo(c.aqi).label}`}
              className={clsx(
                'relative flex h-[56px] min-w-0 flex-1 flex-col justify-between rounded-[5px] border-2 px-1.5 py-1 text-left transition-transform',
                selected === i ? 'border-ink -translate-y-1' : 'border-transparent hover:-translate-y-0.5',
                off && 'hatched',
              )}
              style={{ background: off ? undefined : bandColor(c.aqi), color: light ? '#111' : '#fff' }}
            >
              <span className="flex items-center justify-between font-mono text-[0.625rem] font-semibold">
                {d.code}
                {i === INSTRUMENTED && <span className="rounded-[2px] bg-black/30 px-0.5 text-[0.5rem] text-white">HW</span>}
              </span>
              <span className="font-mono text-sm leading-none font-semibold">{c.aqi}</span>
              <span className="flex gap-0.5">
                {c.fan && <Fan size={10} className="spin" aria-hidden />}
                {c.ozone === 'blocked' && <Wind size={10} className="opacity-60" aria-hidden />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RouteLine() {
  const train = useSim((s) => s.world.train)
  const segPeak = useSim((s) => s.world.segPeak)
  const W = 1000
  const x = (i: number) => 30 + (i / (STATIONS.length - 1)) * (W - 60)
  return (
    <div className="scroll-thin -mx-4 overflow-x-auto px-4">
      <svg viewBox={`0 0 ${W} 130`} className="min-w-[720px]" role="img" aria-label={`Route from ${STATIONS[0].name} to ${STATIONS[STATIONS.length - 1].name}; train between ${STATIONS[train.segment].name} and ${STATIONS[Math.min(train.segment + 1, STATIONS.length - 1)].name}`}>
        {STATIONS.slice(0, -1).map((_, i) => {
          const peak = segPeak[i]
          return (
            <g key={i}>
              <line x1={x(i)} y1={64} x2={x(i + 1)} y2={64} stroke={peak ? bandColor(peak) : 'var(--border-strong)'} strokeWidth={peak ? 6 : 3} strokeLinecap="round" />
              {peak !== undefined && (
                <text x={(x(i) + x(i + 1)) / 2} y={84} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
                  peak {peak}
                </text>
              )}
            </g>
          )
        })}
        {ZONES.map((z, i) => {
          const x0 = x(z.segment) + (x(z.segment + 1) - x(z.segment)) * z.from
          const x1 = x(z.segment) + (x(z.segment + 1) - x(z.segment)) * z.to
          return (
            <g key={i}>
              <rect x={x0} y={52} width={x1 - x0} height={24} rx={4} fill="none" stroke="var(--warn)" strokeDasharray="3 3" />
              <text x={(x0 + x1) / 2} y={44} textAnchor="middle" fontSize="9.5" fill="var(--warn)" fontFamily="var(--font-mono)">
                {z.label}
              </text>
            </g>
          )
        })}
        {STATIONS.map((s, i) => (
          <g key={s.code}>
            <circle cx={x(i)} cy={64} r={7} fill="var(--surface)" stroke="var(--text)" strokeWidth={2} />
            <text x={x(i)} y={108} textAnchor="middle" fontSize="11" fill="var(--text)" fontWeight={600}>
              {s.name}
            </text>
            <text x={x(i)} y={122} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">
              {s.code} · {s.km} km
            </text>
          </g>
        ))}
        <g style={{ transform: `translateX(${x(train.segment) + (x(train.segment + 1) - x(train.segment)) * train.frac}px)`, transition: 'transform 1.9s linear' }}>
          <rect x={-18} y={56} width={36} height={16} rx={4} fill="var(--accent)" />
          <text x={0} y={67.5} textAnchor="middle" fontSize="8" fill="var(--accent-ink)" fontWeight={700} fontFamily="var(--font-mono)">
            {APP.trainId}
          </text>
        </g>
      </svg>
    </div>
  )
}

/** Amazon Location: the route, its geofences and the train; a tile-free drawing when offline. */
function RouteMapCard() {
  const cfg = useCloud((s) => s.config)
  const theme = useUi((s) => s.theme)
  const cloudPos = useCloud((s) => (s.status === 'live' ? s.frame?.position ?? null : null))
  const preVent = useCloud((s) => (s.status === 'live' ? s.frame?.preVent ?? null : null))
  const trainPos = useSim((s) => s.world.train)
  const localPos = useMemo(() => trainLngLat(trainPos), [trainPos])
  const zone = useSim((s) => s.world.train.zone)
  const remote = usePoll(() => api.get<{ geofences: RouteGeo['geofences'] }>('/location'), 120_000, cfg !== null)
  const [failed, setFailed] = useState(false)
  const onFail = useCallback(() => setFailed(true), [])
  const fences = remote.data?.geofences
  const geo = useMemo<RouteGeo>(() => ({
    stations: STATIONS.map((s, i) => ({ code: s.code, name: s.name, lngLat: STATION_LNGLAT[i] })),
    geofences: fences ?? ZONE_POLYGONS,
  }), [fences])
  const train = cloudPos ?? localPos
  const tiles = !!cfg?.mapKey && !failed
  const fallback = <RouteSchematic geo={geo} train={train} />
  return (
    <Card title="Route map · geofences" source="SIM" service={cfg ? 'Location' : undefined}>
      {tiles ? (
        <Suspense fallback={fallback}>
          <RouteMap apiKey={cfg!.mapKey!} region={cfg!.region} theme={theme} geo={geo} train={train} onFail={onFail} />
        </Suspense>
      ) : (
        fallback
      )}
      <p className="mt-2 text-xs text-muted">
        {preVent?.active
          ? `Geofence ENTER: ${preVent.zone}. Ventilation switched on before the cabin air turns.`
          : zone
            ? `Inside ${zone.label}.`
            : 'Amazon Location tracks the train against four geofences; an ENTER event switches ventilation on before the cabin air turns.'}
      </p>
    </Card>
  )
}

function HeatStrip({ coaches }: { coaches: CoachState[] }) {
  const cols = Math.max(...coaches.map((c) => c.heat.length))
  return (
    <div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px]" aria-label="AQI per coach over time">
          <tbody>
            {coaches.map((c, i) => (
              <tr key={i}>
                <th scope="row" className="w-10 pr-2 text-right font-mono text-[0.625rem] font-normal text-muted">
                  {COACHES[i].code}
                </th>
                {Array.from({ length: cols }).map((_, j) => {
                  const v = c.heat[j - (cols - c.heat.length)]
                  return (
                    <td
                      key={j}
                      title={v !== undefined ? `${COACHES[i].code}: AQI ${v}` : undefined}
                      className={clsx('h-3.5 min-w-[6px] rounded-[2px]', v !== undefined && v > 500 && 'hatched')}
                      style={{ background: v === undefined ? 'var(--surface-2)' : v > 500 ? undefined : bandColor(v) }}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono">← {Math.round((cols * 4) / 60)} min ago · now →</span>
        <div className="flex flex-wrap gap-3">
          {[40, 80, 150, 250, 350, 450, 520].map((v) => (
            <AqiBadge key={v} aqi={v} />
          ))}
        </div>
      </div>
    </div>
  )
}

function CoachDrawer({ i, onClose }: { i: number; onClose: () => void }) {
  const c = useSim((s) => s.world.coaches[i])
  const d = COACHES[i]
  const hw = i === INSTRUMENTED
  return (
    <Card
      title={`Coach ${d.code} · ${d.kind}`}
      source={hw ? 'SENSOR' : 'SIM'}
      actions={
        <button type="button" onClick={onClose} aria-label="Close coach details" className="text-muted hover:text-ink">
          <X size={14} />
        </button>
      }
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-4xl font-semibold">{c.aqi}</span>
        <AqiBadge aqi={c.aqi} size="md" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="PM2.5" value={Math.round(c.pm25)} unit="µg/m³" />
        <Stat label="PM10" value={Math.round(c.pm10)} unit="µg/m³" />
        <Stat label="Temp" value={c.temp.toFixed(1)} unit="°C" />
        <Stat label="Occupancy" value={c.occupancy} unit={`/ ${d.capacity}`} sub={<span className="flex items-center gap-1"><Users size={11} /> {Math.round((c.occupancy / d.capacity) * 100)}% full</span>} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Pill tone={c.fan ? 'accent' : 'muted'} icon={<Fan size={10} />}>Fan {c.fan ? 'on' : 'off'}</Pill>
        <Pill tone={c.ozone === 'blocked' ? 'warn' : c.ozone === 'on' ? 'accent' : 'muted'} icon={<Wind size={10} />}>
          Ozone {c.ozone}
        </Pill>
        {!hw && <SourceChip kind="SIM" />}
      </div>
      <p className="mt-4 text-xs text-muted">
        {hw
          ? 'This is the coach with the real prototype. Its numbers match the Live page.'
          : `No hardware here yet. Values are modelled from coach B2 with a ${d.factor < 1 ? 'cleaner' : 'dirtier'}-than-average factor of ${d.factor}.`}
      </p>
    </Card>
  )
}

export function FleetPage() {
  const coaches = useSim((s) => s.world.coaches)
  const zone = useSim((s) => s.world.train.zone)
  const [sel, setSel] = useState<number | null>(INSTRUMENTED)
  const worst = coaches.reduce((a, c, i) => (c.aqi > coaches[a].aqi ? i : a), 0)
  const avg = Math.round(coaches.reduce((s, c) => s + c.aqi, 0) / coaches.length)
  const ZoneIcon = zone ? ZONE_ICON[zone.kind] : null
  return (
    <Section
      num="02"
      label="Fleet"
      title="Twelve coaches. One of them is real."
      lead="Coach B2 carries the prototype; the other eleven are modelled from it so you can see what a fleet-wide rollout would look like."
      aside={<SourceChip kind="SIM" />}
    >
      <div className="mb-4 grid grid-cols-2 gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-4">
        <Stat label="Rake average AQI" value={avg} sub={<AqiBadge aqi={avg} />} />
        <Stat label="Worst coach" value={COACHES[worst].code} sub={`AQI ${coaches[worst].aqi}`} />
        <Stat label="Fans running" value={coaches.filter((c) => c.fan).length} unit="/ 12" />
        <Stat
          label="Current stretch"
          value={<span className="text-base">{zone ? zone.label : 'Open line'}</span>}
          sub={ZoneIcon ? <span className="flex items-center gap-1 text-warn"><ZoneIcon size={11} /> pushes PM up here</span> : 'No route event'}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="grid content-start gap-4 lg:col-span-8">
          <Card title={`Rake · ${APP.trainId} · tap a coach`} source="SIM">
            <TrainSchematic coaches={coaches} selected={sel ?? -1} onSelect={setSel} />
          </Card>
          <Card title="Route · timetable" source="SIM">
            <RouteLine />
            <p className="mt-2 text-xs text-muted">Stations are real names on a simulated timetable. Segment colour = peak cabin AQI seen on that stretch this session.</p>
          </Card>
        </div>
        <div className="lg:col-span-4">{sel !== null ? <CoachDrawer i={sel} onClose={() => setSel(null)} /> : <Card title="Coach details"><p className="text-sm text-muted">Pick a coach in the rake to see its air.</p></Card>}</div>
      </div>
      <div className="mt-4">
        <RouteMapCard />
      </div>
      <Card title="Heat strip · coach × time" source="SIM" className="mt-4">
        <HeatStrip coaches={coaches} />
      </Card>
    </Section>
  )
}
