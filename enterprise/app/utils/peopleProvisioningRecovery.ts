// Recovery metadata is not authority. Every replay re-enters current Host and
// Runtime authorization with the original payload/key; no target facts persist.
export const provisioningActions = ['provision', 'refresh-status', 'activation-link', 'activate', 'cancel'] as const
export type ProvisioningAction = typeof provisioningActions[number]
export interface ProvisioningRecovery { id: string, action: ProvisioningAction, expectedVersion: number, key: string }
// The cache scope comes from the verified Enterprise session. Policy revisions
// invalidate UI data, but must not discard an uncertain original command key.
export function provisioningIdentityScope(cacheScope: string): string {
  try {
    const fields = JSON.parse(cacheScope)
    if (!Array.isArray(fields) || fields.length !== 5 || fields.some(v => typeof v !== 'string') || !fields[0] || !(fields[1] || fields[2]) || !fields[3] || !fields[4]) return ''
    return JSON.stringify([fields[0], fields[1], fields[2], fields[4]])
  } catch { return '' }
}
export function parseProvisioningRecovery(raw: string | null, scope: string): ProvisioningRecovery | null {
  if (!raw || !scope) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'action,expectedVersion,id,key,scope' || value.scope !== scope || !/^[1-9]\d{0,15}$/.test(value.id) || typeof value.id !== 'string' || !provisioningActions.includes(value.action) || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1 || value.expectedVersion > 4294967295 || typeof value.key !== 'string' || !/^people-onboarding-account:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.key)) return null
    return { id: value.id, action: value.action, expectedVersion: value.expectedVersion, key: value.key }
  } catch { return null }
}
export function serializeProvisioningRecovery(intent: ProvisioningRecovery, scope: string): string {
  const raw = JSON.stringify({ scope, ...intent })
  if (!parseProvisioningRecovery(raw, scope)) throw Error('Invalid provisioning recovery metadata')
  return raw
}
export const provisioningStatusLabels: Record<string, string> = {
  pending: '等待处理', processing: '处理中', retry_wait: '等待原键重试', partial_unknown: '结果待核对',
  succeeded: '已确认成功', failed_permanent: '处理失败，需诊断', dead_letter: '已停止自动重试', unknown: '尚未确认'
}
