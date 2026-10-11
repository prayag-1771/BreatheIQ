/** ML Lab on AWS: the model served by Lambda, its SageMaker training job, metrics and retraining. */
import { useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, CircleDashed, RefreshCw, XCircle } from 'lucide-react'
import { api } from '../../cloud/api'
import { usePoll } from '../../lib/hooks'
import { HEADS, type HeadKey } from '../../sim/model'
import { Button, Card, Pill } from '../ui/primitives'

export interface HeadMetric {
  key: HeadKey
  accuracy: number
  precision: number
  recall: number
  f1: number
  tp?: number
  fp?: number
  tn?: number
  fn?: number
}

export interface ModelInfo {
  pointer: { version: string; jobName: string; artifact: string; modelPackageArn?: string; trainedAt?: number } | null
  jobs: { name: string; status: string; createdAt?: number; endedAt?: number }[]
  serving: {
    modelVersion: string
    source: 'sagemaker' | 'bootstrap'
    jobName: string | null
    artifact: string | null
    metrics: { rows: number; heads: Record<HeadKey, Omit<HeadMetric, 'key'>> } | null
  } | null
  registryGroup: string
  instanceType: string
}

interface JobStatus {
  name: string
  status: 'InProgress' | 'Completed' | 'Failed' | 'Stopping' | 'Stopped'
  secondaryStatus: string
  failureReason?: string
  createdAt?: number
  endedAt?: number
  billableSeconds?: number
  transitions: { status: string; at?: number; message?: string }[]
  version?: string
}

export function Confusion({ tp, fp, tn, fn }: { tp: number; fp: number; tn: number; fn: number }) {
  const max = Math.max(tp, fp, tn, fn, 1)
  const cell = (v: number, label: string, good: boolean) => (
    <div
      className="flex aspect-[1.6] flex-col items-center justify-center rounded-[4px] border border-line"
      style={{ background: `color-mix(in srgb, ${good ? 'var(--accent)' : 'var(--bad)'} ${Math.round((v / max) * 45)}%, transparent)` }}
      title={`${label}: ${v}`}
    >
      <span className="font-mono text-base font-semibold">{v}</span>
      <span className="micro text-[0.5rem] text-muted">{label}</span>
    </div>
  )
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-1 text-[0.625rem]">
      <span />
      <span className="micro text-center text-[0.5625rem] text-muted">Pred 0</span>
      <span className="micro text-center text-[0.5625rem] text-muted">Pred 1</span>
      <span className="micro pr-1 text-[0.5625rem] text-muted">True 0</span>
      {cell(tn, 'TN', true)}
      {cell(fp, 'FP', false)}
      <span className="micro pr-1 text-[0.5625rem] text-muted">True 1</span>
      {cell(fn, 'FN', false)}
      {cell(tp, 'TP', true)}
    </div>
  )
}

