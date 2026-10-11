// Shared helpers for the deploy scripts. Credentials come from the usual AWS environment:
// set AWS_PROFILE (or pass --profile <name>) and, optionally, AWS_REGION (default us-east-1).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const INFRA = path.join(ROOT, 'infra')
export const WEB = path.join(ROOT, 'breatheiq')
export const OUTPUTS = path.join(INFRA, 'cdk-outputs.json')

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
export const flag = (name) => process.argv.includes(`--${name}`)

const profile = arg('profile')
if (profile) process.env.AWS_PROFILE = profile
process.env.AWS_REGION = arg('region', process.env.AWS_REGION ?? 'us-east-1')
process.env.AWS_DEFAULT_REGION = process.env.AWS_REGION
process.env.AWS_PAGER = ''
export const REGION = process.env.AWS_REGION

export const step = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`)
export const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
export const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Run the AWS CLI with an argument array (no shell). Returns parsed JSON, or throws with stderr. */
export function aws(args, { json = true, allowFail = false } = {}) {
  const r = spawnSync('aws', [...args, ...(json ? ['--output', 'json'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    if (allowFail) return null
    throw new Error(`aws ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`)
  }
  if (!json) return r.stdout.trim()
  return r.stdout.trim() ? JSON.parse(r.stdout) : {}
}

/** Run a shell command with inherited output (npm, npx cdk, tar). */
export function run(cmd, cwd = ROOT, { allowFail = false } = {}) {
  console.log(`  $ ${cmd}`)
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true })
  if (r.status !== 0 && !allowFail) throw new Error(`Command failed (${r.status}): ${cmd}`)
  return r.status === 0
}

/** Stack outputs as { StackName: { Key: value } }, from the last deploy or from CloudFormation. */
export function outputs() {
  const all = existsSync(OUTPUTS) ? JSON.parse(readFileSync(OUTPUTS, 'utf8')) : {}
  for (const name of ['BreatheiqCore', 'BreatheiqWeb', 'BreatheiqBedrock']) {
    if (all[name]) continue
    const s = aws(['cloudformation', 'describe-stacks', '--stack-name', name], { allowFail: true })
    if (s?.Stacks?.[0]?.Outputs) all[name] = Object.fromEntries(s.Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]))
  }
  return all
}

export function invoke(functionName, payload) {
  const out = path.join(INFRA, 'cdk.out', `invoke-${Date.now()}.json`)
  aws(['lambda', 'invoke', '--function-name', functionName, '--cli-binary-format', 'raw-in-base64-out', '--payload', JSON.stringify(payload), out])
  return JSON.parse(readFileSync(out, 'utf8') || '{}')
}

export function identity() {
  const id = aws(['sts', 'get-caller-identity'])
  return { account: id.Account, arn: id.Arn }
}
