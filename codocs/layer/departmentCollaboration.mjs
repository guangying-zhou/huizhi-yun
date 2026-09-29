/**
 * UI state for department document real-time collaboration in the Enterprise
 * Host (docs/Codocs-Host-Department-Collaboration-Design.md). Everything here
 * is presentation: the server (Host and Runtime) decides who may write, and
 * Collab enforces the session. `canEdit` is only the hint the Host returned.
 */

/** Collab closes a socket with 4403 when the user's access is withdrawn or the room is closed. */
export const COLLABORATION_ACCESS_CLOSE_CODE = 4403

/**
 * @param {unknown} event The provider's close event.
 * @returns {'revoked'|'closed'|null}
 */
export function collaborationCloseKind(event) {
  const close = /** @type {{ code?: unknown, reason?: unknown } | null} */ (event)
  if (!close || close.code !== COLLABORATION_ACCESS_CLOSE_CODE) return null
  return close.reason === 'collaboration_session_closed' ? 'closed' : 'revoked'
}

/**
 * Host admission ticket request for a document scene. Department documents use
 * their own endpoint (the server re-derives the department relation and the
 * writer rule); personal shared documents keep the original one.
 * @param {'private'|'department'} scene
 * @param {string} documentId
 * @param {string} deptCode
 */
export function hostCollaborationTicketRequest(scene, documentId, deptCode) {
  return scene === 'department'
    ? { path: `/api/departments/documents/${documentId}/collaboration`, query: { dept_code: deptCode } }
    : { path: `/api/documents/${documentId}/collaboration`, query: undefined }
}

/**
 * Version history requests. Department documents use a read-only history of
 * their own (list plus one exact version, no restore, delete or diff); every
 * other scene keeps the original document endpoints.
 * @param {'private'|'department'} scene
 * @param {string} documentId
 * @param {string} deptCode
 */
export function versionHistoryRequests(scene, documentId, deptCode) {
  if (scene === 'department') {
    const query = { dept_code: deptCode }
    return {
      readOnly: true,
      list: { path: `/api/departments/documents/${documentId}/versions`, query },
      view: versionId => ({ path: `/api/departments/documents/${documentId}/versions/${versionId}`, query })
    }
  }
  return {
    readOnly: false,
    list: { path: `/api/documents/${documentId}/versions`, query: undefined },
    view: versionId => ({ path: `/api/documents/${documentId}/versions/${versionId}`, query: undefined })
  }
}

/** Host statuses that carry a stable, user-actionable meaning when opening a session. */
const OPEN_FAILURE_TEXT = {
  department_writer_required: '当前账号不是该部门的编辑成员，无法协作编辑',
  department_document_write_denied: '只有文档所有者、被授予编辑权的成员或部门经理可以协作编辑',
  collaboration_writer_limit_reached: '当前协作人数已达上限，请稍后再试',
  collaboration_open_rate_limited: '操作过于频繁，请稍后再试',
  document_not_on_snapshot_v2: '文档尚未转换为协作格式，请重新点击协作编辑',
  department_document_not_convertible: '该文档不支持协作编辑（仅支持在用的部门 Markdown 文档，周报和已归档文档除外）',
  document_v1_collaboration_active: '文档近期有人在旧版协作中编辑，请等待几分钟后再试',
  snapshot_generation_conflict: '文档刚刚已被他人更新，请刷新后重试',
  department_collaboration_disabled: '部门文档协作暂未启用'
}

/** Message for a failed conversion / ticket request, from the Host error envelope. */
export function departmentCollaborationFailureText(error, fallback = '暂时无法进入协作编辑，请稍后重试') {
  const failure = error && typeof error === 'object' ? error : {}
  const code = failure.data?.data?.code ?? failure.data?.code
  if (typeof code === 'string' && Object.hasOwn(OPEN_FAILURE_TEXT, code)) return OPEN_FAILURE_TEXT[code]
  const status = failure.statusCode ?? failure.status ?? failure.response?.status
  if (status === 403) return '没有协作编辑该文档的权限'
  if (status === 413) return '文档正文超过 10 MiB，无法转为协作文档'
  return fallback
}