export function MetricsTable({ rows }: { rows: HeadMetric[] }) {
  return (
    <>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="micro text-left text-muted">
              <th className="py-2 font-normal">Head</th>
              <th className="py-2 font-normal">Actuator</th>
              {['Accuracy', 'Precision', 'Recall', 'F1'].map((h) => (
                <th key={h} className="py-2 text-right font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono">
            {rows.map((m) => {
              const h = HEADS.find((x) => x.key === m.key)!
              return (
                <tr key={m.key}>
                  <td className="py-2">
                    <span className="font-semibold">{h.letter}</span> <span className="font-sans text-muted">{h.feature}</span>
                  </td>
                  <td className="py-2 font-sans text-xs text-muted">{h.actuator}</td>
                  {[m.accuracy, m.precision, m.recall, m.f1].map((v, i) => (
                    <td key={i} className="py-2 text-right">{(v * 100).toFixed(1)}%</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.every((m) => m.tp !== undefined) && (
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          {rows.map((m) => (
            <div key={m.key}>
              <p className="micro mb-1.5 text-muted">Head {HEADS.find((x) => x.key === m.key)!.letter}</p>
              <Confusion tp={m.tp!} fp={m.fp!} tn={m.tn!} fn={m.fn!} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

const ago = (t?: number) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))} s ago` : '')
const at = (t?: number) => (t ? new Date(t).toLocaleTimeString('en-IN', { hour12: false }) : '—')

function JobProgress({ s }: { s: JobStatus }) {
  const running = s.status === 'InProgress' || s.status === 'Stopping'
  return (
    <div className="mt-3 rounded-[5px] border border-line bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-mono text-[0.6875rem]" title={s.name}>{s.name}</p>
        <Pill tone={s.status === 'Completed' ? 'ok' : s.status === 'Failed' ? 'bad' : 'accent'}>{s.status === 'InProgress' ? s.secondaryStatus : s.status}</Pill>
      </div>
      <ol className="mt-2 space-y-1">
        {s.transitions.map((t, i) => {
          const current = running && i === s.transitions.length - 1
          return (
            <li key={`${t.status}-${i}`} className="flex items-start gap-2 text-xs">
              {current ? (
                <CircleDashed size={13} className="mt-0.5 shrink-0 spin text-accent" aria-hidden />
              ) : t.status === 'Failed' || t.status === 'Stopped' ? (
                <XCircle size={13} className="mt-0.5 shrink-0 text-bad" aria-hidden />
              ) : (
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" aria-hidden />
              )}
              <span className="min-w-0">
                <span className="font-medium">{t.status}</span> <span className="font-mono text-muted">{at(t.at)}</span>
                {t.message && <span className="block truncate text-muted" title={t.message}>{t.message}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      {running && <p className="mt-2 text-xs text-muted">A training job takes a few minutes: SageMaker starts an instance, trains the four heads, then uploads the model.</p>}
      {s.status === 'Completed' && (
        <p className="mt-2 text-xs text-ok">Done in {s.billableSeconds ?? '—'} billable seconds. {s.version ? `Now serving ${s.version}.` : ''}</p>
      )}
      {s.failureReason && <p className="mt-2 text-xs text-bad">{s.failureReason}</p>}
    </div>
  )
}

export function CloudModelCard({ info, onTrained }: { info: ModelInfo; onTrained: () => void }) {
  const [job, setJob] = useState<string | null>(() => info.jobs.find((j) => j.status === 'InProgress')?.name ?? null)
  const [doneJob, setDoneJob] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const finished = job !== null && doneJob === job
  const status = usePoll(async () => {
    const r = await api.get<JobStatus>('/model/job', { name: job ?? '' })
    if (['Completed', 'Failed', 'Stopped'].includes(r.status)) {
      setDoneJob(r.name)
      if (r.status === 'Completed') onTrained()
    }
    return r
  }, 10_000, job !== null && !finished)
  const s = status.data?.name === job ? status.data : null

  const retrain = async () => {
    setStarting(true)
    setNote(null)
    try {
      const r = await api.post<{ started: boolean; job: string; reason?: string }>('/model/retrain', {})
      setJob(r.job)
      if (!r.started && r.reason) setNote(r.reason)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not start the training job.')
    } finally {
      setStarting(false)
    }
  }

  const serving = info.serving
  const sagemaker = serving?.source === 'sagemaker'
  // retraining is offered once SageMaker training has run on this account
  const canRetrain = sagemaker || info.jobs.length > 0
  const pkg = info.pointer?.modelPackageArn?.split('/').slice(-2).join('/')
  const rows: [string, string][] = [
    ['Version', serving?.modelVersion ?? '—'],
    ['Served by', 'Lambda · exported decision trees'],
    ...(sagemaker
      ? ([['Training job', info.pointer?.jobName ?? '—'], ['Artifact', info.pointer?.artifact ?? '—'], ['Registry', pkg ?? info.registryGroup], ['Instance', info.instanceType]] as [string, string][])
      : ([['Trained', 'at deploy, as final.py does']] as [string, string][])),
    ['Data', `TK172529.xlsx · ${serving?.metrics?.rows ?? 200} rows`],
    ['Split', '80 / 20 · random_state 42'],
  ]
  const running = job !== null && !finished
  return (
    <Card title="Model card" source="SENSOR" service={sagemaker ? ['SageMaker', 'Lambda'] : 'Lambda'} className="lg:col-span-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="micro pt-0.5 text-muted">{k}</dt>
            <dd className="truncate font-mono text-[0.8125rem]" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      {canRetrain && (
      <div className="mt-5">
        <Button onClick={() => void retrain()} disabled={starting || running} icon={<RefreshCw size={14} className={running || starting ? 'spin' : ''} />} className="w-full">
          {starting ? 'Starting a training job…' : running ? 'Training on SageMaker…' : 'Retrain model'}
        </Button>
        {note && <p className="mt-2 text-xs text-muted">{note}</p>}
        {status.error && running && <p className="mt-2 text-xs text-warn">Could not read the job status: {status.error}</p>}
        {s && <JobProgress s={s} />}
        {!s && running && <p className={clsx('mt-2 text-xs text-muted', 'pulse-soft')}>Asking SageMaker for the job status… {ago(info.jobs[0]?.createdAt)}</p>}
      </div>
      )}
    </Card>
  )
}
