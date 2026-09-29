import { sendNotification, type NotifyParams } from '@hzy/foundation/server/utils/notify'

type EnterpriseCodocsNotification = Omit<NotifyParams, 'sourceAppCode' | 'metadata'> & {
  metadata: Record<string, unknown>
}

/** The Host's service actor is enterprise; keep Codocs attribution in metadata. */
export function sendEnterpriseCodocsNotification(input: EnterpriseCodocsNotification) {
  return sendNotification({
    ...input,
    sourceAppCode: 'enterprise',
    metadata: { ...input.metadata, notificationKind: 'business_event', moduleAppCode: 'codocs' }
  })
}
