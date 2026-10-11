import { useEffect, useReducer, useRef } from 'react'
import clsx from 'clsx'
import { Baby, Accessibility, HeartPulse, Wind, HardHat, Receipt, Timer } from 'lucide-react'
import { useSim, clock } from '../sim/engine'
import { COACHES, INSTRUMENTED, coachExtremes } from '../sim/core'
import { BANDS, OFF_CHART, LIMITS } from '../sim/aqi'
import { GROUPS, BUDGET, ADVICE, riskFor, type GroupId, type Risk } from '../sim/exposure'
import { APP } from '../config'
import { fmt, hms } from '../lib/format'
import { AqiBadge, Card, Pill, Section, ServiceChip, SourceChip, Tween } from '../components/ui/primitives'
import { useCloud } from '../cloud/store'
import { api, type CallMeta } from '../cloud/api'

const ICON: Record<GroupId, typeof Baby> = { children: Baby, elderly: Accessibility, respiratory: Wind, pregnant: HeartPulse, staff: HardHat }
const RISK_TONE: Record<Risk, 'ok' | 'warn' | 'bad' | 'muted'> = { low: 'ok', elevated: 'warn', high: 'bad', critical: 'bad' }

// one sentence per group + risk + cleanest coach, shared by every card on the page
const adviceCache = new Map<string, { text: string; meta: CallMeta } | null>()

/** Bedrock-written advice for this group and risk; null until it arrives (the static advice shows meanwhile). */
function useAdvice(id: GroupId, name: string, risk: Risk, clean: string, aqi: number) {
  const enabled = useCloud((s) => s.config !== null)
  const key = `${id}|${risk}|${clean}`
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  // aqi is context for the model, not a reason to ask again
  const aqiNow = useRef(aqi)
  useEffect(() => {
    aqiNow.current = aqi
  })
  useEffect(() => {
    if (!enabled || adviceCache.has(key)) return
    adviceCache.set(key, null)
    api.post<{ text: string | null; meta: CallMeta }>('/advice', { group: id, groupName: name, risk, cleanCoach: clean, aqi: aqiNow.current })
      .then((r) => {
        if (r.text && r.meta.engine === 'bedrock') adviceCache.set(key, { text: r.text, meta: r.meta })
        refresh()
      })
      .catch(() => undefined)
  }, [key, enabled, id, name, risk, clean])
  return adviceCache.get(key) ?? null
}

