/**
 * 获取可用 AI 模型列表
 * GET /api/v1/ai/models
 */
import { verifyApiKey } from '~~/server/utils/api-auth'
import { getActiveProviders, isAiEnabled } from '~~/server/utils/ai'

defineRouteMeta({
  openAPI: {
    tags: ['AI 服务'],
    summary: '获取可用 AI 模型列表',
    description: '获取当前启用的 AI 提供商及可用模型。需要 API Key 认证。'
  }
})

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  if (!isAiEnabled()) {
    throw createError({ statusCode: 403, message: 'AI 服务未启用' })
  }

  const providers = await getActiveProviders()

  if (providers.length === 0) {
    return {
      code: 0,
      data: {
        defaultProvider: null,
        defaultModel: null,
        providers: []
      }
    }
  }

  const defaultProvider = providers.find(p => p.is_default === 1) || providers[0]

  return {
    code: 0,
    data: {
      defaultProvider: defaultProvider?.provider_code || null,
      defaultModel: defaultProvider?.default_model || null,
      providers: providers.map(p => ({
        providerCode: p.provider_code,
        providerName: p.provider_name,
        isDefault: p.is_default === 1,
        defaultModel: p.default_model,
        models: p.available_models || []
      }))
    }
  }
})
