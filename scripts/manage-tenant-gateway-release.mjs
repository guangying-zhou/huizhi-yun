#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = 'manage-tenant-gateway-release'
const WRANGLER_VERSION = '4.110.0'
const CONFIG_PATH = 'deploy/cloudflare/tenant-gateway/wrangler.jsonc'
const MANIFEST_PATH = 'docs/release/P3-P4-2026-07.release.json'
const TEST_DIR = 'deploy/cloudflare/tenant-gateway/test'
const SENSITIVE = /(authorization|cookie|password|secret|token)/i

export class GatewayReleaseConfigurationError extends Error {}

export function usage() {
  return `Usage (preview only):
  pnpm run gateway:release -- --action deploy --operator <uid> --change-id <id>
  pnpm run gateway:release -- --action rollback --version-id <exact-id> --operator <uid> --change-id <id>

Execution additionally requires a locked release contract and exact preview SHA:
  ... --execute --confirm <confirmation-sha256> [--evidence-file <path>] [--manifest-file <path>]

Deploy executes tests, Wrangler dry-run, pre-deploy version read, deploy, and
post-deploy version read. Rollback uses the exact supplied Cloudflare version
ID and then reads the resulting deployments. Failures stop immediately; no
automatic retry, rollback, secret mutation, or binding/storage rollback occurs.`
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
}

function consumeOption(argv, index, raw) {
  const equalsIndex = raw.indexOf('=')
  const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
  const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
  if (!value || value.startsWith('--')) throw new GatewayReleaseConfigurationError(`missing value for --${name}`)
  return { name, value, nextIndex: equalsIndex >= 0 ? index : index + 1 }
}

export function parseArgs(argv) {
  const args = { action: '', versionId: '', operator: '', changeId: '', confirm: '', evidenceFile: '', manifestFile: MANIFEST_PATH, execute: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--') continue
    if (raw === '--help' || raw === '-h') { args.help = true; continue }
    if (raw === '--execute') { args.execute = true; continue }
    if (!raw.startsWith('--')) throw new GatewayReleaseConfigurationError(`unexpected argument: ${raw}`)
    const optionName = raw.slice(2).split('=', 1)[0]
    if (SENSITIVE.test(optionName)) throw new GatewayReleaseConfigurationError(`--${optionName} is forbidden`)
    const option = consumeOption(argv, index, raw.slice(2))
    index = option.nextIndex
    switch (option.name) {
      case 'action': args.action = option.value; break
      case 'version-id': args.versionId = option.value; break
      case 'operator': args.operator = option.value; break
      case 'change-id': args.changeId = option.value; break
      case 'confirm': args.confirm = option.value; break
      case 'evidence-file': args.evidenceFile = option.value; break
      case 'manifest-file': args.manifestFile = option.value; break
      default: throw new GatewayReleaseConfigurationError(`unknown option: --${option.name}`)
    }
  }
  if (args.help) return args
  if (!['deploy', 'rollback'].includes(args.action)) throw new GatewayReleaseConfigurationError('--action must be deploy or rollback')
  for (const [name, value] of [['operator', args.operator], ['change-id', args.changeId]]) {
    if (!value || !/^[A-Za-z0-9._:@/-]{1,128}$/.test(value)) {
      throw new GatewayReleaseConfigurationError(`--${name} is required and must use safe characters`)
    }
  }
  if (args.action === 'rollback' && !/^[A-Za-z0-9-]{8,128}$/.test(args.versionId)) {
    throw new GatewayReleaseConfigurationError('--version-id must be an exact Cloudflare version ID for rollback')
  }
  if (args.action === 'deploy' && args.versionId) throw new GatewayReleaseConfigurationError('--version-id is only valid for rollback')
  return args
}

function wrangler(...args) {
  return ['corepack', 'pnpm', 'dlx', `wrangler@${WRANGLER_VERSION}`, ...args, '--config', CONFIG_PATH]
}

