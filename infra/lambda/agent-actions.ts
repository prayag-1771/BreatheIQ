/** Action-group Lambda for the "Ask BreatheIQ" Bedrock Agent (function-details schema). */
import { runTool } from './tools'

interface AgentEvent {
  actionGroup: string
  function: string
  parameters?: { name: string; type: string; value: string }[]
  sessionAttributes?: Record<string, string>
  promptSessionAttributes?: Record<string, string>
}

export const handler = async (event: AgentEvent) => {
  const params = Object.fromEntries((event.parameters ?? []).map((p) => [p.name, p.value]))
  const result = await runTool(event.function, params, event.sessionAttributes?.role ?? 'guest')
  return {
    messageVersion: '1.0',
    response: {
      actionGroup: event.actionGroup,
      function: event.function,
      functionResponse: { responseBody: { TEXT: { body: JSON.stringify(result) } } },
    },
    sessionAttributes: event.sessionAttributes,
    promptSessionAttributes: event.promptSessionAttributes,
  }
}
