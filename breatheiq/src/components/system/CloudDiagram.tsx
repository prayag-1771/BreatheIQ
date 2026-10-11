/** System → Cloud: the AWS pipeline, node by node, with live numbers from CloudWatch and DynamoDB. */
import { useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { api, type CallMeta } from '../../cloud/api'
import { useCloud } from '../../cloud/store'
import { usePoll, useNow } from '../../lib/hooks'
import { Card, ServiceChip } from '../ui/primitives'

export interface CloudMetrics {
  at: number
  iot: { messagesPerMin: number | null; topic: string }
  lambda: { processP50Ms: number | null; processPerMin: number | null; processErrors5m: number | null; inferenceP50Ms: number | null }
  dynamodb: { framesProcessed: number; incidents: number; lastWriteAt: number | null }
  bedrock: (CallMeta & { at: number }) | null
  stepFunctions: { name: string; status: string; startedAt?: number; endedAt?: number } | null
  model: { version: string; inferenceMs: number } | null
  device: { name: string; coach: string; lastFrameAt: number | null }
}

interface CloudNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  title: string
  service: string
  role: string
  live: (m: CloudMetrics | null, now: number) => string
}

const n = (v: number | null | undefined, unit = '', d = 0) => (v === null || v === undefined ? '—' : `${v.toFixed(d)}${unit}`)
const since = (t: number | null | undefined, now: number) => (t ? `${Math.max(0, Math.round((now - t) / 1000))} s ago` : '—')

