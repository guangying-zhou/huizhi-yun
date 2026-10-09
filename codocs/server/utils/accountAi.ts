import { aiProviderFetch, getAiProviderIntegrationConfig } from '@hzy/foundation/server/utils/aiProviderIntegration'

interface AiChatParams {
  messages: Array<{ role: string, content: string }>
  model?: string
  stream?: boolean
  maxTokens?: number
  temperature?: number
  action: string
  uid: string
}

interface AiChatResponse {
  code: number
  data: {
    id: string
    model: string
    choices: Array<{
      index: number
      message: { role: string, content: string }
      finish_reason: string
    }>
    usage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }
}

/**
 * 非流式 AI 对话
 */
export async function aiChat(params: AiChatParams): Promise<AiChatResponse> {
  const config = await getAiProviderIntegrationConfig()
  const completion = await aiProviderFetch<AiChatResponse['data']>({
    path: '/v1/chat/completions',
    method: 'POST',
    body: {
      messages: params.messages,
      model: params.model || config.defaultModel,
      stream: false,
      max_tokens: params.maxTokens,
      temperature: params.temperature
    },
    timeout: 60000
  })

  return { code: 0, data: completion }
}

/**
 * 流式 AI 对话，返回原始 Response（SSE 流）
 */
export async function aiChatStream(params: AiChatParams): Promise<Response> {
  const config = await getAiProviderIntegrationConfig()

  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      messages: params.messages,
      model: params.model || config.defaultModel,
      stream: true,
      max_tokens: params.maxTokens,
      temperature: params.temperature
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`AI 请求失败 (${response.status}): ${errorText}`)
  }

  return response
}
