interface RuntimeBinding {
  tenantId: string
  deploymentId: string
}

interface RefreshResult {
  ok: boolean
  bundle: { tenantCode: string, deploymentCode: string } | null
}

export async function evaluateWithManagedFreshNotificationDetailPolicy<T>(
  managed: boolean,
  binding: RuntimeBinding,
  evaluate: () => Promise<T>,
  refresh: () => Promise<RefreshResult>
) {
  if (managed) {
    let result: RefreshResult
    try {
      result = await refresh()
    } catch {
      throw new Error('notification_detail_policy_refresh_unavailable')
    }
    if (
      !result.ok
      || !result.bundle
      || result.bundle.tenantCode !== binding.tenantId
    ) {
      throw new Error('notification_detail_policy_refresh_unavailable')
    }
  }
  return await evaluate()
}
