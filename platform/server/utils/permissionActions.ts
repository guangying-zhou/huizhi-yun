import { actionSatisfies } from '@hzy/authz-core'

export const ACTION_ORDER = ['view', 'edit', 'admin'] as const

export type HierarchicalAction = typeof ACTION_ORDER[number]

/**
 * SQL RBAC 查询需要“可能满足请求动作的已持有动作集合”。
 *
 * 动作蕴含本身由 @hzy/authz-core/actionSatisfies 判断，这里只负责把已知动作集合
 * 过滤成 SQL IN 候选；未知 requiredAction 会加入候选列表以保留精确匹配能力。
 *
 * 不要重新实现 view/edit/admin 层级或敏感动作规则；新增 action implication 时应先进入
 * core policy，再由调用方传入对应候选动作。
 */
export function candidateActionsForRequiredAction(requiredAction: string, knownActions: readonly string[] = ACTION_ORDER): string[] {
  const required = String(requiredAction || '').trim()
  if (!required) return []

  const candidates = [...new Set([...knownActions, required].map(action => String(action || '').trim()).filter(Boolean))]
  return candidates.filter(action => actionSatisfies(action, required))
}
