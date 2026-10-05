/**
 * AI 对话接口
 * POST /api/v1/ai/chat
 *
 * 支持流式（SSE）和非流式两种响应模式
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
import type { AiChatRequest } from '~~/server/utils/ai'

defineRouteMeta({
  openAPI: {
    tags: ['AI 服务'],
    summary: 'AI 对话（Chat Completions）',
    description: '通用多轮对话接口，支持流式（SSE）和非流式两种响应模式。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['messages'],
            properties: {
              messages: { type: 'array', description: '对话消息列表（格式同 OpenAI）', items: { type: 'object' } },
              model: { type: 'string', description: '模型ID，不填则使用默认模型' },
              stream: { type: 'boolean', default: false, description: '是否流式输出（SSE）' },
              max_tokens: { type: 'integer', default: 4096 },
              temperature: { type: 'number', default: 0.7, description: '0-2' },
              action: { type: 'string', description: '调用场景标识，用于用量统计' },
              uid: { type: 'string', description: '调用用户 UID' }
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

  const body = await readBody<AiChatRequest>(event)

  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, message: 'messages 不能为空' })
  }

  // 获取应用编码（根据 API Key 名称）
  const appCode = await getAppCodeByKeyId(keyRecord.id)

  // 配额检查
  const quotaResult = await checkQuota(appCode)
  if (!quotaResult.allowed) {
    throw createError({ statusCode: 429, message: quotaResult.reason })
  }

  // 获取提供商
  const provider = await getDefaultProvider()
  if (!provider) {
    throw createError({ statusCode: 503, message: 'AI 提供商未配置' })
  }

  const model = body.model || provider.default_model
  const action = body.action || 'chat'
  const startTime = Date.now()

  // 检查模型是否在配额允许范围内
  if (quotaResult.quota?.allowed_models) {
    const allowedModels: string[] = typeof quotaResult.quota.allowed_models === 'string'
      ? JSON.parse(quotaResult.quota.allowed_models)
      : quotaResult.quota.allowed_models
    if (allowedModels.length > 0 && !allowedModels.includes(model)) {
      throw createError({ statusCode: 403, message: `不允许使用模型 ${model}` })
    }
  }

  // 检查单次请求 token 限制
  const maxTokens = body.max_tokens || provider.max_tokens
  if (quotaResult.quota && maxTokens > quotaResult.quota.max_tokens_per_request) {
    throw createError({
      statusCode: 400,
      message: `max_tokens 超出单次请求上限 (${quotaResult.quota.max_tokens_per_request})`
    })
  }

  // ---- 流式响应 ----
  if (body.stream) {
    try {
      // 用于收集流结束时的 token 用量
      let streamUsage: { prompt_tokens: number, completion_tokens: number, total_tokens: number } | null = null

      const upstreamResponse = await callChatCompletionsStream(provider, body.messages, {
        model,
        max_tokens: maxTokens,
        temperature: body.temperature,
        onUsage: (usage) => {
          streamUsage = usage
        }
      })

      // 设置 SSE 响应头
      setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      // 监听流结束后记录用量（含 token 统计）
      const body2 = upstreamResponse.body!
      const reader = body2.getReader()
      const outputStream = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            // 流结束，记录用量
            logAiUsage({
              appCode,
              uid: body.uid,
              providerCode: provider.provider_code,
              model,
              action,
              promptTokens: streamUsage?.prompt_tokens,
              completionTokens: streamUsage?.completion_tokens,
              totalTokens: streamUsage?.total_tokens,
              stream: true,
              latencyMs: Date.now() - startTime,
              status: 'success'
            }).catch(() => {})
            return
          }
          controller.enqueue(value)
        }
      })

      return outputStream
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
    const result = await callChatCompletions(provider, body.messages, {
      model,
      max_tokens: maxTokens,
      temperature: body.temperature
    })

    const latencyMs = Date.now() - startTime
    const usage = result.usage || {}

    // 记录用量
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
      data: result
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
