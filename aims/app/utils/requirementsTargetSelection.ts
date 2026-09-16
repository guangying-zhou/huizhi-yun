/**
 * 需求页 target 的选择与列表筛选值转换。
 *
 * URL 只在进入页面时提供初始选择；页面本身不回写 query。保留该边界，
 * 以免筛选刷新时意外改变导航状态。
 */
export interface RequirementTargetSelectionItem {
  id: number
  milestoneId: number | null
}

/** Keep the page's existing `Number(route.query.workItemId)` semantics. */
export function requirementTargetIdFromRouteQuery(value: unknown): number | null {
  return value ? Number(value) : null
}

/**
 * Retain a current target while it is available. Once it is unavailable, use
 * the active milestone's first target, then the first target overall.
 */
export function resolveRequirementTargetId(
  currentTargetId: number | null,
  targets: readonly RequirementTargetSelectionItem[],
  activeMilestoneId: number | null
): number | null {
  let nextTargetId = currentTargetId

  if (nextTargetId && !targets.some(target => target.id === nextTargetId)) {
    nextTargetId = null
  }

  if (nextTargetId == null) {
    const activeMilestoneTarget = activeMilestoneId == null
      ? undefined
      : targets.find(target => target.milestoneId === activeMilestoneId)

    return activeMilestoneTarget?.id ?? targets[0]?.id ?? null
  }

  return nextTargetId
}

/**
 * `useRequirements` omits this value from its request when it is empty, which
 * is how the page represents the “全部需求” selection.
 */
export function requirementTargetFilterValue(targetId: number | null): string {
  return targetId ? String(targetId) : ''
}
