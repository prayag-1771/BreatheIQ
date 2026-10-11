/** Signed calls to the dashboard API and the streamed "Ask BreatheIQ" endpoint. */
import { loadConfig } from './config'
import { getCredentials } from './auth'
import { signedHeaders } from './sigv4'

export interface CallMeta {
  engine: 'bedrock' | 'template'
  useCase?: string
  modelId?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  guardrail?: 'applied' | 'intervened' | 'none'
  cached?: boolean
  error?: string
}

async function call<T>(method: 'GET' | 'POST', path: string, query?: Record<string, string | number | undefined>, body?: unknown): Promise<T> {
  const cfg = await loadConfig()
  if (!cfg) throw new Error('offline')
  const u = new URL(cfg.apiUrl.replace(/\/$/, '') + path)
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const headers = await signedHeaders({ method, url: u.toString(), body: payload, service: 'execute-api', region: cfg.region, creds: await getCredentials(cfg) })
  const r = await fetch(u, { method, headers, body: payload })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? j.message ?? `API ${r.status}`)
  return j as T
}

export const api = {
  get: <T,>(path: string, query?: Record<string, string | number | undefined>) => call<T>('GET', path, query),
  post: <T,>(path: string, body: unknown) => call<T>('POST', path, undefined, body),
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'citation'; title: string; snippet: string }
  | { type: 'guardrail' }
  | { type: 'done'; meta: CallMeta }

/** POST the question to the chat Function URL and hand each NDJSON event to `onEvent` as it arrives. */
export async function askStream(message: string, sessionId: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
  const cfg = await loadConfig()
  if (!cfg) throw new Error('offline')
  const body = JSON.stringify({ message, sessionId })
  const headers = await signedHeaders({ method: 'POST', url: cfg.chatUrl, body, service: 'lambda', region: cfg.region, creds: await getCredentials(cfg) })
  const r = await fetch(cfg.chatUrl, { method: 'POST', headers, body, signal })
  if (!r.ok || !r.body) throw new Error(`Chat ${r.status}`)
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as ChatEvent)
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as ChatEvent)
}
