import {
  buildLeadAssignmentNotification,
  buildOpportunityAssignmentNotification,
  buildOpportunityStaleNotifications,
  currentUtcScanPeriod,
  deliverNotificationsBestEffort,
  type LeadAssignedNotice,
  type OpportunityAssignedNotice,
  type OpportunityStaleNotice
} from './runtimeNotificationBuilders'

function buildAltocUrl(path: string): string {
  const config = useRuntimeConfig()
  const publicConfig = (config.public || {}) as {
    deploymentPublicUrl?: string
    appBasePath?: string
  }
  const appBasePath = String(publicConfig.appBasePath || '/altoc/').replace(/\/?$/, '/')
  const baseUrl = String(publicConfig.deploymentPublicUrl || `http://localhost:3003${appBasePath}`).replace(/\/$/, '')
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

function formatNotifyError(error: unknown): unknown {
  return error instanceof Error ? error.message : error
}

async function deliverBestEffort(notifications: Parameters<typeof deliverNotificationsBestEffort>[0]) {
  return await deliverNotificationsBestEffort(notifications, {
    send: params => sendNotification(params),
    onError: (error) => {
      console.error('[RuntimeNotifications] delivery failed:', formatNotifyError(error))
    }
  })
}

export async function notifyLeadAssignedItem(
  lead: LeadAssignedNotice | null | undefined,
  assignerUid: string,
  explicitEventVersion?: string | number | null
): Promise<number> {
  try {
    const notification = buildLeadAssignmentNotification(
      lead,
      assignerUid,
      buildAltocUrl(`/leads/${lead?.id || ''}`),
      explicitEventVersion
    )
    return notification ? await deliverBestEffort([notification]) : 0
  } catch (error: unknown) {
    console.error('[RuntimeNotifications] notifyLeadAssignedItem failed:', formatNotifyError(error))
    return 0
  }
}

export async function notifyOpportunityAssignedItem(
  opportunity: OpportunityAssignedNotice | null | undefined,
  assignerUid: string,
  explicitEventVersion?: string | number | null
): Promise<number> {
  try {
    const notification = buildOpportunityAssignmentNotification(
      opportunity,
      assignerUid,
      buildAltocUrl(`/opportunities/${opportunity?.id || ''}`),
      explicitEventVersion
    )
    return notification ? await deliverBestEffort([notification]) : 0
  } catch (error: unknown) {
    console.error('[RuntimeNotifications] notifyOpportunityAssignedItem failed:', formatNotifyError(error))
    return 0
  }
}

export async function notifyOpportunityStaleItems(
  rows: OpportunityStaleNotice[],
  scanPeriod = currentUtcScanPeriod()
): Promise<number> {
  try {
    return await deliverBestEffort(buildOpportunityStaleNotifications(
      rows,
      scanPeriod,
      buildAltocUrl('/opportunities?view=stale')
    ))
  } catch (error: unknown) {
    console.error('[RuntimeNotifications] notifyOpportunityStaleItems failed:', formatNotifyError(error))
    return 0
  }
}
