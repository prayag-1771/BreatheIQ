/** The Bad Day playbook as it ran on AWS: Step Functions history and what each step produced. */
import clsx from 'clsx'
import { CheckCircle2, CircleDashed, ExternalLink, Mail, MessageSquare, XCircle } from 'lucide-react'
import { api, type CallMeta } from '../../cloud/api'
import { useCloud } from '../../cloud/store'
import { usePoll } from '../../lib/hooks'
import { Button, Card, Empty, Pill, ServiceChip } from '../ui/primitives'

interface CloudIncident {
  id: string
  status: 'open' | 'closed'
  trigger: string
  startedAt: number
  endedAt?: number
  station: string
  aqi: number
  peakAqi: number
  worstCoach: string
  cleanCoach: string
  announcement?: { en: string; hi: string; sms: Record<string, string>; staff: string; meta: CallMeta }
  audio?: Record<'en' | 'hi', { voice?: string; error?: string } | undefined>
  audioUrl: { en: string | null; hi: string | null }
  sns?: { email: { messageId?: string; error?: string } | null; sms: { to: string; messageId?: string; error?: string }[]; smsNote?: string }
  translation?: { language: string; text?: string; error?: string }
  reportUrl: string | null
  reportMeta?: CallMeta
}

interface PlaybookView {
  stateMachine: string
  executions: { arn: string; name: string; status: string; startedAt?: number; endedAt?: number }[]
  selected?: string
  states: { name: string; enteredAt?: number; exitedAt?: number; status: string }[]
}

const LANG: Record<string, string> = { bn: 'Bengali', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', kn: 'Kannada', ml: 'Malayalam' }
const ist = (t?: number) => (t ? new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : '—')
const short = (id?: string) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '—')

// presigned URLs change on every poll; keep the first one so a playing clip is not restarted
const stable = new Map<string, { url: string; at: number }>()
function stableUrl(key: string, url: string | null) {
  if (!url) return null
  const hit = stable.get(key)
  if (hit && Date.now() - hit.at < 50 * 60_000) return hit.url
  stable.set(key, { url, at: Date.now() })
  return url
}

/** Consecutive loop iterations (wait → check → choice) collapse into one row with a count. */
function collapse(states: PlaybookView['states']) {
  const rows: { name: string; count: number; enteredAt?: number; exitedAt?: number; status: string }[] = []
  for (const s of states) {
    const row = rows.find((r) => r.name === s.name)
    if (row) {
      row.count += 1
      row.exitedAt = s.exitedAt ?? row.exitedAt
      row.status = s.status
    } else rows.push({ ...s, count: 1 })
  }
  return rows
}

function ExecutionCard({ pb }: { pb: PlaybookView | null }) {
  const latest = pb?.executions[0]
  return (
    <Card title="Step Functions · bad-day-playbook" service="Step Functions" className="lg:col-span-5">
      {!latest ? (
        <Empty>No playbook run on AWS yet. It starts by itself when EventBridge sees AqiOffTheChart.</Empty>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-xs" title={latest.name}>{latest.name}</p>
            <Pill tone={latest.status === 'SUCCEEDED' ? 'ok' : latest.status === 'RUNNING' ? 'accent' : 'bad'}>{latest.status}</Pill>
          </div>
          <p className="mt-1 font-mono text-[0.6875rem] text-muted">
            Started {ist(latest.startedAt)}{latest.endedAt ? ` · ended ${ist(latest.endedAt)}` : ''}
          </p>
          <ol className="relative mt-4 space-y-3 border-l border-line pl-5">
            {collapse(pb.states).map((s) => (
              <li key={s.name} className="relative">
                <span className="absolute top-0.5 -left-[27px] bg-surface">
                  {s.status === 'running' ? (
                    <CircleDashed size={14} className="spin text-accent" aria-label="Running" />
                  ) : s.status === 'failed' ? (
                    <XCircle size={14} className="text-bad" aria-label="Failed" />
                  ) : (
                    <CheckCircle2 size={14} className="text-ok" aria-label="Done" />
                  )}
                </span>
                <p className="text-sm font-medium">
                  {s.name}
                  {s.count > 1 && <span className="ml-1.5 font-mono text-xs text-muted">×{s.count}</span>}
                </p>
                <p className="font-mono text-[0.6875rem] text-muted">
                  {ist(s.enteredAt)}
                  {s.exitedAt && s.enteredAt && s.count === 1 ? ` · ${((s.exitedAt - s.enteredAt) / 1000).toFixed(1)} s` : ''}
                </p>
              </li>
            ))}
          </ol>
          {pb.executions.length > 1 && <p className="mt-4 text-xs text-muted">{pb.executions.length} runs recorded. Showing the latest.</p>}
        </>
      )}
    </Card>
  )
}

function WriterChips({ meta }: { meta?: CallMeta }) {
  if (meta?.engine === 'bedrock') {
    return (
      <span className="flex flex-wrap gap-1.5">
        <ServiceChip name="Bedrock" />
        <ServiceChip name="Guardrails" />
      </span>
    )
  }
  return <span className="font-mono text-[0.625rem] text-muted">Written from the incident record</span>
}

