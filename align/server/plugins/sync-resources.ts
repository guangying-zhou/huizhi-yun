/**
 * 服务启动时自动同步资源定义到 Account
 */
import { appCode, resources } from '~~/app/config/permissions'

interface SyncResourcesResponse {
  success: boolean
  message?: string
  data: {
    inserted: number
    updated: number
    deprecated: number
  }
}

export default defineNitroPlugin((_nitroApp) => {
  setTimeout(async () => {
    const config = useRuntimeConfig()
    const { hzy = {} } = config as { hzy?: { apiBaseUrl?: string, apiKey?: string, apiSecret?: string } }
    const { apiBaseUrl, apiKey, apiSecret } = hzy

    if (!apiBaseUrl || !apiKey || !apiSecret) {
      console.warn('[SyncResources] Account API not configured, skipping resource sync')
      return
    }

    try {
      const response = await $fetch<SyncResourcesResponse>(`${apiBaseUrl}/api/v1/resources/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}:${apiSecret}`
        },
        body: {
          appCode,
          resources: resources.map(r => ({
            code: r.code,
            name: r.name,
            description: r.description || '',
            sortOrder: r.sortOrder ?? 0
          }))
        },
        timeout: 10000
      })

      if (response.success) {
        const { inserted, updated, deprecated } = response.data
        console.log(`[SyncResources] Synced to Account: ${inserted} new, ${updated} updated, ${deprecated} deprecated`)
      } else {
        console.warn('[SyncResources] Sync failed:', response.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[SyncResources] Failed to sync resources:', message)
    }
  }, 3000)
})
