/**
 * AI 网关工具函数
 * 统一管理 AI 提供商调用、配额检查、用量记录
 */
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { useRuntimeConfig } from '#imports'
import { queryRows, execute } from '~~/server/utils/db'

// ============================================================
// 类型定义
// ============================================================

export interface AiProvider extends RowDataPacket {
  id: number
  provider_code: string
  provider_name: string
  api_base_url: string
  api_key: string
  api_format: string
  default_model: string
  available_models: string | null
  max_tokens: number
  temperature: number
  is_default: number
  status: number
}

export interface AiQuota extends RowDataPacket {
  id: number
  app_code: string
  daily_limit: number
  monthly_limit: number
  max_tokens_per_request: number
  allowed_models: string | null
  status: number
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatRequest {
  messages: AiChatMessage[]
  model?: string
  stream?: boolean
  max_tokens?: number
  temperature?: number
  action?: string
  uid?: string
}

export interface AiCompletionsRequest {
  prompt: string
  model?: string
  stream?: boolean
  max_tokens?: number
  temperature?: number
  action?: string
  uid?: string
}

interface UsageCount extends RowDataPacket {
  count: number
}

// ============================================================
// 提供商管理
// ============================================================

/**
 * 获取默认 AI 提供商配置
 * 优先从数据库读取，若数据库未配置则使用 runtimeConfig 中的默认值
 */
export async function getDefaultProvider(): Promise<AiProvider | null> {
  const rows = await queryRows<AiProvider[]>(
    'SELECT * FROM ai_providers WHERE is_default = 1 AND status = 1 LIMIT 1'
  )
  return rows[0] || null
}

/**
 * 获取所有启用的提供商
 */
export async function getActiveProviders(): Promise<AiProvider[]> {
  return queryRows<AiProvider[]>(
    'SELECT * FROM ai_providers WHERE status = 1 ORDER BY is_default DESC, id ASC'
  )
}

/**
 * 获取提供商的有效 API Key
 * 优先使用数据库中的配置，若为"待配置"则回退到环境变量
 */
function resolveApiKey(provider: AiProvider): string {
  if (provider.api_key && provider.api_key !== '待配置') {
    return provider.api_key
  }
  const config = useRuntimeConfig()
  return config.ai?.defaultApiKey || ''
}

/**
 * 获取提供商的 API 基础地址
 */
function resolveBaseUrl(provider: AiProvider): string {
  return provider.api_base_url || useRuntimeConfig().ai?.defaultBaseUrl || ''
}

// ============================================================
// 配额检查
// ============================================================

/**
 * 检查应用的 AI 调用配额
 */
export async function checkQuota(appCode: string): Promise<{ allowed: boolean, reason?: string, quota?: AiQuota }> {
  const quotas = await queryRows<AiQuota[]>(
    'SELECT * FROM ai_quotas WHERE app_code = ? AND status = 1 LIMIT 1',
    [appCode]
  )
  const quota = quotas[0]
  if (!quota) {
    return { allowed: false, reason: '未配置 AI 调用配额' }
  }

  // 检查日限额
  const dailyUsage = await queryRows<UsageCount[]>(
    `SELECT COUNT(*) as count FROM ai_usage_logs
     WHERE app_code = ? AND DATE(created_at) = UTC_DATE()`,
    [appCode]
  )
  if (dailyUsage[0] && dailyUsage[0].count >= quota.daily_limit) {
    return { allowed: false, reason: `已达到每日调用上限 (${quota.daily_limit})`, quota }
  }

  // 检查月限额
  const monthlyUsage = await queryRows<UsageCount[]>(
    `SELECT COUNT(*) as count FROM ai_usage_logs
     WHERE app_code = ? AND YEAR(created_at) = YEAR(UTC_DATE()) AND MONTH(created_at) = MONTH(UTC_DATE())`,
    [appCode]
  )
  if (monthlyUsage[0] && monthlyUsage[0].count >= quota.monthly_limit) {
    return { allowed: false, reason: `已达到每月调用上限 (${quota.monthly_limit})`, quota }
  }

  return { allowed: true, quota }
}

// ============================================================
// AI 调用（OpenAI 兼容格式）
// ============================================================

/**
 * 非流式调用 AI Chat Completions
 */
export async function callChatCompletions(
  provider: AiProvider,
  messages: AiChatMessage[],
  options: { model?: string, max_tokens?: number, temperature?: number }
) {
  const apiKey = resolveApiKey(provider)
  const baseUrl = resolveBaseUrl(provider)
  const config = useRuntimeConfig()
  const timeoutMs = config.ai?.requestTimeoutMs || 60000

  if (!apiKey) {
    throw new Error('AI API Key 未配置')
  }

  const model = options.model || provider.default_model
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_tokens || provider.max_tokens,
        temperature: Number(options.temperature ?? provider.temperature),
        stream: false
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`AI 提供商返回错误 (${response.status}): ${errorBody}`)
    }

    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 流式调用 AI Chat Completions，返回 ReadableStream
 */
