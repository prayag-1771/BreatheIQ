import clsx from 'clsx'
import { CheckCircle2, Hand, ShieldAlert, ShieldCheck, ShieldOff, Users, Bot } from 'lucide-react'
import { CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { useMemo, useState, type FormEvent } from 'react'
import { useSim, clock } from '../sim/engine'
import { ALERT_RULES } from '../sim/core'
import { generateDataset } from '../sim/model'
import { LIMITS } from '../sim/aqi'
import { Button, Card, Empty, Pill, Section, Switch } from '../components/ui/primitives'
import { useCloud } from '../cloud/store'
import { api } from '../cloud/api'
import { signIn, signOut } from '../cloud/auth'
import { hydrateControl } from '../cloud/commands'
import { usePoll } from '../lib/hooks'
import { ActuatorCard } from '../components/live/MlCards'

const ist = (ts: number) => new Date(ts).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })

/** Cognito user-pool sign-in. The operator role is what lets these settings reach the coach. */
function OperatorCard() {
  const cfg = useCloud((s) => s.config)
  const role = useCloud((s) => s.role)
  const setCloud = useCloud((s) => s.set)
  const [user, setUser] = useState('operator')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!cfg) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(cfg, user, password)
      setCloud({ role: 'operator' })
      setPassword('')
      await hydrateControl()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  if (role === 'operator') {
    return (
      <Card title="Operator" service="Cognito">
        <p className="text-sm">
          Signed in as <b>operator</b>. Mode, relays, boundaries, rules and the cabin flag are saved to DynamoDB and reach coach B2 within seconds.
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => { signOut(); setCloud({ role: 'guest' }) }}>
          Sign out
        </Button>
      </Card>
    )
  }
  return (
    <Card title="Operator sign-in" service="Cognito">
      <form onSubmit={(e) => void submit(e)} className="grid gap-2">
        <label className="text-xs">
          <span className="text-muted">Username</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" className="mt-1 w-full rounded-card border border-line bg-bg px-2 py-1.5 font-mono text-sm" />
        </label>
        <label className="text-xs">
          <span className="text-muted">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1 w-full rounded-card border border-line bg-bg px-2 py-1.5 font-mono text-sm" />
        </label>
        <Button type="submit" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        {error && <p className="text-xs text-warn" role="alert">{error}</p>}
      </form>
      <p className="mt-3 text-xs text-muted">Anyone can watch, run scenarios and switch Bad Day Mode. The settings on this page stay in this browser until an operator signs in.</p>
    </Card>
  )
}

