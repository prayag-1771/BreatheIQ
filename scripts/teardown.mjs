#!/usr/bin/env node
// Removes everything BreatheIQ created: the three stacks, plus the resources the scripts
// made outside CloudFormation (device certificate, SSM parameters, model packages).
//
//   node scripts/teardown.mjs --profile <name> --yes
import { step, ok, warn, aws, run, flag, INFRA } from './lib.mjs'

if (!flag('yes')) {
  console.log('This deletes every BreatheIQ resource in the account, including stored telemetry, incidents, audio and reports.')
  console.log('Re-run with --yes to confirm.')
  process.exit(1)
}

step('Device certificates')
const principals = aws(['iot', 'list-thing-principals', '--thing-name', 'breatheiq-12302-B2'], { allowFail: true })?.principals ?? []
for (const arn of principals) {
  const id = arn.split('/').pop()
  aws(['iot', 'detach-thing-principal', '--thing-name', 'breatheiq-12302-B2', '--principal', arn], { json: false, allowFail: true })
  aws(['iot', 'detach-policy', '--policy-name', 'breatheiq-coach-device', '--target', arn], { json: false, allowFail: true })
  aws(['iot', 'update-certificate', '--certificate-id', id, '--new-status', 'INACTIVE'], { json: false, allowFail: true })
  aws(['iot', 'delete-certificate', '--certificate-id', id, '--force-delete'], { json: false, allowFail: true })
  ok(`certificate ${id.slice(0, 10)}… deleted`)
}

step('Model Registry versions')
const pkgs = aws(['sagemaker', 'list-model-packages', '--model-package-group-name', 'breatheiq-rf'], { allowFail: true })?.ModelPackageSummaryList ?? []
for (const p of pkgs) aws(['sagemaker', 'delete-model-package', '--model-package-name', p.ModelPackageArn], { json: false, allowFail: true })
ok(`${pkgs.length} model package version(s) deleted`)
aws(['sagemaker', 'delete-model-package-group', '--model-package-group-name', 'breatheiq-rf'], { json: false, allowFail: true })

step('Stacks')
run('npx cdk destroy BreatheiqBedrock BreatheiqWeb BreatheiqCore --force', INFRA, { allowFail: true })

step('SSM parameters created by the scripts')
const params = aws(['ssm', 'get-parameters-by-path', '--path', '/breatheiq', '--recursive'], { allowFail: true })?.Parameters ?? []
for (const p of params) aws(['ssm', 'delete-parameter', '--name', p.Name], { json: false, allowFail: true })
ok(`${params.length} parameter(s) deleted`)

warn('Left in place: the CDKToolkit bootstrap stack and its ECR/S3 asset stores (shared with any other CDK app), and CloudWatch log groups for SageMaker jobs.')
