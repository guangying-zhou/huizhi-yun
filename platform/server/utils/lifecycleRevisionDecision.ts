export type LifecycleRevisionDecision = 'apply' | 'idempotent' | 'stale'

export function decideLifecycleRevision(
  appliedRevision: number,
  appliedSnapshotHash: string,
  incomingRevision: number,
  incomingSnapshotHash: string
): LifecycleRevisionDecision {
  if (incomingRevision < appliedRevision) return 'stale'
  if (incomingRevision > appliedRevision) return 'apply'
  if (incomingSnapshotHash !== appliedSnapshotHash) {
    const error = new Error('lifecycle_source_version_hash_mismatch') as Error & { statusCode?: number, statusMessage?: string }
    error.statusCode = 409
    error.statusMessage = 'lifecycle_source_version_hash_mismatch'
    throw error
  }
  return 'idempotent'
}
