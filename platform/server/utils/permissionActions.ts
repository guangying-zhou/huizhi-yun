export const ACTION_ORDER = ['view', 'edit', 'admin'] as const

export type HierarchicalAction = typeof ACTION_ORDER[number]

/**
 * 动作蕴含语义的单一事实源（platform 侧）。
 *
 * 给定“请求所要求的动作”，返回“持有以下任一动作即可满足该请求”的集合。
 * 方向固定为 requiredAction -> 可接受的已持有动作集合，不能反过来：
 * 把它当成“反向蕴含”会造成提权（例如只持有 view 也能通过 admin 检查）。
 *
 * 必须与 console policyAuthorization.ts 的 hasPermissionInSnapshot 行为保持一致：
 *   - 请求 view  -> 持有 view / edit / admin 任一即可
 *   - 请求 edit  -> 持有 edit / admin
 *   - 请求 admin -> 必须持有 admin
 *   - approve / confirm / export / close / deploy 等敏感动作 -> 必须精确持有，互不蕴含
 *
 * admin 刻意不蕴含 approve 等敏感动作，与 console 保持一致。
 */
export function expandActions(requiredAction: string): string[] {
  if (requiredAction === 'view') {
    return ['view', 'edit', 'admin']
  }
  if (requiredAction === 'edit') {
    return ['edit', 'admin']
  }
  return [requiredAction]
}
