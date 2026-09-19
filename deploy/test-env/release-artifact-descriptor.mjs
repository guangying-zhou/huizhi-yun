import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha1 = /^[a-f0-9]{40}$/
const sha256 = /^[a-f0-9]{64}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const paths = Object.freeze({
  manifest: 'enterprise/app.manifest.json',
  runtimeVersion: 'data-runtime/VERSION',
  migrationPlan: 'deploy/test-env/artifacts/C000001.enterprise-migration-plan.json',
  gatewayConfig: 'deploy/cloudflare/tenant-gateway/wrangler.jsonc',
  gatewaySource: 'deploy/cloudflare/tenant-gateway/src/index.js',
  rollbackReceipt: 'deploy/test-env/artifacts/C000001.enterprise-host-full-candidate-20260914.json'
})

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
}

function fail(code) {
  throw new Error(code)
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    fail('GIT_COMMAND_FAILED')
  }
}

function requiredCommit(value) {
  if (typeof value !== 'string' || !sha1.test(value)) fail('COMMIT_NOT_PINNED')
  return value
}

function repoRoot(value) {
  try {
    return realpathSync(value)
  } catch {
    fail('REPOSITORY_NOT_FOUND')
  }
}

function requireCleanPinnedRepository(repo, commit) {
  const root = repoRoot(repo)
  const requested = requiredCommit(commit)
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status) fail('WORKTREE_DIRTY')
  const head = git(root, ['rev-parse', 'HEAD'])
  if (head !== requested) fail('CHECKOUT_NOT_PINNED_TO_COMMIT')
  return root
}

function treeContent(repo, commit, path) {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${commit}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    fail('REQUIRED_FILE_MISSING')
  }
}