/**
 * @param {object} input
 * @param {boolean} input.enabled Hosted, feature on, and a department document.
 * @param {boolean} input.canEdit Host hint that this user may write.
 * @param {boolean} input.converted Published snapshot generation is above 0.
 * @param {boolean} input.requested The user asked for collaboration on this page.
 * @param {'idle'|'converting'|'failed'} input.phase Conversion phase.
 * @param {string} [input.failure] Message for phase `failed`.
 * @param {boolean} input.connecting Socket is connecting.
 * @param {boolean} input.connected Socket is connected.
 * @param {boolean} input.synced Y.Doc is synced.
 * @param {'read-write'|'readonly'|null} input.scope Scope granted by Collab.
 * @param {boolean} input.hasError Provider or ticket error.
 * @param {'revoked'|'closed'|null} input.closeKind Collab 4403 close.
 * @param {number} [input.collaborators] Other online members.
 * @returns {{ entry: 'hidden'|'start'|'busy'|'retry', status: {tone: 'neutral'|'info'|'success'|'warning', label: string, description: string}|null, notice: {tone: 'warning', title: string, description: string}|null }}
 */
export function departmentCollaborationView(input) {
  if (!input.enabled) return { entry: 'hidden', status: null, notice: null }
  if (input.closeKind === 'revoked') {
    return {
      entry: 'hidden',
      status: { tone: 'warning', label: '协作已中断', description: '你已失去该文档的编辑权限' },
      notice: {
        tone: 'warning',
        title: '已失去编辑权限',
        description: '你的最新更改可能没有保存到文档。请复制需要保留的内容，然后刷新页面查看最新发布的版本。'
      }
    }
  }
  if (input.closeKind === 'closed') {
    return {
      entry: 'hidden',
      status: { tone: 'warning', label: '协作已结束', description: '文档已被设为只读、回收或移交，协作会话已关闭' },
      notice: {
        tone: 'warning',
        title: '协作会话已关闭',
        description: '文档状态已变化（只读、回收、移交或分享调整）。未同步的更改可能丢失，请复制需要保留的内容后刷新页面。'
      }
    }
  }
  if (!input.canEdit) {
    return {
      entry: 'hidden',
      status: { tone: 'neutral', label: '只读查看', description: '你正在查看最近一次发布的版本，没有该文档的协作编辑权限' },
      notice: null
    }
  }
  if (!input.requested) {
    return {
      entry: 'start',
      status: {
        tone: 'neutral',
        label: input.converted ? '可协作编辑' : '只读查看',
        description: input.converted
          ? '文档已开启协作，点击“协作编辑”加入'
          : '首次协作编辑会把文档转为协作格式，此后旧版编辑入口不再可写'
      },
      notice: null
    }
  }
  if (input.phase === 'converting') {
    return { entry: 'busy', status: { tone: 'info', label: '正在转换', description: '正在把文档转为协作格式，请稍候' }, notice: null }
  }
  if (input.phase === 'failed') {
    return {
      entry: 'retry',
      status: { tone: 'warning', label: '无法协作', description: input.failure || '暂时无法进入协作编辑，请稍后重试' },
      notice: null
    }
  }
  if (input.hasError) {
    return { entry: 'retry', status: { tone: 'warning', label: '协同异常', description: input.failure || '实时连接异常，可点击重连继续尝试' }, notice: null }
  }
  if (input.connected && input.synced) {
    if (input.scope === 'readonly') {
      return { entry: 'hidden', status: { tone: 'warning', label: '仅可查看', description: '协作服务只授予查看权限' }, notice: null }
    }
    const others = input.collaborators || 0
    return {
      entry: 'hidden',
      status: { tone: 'success', label: '协同中', description: others > 0 ? `与 ${others} 位成员实时协作，修改会自动保存` : '实时协作，修改会自动保存' },
      notice: null
    }
  }
  if (input.connecting || input.connected) {
    return { entry: 'busy', status: { tone: 'info', label: input.connected ? '同步中' : '协同连接中', description: input.connected ? '等待协作内容完成同步' : '正在建立实时连接' }, notice: null }
  }
  return { entry: 'retry', status: { tone: 'warning', label: '协同已断开', description: '可点击重连继续协作编辑' }, notice: null }
}

/** Read-only status for a department document when department collaboration is not enabled. */
/** @returns {{ tone: 'neutral', label: string, description: string }} */
export function departmentCollaborationDisabledStatus() {
  return { tone: 'neutral', label: '只读查看', description: '部门文档在线协作未开启，当前仅可查看' }
}
