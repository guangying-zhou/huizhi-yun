import { createError } from 'h3'

function retiredNotificationTriggerPath(): never {
  throw createError({
    statusCode: 500,
    message: 'Local notification DB trigger helper is retired. Use runtime notification payload helpers.'
  })
}

export async function notifyLeadAssigned(_leadId: number, _assigneeUid: string | null | undefined, _assignerUid: string): Promise<void> {
  return retiredNotificationTriggerPath()
}

export async function notifyOpportunityAssigned(
  _opportunityId: number,
  _assigneeUid: string | null | undefined,
  _assignerUid: string
): Promise<void> {
  return retiredNotificationTriggerPath()
}

export async function notifyReceivableOverdue(_planIds: number[]): Promise<void> {
  return retiredNotificationTriggerPath()
}

export async function notifyOpportunityStale(_oppIds: number[]): Promise<void> {
  return retiredNotificationTriggerPath()
}
