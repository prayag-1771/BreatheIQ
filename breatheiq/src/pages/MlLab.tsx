import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Download, Pause, Play, RefreshCw } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useSim } from '../sim/engine'
import {
  HEADS, REGIMES, evaluate, featureRelevance, generateDataset, predict, splitDataset, toCsv, lcdResult,
  type HeadKey, type ModelInput, type Regime, type Row, type Thresholds, type Bit,
} from '../sim/model'
import { createWorld, stepWorld, ALERT_RULES, type World } from '../sim/core'
import { download } from '../lib/storage'
import { Button, Card, Pill, Section, SourceChip, Switch, Tabs } from '../components/ui/primitives'
import { CloudModelCard, MetricsTable, type ModelInfo } from '../components/ml/CloudModel'
import { ExplainButton, ExplainResult } from '../components/live/Explain'
import { toExplainPred, useExplain } from '../components/live/useExplain'
import { useCloud } from '../cloud/store'
import { api } from '../cloud/api'
import { usePoll } from '../lib/hooks'

type Tab = 'model' | 'whatif' | 'data' | 'replay'

// ── model card + metrics ─────────────────────────────────────────────
function useModel(seed: number, th: Thresholds) {
  return useMemo(() => {
    const rows = generateDataset(seed)
    const { train, test } = splitDataset(rows, seed)
    return { rows, train, test, metrics: evaluate(test, th), relevance: featureRelevance(rows) }
  }, [seed, th])
}

const FEATURE_COLOR = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

