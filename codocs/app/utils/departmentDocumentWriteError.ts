interface ErrorEnvelope {
  statusCode?: number
  status?: number
  code?: string
  message?: string
  data?: ErrorEnvelope
}

const messages: Readonly<Record<string, string>> = Object.freeze({
  department_directory_unavailable: '部门目录暂不可用，请稍后重试',
  department_manager_required: '仅部门经理可执行此操作',
  department_writer_required: '仅本部门成员可新建或编辑',
  department_document_move_denied: '仅作者或部门经理可移动此文档',
  department_folder_not_empty: '目录不为空，请先移走其中内容',
  console_session_verification_unavailable: '登录状态暂时无法核验，请稍后重试',
  enterprise_document_storage_unavailable: '文档存储服务暂时不可用，请稍后重试'
})

function envelope(value: unknown): ErrorEnvelope {
  return value && typeof value === 'object' ? value as ErrorEnvelope : {}
}

export function departmentDocumentWriteErrorMessage(error: unknown, fallback: string): string {
  const outer = envelope(error)
  const data = envelope(outer.data)
  const detail = envelope(data.data)
  const code = detail.code || data.code || outer.code || ''
  const status = outer.statusCode || outer.status || data.statusCode || data.status || 0
  if (messages[code]) return messages[code]
  if (code === 'hzy0_upstream_error' || status === 503) return '服务暂时不可用，请稍后重试'
  if (status === 409 && (code === 'idempotency_key_conflict' || code.endsWith('_key_conflict'))) return '请求已变更，请刷新后重试'
  return data.message || outer.message || fallback
}

/** 文档页读取正文失败时的中文说明；仅使用稳定机器码/状态映射，不展示服务端英文诊断。 */
export function documentLoadErrorMessage(error: unknown): string {
  const outer = envelope(error)
  const status = outer.statusCode || outer.status || 0
  if (status === 403) return '你没有查看此文档正文的权限，请返回文档列表'
  const message = departmentDocumentWriteErrorMessage(error, '')
  const known = new Set<string>([...Object.values(messages), '服务暂时不可用，请稍后重试'])
  return known.has(message) ? message : '文档加载失败，请稍后重试'
}
