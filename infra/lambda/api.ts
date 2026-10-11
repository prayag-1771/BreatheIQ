/**
 * Dashboard API (API Gateway HTTP API, IAM auth through the Cognito identity pool).
 * One Lambda, small router. Guests can read everything and drive the presentation
 * controls (scenario, Bad Day toggle, simulator on/off); the Controls page settings
 * and model retraining need the signed-in operator role.
 */
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { SFNClient, ListExecutionsCommand, GetExecutionHistoryCommand } from '@aws-sdk/client-sfn'
import {
  SageMakerClient, CreateTrainingJobCommand, DescribeTrainingJobCommand, ListTrainingJobsCommand, CreateModelPackageCommand,
  CreateModelPackageGroupCommand, DescribeModelPackageGroupCommand,
} from '@aws-sdk/client-sagemaker'
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { LocationClient, ListGeofencesCommand } from '@aws-sdk/client-location'
import { STATIONS } from '../../breatheiq/src/sim/route'
import { STATION_LNGLAT, ZONE_POLYGONS } from '../../breatheiq/src/sim/geo'
import { converse, bedrockConfig, SAFETY } from './bedrock'
import { explainTemplate } from '../../breatheiq/src/sim/explain'
import { getState, listIncidents } from './tools'
import { doc, T, KEY, TRAIN_ID, env, getControl, putControl, ttl, type Control } from './shared'

const sfn = new SFNClient({})
const sm = new SageMakerClient({})
const ssm = new SSMClient({})
const s3 = new S3Client({})
const cw = new CloudWatchClient({})
const lambda = new LambdaClient({})
const location = new LocationClient({})

const BUCKET = env('DATA_BUCKET')
const MODEL_PARAM = env('MODEL_PARAM', '/breatheiq/model/current')
const REGION = env('AWS_REGION', 'us-east-1')
const HEADS = ['x', 'y', 'z', 'w'] as const

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
const presign = (key?: string) => (key ? getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 }) : Promise.resolve(null))

// ── model: SageMaker training + registry + the pointer the inference Lambda follows ──
async function modelPointer() {
  try {
    return JSON.parse((await ssm.send(new GetParameterCommand({ Name: MODEL_PARAM }))).Parameter?.Value ?? 'null')
  } catch { return null }
}

async function trainingJobs() {
  const r = await sm.send(new ListTrainingJobsCommand({ NameContains: 'breatheiq-rf', SortBy: 'CreationTime', SortOrder: 'Descending', MaxResults: 5 }))
  return (r.TrainingJobSummaries ?? []).map((j) => ({ name: j.TrainingJobName!, status: j.TrainingJobStatus!, createdAt: j.CreationTime?.getTime(), endedAt: j.TrainingEndTime?.getTime() }))
}

async function startTraining(instanceType = env('SM_INSTANCE', 'ml.m5.large')) {
  const jobs = await trainingJobs()
  const running = jobs.find((j) => j.status === 'InProgress' || j.status === 'Stopping')
  if (running) return { started: false, job: running.name, reason: 'A training job is already running.' }
  if (jobs[0]?.createdAt && Date.now() - jobs[0].createdAt < 5 * 60_000) return { started: false, job: jobs[0].name, reason: 'The last training job started less than 5 minutes ago.' }
  const name = `breatheiq-rf-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
  try {
    await createJob(name, instanceType)
  } catch (e) {
    if ((e as Error).name !== 'ResourceLimitExceeded') throw e
    throw new HttpError(409, `This AWS account has no SageMaker training quota for ${instanceType} yet. Request "${instanceType} for training job usage" in Service Quotas; the current model keeps serving.`)
  }
  return { started: true, job: name }
}

async function createJob(name: string, instanceType: string) {
  await sm.send(new CreateTrainingJobCommand({
    TrainingJobName: name,
    RoleArn: env('SM_ROLE_ARN'),
    AlgorithmSpecification: {
      TrainingImage: env('SKLEARN_IMAGE'), TrainingInputMode: 'File',
      MetricDefinitions: HEADS.flatMap((h) => [
        { Name: `head_${h}_accuracy`, Regex: `head_${h}_accuracy=([0-9\\.]+)` },
        { Name: `head_${h}_f1`, Regex: `head_${h}_f1=([0-9\\.]+)` },
      ]),
    },
    HyperParameters: {
      sagemaker_program: '"train.py"',
      sagemaker_submit_directory: `"s3://${BUCKET}/training/source/sourcedir.tar.gz"`,
      sagemaker_region: `"${REGION}"`,
    },
    InputDataConfig: [{
      ChannelName: 'train', ContentType: 'text/csv',
      DataSource: { S3DataSource: { S3DataType: 'S3Prefix', S3Uri: `s3://${BUCKET}/training/data/`, S3DataDistributionType: 'FullyReplicated' } },
    }],
    OutputDataConfig: { S3OutputPath: `s3://${BUCKET}/models/` },
    ResourceConfig: { InstanceType: instanceType as any, InstanceCount: 1, VolumeSizeInGB: 5 },
    StoppingCondition: { MaxRuntimeInSeconds: 900 },
    Tags: [{ Key: 'project', Value: 'breatheiq' }],
  }))
}

