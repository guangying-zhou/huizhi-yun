import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(rootDir, '.wrangler.generated.jsonc')

if (!existsSync(configPath)) {
  console.error('Missing .wrangler.generated.jsonc. Run `pnpm run cloudflare:config` before building.')
  process.exit(1)
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const env = {
  ...process.env,
  ...(config.vars || {})
}

const result = spawnSync('pnpm', ['exec', 'nuxt', 'build', '--preset=cloudflare_module'], {
  cwd: rootDir,
  env,
  stdio: 'inherit'
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status || 0)
