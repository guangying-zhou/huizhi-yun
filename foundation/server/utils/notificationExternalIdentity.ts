import { createError } from 'h3'

/** Only a validated Console publication response may suppress an external send. */
export function notificationExternalIdentityResolution(value: unknown, channel: 'wecom' | 'dingtalk', expected: string[]) {
  const fail = () => {
    throw createError({ statusCode: 503, message: 'notification_external_identity_resolution_invalid' })
  }
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>).externalIdentityResolution : null
  if (!data || typeof data !== 'object') return fail()
  const resolution = data as Record<string, unknown>
  if (resolution.channel !== channel || !Array.isArray(resolution.recipients) || !Array.isArray(resolution.skipped)) return fail()
  const seen = new Set<string>(), recipients: string[] = [], reasons = new Set<string>()
  const takeUid = (row: Record<string, unknown>) => {
    if (typeof row.uid !== 'string' || !expected.includes(row.uid) || seen.has(row.uid)) return fail()
    seen.add(row.uid)
  }
  for (const raw of resolution.recipients) {
    if (!raw || typeof raw !== 'object') return fail()
    const row = raw as Record<string, unknown>
    takeUid(row)
    if (typeof row.subject !== 'string' || !/^[A-Za-z0-9_.@-]{1,255}$/.test(row.subject)) return fail()
    recipients.push(row.subject)
  }
  for (const raw of resolution.skipped) {
    if (!raw || typeof raw !== 'object') return fail()
    const row = raw as Record<string, unknown>
    takeUid(row)
    if (row.reason !== 'external_identity_missing' && row.reason !== 'recipient_inactive') return fail()
    reasons.add(row.reason)
  }
  if (seen.size !== expected.length) return fail()
  return { recipients: [...new Set(recipients)], skippedCount: resolution.skipped.length, reasons: [...reasons] }
}