export function buildGatewayPlan(args, {
  rootDir = ROOT,
  manifest: injectedManifest,
  readFile = readFileSync,
  listFiles = readdirSync
} = {}) {
  const manifestPath = args.manifestFile || MANIFEST_PATH
  const manifestBytes = readFile(resolve(rootDir, manifestPath))
  const manifest = injectedManifest || JSON.parse(manifestBytes.toString('utf8'))
  const configBytes = readFile(resolve(rootDir, CONFIG_PATH))
  const config = JSON.parse(configBytes.toString('utf8'))
  if (config.name !== 'hzy-tenant-gateway') throw new GatewayReleaseConfigurationError('unexpected Tenant Gateway Worker name')
  if (manifest.deploymentPlan?.wranglerVersion !== WRANGLER_VERSION) {
    throw new GatewayReleaseConfigurationError(`release contract must pin Wrangler ${WRANGLER_VERSION}`)
  }

  const testFiles = listFiles(resolve(rootDir, TEST_DIR))
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => `${TEST_DIR}/${name}`)
  if (testFiles.length === 0) throw new GatewayReleaseConfigurationError('Tenant Gateway tests are missing')
  const sources = [
    { path: manifestPath, sha256: sha256(manifestBytes) },
    { path: CONFIG_PATH, sha256: sha256(configBytes) },
    { path: 'scripts/manage-tenant-gateway-release.mjs', sha256: sha256(readFile(resolve(rootDir, 'scripts/manage-tenant-gateway-release.mjs'))) },
    { path: 'package.json', sha256: sha256(readFile(resolve(rootDir, 'package.json'))) },
    ...testFiles.map(path => ({ path, sha256: sha256(readFile(resolve(rootDir, path))) }))
  ]
  const listCommand = code => ({ code, argv: wrangler('deployments', 'list', '--json') })
  const commands = args.action === 'deploy'
    ? [
        { code: 'gateway.tests', argv: [process.execPath, '--test', ...testFiles] },
        { code: 'gateway.dry_run', argv: wrangler('deploy', '--dry-run') },
        listCommand('gateway.deployments.before'),
        { code: 'gateway.deploy', argv: wrangler('deploy') },
        listCommand('gateway.deployments.after')
      ]
    : [
        listCommand('gateway.deployments.before'),
        {
          code: 'gateway.rollback',
          argv: wrangler('rollback', args.versionId, '--message', args.changeId, '--yes')
        },
        listCommand('gateway.deployments.after')
      ]
  const summary = {
    schemaVersion: 1,
    action: args.action,
    releaseId: manifest.releaseId,
    releaseState: manifest.state,
    operator: args.operator,
    changeId: args.changeId,
    workerName: config.name,
    routes: (config.routes || []).map(route => route.pattern).sort(),
    wranglerVersion: WRANGLER_VERSION,
    rollbackVersionId: args.action === 'rollback' ? args.versionId : null,
    sources,
    commands,
    automaticRetry: false,
    automaticRollback: false,
    secretMutation: false
  }
  return { ...summary, confirmationSha256: sha256(summary) }
}

function extractDeploymentIds(output) {
  let parsed
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new GatewayReleaseConfigurationError('Wrangler deployments list did not return JSON')
  }
  const ids = new Set()
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && /^(id|version_id|versionId|deployment_id|deploymentId)$/.test(key)) ids.add(child)
      else visit(child)
    }
  }
  visit(parsed)
  if (ids.size === 0) throw new GatewayReleaseConfigurationError('Wrangler deployments JSON contained no version/deployment ID')
  return [...ids].sort()
}

function defaultRunner(argv, cwd) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  return { exitCode: result.status ?? 1, stdout: result.stdout || '', error: result.error }
}

