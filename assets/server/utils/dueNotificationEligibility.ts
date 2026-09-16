export class AssetsDueEligibilityError extends Error {
  code: string
  retryable = true

  constructor(code: string) {
    super(code)
    this.name = 'AssetsDueEligibilityError'
    this.code = code
  }
}

export async function runAssetsDueEligibilityGate<T>(input: {
  purpose: string
  closePreviousRecipient?: () => Promise<void>
  checkEligibility: (purpose: string) => Promise<{ active: boolean, allowed: boolean }>
  deliver: () => Promise<T>
}) {
  if (input.closePreviousRecipient) await input.closePreviousRecipient()
  let eligibility: { active: boolean, allowed: boolean }
  try {
    eligibility = await input.checkEligibility(input.purpose)
  } catch {
    throw new AssetsDueEligibilityError('assets_due_eligibility_unavailable')
  }
  if (!eligibility.active || !eligibility.allowed) {
    throw new AssetsDueEligibilityError('assets_due_recipient_ineligible')
  }
  return await input.deliver()
}
