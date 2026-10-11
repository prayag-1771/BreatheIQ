// Bundles each Lambda handler into dist/<name>/index.js. The simulator and the frame
// processor import the dashboard's pure engine (breatheiq/src/sim) so cloud and browser
// run the same code.
import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const fns = ['simulator', 'process-frame', 'rf-inference', 'api', 'chat', 'playbook', 'agent-actions', 'geofence']

// Vite-style `?raw` imports (the Knowledge Base documents) load as text
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' }))
  },
}

rmSync(path.join(root, 'dist'), { recursive: true, force: true })
await Promise.all(fns.map((name) =>
  build({
    entryPoints: [path.join(root, 'lambda', `${name}.ts`)],
    outfile: path.join(root, 'dist', name, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    minify: false,
    sourcemap: false,
    plugins: [raw],
    logLevel: 'warning',
  }),
))
console.log(`bundled ${fns.length} functions → infra/dist`)
