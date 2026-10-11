import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { animate, useReducedMotion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Cloud, Cpu, FlaskConical, OctagonAlert, ShieldAlert, ShieldCheck, Skull } from 'lucide-react'
import { bandInfo, bandOf } from '../../sim/aqi'

export type Source = 'SENSOR' | 'SIM'

export function SourceChip({ kind, className }: { kind: Source; className?: string }) {
  const sensor = kind === 'SENSOR'
  return (
    <span
      className={clsx(
        'micro inline-flex items-center gap-1 rounded-[4px] border border-line px-1.5 py-[1px] text-[0.625rem] leading-4 text-muted',
        className,
      )}
      title={sensor ? 'A signal the prototype hardware measures' : 'Modelled — the prototype does not measure this yet'}
    >
      {sensor ? <Cpu size={10} className="text-accent" aria-hidden /> : <FlaskConical size={10} aria-hidden />}
      {kind}
    </span>
  )
}

/** What each AWS service does in BreatheIQ — shown on hover, never an ARN. */
const SERVICE_ROLE: Record<string, string> = {
  'IoT Core': 'AWS IoT Core carries coach telemetry and relay commands over MQTT.',
  Lambda: 'AWS Lambda runs the frame processor, the model and the API.',
  SageMaker: 'Amazon SageMaker trained the four Random-Forest heads and keeps them in the Model Registry.',
  DynamoDB: 'Amazon DynamoDB stores telemetry, coach state, incidents, the interlock log and alerts.',
  EventBridge: 'Amazon EventBridge carries domain events such as AqiOffTheChart.',
  'Step Functions': 'AWS Step Functions runs the Bad Day playbook as a state machine.',
  Bedrock: 'Amazon Bedrock writes the text with a Claude model.',
  Guardrails: 'Bedrock Guardrails block diagnosis and medication advice and filter personal data.',
  'Knowledge Base': 'A Bedrock Knowledge Base answers from the standards and hardware documents, with citations.',
  Polly: 'Amazon Polly reads the announcement aloud in English and Hindi.',
  Translate: 'Amazon Translate adds one more regional language.',
  SNS: 'Amazon SNS sends staff email and passenger SMS.',
  S3: 'Amazon S3 stores audio, reports, training data and model artifacts.',
  Cognito: 'Amazon Cognito gives this page guest credentials and the operator sign-in.',
  Location: 'Amazon Location Service tracks the train and the route geofences.',
  CloudWatch: 'Amazon CloudWatch collects logs, metrics and alarms.',
  'API Gateway': 'Amazon API Gateway serves the dashboard API.',
  Amplify: 'AWS Amplify Hosting serves this dashboard.',
}

export function ServiceChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={clsx('micro inline-flex items-center gap-1 rounded-[4px] border border-line px-1.5 py-[1px] text-[0.625rem] leading-4 whitespace-nowrap text-muted', className)}
      title={name.split(' · ').map((n) => SERVICE_ROLE[n] ?? `AWS ${n}`).join(' ')}
    >
      <Cloud size={10} aria-hidden />
      {name}
    </span>
  )
}

export function Card({
  title, source, service, actions, children, className, bodyClass, id, as: Tag = 'section', tour,
}: {
  title?: ReactNode
  source?: Source
  /** AWS services behind this widget, e.g. 'Bedrock' or ['Step Functions', 'Polly'] */
  service?: string | string[]
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
  id?: string
  as?: 'section' | 'div' | 'article'
  tour?: string
}) {
  return (
    <Tag id={id} data-tour={tour} className={clsx('relative min-w-0 rounded-card border border-line bg-surface', className)}>
      {(title || source || service || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5">
          <h3 className="micro min-w-0 truncate text-muted">{title}</h3>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
            {(Array.isArray(service) ? service : service ? [service] : []).map((s) => <ServiceChip key={s} name={s} />)}
            {source && <SourceChip kind={source} />}
          </div>
        </header>
      )}
      <div className={clsx('p-4', bodyClass)}>{children}</div>
    </Tag>
  )
}

