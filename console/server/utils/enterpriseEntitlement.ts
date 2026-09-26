type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null }
function utc(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z')) ? parsed : NaN
}
export function evaluateEnterpriseEntitlement(payload: RecordValue, tenantCode: string, now = Date.now()) {
  if (!Object.hasOwn(payload, 'enterpriseEntitlement')) return { mode: 'legacy' as const, allowed: true, reason: null }
  const e = record(payload.enterpriseEntitlement), end = record(e?.end)
  const states = ['pending','active','suspended','expired','revoked']
  const from = utc(e?.effectiveFrom), until = end?.kind === 'finite' ? utc(end.effectiveUntil) : Infinity
  if (!e || e.schemaVersion !== 'enterprise-entitlement.v1' || e.productCode !== 'enterprise-full' || e.tenantCode !== tenantCode
    || !Number.isSafeInteger(e.revision) || Number(e.revision) < 1 || !states.includes(String(e.status)) || !states.includes(String(e.effectiveStatus))
    || !Number.isFinite(from) || !(until > from) || !end || !['finite','unlimited'].includes(String(end.kind))
    || (end.kind === 'unlimited' && !(typeof end.evidenceReference === 'string' && end.evidenceReference.trim()))) {
    return { mode: 'enterprise' as const, allowed: false, reason: 'enterprise_entitlement_invalid' }
  }
  const allowed = e.status === 'active' && e.effectiveStatus === 'active' && now >= from && now < until
  return { mode: 'enterprise' as const, allowed, reason: allowed ? null : 'enterprise_entitlement_inactive' }
}
export function enterpriseModuleAvailability(payload: RecordValue, appCode: string) {
  if (!Object.hasOwn(payload, 'enterpriseEntitlement')) return null
  const candidates = Array.isArray(payload.moduleAvailability) ? payload.moduleAvailability.map(record).filter(item => item?.appCode === appCode) : []
  const item = candidates.length === 1 ? candidates[0] : null
  // Missing/ambiguous technical evidence must never become a working route.
  const deployed = item?.deploymentState === 'deployed'
  const configurationState = item?.configurationState === 'not-configured'
    ? 'not-configured' as const
    : item?.configurationState === 'configured'
      ? 'configured' as const
      : 'unknown' as const
  if (configurationState === 'not-configured') {
    return { deploymentState: deployed ? 'deployed' as const : 'not-deployed' as const, configurationState, availabilityCode: 'module_not_configured' as const, availabilityReason: '未配置', availabilityMessage: '此模块尚未完成企业配置。' }
  }
  if (!deployed) {
    return { deploymentState: 'not-deployed' as const, configurationState, availabilityCode: 'module_not_deployed' as const, availabilityReason: '未部署', availabilityMessage: '此模块尚未部署，暂不能进入。' }
  }
  return { deploymentState: 'deployed' as const, configurationState, availabilityCode: null, availabilityReason: null, availabilityMessage: null }
}
