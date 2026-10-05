export interface DueEligibilityDecision {
  active: boolean
  allowed: boolean
  reason: string
}

export async function runDueEligibilityDelivery<T>(input: {
  closePreviousRecipient: () => Promise<void>
  checkEligibility: () => Promise<DueEligibilityDecision>
  deliver: () => Promise<T>
}) {
  await input.closePreviousRecipient()
  const eligibility = await input.checkEligibility()
  if (!eligibility.active || !eligibility.allowed) {
    throw new Error(`subject_eligibility_rejected:${eligibility.reason}`)
  }
  return await input.deliver()
}
