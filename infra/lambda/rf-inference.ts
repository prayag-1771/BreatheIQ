/**
 * rf-inference: the four Random-Forest heads from final.py.
 *
 * The SageMaker training job exports each fitted forest as plain decision trees (forest.json
 * inside model.tar.gz); this function walks them exactly as scikit-learn does — float32 input,
 * `x <= threshold` goes left, class-1 shares averaged over the 100 trees, value = share > 0.5 —
 * so it returns the same predictions as RandomForestClassifier.predict / predict_proba.
 *
 * The current model is the SSM pointer MODEL_PARAM (written when a job completes). Until the
 * first job finishes it serves forest-bootstrap.json: the same training, run at build time.
 */
import { gunzipSync } from 'node:zlib'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import bootstrap from '../training/forest-bootstrap.json'
import { env } from './shared'

type HeadKey = 'x' | 'y' | 'z' | 'w'
interface Tree { left: number[]; right: number[]; threshold: number[]; p1: number[] }
interface Forest { classes: number[]; trees: Tree[] }
interface ForestDoc { heads: Record<HeadKey, Forest>; metrics?: unknown }
interface Pointer { version?: string; jobName?: string; artifact?: string }
interface Loaded { doc: ForestDoc; version: string; source: 'sagemaker' | 'bootstrap'; jobName: string | null; artifact: string | null }

const s3 = new S3Client({})
const ssm = new SSMClient({})
const REFRESH_MS = 120_000

let current: Loaded = { doc: bootstrap as unknown as ForestDoc, version: 'rf-bootstrap', source: 'bootstrap', jobName: null, artifact: null }
let pointer: string | null = null
let checkedAt = 0

/** Files in a (ustar / pax) tar archive, by name. */
function untar(buf: Buffer) {
  const files: Record<string, Buffer> = {}
  for (let off = 0; off + 512 <= buf.length;) {
    const field = (a: number, b: number) => buf.toString('utf8', off + a, off + b).replace(/\0[\s\S]*$/, '')
    const name = field(0, 100)
    if (!name) break
    const size = parseInt(field(124, 136).trim() || '0', 8)
    const type = field(156, 157)
    const prefix = field(345, 500)
    if (type === '0' || type === '') files[`${prefix ? `${prefix}/` : ''}${name}`.replace(/^\.\//, '')] = buf.subarray(off + 512, off + 512 + size)
    off += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

async function refresh() {
  if (Date.now() - checkedAt < REFRESH_MS) return
  checkedAt = Date.now()
  let raw: string | undefined
  try {
    raw = (await ssm.send(new GetParameterCommand({ Name: env('MODEL_PARAM') }))).Parameter?.Value
  } catch {
    return // no trained model yet: keep serving the bootstrap forest
  }
  if (!raw || raw === pointer) return
  try {
    const p = JSON.parse(raw) as Pointer
    if (!p.artifact) return
    const [bucket, ...key] = p.artifact.replace('s3://', '').split('/')
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key.join('/') }))
    const files = untar(gunzipSync(Buffer.from(await obj.Body!.transformToByteArray())))
    const forest = files['forest.json']
    if (!forest) throw new Error('forest.json is missing from the model artifact')
    current = { doc: JSON.parse(forest.toString('utf8')), version: p.version ?? 'rf-v1', source: 'sagemaker', jobName: p.jobName ?? null, artifact: p.artifact }
    pointer = raw
  } catch (e) {
    console.log(JSON.stringify({ level: 'warn', msg: 'model load failed; keeping the current model', error: String(e) }))
  }
}

function classOneShare(f: Forest, x: number) {
  if (!f.classes.includes(1)) return 0
  const xf = Math.fround(x) // scikit-learn compares float32 features with float64 thresholds
  let sum = 0
  for (const t of f.trees) {
    let n = 0
    while (t.left[n] !== -1) n = xf <= t.threshold[n] ? t.left[n] : t.right[n]
    sum += t.p1[n]
  }
  return sum / f.trees.length
}

export const handler = async (event: { action?: string; temp?: number; gas?: number; co2?: number; pms?: number }) => {
  await refresh()
  const info = { modelVersion: current.version, version: current.version, source: current.source, jobName: current.jobName, artifact: current.artifact }
  if (event.action === 'info') return { ...info, metrics: current.doc.metrics ?? null }
  const t0 = performance.now()
  const input: Record<HeadKey, number> = { x: Number(event.temp), y: Number(event.gas), z: Number(event.co2), w: Number(event.pms) }
  const heads = Object.fromEntries((['x', 'y', 'z', 'w'] as const).map((k) => {
    const p = classOneShare(current.doc.heads[k], input[k])
    // predict() takes the arg-max class, so an exact 0.5 tie goes to class 0
    return [k, { value: p > 0.5 ? 1 : 0, p: Math.round(p * 100) / 100 }]
  }))
  return { heads, ...info, ms: Math.round((performance.now() - t0) * 10) / 10 }
}
