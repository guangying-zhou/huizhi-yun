import { createHash, createHmac, createPublicKey } from 'node:crypto'
import { buildLocalPackage, canonicalJson, validatePackageInput } from './evidence.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const COLD_APPS = Object.freeze(['altoc', 'finance', 'people', 'webdev'])
const M4_KINDS = Object.freeze(['p-gateway', 'p-runtime', 'p-source', 'p-nginx'])
function fail(code) { throw Error(`EVIDENCE_${code}`) }
function same(left, right) { return canonicalJson(left) === canonicalJson(right) }

export function platformKeyFact(profile) {
  if (profile?.version !== 'enterprise-cutover-profile.v1' || !profile.platform?.keyId || !profile.platform?.publicKey) fail('PROFILE_KEY')
  let raw
  try {
    raw = Buffer.from(profile.platform.publicKey, 'base64url')
    if (raw.length !== 32 || raw.toString('base64url') !== profile.platform.publicKey) fail('PROFILE_KEY')
    createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' })
  } catch { fail('PROFILE_KEY') }
  return { kid: profile.platform.keyId, publicKeySha256: sha256(raw) }
}

export function verifySealedEvidence(evidence, { input, report, profileKey, nowMs = Date.now() }) {
  if (evidence?.schemaVersion !== 'enterprise-offline-sealed-evidence.v1' || !Array.isArray(evidence.observations)) fail('SEALED_SHAPE')
  if (!same(evidence.input, input) || !same(evidence.profileKey, profileKey)) fail('SEALED_BINDING')
  const { byKind } = validatePackageInput(input, evidence.observations, nowMs)
  const local = buildLocalPackage(input, evidence.observations, nowMs)
  if (input.phase !== 'p' || evidence.manifestSha256 !== local.manifestSha256 || !same(evidence.entries, local.entries)) fail('SEALED_MANIFEST')
  if (M4_KINDS.some(kind => !byKind.has(kind))) fail('M4_INCOMPLETE')
  if (report?.schemaVersion !== 'enterprise-provider-receipts.v1' || report.binding?.tenant !== input.binding.tenant
    || report.binding.environment !== input.binding.environment || report.binding.instanceId !== input.binding.instanceId
    || report.binding.runtimeDeployment !== input.binding.runtimeDeployment || evidence.reportSha256 !== sha256(canonicalJson(report))
    || byKind.get('provider-report')?.result?.sha256 !== evidence.reportSha256) fail('REPORT_BINDING')
  if (!Array.isArray(evidence.coldArchive) || evidence.coldArchive.length !== COLD_APPS.length
    || !COLD_APPS.every(app => evidence.coldArchive.filter(item => item.app === app && /^[a-f0-9]{64}$/.test(item.evidenceSha256)
      && typeof item.reference === 'string' && item.reference.length >= 8 && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.name)
      && item.mode === 'manual').length === 1)) fail('COLD_ARCHIVE_MANUAL_REQUIRED')
  return { manifestSha256: local.manifestSha256, coldArchive: evidence.coldArchive }
}

export function buildSealedArtifacts({ input, observations, report, actors, profile, coldArchive, credential, nowMs = Date.now() }) {
  if (!Buffer.isBuffer(credential) || credential.length !== 32) fail('CREDENTIAL_LENGTH')
  const profileKey = platformKeyFact(profile)
  if (profile.tenant !== input.binding.tenant || profile.environment !== input.binding.environment
    || profile.cutoverKey !== input.binding.cutoverKey || String(profile.generation) !== input.binding.targetGeneration
    || profile.instanceId !== input.binding.instanceId || profile.runtimeDeployment !== input.binding.runtimeDeployment) fail('PROFILE_BINDING')
  if (!Array.isArray(actors) || actors.length !== 2 || new Set(actors.map(actor => actor.app)).size !== 2
    || !['aims', 'assets'].every(app => actors.some(actor => actor.app === app && /^[a-f0-9]{64}$/.test(actor.artifactSha256)
      && actor.deployment === profile.sourceDeployments?.[app]))) fail('ACTORS')
  const local = buildLocalPackage(input, observations, nowMs)
  const evidence = { schemaVersion: 'enterprise-offline-sealed-evidence.v1', input, observations, entries: local.entries,
    manifestSha256: local.manifestSha256, reportSha256: sha256(canonicalJson(report)), profileKey, coldArchive }
  verifySealedEvidence(evidence, { input, report, profileKey, nowMs })
  const evidenceBytes = Buffer.from(canonicalJson(evidence))
  const evidenceSha256 = sha256(evidenceBytes)
  const snapshot = { schemaVersion: 'enterprise-external-drain.v1', tenant: input.binding.tenant,
    environment: input.binding.environment, revision: 1, mode: 'sealed', ingressDrained: true,
    seal: { cutoverKey: input.binding.cutoverKey, targetGeneration: input.binding.targetGeneration },
    contract: { actors }, counts: [], unresolved: [], evidenceSha256, evidenceManifestSha256: local.manifestSha256 }
  const payload = canonicalJson(snapshot)
  const seal = { alg: 'HS256', payload, signature: createHmac('sha256', credential).update(payload).digest('hex') }
  return { evidenceBytes, request: { seal, report, decisions: [], evidenceBase64: evidenceBytes.toString('base64'), evidenceSha256,
    profileKey, coldArchiveReviews: [], requestId: '', approvalReference: '' } }
}
