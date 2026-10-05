/**
 * AI 健康检查接口
 * GET /api/v1/ai/health
 *
 * 无需认证，检查 AI 网关状态及提供商连通性
 */

import { getActiveProviders, checkProviderHealth, isAiEnabled } from '~~/server/utils/ai'

defineRouteMeta({
  openAPI: {
    tags: ['AI 服务'],
    summary: 'AI 服务健康检查',
    description: '检查 AI 网关服务状态及各提供商连通性。无需认证。'
  }
})

export default defineEventHandler(async () => {
  const enabled = isAiEnabled()
  const providers = enabled ? await getActiveProviders() : []

  const defaultProvider = providers.find(p => p.is_default === 1)

  // 并行检查所有提供商的连通性
  const healthChecks = await Promise.all(
    providers.map(async (p) => {
      const health = await checkProviderHealth(p)
      return {
        providerCode: p.provider_code,
        providerName: p.provider_name,
        status: health.status,
        latencyMs: health.latencyMs
      }
    })
  )

  const allOk = healthChecks.length > 0 && healthChecks.every(h => h.status === 'ok')

  return {
    code: 0,
    data: {
      status: !enabled ? 'disabled' : allOk ? 'ok' : 'degraded',
      enabled,
      defaultProvider: defaultProvider?.provider_code || null,
      providers: healthChecks,
      timestamp: new Date().toISOString()
    }
  }
})
