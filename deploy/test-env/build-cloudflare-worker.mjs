import { cp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { root } from './worker-config.mjs'
import { cloudflareConfig, validateCloudflareTestConfig, stateDir } from './cloudflare-config.mjs'

import { drainWorkerConfig, drainArtifactHash } from './drain/build-config.mjs'

const app = process.argv[2]
const withDrain = process.argv.slice(3).includes('--with-drain')
if (process.argv.slice(3).some(value => value !== '--with-drain')) throw Error('Unknown build option')
const config = validateCloudflareTestConfig(withDrain ? drainWorkerConfig(cloudflareConfig(app)) : cloudflareConfig(app))
if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Node 24 required')
for (const key of Object.keys(process.env)) {
  if (/^(?:HZY_|NUXT_|SSO_|OIDC_|DB_|MYSQL_|ALIYUN_|CLOUDFLARE_|CF_|NITRO_)/.test(key)) delete process.env[key]
}
Object.assign(process.env, config.vars)
const dir = resolve(stateDir, app)
await mkdir(dir, { recursive: true, mode: 0o700 })
await writeFile(resolve(dir, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
const { loadNuxt, buildNuxt } = await import('@nuxt/kit')
const outputDir = resolve(dir, 'output')
const nuxt = await loadNuxt({ cwd: resolve(root, app), dev: false, dotenv: false, overrides: {
  buildDir: resolve(dir, 'nuxt'),
  nitro: { preset: 'cloudflare_module', output: { dir: outputDir, serverDir: resolve(outputDir, 'server'), publicDir: resolve(outputDir, 'public') } }
} })
try { await buildNuxt(nuxt) } finally { await nuxt.close() }
if (app !== 'console') await cp(resolve(outputDir, 'public'), resolve(dir, 'assets', app), { recursive: true })

if (withDrain) {
  const boundary = await readFile(resolve(root, 'deploy/test-env/drain/worker-boundary.mjs'), 'utf8')
  const actor = { app, deployment: `C000001-test-${app}`, artifactSha256: await drainArtifactHash(resolve(outputDir, 'server'), boundary) }
  await writeFile(resolve(dir, 'worker-boundary.mjs'), boundary)
  await writeFile(resolve(dir, 'drain-entry.mjs'), `import worker from './output/server/index.mjs'\nimport { withTestDrainBoundary } from './worker-boundary.mjs'\nexport default withTestDrainBoundary(worker, ${JSON.stringify(actor)})\n`)
  await writeFile(resolve(dir, 'drain-actor.json'), JSON.stringify(actor, null, 2) + '\n')
}
