#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_MANIFEST = 'docs/release/P3-P4-2026-07.release.json'
const SCRIPT = 'plan-g2-6-release-drill'

const EXPECTED_STAGES = [
  'preflight',
  'schema-prerequisites',
  'data-runtime',
  'control-plane',
  'service-grants-and-bundle',
  'tenant-gateway',
  'people',
  'business-bridges',
  'acceptance',
  'rollback-drills'
]

const REQUIRED_REMOTE_ANCHORS = [
  'schema.businessFactsFingerprint',
  'dataRuntime.currentVersion',
  'dataRuntime.currentArtifactSha256',
  'dataRuntime.targetArtifactSha256',
  'dataRuntime.signingKeyId',
  'dataRuntime.autoUpdateState',
  'platform.releaseId',
  'cloudflare.console.deploymentId',
  'cloudflare.gateway.deploymentId',
  'cloudflare.people.deploymentId',
  'cloudflare.assets.deploymentId',
  'cloudflare.codocs.deploymentId',
  'cloudflare.finance.deploymentId',
  'cloudflare.aims.deploymentId',
  'cloudflare.altoc.deploymentId',
  'serviceGrants.fingerprint',
  'policyBundle.version',
  'policyBundle.sha256'
]

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token)/i

export class ReleasePlanConfigurationError extends Error {}

export function usage() {
  return `Usage (offline preview; sends no requests and runs no deployment command):
  pnpm run plan:g2-6-release -- \\
    --operator <uid> \\
    --change-id <approved-change-id> \\
    [--snapshot-file <reviewed-offline-snapshot.json>] \\
    [--plan-file <output.json>]

The snapshot supplies exact pre-deploy version and rollback anchors. The command
hashes the release contract and operational sources, validates the fixed stage
order, reports missing anchors, and emits confirmationSha256. It never deploys,
connects to a database, refreshes a bundle, or performs rollback. Sensitive
arguments such as --token, --cookie, --password, --secret, and --authorization
are forbidden.`
}

function consumeOption(argv, index, raw) {
  const equalsIndex = raw.indexOf('=')
  const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
  const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
  if (!value || value.startsWith('--')) throw new ReleasePlanConfigurationError(`missing value for --${name}`)
  return { name, value, nextIndex: equalsIndex >= 0 ? index : index + 1 }
}

export function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    snapshotFile: '',
    planFile: '',
    operator: '',
    changeId: '',
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--') continue
    if (raw === '--help' || raw === '-h') { args.help = true; continue }
    if (!raw.startsWith('--')) throw new ReleasePlanConfigurationError(`unexpected argument: ${raw}`)
    const optionName = raw.slice(2).split('=', 1)[0]
    if (SENSITIVE_KEY.test(optionName)) {
      throw new ReleasePlanConfigurationError(`--${optionName} is forbidden; the offline plan must not receive credentials`)
    }
    if (optionName === 'execute' || optionName === 'deploy' || optionName === 'rollback') {
      throw new ReleasePlanConfigurationError(`--${optionName} is not supported by the offline planner`)
    }
    const option = consumeOption(argv, index, raw.slice(2))
    index = option.nextIndex
    switch (option.name) {
      case 'manifest': args.manifest = option.value; break
      case 'snapshot-file': args.snapshotFile = option.value; break
      case 'plan-file': args.planFile = option.value; break
      case 'operator': args.operator = option.value; break
      case 'change-id': args.changeId = option.value; break
      default: throw new ReleasePlanConfigurationError(`unknown option: --${option.name}`)
    }
  }
  for (const [name, value] of [['operator', args.operator], ['change-id', args.changeId]]) {
    if (value && !/^[A-Za-z0-9._:@/-]{1,128}$/.test(value)) {
      throw new ReleasePlanConfigurationError(`--${name} contains unsupported characters`)
    }
  }
  return args
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
}

function componentCodes(components = []) {
  return components.map(component => typeof component === 'string' ? component : component.code)
}