async function ensureModelGroup(name: string) {
  try {
    await sm.send(new DescribeModelPackageGroupCommand({ ModelPackageGroupName: name }))
  } catch {
    await sm.send(new CreateModelPackageGroupCommand({ ModelPackageGroupName: name, ModelPackageGroupDescription: 'BreatheIQ Random-Forest heads (X, Y, Z, W)' }))
  }
}

/** Status of one job. The first time a completed job is seen it is registered and becomes the current model. */
async function jobStatus(name: string) {
  const j = await sm.send(new DescribeTrainingJobCommand({ TrainingJobName: name }))
  const metrics = Object.fromEntries((j.FinalMetricDataList ?? []).map((m) => [m.MetricName!, Math.round((m.Value ?? 0) * 10000) / 10000]))
  const out: any = {
    name, status: j.TrainingJobStatus, secondaryStatus: j.SecondaryStatus, failureReason: j.FailureReason,
    createdAt: j.CreationTime?.getTime(), startedAt: j.TrainingStartTime?.getTime(), endedAt: j.TrainingEndTime?.getTime(),
    billableSeconds: j.BillableTimeInSeconds, instanceType: j.ResourceConfig?.InstanceType,
    artifact: j.ModelArtifacts?.S3ModelArtifacts, metrics,
    transitions: (j.SecondaryStatusTransitions ?? []).map((t) => ({ status: t.Status, at: t.StartTime?.getTime(), message: t.StatusMessage })),
  }
  if (j.TrainingJobStatus !== 'Completed' || !out.artifact) return out
  const current = await modelPointer()
  if (current?.jobName === name) return { ...out, current: true, version: current.version, modelPackageArn: current.modelPackageArn }
  if (current?.trainedAt && out.endedAt && current.trainedAt > out.endedAt) return { ...out, current: false }
  let modelPackageArn: string | undefined
  let version = `rf-v${(Number(String(current?.version ?? 'rf-v0').replace(/\D/g, '')) || 0) + 1}`
  try {
    await ensureModelGroup(env('MODEL_GROUP'))
    const pkg = await sm.send(new CreateModelPackageCommand({
      ModelPackageGroupName: env('MODEL_GROUP'),
      ModelPackageDescription: `Four Random-Forest heads (X temperature, Y gas, Z CO2, W dust) from training job ${name}`,
      ModelApprovalStatus: 'Approved',
      InferenceSpecification: {
        Containers: [{ Image: env('SKLEARN_IMAGE'), ModelDataUrl: out.artifact }],
        SupportedContentTypes: ['application/json'], SupportedResponseMIMETypes: ['application/json'],
      },
      CustomerMetadataProperties: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, String(v)])),
    }))
    modelPackageArn = pkg.ModelPackageArn
    const n = modelPackageArn?.split('/').pop()
    if (n && /^\d+$/.test(n)) version = `rf-v${n}`
  } catch (e) {
    out.registryError = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 200)
  }
  const pointer = { version, jobName: name, artifact: out.artifact, modelPackageArn, metrics, trainedAt: out.endedAt, updatedAt: Date.now() }
  await ssm.send(new PutParameterCommand({ Name: MODEL_PARAM, Type: 'String', Overwrite: true, Value: JSON.stringify(pointer) }))
  return { ...out, current: true, version, modelPackageArn }
}

async function modelInfo() {
  const [pointer, jobs, live] = await Promise.all([
    modelPointer(),
    trainingJobs().catch(() => []),
    lambda.send(new InvokeCommand({ FunctionName: env('INFERENCE_FN'), Payload: Buffer.from(JSON.stringify({ action: 'info' })) }))
      .then((r) => JSON.parse(Buffer.from(r.Payload ?? []).toString() || '{}')).catch(() => null),
  ])
  return { pointer, jobs, serving: live, registryGroup: env('MODEL_GROUP'), instanceType: env('SM_INSTANCE', 'ml.m5.large') }
}

