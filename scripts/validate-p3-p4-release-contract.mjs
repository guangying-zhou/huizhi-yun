#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const RELEASE_DIR = resolve(ROOT, 'docs/release')
const MONOREPO_RECORD_ROOT = resolve(ROOT, 'docs/monorepo-migration')

// 发布批次会不断新增与作废，因此不把某一个批次的文件名写死在脚本里。
//
// 2026-08 的教训：P3-P4-2026-07 作废后仍被硬编码校验，持续产出 20+ 条
// "pinned 值 vs 实际值" 漂移告警。这类长期噪音的真正代价是让人不再认真看
// CI 输出——真正的失败会淹没在其中。
//
// 只扫描 docs/release/P3-P4-*.release.json；其他发布类型有独立契约，
// 例如 POLICY-STORE 不具有本检查所要求的仓库、schema 和 dataRuntime 文件清单。
// 只校验唯一未作废的 P3/P4 批次：
//   state: "superseded" | "cancelled"  -> 归档批次，跳过全部漂移校验
//   其余 state（draft / locked / ...） -> 活跃批次，执行完整校验
// 归档批次的文件保留在目录中作为历史记录，不删除。
function discoverManifests() {
  if (!existsSync(RELEASE_DIR)) return []
  return readdirSync(RELEASE_DIR)
    .filter(name => name.startsWith('P3-P4-') && name.endsWith('.release.json'))
    .sort()
    .map((name) => {
      const path = resolve(RELEASE_DIR, name)
      try {
        return { name, path, manifest: JSON.parse(readFileSync(path, 'utf8')) }
      } catch (error) {
        console.error(`[p3-p4-release] invalid manifest JSON in ${name}: ${error.message}`)
        process.exit(1)
      }
    })
}

const ARCHIVED_STATES = new Set(['superseded', 'cancelled'])
const allowDirty = process.argv.includes('--allow-dirty')
const allowIncomplete = process.argv.includes('--allow-incomplete')
const unknownArgs = process.argv.slice(2).filter(arg => !['--allow-dirty', '--allow-incomplete', '--'].includes(arg))

if (unknownArgs.length > 0) {
  console.error(`[p3-p4-release] unknown arguments: ${unknownArgs.join(', ')}`)
  process.exit(1)
}

const errors = []
const warnings = []

function problem(message, { incomplete = false, dirty = false } = {}) {
  if ((incomplete && allowIncomplete) || (dirty && allowDirty)) warnings.push(message)
  else errors.push(message)
}

function filePath(relativePath) {
  return resolve(ROOT, relativePath)
}