export function validateDeploymentPlan(manifest) {
  const errors = []
  if (manifest.schemaVersion !== 2) errors.push('manifest schemaVersion must be 2')
  const repositories = new Set((manifest.repositories || []).map(item => item.name))
  for (const required of ['root', 'platform', 'console', 'people', 'assets', 'codocs', 'finance', 'workflow', 'aims', 'altoc']) {
    if (!repositories.has(required)) errors.push(`manifest repositories missing ${required}`)
  }
  const plan = manifest.deploymentPlan
  if (!plan) errors.push('manifest deploymentPlan is required')
  if (plan?.tenant !== 'wiztek' || plan?.environment !== 'production') errors.push('deploymentPlan must target wiztek/production')
  if (plan?.wranglerVersion !== '4.110.0') errors.push('deploymentPlan must pin Wrangler 4.110.0')
  if (plan?.evidenceFileMode !== '0600') errors.push('deploymentPlan evidenceFileMode must be 0600')
  const stages = plan?.stages || []
  if (JSON.stringify(stages.map(item => item.code)) !== JSON.stringify(EXPECTED_STAGES)) {
    errors.push(`deployment stages must be ${EXPECTED_STAGES.join(' -> ')}`)
  }
  const byCode = Object.fromEntries(stages.map(stage => [stage.code, stage]))
  if (JSON.stringify(componentCodes(byCode['business-bridges']?.components)) !== JSON.stringify(['assets', 'codocs', 'finance', 'workflow', 'aims', 'altoc'])) {
    errors.push('business bridges must deploy target-first: assets -> codocs -> finance -> workflow -> aims -> altoc')
  }
  const platform = (byCode['control-plane']?.components || []).find(item => item.code === 'platform')
  if (platform?.deploymentMode !== 'pm2-nginx') errors.push('wiztek Platform must remain pm2-nginx unless a new release contract explicitly changes it')
  const gateway = byCode['tenant-gateway']
  if (gateway?.rollbackAnchor !== 'exact-cloudflare-version-id') errors.push('Gateway rollback must use an exact Cloudflare version ID')
  if (manifest.dataRuntime?.rollbackCommand !== 'hzy-data-runtime rollback --execute --confirm hzy-data-runtime.previous --change-id <change-id>') {
    errors.push('data-runtime guarded rollback command is missing')
  }
  if (errors.length > 0) throw new ReleasePlanConfigurationError(errors.join('; '))
}

function assertSafeSnapshot(value, path = 'snapshot') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeSnapshot(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new ReleasePlanConfigurationError(`${path}.${key} is forbidden in the offline snapshot`)
    assertSafeSnapshot(child, `${path}.${key}`)
  }
}

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value)
}

function sourcePaths(manifest, manifestLabel) {
  const sources = new Set([
    manifestLabel,
    manifest.dataRuntime.versionFile,
    manifest.dataRuntime.packageScript,
    manifest.dataRuntime.uploadScript,
    manifest.dataRuntime.releaseTest,
    'data-runtime/internal/updater/updater.go',
    'data-runtime/internal/updater/journal.go',
    'data-runtime/internal/updater/lock.go',
    'data-runtime/internal/updater/policy.go',
    'data-runtime/internal/server/runtime_update_policy.go',
    'data-runtime/cmd/hzy-data-runtime/main.go',
    'data-runtime/deploy/install.sh',
    'scripts/manage-tenant-gateway-release.mjs',
    'scripts/test/manage-tenant-gateway-release.test.mjs',
    manifest.gatewayContract.source,
    'deploy/cloudflare/tenant-gateway/wrangler.jsonc',
    'docs/release/G2-6-Release-and-Rollback-Runbook.md'
  ])
  for (const test of manifest.gatewayContract.tests || []) sources.add(test)
  for (const grant of manifest.serviceGrantContracts || []) sources.add(grant.file)
  for (const repository of ['platform', 'console', 'people', 'assets', 'codocs', 'finance', 'workflow', 'aims', 'altoc']) {
    sources.add(`${repository}/package.json`)
  }
  return [...sources].filter(Boolean).sort()
}

function resolveInsideRoot(rootDir, path) {
  const absolute = resolve(rootDir, path)
  const rel = relative(rootDir, absolute)
  if (rel.startsWith('..') || rel === '') {
    if (rel === '' && absolute !== rootDir) return absolute
    if (rel.startsWith('..')) throw new ReleasePlanConfigurationError(`path escapes workspace root: ${path}`)
  }
  return absolute
}

