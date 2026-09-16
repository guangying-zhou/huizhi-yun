export function validProductFeedbackProgress(command: Record<string, unknown>): boolean {
  if (Object.keys(command).length !== 8 || !['submitted', 'evaluating', 'accepted', 'deferred', 'rejected'].includes(String(command.canonicalDecisionStatus))) return false
  if (command.requestBizId === command.canonicalRequestBizId && command.decisionStatus !== command.canonicalDecisionStatus) return false
  if (!Array.isArray(command.versions) || command.versions.length > 1000) return false
  const seen = new Set<string>()
  const date = (value: unknown, timestamp: boolean) => {
    if (value === null) return true
    if (typeof value !== 'string' || !(timestamp ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return false
    const iso = timestamp ? `${value.replace(' ', 'T')}Z` : `${value}T00:00:00Z`
    const parsed = new Date(iso)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, timestamp ? 19 : 10) === (timestamp ? value.replace(' ', 'T') : value)
  }
  return command.versions.every((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false
    const v = row as Record<string, unknown>
    if (Object.keys(v).length !== 6 || typeof v.versionCode !== 'string' || !v.versionCode.isWellFormed() || !v.versionCode || v.versionCode.trim() !== v.versionCode || [...v.versionCode].length > 64 || /[/\\\p{Cc}]/u.test(v.versionCode) || seen.has(v.versionCode)) return false
    seen.add(v.versionCode)
    return ['planning', 'developing', 'released', 'archived'].includes(String(v.status)) && date(v.plannedReleaseDate, false) && date(v.releasedAt, true) && Number.isSafeInteger(v.publicFeatureCount) && Number(v.publicFeatureCount) > 0 && Number.isSafeInteger(v.deliveredFeatureCount) && Number(v.deliveredFeatureCount) >= 0 && Number(v.deliveredFeatureCount) <= Number(v.publicFeatureCount)
  })
}
