/**
 * AI 对话代理接口
 * POST /api/ai/chat
 *
 * 前端通过此接口调用 AI，不直接暴露 Account API Key
 * 支持流式（SSE）和非流式两种模式
 */
import { aiChat, aiChatStream } from '~~/server/utils/accountAi'
import { requireRequestUid } from '~~/server/utils/authIdentity'

interface ChatRequestBody {
  messages: Array<{ role: string, content: string }>
  model?: string
  stream?: boolean
  maxTokens?: number
  temperature?: number
  action?: string
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')

  const body = await readBody<ChatRequestBody>(event)

  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw createError({ statusCode: 400, message: 'messages 不能为空' })
  }

  const action = body.action || 'chat'

  // 流式响应
  if (body.stream) {
    try {
      const response = await aiChatStream({
        messages: body.messages,
        model: body.model,
        stream: true,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        action,
        uid
      })

      setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })

      return response.body
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw createError({
        statusCode: 502,
        message: `AI 请求失败: ${message}`
      })
    }
  }

  // 非流式响应
  try {
    const result = await aiChat({
      messages: body.messages,
      model: body.model,
      stream: false,
      maxTokens: body.maxTokens,
      temperature: body.temperature,
      action,
      uid
    })

    return result
  } catch (err: unknown) {
    console.error('[AI Chat] 非流式请求失败:', err)
    const message = err instanceof Error ? err.message : String(err)
    throw createError({
      statusCode: 502,
      message: `AI 请求失败: ${message}`
    })
  }
})
