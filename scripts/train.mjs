#!/usr/bin/env node
// Starts a SageMaker training job for the four Random-Forest heads and waits for it.
// When the job completes the API registers the model in the Model Registry and points the
// inference Lambda at the new artifact.
//
//   node scripts/train.mjs [--profile <name>]
import { step, ok, warn, outputs, invoke, sleep } from './lib.mjs'

const core = outputs().BreatheiqCore
if (!core) throw new Error('BreatheiqCore is not deployed.')
const api = core.ApiFunction

// new accounts sometimes have a zero quota for one instance family; try the next
const INSTANCES = ['ml.m5.large', 'ml.c5.xlarge', 'ml.m4.xlarge', 'ml.m5.xlarge']

step('SageMaker training job')
let job = null
for (const instanceType of INSTANCES) {
  const r = invoke(api, { internal: 'retrain', instanceType })
  if (r.quota) { warn(`${instanceType}: no training quota on this account`); continue }
  if (r.job) {
    job = r.job
    r.started ? ok(`started ${job} on ${instanceType}`) : ok(`${r.reason} Following ${job}.`)
    break
  }
  const msg = r.errorMessage ?? JSON.stringify(r)
  if (/ResourceLimitExceeded|quota|limit/i.test(msg)) { warn(`${instanceType}: no quota (${msg.slice(0, 120)})`); continue }
  throw new Error(msg)
}
if (!job) {
  warn('No SageMaker training quota on this account yet. The model keeps serving the bootstrap forest (same training, run at build time).')
  warn('To train on SageMaker: Service Quotas → Amazon SageMaker → "ml.m5.large for training job usage" → request 1, then run node scripts/train.mjs')
  process.exit(0)
}

let last = ''
for (let i = 0; i < 80; i++) {
  const s = invoke(api, { internal: 'job', name: job })
  if (s.errorMessage) throw new Error(s.errorMessage)
  const line = `${s.status} · ${s.secondaryStatus}`
  if (line !== last) { console.log(`    ${line}`); last = line }
  if (s.status === 'Completed') {
    ok(`model ${s.version} is current · artifact ${s.artifact}`)
    if (s.modelPackageArn) ok(`registered in the Model Registry: ${s.modelPackageArn.split(':').pop()}`)
    else if (s.registryError) warn(`Model Registry: ${s.registryError}`)
    console.log('    metrics:', JSON.stringify(s.metrics))
    console.log(`    billable seconds: ${s.billableSeconds}`)
    process.exit(0)
  }
  if (s.status === 'Failed' || s.status === 'Stopped') throw new Error(`Training ${s.status}: ${s.failureReason ?? ''}`)
  await sleep(15_000)
}
throw new Error('Timed out waiting for the training job (20 min).')
