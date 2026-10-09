export type W3Contract = Record<string, unknown>
export const historicalConflictCodes = ['altoc_contract_version_conflict', 'altoc_contract_operation_not_applicable', 'altoc_contract_not_effective', 'altoc_contract_contact_invalid', 'altoc_contract_frozen', 'finance_historical_contract_not_ready']
export function historicalActions(row: W3Contract, edit: boolean, close: boolean) {
  const historical = row.origin_type === 'historical_import'
  return { annotate: historical && edit && ['effective', 'completed', 'terminated'].includes(String(row.status)), owner: historical && edit, projects: historical && edit && row.status === 'effective', complete: historical && close && row.status === 'effective', terminate: historical && close && row.status === 'effective' }
}
export function historicalPayload(action: string, row: W3Contract, draft: Record<string, string>) {
  const expectedVersion = Number(row.row_version)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw Error('合同版本不可用，请刷新')
  if (action === 'annotate') {
    const contact = draft.contact_id ? Number(draft.contact_id) : null
    if (contact !== null && (!Number.isSafeInteger(contact) || contact < 1)) throw Error('请选择该客户的联系人')
    return { expectedVersion, contact_id: contact, remark: draft.remark?.trim() || null, content_summary: draft.content_summary?.trim() || null }
  }
  if (action === 'owner') {
    if (!draft.owner_uid || draft.owner_uid === 'system:unassigned') throw Error('请选择在职负责人')
    return { expectedVersion, owner_uid: draft.owner_uid, ...(draft.owner_dept_code ? { owner_dept_code: draft.owner_dept_code } : {}) }
  }
  if (action === 'projects') {
    if (!draft.project_code) throw Error('请选择有权编辑的项目')
    return { expectedVersion, projects: [{ projectCode: draft.project_code, name: draft.project_name || '', deptCode: draft.project_dept || '', create: false, lineCodes: [], obligationCodes: [], billingScheduleCodes: [] }] }
  }
  const reason = draft.reason?.trim() || ''
  if (reason.length > 500 || (action === 'terminate' && !reason)) throw Error('请填写中止原因（不超过 500 字）')
  return { expectedVersion, ...(reason ? { reason } : {}) }
}
export function historicalWriteMessage(error: unknown) {
  const e = error as { statusCode?: number, status?: number, response?: { status?: number }, data?: { code?: string, data?: { code?: string } }, message?: string }
  const code = e.data?.data?.code || e.data?.code
  if (code === 'finance_historical_contract_not_ready') return '历史合同财务输入尚未就绪，请先完成财务核对'
  if (code === 'altoc_contract_contact_invalid') return '联系人不属于该合同客户，请重新选择'
  const status = Number(e.statusCode || e.status || e.response?.status)
  if (status === 403) return '没有执行此合同操作的权限或对象已超出您的范围'
  if (status === 409) return '合同已变更或当前状态不允许此操作；草稿已保留，请刷新比较后重新确认'
  if (!status && e instanceof Error && !/fetch|network/i.test(e.message)) return e.message
  return '保存结果未确认，请保持原填写内容重试；重试沿用同一请求'
}