export function executeGatewayPlan(args, {
  rootDir = ROOT,
  manifest,
  runner = defaultRunner,
  now = () => new Date(),
  readFile,
  listFiles
} = {}) {
  const plan = buildGatewayPlan(args, { rootDir, manifest, readFile, listFiles })
  if (!args.execute) return { mode: 'preview', plan }
  if (plan.releaseState !== 'locked') throw new GatewayReleaseConfigurationError('release contract must be locked before Gateway execution')
  if (!/^[a-f0-9]{64}$/.test(args.confirm) || args.confirm !== plan.confirmationSha256) {
    throw new GatewayReleaseConfigurationError('--confirm must exactly match the current preview confirmation SHA-256')
  }

  const startedAt = now().toISOString()
  const checks = []
  let status = 'passed'
  let beforeDeploymentIds = []
  let afterDeploymentIds = []
  for (const command of plan.commands) {
    const started = Date.now()
    const result = runner(command.argv, rootDir)
    const check = { code: command.code, exitCode: result.exitCode, durationMs: Date.now() - started, result: result.exitCode === 0 ? 'PASS' : 'FAIL' }
    if (result.error) check.error = 'command_start_failed'
    if (result.exitCode === 0 && command.code.includes('deployments.')) {
      try {
        const ids = extractDeploymentIds(result.stdout)
        check.deploymentIds = ids
        if (command.code.endsWith('.before')) beforeDeploymentIds = ids
        if (command.code.endsWith('.after')) afterDeploymentIds = ids
      } catch {
        check.result = 'FAIL'
        check.error = 'deployment_id_projection_failed'
      }
    }
    checks.push(check)
    if (check.result !== 'PASS') { status = 'failed'; break }
  }
  const completedAt = now().toISOString()
  return {
    mode: 'execute',
    exitCode: status === 'passed' ? 0 : 1,
    evidence: {
      schemaVersion: 1,
      releaseId: plan.releaseId,
      action: plan.action,
      operator: plan.operator,
      changeId: plan.changeId,
      confirmationSha256: plan.confirmationSha256,
      workerName: plan.workerName,
      rollbackVersionId: plan.rollbackVersionId,
      startedAt,
      completedAt,
      status,
      writeState: status === 'passed' ? 'requested_action_completed' : 'partial_or_unknown',
      beforeDeploymentIds,
      afterDeploymentIds,
      automaticRetry: false,
      automaticRollback: false,
      secretMutation: false,
      checks
    }
  }
}

export function writeEvidence(path, evidence, { cwd = process.cwd() } = {}) {
  const absolutePath = resolve(cwd, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, absolutePath)
  chmodSync(absolutePath, 0o600)
  if ((statSync(absolutePath).mode & 0o777) !== 0o600) throw new Error('failed to enforce evidence mode 0600')
  return absolutePath
}

function defaultEvidencePath(action, date = new Date()) {
  return `build/release/g2-6/gateway-${action}-${date.toISOString().replaceAll(':', '').replaceAll('.', '-')}.json`
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) { console.info(usage()); return }
    const result = executeGatewayPlan(args)
    if (result.mode === 'preview') {
      console.info(`[${SCRIPT}] PREVIEW ONLY; no command or network request was executed`)
      for (const command of result.plan.commands) console.info(`[${SCRIPT}] ${command.code}: ${command.argv.join(' ')}`)
      console.info(`[${SCRIPT}] releaseState=${result.plan.releaseState}`)
      console.info(`[${SCRIPT}] confirmationSha256=${result.plan.confirmationSha256}`)
      return
    }
    for (const check of result.evidence.checks) console.info(`[${SCRIPT}] ${check.result} ${check.code}`)
    const evidencePath = writeEvidence(args.evidenceFile || defaultEvidencePath(args.action), result.evidence)
    console.info(`[${SCRIPT}] evidence=${evidencePath}`)
    if (result.exitCode !== 0) console.error(`[${SCRIPT}] stopped without retry or automatic rollback`)
    process.exitCode = result.exitCode
  } catch (error) {
    if (error instanceof GatewayReleaseConfigurationError) {
      console.error(`[${SCRIPT}] ${error.message}`)
      process.exitCode = 2
      return
    }
    console.error(`[${SCRIPT}] unexpected operational failure; no retry or automatic rollback attempted`)
    process.exitCode = 3
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
