/**
 * Amazon Bedrock access for every use case. Model IDs, guardrail and agent IDs live in
 * SSM Parameter Store under /breatheiq/bedrock/ — nothing is hard-coded here.
 *
 * Every call returns `{ ok }` instead of throwing, so callers can fall back to a written
 * template and a tick never waits on, or fails because of, a model call.
 */
import { BedrockRuntimeClient, ConverseCommand, type Message, type ToolConfiguration } from '@aws-sdk/client-bedrock-runtime'
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { doc, T, TRAIN_ID } from './shared'

const runtime = new BedrockRuntimeClient({})
const ssm = new SSMClient({})
const PREFIX = '/breatheiq/bedrock/'

export interface BedrockConfig {
  fastModel?: string
  strongModel?: string
  guardrailId?: string
  guardrailVersion?: string
  agentId?: string
  agentAliasId?: string
  kbId?: string
}

let cfg: BedrockConfig | null = null
let cfgAt = 0
let refusedUntil = 0
let refusedWhy = ''

export async function bedrockConfig(): Promise<BedrockConfig> {
  if (cfg && Date.now() - cfgAt < 60_000) return cfg
  const out: Record<string, string> = {}
  let next: string | undefined
  do {
    const r = await ssm.send(new GetParametersByPathCommand({ Path: PREFIX, NextToken: next }))
    for (const p of r.Parameters ?? []) out[p.Name!.slice(PREFIX.length)] = p.Value ?? ''
    next = r.NextToken
  } while (next)
  const val = (k: string) => (out[k] && out[k] !== 'none' ? out[k] : undefined)
  cfg = {
    fastModel: val('fast-model'), strongModel: val('strong-model'),
    guardrailId: val('guardrail-id'), guardrailVersion: val('guardrail-version'),
    agentId: val('agent-id'), agentAliasId: val('agent-alias-id'), kbId: val('kb-id'),
  }
  cfgAt = Date.now()
  return cfg
}

export interface CallMeta {
  engine: 'bedrock' | 'template'
  useCase: string
  modelId?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  guardrail?: 'applied' | 'intervened' | 'none'
  error?: string
}

/** One structured log line per call (CloudWatch metric filters read it) + the "last call" record the Cloud tab shows. */
export async function recordCall(meta: CallMeta) {
  console.log(JSON.stringify({ metric: 'bedrock', ok: meta.engine === 'bedrock' ? 1 : 0, ...meta }))
  await doc.send(new PutCommand({ TableName: T.state, Item: { pk: `${TRAIN_ID}#BEDROCK`, ...meta, at: Date.now() } })).catch(() => undefined)
}

interface ConverseArgs {
  useCase: string
  tier: 'fast' | 'strong'
  system: string
  messages: Message[]
  maxTokens: number
  toolConfig?: ToolConfiguration
  guard?: boolean
}

export type ConverseResult =
  | { ok: true; text: string; toolInput?: any; message: Message; stopReason?: string; meta: CallMeta }
  | { ok: false; meta: CallMeta }

export async function converse(a: ConverseArgs): Promise<ConverseResult> {
  const c = await bedrockConfig()
  const modelId = a.tier === 'fast' ? c.fastModel : c.strongModel
  const base: CallMeta = { engine: 'template', useCase: a.useCase, modelId }
  if (!modelId) {
    const meta = { ...base, error: 'no model configured' }
    await recordCall(meta)
    return { ok: false, meta }
  }
  // While the account refuses model calls, answer from templates straight away for a minute
  // instead of paying the round trip on every request.
  if (Date.now() < refusedUntil) return { ok: false, meta: { ...base, error: refusedWhy } }
  const guard = a.guard !== false && c.guardrailId
  const t0 = Date.now()
  try {
    const res = await runtime.send(new ConverseCommand({
      modelId,
      system: [{ text: a.system }],
      messages: a.messages,
      inferenceConfig: { maxTokens: a.maxTokens },
      toolConfig: a.toolConfig,
      guardrailConfig: guard ? { guardrailIdentifier: c.guardrailId!, guardrailVersion: c.guardrailVersion ?? 'DRAFT' } : undefined,
    }))
    const message = res.output?.message ?? { role: 'assistant', content: [] }
    const text = (message.content ?? []).map((b) => b.text ?? '').join('').trim()
    const toolInput = (message.content ?? []).find((b) => b.toolUse)?.toolUse?.input
    const meta: CallMeta = {
      ...base, engine: 'bedrock', latencyMs: res.metrics?.latencyMs ?? Date.now() - t0,
      inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens,
      guardrail: res.stopReason === 'guardrail_intervened' ? 'intervened' : guard ? 'applied' : 'none',
    }
    await recordCall(meta)
    return { ok: true, text, toolInput, message, stopReason: res.stopReason, meta }
  } catch (e) {
    const err = e as Error
    const meta: CallMeta = { ...base, latencyMs: Date.now() - t0, error: `${err.name}: ${err.message}`.slice(0, 300) }
    if (/not allowed|AccessDenied|being verified/i.test(meta.error!)) {
      refusedUntil = Date.now() + 60_000
      refusedWhy = meta.error!
    }
    await recordCall(meta)
    return { ok: false, meta }
  }
}

export const SAFETY = [
  'You write for BreatheIQ, a cabin air-quality system on Indian Railways coaches.',
  'Give air-quality guidance only. Never diagnose a medical condition and never recommend a medicine or a dose.',
  'Be plain, calm and specific. Use the numbers you are given; never invent readings, coaches or stations.',
].join(' ')