const NODES: CloudNode[] = [
  { id: 'sched', x: 10, y: 20, w: 160, h: 50, title: 'EventBridge Scheduler', service: 'EventBridge', role: 'Invokes the device simulator once a minute; each run publishes 30 frames, one every 2 s.', live: () => 'rate(1 minute)' },
  { id: 'sim', x: 10, y: 100, w: 160, h: 58, title: 'device-simulator', service: 'Lambda', role: 'The active device for coach B2: a cloud simulator running the same engine as this page, publishing a…e frames plus humidity, PM2.5, PM10 and occupancy.', live: (m, now) => `last frame ${since(m?.device.lastFrameAt, now)}` },
  { id: 'iot', x: 215, y: 100, w: 160, h: 58, title: 'AWS IoT Core', service: 'IoT Core', role: 'One thing per coach with an X.509 certificate and policy. Telemetry and command topics over MQTT; an IoT Rule routes every frame to the processor.', live: (m) => `${n(m?.iot.messagesPerMin)} msg/min` },
  { id: 'proc', x: 420, y: 100, w: 175, h: 58, title: 'process-frame', service: 'Lambda', role: 'Calls the model, computes CPCB AQI, applies the ozone interlock and alert rules, writes DynamoDB, publishes the t…y command and raises events.', live: (m) => `p50 ${n(m?.lambda.processP50Ms, ' ms')}` },
  { id: 'infer', x: 640, y: 20, w: 170, h: 58, title: 'rf-inference', service: 'Lambda', role: 'Serves the four Random-Forest heads as exported decision trees: the same predictions as scikit-learn, with a fast cold start.', live: (m) => `${m?.model?.version ?? '—'} · p50 ${n(m?.lambda.inferenceP50Ms, ' ms')}` },
  { id: 'sm', x: 850, y: 20, w: 140, h: 58, title: 'SageMaker', service: 'SageMaker', role: 'Training job on TK172529.xlsx writes model.tar.gz and metrics to S3 and registers the model. No always-on endpoint.', live: () => 'training job' },
  { id: 'ddb', x: 640, y: 100, w: 170, h: 58, title: 'DynamoDB', service: 'DynamoDB', role: 'Telemetry (24-hour TTL), coach state, incidents, the interlock log and alerts. On-demand capacity.', live: (m) => `${m?.dynamodb.framesProcessed ?? '—'} frames · ${m?.dynamodb.incidents ?? '—'} incidents` },
  { id: 'eb', x: 640, y: 185, w: 170, h: 50, title: 'EventBridge', service: 'EventBridge', role: 'Domain events: AqiOffTheChart, OzoneBlocked, RuleFired, IncidentClosed. AqiOffTheChart starts the playbook.', live: () => 'AqiOffTheChart' },
  { id: 'sfn', x: 850, y: 185, w: 140, h: 50, title: 'Step Functions', service: 'Step Functions', role: 'The Bad Day playbook as a state machine: announce, speak, notify, translate, save, wait for recovery, report.', live: (m) => m?.stepFunctions?.status ?? 'idle' },
  { id: 'bedrock', x: 850, y: 260, w: 140, h: 50, title: 'Bedrock', service: 'Bedrock', role: 'Announcements in English and Hindi, group advice, decision explanations and incident reports, with Guardrails.', live: (m) => (m?.bedrock?.engine === 'bedrock' ? `${n(m.bedrock.latencyMs, ' ms')} · ${m.bedrock.outputTokens ?? 0} tok` : 'announcements · reports') },
  { id: 'media', x: 850, y: 335, w: 140, h: 58, title: 'Polly · SNS', service: 'Polly · SNS · Translate', role: 'Polly reads the announcement aloud (MP3 to S3), SNS alerts staff and passengers, Translate adds Bengali.', live: () => 'Translate · bn' },
  { id: 'cognito', x: 10, y: 255, w: 160, h: 50, title: 'Cognito', service: 'Cognito', role: 'Identity pool: guest credentials that can only subscribe to the coach topics and call the API. User pool: the operator login.', live: () => (useCloud.getState().role === 'operator' ? 'operator' : 'guest') },
  { id: 'dash', x: 215, y: 250, w: 160, h: 58, title: 'This dashboard', service: 'Amplify', role: 'Hosted on AWS Amplify. Reads frames from IoT Core over a signed WebSocket and falls back to its local engine if AWS is out of reach.', live: () => (useCloud.getState().status === 'live' ? 'live from IoT Core' : 'local engine') },
  { id: 'api', x: 420, y: 250, w: 175, h: 58, title: 'API Gateway', service: 'API Gateway', role: 'HTTP API with IAM auth, backed by a Lambda: history, incidents, interlock log, controls, model and playbook status.', live: () => 'HTTP API · Lambda' },
  { id: 'agent', x: 420, y: 345, w: 175, h: 58, title: 'Bedrock Agent', service: 'Bedrock', role: 'Ask BreatheIQ: action groups over DynamoDB, a Knowledge Base on S3 Vectors, and a grounding Guardrail.', live: () => 'Ask BreatheIQ' },
  { id: 'loc', x: 10, y: 345, w: 160, h: 58, title: 'Location Service', service: 'Location', role: 'A tracker for the train and geofences for the haze belt, tunnel and yards; ENTER events trigger pre-emptive ventilation.', live: () => 'tracker · 4 geofences' },
  { id: 'cw', x: 640, y: 345, w: 170, h: 58, title: 'CloudWatch · Budgets', service: 'CloudWatch', role: 'Logs, metrics, a dashboard and alarms (errors, latency, silent telemetry), plus a monthly cost budget.', live: (m) => `errors 5 min: ${n(m?.lambda.processErrors5m)}` },
]

// `back`: drawn left to right so its label reads normally, with the arrow at the start
const EDGES: { id: string; d: string; label?: string; dashed?: boolean; flow?: boolean; back?: boolean }[] = [
  { id: 'c-sched', d: 'M90 70 L 90 100' },
  { id: 'c-sim', d: 'M170 129 L 215 129', label: 'MQTT', flow: true },
  { id: 'c-rule', d: 'M375 129 L 420 129', label: 'rule', flow: true },
  { id: 'c-infer', d: 'M595 115 C 618 115, 616 49, 640 49', flow: true },
  { id: 'c-ddb', d: 'M595 129 L 640 129', flow: true },
  { id: 'c-eb', d: 'M595 143 C 618 143, 616 210, 640 210' },
  { id: 'c-sfn', d: 'M810 210 L 850 210' },
  { id: 'c-bedrock', d: 'M920 235 L 920 260' },
  { id: 'c-media', d: 'M920 310 L 920 335' },
  { id: 'c-model', d: 'M810 49 L 850 49', dashed: true, label: 'model', back: true },
  { id: 'c-ws', d: 'M295 158 L 295 250', label: 'WebSocket', flow: true },
  { id: 'c-creds', d: 'M170 280 L 215 280' },
  { id: 'c-api', d: 'M375 279 L 420 279' },
  { id: 'c-agent', d: 'M295 308 C 295 374, 380 374, 420 374' },
]

