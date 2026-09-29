export type WorkflowCallbackRuntimeSelection = 'standard' | 'milestone-receivable'

/**
 * The callback body can identify its established subtype, but never selects a
 * Runtime scope. The server-owned feature flag remains the first gate.
 */
export function selectWorkflowCallbackRuntime(input: {
  enabled: boolean
  resourceCode: string
  actionCode: string
}): WorkflowCallbackRuntimeSelection {
  return input.enabled && input.resourceCode === 'milestones' && input.actionCode === 'milestone_completion'
    ? 'milestone-receivable'
    : 'standard'
}

export type MilestoneReceivableDispatchSelection = 'none' | 'already-succeeded' | 'dispatch'

/** A Runtime-confirmed coordinator result never re-enters the legacy dispatcher. */
export function selectMilestoneReceivableDispatch(input: {
  operationKey: string
  operationStatus: string
}): MilestoneReceivableDispatchSelection {
  if (!input.operationKey) return 'none'
  return input.operationStatus === 'succeeded' ? 'already-succeeded' : 'dispatch'
}