// ── playbook: real Step Functions executions ──
async function playbook(arn?: string) {
  const list = await sfn.send(new ListExecutionsCommand({ stateMachineArn: env('STATE_MACHINE_ARN'), maxResults: 8 }))
  const executions = (list.executions ?? []).map((e) => ({ arn: e.executionArn!, name: e.name!, status: e.status!, startedAt: e.startDate?.getTime(), endedAt: e.stopDate?.getTime() }))
  const target = arn && executions.some((e) => e.arn === arn) ? arn : executions[0]?.arn
  if (!target) return { stateMachine: env('STATE_MACHINE_NAME'), executions, states: [] }
  const hist = await sfn.send(new GetExecutionHistoryCommand({ executionArn: target, maxResults: 400 }))
  const states: { name: string; enteredAt?: number; exitedAt?: number; status: string }[] = []
  for (const ev of hist.events ?? []) {
    const at = ev.timestamp?.getTime()
    if (ev.stateEnteredEventDetails) states.push({ name: ev.stateEnteredEventDetails.name!, enteredAt: at, status: 'running' })
    else if (ev.stateExitedEventDetails) {
      const s = [...states].reverse().find((x) => x.name === ev.stateExitedEventDetails!.name && !x.exitedAt)
      if (s) { s.exitedAt = at; s.status = 'succeeded' }
    } else if (/Failed|TimedOut|Aborted/.test(ev.type ?? '')) {
      const s = [...states].reverse().find((x) => !x.exitedAt)
      if (s) { s.exitedAt = at; s.status = 'failed' }
    }
  }
  return { stateMachine: env('STATE_MACHINE_NAME'), executions, selected: target, states }
}

async function incidentView(inc: any) {
  const [en, hi, report] = await Promise.all([presign(inc.audio?.en?.key), presign(inc.audio?.hi?.key), presign(inc.reportKey)])
  const { persisted: _p, groups: _g, ...rest } = inc
  return { ...rest, id: inc.pk, audioUrl: { en, hi }, reportUrl: report }
}

// ── cloud tab: live numbers ──
let metricsCache: { at: number; data: unknown } | null = null
async function metrics() {
  if (metricsCache && Date.now() - metricsCache.at < 15_000) return metricsCache.data
  const fn = (name: string) => [{ Name: 'FunctionName', Value: name }]
  const stat = (Id: string, MetricName: string, Stat: string, fnName: string, Period = 300) =>
    ({ Id, MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName, Dimensions: fn(fnName) }, Period, Stat } })
  const end = new Date(), start = new Date(end.getTime() - 15 * 60_000)
  const [cwRes, state, bedrock, incidents, execs] = await Promise.all([
    cw.send(new GetMetricDataCommand({
      StartTime: start, EndTime: end, ScanBy: 'TimestampDescending',
      MetricDataQueries: [
        { Id: 'iot', Expression: `SUM(SEARCH('{AWS/IoT,Protocol} MetricName="PublishIn.Success"', 'Sum', 60))` },
        stat('procP50', 'Duration', 'p50', env('PROCESS_FN')),
        stat('procInv', 'Invocations', 'Sum', env('PROCESS_FN'), 60),
        stat('procErr', 'Errors', 'Sum', env('PROCESS_FN'), 300),
        stat('inferP50', 'Duration', 'p50', env('INFERENCE_FN')),
      ],
    })).catch(() => null),
    getState(),
    doc.send(new GetCommand({ TableName: T.state, Key: { pk: `${TRAIN_ID}#BEDROCK` } })).then((r) => r.Item ?? null),
    listIncidents().catch(() => []),
    sfn.send(new ListExecutionsCommand({ stateMachineArn: env('STATE_MACHINE_ARN'), maxResults: 1 })).catch(() => null),
  ])
  // the newest datapoint is usually a partial minute; prefer the one before it
  const pick = (id: string) => {
    const v = cwRes?.MetricDataResults?.find((m) => m.Id === id)?.Values ?? []
    return v.length > 1 ? v[1] : v[0] ?? null
  }
  const last = execs?.executions?.[0]
  const data = {
    at: Date.now(),
    iot: { messagesPerMin: pick('iot'), topic: `breatheiq/${TRAIN_ID}/+/telemetry` },
    lambda: { processP50Ms: pick('procP50'), processPerMin: pick('procInv'), processErrors5m: pick('procErr'), inferenceP50Ms: pick('inferP50') },
    dynamodb: { framesProcessed: state?.persisted?.frames ?? 0, incidents: incidents.length, lastWriteAt: state?.updatedAt ?? null },
    bedrock: bedrock ? { engine: bedrock.engine, useCase: bedrock.useCase, modelId: bedrock.modelId, latencyMs: bedrock.latencyMs, inputTokens: bedrock.inputTokens, outputTokens: bedrock.outputTokens, guardrail: bedrock.guardrail, error: bedrock.error, at: bedrock.at } : null,
    stepFunctions: last ? { name: last.name, status: last.status, startedAt: last.startDate?.getTime(), endedAt: last.stopDate?.getTime() } : null,
    model: state?.model ?? null,
    device: { name: 'Cloud simulator', coach: env('COACH', 'B2'), lastFrameAt: state?.ts ?? null },
  }
  metricsCache = { at: Date.now(), data }
  return data
}

