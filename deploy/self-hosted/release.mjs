#!/usr/bin/env node
// Host-side publisher. It does not run schema migrations or read application secrets.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { APPS, PORTS, publishDirectory, safeName, sha256File, verifyManifest } from './release-lib.mjs'

function command(executable, args) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString(); if (output.length > 16_000_000) child.kill() })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? done(output) : reject(Error(`${executable} exited ${code}`)))
  })
}

async function checkedExtract(archive, target) {
  const listing = await command('tar', ['-tzf', archive])
  for (const raw of listing.split('\n').filter(Boolean)) {
    const path = raw.replace(/^\.\//, '')
    if (path === '' || path === '.') continue // tar's root directory entry
    if (path.startsWith('/') || path.split('/').includes('..')) throw Error('archive contains unsafe path')
  }
  const verbose = await command('tar', ['-tvzf', archive])
  for (const line of verbose.split('\n').filter(Boolean)) if (!['-', 'd'].includes(line[0])) throw Error('archive contains link or unsupported entry')
  await command('tar', ['-xzf', archive, '-C', target])
}

export async function publishIndex({ indexPath, root, restart, health, keep = 5 }) {
  if (!isAbsolute(indexPath) || !isAbsolute(root)) throw Error('index and root must be absolute')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  if (index.schema !== 'hzy-self-hosted-build.v1' || !/^[a-f0-9]{40}$/.test(index.commit) || index.nodeVersion !== 'v24.18.0' || index.os !== process.platform || index.arch !== process.arch) throw Error('build index invalid or target OS mismatch')
  safeName(index.version)
  if (!Array.isArray(index.packages) || !index.packages.length || new Set(index.packages.map(item => item.app)).size !== index.packages.length) throw Error('build package list invalid')
  const applied = []
  try {
    await mkdir(root, { recursive: true })
    // Start the edge process last, regardless of build-package order.
    const order = ['platform', 'console', 'workflow', 'aims', 'codocs', 'collab', 'enterprise', 'gateway']
    for (const item of [...index.packages].sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app))) {
      if (!APPS.includes(item.app) || item.archive !== `${item.app}-${index.version}.tar.gz` || !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('build package descriptor invalid')
      const archive = join(resolve(indexPath, '..'), item.archive)
      if ((await stat(archive)).size !== item.bytes || await sha256File(archive) !== item.sha256) throw Error(`archive hash mismatch: ${item.app}`)
      const staging = await mkdtemp(join(root, `.staging-${item.app}-`))
      try {
        await checkedExtract(archive, staging)
        await verifyManifest(staging, { app: item.app, version: index.version, commit: index.commit })
        const result = await publishDirectory({ root, app: item.app, version: index.version, staged: staging, restart, health, keep })
        applied.push(result)
      } finally { await rm(staging, { recursive: true, force: true }) }
    }
  } catch (error) {
    // A failed app is rolled back by publishDirectory. Previously switched apps
    // must also return to the exact prior release, in reverse dependency order.
    for (const item of applied.reverse()) {
      const current = join(root, item.app, 'current')
      const temporary = `${current}.rollback-${process.pid}`
      await rm(temporary, { force: true })
      if (item.previous) {
        const { symlink, rename } = await import('node:fs/promises')
        await symlink(item.previous, temporary)
        await rename(temporary, current)
      } else await rm(current, { force: true })
      await restart(item.app).catch(() => {})
    }
    throw error
  }
  return applied
}

export async function localHealth(app, { port: portOverride, attempts = 20, fetch: request = globalThis.fetch } = {}) {
  const port = portOverride ?? (app === 'gateway' ? PORTS.gatewayHealth : PORTS[app])
  const path = app === 'gateway' ? '/readyz' : app === 'collab' ? '/healthz' : app === 'aims' ? '/aims/' : app === 'platform' ? '/admin' : `/${app}/`
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
      // Collab's root and unknown paths answer 200 too; only its own health document counts.
      if (app === 'collab') {
        const body = await response.json().catch(() => null)
        if (response.status === 200 && body?.data?.healthy === true) return
      } else if (response.status >= 200 && response.status < 500 && response.status !== 404) return
    } catch { /* bounded retry during restart */ }
    await new Promise(done => setTimeout(done, 1000))
  }
  throw Error(`health probe failed: ${app}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { index: { type: 'string' }, root: { type: 'string' }, keep: { type: 'string', default: '5' } } })
  if (!values.index || !values.root || !/^\d+$/.test(values.keep)) throw Error('usage: release.mjs --index ABSOLUTE/index.json --root /home/hzy/apps [--keep 5]')
  const result = await publishIndex({ indexPath: values.index, root: values.root,
    restart: app => command('systemctl', ['restart', app === 'gateway' ? 'hzy-tenant-gateway.service' : `hzy-${app}.service`]), health: localHealth, keep: Number(values.keep) })
  console.log(JSON.stringify(result))
}
