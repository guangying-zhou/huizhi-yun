import type { H3Event } from 'h3'
import type { PeopleOffboardingCandidate } from './offboardingNotificationPolicy'

interface EligibilityDecision {
  active: boolean
  allowed: boolean
  reason: string
}

interface NotificationDelivery {
  inApp: { value?: unknown }
}

export interface PeopleOffboardingNotificationDeliveryDependencies {
  resolveActiveDirectRecipient: (candidate: PeopleOffboardingCandidate) => Promise<string | null>
  closePreviousRecipient: (input: {
    actionableKey: string
    expectedVersion: string
    nextVersion: string
    state: 'cancelled'
    recipientUid: string
  }) => Promise<void>
  checkEligibility: (input: {
    event: H3Event
    subjectUid: string
    purpose: PeopleOffboardingCandidate['stream']
  }) => Promise<EligibilityDecision>
  send: (recipientUid: string) => Promise<NotificationDelivery>
  acknowledge: (notificationId: string, recipientUid: string) => Promise<void>
}

export class PeopleOffboardingNotificationDeliveryError extends Error {
  code: 'people_offboarding_notification_recipient_ineligible' | 'people_offboarding_notification_eligibility_unavailable'
  retryable = true

  constructor(
    code: PeopleOffboardingNotificationDeliveryError['code'],
    options: { cause?: unknown } = {}
  ) {
    super(code, options)
    this.name = 'PeopleOffboardingNotificationDeliveryError'
    this.code = code
  }
}

function text(value: unknown) {
  return String(value || '').trim()
}

function notificationIdFromValue(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  return text((value as Record<string, unknown>).notificationId)
}

function durableInAppNotificationId(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  const result = (error as { result?: { inApp?: { status?: string, value?: unknown } } }).result
  return result?.inApp?.status === 'fulfilled' ? notificationIdFromValue(result.inApp.value) : ''
}

export async function deliverPeopleOffboardingNotificationCandidate(input: {
  event: H3Event
  candidate: PeopleOffboardingCandidate
  dependencies: PeopleOffboardingNotificationDeliveryDependencies
}) {
  const { candidate, dependencies } = input
  const recipientUid = await dependencies.resolveActiveDirectRecipient(candidate)
  if (!recipientUid) throw new Error(`No active direct task recipient for ${candidate.actionableKey}`)

  if (
    candidate.previousEventVersion
    && candidate.previousRecipientUid
    && candidate.previousRecipientUid !== recipientUid
  ) {
    await dependencies.closePreviousRecipient({
      actionableKey: candidate.actionableKey,
      expectedVersion: candidate.previousEventVersion,
      nextVersion: `owner-moved:${candidate.eventVersion}`,
      state: 'cancelled',
      recipientUid: candidate.previousRecipientUid
    })
  }

  let eligibility: EligibilityDecision
  try {
    eligibility = await dependencies.checkEligibility({
      event: input.event,
      subjectUid: recipientUid,
      purpose: candidate.stream
    })
  } catch (cause) {
    throw new PeopleOffboardingNotificationDeliveryError(
      'people_offboarding_notification_eligibility_unavailable',
      { cause }
    )
  }
  if (!eligibility.active || !eligibility.allowed) {
    throw new PeopleOffboardingNotificationDeliveryError(
      'people_offboarding_notification_recipient_ineligible'
    )
  }

  try {
    const delivery = await dependencies.send(recipientUid)
    const notificationId = notificationIdFromValue(delivery.inApp.value)
    if (!notificationId) throw new Error(`Console did not return notification evidence for ${candidate.actionableKey}`)
    await dependencies.acknowledge(notificationId, recipientUid)
  } catch (error) {
    const notificationId = durableInAppNotificationId(error)
    if (notificationId) await dependencies.acknowledge(notificationId, recipientUid)
    throw error
  }
}
