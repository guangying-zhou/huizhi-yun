#!/usr/bin/env node
// Local, deploy-free artifact assembly. Run from a clean checkout of the release commit.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { schedulerWorkerConfig } from '../aims/deploy/cloudflare/scheduler-worker-config.mjs'
import { assertAimsSchedulerArtifact } from './assert-aims-scheduler-artifact.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Node 24 is required for release builds')
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) {
  throw Error('usage: node deploy/build-pilot-artifacts.mjs --out /absolute/local/directory')
}
const out = resolve(args[1])
if (out === root || out.startsWith(root + '/')) throw Error('output must be outside the source checkout')
if (existsSync(out) && readdirSync(out).length) throw Error('output directory must be empty')

function run(command, argv, cwd, env = process.env) {
  const result = spawnSync(command, argv, { cwd, env, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw Error(`${command} ${argv.join(' ')} failed: ${result.error?.message || result.status}`)
}

function capture(command, argv, cwd) {
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw Error(`${command} ${argv.join(' ')} failed: ${result.stderr || result.error?.message}`)
  return result.stdout.trim()
}

function assertClean() {
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], root)
  if (status) throw Error(`refusing dirty source tree:\n${status}`)
}

assertClean()
const commit = capture('git', ['rev-parse', 'HEAD'], root)
if (!/^[a-f0-9]{40}$/.test(commit) || commit.includes('-dirty')) throw Error('invalid release commit')
const runtimeVersion = readFileSync(join(root, 'data-runtime/VERSION'), 'utf8').trim()
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(runtimeVersion) || runtimeVersion.includes('-dirty')) throw Error('invalid Runtime version')

mkdirSync(out, { recursive: true, mode: 0o700 })
const buildAt = new Date().toISOString()
const runtimeName = 'hzy-data-runtime-linux-amd64'
const runtimePath = join(out, runtimeName)
const module = 'github.com/huizhi-yun/data-runtime/internal/version'
const ldflags = `-s -w -X ${module}.Version=${runtimeVersion} -X ${module}.Commit=${commit} -X ${module}.BuiltAt=${buildAt}`
run('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags', ldflags, '-o', runtimePath, './cmd/hzy-data-runtime'], join(root, 'data-runtime'), {
  ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0'
})

// Build without any local dotenv, dev server, HMR, or deploy command. Deployment
// bindings/secrets are deliberately supplied later by the approved environment plan.
const checkEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:HZY_|NUXT_|SSO_|OIDC_|DB_|MYSQL_|CLOUDFLARE_|CF_)/.test(key)))
Object.assign(checkEnv, { NODE_ENV: 'production', NUXT_TELEMETRY_DISABLED: '1' })
const buildEnv = { ...checkEnv, HZY_CLOUDFLARE_BUILD: 'true' }
// Nuxt layers have their own generated TypeScript configs. A clean checkout
// with an offline install that skipped lifecycle scripts needs these prepared.
run('pnpm', ['-r', '--if-present', 'run', 'postinstall'], root, checkEnv)
run('node', ['enterprise/scripts/check-business-module-aliases.mjs'], root, checkEnv)
for (const owner of ['aims', 'assets', 'codocs', 'altoc']) run('pnpm', ['--dir', owner, 'typecheck'], root, checkEnv)
const artifacts = [{ component: 'runtime', version: runtimeVersion, file: runtimeName }]
for (const app of ['enterprise', 'console', 'workflow', 'aims']) {
  const appDir = join(root, app)
  run('pnpm', ['exec', 'nuxt', 'build', '--preset=cloudflare_module'], appDir,
    app === 'aims' ? { ...buildEnv, HZY_AIMS_SCHEDULER_ONLY: 'true' } : buildEnv)
  const server = join(appDir, '.output/server/index.mjs')
  const pub = join(appDir, '.output/public')
  if (!existsSync(server) || (app !== 'aims' && !existsSync(pub))) throw Error(`${app} Cloudflare output incomplete`)
  const name = `${app}-worker.tar.gz`
  if (app === 'aims') {
    for (const environment of ['production', 'staging']) {
      const config = schedulerWorkerConfig(environment)
      assertAimsSchedulerArtifact(join(appDir, '.output/server'), config)
      writeFileSync(join(out, `wrangler.aims-scheduler.${environment}.jsonc`), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
    }
    run('tar', ['-czf', join(out, name), '-C', appDir, '.output/server',
      '-C', out, 'wrangler.aims-scheduler.production.jsonc', 'wrangler.aims-scheduler.staging.jsonc'], root)
  } else {
    run('tar', ['-czf', join(out, name), '-C', appDir, '.output/server', '.output/public'], root)
  }
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  artifacts.push({ component: app, version: pkg.version || `commit-${commit.slice(0, 12)}`, file: name })
}

const gatewayDir = join(root, 'deploy/cloudflare/tenant-gateway')
const gatewayName = 'gateway-worker.tar.gz'
run('tar', ['-czf', join(out, gatewayName), '-C', gatewayDir, 'src', 'wrangler.jsonc'], root)
artifacts.push({ component: 'gateway', version: `commit-${commit.slice(0, 12)}`, file: gatewayName })

assertClean()
for (const item of artifacts) {
  const path = join(out, item.file)
  item.bytes = statSync(path).size
  item.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
}
const manifest = {
  schemaVersion: 1,
  sourceCommit: commit,
  builtAt: buildAt,
  sourceClean: true,
  deploymentPerformed: false,
  artifacts
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
console.log(`Local artifacts and manifest: ${out}`)
