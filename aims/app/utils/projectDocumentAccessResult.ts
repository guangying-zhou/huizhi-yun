type Lifecycle = 'draft' | 'formal' | 'archived'
type Level = 'L0' | 'L1' | 'L2' | 'L3'

export function normalizeProjectDocumentAccessResult(response: unknown) {
  const envelope = response as { code?: unknown, data?: Record<string, unknown> } | null
  const data = envelope?.code === 0 && envelope.data && typeof envelope.data === 'object' ? envelope.data : null
  const valid = typeof data?.allowed === 'boolean' && typeof data?.readonly === 'boolean' && typeof data?.reason === 'string'
    && ['none', 'view', 'download', 'edit'].includes(String(data?.permission))
    && (data?.allowed !== true || data?.permission !== 'none')
  return {
    allowed: valid && data?.allowed === true,
    readonly: valid ? data?.readonly === true : true,
    reason: valid ? data?.reason as string : 'access_check_result_invalid',
    lifecycleStage: ['draft', 'formal', 'archived'].includes(String(data?.lifecycleStage)) ? data?.lifecycleStage as Lifecycle : undefined,
    confidentialityLevel: ['L0', 'L1', 'L2', 'L3'].includes(String(data?.confidentialityLevel)) ? data?.confidentialityLevel as Level : undefined
  }
}

export function projectDocumentAccessDeniedMessage(reason: unknown) {
  if (reason === 'draft_requires_project_member') return '草稿文档仅项目成员可访问'
  if (reason === 'readonly') return '归档或只读文档不可编辑'
  if (reason === 'no_matching_grant') return '当前项目组未被授权访问该文档'
  if (reason === 'document_not_found') return '文档不存在或已删除'
  if (typeof reason !== 'string' || reason === 'access_check_result_invalid') return '文档访问校验未完成，请重试'
  return '你没有权限访问该文档'
}
