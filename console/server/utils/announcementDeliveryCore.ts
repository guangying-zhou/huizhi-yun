export interface AnnouncementDelivery { id: string, revision: number, uid: string, channel: 'in_app' | 'wecom', lease: string, key: string }
export interface AnnouncementDeliveryDependencies {
  claim: () => Promise<AnnouncementDelivery | null>
  ack: (job: AnnouncementDelivery, success: boolean) => Promise<unknown>
  bell: (job: AnnouncementDelivery) => Promise<unknown>
  wecom: (job: AnnouncementDelivery) => Promise<unknown>
  now?: () => number
}
export async function runAnnouncementDelivery(deps: AnnouncementDeliveryDependencies) {
  const now = deps.now || Date.now
  const deadline = now() + 20000
  let delivered = 0
  for (let i = 0; i < 20 && now() < deadline - 15000; i++) {
    const job = await deps.claim()
    if (!job) break
    let success = false
    try {
      if (job.channel === 'in_app') await deps.bell(job)
      else await deps.wecom(job)
      success = true
      delivered++
    } catch { /* Keep durable failure evidence; no user content is logged. */ }
    await deps.ack(job, success)
  }
  return { delivered }
}