function ModeCard() {
  const mode = useSim((s) => s.mode)
  const manual = useSim((s) => s.manual)
  const setMode = useSim((s) => s.setMode)
  const setManual = useSim((s) => s.setManual)
  const act = useSim((s) => s.world.act)
  return (
    <Card title="Control mode" source="SENSOR">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Control mode">
        {(['auto', 'manual'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={clsx('flex items-center gap-2 rounded-card border px-3 py-3 text-left', mode === m ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong')}
          >
            {m === 'auto' ? <Bot size={18} aria-hidden /> : <Hand size={18} aria-hidden />}
            <span>
              <span className="block text-sm font-medium capitalize">{m}</span>
              <span className="block text-xs text-muted">{m === 'auto' ? 'ML heads drive the relays' : 'You drive the relays'}</span>
            </span>
          </button>
        ))}
      </div>
      <ul className={clsx('mt-4 divide-y divide-line', mode === 'auto' && 'opacity-60')}>
        {(
          [
            ['fan', 'Exhaust fan', 'Pin 26'],
            ['oz1', 'Ozone generator 1', 'Pin 53 · interlocked'],
            ['oz2', 'Ozone generator 2', 'Pin 51 · interlocked'],
          ] as const
        ).map(([k, name, sub]) => {
          const blocked = k !== 'fan' && manual[k] && !(k === 'oz1' ? act.oz1On : act.oz2On) && mode === 'manual'
          return (
            <li key={k} className="flex items-center justify-between gap-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">{name}</span>
                <span className="block font-mono text-[0.6875rem] text-muted">{sub}</span>
                {blocked && <span className="mt-0.5 block text-xs text-warn">Interlock is holding this off — see why on the right.</span>}
              </span>
              <Switch checked={mode === 'manual' ? manual[k] : k === 'fan' ? act.fanOn : k === 'oz1' ? act.oz1Req : act.oz2Req} onChange={(v) => setManual(k, v)} label={`${name} manual switch`} disabled={mode === 'auto'} />
            </li>
          )
        })}
      </ul>
      {mode === 'auto' && <p className="mt-2 text-xs text-muted">Switch to Manual to drive relays by hand. The interlock still applies.</p>}
    </Card>
  )
}

function InterlockCard() {
  const il = useSim((s) => s.world.interlock)
  const act = useSim((s) => s.world.act)
  const occ = useSim((s) => Math.round(s.world.latent.occ))
  const setOverride = useSim((s) => s.setOccupiedOverride)
  const t = useSim((s) => s.world.t)
  const live = useCloud((s) => s.status === 'live')
  const remote = usePoll(() => api.get<{ events: { sk: number; ts: number; gen: number; verdict: string; reason: string }[] }>('/interlock'), 5000, live)
  const cloudLog = live ? remote.data?.events ?? null : null
  const req = act.oz1Req || act.oz2Req
  const allowed = !il.occupied && il.ppm8h < LIMITS.ozonePpm8h
  const pct = Math.min(1, il.ppm / 0.12)
  const limitPct = LIMITS.ozonePpm8h / 0.12
  return (
    <Card title="Ozone safety interlock" source="SIM" service={cloudLog ? 'DynamoDB' : undefined} tour="interlock">
      <div className="flex items-start gap-3">
        <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-card border', allowed ? 'border-ok/50 bg-ok/10 text-ok' : 'border-warn/50 bg-warn/10 text-warn')}>
          {allowed ? <ShieldCheck size={22} /> : <ShieldOff size={22} />}
        </span>
        <div>
          <p className="font-medium">{allowed ? 'Ozone permitted' : 'Ozone locked out'}</p>
          <p className="text-sm text-muted">
            {req
              ? allowed
                ? 'ML requested ozone · ALLOWED — cabin empty and O₃ under limit.'
                : `ML requested ozone · BLOCKED by interlock (${il.occupied ? 'cabin occupied' : 'O₃ at limit'}). Fan + filtration instead.`
              : 'No ozone request from the model right now.'}
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-2 text-sm">
        <li className="flex items-center justify-between gap-3 rounded-card border border-line px-3 py-2">
          <span className="flex items-center gap-2">
            <Users size={15} className="text-muted" aria-hidden />
            <span>
              <span className="font-medium">a.</span> Cabin unoccupied or vestibule-only
              <span className="block text-xs text-muted">{il.occupiedOverride ? 'Operator flagged cabin as empty' : `${occ} passengers on board (SIM occupancy)`}</span>
            </span>
          </span>
          {il.occupied ? <Pill tone="warn">Fail</Pill> : <Pill tone="ok" icon={<CheckCircle2 size={10} />}>Pass</Pill>}
        </li>
        <li className="flex items-center justify-between gap-3 rounded-card border border-line px-3 py-2">
          <span>
            <span className="font-medium">b.</span> Est. ozone under {LIMITS.ozonePpm8h} ppm (8-h avg)
            <span className="block font-mono text-xs text-muted">8-h avg {il.ppm8h.toFixed(3)} ppm · now {il.ppm.toFixed(3)} ppm</span>
          </span>
          {il.ppm8h < LIMITS.ozonePpm8h ? <Pill tone="ok" icon={<CheckCircle2 size={10} />}>Pass</Pill> : <Pill tone="bad">Fail</Pill>}
        </li>
      </ol>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="micro text-muted">Estimated ozone</p>
          <p className="font-mono text-sm">{il.ppm.toFixed(3)} ppm</p>
        </div>
        <div className="relative mt-2 h-3 rounded-full bg-surface-2" role="meter" aria-valuenow={il.ppm} aria-valuemin={0} aria-valuemax={0.12} aria-label="Estimated ozone concentration">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%`, background: il.ppm > LIMITS.ozonePpm8h ? 'var(--bad)' : 'var(--accent)' }} />
          <div className="absolute -top-1 -bottom-1 w-0.5 bg-bad" style={{ left: `${limitPct * 100}%` }} aria-hidden />
          <span className="absolute -bottom-5 -translate-x-1/2 font-mono text-[0.625rem] text-bad" style={{ left: `${limitPct * 100}%` }}>
            0.07 EPA
          </span>
        </div>
      </div>

      <label className="mt-8 flex items-center justify-between gap-3 rounded-card border border-dashed border-line-strong px-3 py-2.5 text-sm">
        <span>
          Flag cabin as unoccupied
          <span className="block text-xs text-muted">Depot clean / terminal turnaround. Ozone may run.</span>
        </span>
        <Switch checked={il.occupiedOverride} onChange={setOverride} label="Flag cabin as unoccupied" />
      </label>

      <div className="mt-5">
        <p className="micro mb-2 text-muted">Event log{cloudLog ? ' · InterlockLog table' : ''}</p>
        {cloudLog ? (
          cloudLog.length === 0 ? (
            <Empty>No ozone requests recorded on the coach yet. Press 4 or 5 to make the model ask for one.</Empty>
          ) : (
            <ul className="scroll-thin max-h-56 space-y-1 overflow-y-auto pr-1 font-mono text-xs" aria-live="polite">
              {cloudLog.map((e) => (
                <li key={e.sk} className="flex gap-2 rounded-[4px] px-2 py-1 odd:bg-surface-2">
                  <span className="text-muted">{ist(e.ts)}</span>
                  <span className="text-muted">O₃{e.gen}</span>
                  <span className={e.verdict === 'blocked' ? 'text-warn' : e.verdict === 'allowed' ? 'text-ok' : 'text-muted'}>{e.verdict.toUpperCase()}</span>
                  <span className="truncate text-muted">{e.reason}</span>
                </li>
              ))}
            </ul>
          )
        ) : il.log.length === 0 ? (
          <Empty>No ozone requests yet. Press 4 or 5 to make the model ask for one.</Empty>
        ) : (
          <ul className="scroll-thin max-h-56 space-y-1 overflow-y-auto pr-1 font-mono text-xs" aria-live="polite">
            {[...il.log].reverse().map((e) => (
              <li key={e.id} className="flex gap-2 rounded-[4px] px-2 py-1 odd:bg-surface-2">
                <span className="text-muted">{clock(e.t)}</span>
                <span className="text-muted">O₃{e.gen}</span>
                <span className={e.verdict === 'blocked' ? 'text-warn' : e.verdict === 'allowed' ? 'text-ok' : 'text-muted'}>{e.verdict.toUpperCase()}</span>
                <span className="truncate text-muted">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">{cloudLog ? 'Times in IST, as written by the frame processor.' : `On-board time ${clock(t)}.`} CARB and US EPA warn that ozone generators are hazardous in occupied spaces; this lock exists because of that.</p>
      </div>
    </Card>
  )
}

function ThresholdCard() {
  const th = useSim((s) => s.thresholds)
  const setTh = useSim((s) => s.setThresholds)
  const r = useSim((s) => s.world.reading)
  const rows = useMemo(() => generateDataset(42), [])
  const live = useCloud((s) => s.status === 'live')
  const pts = rows.map((d) => ({ x: d.Temperature, y: d.Pms, z: 1, abn: d.label_Temperature || d.label_Pms }))
  const tick = { fill: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }
  return (
    <Card title="Decision boundary editor" source="SENSOR">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="flex items-center justify-between text-sm">
            Temperature boundary (head X)
            <span className="font-mono">{th.tempC.toFixed(1)} °C</span>
          </span>
          <input type="range" min={30} max={38} step={0.1} value={th.tempC} onChange={(e) => setTh({ tempC: +e.target.value })} className="mt-2 w-full accent-[var(--accent)]" />
        </label>
        <label className="block">
          <span className="flex items-center justify-between text-sm">
            PM boundary (head W)
            <span className="font-mono">{th.pm} µg/m³</span>
          </span>
          <input type="range" min={40} max={140} step={1} value={th.pm} onChange={(e) => setTh({ pm: +e.target.value })} className="mt-2 w-full accent-[var(--accent)]" />
        </label>
      </div>
      <div className="mt-4 h-60" role="img" aria-label="Scatter of training rows by temperature and PM with the decision boundaries">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
            <ReferenceArea x1={th.tempC} x2={41} fill="var(--aqi-verypoor)" fillOpacity={0.06} />
            <ReferenceArea y1={th.pm} y2={210} fill="var(--aqi-verypoor)" fillOpacity={0.06} />
            <XAxis type="number" dataKey="x" name="Temperature" unit="°C" domain={[24, 41]} tick={tick} stroke="var(--border)" />
            <YAxis type="number" dataKey="y" name="Pms" domain={[0, 210]} tick={tick} stroke="var(--border)" />
            <ZAxis dataKey="z" range={[22, 22]} />
            <ReferenceLine x={th.tempC} stroke="var(--accent)" strokeWidth={2} />
            <ReferenceLine y={th.pm} stroke="var(--accent)" strokeWidth={2} />
            <Tooltip cursor={false} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 7, fontSize: 12 }} />
            <Scatter name="Normal rows" data={pts.filter((p) => !p.abn)} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            <Scatter name="Abnormal rows" data={pts.filter((p) => p.abn)} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={1} shape="diamond" isAnimationActive={false} />
            <Scatter name="Cabin now" data={[{ x: r.temp, y: r.pm1, z: 1 }]} fill="var(--text)" shape="star" isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--series-1)]" />Training row · normal</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 bg-[var(--series-2)]" />Training row · abnormal</span>
        <span className="flex items-center gap-1.5"><span className="text-ink">★</span>Cabin right now</span>
      </div>
      <p className="mt-2 text-xs text-muted">The training data has no PM values between 61 and 99, so any boundary in that gap fits it equally well. Moving it changes how early the purifiers wake up.</p>
      {live && (
        <p className="mt-2 text-xs text-muted">
          On AWS, coach B2 is classified by the SageMaker-trained forest. These boundaries drive the what-if heads and the coach simulator, and are saved to DynamoDB when an operator is signed in.
        </p>
      )}
    </Card>
  )
}

function RulesCard() {
  const enabled = useSim((s) => s.rulesEnabled)
  const setRule = useSim((s) => s.setRule)
  const states = useSim((s) => s.world.rules)
  const alerts = useSim((s) => s.world.alerts)
  const live = useCloud((s) => s.status === 'live')
  const remote = usePoll(() => api.get<{ events: { sk: number; ts: number; text: string }[] }>('/alerts'), 5000, live)
  const cloudAlerts = live ? remote.data?.events ?? null : null
  return (
    <Card title="Alert rules" source="SIM" service={cloudAlerts ? 'DynamoDB' : undefined}>
      <ul className="divide-y divide-line">
        {ALERT_RULES.map((r) => {
          const st = states[r.id]
          return (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className={clsx('h-2 w-2 shrink-0 rounded-full', st.firing ? 'bg-bad pulse-soft' : 'bg-line-strong')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="text-muted">If</span> {r.when} <span className="text-muted">→</span> <span className="font-medium">{r.then}</span>
                </p>
                <p className="font-mono text-[0.6875rem] text-muted">
                  {st.firing ? 'FIRING · ' : ''}
                  {st.lastFired !== null ? `last fired ${clock(st.lastFired)} · ${st.count}×` : 'not fired yet'}
                </p>
              </div>
              <Switch checked={enabled[r.id] !== false} onChange={(v) => setRule(r.id, v)} label={`Rule: ${r.when}`} />
            </li>
          )
        })}
      </ul>
      <p className="micro mt-4 mb-2 text-muted">Recent alerts{cloudAlerts ? ' · Alerts table' : ''}</p>
      {cloudAlerts ? (
        cloudAlerts.length === 0 ? (
          <Empty>Quiet so far on the coach. Rules fire as soon as their condition holds long enough.</Empty>
        ) : (
          <ul className="scroll-thin max-h-40 space-y-1 overflow-y-auto font-mono text-xs">
            {cloudAlerts.slice(0, 20).map((a) => (
              <li key={a.sk} className="flex gap-2">
                <span className="text-muted">{ist(a.ts)}</span>
                <span className="truncate">{a.text}</span>
              </li>
            ))}
          </ul>
        )
      ) : alerts.length === 0 ? (
        <Empty>Quiet so far. Rules fire as soon as their condition holds long enough.</Empty>
      ) : (
        <ul className="scroll-thin max-h-40 space-y-1 overflow-y-auto font-mono text-xs">
          {[...alerts].reverse().slice(0, 20).map((a) => (
            <li key={a.id} className="flex gap-2">
              <span className="text-muted">{clock(a.t)}</span>
              <span className="truncate">{a.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function ControlsPage() {
  return (
    <Section
      num="05"
      label="Controls"
      title="The model suggests. The interlock decides."
      lead="Drive the relays by hand, move the decision boundaries, and see exactly when — and why — ozone is refused."
      aside={
        <Pill tone="muted" icon={<ShieldAlert size={10} />}>
          Ozone runs only in empty cabins
        </Pill>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4">
          <OperatorCard />
          <ModeCard />
          <ActuatorCard />
        </div>
        <InterlockCard />
        <div className="grid content-start gap-4">
          <RulesCard />
        </div>
      </div>
      <div className="mt-4">
        <ThresholdCard />
      </div>
    </Section>
  )
}
