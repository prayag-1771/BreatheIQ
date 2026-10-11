#!/usr/bin/env node
// Builds the dashboard and publishes it to Amplify Hosting as a manual deployment.
//
//   node scripts/publish-web.mjs [--profile <name>] [--no-build]
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { deflateRawSync, crc32 } from 'node:zlib'
import path from 'node:path'
import { step, ok, aws, run, outputs, flag, sleep, WEB } from './lib.mjs'

const web = outputs().BreatheiqWeb
if (!web?.AmplifyAppId) throw new Error('BreatheiqWeb is not deployed.')

if (!flag('no-build')) {
  step('Build the dashboard')
  if (!existsSync(path.join(WEB, 'node_modules'))) run('npm ci --no-audit --no-fund', WEB)
  run('npm run build', WEB)
}
const dist = path.join(WEB, 'dist')
if (!existsSync(path.join(dist, 'aws-config.json'))) throw new Error('dist/aws-config.json is missing. Run `node scripts/post-deploy.mjs`, then build again.')

// Minimal zip writer (deflate, forward-slash names) so this works the same on Windows, macOS and Linux.
function zipDir(dir) {
  const files = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else files.push(full)
    }
  }
  walk(dir)
  const parts = [], central = []
  let offset = 0
  for (const full of files) {
    const name = Buffer.from(path.relative(dir, full).split(path.sep).join('/'))
    const data = readFileSync(full)
    const packed = deflateRawSync(data, { level: 9 })
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt32LE(0x00210000, 10) // 1980-01-01, a fixed timestamp keeps the archive reproducible
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(0x00210000, 12); cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42)
    parts.push(head, name, packed)
    central.push(cen, name)
    offset += head.length + name.length + packed.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return { zip: Buffer.concat([...parts, cd, end]), count: files.length }
}

step('Publish to Amplify Hosting')
const { zip, count } = zipDir(dist)
ok(`${count} files, ${(zip.length / 1024).toFixed(0)} kB zipped`)
const dep = aws(['amplify', 'create-deployment', '--app-id', web.AmplifyAppId, '--branch-name', web.AmplifyBranch])
const put = await fetch(dep.zipUploadUrl, { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: zip })
if (!put.ok) throw new Error(`Upload failed: ${put.status} ${await put.text()}`)
aws(['amplify', 'start-deployment', '--app-id', web.AmplifyAppId, '--branch-name', web.AmplifyBranch, '--job-id', dep.jobId])
for (let i = 0; i < 60; i++) {
  const status = aws(['amplify', 'get-job', '--app-id', web.AmplifyAppId, '--branch-name', web.AmplifyBranch, '--job-id', dep.jobId]).job.summary.status
  if (status === 'SUCCEED') { ok(`live at ${web.SiteUrl}`); process.exit(0) }
  if (status === 'FAILED' || status === 'CANCELLED') throw new Error(`Amplify deployment ${status}`)
  await sleep(4000)
}
throw new Error('Timed out waiting for the Amplify deployment.')
