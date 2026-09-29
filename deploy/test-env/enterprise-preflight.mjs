/** Read-only local audit. Does not load .env, connect to services or publish. */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { digest as manifestDigest, buildReleaseManifest, canonicalGeneration } from '../../enterprise/scripts/manifest-artifacts.mjs'
import { verifyReleaseArtifactDescriptor } from './release-artifact-descriptor.mjs'
import { generateReadinessPolicies } from './enterprise-readiness-policy.mjs'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const migrations = [
  '20260913-enterprise-entitlements.sql',
  '20260913-enterprise-entitlement-state.sql',
  '20260913-enterprise-order-fulfillments.sql',
  '20260913-enterprise-order-approvals.sql',
  '20260913-tenant-scheduler-ownership.sql',
  '20260913-enterprise-recovery-route.sql',
  '20260913-enterprise-external-drain-approval.sql',
  '20260914-enterprise-drain-activity-approval.sql'
]
import { assetsReceiptMigrations } from './enterprise-assets-receipt-contract.mjs'
export const sourceMigrations = assetsReceiptMigrations
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

const descriptorFailure = Object.freeze({
  WORKTREE_DIRTY: 'RELEASE_DESCRIPTOR_WORKTREE_DIRTY',
  COMMIT_NOT_PINNED: 'RELEASE_DESCRIPTOR_COMMIT_UNPINNED',
  CHECKOUT_NOT_PINNED_TO_COMMIT: 'RELEASE_DESCRIPTOR_STALE',
  DESCRIPTOR_HASH_DRIFT: 'RELEASE_DESCRIPTOR_STALE'
})

/**
 * Checks the locally recorded candidate against the exact source checkout. This
 * only proves that an artifact is reproducibly fixed; it never asserts a
 * deployment, grant, or other live-environment condition.
 */
export function auditReleaseArtifactDescriptor(input, repoRoot = root, verify = verifyReleaseArtifactDescriptor) {
  const descriptorPath = input?.artifacts?.releaseArtifactDescriptor
  if (typeof descriptorPath !== 'string' || !/^deploy\/test-env\/artifacts\/[A-Za-z0-9._-]+\.json$/.test(descriptorPath)) {
    return { artifactFixed: false, deploymentReady: false, errors: [], pending: ['RELEASE_DESCRIPTOR_MISSING'] }
  }
  try {
    const descriptor = JSON.parse(readFileSync(resolve(repoRoot, descriptorPath), 'utf8'))
    const result = verify({ repo: repoRoot, descriptor })
    if (result?.valid !== true || result.releaseState !== 'candidate' || result.deploymentState !== 'not-deployed') {
      return { artifactFixed: false, deploymentReady: false, errors: ['RELEASE_DESCRIPTOR_STATE_INVALID'], pending: [] }
    }
    return { artifactFixed: true, deploymentReady: false, errors: [], pending: [] }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return { artifactFixed: false, deploymentReady: false, errors: [descriptorFailure[code] || 'RELEASE_DESCRIPTOR_INVALID'], pending: [] }
  }
}