function treeId(repo, commit, path) {
  try {
    const result = execFileSync('git', ['-C', repo, 'rev-parse', `${commit}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (!sha1.test(result)) fail('TREE_ID_INVALID')
    return result
  } catch (error) {
    if (error instanceof Error && error.message === 'TREE_ID_INVALID') throw error
    fail('REQUIRED_FILE_MISSING')
  }
}

function json(value, code) {
  try {
    return JSON.parse(value)
  } catch {
    fail(code)
  }
}

function safeString(value, code, pattern = /\S/) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code)
  return value
}

function hasSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, nested]) => /(?:secret|token|password|credential|private[_-]?key)/i.test(key) || hasSensitiveKey(nested))
}

function fixedInput(repo, commit) {
  const manifestSource = treeContent(repo, commit, paths.manifest)
  const migrationSource = treeContent(repo, commit, paths.migrationPlan)
  const gatewaySource = treeContent(repo, commit, paths.gatewayConfig)
  const rollbackSource = treeContent(repo, commit, paths.rollbackReceipt)
  const manifest = json(manifestSource, 'MANIFEST_INVALID')
  const catalog = manifest?.composition?.permissionCatalog
  const permissionCatalogHash = manifest?.composition?.permissionCatalogHash
  if (!catalog || typeof catalog !== 'object' || typeof permissionCatalogHash !== 'string' || !sha256.test(permissionCatalogHash) || digest(catalog) !== permissionCatalogHash) fail('PERMISSION_CATALOG_HASH_DRIFT')
  const migrationPlan = json(migrationSource, 'MIGRATION_PLAN_INVALID')
  const reviewHash = safeString(migrationPlan.ReviewHash, 'MIGRATION_REVIEW_HASH_INVALID', sha256)
  const version = safeString(migrationPlan.Version, 'MIGRATION_VERSION_INVALID')
  const gateway = json(gatewaySource, 'GATEWAY_CONFIG_INVALID')
  if (hasSensitiveKey(gateway)) fail('GATEWAY_CONFIG_SENSITIVE_FIELD_FORBIDDEN')
  const crons = gateway?.triggers?.crons
  if (!Array.isArray(crons) || !crons.length || crons.some(value => typeof value !== 'string' || !value.trim())) fail('GATEWAY_CRON_INVALID')
  const rollback = json(rollbackSource, 'ROLLBACK_RECEIPT_INVALID')
  const rollbackVersion = safeString(rollback.observedRollbackVersion, 'ROLLBACK_ROUTE_VERSION_INVALID', uuid)
  const runtimeVersion = safeString(treeContent(repo, commit, paths.runtimeVersion).trim(), 'RUNTIME_VERSION_INVALID', /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?$/)
  return { manifestSource, migrationSource, gatewaySource, rollbackSource, permissionCatalogHash, reviewHash, version, crons: [...crons], rollbackVersion, runtimeVersion }
}

export function generateReleaseArtifactDescriptor({ repo, commit }) {
  const root = requireCleanPinnedRepository(repo, commit)
  const input = fixedInput(root, commit)
  return {
    schemaVersion: 'enterprise-release-artifact.v1',
    releaseState: 'candidate',
    deploymentState: 'not-deployed',
    sourceCommit: commit,
    enterpriseHost: {
      commit,
      treeSha1: treeId(root, commit, 'enterprise'),
      manifestPath: paths.manifest,
      manifestSha256: digest(input.manifestSource),
      permissionCatalogSha256: input.permissionCatalogHash
    },
    dataRuntime: {
      commit,
      treeSha1: treeId(root, commit, 'data-runtime'),
      versionPath: paths.runtimeVersion,
      version: input.runtimeVersion,
      versionSha256: digest(`${input.runtimeVersion}\n`)
    },
    schemaMigrationPlan: {
      path: paths.migrationPlan,
      sha256: digest(input.migrationSource),
      version: input.version,
      reviewSha256: input.reviewHash
    },
    gateway: {
      sourcePath: paths.gatewaySource,
      sourceSha256: digest(treeContent(root, commit, paths.gatewaySource)),
      configPath: paths.gatewayConfig,
      configSha256: digest(input.gatewaySource),
      crons: input.crons
    },
    rollbackRoute: {
      receiptPath: paths.rollbackReceipt,
      receiptSha256: digest(input.rollbackSource),
      version: input.rollbackVersion
    }
  }
}

function descriptorShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DESCRIPTOR_INVALID')
  if (value.schemaVersion !== 'enterprise-release-artifact.v1' || value.releaseState !== 'candidate' || value.deploymentState !== 'not-deployed') fail('DESCRIPTOR_STATE_INVALID')
  requiredCommit(value.sourceCommit)
  if (value.enterpriseHost?.commit !== value.sourceCommit || value.dataRuntime?.commit !== value.sourceCommit) fail('DESCRIPTOR_COMMIT_BINDING_INVALID')
  return value
}

export function verifyReleaseArtifactDescriptor({ repo, descriptor }) {
  const actual = descriptorShape(descriptor)
  const expected = generateReleaseArtifactDescriptor({ repo, commit: actual.sourceCommit })
  if (canonical(actual) !== canonical(expected)) fail('DESCRIPTOR_HASH_DRIFT')
  return { valid: true, sourceCommit: actual.sourceCommit, releaseState: actual.releaseState, deploymentState: actual.deploymentState }
}

function outsideRepository(repo, output) {
  const root = resolve(repo)
  const target = resolve(output)
  if (target === root || target.startsWith(`${root}${sep}`)) fail('OUTPUT_MUST_BE_OUTSIDE_SOURCE_REPOSITORY')
  return target
}

export function writeReleaseArtifactDescriptor({ repo, commit, output }) {
  const target = outsideRepository(repo, output)
  const descriptor = generateReleaseArtifactDescriptor({ repo, commit })
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 })
  return descriptor
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMain()) {
  try {
    const mode = process.argv[2]
    const repo = argument('--repo')
    if (!repo) fail('REPOSITORY_NOT_FOUND')
    if (mode === 'generate') {
      const output = argument('--output')
      const commit = argument('--commit')
      if (!output) fail('OUTPUT_REQUIRED')
      writeReleaseArtifactDescriptor({ repo, commit, output })
      console.log(JSON.stringify({ status: 'candidate-created', deploymentState: 'not-deployed', output: isAbsolute(output) ? output : resolve(output) }))
    } else if (mode === 'verify') {
      const source = argument('--descriptor')
      if (!source) fail('DESCRIPTOR_REQUIRED')
      const descriptor = json(readFileSync(resolve(source), 'utf8'), 'DESCRIPTOR_INVALID')
      console.log(JSON.stringify(verifyReleaseArtifactDescriptor({ repo, descriptor })))
    } else {
      fail('USAGE: generate|verify')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'DESCRIPTOR_FAILED')
    process.exitCode = 1
  }
}
