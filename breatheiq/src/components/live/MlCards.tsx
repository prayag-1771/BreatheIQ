import clsx from 'clsx'
import { Fan, Info, ShieldAlert, Wind } from 'lucide-react'
import { useSim } from '../../sim/engine'
import { HEADS } from '../../sim/model'
import { hms } from '../../lib/format'
import { Card, Pill } from '../ui/primitives'
import { useCloud } from '../../cloud/store'
import { APP } from '../../config'
import { ExplainButton, ExplainResult } from './Explain'
import { toExplainPred, useExplain } from './useExplain'

export function PredictionCard() {
  const pred = useSim((s) => s.world.pred)
  const lcd = useSim((s) => s.world.lcd)
  const model = useCloud((s) => (s.status === 'live' ? s.frame?.model ?? null : null))
  const { result, busy, run, clear } = useExplain()
  const explain = () => {
    const s = useSim.getState()
    const r = s.world.reading
    void run({ features: { temp: r.temp, gas: r.gas, co2: r.co2, pms: r.pm1 }, pred: toExplainPred(s.world.pred), thresholds: s.thresholds })
  }
  return (
    <Card title="Random Forest · 4 heads" source="SENSOR" service={model ? (model.version === 'rf-bootstrap' ? 'Lambda' : 'SageMaker') : undefined} tour="ml">
      <ul className="space-y-2.5">
        {HEADS.map((h) => {
          const p = pred[h.key]
          const on = p.value === 1
          return (
            <li key={h.key} className="flex items-center gap-3">
              <span
                className={clsx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-card border font-mono text-sm font-semibold',
                  on ? 'border-bad/60 bg-bad/15 text-bad' : 'border-line bg-surface-2 text-muted',
                )}
                aria-hidden
              >
                {h.letter}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{h.feature}</p>
                  {/* toggle-looking indicator */}
                  <span
                    className={clsx('relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors', on ? 'border-bad bg-bad' : 'border-line-strong bg-surface-2')}
                    role="img"
                    aria-label={`${h.letter} prediction ${p.value}`}
                  >
                    <span className={clsx('h-2.5 w-2.5 rounded-full bg-white transition-transform', on ? 'translate-x-[13px]' : 'translate-x-[2px] opacity-60')} />
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${p.conf * 100}%`, background: on ? 'var(--bad)' : 'var(--accent)' }} />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-[0.6875rem] text-muted">
                    {Math.round(p.conf * 100)}% · {p.value}
                  </span>
                </div>
                <p className={clsx('mt-0.5 text-xs', on ? 'text-bad' : 'text-muted')}>{on ? h.abnormal : h.normal}</p>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 rounded-card border border-line bg-surface-2 px-3 py-2">
        <p className="micro text-muted">LCD verdict · priority T → G → CO₂ → Dust</p>
        <p className="mt-0.5 font-mono text-sm">
          {lcd[0]} {lcd[1]}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-[0.6875rem] text-muted" title={model ? 'The four heads, served by a Lambda' : 'The same four heads, running in this browser'}>
          {model ? `Model: ${model.version} · Lambda · ${model.inferenceMs} ms` : 'Model: 4 heads · in this browser'}
        </p>
        <ExplainButton onClick={explain} busy={busy} />
      </div>
      <ExplainResult result={result} onClose={clear} />
    </Card>
  )
}

export function ActuatorCard() {
  const act = useSim((s) => s.world.act)
  const occupied = useSim((s) => s.world.interlock.occupied)
  const command = useCloud((s) => (s.status === 'live' ? s.frame?.command ?? null : null))
  const blocked = (act.oz1Req && !act.oz1On) || (act.oz2Req && !act.oz2On)
  const rows = [
    {
      name: 'Exhaust fan',
      pin: 'D26',
      on: act.fanOn,
      state: act.fanOn ? `${act.fanRpm.toLocaleString('en-IN')} rpm` : 'Off',
      detail: act.fanReason,
      runtime: act.runtime.fan,
      icon: <Fan size={22} className={act.fanOn ? 'spin text-accent' : 'text-muted'} style={{ ['--spin-dur' as string]: act.fanRpm > 2000 ? '0.35s' : '0.8s' }} aria-hidden />,
    },
    ...([1, 2] as const).map((g) => {
      const req = g === 1 ? act.oz1Req : act.oz2Req
      const on = g === 1 ? act.oz1On : act.oz2On
      return {
        name: `Ozone generator ${g}`,
        pin: g === 1 ? 'D53' : 'D51',
        on,
        state: on ? 'On' : req ? 'Blocked' : 'Off',
        detail: on ? 'Interlock allowed — cabin unoccupied' : req ? `ML requested · blocked (${occupied ? 'cabin occupied' : 'O₃ limit'})` : g === 1 ? 'Requested by heads Z or W' : 'Requested by heads Y or W',
        runtime: g === 1 ? act.runtime.oz1 : act.runtime.oz2,
        icon: <Wind size={22} className={on ? 'pulse-soft text-accent' : req ? 'text-warn' : 'text-muted'} aria-hidden />,
      }
    }),
  ]
  return (
    <Card title="Actuators · relays" source="SENSOR" service={command ? 'IoT Core' : undefined} tour="actuators">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3">
            <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-card border', r.on ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface-2')}>{r.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {r.name}
                  <span className="group relative inline-flex">
                    <Info size={12} className="text-muted" tabIndex={0} aria-label={`Relay on pin ${r.pin}, active-low`} />
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-52 -translate-x-1/2 rounded-card border border-line-strong bg-surface p-2 text-xs font-normal text-muted shadow-xl group-focus-within:block group-hover:block">
                      Relay on pin {r.pin}, <b className="text-ink">active-low</b>: <code className="font-mono">digitalWrite({r.pin.slice(1)}, LOW)</code> switches it on, HIGH switches it off.
                    </span>
                  </span>
                </p>
                {r.state === 'Blocked' ? (
                  <Pill tone="warn" icon={<ShieldAlert size={10} aria-hidden />}>Blocked</Pill>
                ) : (
                  <Pill tone={r.on ? 'accent' : 'muted'}>{r.state}</Pill>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted" title={r.detail}>
                {r.detail}
              </p>
              <p className="font-mono text-[0.625rem] text-muted">Runtime {hms(r.runtime)}</p>
            </div>
          </li>
        ))}
      </ul>
      {blocked && (
        <p className="mt-4 flex gap-2 rounded-card border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" role="status">
          <ShieldAlert size={14} className="shrink-0" aria-hidden />
          <span>
            ML requested ozone · <b>BLOCKED by interlock</b> ({occupied ? 'cabin occupied' : 'ozone near limit'}). Falling back to fan + filtration.
          </span>
        </p>
      )}
      {command && (
        <p className="mt-3 truncate font-mono text-[0.6875rem] text-muted" title={APP.commandTopic}>
          Command <span className="text-accent">{command}</span> ← {APP.commandTopic}
        </p>
      )}
    </Card>
  )
}
