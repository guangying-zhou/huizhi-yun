import type { H3Event } from 'h3'

// The detail fact has already bound the viewer to this notification recipient.
// Use the live signed revision gate rather than attempting a policy-store sync
// from a user read request. Drift or an unavailable probe still fails closed.
export async function feedbackNotificationDetailAuthorization(event: H3Event, tenant: string, uid: string, id: string, dependencies: {
  revisionGate: <T>(event: H3Event, tenant: string, evaluate: () => Promise<T>) => Promise<T>
  eligible: (event: H3Event, uid: string) => Promise<boolean>
}) {
  return {
    authorized: await dependencies.revisionGate(event, tenant, () => dependencies.eligible(event, uid)),
    resource: 'feedback', id
  }
}
