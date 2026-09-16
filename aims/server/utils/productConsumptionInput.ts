import { productPlanningCandidateAddInput } from './productPlanningCycleInput.ts'

const asHundredths = (value: unknown) => {
  if (typeof value !== 'string') return null
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return null
  const [whole = '', fraction = ''] = value.split('.')
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(units) || units < 0 || units > 100000000) return null
  return `${Math.floor(units / 100)}.${String(units % 100).padStart(2, '0')}`
}

const text = (value: unknown) => typeof value === 'string' && !!value.trim() && value.isWellFormed() && [...value].length <= 2000 && !value.includes('\0')

export function productConsumptionInput(raw: unknown, cycleId: string, itemId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision', 'expectedQueueRevision', 'expectedScopeRevision', 'spentPersonDays', 'reason'].includes(key))) return null
  const identity = productPlanningCandidateAddInput({ itemId, expectedRevision: value.expectedRevision, expectedCycleRevision: value.expectedCycleRevision, expectedItemRevision: value.expectedItemRevision }, cycleId)
  if (!identity || !Number.isSafeInteger(value.expectedQueueRevision) || Number(value.expectedQueueRevision) < 1 || !Number.isSafeInteger(value.expectedScopeRevision) || Number(value.expectedScopeRevision) < 1) return null
  if (!text(value.reason)) return null
  const amount = asHundredths(value.spentPersonDays)
  if (amount === null) return null
  return { ...identity, expected_queue_revision: Number(value.expectedQueueRevision), expected_scope_revision: Number(value.expectedScopeRevision), spent_person_days: amount, reason: value.reason as string }
}
