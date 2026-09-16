import { computed, ref, toValue, watch, type MaybeRef } from 'vue'

interface RequirementTargetSelectionShape {
  id: number
  milestoneId: number | null
}

/**
 * The requirement-work-item target that powers the requirements page selector.
 * Page-only display fields deliberately remain open so this composable owns only
 * selection and request lifecycle, not the selector UI.
 */
export interface RequirementTarget extends RequirementTargetSelectionShape {
  id: number
}

export interface UseRequirementTargetsOptions<T extends RequirementTarget> {
  projectId: MaybeRef<number>
  activeMilestoneId: MaybeRef<number | null>
  initialTargetId?: MaybeRef<number | null>
  /** Return null for a non-success API envelope to retain the current state. */
  fetchTargets: (projectId: number) => Promise<readonly T[] | null>
  resolveTargetId: (
    currentTargetId: number | null,
    targets: readonly T[],
    activeMilestoneId: number | null
  ) => number | null
  setWorkItemId: (targetId: number | null) => void
}

/**
 * Keeps requirement target fetching, stale-response suppression, target
 * convergence and the requirements-list work-item filter in one small unit.
 * Navigation, tabs and every requirements-page command remain page concerns.
 */
export function useRequirementTargets<T extends RequirementTarget>(options: UseRequirementTargetsOptions<T>) {
  const targets = ref<T[]>([])
  const activeTargetId = ref<number | null>(
    options.initialTargetId === undefined ? null : toValue(options.initialTargetId)
  )
  const activeTarget = computed(() =>
    targets.value.find(target => target.id === activeTargetId.value) || null
  )
  let requestId = 0

  function syncWorkItemFilter() {
    options.setWorkItemId(activeTargetId.value)
  }

  // Use synchronous propagation so the page's selection watcher fetches with
  // the matching filter value when a user changes targets.
  watch(activeTargetId, syncWorkItemFilter, { flush: 'sync' })

  async function refresh() {
    const currentRequestId = ++requestId
    try {
      const nextTargets = await options.fetchTargets(toValue(options.projectId))
      if (currentRequestId !== requestId || nextTargets == null) return

      targets.value = [...nextTargets]
      activeTargetId.value = options.resolveTargetId(
        activeTargetId.value,
        nextTargets,
        toValue(options.activeMilestoneId)
      )
      // Initial deep links can retain the same id, which does not trigger the
      // watcher above but still must be reflected in the list filter.
      syncWorkItemFilter()
    } catch (error) {
      if (currentRequestId === requestId) {
        console.error('[useRequirementTargets] failed:', error)
      }
    }
  }

  return {
    targets,
    activeTargetId,
    activeTarget,
    refresh
  }
}