export function Section({
  num, label, title, lead, children, aside, id,
}: {
  num: string
  label: string
  title: ReactNode
  lead?: ReactNode
  children: ReactNode
  aside?: ReactNode
  id?: string
}) {
  return (
    <section id={id} className="py-10 sm:py-14">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="micro mb-3 text-accent">
            {num} / {label}
          </p>
          <h2 className="text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.5rem]">{title}</h2>
          {lead && <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-muted text-pretty">{lead}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Pill({ tone, children, icon }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'accent'; children: ReactNode; icon?: ReactNode }) {
  return (
    <span
      className={clsx(
        'micro inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[0.625rem] leading-4 whitespace-nowrap',
        tone === 'ok' && 'border-ok/40 bg-ok/10 text-ok',
        tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
        tone === 'bad' && 'border-bad/40 bg-bad/10 text-bad',
        tone === 'muted' && 'border-line-strong text-muted',
        tone === 'accent' && 'border-accent/40 bg-accent/10 text-accent',
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function StatusPill({ abnormal, labels = ['Normal', 'Abnormal'] }: { abnormal: boolean; labels?: [string, string] }) {
  return abnormal ? (
    <Pill tone="bad" icon={<AlertTriangle size={10} aria-hidden />}>{labels[1]}</Pill>
  ) : (
    <Pill tone="ok" icon={<CheckCircle2 size={10} aria-hidden />}>{labels[0]}</Pill>
  )
}

/** Colour + icon + label so the band never relies on colour alone. */
export function AqiBadge({ aqi, size = 'sm' }: { aqi: number; size?: 'sm' | 'md' }) {
  const b = bandInfo(aqi)
  const k = bandOf(aqi)
  const Icon = k === 'good' || k === 'satisfactory' ? ShieldCheck : k === 'moderate' ? ShieldAlert : k === 'offchart' ? Skull : k === 'severe' ? OctagonAlert : AlertTriangle
  return (
    <span className={clsx('inline-flex items-center gap-1.5 font-mono whitespace-nowrap', size === 'md' ? 'text-xs' : 'text-[0.6875rem]')}>
      <span
        className={clsx('inline-flex items-center justify-center rounded-[3px]', size === 'md' ? 'h-5 w-5' : 'h-4 w-4', k === 'offchart' && 'hatched')}
        style={{ background: b.color }}
        aria-hidden
      >
        <Icon size={size === 'md' ? 12 : 10} className={k === 'moderate' || k === 'satisfactory' ? 'text-black/80' : 'text-white'} />
      </span>
      <span className="uppercase tracking-[0.08em]">{b.label}</span>
    </span>
  )
}

export function Sparkline({ values, color = 'var(--accent)', height = 28, min, max, label }: {
  values: number[]
  color?: string
  height?: number
  min?: number
  max?: number
  label?: string
}) {
  const w = 120
  if (values.length < 2) return <div style={{ height }} aria-hidden />
  const lo = min ?? Math.min(...values)
  const hi = max ?? Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 2 - ((v - lo) / span) * (height - 4)}`)
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={label}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Number that tweens to its new value. */
export function Tween({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduce) {
      from.current = value
      return
    }
    const ctrl = animate(from.current, value, {
      duration: 0.6,
      ease: 'easeOut',
      onUpdate: (v) => {
        from.current = v
        setShown(v)
      },
    })
    return () => ctrl.stop()
  }, [value, reduce])
  return <span className={clsx('tnum', className)}>{(reduce ? value : shown).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>
}

export function Switch({ checked, onChange, label, disabled, size = 'md' }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  size?: 'md' | 'lg'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'lg' ? 'h-8 w-14' : 'h-5 w-9',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-2',
      )}
    >
      <span
        className={clsx(
          'inline-block rounded-full shadow transition-transform',
          size === 'lg' ? 'h-6 w-6' : 'h-3.5 w-3.5',
          checked ? (size === 'lg' ? 'translate-x-7 bg-accent-ink' : 'translate-x-[18px] bg-accent-ink') : 'translate-x-[3px] bg-muted',
        )}
      />
    </button>
  )
}

export function Button({
  children, onClick, variant = 'primary', icon, className, type = 'button', disabled, ariaLabel,
}: {
  children?: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: ReactNode
  className?: string
  type?: 'button' | 'submit'
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-card px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'secondary' && 'border border-line-strong bg-surface hover:border-accent/60 hover:text-accent',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'bg-[var(--aqi-verypoor)] text-white hover:brightness-110',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="scroll-thin -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'micro -mb-px border-b-2 px-3 py-2.5 whitespace-nowrap transition-colors',
            value === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="micro text-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl font-medium tracking-tight">
        {value}
        {unit && <span className="ml-1 text-sm text-muted">{unit}</span>}
      </p>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>
}