export function buildReleaseDrillPlan(args, {
  rootDir = ROOT,
  readFile = readFileSync,
  fileExists = existsSync,
  snapshot: injectedSnapshot
} = {}) {
  const manifestPath = resolveInsideRoot(rootDir, args.manifest)
  if (!fileExists(manifestPath)) throw new ReleasePlanConfigurationError(`missing release manifest: ${args.manifest}`)
  let manifest
  try {
    manifest = JSON.parse(readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new ReleasePlanConfigurationError(`invalid release manifest: ${error.message}`)
  }
  validateDeploymentPlan(manifest)

  let snapshot = injectedSnapshot || null
  if (!snapshot && args.snapshotFile) {
    const snapshotPath = resolveInsideRoot(rootDir, args.snapshotFile)
    if (!fileExists(snapshotPath)) throw new ReleasePlanConfigurationError(`missing offline snapshot: ${args.snapshotFile}`)
    try {
      snapshot = JSON.parse(readFile(snapshotPath, 'utf8'))
    } catch (error) {
      throw new ReleasePlanConfigurationError(`invalid offline snapshot: ${error.message}`)
    }
  }
  if (snapshot) {
    assertSafeSnapshot(snapshot)
    if (snapshot.releaseId !== manifest.releaseId || snapshot.tenant !== manifest.deploymentPlan.tenant
      || snapshot.environment !== manifest.deploymentPlan.environment) {
      throw new ReleasePlanConfigurationError('offline snapshot releaseId/tenant/environment does not match the release manifest')
    }
  }

  const manifestLabel = relative(rootDir, manifestPath) || args.manifest
  const sources = sourcePaths(manifest, manifestLabel).map(path => {
    const absolute = resolveInsideRoot(rootDir, path)
    if (!fileExists(absolute)) throw new ReleasePlanConfigurationError(`missing release source: ${path}`)
    return { path, sha256: sha256(readFile(absolute)) }
  })
  const missingRemoteAnchors = REQUIRED_REMOTE_ANCHORS.filter(anchor => !String(getPath(snapshot, anchor) ?? '').trim())
  const missingPlanInputs = []
  if (!args.operator) missingPlanInputs.push('operator')
  if (!args.changeId) missingPlanInputs.push('changeId')

  const summary = {
    schemaVersion: 1,
    releaseId: manifest.releaseId,
    releaseState: manifest.state,
    tenant: manifest.deploymentPlan.tenant,
    environment: manifest.deploymentPlan.environment,
    operator: args.operator || null,
    changeId: args.changeId || null,
    manifestSha256: sha256(readFile(manifestPath)),
    snapshotSha256: snapshot ? sha256(snapshot) : null,
    repositoryTargets: (manifest.repositories || []).map(item => ({ name: item.name, targetCommit: item.targetCommit })),
    sources,
    stages: manifest.deploymentPlan.stages.map((stage, index) => ({
      ordinal: index,
      code: stage.code,
      components: componentCodes(stage.components),
      requiresApproval: stage.requiresApproval === true,
      rollbackAnchor: stage.rollbackAnchor || null
    })),
    missingPlanInputs,
    missingRemoteAnchors,
    releaseLocked: manifest.state === 'locked',
    remoteAnchorsComplete: missingRemoteAnchors.length === 0,
    readyForOperatorReview: manifest.state === 'locked' && missingRemoteAnchors.length === 0 && missingPlanInputs.length === 0,
    executionAuthorized: false,
    externalActions: 'none'
  }
  return { ...summary, confirmationSha256: sha256(summary) }
}

export function writePlan(path, plan, { cwd = process.cwd() } = {}) {
  const absolutePath = resolve(cwd, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, absolutePath)
  chmodSync(absolutePath, 0o600)
  if ((statSync(absolutePath).mode & 0o777) !== 0o600) throw new Error(`failed to enforce 0600 mode: ${absolutePath}`)
  return absolutePath
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) { console.info(usage()); return }
    const plan = buildReleaseDrillPlan(args)
    console.info(`[${SCRIPT}] OFFLINE PREVIEW ONLY; no command, network request, database operation, or deployment was executed`)
    for (const stage of plan.stages) {
      console.info(`[${SCRIPT}] ${stage.ordinal}. ${stage.code}: ${stage.components.join(', ')}`)
    }
    console.info(`[${SCRIPT}] releaseLocked=${plan.releaseLocked} remoteAnchorsComplete=${plan.remoteAnchorsComplete}`)
    if (plan.missingPlanInputs.length > 0) console.info(`[${SCRIPT}] missingPlanInputs=${plan.missingPlanInputs.join(',')}`)
    if (plan.missingRemoteAnchors.length > 0) console.info(`[${SCRIPT}] missingRemoteAnchors=${plan.missingRemoteAnchors.join(',')}`)
    console.info(`[${SCRIPT}] confirmationSha256=${plan.confirmationSha256}`)
    if (args.planFile) console.info(`[${SCRIPT}] plan=${writePlan(args.planFile, plan)}`)
  } catch (error) {
    if (error instanceof ReleasePlanConfigurationError) {
      console.error(`[${SCRIPT}] ${error.message}`)
      process.exitCode = 2
      return
    }
    console.error(`[${SCRIPT}] unexpected local planning failure`)
    process.exitCode = 3
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
