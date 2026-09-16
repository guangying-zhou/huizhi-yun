import { productPlanningCandidateAddInput } from './productPlanningCycleInput.ts'
import { productDecisionExceptionsInput } from './productSelectionInput.ts'

export function productWithdrawalInput(raw: unknown, cycleId: string, itemId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(k => !['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision', 'expectedQueueRevision', 'reason', 'impactNote', 'exceptions', 'consumptionConfirmationId'].includes(k))) return null
  const confirmation = v.consumptionConfirmationId
  if (confirmation !== undefined && (typeof confirmation !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(confirmation))) return null
  const identity = productPlanningCandidateAddInput({ itemId, expectedRevision: v.expectedRevision, expectedCycleRevision: v.expectedCycleRevision, expectedItemRevision: v.expectedItemRevision }, cycleId)
  const exceptions = productDecisionExceptionsInput(v.exceptions)
  if (!identity || !exceptions || !Number.isSafeInteger(v.expectedQueueRevision) || Number(v.expectedQueueRevision) < 1) return null
  for (const value of [v.reason, v.impactNote]) if (typeof value !== 'string' || !value.trim() || !value.isWellFormed() || value.includes('\0') || [...value].length > 2000) return null
  return { ...identity, ...(confirmation === undefined ? {} : { consumption_confirmation_id: confirmation as string }), expected_queue_revision: Number(v.expectedQueueRevision), reason: v.reason as string, impact_note: v.impactNote as string, exceptions }
}
