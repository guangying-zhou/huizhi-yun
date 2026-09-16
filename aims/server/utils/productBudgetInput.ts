import { productPlanningBudgetInput, productPlanningCycleTransitionInput } from './productPlanningCycleInput.ts'
import { productDecisionExceptionsInput } from './productSelectionInput.ts'

export function productBudgetInput(raw: unknown, cycleId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(k => !['expectedRevision', 'expectedCycleRevision', 'expectedQueueRevision', 'budget', 'reason', 'impactNote', 'exceptions'].includes(k))) return null
  const transition = productPlanningCycleTransitionInput({ expectedRevision: v.expectedRevision, expectedCycleRevision: v.expectedCycleRevision, reason: v.reason }, cycleId)
  const budget = productPlanningBudgetInput(v.budget)
  const exceptions = productDecisionExceptionsInput(v.exceptions)
  if (!transition || !budget || !exceptions || !Number.isSafeInteger(v.expectedQueueRevision) || Number(v.expectedQueueRevision) < 1) return null
  if (typeof v.impactNote !== 'string' || !v.impactNote.trim() || !v.impactNote.isWellFormed() || v.impactNote.includes('\0') || [...v.impactNote].length > 2000) return null
  return { ...transition, expected_queue_revision: Number(v.expectedQueueRevision), budget, impact_note: v.impactNote, exceptions }
}
