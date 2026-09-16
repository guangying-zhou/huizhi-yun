import { cp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { appConfig, validateLocalConfig, root, stateDir } from './worker-config.mjs'

const app = process.argv[2]
const config = validateLocalConfig(appConfig(app))
if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Node 24 required')
// Drop inherited application/credential variables. Nuxt dotenv loading is disabled.
for (const key of Object.keys(process.env)) {
  if (/^(?:HZY_|NUXT_|SSO_|OIDC_|DB_|MYSQL_|ALIYUN_|CLOUDFLARE_|CF_|NITRO_)/.test(key)) delete process.env[key]
}
Object.assign(process.env, config.vars)
await mkdir(stateDir, { recursive: true, mode: 0o700 })
await mkdir(resolve(stateDir, app), { recursive: true, mode: 0o700 })
await writeFile(resolve(stateDir, app, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
const { loadNuxt, buildNuxt } = await import('@nuxt/kit')
const outputDir = resolve(stateDir, app, 'output')
const nuxt = await loadNuxt({ cwd: resolve(root, app), dev: false, dotenv: false, overrides: {
  buildDir: resolve(stateDir, app, 'nuxt'),
  nitro: { preset: 'cloudflare_module', output: { dir: outputDir, serverDir: resolve(outputDir, 'server'), publicDir: resolve(outputDir, 'public') } }
} })
try { await buildNuxt(nuxt) } finally { await nuxt.close() }
if (app === 'people') {
  await cp(resolve(outputDir, 'public'), resolve(stateDir, app, 'assets/people'), { recursive: true })
}