function AnnouncementCard({ inc }: { inc: CloudIncident }) {
  const a = inc.announcement
  if (!a) return null
  const clip = (lang: 'en' | 'hi') => stableUrl(`${inc.id}/${lang}`, inc.audioUrl[lang])
  return (
    <Card title="Platform announcement · English + Hindi" service="Polly">
      <div className="mb-3"><WriterChips meta={a.meta} /></div>
      {(['en', 'hi'] as const).map((lang) => {
        const url = clip(lang)
        return (
          <div key={lang} className="border-t border-line py-3 first:border-t-0 first:pt-0">
            <p className="micro mb-1 text-muted">{lang === 'en' ? 'English · en-IN' : 'हिन्दी · hi-IN'}</p>
            <p className="text-sm leading-relaxed" lang={lang}>{a[lang]}</p>
            {url ? (
              <audio controls preload="none" src={url} className="mt-2 h-9 w-full" aria-label={`Announcement audio, ${lang === 'en' ? 'English' : 'Hindi'}`} />
            ) : (
              <p className="mt-2 text-xs text-warn">{inc.audio?.[lang]?.error ?? 'Audio is being generated.'}</p>
            )}
          </div>
        )
      })}
      <p className="mt-1 text-xs text-muted">Read by Amazon Polly (neural voice {inc.audio?.en?.voice ?? 'Kajal'}), stored in S3.</p>
    </Card>
  )
}

function NotifyCard({ inc }: { inc: CloudIncident }) {
  const sns = inc.sns
  return (
    <Card title="Staff and passenger alerts" service="SNS">
      {!sns ? (
        <Empty>Sending…</Empty>
      ) : (
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Mail size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              Staff email{' '}
              {sns.email?.messageId ? <span className="font-mono text-xs text-ok">sent · {short(sns.email.messageId)}</span> : <span className="text-xs text-warn">{sns.email?.error ?? 'not sent'}</span>}
            </span>
          </li>
          {sns.sms.map((m) => (
            <li key={m.to} className="flex items-start gap-2">
              <MessageSquare size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0">
                SMS {m.to}{' '}
                {m.messageId ? <span className="font-mono text-xs text-ok">sent · {short(m.messageId)}</span> : <span className="text-xs text-warn">{m.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {inc.announcement?.sms?.respiratory && (
        <p className="mt-3 rounded-card border border-line bg-surface-2 p-2 text-xs leading-snug">{inc.announcement.sms.respiratory}</p>
      )}
    </Card>
  )
}

function TranslateCard({ inc }: { inc: CloudIncident }) {
  const t = inc.translation
  return (
    <Card title={`Regional language · ${t ? LANG[t.language] ?? t.language : '…'}`} service="Translate">
      {t?.text ? <p className="text-sm leading-relaxed" lang={t.language}>{t.text}</p> : <Empty>Translating…</Empty>}
    </Card>
  )
}

function ReportCard({ inc }: { inc: CloudIncident }) {
  return (
    <Card title="Incident report" service={inc.reportMeta?.engine === 'bedrock' ? ['Bedrock', 'S3'] : 'S3'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p>
            <span className="font-mono text-xs text-muted">{inc.id}</span> · {inc.status === 'open' ? 'open' : `closed ${ist(inc.endedAt)}`} · peak AQI {inc.peakAqi}
          </p>
          <p className="text-xs text-muted">
            {inc.reportUrl
              ? inc.reportMeta?.engine === 'bedrock'
                ? `Written by Amazon Bedrock (${inc.reportMeta.modelId}).`
                : 'Written from the incident record.'
              : 'The report is written when the incident closes.'}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<ExternalLink size={14} />}
          disabled={!inc.reportUrl}
          onClick={() => inc.reportUrl && window.open(inc.reportUrl, '_blank', 'noopener')}
        >
          Export incident report
        </Button>
      </div>
    </Card>
  )
}

export function CloudPlaybook() {
  const enabled = useCloud((s) => s.config !== null)
  const incidents = usePoll(() => api.get<{ incidents: CloudIncident[] }>('/incidents'), 5000, enabled)
  const playbook = usePoll(() => api.get<PlaybookView>('/playbook'), 4000, enabled)
  if (!enabled) return null
  const inc = incidents.data?.incidents[0] ?? null
  return (
    <div className="mt-10">
      <p className="micro mb-3 text-accent">On AWS · EventBridge → Step Functions → Bedrock → Polly → SNS → Translate</p>
      <div className="grid gap-4 lg:grid-cols-12">
        <ExecutionCard pb={playbook.data} />
        <div className={clsx('grid content-start gap-4 lg:col-span-7')}>
          {inc ? (
            <>
              <AnnouncementCard inc={inc} />
              {inc.translation?.text ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <NotifyCard inc={inc} />
                  <TranslateCard inc={inc} />
                </div>
              ) : (
                <NotifyCard inc={inc} />
              )}
              <ReportCard inc={inc} />
            </>
          ) : (
            <Card title="Incident" service="DynamoDB">
              <Empty>No incident recorded on AWS yet. Press 7 or switch Bad Day Mode on: the coach's AQI passes 500, EventBridge starts the playbook, and its output appears here.</Empty>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
