import { createError } from 'h3'

/** Validate the dedicated runtime contract before evaluating scoped permissions. */
export function requireAimsProjectAuthorizationRecord(value: unknown, projectID: string): Record<string, unknown> {
  const fail = () => createError({ statusCode: 503, message: '项目授权事实不完整，请稍后重试' })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail()
  const record = value as Record<string, unknown>
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== ''
  const nullableText = (v: unknown) => v === null || typeof v === 'string'
  if (!Number.isSafeInteger(record.id) || Number(record.id) <= 0 || String(record.id) !== projectID
    || !text(record.project_code) || typeof record.created_by !== 'string'
    || !nullableText(record.dept_code) || !nullableText(record.leader_uid)
    || !Array.isArray(record.members)) throw fail()
  for (const member of record.members) {
    if (!member || typeof member !== 'object' || Array.isArray(member)
      || !text(member.uid) || !text(member.status)) throw fail()
  }
  return record
}
