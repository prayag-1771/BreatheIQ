#!/usr/bin/env node
// After `cdk deploy`: writes breatheiq/public/aws-config.json from the stack outputs (nothing
// secret), stores the route geofences, issues the coach device certificate, uploads the
// Knowledge Base documents and training data, and creates the operator login.
//
//   node scripts/post-deploy.mjs [--profile <name>] [--alert-email you@example.com] [--ingest-only]
import { writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { step, ok, warn, aws, run, outputs, invoke, arg, flag, ROOT, INFRA, WEB, REGION } from './lib.mjs'

const o = outputs()
const core = o.BreatheiqCore
if (!core) throw new Error('BreatheiqCore is not deployed. Run `node scripts/deploy.mjs` first.')
const TRAIN_ID = '12302', COACH = 'B2'
const thing = `breatheiq-${TRAIN_ID}-${COACH}`
const getParam = (name) => aws(['ssm', 'get-parameter', '--name', name], { allowFail: true })?.Parameter?.Value
// `--value=` form: a PEM starts with dashes, which the CLI would otherwise read as an option
const putParam = (name, value, type = 'String') =>
  aws(['ssm', 'put-parameter', '--name', name, '--type', type, '--overwrite', `--value=${value}`])

function ingest() {
  const b = outputs().BreatheiqBedrock
  if (!b?.KnowledgeBaseId) return warn('Knowledge Base is not deployed yet; skipping ingestion.')
  const job = aws(['bedrock-agent', 'start-ingestion-job', '--knowledge-base-id', b.KnowledgeBaseId, '--data-source-id', b.DataSourceId], { allowFail: true })
  if (job?.ingestionJob) ok(`Knowledge Base ingestion started (${job.ingestionJob.ingestionJobId})`)
  else warn('Could not start Knowledge Base ingestion (needs Bedrock embeddings access). Re-run: node scripts/post-deploy.mjs --ingest-only')
}

if (flag('ingest-only')) {
  step('Knowledge Base ingestion')
  ingest()
  process.exit(0)
}

step('Dashboard configuration')
const mapKey = aws(['location', 'describe-key', '--key-name', core.MapKeyName], { allowFail: true })?.Key ?? null
const config = {
  region: core.Region, apiUrl: core.ApiUrl, chatUrl: core.ChatUrl, iotEndpoint: core.IotEndpoint,
  identityPoolId: core.IdentityPoolId, userPoolId: core.UserPoolId, userPoolClientId: core.UserPoolClientId,
  trainId: TRAIN_ID, coach: COACH, telemetryTopic: core.TelemetryTopic, commandTopic: core.CommandTopic,
  mapKey, mapStyle: 'Standard', siteUrl: o.BreatheiqWeb?.SiteUrl ?? null, deployedAt: new Date().toISOString(),
}
mkdirSync(path.join(WEB, 'public'), { recursive: true })
writeFileSync(path.join(WEB, 'public', 'aws-config.json'), `${JSON.stringify(config, null, 2)}\n`)
ok('breatheiq/public/aws-config.json written (endpoints and pool IDs only)')

step('Amazon Location geofences')
const geo = invoke(core.GeofenceFunction, { internal: 'setup' })
geo.stored ? ok(`${geo.stored} route geofences stored`) : warn(`Geofence setup returned ${JSON.stringify(geo).slice(0, 200)}`)

step(`Device certificate for ${thing}`)
if (getParam(`/breatheiq/device/${thing}/certificate-arn`)) ok('certificate already issued')
else {
  const cert = aws(['iot', 'create-keys-and-certificate', '--set-as-active'])
  putParam(`/breatheiq/device/${thing}/certificate-arn`, cert.certificateArn)
  putParam(`/breatheiq/device/${thing}/certificate-pem`, cert.certificatePem, 'SecureString')
  putParam(`/breatheiq/device/${thing}/private-key`, cert.keyPair.PrivateKey, 'SecureString')
  aws(['iot', 'attach-policy', '--policy-name', 'breatheiq-coach-device', '--target', cert.certificateArn], { json: false })
  aws(['iot', 'attach-thing-principal', '--thing-name', thing, '--principal', cert.certificateArn], { json: false })
  ok('X.509 certificate issued, attached to the thing and policy; key stored as SSM SecureString (never on disk)')
}

step('Knowledge Base documents and training data → S3')
const stage = path.join(INFRA, 'cdk.out', 'kb-stage')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const KB = path.join(WEB, 'src', 'ask', 'kb')
for (const f of readdirSync(KB)) copyFileSync(path.join(KB, f), path.join(stage, f))
copyFileSync(path.join(ROOT, 'HARDWARE.md'), path.join(stage, 'hardware.md'))
copyFileSync(path.join(ROOT, 'README.md'), path.join(stage, 'readme.md'))
aws(['s3', 'sync', stage, `s3://${core.DataBucket}/kb/`, '--delete'], { json: false })
ok(`${readdirSync(stage).length} documents in s3://<data-bucket>/kb/`)
aws(['s3', 'cp', path.join(INFRA, 'training', 'TK172529.csv'), `s3://${core.DataBucket}/training/data/TK172529.csv`], { json: false })
const tarball = path.join(INFRA, 'cdk.out', 'sourcedir.tar.gz')
run(`tar -czf "${tarball}" -C "${path.join(INFRA, 'training')}" train.py`)
aws(['s3', 'cp', tarball, `s3://${core.DataBucket}/training/source/sourcedir.tar.gz`], { json: false })
ok('training data and script uploaded')

step('Operator login')
const users = aws(['cognito-idp', 'list-users', '--user-pool-id', core.UserPoolId, '--filter', 'username = "operator"'])
if (users.Users?.length) ok('operator user already exists')
else {
  const password = `Bq-${randomBytes(9).toString('base64url')}-7a`
  aws(['cognito-idp', 'admin-create-user', '--user-pool-id', core.UserPoolId, '--username', 'operator', '--message-action', 'SUPPRESS'])
  aws(['cognito-idp', 'admin-set-user-password', '--user-pool-id', core.UserPoolId, '--username', 'operator', '--password', password, '--permanent'], { json: false })
  putParam('/breatheiq/operator/password', password, 'SecureString')
  ok('user "operator" created; password stored in SSM SecureString /breatheiq/operator/password')
}
console.log('    read it with: aws ssm get-parameter --name /breatheiq/operator/password --with-decryption --query Parameter.Value --output text')

const email = arg('alert-email')
if (email) {
  step('Staff alert email')
  aws(['sns', 'subscribe', '--topic-arn', core.StaffTopicArn, '--protocol', 'email', '--notification-endpoint', email])
  ok(`confirmation sent to ${email}: click the link in that email to receive alerts`)
} else {
  warn(`No alert email subscribed. Add one: aws sns subscribe --topic-arn ${core.StaffTopicArn} --protocol email --notification-endpoint you@example.com`)
}

step('SMS')
const sandbox = aws(['sns', 'get-sms-sandbox-account-status'], { allowFail: true })
if (!sandbox) warn('SMS is not available on this account yet (AWS End User Messaging is not enabled). The playbook records "no verified numbers" and sends email only.')
else {
  ok(`SMS sandbox: ${sandbox.IsInSandbox ? 'yes — only verified numbers receive messages' : 'no'}`)
  console.log('    set recipients (E.164, comma-separated): aws ssm put-parameter --name /breatheiq/sms/numbers --type SecureString --overwrite --value "+91XXXXXXXXXX"')
}

ingest()
console.log(`\nRegion ${REGION} · API ${core.ApiUrl}`)