function ModelTab({ model, seed, onRetrain }: { model: ReturnType<typeof useModel>; seed: number; onRetrain: () => void }) {
  const cloud = useCloud((s) => s.config !== null)
  const info = usePoll(() => api.get<ModelInfo>('/model'), 60_000, cloud)
  const heads = info.data?.serving?.metrics?.heads
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {info.data ? <CloudModelCard info={info.data} onTrained={info.refresh} /> : <LocalModelCard model={model} seed={seed} onRetrain={onRetrain} />}

      {heads ? (
        <Card title="Per-head metrics · hold-out split" source="SENSOR" service={info.data?.serving?.source === 'sagemaker' ? 'SageMaker' : 'Lambda'} className="lg:col-span-8">
          <MetricsTable rows={HEADS.map((h) => ({ key: h.key, ...heads[h.key] }))} />
          <p className="mt-3 text-xs text-muted">
            The serving model, measured on the real TK172529.xlsx data: 80/20 split, random_state 42, exactly as final.py.
            {info.data?.serving?.source === 'sagemaker' ? ` Training job ${info.data.serving.jobName}.` : ''}
          </p>
        </Card>
      ) : (
        <Card title="Per-head metrics · hold-out split" source="SIM" className="lg:col-span-8">
          <MetricsTable rows={model.metrics} />
          <p className="mt-3 text-xs text-muted">Computed live by running the heads on the held-out rows. The ~2 % label noise in the data is why the scores are not all 100 %.</p>
        </Card>
      )}

      <Card title="Feature relevance per head" source="SIM" className="lg:col-span-6">
        <div className="space-y-3">
          {model.relevance.map((r) => {
            const h = HEADS.find((x) => x.key === r.head)!
            return (
              <div key={r.head}>
                <div className="flex justify-between text-xs">
                  <span>
                    <b className="font-mono">{h.letter}</b> <span className="text-muted">{h.feature} label</span>
                  </span>
                  <span className="font-mono text-muted">top: {[...r.values].sort((a, b) => b.share - a.share)[0].feature}</span>
                </div>
                <div className="mt-1 flex h-3 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={r.values.map((v) => `${v.feature} ${Math.round(v.share * 100)}%`).join(', ')}>
                  {r.values.map((v, i) => (
                    <span key={v.feature} title={`${v.feature}: ${Math.round(v.share * 100)}%`} style={{ width: `${v.share * 100}%`, background: FEATURE_COLOR[i] }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
          {['Temperature', 'Gas', 'CO2', 'Pms'].map((f, i) => (
            <span key={f} className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-[2px]" style={{ background: FEATURE_COLOR[i] }} />
              {f}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          Share of |correlation| between each feature and each label. In the training data heat, gases and CO₂ arrive together, so a joint model would lean on all three; the real script keeps one feature per head.
        </p>
      </Card>

      <Card title="Simplified trees" source="SIM" className="lg:col-span-6">
        <div className="grid grid-cols-2 gap-3">
          {HEADS.map((h) => (
            <TreeSvg key={h.key} head={h.key} />
          ))}
        </div>
      </Card>
    </div>
  )
}

/** Offline model card: the same heads in the browser, retrained on the synthetic set. */
function LocalModelCard({ model, seed, onRetrain }: { model: ReturnType<typeof useModel>; seed: number; onRetrain: () => void }) {
  const [training, setTraining] = useState<number | null>(null)
  const [log, setLog] = useState<string[]>([])
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearInterval(timer.current), [])

  const retrain = () => {
    if (training !== null) return
    setTraining(0)
    setLog(['Loading TK172529.xlsx (synthetic, 200 rows)…'])
    let p = 0
    timer.current = window.setInterval(() => {
      p += 2
      setTraining(p)
      if (p % 10 === 0) {
        const head = HEADS[Math.min(3, Math.floor(p / 25))]
        setLog((l) => [...l.slice(-5), `model_${HEADS.indexOf(head) + 1}.fit(X_train_${HEADS.indexOf(head) + 1}) · tree ${((p % 25) * 4) || 100}/100 · head ${head.letter}`])
      }
      if (p >= 100) {
        window.clearInterval(timer.current)
        setLog((l) => [...l.slice(-5), 'Done. Re-evaluated on the 20 % hold-out split.'])
        setTraining(null)
        onRetrain()
      }
    }, 100)
  }

  return (
    <Card title="Model card" source="SENSOR" className="lg:col-span-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {[
          ['Algorithm', 'RandomForestClassifier'],
          ['Trees', '100 per head (sklearn default)'],
          ['Heads', '4 binary · X Y Z W'],
          ['Features', 'Temperature · Gas · CO2 · Pms'],
          ['Wiring', 'One feature per head, as in final.py'],
          ['Rows', `${model.rows.length} (synthetic)`],
          ['Split', `${model.train.length} train / ${model.test.length} test · random_state 42`],
          ['Run', `seed ${seed}`],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="micro pt-0.5 text-muted">{k}</dt>
            <dd className="font-mono text-[0.8125rem]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5">
        <Button onClick={retrain} disabled={training !== null} icon={<RefreshCw size={14} className={training !== null ? 'spin' : ''} />} className="w-full">
          {training !== null ? `Training… ${training}%` : 'Retrain model'}
        </Button>
        {training !== null && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={training} aria-valuemin={0} aria-valuemax={100} aria-label="Training progress">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${training}%` }} />
          </div>
        )}
        {log.length > 0 && (
          <pre className="mt-3 overflow-hidden rounded-[5px] border border-line bg-bg p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-muted">{log.join('\n')}</pre>
        )}
      </div>
    </Card>
  )
}

// ── decision path illustration ──────────────────────────────────────
function TreeSvg({ head, input, th }: { head: HeadKey; input?: ModelInput; th?: Thresholds }) {
  const defTh = useSim((s) => s.thresholds)
  const t = th ?? defTh
  const h = HEADS.find((x) => x.key === head)!
  const digital = head === 'y' || head === 'z'
  const root = head === 'x' ? `Temp ≤ ${t.tempC.toFixed(1)}` : head === 'w' ? `Pms ≤ ${t.pm}` : `${h.feature} ≤ 0.5`
  const left = head === 'x' ? `Temp ≤ ${(t.tempC - 2).toFixed(1)}` : head === 'w' ? `Pms ≤ ${t.pm - 22}` : null
  const val = input ? (head === 'x' ? input.temp : head === 'w' ? input.pms : head === 'y' ? input.gas : input.co2) : null
  const thr = head === 'x' ? t.tempC : head === 'w' ? t.pm : 0.5
  const goLeft = val !== null && val <= thr
  // for digital heads, value 0 (detected) goes left → abnormal
  const leaves = digital
    ? [{ x: 40, label: '1 · abn', on: val !== null && goLeft }, { x: 120, label: '0 · ok', on: val !== null && !goLeft }]
    : [
        { x: 22, label: '0 · 99%', on: val !== null && goLeft && val <= thr - (head === 'x' ? 2 : 22) },
        { x: 68, label: '0 · 84%', on: val !== null && goLeft && val > thr - (head === 'x' ? 2 : 22) },
        { x: 132, label: '1 · 97%', on: val !== null && !goLeft },
      ]
  const hl = 'var(--accent)'
  const dim = 'var(--border-strong)'
  return (
    <figure className="rounded-card border border-line p-2">
      <figcaption className="micro mb-1 text-[0.5625rem] text-muted">
        Head {h.letter} · {h.feature}
      </figcaption>
      <svg viewBox="0 0 160 112" className="w-full" role="img" aria-label={`Decision tree for head ${h.letter}`}>
        <line x1={80} y1={20} x2={digital ? 40 : 45} y2={digital ? 86 : 52} stroke={val !== null && goLeft ? hl : dim} strokeWidth={val !== null && goLeft ? 2 : 1} />
        <line x1={80} y1={20} x2={digital ? 120 : 132} y2={86} stroke={val !== null && !goLeft ? hl : dim} strokeWidth={val !== null && !goLeft ? 2 : 1} />
        {!digital && (
          <>
            <line x1={45} y1={52} x2={22} y2={86} stroke={leaves[0].on ? hl : dim} strokeWidth={leaves[0].on ? 2 : 1} />
            <line x1={45} y1={52} x2={68} y2={86} stroke={leaves[1].on ? hl : dim} strokeWidth={leaves[1].on ? 2 : 1} />
            <rect x={14} y={44} width={62} height={16} rx={3} fill="var(--surface-2)" stroke={val !== null && goLeft ? hl : dim} />
            <text x={45} y={55} textAnchor="middle" fontSize="7.5" fill="var(--text)" fontFamily="var(--font-mono)">{left}</text>
          </>
        )}
        <rect x={40} y={10} width={80} height={18} rx={3} fill="var(--surface-2)" stroke={val !== null ? hl : dim} />
        <text x={80} y={22} textAnchor="middle" fontSize="8" fill="var(--text)" fontFamily="var(--font-mono)">{root}</text>
        {leaves.map((l) => (
          <g key={l.x}>
            <rect x={l.x - 20} y={86} width={40} height={16} rx={8} fill={l.on ? hl : 'var(--surface)'} stroke={l.on ? hl : dim} />
            <text x={l.x} y={97} textAnchor="middle" fontSize="7.5" fill={l.on ? 'var(--accent-ink)' : 'var(--muted)'} fontFamily="var(--font-mono)">{l.label}</text>
          </g>
        ))}
      </svg>
    </figure>
  )
}

// ── what-if ─────────────────────────────────────────────────────────
function WhatIfTab() {
  const th = useSim((s) => s.thresholds)
  const [temp, setTemp] = useState(29)
  const [pms, setPms] = useState(35)
  const [gas, setGas] = useState(false)
  const [co2, setCo2] = useState(false)
  const input: ModelInput = { temp, pms, gas: (gas ? 0 : 1) as Bit, co2: (co2 ? 0 : 1) as Bit }
  const p = predict(input, th)
  const lcd = lcdResult(p)
  const { result, busy, run, clear } = useExplain()
  const inputKey = `${temp}|${pms}|${input.gas}|${input.co2}|${th.tempC}|${th.pm}`
  const [explainedFor, setExplainedFor] = useState('')
  const explain = () => {
    setExplainedFor(inputKey)
    void run({ features: { temp, gas: input.gas, co2: input.co2, pms }, pred: toExplainPred(p), thresholds: th })
  }
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card title="Inputs" source="SIM" className="lg:col-span-4">
        <div className="space-y-5">
          <label className="block">
            <span className="flex justify-between text-sm">Temperature <span className="font-mono">{temp.toFixed(1)} °C</span></span>
            <input type="range" min={20} max={45} step={0.1} value={temp} onChange={(e) => setTemp(+e.target.value)} className="mt-2 w-full accent-[var(--accent)]" />
          </label>
          <label className="block">
            <span className="flex justify-between text-sm">PM (Pms) <span className="font-mono">{pms} µg/m³</span></span>
            <input type="range" min={0} max={250} step={1} value={pms} onChange={(e) => setPms(+e.target.value)} className="mt-2 w-full accent-[var(--accent)]" />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>MQ-2 detects gas <span className="font-mono text-xs text-muted">(Gas = {input.gas})</span></span>
            <Switch checked={gas} onChange={setGas} label="MQ-2 detects gas" />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span>MQ-135 detects CO₂ <span className="font-mono text-xs text-muted">(CO2 = {input.co2})</span></span>
            <Switch checked={co2} onChange={setCo2} label="MQ-135 detects CO2" />
          </label>
          <div className="rounded-card border border-line bg-surface-2 p-3 font-mono text-sm">
            <p className="micro text-muted">Frame</p>
            a{temp.toFixed(2)}b{input.gas}c{input.co2}d{pms}e
            <p className="micro mt-2 text-muted">Reply</p>t{p.x.value}u{p.y.value}v{p.z.value}x{p.w.value}y
          </div>
        </div>
      </Card>
      <div className="grid content-start gap-4 lg:col-span-8">
        <Card title="Live prediction" source="SIM" actions={<ExplainButton onClick={explain} busy={busy} />}>
          <div className="grid gap-3 sm:grid-cols-4">
            {HEADS.map((h) => {
              const r = p[h.key]
              return (
                <div key={h.key} className={clsx('rounded-card border p-3', r.value ? 'border-bad/50 bg-bad/10' : 'border-line')}>
                  <p className="flex items-center justify-between">
                    <span className="font-mono text-lg font-semibold">{h.letter}</span>
                    <Pill tone={r.value ? 'bad' : 'ok'}>{r.value}</Pill>
                  </p>
                  <p className="mt-1 text-xs text-muted">{h.feature}</p>
                  <p className="mt-2 font-mono text-2xl">{Math.round(r.conf * 100)}%</p>
                  <p className="text-[0.6875rem] text-muted">{Math.round(r.pAbnormal * 100)} of 100 trees vote abnormal</p>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-sm">
            LCD: <span className="font-mono">{lcd.join(' ')}</span> · Fan <b>{p.x.value ? 'ON' : 'off'}</b> · Ozone request <b>{p.y.value || p.z.value || p.w.value ? 'YES (interlock decides)' : 'no'}</b>
          </p>
          <ExplainResult result={explainedFor === inputKey ? result : null} onClose={clear} />
        </Card>
        <Card title="Decision paths" source="SIM">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {HEADS.map((h) => (
              <TreeSvg key={h.key} head={h.key} input={input} th={th} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Drag temperature near {th.tempC} °C or PM near {th.pm}: confidence falls as you approach the boundary.</p>
        </Card>
      </div>
    </div>
  )
}

// ── dataset explorer ────────────────────────────────────────────────
const COLS = ['Temperature', 'label_Temperature', 'Gas', 'label_Gas', 'CO2', 'label_CO2', 'Pms', 'label_Pms'] as const
type Col = (typeof COLS)[number] | 'id' | 'regime'

function DataTab({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'id', dir: 1 })
  const [regime, setRegime] = useState<Regime | 'all'>('all')
  const shown = useMemo(() => {
    const f = regime === 'all' ? rows : rows.filter((r) => r.regime === regime)
    return [...f].sort((a, b) => (a[sort.col] > b[sort.col] ? 1 : a[sort.col] < b[sort.col] ? -1 : 0) * sort.dir)
  }, [rows, sort, regime])
  const header = (c: Col, label: string = c) => (
    <th key={c} scope="col" aria-sort={sort.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className="sticky top-0 bg-surface px-2 py-2 text-right font-normal first:text-left">
      <button type="button" onClick={() => setSort({ col: c, dir: sort.col === c ? (-sort.dir as 1 | -1) : 1 })} className="micro inline-flex items-center gap-1 text-[0.5625rem] text-muted hover:text-ink">
        {label}
        {sort.col === c && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  )
  return (
    <Card
      title={`Training rows · ${shown.length} of ${rows.length}`}
      source="SIM"
      actions={
        <Button variant="secondary" className="!px-2 !py-1 text-xs" icon={<Download size={12} />} onClick={() => download('breatheiq-training.csv', toCsv(shown), 'text/csv')}>
          CSV
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by regime">
        {(['all', 'A', 'B', 'C'] as const).map((r) => (
          <button key={r} type="button" aria-pressed={regime === r} onClick={() => setRegime(r)} className={clsx('rounded-full border px-3 py-1 text-xs', regime === r ? 'border-accent text-accent' : 'border-line text-muted hover:text-ink')}>
            {r === 'all' ? 'All regimes' : `${r} · ${REGIMES[r]}`}
          </button>
        ))}
      </div>
      <div className="scroll-thin max-h-[480px] overflow-auto rounded-[5px] border border-line">
        <table className="w-full min-w-[720px] font-mono text-xs">
          <thead>
            <tr>
              {header('id', '#')}
              {header('regime', 'Regime')}
              {COLS.map((c) => header(c))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <td className="px-2 py-1.5 text-muted">{r.id}</td>
                <td className="px-2 py-1.5 text-right">{r.regime}</td>
                {COLS.map((c) => {
                  const v = r[c]
                  const isLabel = c.startsWith('label')
                  return (
                    <td key={c} className={clsx('px-2 py-1.5 text-right', isLabel && v === 1 && 'text-bad')}>
                      {v}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Same columns as TK172529.xlsx. Generated from three regimes with ~2 % label noise; no PM values fall between 61 and 99.</p>
    </Card>
  )
}

// ── replay ──────────────────────────────────────────────────────────
interface ReplayFrame {
  t: number
  aqi: number
  temp: number
  pm1: number
  gas: Bit
  co2: Bit
  pred: World['pred']
  fan: boolean
  ozReq: boolean
  ozOn: boolean
  lcd: [string, string]
}

function recordSession(): ReplayFrame[] {
  let w = createWorld(7)
  const inputs = {
    thresholds: { tempC: 34.5, pm: 80 }, mode: 'auto' as const, manual: { fan: false, oz1: false, oz2: false },
    rulesEnabled: Object.fromEntries(ALERT_RULES.map((r) => [r.id, true])), source: 'mock' as const,
  }
  const script: Record<number, 1 | 2 | 3 | 4 | 5 | 6 | 7> = { 15: 2, 80: 4, 140: 3, 200: 7 }
  const frames: ReplayFrame[] = []
  for (let i = 0; i < 300; i++) {
    if (script[i]) w = { ...w, scenario: { id: script[i], startedAt: w.t, sustain: false } }
    w = stepWorld(w, inputs, { quiet: true })
    frames.push({
      t: i * 2, aqi: w.reading.aqi, temp: w.reading.temp, pm1: w.reading.pm1, gas: w.reading.gas, co2: w.reading.co2,
      pred: w.pred, fan: w.act.fanOn, ozReq: w.act.oz1Req || w.act.oz2Req, ozOn: w.act.oz1On || w.act.oz2On, lcd: w.lcd,
    })
  }
  return frames
}

function ReplayTab() {
  const frames = useMemo(() => recordSession(), [])
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setI((n) => (n >= frames.length - 1 ? (setPlaying(false), n) : n + 1)), 120)
    return () => window.clearInterval(id)
  }, [playing, frames.length])
  const f = frames[i]
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card title="Recorded session · 10 min" source="SIM" className="lg:col-span-8">
        <div className="h-56" role="img" aria-label="AQI over the recorded ten-minute session">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={frames} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="t" tickFormatter={mmss} tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} stroke="var(--border)" minTickGap={40} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} stroke="var(--border)" />
              <Tooltip labelFormatter={(v) => mmss(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 7, fontSize: 12 }} />
              <ReferenceLine y={500} stroke="var(--aqi-verypoor)" strokeDasharray="4 4" />
              <Area dataKey="aqi" name="AQI" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.12} isAnimationActive={false} />
              <ReferenceLine x={f.t} stroke="var(--text)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" ariaLabel={playing ? 'Pause replay' : 'Play replay'} onClick={() => { if (i >= frames.length - 1) setI(0); setPlaying(!playing) }} icon={playing ? <Pause size={14} /> : <Play size={14} />} />
          <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(+e.target.value) }} className="flex-1 accent-[var(--accent)]" aria-label="Scrub through the session" />
          <span className="w-14 text-right font-mono text-sm">{mmss(f.t)}</span>
        </div>
        <p className="mt-2 text-xs text-muted">Script: platform rush at 00:30, smoke at 02:40, heat wave at 04:40, everything at once at 06:40.</p>
      </Card>
      <Card title={`Frame at ${mmss(f.t)}`} source="SIM" className="lg:col-span-4">
        <p className="font-mono text-sm break-all">a{f.temp.toFixed(2)}b{f.gas}c{f.co2}d{f.pm1}e</p>
        <p className="mt-1 font-mono text-3xl font-semibold">AQI {f.aqi}</p>
        <ul className="mt-3 space-y-1.5">
          {HEADS.map((h) => (
            <li key={h.key} className="flex items-center justify-between text-sm">
              <span><b className="font-mono">{h.letter}</b> <span className="text-muted">{h.feature}</span></span>
              <Pill tone={f.pred[h.key].value ? 'bad' : 'ok'}>{f.pred[h.key].value} · {Math.round(f.pred[h.key].conf * 100)}%</Pill>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone={f.fan ? 'accent' : 'muted'}>Fan {f.fan ? 'on' : 'off'}</Pill>
          <Pill tone={f.ozOn ? 'accent' : f.ozReq ? 'warn' : 'muted'}>Ozone {f.ozOn ? 'on' : f.ozReq ? 'blocked' : 'off'}</Pill>
        </div>
        <p className="mt-3 rounded-card border border-line bg-surface-2 px-3 py-2 font-mono text-sm">{f.lcd.join(' ')}</p>
      </Card>
    </div>
  )
}

export function MlLabPage() {
  const [tab, setTab] = useState<Tab>('model')
  const [seed, setSeed] = useState(42)
  const th = useSim((s) => s.thresholds)
  const model = useModel(seed, th)
  return (
    <Section
      num="04"
      label="ML Lab"
      title="Four small forests, one clear answer."
      lead="The four Random-Forest heads from final.py: trained on SageMaker, served from Lambda, and re-expressed here in the browser. Poke them, retrain them, and replay a recorded session."
      aside={<SourceChip kind="SIM" />}
    >
      <Tabs
        label="ML Lab sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'model', label: 'Model & metrics' },
          { id: 'whatif', label: 'What-if lab' },
          { id: 'data', label: 'Dataset explorer' },
          { id: 'replay', label: 'Replay' },
        ]}
      />
      <div className="mt-5" role="tabpanel">
        {tab === 'model' && <ModelTab model={model} seed={seed} onRetrain={() => setSeed((s) => s + 1)} />}
        {tab === 'whatif' && <WhatIfTab />}
        {tab === 'data' && <DataTab rows={model.rows} />}
        {tab === 'replay' && <ReplayTab />}
      </div>
    </Section>
  )
}
