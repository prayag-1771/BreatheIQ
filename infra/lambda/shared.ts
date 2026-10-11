/** Shared clients and helpers for every BreatheIQ Lambda. */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'

export const env = (k: string, fallback = '') => process.env[k] ?? fallback

export const TRAIN_ID = env('TRAIN_ID', '12302')
export const COACH = env('COACH', 'B2')
export const KEY = `${TRAIN_ID}#${COACH}`
export const CONTROL_KEY = `${TRAIN_ID}#CONTROL`

export const T = {
  telemetry: env('TELEMETRY_TABLE'),
  state: env('STATE_TABLE'),
  incidents: env('INCIDENTS_TABLE'),
  interlock: env('INTERLOCK_TABLE'),
  alerts: env('ALERTS_TABLE'),
}

export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

const iot = new IoTDataPlaneClient({ endpoint: `https://${env('IOT_ENDPOINT')}` })
export const topic = (kind: 'telemetry' | 'command') => `breatheiq/${TRAIN_ID}/${COACH}/${kind}`
export const publish = (kind: 'telemetry' | 'command', payload: unknown) =>
  iot.send(new PublishCommand({ topic: topic(kind), qos: 0, payload: Buffer.from(JSON.stringify(payload)) }))

const bus = new EventBridgeClient({})
export const emit = (detailType: string, detail: unknown) =>
  bus.send(new PutEventsCommand({
    Entries: [{ EventBusName: env('EVENT_BUS'), Source: 'breatheiq.pipeline', DetailType: detailType, Detail: JSON.stringify(detail) }],
  }))

export interface Control {
  simEnabled: boolean
  scenario: number
  sustain: boolean
  scenarioSeq: number
  badDay: boolean | null
  badDaySeq: number
  occupiedOverride: boolean
  mode: 'auto' | 'manual'
  manual: { fan: boolean; oz1: boolean; oz2: boolean }
  thresholds: { tempC: number; pm: number }
  rulesEnabled: Record<string, boolean>
}

export const DEFAULT_CONTROL: Control = {
  simEnabled: true, scenario: 1, sustain: false, scenarioSeq: 0, badDay: null, badDaySeq: 0, occupiedOverride: false,
  mode: 'auto', manual: { fan: false, oz1: false, oz2: false }, thresholds: { tempC: 34.5, pm: 80 }, rulesEnabled: {},
}

export async function getControl(): Promise<Control> {
  const r = await doc.send(new GetCommand({ TableName: T.state, Key: { pk: CONTROL_KEY } }))
  return { ...DEFAULT_CONTROL, ...(r.Item?.control ?? {}) }
}

export async function putControl(patch: Partial<Control>): Promise<Control> {
  const next = { ...(await getControl()), ...patch }
  await doc.send(new PutCommand({ TableName: T.state, Item: { pk: CONTROL_KEY, control: next, updatedAt: Date.now() } }))
  return next
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
export const ttl = (hours: number) => Math.floor(Date.now() / 1000) + hours * 3600