export function CloudDiagram() {
  const enabled = useCloud((s) => s.config !== null)
  const frames = useCloud((s) => s.frames)
  const live = useCloud((s) => s.status === 'live')
  const metrics = usePoll(() => api.get<CloudMetrics>('/metrics'), 10_000, enabled)
  const bedrock = usePoll(() => api.get<{ agent: boolean }>('/bedrock'), 60_000, enabled)
  const nodes = NODES.map((x) => (x.id === 'agent' && !bedrock.data?.agent
    ? { ...x, title: 'Ask BreatheIQ', service: 'Lambda', role: 'Answers operator questions from the live coach data in DynamoDB and the Knowledge Base documents, with sources, streamed from a Lambda function URL.', live: () => 'live data + docs' }
    : x))
  const now = useNow(1000)
  const reduce = useReducedMotion()
  const [active, setActive] = useState('proc')
  const m = metrics.data
  const node = nodes.find((x) => x.id === active)!
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="scroll-thin -mx-4 overflow-x-auto px-4 lg:col-span-9">
        <svg viewBox="0 0 1000 410" className="min-w-[760px]" role="group" aria-label="AWS architecture from the coach to the dashboard">
          <defs>
            <marker id="carrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--border-strong)" />
            </marker>
          </defs>
          {EDGES.map((e) => (
            <g key={e.id}>
              <path id={e.id} d={e.d} fill="none" stroke={e.dashed ? 'var(--border-strong)' : 'var(--accent)'} strokeOpacity={e.dashed ? 1 : 0.45} strokeWidth={1.5} className={e.dashed || !live ? undefined : 'dash-flow'} strokeDasharray={e.dashed ? '4 5' : undefined} markerStart={e.back ? 'url(#carrow)' : undefined} markerEnd={e.back ? undefined : 'url(#carrow)'} />
              {e.label && (
                <text fontSize="9.5" fill="var(--muted)" fontFamily="var(--font-mono)" dy={-4}>
                  <textPath href={`#${e.id}`} startOffset="50%" textAnchor="middle">{e.label}</textPath>
                </text>
              )}
            </g>
          ))}
          {live && !reduce &&
            EDGES.filter((e) => e.flow).map((e, i) => (
              <circle key={`${e.id}-${frames}`} r={3.5} fill="var(--accent)">
                <animateMotion dur="1.2s" begin={`${i * 0.15}s`} fill="freeze" repeatCount="1">
                  <mpath href={`#${e.id}`} />
                </animateMotion>
              </circle>
            ))}
          {nodes.map((x) => (
            <g
              key={x.id}
              role="button"
              tabIndex={0}
              aria-label={`${x.title}: ${x.role}`}
              aria-pressed={active === x.id}
              onMouseEnter={() => setActive(x.id)}
              onFocus={() => setActive(x.id)}
              onClick={() => setActive(x.id)}
              className="cursor-pointer outline-none"
            >
              <rect x={x.x} y={x.y} width={x.w} height={x.h} rx={7} fill="var(--surface)" stroke={active === x.id ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={active === x.id ? 2 : 1} />
              <text x={x.x + 12} y={x.y + 20} fontSize="12" fontWeight={600} fill="var(--text)">{x.title}</text>
              <text x={x.x + 12} y={x.y + 37} fontSize="10" fill={enabled ? 'var(--accent)' : 'var(--muted)'} fontFamily="var(--font-mono)">
                {x.live(m, now)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <Card title="Service" className="lg:col-span-3">
        <p className="text-lg font-semibold tracking-tight">{node.title}</p>
        <div className="mt-1.5"><ServiceChip name={node.service} /></div>
        <p className="mt-2 text-sm text-muted">{node.role}</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="micro text-muted">Right now</dt>
            <dd className="font-mono text-[0.8125rem]">{node.live(m, now)}</dd>
          </div>
          {node.id === 'bedrock' && m?.bedrock?.engine === 'bedrock' && (
            <div>
              <dt className="micro text-muted">Last call</dt>
              <dd className="font-mono text-[0.8125rem]">
                {m.bedrock.useCase} · {m.bedrock.modelId}
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-xs text-muted">{enabled ? `Numbers refresh every 10 s · ${since(m?.at, now)}` : 'Live numbers appear when the page reaches AWS.'}</p>
      </Card>
    </div>
  )
}
