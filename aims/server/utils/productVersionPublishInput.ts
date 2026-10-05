export function productVersionPublishInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Number.isSafeInteger(versionID) || versionID < 1) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['acceptanceId', 'expectedRevision', 'expectedVersionRevision', 'expectedScopeRevision', 'reason'].includes(key))) return null
  if (![value.acceptanceId, value.expectedRevision, value.expectedVersionRevision, value.expectedScopeRevision].every(id => Number.isSafeInteger(id) && Number(id) > 0)) return null
  if (typeof value.reason !== 'string' || !value.reason.trim() || !value.reason.isWellFormed() || [...value.reason].length > 2000 || value.reason.includes('\0')) return null
  return { version_id: versionID, acceptance_id: value.acceptanceId as number, expected_revision: value.expectedRevision as number, expected_version_revision: value.expectedVersionRevision as number, expected_scope_revision: value.expectedScopeRevision as number, reason: value.reason }
}
