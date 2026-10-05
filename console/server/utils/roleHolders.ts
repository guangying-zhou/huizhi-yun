type BundleRecord = Record<string, unknown>

export const COMPANY_SINGLETON_ROLE_CODES = ['project_director', 'qa'] as const

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function records(value: unknown): BundleRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as BundleRecord[]
    : []
}

function preferredRecords(payload: BundleRecord, preferredKey: string, fallbackKey: string) {
  const preferred = records(payload[preferredKey])
  return preferred.length ? preferred : records(payload[fallbackKey])
}

export function normalizeRequestedRoleCodes(value: unknown) {
  const allowed = new Set<string>(COMPANY_SINGLETON_ROLE_CODES)
  const requested = stringValue(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const roleCodes = [...new Set(requested.length ? requested : COMPANY_SINGLETON_ROLE_CODES)]

  for (const roleCode of roleCodes) {
    if (!allowed.has(roleCode)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `unsupported company singleton role: ${roleCode}`
      })
    }
  }
  return roleCodes
}

export function buildRoleHolderProjection(payload: BundleRecord, roleCodes: string[]) {
  const subjects = new Map<string, BundleRecord>()
  for (const subject of records(payload.subjects)) {
    if (stringValue(subject.subjectType) !== 'user') continue
    if (stringValue(subject.status) && stringValue(subject.status) !== 'active') continue
    const subjectCode = stringValue(subject.subjectCode)
    if (subjectCode) subjects.set(subjectCode, subject)
  }

  const revisions = new Map<string, BundleRecord>()
  for (const revision of records(payload.roleHolderRevisions)) {
    const roleCode = stringValue(revision.roleCode)
    if (roleCode) revisions.set(roleCode, revision)
  }

  const assignments = preferredRecords(payload, 'roleAssignments', 'subjectRoles')
  const policyRevision = Number.isSafeInteger(Number(payload.policyRevision))
    ? Number(payload.policyRevision)
    : null

  return roleCodes.map((roleCode) => {
    const holderMap = new Map<string, { uid: string, displayName: string }>()
    for (const assignment of assignments) {
      if (stringValue(assignment.roleCode) !== roleCode) continue
      if (stringValue(assignment.subjectType) !== 'user') continue
      if (stringValue(assignment.status) && stringValue(assignment.status) !== 'active') continue

      const subjectCode = stringValue(assignment.subjectCode)
      const subject = subjects.get(subjectCode)
      if (!subject) continue
      // Console sessions and downstream application identities use the stable
      // Platform subject code. externalRef identifies the upstream directory
      // record (and may be an opaque sync hash), so it is not an application UID.
      const uid = subjectCode
      if (!uid) continue
      holderMap.set(uid, {
        uid,
        displayName: stringValue(subject.displayName) || uid
      })
    }

    const holders = [...holderMap.values()].sort((left, right) =>
      left.uid.localeCompare(right.uid)
    )
    const revision = revisions.get(roleCode)
    const status = holders.length === 1
      ? 'resolved'
      : holders.length === 0
        ? 'missing'
        : 'ambiguous'

    return {
      roleCode,
      revision: Number(revision?.revision || 0),
      policyRevision,
      status,
      errorCode: status === 'resolved'
        ? null
        : status === 'missing'
          ? 'role_holder_missing'
          : 'role_holder_ambiguous',
      holders
    }
  })
}