export function auditEnterpriseTemplate(input, repoRoot = root) {
  const errors = [], pending = []
  const require = (ok, code) => { if (!ok) errors.push(code) }
  const filled = value => typeof value === 'string' && value.trim().length > 0
  // Only reason codes are emitted. Never echo arbitrary config, paths or secrets.
  const scan = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      if (/password|privatekey|secret|accesstoken|credentialvalue/i.test(key)) errors.push('SECRET_FIELD_FORBIDDEN')
      scan(entry)
    }
  }
  scan(input)
  require(input.schemaVersion === 'enterprise-test-preflight.v1' && input.environment === 'test', 'TEST_SCHEMA_REQUIRED')
  require(input.host?.appCode === 'enterprise' && input.host?.clientCode === 'enterprise.runtime' && input.host?.oidcClientId === 'enterprise', 'HOST_IDENTITY_MISMATCH')
  require(JSON.stringify(input.host?.logicalPrefixes) === JSON.stringify({ aims: '/aims/', assets: '/assets/' }), 'LOGICAL_PREFIX_MISMATCH')
  require(input.console?.policyBundleCacheBackend === 'runtime', 'PERSISTENT_POLICY_REQUIRED')
  require(input.runtime?.authMode === 'jwt', 'JWT_REQUIRED')
  require(input.servicePolicy?.clientCode === 'enterprise.runtime' && input.servicePolicy?.appCode === 'enterprise', 'SERVICE_IDENTITY_MISMATCH')
  let expected = []
  try {
    const policy = generateReadinessPolicies(repoRoot)
    expected = policy.servicePolicy.capabilities
    require(JSON.stringify(input.servicePolicy?.capabilities) === JSON.stringify(policy.servicePolicy.capabilities), 'EXACT_CAPABILITY_DRIFT')
    require(JSON.stringify(input.servicePolicy?.audiences) === JSON.stringify(policy.servicePolicy.audiences), 'AUDIENCE_MATRIX_REQUIRED')
    require(JSON.stringify(input.externalServicePolicies) === JSON.stringify(policy.externalServicePolicies), 'EXTERNAL_SERVICE_POLICY_DRIFT')
  } catch { errors.push('READINESS_POLICY_GENERATION_FAILED') }
  for (const [domain, binding] of Object.entries(input.runtime?.domains || {})) {
    require(['aims', 'assets'].includes(domain), 'UNEXPECTED_DOMAIN')
    require(['disabled', 'legacy', 'unified'].includes(binding.read) && ['disabled', 'legacy', 'unified'].includes(binding.write)
      && (binding.scheduler === 'disabled' || (domain === 'aims' && binding.scheduler === 'unified')), 'PATH_MODE_INVALID')
    if (binding.scheduler === 'unified') {
      const worker = input.runtime?.aimsDeliveryWorker
      require(binding.write === 'unified', 'SCHEDULER_WRITER_REQUIRED')
      require(worker?.serviceClientId === 'aims.runtime' && filled(worker?.deployment)
        && worker.deployment === input.runtime?.deploymentBindings?.aims
        && worker.deployment !== input.host?.deploymentCode, 'SCHEDULER_WORKER_BINDING_MISMATCH')
      const outbox = ['integration_operation', 'integration_operation_attempt', 'service_command_receipt', 'integration_operation_dead_letter_actionable'].map(name => binding.tables?.[name])
      require(outbox.every(filled) && new Set(outbox).size === outbox.length, 'SCHEDULER_OUTBOX_MAPPING_REQUIRED')
      for (const key of ['schedulerCredentialAndExactGrants', 'schedulerTenantSelectionAndDrain']) {
        if (!filled(input.evidence?.[key])) pending.push(`EVIDENCE_MISSING_${key}`)
      }
    }
    if (binding.ownerDeployment && binding.ownerDeployment !== input.host?.deploymentCode) errors.push('DOMAIN_OWNER_MISMATCH')
    if (!binding.ownerDeployment || !Object.keys(binding.tables || {}).length) pending.push('DOMAIN_BINDING_INCOMPLETE')
  }
  require(Object.keys(input.runtime?.domains || {}).sort().join(',') === 'aims,assets', 'DOMAIN_SET_MISMATCH')
  for (const value of [input.tenantCode, input.host?.deploymentCode, input.host?.workerName, input.host?.origin, input.console?.deploymentCode, input.console?.workerName, input.runtime?.deploymentCode, input.runtime?.schemaVersion, input.runtime?.instanceId, input.runtime?.database]) {
    if (!filled(value)) pending.push('ENVIRONMENT_BINDING_INCOMPLETE')
  }
  if (input.host?.origin) {
    try { const url = new URL(input.host.origin); require(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'HOST_ORIGIN_INVALID') } catch { errors.push('HOST_ORIGIN_INVALID') }
  }
  if (!['data-runtime', 'tenant-runtime'].includes(input.runtime?.audience)) pending.push('RUNTIME_AUDIENCE_UNBOUND')
  for (const key of ['registryGeneration', 'taskOwnershipGeneration']) {
    try { canonicalGeneration(input.runtime?.[key]) } catch { pending.push('GENERATION_UNBOUND') }
  }
  for (const file of migrations) require(existsSync(resolve(repoRoot, 'platform/docs/sql/migrations', file)), 'MIGRATION_FILE_MISSING')
  for (const file of sourceMigrations) require(existsSync(resolve(repoRoot, file)), 'SOURCE_MIGRATION_FILE_MISSING')
  const descriptor = auditReleaseArtifactDescriptor(input, repoRoot)
  errors.push(...descriptor.errors)
  pending.push(...descriptor.pending)
  const artifacts = input.artifacts || {}
  if (!Object.values(artifacts).length || ['releaseManifest', 'runtimeBinary', 'schemaManifest', 'pathRegistry'].some(key => !filled(artifacts[key]))) pending.push('RELEASE_ARTIFACTS_MISSING')
  else {
    try {
      const release = JSON.parse(readFileSync(resolve(repoRoot, artifacts.releaseManifest), 'utf8'))
      require(release.runtime?.artifactSha256 === digest(resolve(repoRoot, artifacts.runtimeBinary)), 'RUNTIME_DIGEST_MISMATCH')
      require(release.schema?.manifestSha256 === digest(resolve(repoRoot, artifacts.schemaManifest)), 'SCHEMA_DIGEST_MISMATCH')
      require(release.paths?.registrySha256 === digest(resolve(repoRoot, artifacts.pathRegistry)), 'REGISTRY_DIGEST_MISMATCH')
      const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'enterprise/app.manifest.json'), 'utf8'))
      buildReleaseManifest(release, manifest)
      require(release.applicationManifestSha256 === manifestDigest(manifest) && release.permissionCatalogHash === manifest.composition?.permissionCatalogHash, 'HOST_MANIFEST_DIGEST_MISMATCH')
      require(release.schema?.version === input.runtime.schemaVersion
        && canonicalGeneration(release.paths?.generation) === canonicalGeneration(input.runtime.registryGeneration)
        && canonicalGeneration(release.tasks?.ownershipGeneration) === canonicalGeneration(input.runtime.taskOwnershipGeneration), 'RELEASE_BINDING_MISMATCH')
    } catch { errors.push('ARTIFACT_READ_FAILED') }
  }
  // Local files cannot establish that live grants, credentials or schema are active.
  // Evidence references aid review only; they never promote this audit to live-ready.
  const evidence = ['credentialAndExactGrants','externalServiceExactGrants','oidcRedirectRegistration','consolePersistentPolicyStore','runtimeSchemaAndRegistry','assetsOwnedReceiptSchema','assetsProductLinkReceiptSchema','platformCompositionAndTechnicalRelease','rollbackAndTaskOwnership']
  for (const key of evidence) if (!filled(input.evidence?.[key])) pending.push(`EVIDENCE_MISSING_${key}`)
  return { templateValid: errors.length === 0, artifactFixed: descriptor.artifactFixed, deploymentReady: false, errors: [...new Set(errors)], pending: [...new Set(pending)], requiredExternalReview: true, migrationOrder: migrations, sourceMigrationOrder: sourceMigrations, exactCapabilities: expected }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'deploy/test-env/enterprise-readiness.template.json'
    const result = auditEnterpriseTemplate(JSON.parse(readFileSync(resolve(file), 'utf8')))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.templateValid && process.argv.includes('--template-only') ? 0 : 1
  } catch { console.error('ENTERPRISE_PREFLIGHT_INPUT_INVALID'); process.exitCode = 1 }
}
