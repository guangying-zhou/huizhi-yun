// Structural types for the existing signed drain evidence contracts.
// These declarations do not replace the runtime signature or field checks.
export interface SignedDrainSnapshot {
  alg: string
  payload: string
  signature: string
}

export interface DrainActor {
  app: string
  deployment: string
  artifactSha256: string
}

export interface DrainDecision {
  entryId: string
  entrySha256: string
  outcome: string
  evidenceKind: string
  reference: string
  evidenceSha256: string
  explanation: string
  executionEndedReference: string
  executionEndedEvidenceSha256: string
}

export interface DrainActivitySnapshot {
  schemaVersion: string
  tenant: string
  environment: string
  mode: string
  revision: number
  unresolved: { id: string, actor: string, status: string, admitted_revision: number }[]
  contract?: { actors?: DrainActor[] }
}

export interface DrainSource {
  app: string
  deployment: string
  schema: string
  [field: string]: unknown
}

export interface DrainBinding {
  tenant: string
  environment: string
  instanceId: string
  runtimeDeployment: string
  sources: DrainSource[]
  providers: DrainSource[]
  unconfiguredProviders: string[]
}

export interface DrainProviderReport {
  schemaVersion: string
  binding: DrainBinding
  probes: (DrainSource & { kind: string })[]
}

export interface ExternalDrainSnapshot {
  schemaVersion: string
  tenant: string
  environment: string
  mode: string
  ingressDrained: boolean
  revision: number
  evidenceSha256: string
  evidenceManifestSha256: string
  seal: { cutoverKey: string, targetGeneration: string }
  contract?: { actors?: DrainActor[] }
}

export interface ColdArchiveReview {
  app: string
  outcome: string
  evidenceSha256: string
  reference: string
  explanation: string
}

export interface SealedDrainEvidence {
  input: { binding: DrainBinding & { cutoverKey: string, targetGeneration: string } }
  coldArchive: ColdArchiveReview[]
}

export interface DrainEvidenceEntry {
  id: string
  classification: string
  [field: string]: unknown
}
