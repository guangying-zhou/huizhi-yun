import { createHash, createHmac, createPublicKey, timingSafeEqual } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { withTransaction, type TransactionExecutor } from './db.ts'
import { exportPubkey, sign } from './platformSigning.ts'
import { classifyProviderEvidence } from './enterpriseProviderReceipts.mjs'
import { parseCanonicalJson } from '../../../deploy/self-hosted/cutover/evidence.mjs'
import { verifySealedEvidence } from '../../../deploy/self-hosted/cutover/sealed.mjs'
import { readCredential } from '../../../deploy/self-hosted/cutover/protected-files.mjs'
import { immutableExternalDrainApproval } from './immutableExternalDrainApproval.mjs'

const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
function fail(reason: string): never {
  throw Error(`external_drain_${reason}`)
}
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value === value.trim()
const coverage = ['deployed-worker-versions-and-direct-bindings', 'pre-wrapper-inflight-history', 'runtime-direct-callers', 'external-notification-providers', 'scheduled-consumers-and-other-app-outboxes']
const providerApps = ['aims', 'assets', 'finance', 'altoc', 'codocs', 'people', 'console']
async function verifyRegisteredBinding(tx: TransactionExecutor, snapshot: any, binding: any) {
  if (!['test', 'prod', 'dev'].includes(snapshot.environment)) fail('environment_invalid')
  const tenant = await tx.queryRow<RowDataPacket>('SELECT tenant_code,status FROM tenants WHERE tenant_code=? FOR UPDATE', [snapshot.tenant])
  if (!tenant || tenant.status !== 'active') fail('tenant_missing_or_inactive')
  const runtime = await tx.queryRow<RowDataPacket>('SELECT runtime_code,status FROM tenant_runtime_instances WHERE tenant_code=? AND environment=? FOR UPDATE', [snapshot.tenant, snapshot.environment])
  if (!runtime || runtime.status !== 'ready' || binding.runtimeDeployment !== runtime.runtime_code) fail('runtime_binding_invalid')
  const deployments = await tx.queryRows<RowDataPacket[]>(`SELECT app_code,deployment_code FROM deployments WHERE tenant_code=? AND environment=? AND status='active' AND app_code IN ('aims','assets','finance','altoc','codocs','people','console') ORDER BY app_code FOR UPDATE`, [snapshot.tenant, snapshot.environment])
  const byApp = new Map<string, string>()
  for (const row of deployments) {
    if (byApp.has(row.app_code)) fail('deployment_ambiguous')
    byApp.set(row.app_code, row.deployment_code)
  }
  if (binding.sources.some((source: any) => byApp.get(source.app) !== source.deployment)) fail('source_deployment_unregistered')
  if (binding.providers.some((provider: any) => byApp.get(provider.app) !== provider.deployment)) fail('provider_deployment_unregistered')
  if (binding.unconfiguredProviders.some((app: string) => byApp.has(app))) fail('provider_configuration_conflict')
}
function signingKeyFact(key: { kid: string, publicKey: string }) {
  const raw = createPublicKey(key.publicKey).export({ type: 'spki', format: 'der' }).subarray(-32)
  return { kid: key.kid, publicKeySha256: createHash('sha256').update(raw).digest('hex') }
}
function drainCredential() {
  if (process.env.CREDENTIALS_DIRECTORY) return readCredential(process.env.CREDENTIALS_DIRECTORY)
  if (process.env.NODE_ENV !== 'production' && process.env.HZY_DRAIN_CONTROL_TOKEN) return Buffer.from(process.env.HZY_DRAIN_CONTROL_TOKEN)
  fail('credential_unavailable')
}
export async function approveExternalDrain(input: {
  report: any
  seal: any
  decisions: any[]
  requestId: string
  approvalReference: string
  evidenceBase64: string
  evidenceSha256: string
  profileKey: { kid: string, publicKeySha256: string }
  coldArchiveReviews: any[]
}, actorUid: string, apply = false) {
  const { report, seal, decisions } = input
  const secret = drainCredential()
  try {
    if (!seal || seal.alg !== 'HS256' || typeof seal.payload !== 'string' || !/^[a-f0-9]{64}$/.test(seal.signature) || !timingSafeEqual(createHmac('sha256', secret).update(seal.payload).digest(), Buffer.from(seal.signature, 'hex'))) fail('seal_signature_invalid')
  } finally {
    secret.fill(0)
  }
  const snapshot = JSON.parse(seal.payload)
  if (typeof input.evidenceBase64 !== 'string' || input.evidenceBase64.length > 44 * 1024 * 1024
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.evidenceBase64)) fail('evidence_file_invalid')
  const evidenceBytes = Buffer.from(input.evidenceBase64, 'base64')
  if (evidenceBytes.toString('base64') !== input.evidenceBase64 || evidenceBytes.length > 32 * 1024 * 1024
    || !/^[a-f0-9]{64}$/.test(input.evidenceSha256) || digest(evidenceBytes) !== input.evidenceSha256
    || snapshot.evidenceSha256 !== input.evidenceSha256) fail('evidence_file_changed')
  let evidence: any
  try {
    evidence = parseCanonicalJson(evidenceBytes)
  } catch {
    fail('evidence_file_invalid')
  }
  try {
    const checked = verifySealedEvidence(evidence, { input: evidence.input, report, profileKey: input.profileKey })
    if (snapshot.evidenceManifestSha256 !== checked.manifestSha256) fail('evidence_manifest_changed')
  } catch {
    fail('evidence_file_invalid')
  }
  const evidenceBinding = evidence.input.binding
  if (snapshot.tenant !== evidenceBinding.tenant || snapshot.environment !== evidenceBinding.environment
    || snapshot.seal?.cutoverKey !== evidenceBinding.cutoverKey || snapshot.seal?.targetGeneration !== evidenceBinding.targetGeneration
    || report?.binding?.instanceId !== evidenceBinding.instanceId || report?.binding?.runtimeDeployment !== evidenceBinding.runtimeDeployment) fail('evidence_binding_mismatch')
  const activeKey = await exportPubkey()
  if (JSON.stringify(signingKeyFact(activeKey)) !== JSON.stringify(input.profileKey)) fail('profile_signing_key_mismatch')
  const binding = report?.binding
  if (!binding || report.schemaVersion !== 'enterprise-provider-receipts.v1' || snapshot.schemaVersion !== 'enterprise-external-drain.v1' || snapshot.mode !== 'sealed' || !snapshot.ingressDrained || !text(snapshot.tenant) || !text(snapshot.environment) || binding.tenant !== snapshot.tenant || binding.environment !== snapshot.environment || !text(binding.instanceId) || !text(binding.runtimeDeployment) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || !text(snapshot.seal?.cutoverKey) || !/^[1-9][0-9]{0,19}$/.test(snapshot.seal.targetGeneration) || BigInt(snapshot.seal.targetGeneration) > 18446744073709551615n) fail('identity_invalid')
  if (!Array.isArray(binding.sources) || binding.sources.length !== 2 || new Set(binding.sources.map((value: any) => value.app)).size !== 2 || binding.sources.some((value: any) => !['aims', 'assets'].includes(value.app) || !text(value.deployment) || !/^[a-z][a-z0-9_]{0,63}$/.test(value.schema))) fail('source_closure_invalid')
  const providers = new Set(providerApps)
  if (!Array.isArray(binding.providers) || !Array.isArray(binding.unconfiguredProviders)) fail('provider_closure_invalid')
  for (const provider of binding.providers) {
    if (!providers.delete(provider.app) || !/^[a-z][a-z0-9_]{0,63}$/.test(provider.schema) || !text(provider.deployment)) fail('provider_closure_invalid')
  }
  for (const app of binding.unconfiguredProviders) if (!providers.delete(app)) fail('provider_closure_invalid')
  if (providers.size || binding.sources.some((source: any) => !binding.providers.some((provider: any) => provider.app === source.app && provider.schema === source.schema && provider.deployment === source.deployment))) fail('provider_closure_invalid')
  const expected = [...binding.sources.map((value: any) => ({ ...value, kind: 'source' })), ...binding.providers.map((value: any) => ({ ...value, kind: value.app === 'console' ? 'notification' : 'receipt' }))]
  if (!Array.isArray(report.probes) || report.probes.length !== expected.length || expected.some((value: any) => report.probes.filter((probe: any) => ['kind', 'app', 'schema', 'deployment'].every(field => probe[field] === value[field])).length !== 1)) fail('probe_closure_invalid')
  const entries = classifyProviderEvidence(binding, report.probes)
  if (new Set(entries.map((entry: any) => entry.id)).size !== entries.length) fail('entry_closure_invalid')
  if (entries.some((entry: any) => entry.classification === 'blocked') || coverage.some(scope => !entries.some((entry: any) => entry.id === `coverage:${scope}`))) fail('blocked_evidence')
  const manual = entries.filter((entry: any) => entry.classification === 'manual-required')
  if (!Array.isArray(input.coldArchiveReviews) || input.coldArchiveReviews.length !== 4
    || !['finance', 'people', 'altoc', 'webdev'].every((app) => {
      const cold = evidence.coldArchive.find((item: any) => item.app === app)
      return input.coldArchiveReviews.filter(review => review.app === app && review.outcome === 'verified-manual'
        && review.evidenceSha256 === cold.evidenceSha256 && review.reference === cold.reference
        && text(review.explanation) && review.explanation.length >= 16).length === 1
    })) fail('cold_archive_manual_missing')
  for (const app of ['finance', 'people', 'altoc']) if (binding.unconfiguredProviders.includes(app)
    && entries.some((item: any) => item.id === `coverage:unconfigured-provider:${app}` && item.classification === 'not-applicable')) fail('cold_archive_auto_pass')
  if (!Array.isArray(decisions) || decisions.length !== manual.length || new Set(decisions.map(value => value.entryId)).size !== manual.length || manual.some((entry: any) => !decisions.some(decision => decision.entryId === entry.id && decision.entrySha256 === digest(entry) && ((entry.id.startsWith('operation:') || entry.id.startsWith('notification:') || ['coverage:pre-wrapper-inflight-history', 'coverage:external-notification-providers'].includes(entry.id)) ? ['verified-terminal', 'verified-not-sent'] : ['verified-terminal', 'verified-not-sent', 'verified-consumer-coverage']).includes(decision.outcome) && ['provider-query', 'provider-export', 'activity-ledger', 'deployment-inventory'].includes(decision.evidenceKind) && text(decision.reference) && decision.reference.length >= 8 && /^[a-f0-9]{64}$/.test(decision.evidenceSha256) && text(decision.explanation) && decision.explanation.length >= 16))) fail('manual_evidence_incomplete')
  if (![input.requestId, input.approvalReference, actorUid].every(text)) fail('approval_audit_required')
  const actors = snapshot.contract?.actors
  if (!Array.isArray(actors) || actors.length !== 2 || binding.sources.some((source: any) => !actors.some((actor: any) => actor.app === source.app && actor.deployment === source.deployment && /^[a-f0-9]{64}$/.test(actor.artifactSha256)))) fail('actor_mismatch')
  const result = await withTransaction(async (tx) => {
    await verifyRegisteredBinding(tx, snapshot, binding)
    const payload = JSON.stringify({ type: 'enterprise-external-drain-approval.v1', tenant: binding.tenant, environment: binding.environment, cutoverKey: snapshot.seal.cutoverKey, generation: snapshot.seal.targetGeneration, sealRevision: snapshot.revision, sealPayloadSha256: digest(seal.payload), evidenceSha256: input.evidenceSha256, evidenceManifestSha256: snapshot.evidenceManifestSha256, platformKeyFingerprint: input.profileKey.publicKeySha256, actors, report: { ...report, entries }, decisions, coldArchiveReviews: input.coldArchiveReviews, actorUid, approvalReference: input.approvalReference, requestId: input.requestId })
    return immutableExternalDrainApproval(tx, { tenant: binding.tenant, environment: binding.environment, cutoverKey: snapshot.seal.cutoverKey,
      generation: snapshot.seal.targetGeneration, revision: snapshot.revision, requestId: input.requestId,
      sealPayloadSha256: digest(seal.payload), actorUid, approvalReference: input.approvalReference, payload, apply,
      signArtifact: async (raw: string) => {
        const signed = await sign(raw)
        if (JSON.stringify(signingKeyFact(signed)) !== JSON.stringify(input.profileKey)) fail('profile_signing_key_mismatch')
        const publicKey = createPublicKey(signed.publicKey)
        if (publicKey.asymmetricKeyType !== 'ed25519') fail('signing_key_invalid')
        return { payload: raw, ...signed, publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url') }
      } })
  })
  return result
}
