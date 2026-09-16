const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.isWellFormed() && [...value].length <= max && !value.includes('\0')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function productVersionAcceptanceInput(raw: unknown, versionID: number) {
  if (!object(raw) || !Number.isSafeInteger(versionID) || versionID < 1) return null
  if (Object.keys(raw).some(key => !['expectedRevision', 'expectedVersionRevision', 'expectedScopeRevision', 'expectedReviewHash', 'checks', 'exceptions'].includes(key))) return null
  if (![raw.expectedRevision, raw.expectedVersionRevision, raw.expectedScopeRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0) || typeof raw.expectedReviewHash !== 'string' || !/^[0-9a-f]{64}$/.test(raw.expectedReviewHash)) return null
  if (!Array.isArray(raw.checks) || raw.checks.length !== 3 || !Array.isArray(raw.exceptions) || raw.exceptions.length > 50) return null
  const required = new Set(['execution-review', 'blocking-defects-review', 'release-readiness'])
  const checks: { code: string, evidence: string }[] = []
  for (const check of raw.checks) {
    if (!object(check) || Object.keys(check).some(key => !['code', 'evidence'].includes(key)) || typeof check.code !== 'string' || !required.delete(check.code) || !text(check.evidence, 10000)) return null
    checks.push({ code: check.code, evidence: check.evidence })
  }
  const seen = new Set<string>()
  const exceptions: { code: string, reason: string, responsible_uid: string, impact: string }[] = []
  for (const exception of raw.exceptions) {
    if (!object(exception) || Object.keys(exception).some(key => !['code', 'reason', 'responsibleUid', 'impact'].includes(key)) || !text(exception.code, 64) || seen.has(exception.code) || !text(exception.reason, 2000) || !text(exception.responsibleUid, 64) || exception.responsibleUid !== exception.responsibleUid.trim() || !text(exception.impact, 2000)) return null
    seen.add(exception.code)
    exceptions.push({ code: exception.code, reason: exception.reason, responsible_uid: exception.responsibleUid, impact: exception.impact })
  }
  return { version_id: versionID, expected_revision: raw.expectedRevision as number, expected_version_revision: raw.expectedVersionRevision as number, expected_scope_revision: raw.expectedScopeRevision as number, expected_review_hash: raw.expectedReviewHash, checks, exceptions }
}
