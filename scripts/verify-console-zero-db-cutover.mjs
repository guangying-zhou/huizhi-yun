#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)

function option(name) {
  const index = args.findIndex(item => item === name || item.startsWith(`${name}=`))
  if (index < 0) return ''
  const item = args[index]
  return item.includes('=') ? item.slice(item.indexOf('=') + 1) : String(args[index + 1] || '')
}

function fail(message) {
  throw new Error(message)
}

function writeEvidence(evidence) {
  const evidenceFile = option('--evidence-file')
  if (!evidenceFile) return

  const output = resolve(process.cwd(), evidenceFile)
  mkdirSync(dirname(output), { recursive: true })
  try {
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail(`evidence file already exists and will not be overwritten: ${output}`)
    }
    throw error
  }
  console.info(`[console-zero-db-cutover] evidence=${output}`)
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function json(path) {
  return JSON.parse(read(path))
}

function assertAbsent(source, pattern, label) {
  if (pattern.test(source)) fail(`${label} still contains ${pattern}`)
}

function runAudit() {
  const result = spawnSync(process.execPath, ['scripts/audit-console-db-boundary.mjs', '--json'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (result.status !== 0) fail(result.stderr.trim() || 'Console DB boundary audit failed')
  const report = JSON.parse(result.stdout)
  if (report.summary.files !== 0 || report.summary.callSites !== 0) {
    fail(`Console DB boundary is not zero: files=${report.summary.files}, calls=${report.summary.callSites}`)
  }
}

function verifyStaticBoundary() {
  runAudit()

  const schemaManifest = spawnSync(process.execPath, ['scripts/generate-console-runtime-schema-manifest.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (schemaManifest.status !== 0) {
    fail(schemaManifest.stderr.trim() || 'Console Runtime schema manifest validation failed')
  }

  if (existsSync(resolve(root, 'console/server/utils/db.ts'))) {
    fail('console/server/utils/db.ts must be deleted')
  }

  const pkg = json('console/package.json')
  if (pkg.dependencies?.mysql2 || pkg.devDependencies?.mysql2) {
    fail('console/package.json must not depend on mysql2')
  }

  const forbiddenSecretPattern = /HZY_CONSOLE_VAULT_MASTER_KEY|CONSOLE_VAULT_MASTER_KEY|CONSOLE_AUTH_SIGNING_PRIVATE_JWK/
  assertAbsent(read('console/nuxt.config.ts'), forbiddenSecretPattern, 'console/nuxt.config.ts')
  assertAbsent(read('console/server/utils/platformRuntime.ts'), forbiddenSecretPattern, 'Console platform runtime')
  assertAbsent(read('console/server/utils/authorizationSimulation.ts'), /CONSOLE_AUTH_SIGNING_PRIVATE_JWK/, 'authorization simulation')

  const pm2 = read('console/ecosystem.config.cjs')
  if (!/delete fileEnv\[key\]/.test(pm2)) fail('Console PM2 config must strip DB and tenant secret variables')
  const devStack = read('deploy/dev-stack/ecosystem.config.cjs')
  if (!/appCode === 'console'[\s\S]{0,900}delete env\[key\]/.test(devStack)) {
    fail('dev-stack must strip DB variables from the Console process')
  }

  const cloudflare = spawnSync(process.execPath, ['scripts/validate-console-cloudflare-config.mjs'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (cloudflare.status !== 0) fail(cloudflare.stderr.trim() || 'Cloudflare zero-DB validation failed')
}

async function verifyLiveRuntime() {
  const runtimeUrl = option('--runtime-url')
  if (!runtimeUrl) return null

  const baseUrl = runtimeUrl.replace(/\/+$/, '')
  const health = await fetch(`${baseUrl}/runtime/health`, {
    signal: AbortSignal.timeout(10_000)
  })
  if (!health.ok) fail(`Tenant Runtime health failed: HTTP ${health.status}`)
  const healthPayload = await health.json()
  if (healthPayload?.runtimeProduct !== 'hzy-data-runtime') {
    fail(`Runtime endpoint is not hzy-data-runtime: ${String(healthPayload?.runtimeProduct || 'unknown')}`)
  }
  const healthStatus = String(healthPayload?.status || '').toLowerCase()
  if (healthStatus !== 'ok') fail(`Tenant Runtime health is not ready: ${healthStatus || 'unknown'}`)
  if (healthPayload?.apps?.console?.enabled !== true || healthPayload?.apps?.console?.db !== 'ok') {
    fail('Console Runtime adapter is not enabled with a healthy database')
  }

  const tokenEnv = option('--schema-token-env')
  if (!tokenEnv) {
    return {
      url: baseUrl,
      health: healthPayload,
      cutover: null
    }
  }
  const token = String(process.env[tokenEnv] || '').trim()
  if (!token) fail(`schema token env is empty: ${tokenEnv}`)

  const schema = await fetch(`${baseUrl}/runtime/schema/status?app=console&mode=cutover`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000)
  })
  if (!schema.ok) fail(`Console Runtime schema readiness failed: HTTP ${schema.status}`)
  const payload = await schema.json()
  const status = String(payload?.status || payload?.data?.status || '').toLowerCase()
  if (status !== 'ready') {
    fail(`Console Runtime schema is not ready: ${status}`)
  }
  const blockers = payload?.blockers || payload?.data?.blockers
  if (!Array.isArray(blockers) || blockers.length > 0) {
    fail(`Console Runtime cutover blockers remain: ${Array.isArray(blockers) ? blockers.join(',') : 'invalid response'}`)
  }
  const schemaEvidence = payload?.schema || payload?.data?.schema
  if (!schemaEvidence || schemaEvidence.status !== 'ok' ||
    !String(schemaEvidence.schemaRevision || '').startsWith('sha256:') ||
    !Array.isArray(schemaEvidence.missingTables) || schemaEvidence.missingTables.length > 0 ||
    !Array.isArray(schemaEvidence.missingColumns) || schemaEvidence.missingColumns.length > 0 ||
    !Array.isArray(schemaEvidence.missingIndexes) || schemaEvidence.missingIndexes.length > 0 ||
    !Array.isArray(schemaEvidence.missingConstraints) || schemaEvidence.missingConstraints.length > 0) {
    fail('Console Runtime schema evidence is incomplete or contains gaps')
  }
  return {
    url: baseUrl,
    health: healthPayload,
    cutover: payload
  }
}

async function verifyLiveConsoleProfile() {
  const consoleUrl = option('--console-url')
  if (!consoleUrl) return null

  const response = await fetch(consoleUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) fail(`Console deployment profile probe failed: HTTP ${response.status}`)
  const html = await response.text()
  const profile = html.match(/\bdeploymentProfile\s*:\s*["']([^"']+)["']/)?.[1] || ''
  if (!profile) fail('Console deployment profile is missing from the public application config')
  if (profile.includes('direct-db')) {
    fail(`Console still advertises a direct-DB deployment profile: ${profile}`)
  }
  return {
    url: response.url,
    deploymentProfile: profile
  }
}

try {
  verifyStaticBoundary()
  const consoleEvidence = await verifyLiveConsoleProfile()
  const runtimeEvidence = await verifyLiveRuntime()
  writeEvidence({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verifier: 'verify-console-zero-db-cutover',
    staticBoundary: {
      status: 'pass'
    },
    console: consoleEvidence,
    runtime: runtimeEvidence
  })
  console.info('[console-zero-db-cutover] passed')
} catch (error) {
  console.error(`[console-zero-db-cutover] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
