#!/usr/bin/env node
// Builds from an exact Git commit in a disposable clean worktree. No deployment.
import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { bundleCollab } from './bundle-collab.mjs'
import { APPS, BASE_PATHS, createManifest, sha256File, safeName, verifyManifest } from './release-lib.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { values } = parseArgs({ options: { commit: { type: 'string' }, version: { type: 'string' }, out: { type: 'string' }, apps: { type: 'string' } } })

function run(command, args, cwd, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolveRun() : reject(Error(`${command} exited ${code}`)))
  })
}

async function output(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    let result = ''
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    child.stdout.on('data', chunk => { result += chunk })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolveRun(result.trim()) : reject(Error(`${command} exited ${code}`)))
  })
}

export async function buildRelease({ commit, version, out, apps = APPS }) {
  safeName(version)
  if (!isAbsolute(out)) throw Error('--out must be absolute')
  if (!Array.isArray(apps) || apps.length === 0 || new Set(apps).size !== apps.length || apps.some(app => !APPS.includes(app))) throw Error('unknown or duplicate app')
  const sha = await output('git', ['rev-parse', '--verify', `${commit}^{commit}`], repo)
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('commit SHA invalid')
  const node = (await readFile(join(repo, '.nvmrc'), 'utf8')).trim()
  const engines = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).engines?.node
  if (process.version !== `v${node}` || engines !== '>=24.18.0 <25') throw Error('Node must match .nvmrc and engines')
  const worktree = await mkdtemp(join(tmpdir(), 'hzy-g4-build-'))
  // mkdtemp creates the directory; git worktree requires it to be absent.
  await rm(worktree, { recursive: true })
  let attached = false
  try {
    await run('git', ['worktree', 'add', '--detach', worktree, sha], repo)
    attached = true
    if (await output('git', ['status', '--porcelain'], worktree)) throw Error('worktree is not clean')
    await run('corepack', ['pnpm', 'install', '--offline', '--frozen-lockfile'], worktree)
    const productionEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
    productionEnv.NODE_ENV = 'production'
    productionEnv.NITRO_PRESET = 'node-server'
    productionEnv.NUXT_NITRO_PRESET = 'node-server'
    productionEnv.HZY_APP_RUN_MODE = 'prod'
    productionEnv.HZY_PLATFORM_ENVIRONMENT = 'prod'
    // Public topology influences Nuxt's compiled routes and UI. No secret or
    // tenant credential is ever passed into the build environment.
    productionEnv.HZY_DEPLOYMENT_PUBLIC_URL = 'https://aidcp.wiztek.cn'
    productionEnv.HZY_CONSOLE_URL = 'https://aidcp.wiztek.cn/console'
    productionEnv.HZY_PLATFORM_URL = 'https://hzy.wiztek.cn'
    const packages = []
    await mkdir(out, { recursive: true })
    for (const app of apps) {
      const started = Date.now()
      const env = { ...productionEnv, NUXT_APP_BASE_URL: BASE_PATHS[app], HZY_APP_CODE: app }
      if (app === 'aims') env.HZY_AIMS_SCHEDULER_ONLY = 'true'
      if (app === 'enterprise') {
        Object.assign(env, {
          HZY_ENTERPRISE_PILOT: 'true',
          HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED: 'true',
          HZY_ENTERPRISE_WORKFLOW_ORIGIN: 'http://127.0.0.1:31003',
          HZY_ENTERPRISE_OIDC_REDIRECT_URI: 'https://aidcp.wiztek.cn/enterprise/api/auth/oidc-callback',
          HZY_ENTERPRISE_LOGOUT_REDIRECT_URI: 'https://aidcp.wiztek.cn/enterprise/login'
        })
      }
      // Standalone Collab is a plain Node service (no Nuxt): esbuild bundle of collab/src/server.ts.
      if (app !== 'gateway' && app !== 'collab') await run('corepack', ['pnpm', '--dir', app, 'exec', 'nuxt', 'build', '--dotenv', '/dev/null'], worktree, env)
      const packageDir = join(out, `${app}-${version}`)
      await mkdir(packageDir, { recursive: false })
      if (app === 'gateway') {
        for (const path of ['deploy/self-hosted/gateway', 'deploy/cloudflare/tenant-gateway/src', 'foundation/shared',
          'deploy/test-env/enterprise-host-routes.mjs', 'deploy/test-env/enterprise-topology.mjs',
          // imported by gateway/config.mjs (../collab-deployment.mjs); rc3 shipped without it and needed a manual copy
          'deploy/self-hosted/collab-deployment.mjs']) {
          await mkdir(dirname(join(packageDir, path)), { recursive: true })
          await cp(join(worktree, path), join(packageDir, path), { recursive: true, filter: source => !source.includes('/test/') })
        }
        await writeFile(join(packageDir, 'package.json'), '{"private":true,"type":"module"}\n')
      } else if (app === 'collab') {
        await bundleCollab({ repo: worktree, outDir: packageDir })
      } else {
        // Nitro may emit symlinks into its dependency tree. Release packages
        // contain only ordinary files so manifest verification is self-contained.
        await cp(join(worktree, app, '.output'), join(packageDir, '.output'), { recursive: true, dereference: true })
      }
      const manifest = await createManifest(packageDir, { app, version, commit: sha, nodeVersion: process.version })
      await writeFile(join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
      await verifyManifest(packageDir, { app, version, commit: sha })
      const archive = join(out, `${app}-${version}.tar.gz`)
      await run('tar', ['-czf', archive, '-C', packageDir, '.'], worktree)
      packages.push({ app, archive: archive.split('/').at(-1), sha256: await sha256File(archive), bytes: (await stat(archive)).size, elapsedMs: Date.now() - started })
    }
    const index = { schema: 'hzy-self-hosted-build.v1', version, commit: sha, nodeVersion: process.version, os: process.platform, arch: process.arch, packages }
    await writeFile(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n')
    return index
  } finally {
    if (attached) await run('git', ['worktree', 'remove', '--force', worktree], repo).catch(() => {})
    else await rm(worktree, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!values.commit || !values.version || !values.out) throw Error('usage: build.mjs --commit SHA --version VERSION --out ABSOLUTE_DIR [--apps app,app]')
  const result = await buildRelease({ commit: values.commit, version: values.version, out: values.out, apps: values.apps ? values.apps.split(',') : APPS })
  console.log(JSON.stringify(result, null, 2))
}
