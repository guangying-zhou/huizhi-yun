/**
 * AI 辅助功能组合式函数
 * 封装对 /api/ai/chat 的调用，提供各场景快捷方法
 */

// Prompt 模板
const PROMPTS: Record<string, { system: string, temperature: number, maxTokens: number }> = {
  continueWriting: {
    system: '你是一个专业的文档写作助手。请根据上下文自然续写，保持风格一致，语言流畅。只输出续写的内容，不要重复已有文字，不要添加任何解释说明。',
    temperature: 0.7,
    maxTokens: 1024
  },
  polish: {
    system: '你是一个文档润色助手。请优化以下文本的表达，使其更通顺、更专业，保持原意不变。保留原有的 Markdown 格式，不要对特殊字符（如 #、*、`、-、> 等）添加反斜杠转义。只输出润色后的完整文本，不要添加任何解释说明。',
    temperature: 0.5,
    maxTokens: 2048
  },
  simplify: {
    system: '你是一个文档精简助手。请精简以下文本，去除冗余表达，保留核心信息，使行文更加简洁。保留原有的 Markdown 格式，不要对特殊字符添加反斜杠转义。只输出精简后的完整文本，不要添加任何解释说明。',
    temperature: 0.3,
    maxTokens: 2048
  },
  expand: {
    system: '你是一个文档扩展助手。请丰富以下文本的内容细节，增加论述和示例，使内容更加充实完整。保留原有的 Markdown 格式，不要对特殊字符添加反斜杠转义。只输出扩展后的完整文本，不要添加任何解释说明。',
    temperature: 0.7,
    maxTokens: 4096
  },
  fixFormat: {
    system: '你是一个 Markdown 格式专家。请修正以下文本的 Markdown 格式问题（标题层级、列表缩进、表格对齐、代码块标记等），不要修改文本内容本身。直接输出修正后的原始 Markdown 文本，不要对 Markdown 特殊字符（如 #、*、`、-、> 等）进行反斜杠转义，不要添加任何解释说明。',
    temperature: 0.1,
    maxTokens: 2048
  },
  summarize: {
    system: '你是一个文档摘要助手。请为以下文档生成一段简洁的摘要（100-200字），概括文档的核心内容和要点。只输出摘要文本，不要添加标题或格式标记。',
    temperature: 0.3,
    maxTokens: 512
  },
  translate: {
    system: '你是一个翻译助手。如果输入是中文，请翻译为英文；如果输入是英文或其他语言，请翻译为中文。保持专业术语准确，语句通顺。保留原有的 Markdown 格式，不要对特殊字符添加反斜杠转义。只输出翻译结果，不要添加任何解释说明。',
    temperature: 0.3,
    maxTokens: 2048
  }
}

export type AiAction = keyof typeof PROMPTS

export function useAi() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const abortController = ref<AbortController | null>(null)

  /**
   * 取消正在进行的 AI 请求
   */
  function cancel() {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }
    loading.value = false
  }

  /**
   * 非流式 AI 调用
   */
  async function request(params: {
    messages: Array<{ role: string, content: string }>
    action?: string
    maxTokens?: number
    temperature?: number
  }): Promise<string> {
    loading.value = true
    error.value = null

    try {
      const result = await $fetch<{
        code: number
        data: {
          choices: Array<{ message: { content: string } }>
        }
      }>('/api/ai/chat', {
        method: 'POST',
        body: {
          messages: params.messages,
          action: params.action || 'chat',
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          stream: false
        }
      })

      return result.data?.choices?.[0]?.message?.content || ''
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 流式 AI 调用
   */
  async function stream(params: {
    messages: Array<{ role: string, content: string }>
    action?: string
    maxTokens?: number
    temperature?: number
  }, onChunk: (text: string) => void): Promise<string> {
    loading.value = true
    error.value = null
    abortController.value = new AbortController()

    let fullText = ''

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: params.messages,
          action: params.action || 'chat',
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          stream: true
        }),
        signal: abortController.value.signal
      })

      if (!response.ok) {
        throw new Error(`AI 请求失败 (${response.status})`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              fullText += content
              onChunk(content)
            }
          } catch {
            // 忽略解析失败的行
          }
        }
      }

      return fullText
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return fullText
      }
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    } finally {
      loading.value = false
      abortController.value = null
    }
  }

  // ---- 业务快捷方法 ----

  /**
   * AI 续写
   */
  async function continueWriting(contextBefore: string, onChunk: (text: string) => void): Promise<string> {
    const p = PROMPTS.continueWriting!
    return stream({
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: contextBefore }
      ],
      action: 'continue_writing',
      maxTokens: p.maxTokens,
      temperature: p.temperature
    }, onChunk)
  }

  /**
   * 选中文本改写
   */
  async function rewrite(
    text: string,
    mode: 'polish' | 'simplify' | 'expand' | 'translate',
    onChunk: (text: string) => void
  ): Promise<string> {
    const p = PROMPTS[mode]!
    return stream({
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: text }
      ],
      action: mode,
      maxTokens: p.maxTokens,
      temperature: p.temperature
    }, onChunk)
  }

  /**
   * 格式纠正（非流式，短文本场景）
   */
  async function fixFormat(text: string): Promise<string> {
    const p = PROMPTS.fixFormat!
    return request({
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: text }
      ],
      action: 'fix_format',
      maxTokens: p.maxTokens,
      temperature: p.temperature
    })
  }

  /**
   * 生成摘要（非流式）
   */
  async function summarize(fullContent: string): Promise<string> {
    const p = PROMPTS.summarize!
    // 截取前 8000 字符避免超出 token 限制
    const truncated = fullContent.length > 8000 ? fullContent.slice(0, 8000) + '\n...(文档内容已截断)' : fullContent
    return request({
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: truncated }
      ],
      action: 'summarize',
      maxTokens: p.maxTokens,
      temperature: p.temperature
    })
  }

  return {
    loading: readonly(loading),
    error: readonly(error),
    cancel,
    request,
    stream,
    continueWriting,
    rewrite,
    fixFormat,
    summarize
  }
}
