/**
 * AI 文本补全接口
 * POST /api/v1/ai/completions
 *
 * 将 prompt 转为 chat 格式调用（通义千问不支持原生 completions 端点）
 */
import { verifyApiKey } from '~~/server/utils/api-auth'

import {
  getDefaultProvider,
  checkQuota,
  callChatCompletions,
  callChatCompletionsStream,
  logAiUsage,
  isAiEnabled,
  getAppCodeByKeyId
} from '~~/server/utils/ai'
import type { AiCompletionsRequest } from '~~/server/utils/ai'

defineRouteMeta({
  openAPI: {
    tags: ['AI 服务'],
    summary: 'AI 文本补全（Completions）',
    description: '单次文本补全，适用于自动补全、续写等场景。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', description: '待补全的文本' },
              model: { type: 'string' },
              stream: { type: 'boolean', default: false },
              max_tokens: { type: 'integer', default: 512 },
              temperature: { type: 'number', default: 0.3 },
              action: { type: 'string' },
              uid: { type: 'string' }
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const keyRecord = await verifyApiKey(event)

  if (!isAiEnabled()) {
    throw createError({ statusCode: 403, message: 'AI 服务未启用' })
  }

  const body = await readBody<AiCompletionsRequest>(event)

  if (!body?.prompt || typeof body.prompt !== 'string') {
    throw createError({ statusCode: 400, message: 'prompt 不能为空' })
  }

  const appCode = await getAppCodeByKeyId(keyRecord.id)

  const quotaResult = await checkQuota(appCode)
  if (!quotaResult.allowed) {
    throw createError({ statusCode: 429, message: quotaResult.reason })
  }

  const provider = await getDefaultProvider()
  if (!provider) {
    throw createError({ statusCode: 503, message: 'AI 提供商未配置' })
  }

  const model = body.model || provider.default_model
  const action = body.action || 'completions'
  const maxTokens = body.max_tokens || 512
  const startTime = Date.now()

  // 配额模型检查
  if (quotaResult.quota?.allowed_models) {
    const allowedModels: string[] = typeof quotaResult.quota.allowed_models === 'string'
      ? JSON.parse(quotaResult.quota.allowed_models)
      : quotaResult.quota.allowed_models
    if (allowedModels.length > 0 && !allowedModels.includes(model)) {
      throw createError({ statusCode: 403, message: `不允许使用模型 ${model}` })
    }
  }

  if (quotaResult.quota && maxTokens > quotaResult.quota.max_tokens_per_request) {
    throw createError({
      statusCode: 400,
      message: `max_tokens 超出单次请求上限 (${quotaResult.quota.max_tokens_per_request})`
    })
  }

  // 将 prompt 转为 chat messages 格式
  const messages = [{ role: 'user' as const, content: body.prompt }]

  // ---- 流式响应 ----
  if (body.stream) {
    try {
      const upstreamResponse = await callChatCompletionsStream(provider, messages, {
        model,
        max_tokens: maxTokens,
        temperature: body.temperature ?? 0.3
      })

      logAiUsage({
        appCode,
        uid: body.uid,
        providerCode: provider.provider_code,
        model,
        action,
        stream: true,
        latencyMs: Date.now() - startTime,
        status: 'success'
      }).catch(() => {})

      setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      return upstreamResponse.body
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logAiUsage({
        appCode,
        uid: body.uid,
        providerCode: provider.provider_code,
        model,
        action,
        stream: true,
        latencyMs: Date.now() - startTime,
        status: message.includes('abort') ? 'timeout' : 'failed',
        errorMessage: message
      }).catch(() => {})

      throw createError({
        statusCode: message.includes('abort') ? 504 : 502,
        message: `AI 请求失败: ${message}`
      })
    }
  }

  // ---- 非流式响应 ----
  try {
    const result = await callChatCompletions(provider, messages, {
      model,
      max_tokens: maxTokens,
      temperature: body.temperature ?? 0.3
    })

    const latencyMs = Date.now() - startTime
    const usage = result.usage || {}

    // 将 chat 响应转为 completions 格式
    const completionText = result.choices?.[0]?.message?.content || ''

    logAiUsage({
      appCode,
      uid: body.uid,
      providerCode: provider.provider_code,
      model,
      action,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      stream: false,
      latencyMs,
      status: 'success'
    }).catch(() => {})

    return {
      code: 0,
      data: {
        id: result.id,
        model: result.model,
        choices: [
          {
            index: 0,
            text: completionText,
            finish_reason: result.choices?.[0]?.finish_reason || 'stop'
          }
        ],
        usage: result.usage
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logAiUsage({
      appCode,
      uid: body.uid,
      providerCode: provider.provider_code,
      model,
      action,
      stream: false,
      latencyMs: Date.now() - startTime,
      status: message.includes('abort') ? 'timeout' : 'failed',
      errorMessage: message
    }).catch(() => {})

    throw createError({
      statusCode: message.includes('abort') ? 504 : 502,
      message: `AI 请求失败: ${message}`
    })
  }
})
