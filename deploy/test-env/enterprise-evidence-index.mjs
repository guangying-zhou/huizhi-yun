import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha1 = /^[a-f0-9]{40}$/
const sha256 = /^[a-f0-9]{64}$/
const evidenceTypes = new Set(['unit', 'contract', 'isolated-mysql', 'test-tenant', 'browser'])
const requiredRoles = new Set(['isolated-mysql-receipt', 'api-identity-contract', 'migration-receipt', 'permission-matrix', 'build-performance', 'rollback'])

export const candidateEvidenceSources = Object.freeze([
  {
    id: 'assets-product-master-isolated-mysql', type: 'isolated-mysql', role: 'isolated-mysql-receipt',
    path: 'deploy/test-env/artifacts/C000001.assets-product-master-cross-entry-isolated-mysql-verification.json', execution: { mode: 'isolated', environment: 'isolated', mocked: false },
    boundary: { proves: ['temporary MySQL product-master cross-entry contract'], excludes: ['deployed database', 'live tenant grant'] }
  },
  {
    id: 'enterprise-assets-api-identity-contract', type: 'contract', role: 'api-identity-contract',
    path: 'enterprise/test/assets-reads-bridge.test.mjs', execution: { mode: 'local', environment: 'local', mocked: false },
    boundary: { proves: ['Host to Foundation to Runtime identity and scoped read contract'], excludes: ['OIDC browser session', 'deployed service grant'] }
  },
  {
    id: 'assets-owning-receipt-migration', type: 'isolated-mysql', role: 'migration-receipt',
    path: 'deploy/test-env/artifacts/C000001.assets-owned-receipt-migration.json', execution: { mode: 'isolated', environment: 'isolated', mocked: false },
    boundary: { proves: ['candidate owning-receipt migration record'], excludes: ['production DDL application', 'live schema activation'] }
  },
  {
    id: 'enterprise-operation-permission-matrix', type: 'contract', role: 'permission-matrix',
    path: 'docs/Unified-Enterprise-Operation-Coverage-Matrix.md', execution: { mode: 'local', environment: 'local', mocked: false },
    boundary: { proves: ['registered operation and exact capability inventory'], excludes: ['target tenant grant verification', 'default user authorization'] }
  },
  {
    id: 'platform-linux-build-performance-candidate', type: 'unit', role: 'build-performance',
    path: 'deploy/test-env/artifacts/C000001.platform-enterprise-linux-smoke-candidate.json', execution: { mode: 'local', environment: 'local', mocked: false },
    boundary: { proves: ['candidate Linux build and smoke output'], excludes: ['deployed worker', 'production performance claim'] }
  },
  {
    id: 'enterprise-browser-candidate', type: 'browser', role: 'browser',
    path: 'deploy/test-env/artifacts/C000001.browser-acceptance-20260914.json', execution: { mode: 'browser', environment: 'test', mocked: false },
    boundary: { proves: ['recorded candidate browser observations'], excludes: ['current deployment', 'production acceptance'] }
  },
  {
    id: 'enterprise-host-rollback-candidate', type: 'contract', role: 'rollback',
    path: 'deploy/test-env/artifacts/C000001.enterprise-host-full-candidate-20260914.json', execution: { mode: 'test-tenant', environment: 'test', mocked: false },
    boundary: { proves: ['candidate rollback route version and protected receipt binding'], excludes: ['deployed rollback route', 'release approval'] }
  }
])

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fail(code) { throw new Error(code) }

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch { fail('GIT_COMMAND_FAILED') }
}

function rootPath(repo) {
  try { return realpathSync(repo) } catch { fail('REPOSITORY_NOT_FOUND') }
}

function requireCleanPinnedRepository(repo, commit) {
  if (typeof commit !== 'string' || !sha1.test(commit)) fail('COMMIT_NOT_PINNED')
  const root = rootPath(repo)
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=all'])) fail('WORKTREE_DIRTY')
  if (git(root, ['rev-parse', 'HEAD']) !== commit) fail('CHECKOUT_NOT_PINNED_TO_COMMIT')
  return root
}

