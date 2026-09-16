import type { NotificationDetailEligibilityTarget } from './subjectEligibilityContract'

export interface IntegrationOperationDetailEligibilityDecision {
  active: boolean
  allowed: boolean
}

export class IntegrationOperationDetailEligibilityError extends Error {
  readonly code: 'restricted' | 'unavailable'

  constructor(code: 'restricted' | 'unavailable') {
    super(code)
    this.name = 'IntegrationOperationDetailEligibilityError'
    this.code = code
  }
}

export async function authorizeNotificationDetailAfterFreshEligibility<T>(input: {
  sourceAppCode: string
  resource: string
  eligibilityTarget: NotificationDetailEligibilityTarget | null
  evaluate: (target: NotificationDetailEligibilityTarget) => Promise<IntegrationOperationDetailEligibilityDecision>
  authorizeSource: () => Promise<T>
}) {
  const target = input.eligibilityTarget
  if (!target) throw new IntegrationOperationDetailEligibilityError('unavailable')
  let eligibility: IntegrationOperationDetailEligibilityDecision
  try {
    eligibility = await input.evaluate(target)
  } catch {
    throw new IntegrationOperationDetailEligibilityError('unavailable')
  }
  if (eligibility.active !== true || eligibility.allowed !== true) {
    throw new IntegrationOperationDetailEligibilityError('restricted')
  }
  return await input.authorizeSource()
}

/** @deprecated Use authorizeNotificationDetailAfterFreshEligibility for every source descriptor. */
export async function authorizeIntegrationOperationDetailAfterFreshEligibility<T>(input: {
  sourceAppCode: string
  resource: string
  evaluate: () => Promise<IntegrationOperationDetailEligibilityDecision>
  authorizeSource: () => Promise<T>
}) {
  return await authorizeNotificationDetailAfterFreshEligibility({
    ...input,
    eligibilityTarget: ['aims', 'altoc', 'assets', 'finance', 'people'].includes(input.sourceAppCode)
      ? { targetAppCode: input.sourceAppCode, resourceCode: 'integration_operations', action: 'view' }
      : null,
    evaluate: async () => await input.evaluate()
  })
}