function GroupCard({ id }: { id: GroupId }) {
  const g = GROUPS.find((x) => x.id === id)!
  const dose = useSim((s) => s.world.exposure.dose[id])
  const rate = useSim((s) => s.world.exposure.doseRate[id])
  const aqi = useSim((s) => (id === 'staff' ? Math.round(s.world.coaches.reduce((a, c) => a + c.aqi, 0) / s.world.coaches.length) : s.world.reading.aqi))
  const clean = useSim((s) => COACHES[coachExtremes(s.world).clean].code)
  const risk = riskFor(g, aqi)
  const advice = useAdvice(id, g.name, risk, clean, aqi)
  const Icon = ICON[id]
  const whoPct = dose / BUDGET.who
  const naaqsPct = dose / BUDGET.naaqs
  const minsToWho = rate > 0 ? Math.max(0, (BUDGET.who - dose) / rate) : Infinity
  return (
    <article className={clsx('flex flex-col rounded-card border bg-surface p-4', risk === 'critical' ? 'border-bad/60' : 'border-line')}>
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={clsx('flex h-9 w-9 items-center justify-center rounded-card border', risk === 'low' ? 'border-line text-muted' : 'border-bad/40 bg-bad/10 text-bad')}>
            <Icon size={18} aria-hidden />
          </span>
          <div>
            <h3 className="font-semibold tracking-tight">{g.name}</h3>
            <p className="text-xs text-muted">{g.who}</p>
          </div>
        </div>
        <SourceChip kind="SIM" />
      </header>
      <div className="mt-3 flex items-center gap-2">
        <Pill tone={RISK_TONE[risk]}>{risk} risk</Pill>
        <span className="font-mono text-[0.6875rem] text-muted">×{g.factor} dose · {g.count} on board</span>
      </div>

      <div className="mt-4 space-y-2.5">
        {[
          { label: 'WHO 24-h (15 µg/m³)', pct: whoPct },
          { label: 'NAAQS 24-h (60 µg/m³)', pct: naaqsPct },
        ].map((b) => (
          <div key={b.label}>
            <div className="flex items-center justify-between font-mono text-[0.6875rem]">
              <span className="text-muted">{b.label}</span>
              <span className={b.pct >= 1 ? 'text-bad' : ''}>{Math.round(b.pct * 100)}%</span>
            </div>
            <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(b.pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.name} dose against ${b.label}`}>
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(1, b.pct) * 100}%`, background: b.pct >= 1 ? 'var(--bad)' : b.pct > 0.6 ? 'var(--warn)' : 'var(--accent)' }} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 font-mono text-xs">
        <Timer size={12} className="text-muted" aria-hidden />
        {whoPct >= 1 ? <span className="text-bad">WHO daily limit passed</span> : <span>WHO limit in {Number.isFinite(minsToWho) ? hms(minsToWho * 60) : '—'}</span>}
      </p>
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-sm leading-snug">{advice?.text ?? ADVICE[id][risk].replace('{clean}', clean)}</p>
        {advice && <p className="mt-2"><ServiceChip name="Bedrock · Guardrails" /></p>}
      </div>
    </article>
  )
}

function WorstAir() {
  const coaches = useSim((s) => s.world.coaches)
  const ranked = coaches.map((c, i) => ({ c, i })).sort((a, b) => b.c.aqi - a.c.aqi).slice(0, 6)
  return (
    <Card title="Who is in the worst air right now" source="SIM">
      <ol className="divide-y divide-line">
        {ranked.map(({ c, i }, n) => {
          const sensitive = Math.round(c.occupancy * 0.31)
          return (
            <li key={i} className="flex items-center gap-3 py-2">
              <span className="w-5 font-mono text-xs text-muted">{String(n + 1).padStart(2, '0')}</span>
              <span className="w-10 font-mono text-sm font-semibold">{COACHES[i].code}</span>
              <span className="min-w-0 flex-1">
                <AqiBadge aqi={c.aqi} />
                <span className="block truncate text-xs text-muted">
                  {sensitive} sensitive of {c.occupancy} · {COACHES[i].kind}
                </span>
              </span>
              <span className="font-mono text-sm">{c.aqi}</span>
              {i === INSTRUMENTED && <SourceChip kind="SENSOR" />}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

const ALL_BANDS = [...BANDS, OFF_CHART]

function JourneyReceipt() {
  const e = useSim((s) => s.world.exposure)
  const t = useSim((s) => s.world.t)
  const aqi = useSim((s) => s.world.reading.aqi)
  const pm = useSim((s) => s.world.reading.pm25)
  const dose = e.dose.children / 1.5 // resting-adult dose
  const total = e.minutes || 1
  const worstBand = [...ALL_BANDS].reverse().find((b) => e.band[b.key] > 0)
  return (
    <Card title="Journey exposure receipt" source="SIM" actions={<Receipt size={14} className="text-muted" aria-hidden />}>
      <div className="mx-auto max-w-sm rounded-[5px] border border-dashed border-line-strong bg-bg p-4 font-mono text-xs">
        <p className="text-center text-sm font-semibold tracking-tight">{APP.name}</p>
        <p className="text-center text-muted">
          {APP.trainId} · coach {COACHES[INSTRUMENTED].code} · {clock(Math.max(0, t - e.minutes * 60))}–{clock(t)}
        </p>
        <div className="my-3 border-t border-dashed border-line-strong" />
        <dl className="space-y-1">
          {ALL_BANDS.map((b) => (
            <div key={b.key} className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5">
                <span className={clsx('h-2 w-2 rounded-[2px]', b.key === 'offchart' && 'hatched')} style={{ background: b.key === 'offchart' ? undefined : b.color }} />
                {b.label}
              </dt>
              <dd className="tnum">{fmt(e.band[b.key], 1)} min</dd>
            </div>
          ))}
        </dl>
        <div className="my-3 flex h-2 overflow-hidden rounded-full" aria-hidden>
          {ALL_BANDS.map((b) => (
            <span key={b.key} className={b.key === 'offchart' ? 'hatched' : ''} style={{ width: `${(e.band[b.key] / total) * 100}%`, background: b.key === 'offchart' ? undefined : b.color }} />
          ))}
        </div>
        <div className="my-3 border-t border-dashed border-line-strong" />
        <dl className="space-y-1">
          <div className="flex justify-between"><dt>Time on board</dt><dd>{hms(e.minutes * 60)}</dd></div>
          <div className="flex justify-between"><dt>Peak AQI</dt><dd>{e.peakAqi}</dd></div>
          <div className="flex justify-between"><dt>Now</dt><dd>AQI {aqi} · PM2.5 {pm}</dd></div>
          <div className="flex justify-between"><dt>Your PM2.5 dose</dt><dd>{fmt(dose)} µg·min/m³</dd></div>
          <div className="flex justify-between"><dt>= share of WHO day</dt><dd>{Math.round((dose / BUDGET.who) * 100)}%</dd></div>
        </dl>
        <div className="my-3 border-t border-dashed border-line-strong" />
        <p className="leading-snug">
          {worstBand && (worstBand.key === 'offchart' || worstBand.key === 'severe' || worstBand.key === 'verypoor')
            ? 'Advice: rest your lungs tonight — skip outdoor exercise and keep windows shut. Seek care if breathing is hard.'
            : 'Advice: an ordinary trip. No action needed.'}
        </p>
        <p className="mt-3 text-center text-[0.625rem] text-muted">Screenshot to keep · not medical advice</p>
      </div>
    </Card>
  )
}

export function ExposurePage() {
  const minutes = useSim((s) => s.world.exposure.minutes)
  const aqi = useSim((s) => s.world.reading.aqi)
  const atRisk = useSim((s) => GROUPS.filter((g) => riskFor(g, s.world.reading.aqi) !== 'low').reduce((a, g) => a + g.count, 0))
  return (
    <Section
      num="03"
      label="Exposure"
      title="Who is breathing the worst air right now?"
      lead={`Same air, different risk. Each group gets its own inhaled dose (PM2.5 × minutes × breathing factor), measured against the WHO guideline (${LIMITS.whoPm25} µg/m³) and India's NAAQS (${LIMITS.naaqsPm25} µg/m³) daily limits.`}
      aside={
        <div className="flex gap-6 rounded-card border border-line bg-surface px-4 py-3">
          <div>
            <p className="micro text-muted">Exposure minutes</p>
            <p className="font-mono text-2xl"><Tween value={minutes} decimals={1} /></p>
          </div>
          <div>
            <p className="micro text-muted">Passengers warned</p>
            <p className={clsx('font-mono text-2xl', atRisk > 0 && 'text-bad')}>{atRisk}</p>
          </div>
          <div>
            <p className="micro text-muted">Cabin</p>
            <div className="mt-1.5"><AqiBadge aqi={aqi} size="md" /></div>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" data-tour="groups">
        {GROUPS.map((g) => (
          <GroupCard key={g.id} id={g.id} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WorstAir />
        <JourneyReceipt />
      </div>
      <p className="mt-4 text-xs text-muted">
        Group counts and breathing factors are simulated. Staff dose starts with half a shift already logged and uses the rake average, because staff walk every coach.
      </p>
    </Section>
  )
}