function treeContent(repo, commit, path) {
  try {
    return execFileSync('git', ['-C', repo, 'show', `${commit}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch { fail('EVIDENCE_FILE_MISSING') }
}

function safePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..')) fail('EVIDENCE_PATH_INVALID')
  return path
}

function validateSourceDefinition(source) {
  if (!source || typeof source !== 'object' || typeof source.id !== 'string' || !source.id || !evidenceTypes.has(source.type) || typeof source.role !== 'string' || !source.role) fail('EVIDENCE_SOURCE_INVALID')
  safePath(source.path)
  const execution = source.execution
  if (!execution || typeof execution !== 'object' || !['isolated', 'local', 'test-tenant', 'browser'].includes(execution.mode) || !['isolated', 'local', 'test'].includes(execution.environment) || execution.mocked !== false) fail('EVIDENCE_SOURCE_INVALID')
  if (!source.boundary || !Array.isArray(source.boundary.proves) || !source.boundary.proves.length || !Array.isArray(source.boundary.excludes) || !source.boundary.excludes.length) fail('EVIDENCE_SOURCE_INVALID')
}

function rejectDeployedCandidateSource(path, content) {
  if (!path.endsWith('.json')) return
  let value
  try { value = JSON.parse(content) } catch { fail('EVIDENCE_JSON_INVALID') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  if (value.deployed === true || value.deploymentState === 'deployed' || (value.candidateOnly === true && value.deployed !== false)) fail('CANDIDATE_DEPLOYMENT_FORBIDDEN')
}

function validateIndexShape(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) fail('EVIDENCE_INDEX_INVALID')
  if (index.schemaVersion !== 'enterprise-evidence-index.v1') fail('EVIDENCE_INDEX_INVALID')
  if (index.releaseState !== 'candidate' || index.deploymentState !== 'not-deployed') fail('CANDIDATE_DEPLOYMENT_FORBIDDEN')
  if (typeof index.sourceCommit !== 'string' || !sha1.test(index.sourceCommit) || !Array.isArray(index.evidence)) fail('EVIDENCE_INDEX_INVALID')
  const roles = new Set(), ids = new Set()
  for (const entry of index.evidence) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || ids.has(entry.id) || !evidenceTypes.has(entry.type) || typeof entry.role !== 'string' || roles.has(entry.role)) fail('EVIDENCE_INDEX_INVALID')
    ids.add(entry.id); roles.add(entry.role)
    if (entry.testedCommit !== index.sourceCommit || typeof entry.testedCommit !== 'string' || !sha1.test(entry.testedCommit)) fail('EVIDENCE_COMMIT_DRIFT')
    if (!entry.source || safePath(entry.source.path) !== entry.source.path || typeof entry.source.sha256 !== 'string' || !sha256.test(entry.source.sha256)) fail('EVIDENCE_INDEX_INVALID')
    const execution = entry.execution
    if (!execution || !['isolated', 'local', 'test-tenant', 'browser'].includes(execution.mode) || !['isolated', 'local', 'test', 'real'].includes(execution.environment) || typeof execution.mocked !== 'boolean') fail('EVIDENCE_INDEX_INVALID')
    if (execution.mocked && execution.environment === 'real') fail('MOCK_LABELED_REAL')
    if (execution.environment === 'real') fail('REAL_ENVIRONMENT_FORBIDDEN')
    if (entry.deploymentState !== 'not-deployed') fail('CANDIDATE_DEPLOYMENT_FORBIDDEN')
    if (!entry.boundary || !Array.isArray(entry.boundary.proves) || !entry.boundary.proves.length || !Array.isArray(entry.boundary.excludes) || !entry.boundary.excludes.length) fail('EVIDENCE_BOUNDARY_REQUIRED')
  }
  for (const role of requiredRoles) if (!roles.has(role)) fail('EVIDENCE_CATEGORY_MISSING')
}

export function generateEvidenceIndex({ repo, commit, sources = candidateEvidenceSources }) {
  const root = requireCleanPinnedRepository(repo, commit)
  if (!Array.isArray(sources) || !sources.length) fail('EVIDENCE_SOURCE_INVALID')
  const evidence = sources.map(source => {
    validateSourceDefinition(source)
    const content = treeContent(root, commit, source.path)
    rejectDeployedCandidateSource(source.path, content)
    return {
      id: source.id,
      type: source.type,
      role: source.role,
      testedCommit: commit,
      source: { path: source.path, sha256: digest(content) },
      execution: source.execution,
      deploymentState: 'not-deployed',
      boundary: source.boundary
    }
  })
  const index = { schemaVersion: 'enterprise-evidence-index.v1', releaseState: 'candidate', deploymentState: 'not-deployed', sourceCommit: commit, evidence }
  validateIndexShape(index)
  return index
}

export function verifyEvidenceIndex({ repo, index, sources = candidateEvidenceSources }) {
  validateIndexShape(index)
  const expected = generateEvidenceIndex({ repo, commit: index.sourceCommit, sources })
  if (canonical(index) !== canonical(expected)) fail('EVIDENCE_HASH_DRIFT')
  return { valid: true, sourceCommit: index.sourceCommit, releaseState: index.releaseState, deploymentState: index.deploymentState, evidenceCount: index.evidence.length }
}

function outputOutsideRepository(repo, output) {
  const root = resolve(repo), target = resolve(output)
  if (target === root || target.startsWith(`${root}${sep}`)) fail('OUTPUT_MUST_BE_OUTSIDE_SOURCE_REPOSITORY')
  return target
}

export function writeEvidenceIndex({ repo, commit, output }) {
  const target = outputOutsideRepository(repo, output)
  const index = generateEvidenceIndex({ repo, commit })
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 })
  return index
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function isMain() { return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) }

if (isMain()) {
  try {
    const mode = process.argv[2], repo = argument('--repo')
    if (!repo) fail('REPOSITORY_NOT_FOUND')
    if (mode === 'generate') {
      const output = argument('--output'), commit = argument('--commit')
      if (!output) fail('OUTPUT_REQUIRED')
      writeEvidenceIndex({ repo, commit, output })
      console.log(JSON.stringify({ status: 'candidate-created', deploymentState: 'not-deployed', output: isAbsolute(output) ? output : resolve(output) }))
    } else if (mode === 'verify') {
      const source = argument('--index')
      if (!source) fail('INDEX_REQUIRED')
      console.log(JSON.stringify(verifyEvidenceIndex({ repo, index: JSON.parse(readFileSync(resolve(source), 'utf8')) })))
    } else fail('USAGE: generate|verify')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'EVIDENCE_INDEX_FAILED')
    process.exitCode = 1
  }
}