// ── Bedrock use cases 3 and 5 ──
async function explain(b: any) {
  if (!b?.features || !b?.pred) throw new HttpError(400, 'features and pred are required')
  const r = await converse({
    useCase: 'explain-decision', tier: 'fast', maxTokens: 220,
    system: `${SAFETY} Explain a model decision to a train operator in exactly two sentences. Each of the four Random-Forest heads sees one feature: X temperature → exhaust fan, Y MQ-2 gas (1 = clear, 0 = detected) → ozone generator 2, Z MQ-135 CO₂/air gases (1 = clear, 0 = detected) → ozone generator 1, W dust PM → ozone. "p" is the share of trees voting abnormal. Say why each head fired or did not.`,
    messages: [{ role: 'user', content: [{ text: JSON.stringify({ features: b.features, predictions: b.pred, thresholds: b.thresholds }) }] }],
  })
  return r.ok && r.text ? { text: r.text, meta: r.meta } : { text: explainTemplate(b), meta: { ...r.meta, engine: 'template' } }
}

async function advice(b: any) {
  const { group, risk, cleanCoach } = b ?? {}
  if (!group || !risk) throw new HttpError(400, 'group and risk are required')
  const pk = `ADVICE#${group}#${risk}#${cleanCoach ?? '-'}`
  const hit = (await doc.send(new GetCommand({ TableName: T.state, Key: { pk } }))).Item
  if (hit) return { text: hit.text, meta: { ...hit.meta, cached: true } }
  const r = await converse({
    useCase: 'exposure-advice', tier: 'fast', maxTokens: 120,
    system: `${SAFETY} Write one plain sentence of advice (25 words or fewer) for a passenger group on the train. If a cleaner coach is given and the risk is high or critical, name it.`,
    messages: [{ role: 'user', content: [{ text: JSON.stringify({ group: b.groupName ?? group, riskLevel: risk, cabinAqi: b.aqi, cleanestCoach: cleanCoach }) }] }],
  })
  if (!r.ok || !r.text || r.meta.guardrail === 'intervened') return { text: null, meta: { ...r.meta, engine: 'template' } }
  await doc.send(new PutCommand({ TableName: T.state, Item: { pk, text: r.text, meta: r.meta, ttl: ttl(24) } }))
  return { text: r.text, meta: r.meta }
}

// ── control ──
const GUEST_KEYS = ['scenario', 'sustain', 'badDay', 'simEnabled'] as const
const OPERATOR_KEYS = ['occupiedOverride', 'mode', 'manual', 'thresholds', 'rulesEnabled'] as const

async function setControl(body: any, role: string) {
  const patch: Partial<Control> = {}
  for (const k of GUEST_KEYS) if (body[k] !== undefined) (patch as any)[k] = body[k]
  const wantsOperator = OPERATOR_KEYS.filter((k) => body[k] !== undefined)
  if (wantsOperator.length && role !== 'operator') throw new HttpError(403, 'Sign in as the operator to change the Controls settings.')
  for (const k of wantsOperator) (patch as any)[k] = body[k]
  const cur = await getControl()
  if (patch.scenario !== undefined) patch.scenarioSeq = cur.scenarioSeq + 1
  if (patch.badDay !== undefined) patch.badDaySeq = cur.badDaySeq + 1
  return putControl(patch)
}

