#!/usr/bin/env node
// One command to stand BreatheIQ up on AWS:
//
//   node scripts/deploy.mjs --profile <aws-profile> [--alert-email you@example.com] [--skip-bedrock] [--skip-train]
//
// Order: bootstrap → bundle Lambdas → BreatheiqCore + BreatheiqWeb → post-deploy config →
// SageMaker training → BreatheiqBedrock (kept separate: it needs Bedrock model access on the
// account, and a failure there must not take the pipeline down) → build and publish the dashboard.
import { step, ok, warn, aws, run, identity, flag, arg, INFRA, ROOT, OUTPUTS, REGION } from './lib.mjs'

const id = identity()
step(`Deploying BreatheIQ to account ${id.account} (${REGION}) as ${id.arn.split('/').pop()}`)

step('CDK bootstrap')
if (aws(['cloudformation', 'describe-stacks', '--stack-name', 'CDKToolkit'], { allowFail: true })) ok('already bootstrapped')
else run(`npx cdk bootstrap aws://${id.account}/${REGION} --tags project=breatheiq`, INFRA)

step('Bundle Lambda functions')
run('npm install --no-audit --no-fund', INFRA)
run('node build.mjs', INFRA)

step('Deploy BreatheiqCore and BreatheiqWeb')
run(`npx cdk deploy BreatheiqCore BreatheiqWeb --require-approval never --outputs-file "${OUTPUTS}"`, INFRA)

step('Post-deploy configuration')
const email = arg('alert-email')
run(`node scripts/post-deploy.mjs${email ? ` --alert-email ${email}` : ''}`)

if (!flag('skip-train')) {
  step('Train the model on SageMaker')
  if (!run('node scripts/train.mjs', ROOT, { allowFail: true })) warn('Training did not finish. The inference Lambda keeps serving the heads fitted at cold start; re-run `node scripts/train.mjs` later.')
}

if (!flag('skip-bedrock')) {
  step('Deploy BreatheiqBedrock (Guardrails, Knowledge Base, Agent)')
  if (run('npx cdk deploy BreatheiqBedrock --require-approval never', INFRA, { allowFail: true })) {
    run('node scripts/post-deploy.mjs --ingest-only', ROOT, { allowFail: true })
  } else {
    warn('BreatheiqBedrock did not deploy. This usually means the account has no Bedrock model access yet.')
    warn('Everything else works; Bedrock-written text falls back to templates. Re-run: npx cdk deploy BreatheiqBedrock')
  }
}

step('Build and publish the dashboard')
run('node scripts/publish-web.mjs')
