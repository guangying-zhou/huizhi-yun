export interface RuntimeReleaseApprovalResult {
  version: string
  approvalKind: 'promotion' | 'rollback'
  approvedAt: string
  note?: string | null
}

interface RuntimeReleaseApprovalSnapshot {
  channel: {
    approvedVersion: string
    approvalKind: string
    approvedAt: string | null
    source: 'registry' | 'bootstrap'
  }
  releases: {
    items: Array<{
      version: string
      approved: boolean
      approvedAt: string | null
      approvalKind: 'promotion' | 'rollback' | null
      approvalNote: string | null
    }>
  }
  instances: {
    total: number
    aligned: number
    pending: number
    versions: Array<{ currentVersion: string | null, count: number }>
  }
}

function utcTimestamp(value: string | null | undefined) {
  if (!value) return Number.NaN
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  return Date.parse(normalized)
}

export function isRuntimeReleaseApprovalObserved(
  snapshot: RuntimeReleaseApprovalSnapshot,
  approval: RuntimeReleaseApprovalResult
) {
  if (snapshot.channel.source === 'registry' && snapshot.channel.approvedVersion === approval.version) {
    return true
  }

  const snapshotApprovedAt = utcTimestamp(snapshot.channel.approvedAt)
  const acknowledgedAt = utcTimestamp(approval.approvedAt)
  return Number.isFinite(snapshotApprovedAt)
    && Number.isFinite(acknowledgedAt)
    && snapshotApprovedAt >= acknowledgedAt
}

export function applyRuntimeReleaseApproval<T extends RuntimeReleaseApprovalSnapshot>(
  snapshot: T,
  approval: RuntimeReleaseApprovalResult
): T {
  const aligned = snapshot.instances.versions
    .filter(item => item.currentVersion === approval.version)
    .reduce((sum, item) => sum + item.count, 0)

  return {
    ...snapshot,
    channel: {
      ...snapshot.channel,
      approvedVersion: approval.version,
      approvalKind: approval.approvalKind,
      approvedAt: approval.approvedAt,
      source: 'registry'
    },
    releases: {
      ...snapshot.releases,
      items: snapshot.releases.items.map(item => ({
        ...item,
        approved: item.version === approval.version,
        approvedAt: item.version === approval.version ? approval.approvedAt : null,
        approvalKind: item.version === approval.version ? approval.approvalKind : null,
        approvalNote: item.version === approval.version ? approval.note || null : null
      }))
    },
    instances: {
      ...snapshot.instances,
      aligned,
      pending: Math.max(0, snapshot.instances.total - aligned)
    }
  } as T
}