async function history(minutes: number) {
  const r = await doc.send(new QueryCommand({
    TableName: T.telemetry, KeyConditionExpression: 'pk = :p AND sk >= :s',
    ExpressionAttributeValues: { ':p': KEY, ':s': Date.now() - Math.min(60, Math.max(1, minutes)) * 60_000 }, Limit: 1800,
  }))
  return { minutes, points: (r.Items ?? []).map((i) => ({ t: i.sk, temp: i.temp, hum: i.hum, pm25: i.pm25, pm10: i.pm10, aqi: i.aqi, gas: i.gas, co2: i.co2, fan: i.fan })) }
}

// ── Amazon Location: the geofences as stored in the collection, plus the live position ──
async function locationView() {
  const s = await getState()
  let geofences = ZONE_POLYGONS.map((z) => ({ ...z, stored: false }))
  try {
    const r = await location.send(new ListGeofencesCommand({ CollectionName: env('GEOFENCE_COLLECTION') }))
    const stored = new Map((r.Entries ?? []).map((g) => [g.GeofenceId!, g]))
    geofences = ZONE_POLYGONS.map((z) => {
      const g = stored.get(z.id)
      return { ...z, polygon: (g?.Geometry?.Polygon?.[0] as [number, number][] | undefined) ?? z.polygon, stored: !!g }
    })
  } catch { /* collection not reachable: fall back to the same polygons computed locally */ }
  return {
    tracker: env('TRACKER'), collection: env('GEOFENCE_COLLECTION'), geofences,
    stations: STATIONS.map((st, i) => ({ ...st, lngLat: STATION_LNGLAT[i] })),
    position: s?.position ?? null, zone: s?.zone ?? null, preVent: s?.preVent ?? null,
  }
}

const recent = async (table: string, limit = 40) =>
  (await doc.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': KEY }, ScanIndexForward: false, Limit: limit }))).Items ?? []

async function route(method: string, path: string, q: Record<string, string | undefined>, body: any, role: string) {
  const key = `${method} ${path}`
  if (key === 'GET /state') {
    const s = await getState()
    if (!s) return { empty: true }
    const { persisted: _p, ...rest } = s
    return { ...rest, role }
  }
  if (key === 'GET /history') return history(Number(q.minutes ?? 10))
  if (key === 'GET /interlock') return { events: await recent(T.interlock) }
  if (key === 'GET /alerts') return { events: await recent(T.alerts) }
  if (key === 'GET /control') return { control: await getControl(), role }
  if (key === 'POST /control') return { control: await setControl(body, role), role }
  if (key === 'GET /incidents') return { incidents: await Promise.all((await listIncidents()).slice(0, 10).map(incidentView)) }
  if (key === 'GET /playbook') return playbook(q.arn)
  if (key === 'GET /model') return modelInfo()
  if (key === 'POST /model/retrain') return startTraining()
  if (key === 'GET /model/job') {
    if (!q.name || !/^breatheiq-rf-\d+$/.test(q.name)) throw new HttpError(400, 'name is required')
    return jobStatus(q.name)
  }
  if (key === 'GET /metrics') return metrics()
  if (key === 'GET /location') return locationView()
  if (key === 'GET /bedrock') {
    const c = await bedrockConfig()
    return { fastModel: c.fastModel, strongModel: c.strongModel, guardrail: !!c.guardrailId, agent: !!c.agentId, knowledgeBase: !!c.kbId }
  }
  if (key === 'POST /explain') return explain(body)
  if (key === 'POST /advice') return advice(body)
  throw new HttpError(404, `No route ${key}`)
}

export const handler = async (event: any) => {
  // direct invocations from scripts/train.mjs
  if (event.internal === 'retrain') {
    try {
      return await startTraining(event.instanceType)
    } catch (e) {
      if (e instanceof HttpError) return { started: false, quota: true, reason: e.message }
      throw e
    }
  }
  if (event.internal === 'job') return jobStatus(event.name)

  const method = event.requestContext?.http?.method ?? 'GET'
  const path = String(event.rawPath ?? '/').replace(/\/+$/, '') || '/'
  const role = String(event.requestContext?.authorizer?.iam?.userArn ?? '').includes(env('OPERATOR_ROLE', '~none~')) ? 'operator' : 'guest'
  try {
    const body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : {}
    const data = await route(method, path, event.queryStringParameters ?? {}, body, role)
    return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(data) }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: status === 500 ? 'Internal error' : (e as Error).message }) }
  }
}
