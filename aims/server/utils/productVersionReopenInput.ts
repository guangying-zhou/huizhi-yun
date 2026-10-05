export function productVersionReopenInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Number.isSafeInteger(versionID) || versionID < 1) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['releaseRecordId', 'expectedRevision', 'expectedVersionRevision', 'reason'].includes(key))) return null
  if (![v.releaseRecordId, v.expectedRevision, v.expectedVersionRevision].every(n => Number.isSafeInteger(n) && Number(n) > 0)) return null
  if (typeof v.reason !== 'string' || !v.reason.trim() || !v.reason.isWellFormed() || [...v.reason].length > 2000 || v.reason.includes('\0')) return null
  return { version_id: versionID, release_record_id: v.releaseRecordId as number, expected_revision: v.expectedRevision as number, expected_version_revision: v.expectedVersionRevision as number, reason: v.reason }
}
