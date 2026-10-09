/**
 * 流程能力集与业务视图构建工具
 */

interface InstanceLike {
  initiator_uid: string
  status: string
  flow_snapshot: string | Record<string, unknown>
  app_code?: string
  resource_code?: string
  biz_id?: string
  biz_url?: string | null
}

interface TaskLike {
  assignee_uid: string
  status: string
}

export interface Capabilities {
  can_approve: boolean
  can_reject: boolean
  can_delegate: boolean
  can_cancel: boolean
  can_resubmit: boolean
  can_comment: boolean
}

export interface BusinessView {
  mode: 'local' | 'iframe' | 'external-link'
  app_code: string
  resource_code: string
  biz_id: string
  biz_url: string | null
  embed_url: string | null
}

/**
 * 构建当前用户对流程实例的操作能力集
 *
 * 前端不自行推断可执行操作，全部以此函数返回为准。
 */
export function buildCapabilities(
  instance: InstanceLike,
  task: TaskLike | null,
  currentUid: string
): Capabilities {
  const isAssignee = task?.assignee_uid === currentUid && task?.status === 'pending'
  const isInitiator = instance.initiator_uid === currentUid
  const isRunning = instance.status === 'running'
  const isRejected = instance.status === 'rejected'

  let config: Record<string, unknown> = {}
  try {
    const snapshot = typeof instance.flow_snapshot === 'string'
      ? JSON.parse(instance.flow_snapshot)
      : instance.flow_snapshot
    config = (snapshot as { config?: Record<string, unknown> })?.config || {}
  } catch {
    // ignore
  }

  return {
    can_approve: isAssignee && isRunning,
    can_reject: isAssignee && isRunning,
    can_delegate: isAssignee && isRunning && !!config.allow_delegate,
    can_cancel: isInitiator && isRunning && !!config.allow_withdraw,
    can_resubmit: isInitiator && isRejected && !!config.allow_resubmit,
    can_comment: isRunning
  }
}

/**
 * 构建业务详情视图信息
 *
 * mode 判断逻辑：
 * - 同应用 + 有 embed_url_pattern → 'local'（表示优先本地渲染，不保证本地视图一定存在）
 * - 跨应用 + 有 embed_url_pattern → 'iframe'
 * - 无 embed_url_pattern → 'external-link'（仅提供 biz_url 跳转）
 *
 * 注意：
 * - mode='local' 仅表示"当前请求来自同应用，优先尝试本地视图"
 * - 是否真的能本地渲染，取决于业务模块是否已注册对应 resource_code 的只读视图解析器
 * - 若本地解析器不存在，WorkflowBusinessView 必须 fallback 到 iframe 或 external-link
 */
export function buildBusinessView(
  instance: {
    app_code: string
    resource_code: string
    biz_id: string
    biz_url?: string | null
    biz_context?: Record<string, unknown> | string | null
  },
  embedUrlPattern: string | null,
  requestAppCode: string
): BusinessView {
  const isSameApp = requestAppCode === instance.app_code

  if (!embedUrlPattern) {
    return {
      mode: 'external-link',
      app_code: instance.app_code,
      resource_code: instance.resource_code,
      biz_id: instance.biz_id,
      biz_url: instance.biz_url || null,
      embed_url: null
    }
  }

  // Parse biz_context if it's a JSON string
  let ctx: Record<string, unknown> = {}
  if (instance.biz_context) {
    if (typeof instance.biz_context === 'string') {
      try {
        ctx = JSON.parse(instance.biz_context) as Record<string, unknown>
      } catch { /* ignore */ }
    } else if (typeof instance.biz_context === 'object') {
      ctx = instance.biz_context as Record<string, unknown>
    }
  }

  // Replace placeholders:
  // - {resource_code}, {biz_id}: instance fields
  // - {biz_context.xxx}: values from biz_context JSON (empty string if not found)
  // - {app_base_url}: left as-is (resolved by frontend)
  const embedUrl = embedUrlPattern
    .replace('{resource_code}', instance.resource_code)
    .replace('{biz_id}', instance.biz_id)
    .replace(/\{biz_context\.([\w.]+)\}/g, (_m, path: string) => {
      const parts = path.split('.')
      let cur: unknown = ctx
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p]
        } else {
          return ''
        }
      }
      return cur == null ? '' : String(cur)
    })

  return {
    mode: isSameApp ? 'local' : 'iframe',
    app_code: instance.app_code,
    resource_code: instance.resource_code,
    biz_id: instance.biz_id,
    biz_url: instance.biz_url || null,
    embed_url: embedUrl
  }
}