function read(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return null
  const absolutePath = filePath(relativePath)
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return null
  return readFileSync(absolutePath, 'utf8')
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${detail}`)
  }
  return result.stdout.trim()
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function mappedMonorepoCommit(repository) {
  if (repository.path === '.') return repository.targetCommit
  const mapPath = resolve(MONOREPO_RECORD_ROOT, 'commit-maps', `${repository.name}.tsv`)
  if (!existsSync(mapPath)) return null
  const line = readFileSync(mapPath, 'utf8')
    .split(/\r?\n/)
    .find(candidate => candidate.startsWith(`${repository.targetCommit} `))
  return line?.trim().split(/\s+/)[1] || null
}

const discovered = discoverManifests()
const archived = discovered.filter(entry => ARCHIVED_STATES.has(entry.manifest.state))
const active = discovered.filter(entry => !ARCHIVED_STATES.has(entry.manifest.state))

for (const entry of archived) {
  console.log(`[p3-p4-release] archived ${entry.manifest.releaseId || entry.name} (state=${entry.manifest.state}); skipped`)
}

if (discovered.length === 0) {
  console.error(`[p3-p4-release] no P3-P4-*.release.json found under ${RELEASE_DIR}`)
  process.exit(1)
}

// 同时存在多个活跃批次意味着发布计划有歧义，必须显式作废旧批次后再继续。
if (active.length > 1) {
  console.error(`[p3-p4-release] multiple active releases: ${active.map(e => e.name).join(', ')}; mark the obsolete ones as "superseded"`)
  process.exit(1)
}

// 全部批次都已归档是合法的中间状态：上一批发完、下一批还没开。
if (active.length === 0) {
  console.log(`[p3-p4-release] no active release; ${archived.length} archived manifest(s) retained as history`)
  process.exit(0)
}

const { path: MANIFEST_PATH, manifest } = active[0]
console.log(`[p3-p4-release] active manifest: ${MANIFEST_PATH.slice(ROOT.length + 1)}`)

if (manifest.schemaVersion !== 2) errors.push(`unsupported schemaVersion: ${manifest.schemaVersion}`)
if (manifest.state !== 'locked') problem(`release state is ${JSON.stringify(manifest.state)}; set it to "locked" only after target commits are clean and final`, { incomplete: true })

const repositoryNames = new Set()
const monorepoMode = existsSync(resolve(MONOREPO_RECORD_ROOT, 'inventory.json'))
for (const repository of manifest.repositories || []) {
  if (!repository.name || !repository.path || !repository.targetCommit) {
    errors.push('every repository requires name, path, and targetCommit')
    continue
  }
  if (repositoryNames.has(repository.name)) errors.push(`duplicate repository name: ${repository.name}`)
  repositoryNames.add(repository.name)

  try {
    if (monorepoMode) {
      const mappedCommit = mappedMonorepoCommit(repository)
      if (!mappedCommit) {
        errors.push(`${repository.name} targetCommit is missing from monorepo commit-map: ${repository.targetCommit}`)
        continue
      }
      git(['cat-file', '-e', `${mappedCommit}^{commit}`], ROOT)
      const pathDiff = git(['diff', '--name-only', mappedCommit, 'HEAD', '--', repository.path], ROOT)
      if (pathDiff) {
        problem(`${repository.name} source changed after pinned targetCommit ${repository.targetCommit} (mapped ${mappedCommit})`, { incomplete: true })
      }
    } else {
      const cwd = filePath(repository.path)
      const head = git(['rev-parse', 'HEAD'], cwd)
      if (head !== repository.targetCommit) {
        problem(`${repository.name} targetCommit mismatch: manifest=${repository.targetCommit} actual=${head}`, { incomplete: true })
      }
      const status = git(['status', '--porcelain'], cwd)
      if (status) problem(`${repository.name} repository is dirty`, { dirty: true })
    }
  } catch (error) {
    errors.push(error.message)
  }
}

if (monorepoMode) {
  const status = git(['status', '--porcelain'], ROOT)
  if (status) problem('monorepo is dirty', { dirty: true })
}

for (const requiredRepository of ['root', 'platform', 'console', 'people', 'altoc', 'aims', 'finance', 'workflow', 'codocs', 'assets']) {
  if (!repositoryNames.has(requiredRepository)) errors.push(`release repositories missing required component: ${requiredRepository}`)
}

const deploymentPlan = manifest.deploymentPlan
const expectedStageOrder = [
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
if (!deploymentPlan || deploymentPlan.tenant !== 'wiztek' || deploymentPlan.environment !== 'production') {
  errors.push('deploymentPlan must lock tenant=wiztek and environment=production')
} else {
  if (deploymentPlan.wranglerVersion !== '4.110.0') errors.push('deploymentPlan must pin wranglerVersion=4.110.0')
  if (deploymentPlan.evidenceFileMode !== '0600') errors.push('deploymentPlan evidenceFileMode must be 0600')
  const stages = deploymentPlan.stages || []
  if (JSON.stringify(stages.map(stage => stage.code)) !== JSON.stringify(expectedStageOrder)) {
    errors.push(`deploymentPlan stage order must be ${expectedStageOrder.join(' -> ')}`)
  }
  const stage = code => stages.find(item => item.code === code)
  const controlPlane = stage('control-plane')?.components || []
  const platform = controlPlane.find(item => item.code === 'platform')
  const console = controlPlane.find(item => item.code === 'console')
  if (platform?.repository !== 'platform' || platform?.deploymentMode !== 'pm2-nginx') {
    errors.push('deploymentPlan must preserve wiztek Platform pm2-nginx deployment mode')
  }
  if (console?.repository !== 'console' || console?.deploymentMode !== 'cloudflare-worker' || console?.packageScript !== 'deploy:cloudflare') {
    errors.push('deploymentPlan must deploy Console through its versioned Cloudflare package script')
  }
  const gateway = stage('tenant-gateway')
  if (gateway?.rollbackAnchor !== 'exact-cloudflare-version-id'
    || gateway?.components?.[0]?.config !== 'deploy/cloudflare/tenant-gateway/wrangler.jsonc') {
    errors.push('deploymentPlan tenant-gateway must lock config and exact Cloudflare rollback version ID')
  }
  const bridgeOrder = (stage('business-bridges')?.components || []).map(item => item.code)
  if (JSON.stringify(bridgeOrder) !== JSON.stringify(['assets', 'codocs', 'finance', 'workflow', 'aims', 'altoc'])) {
    errors.push('deploymentPlan business bridge order must be assets -> codocs -> finance -> workflow -> aims -> altoc')
  }
  for (const component of [console, ...(stage('people')?.components || []), ...(stage('business-bridges')?.components || [])]) {
    if (!component || component.deploymentMode !== 'cloudflare-worker' || component.packageScript !== 'deploy:cloudflare') {
      errors.push(`deploymentPlan Cloudflare component is missing versioned package script: ${component?.code || 'unknown'}`)
    }
  }
}

if (manifest.dataRuntime?.rollbackCommand !== 'hzy-data-runtime rollback --execute --confirm hzy-data-runtime.previous --change-id <change-id>') {
  errors.push('dataRuntime.rollbackCommand must use the guarded explicit rollback command')
}

const runtimeVersion = read(manifest.dataRuntime?.versionFile || '')?.trim()
if (!runtimeVersion) errors.push(`missing data-runtime version file: ${manifest.dataRuntime?.versionFile || '<unset>'}`)
else if (runtimeVersion !== manifest.dataRuntime.targetVersion) {
  problem(`data-runtime version mismatch: manifest=${manifest.dataRuntime.targetVersion} actual=${runtimeVersion}`, { incomplete: true })
}
if (!existsSync(filePath(manifest.dataRuntime?.packageScript || ''))) {
  errors.push(`missing data-runtime package script: ${manifest.dataRuntime?.packageScript || '<unset>'}`)
}
for (const [field, markers] of Object.entries({
  packageScript: ['release.sha256', 'manifest.json', 'Ed25519', 'RELEASE_SIGNING_KEY_FILE', 'refusing to overwrite immutable version'],
  uploadScript: ['--stage', '--promote', 'wrangler@4.110.0', 'latest/version.txt'],
  releaseTest: ['stage preview is deterministic', 'successful promotion writes latest version pointer last']
})) {
  const path = manifest.dataRuntime?.[field] || ''
  const source = read(path)
  if (!source) errors.push(`missing data-runtime ${field}: ${path || '<unset>'}`)
  else for (const marker of markers) if (!source.includes(marker)) errors.push(`data-runtime ${field} missing marker ${marker}: ${path}`)
}
if (manifest.dataRuntime?.publicationMode !== 'stage-promote' || manifest.dataRuntime?.activationPointer !== 'latest/version.txt') {
  errors.push('data-runtime release contract must use stage-promote with latest/version.txt activated last')
}
if (manifest.dataRuntime?.manifestFile !== 'manifest.json' || manifest.dataRuntime?.inventoryFile !== 'release.sha256') {
  errors.push('data-runtime release contract must require manifest.json and release.sha256')
}
const signatureContract = manifest.dataRuntime?.signatureContract
if (signatureContract?.algorithm !== 'Ed25519' || signatureContract?.required !== true
  || signatureContract?.publicKeyProvisioning !== 'external-trusted-config'
  || signatureContract?.manifestSignature !== 'manifest.json.sig'
  || signatureContract?.artifactSignatureSuffix !== '.sig') {
  errors.push('data-runtime release contract must require detached Ed25519 signatures and an externally provisioned trust root')
}
if (!/^[a-f0-9]{64}$/.test(signatureContract?.signingKeyId || '')) {
  problem('data-runtime release signingKeyId is not locked to a 64-character SHA-256 key ID', { incomplete: true })
}
for (const [path, markers] of [
  ['data-runtime/internal/server/runtime_update_policy.go', ['runtime_update_field_not_allowed', 'HZY_DATA_RUNTIME_ALLOWED_UPDATE_BASE_URLS']],
  ['data-runtime/internal/updater/journal.go', ['UpdateJournal', 'partial_or_unknown']],
  ['data-runtime/internal/updater/lock.go', ['AcquireExecutionLock', 'ErrUpdateExecutionBusy']],
  ['data-runtime/internal/updater/policy.go', ['AutoUpdatePolicy', 'RecordTimerCheck']],
  ['data-runtime/internal/updater/updater.go', ['releaseArtifactFromManifest', 'verifyDetachedEd25519', 'copyFileAtomic']],
  ['data-runtime/deploy/install.sh', ['--release-public-key', 'pkeyutl -verify -rawin -pubin']]
]) {
  const source = read(path)
  if (!source) errors.push(`missing data-runtime release safety source: ${path}`)
  else for (const marker of markers) if (!source.includes(marker)) errors.push(`data-runtime release safety source ${path} missing marker ${marker}`)
}
const updaterSource = read('data-runtime/internal/updater/updater.go') || ''
for (const marker of ['hzy-data-runtime.previous', 'restorePreviousBinary']) {
  if (!updaterSource.includes(marker)) errors.push(`data-runtime updater is missing rollback marker: ${marker}`)
}

const schemaPlan = manifest.schemaPlan || {}
if (!['bootstrap', 'upgrade'].includes(schemaPlan.targetMode)) {
  errors.push(`schemaPlan.targetMode must be bootstrap or upgrade; actual=${JSON.stringify(schemaPlan.targetMode)}`)
}
for (const [moduleName, modulePlan] of Object.entries(schemaPlan.modules || {})) {
  for (const mode of ['bootstrap', 'upgrade']) {
    const schemas = modulePlan[mode] || []
    if (schemas.some(schema => schema.sequence !== undefined)) {
      let previousSequence = 0
      for (const schema of schemas) {
        if (!Number.isInteger(schema.sequence) || schema.sequence <= previousSequence) {
          errors.push(`${moduleName} ${mode} schema sequence must be a strictly increasing positive integer at ${schema.path}`)
        }
        previousSequence = Number(schema.sequence) || previousSequence
      }
    }
    let previousMigration = -1
    for (const schema of schemas) {
      const content = read(schema.path)
      if (content === null) {
        errors.push(`missing ${moduleName} ${mode} schema: ${schema.path}`)
        continue
      }
      const actualHash = sha256(content)
      if (actualHash !== schema.sha256) {
        problem(`${moduleName} ${mode} schema checksum mismatch: ${schema.path}; update the reviewed release manifest intentionally`, { incomplete: true })
      }
      if (mode === 'bootstrap' && schema.requiresEmptyDatabase !== true) {
        errors.push(`${moduleName} bootstrap schema must declare requiresEmptyDatabase=true: ${schema.path}`)
      }
      const numberedMigration = /\/(\d{3})_[^/]+\.sql$/.exec(schema.path)
      if (numberedMigration) {
        const number = Number(numberedMigration[1])
        if (number <= previousMigration) errors.push(`${moduleName} ${mode} schema order is not strictly increasing at ${schema.path}`)
        previousMigration = number
      }
      if (mode === schemaPlan.targetMode && mode === 'upgrade') {
        for (const forbidden of [
          [/\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i, 'DROP DATABASE/SCHEMA/TABLE'],
          [/\bTRUNCATE\s+(?:TABLE\s+)?/i, 'TRUNCATE'],
          [/\bSET\s+FOREIGN_KEY_CHECKS\s*=\s*0\b/i, 'FOREIGN_KEY_CHECKS=0']
        ]) {
          if (forbidden[0].test(content)) {
            errors.push(`${moduleName} upgrade schema contains destructive operation ${forbidden[1]}: ${schema.path}`)
          }
        }
      }
    }
  }
}

for (const contract of manifest.applicationContracts || []) {
  const content = read(contract.manifest)
  if (content === null) {
    errors.push(`missing app manifest: ${contract.manifest}`)
    continue
  }
  let appManifest
  try {
    appManifest = JSON.parse(content)
  } catch (error) {
    errors.push(`invalid app manifest ${contract.manifest}: ${error.message}`)
    continue
  }
  if (appManifest.appCode !== contract.appCode) {
    errors.push(`${contract.manifest} appCode mismatch: expected=${contract.appCode} actual=${appManifest.appCode}`)
  }
  const resources = new Map((appManifest.resources || []).map(resource => [resource.code, new Set(resource.actions || [])]))
  for (const [resourceCode, actions] of Object.entries(contract.resources || {})) {
    if (!resources.has(resourceCode)) {
      errors.push(`${contract.appCode} manifest is missing resource ${resourceCode}`)
      continue
    }
    for (const action of actions) {
      if (!resources.get(resourceCode).has(action)) errors.push(`${contract.appCode}:${resourceCode} is missing action ${action}`)
    }
  }
}

const subscription = manifest.subscriptionContract || {}
const planSeed = read(subscription.seed || '')
if (planSeed === null) {
  errors.push(`missing Platform subscription seed: ${subscription.seed || '<unset>'}`)
} else {
  for (const appCode of subscription.catalogApps || []) {
    if (!planSeed.includes(`('${appCode}',`)) {
      problem(`Platform application catalog seed does not include ${appCode}`, { incomplete: true })
    }
  }
  for (const [planCode, appCodes] of Object.entries(subscription.planApps || {})) {
    for (const appCode of appCodes) {
      const planAppPattern = new RegExp(`SELECT\\s+'${planCode}'(?:\\s+AS\\s+plan_code)?,\\s*'${appCode}'`, 'i')
      if (!planAppPattern.test(planSeed)) {
        problem(`Platform plan ${planCode} does not include ${appCode}`, { incomplete: true })
      }
    }
  }
}

for (const grant of manifest.serviceGrantContracts || []) {
  const content = read(grant.file)
  if (content === null) {
    errors.push(`missing Console service grant seed: ${grant.file}`)
    continue
  }
  for (const marker of grant.contains || []) {
    if (!content.includes(marker)) errors.push(`${grant.file} is missing required grant marker: ${marker}`)
  }
}

const gateway = manifest.gatewayContract || {}
const gatewaySource = read(gateway.source || '')
if (gatewaySource === null) {
  errors.push(`missing Tenant Gateway source: ${gateway.source || '<unset>'}`)
} else {
  for (const marker of gateway.contains || []) {
    if (!gatewaySource.includes(marker)) errors.push(`Tenant Gateway source is missing contract marker: ${marker}`)
  }
}
for (const testFile of gateway.tests || []) {
  if (!existsSync(filePath(testFile))) problem(`missing Tenant Gateway contract test: ${testFile}`, { incomplete: true })
}

for (const demoFile of [manifest.demoData?.manifest, manifest.demoData?.runner, ...(manifest.demoData?.files || [])].filter(Boolean)) {
  if (!existsSync(filePath(demoFile))) problem(`missing repeatable P3/P4 demo data artifact: ${demoFile}`, { incomplete: true })
}

const readAcceptance = manifest.demoData?.readAcceptance || {}
for (const acceptanceFile of [readAcceptance.script, readAcceptance.test].filter(Boolean)) {
  if (!existsSync(filePath(acceptanceFile))) problem(`missing People G2-2 read acceptance artifact: ${acceptanceFile}`, { incomplete: true })
}
const rootPackageText = read('package.json') || '{}'
let rootPackage
try {
  rootPackage = JSON.parse(rootPackageText)
} catch (error) {
  errors.push(`invalid root package.json: ${error.message}`)
  rootPackage = {}
}
if (!readAcceptance.packageScript || !rootPackage.scripts?.[readAcceptance.packageScript]) {
  problem(`missing package script for People G2-2 read acceptance: ${readAcceptance.packageScript || '<unset>'}`, { incomplete: true })
}

const laborCostLoopAcceptance = manifest.demoData?.laborCostLoopAcceptance || {}
for (const acceptanceFile of [laborCostLoopAcceptance.script, laborCostLoopAcceptance.test].filter(Boolean)) {
  if (!existsSync(filePath(acceptanceFile))) problem(`missing G2-3 labor-cost loop acceptance artifact: ${acceptanceFile}`, { incomplete: true })
}
if (!laborCostLoopAcceptance.packageScript || !rootPackage.scripts?.[laborCostLoopAcceptance.packageScript]) {
  problem(`missing package script for G2-3 labor-cost loop acceptance: ${laborCostLoopAcceptance.packageScript || '<unset>'}`, { incomplete: true })
}

for (const warning of warnings) console.warn(`[p3-p4-release] WARNING ${warning}`)
for (const error of errors) console.error(`[p3-p4-release] ERROR ${error}`)

if (errors.length > 0) {
  console.error(`[p3-p4-release] failed with ${errors.length} error(s) and ${warnings.length} warning(s)`)
  process.exit(1)
}

console.info(`[p3-p4-release] passed releaseId=${manifest.releaseId} state=${manifest.state} warnings=${warnings.length}`)
