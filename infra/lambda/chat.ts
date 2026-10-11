/**
 * "Ask BreatheIQ" — streamed over a Lambda Function URL as newline-delimited JSON:
 *   {type:'tool',name} · {type:'text',delta} · {type:'citation',title,snippet} · {type:'guardrail'} · {type:'done',meta}
 *
 * Primary engine: the Bedrock Agent (action groups + Knowledge Base + Guardrails).
 * If the agent cannot be invoked, the built-in assistant answers from the same tools and the
 * same Knowledge Base documents, and `meta.engine` says so.
 */
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime'
import { answer, type AskEvent } from '../../breatheiq/src/ask/assistant'
import { bedrockConfig, recordCall, type CallMeta } from './bedrock'
import { serverTools } from './tools'
import { env } from './shared'

declare const awslambda: any
const agent = new BedrockAgentRuntimeClient({})

type Send = (o: AskEvent | { type: 'done'; meta: CallMeta }) => void

async function viaAgent(q: string, sessionId: string, role: string, send: Send, cfg: { agentId: string; agentAliasId: string }): Promise<CallMeta> {
  const t0 = Date.now()
  const res = await agent.send(new InvokeAgentCommand({
    agentId: cfg.agentId, agentAliasId: cfg.agentAliasId, sessionId, inputText: q, enableTrace: true,
    streamingConfigurations: { streamFinalResponse: true },
    sessionState: { sessionAttributes: { role }, promptSessionAttributes: { role } },
  }))
  let inputTokens = 0, outputTokens = 0, intervened = false
  const seen = new Set<string>()
  for await (const ev of res.completion ?? []) {
    if (ev.chunk?.bytes) send({ type: 'text', delta: new TextDecoder().decode(ev.chunk.bytes) })
    for (const c of ev.chunk?.attribution?.citations ?? []) {
      for (const ref of c.retrievedReferences ?? []) {
        const uri = ref.location?.s3Location?.uri ?? ''
        if (seen.has(uri)) continue
        seen.add(uri)
        send({ type: 'citation', title: uri.split('/').pop()?.replace(/\.md$/, '') ?? 'Knowledge Base', snippet: (ref.content?.text ?? '').slice(0, 180) })
      }
    }
    const tr = ev.trace?.trace
    const inv = tr?.orchestrationTrace?.invocationInput
    if (inv?.actionGroupInvocationInput?.function) send({ type: 'tool', name: inv.actionGroupInvocationInput.function })
    if (inv?.knowledgeBaseLookupInput) send({ type: 'tool', name: 'Knowledge Base' })
    const usage = tr?.orchestrationTrace?.modelInvocationOutput?.metadata?.usage
    if (usage) { inputTokens += usage.inputTokens ?? 0; outputTokens += usage.outputTokens ?? 0 }
    if (tr?.guardrailTrace?.action === 'INTERVENED' && !intervened) { intervened = true; send({ type: 'guardrail' }) }
  }
  return { engine: 'bedrock', useCase: 'ask-breatheiq', modelId: 'bedrock-agent', latencyMs: Date.now() - t0, inputTokens, outputTokens, guardrail: intervened ? 'intervened' : 'applied' }
}

export const handler = awslambda.streamifyResponse(async (event: any, responseStream: any) => {
  const http = awslambda.HttpResponseStream.from(responseStream, { statusCode: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
  const send: Send = (o) => { http.write(`${JSON.stringify(o)}\n`) }
  try {
    const body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : event.body || '{}')
    const q = String(body.message ?? '').slice(0, 1000).trim()
    const sessionId = String(body.sessionId ?? 'web').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80) || 'web'
    const role = String(event.requestContext?.authorizer?.iam?.userArn ?? '').includes(env('OPERATOR_ROLE', '~none~')) ? 'operator' : 'guest'
    if (!q) { send({ type: 'text', delta: 'Ask me about the air on this train.' }); send({ type: 'done', meta: { engine: 'template', useCase: 'ask-breatheiq' } }); return }

    const cfg = await bedrockConfig()
    let meta: CallMeta | null = null
    let agentError: string | undefined
    if (cfg.agentId && cfg.agentAliasId) {
      try {
        meta = await viaAgent(q, sessionId, role, send, { agentId: cfg.agentId, agentAliasId: cfg.agentAliasId })
      } catch (e) {
        agentError = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300)
        console.log(JSON.stringify({ level: 'warn', msg: 'agent unavailable', error: agentError }))
      }
    }
    if (!meta) {
      const t0 = Date.now()
      await answer(q, serverTools(role), send)
      meta = { engine: 'template', useCase: 'ask-breatheiq', latencyMs: Date.now() - t0, error: agentError ?? (cfg.agentId ? undefined : 'agent not deployed') }
    }
    await recordCall(meta)
    send({ type: 'done', meta })
  } catch (e) {
    send({ type: 'text', delta: 'Sorry — I could not answer that just now.' })
    send({ type: 'done', meta: { engine: 'template', useCase: 'ask-breatheiq', error: (e as Error).message } })
  } finally {
    http.end()
  }
})