export async function callChatCompletionsStream(
  provider: AiProvider,
  messages: AiChatMessage[],
  options: {
    model?: string
    max_tokens?: number
    temperature?: number
    onUsage?: (usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number }) => void
  }
): Promise<Response> {
  const apiKey = resolveApiKey(provider)
  const baseUrl = resolveBaseUrl(provider)
  const config = useRuntimeConfig()
  const timeoutMs = config.ai?.requestTimeoutMs || 60000

  if (!apiKey) {
    throw new Error('AI API Key 未配置')
  }

  const model = options.model || provider.default_model
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options.max_tokens || provider.max_tokens,
      temperature: options.temperature ?? provider.temperature,
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal: controller.signal
  })

  if (!response.ok) {
    clearTimeout(timer)
    const errorBody = await response.text()
    throw new Error(`AI 提供商返回错误 (${response.status}): ${errorBody}`)
  }

  // 透传流的同时解析 SSE 数据，提取最终的 usage 信息
  const originalBody = response.body!
  let sseBuffer = ''

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      // 原样透传给客户端
      controller.enqueue(chunk)

      // 同时解析 SSE 提取 usage
      if (options.onUsage) {
        try {
          const text = new TextDecoder().decode(chunk)
          sseBuffer += text
          // 按行解析 SSE
          const lines = sseBuffer.split('\n')
          // 保留最后一个可能不完整的行
          sseBuffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6))
                if (json.usage) {
                  options.onUsage(json.usage)
                }
              } catch {
                // 忽略解析失败的行
              }
            }
          }
        } catch {
          // 忽略解码错误
        }
      }
    },
    flush() {
      clearTimeout(timer)
      // 处理缓冲区中剩余数据
      if (options.onUsage && sseBuffer) {
        const lines = sseBuffer.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const json = JSON.parse(line.slice(6))
              if (json.usage) {
                options.onUsage(json.usage)
              }
            } catch {
              // 忽略
            }
          }
        }
      }
    }
  })
  const pipedStream = originalBody.pipeThrough(transformStream)

  return new Response(pipedStream, {
    headers: response.headers
  })
}

// ============================================================
// 用量记录
// ============================================================

/**
 * 记录 AI 调用日志
 */
export async function logAiUsage(params: {
  appCode: string
  uid?: string
  providerCode: string
  model: string
  action: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  stream?: boolean
  latencyMs?: number
  status?: string
  errorMessage?: string
}): Promise<void> {
  await execute<ResultSetHeader>(
    `INSERT INTO ai_usage_logs
     (app_code, uid, provider_code, model, action, prompt_tokens, completion_tokens, total_tokens, stream, latency_ms, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.appCode,
      params.uid || null,
      params.providerCode,
      params.model,
      params.action || 'chat',
      params.promptTokens || 0,
      params.completionTokens || 0,
      params.totalTokens || 0,
      params.stream ? 1 : 0,
      params.latencyMs || null,
      params.status || 'success',
      params.errorMessage || null
    ]
  )
}

// ============================================================
// 健康检查
// ============================================================

/**
 * 检查提供商连通性（发送一个极小的请求）
 */
export async function checkProviderHealth(provider: AiProvider): Promise<{ status: string, latencyMs: number }> {
  const apiKey = resolveApiKey(provider)
  const baseUrl = resolveBaseUrl(provider)

  if (!apiKey || apiKey === '待配置') {
    return { status: 'not_configured', latencyMs: 0 }
  }

  const start = Date.now()
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000)
    })
    const latencyMs = Date.now() - start
    return { status: response.ok ? 'ok' : 'error', latencyMs }
  } catch {
    return { status: 'unreachable', latencyMs: Date.now() - start }
  }
}

/**
 * 检查 AI 服务是否已启用
 */
export function isAiEnabled(): boolean {
  const config = useRuntimeConfig()
  return config.ai?.enabled !== false
}

/**
 * 从 API Key 记录中获取应用编码
 */
export async function getAppCodeByKeyId(keyId: number): Promise<string> {
  const rows = await queryRows<(RowDataPacket & { key_name: string })[]>(
    'SELECT key_name FROM api_keys WHERE id = ?',
    [keyId]
  )
  return rows[0]?.key_name || 'unknown'
}
