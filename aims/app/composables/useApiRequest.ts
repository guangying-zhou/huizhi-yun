/**
 * 通用 API 请求封装
 * 提供 loading 状态、错误捕获、失败 toast 提示、网络错误自动重试（1 次）
 */
export function useApiRequest<T = unknown>() {
  const toast = useToast()

  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(false)
  const error = ref<Error | null>(null)

  async function execute(
    fn: () => Promise<T>,
    options?: { retries?: number, silent?: boolean }
  ): Promise<T | null> {
    const maxRetries = options?.retries ?? 1
    const silent = options?.silent ?? false

    loading.value = true
    error.value = null

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn()
        data.value = result
        loading.value = false
        return result
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // 仅在网络错误时重试
        const isNetworkError = lastError.message === 'Failed to fetch'
          || lastError.message.includes('NetworkError')
          || lastError.message.includes('network')

        if (attempt < maxRetries && isNetworkError) {
          continue
        }
      }
    }

    error.value = lastError
    loading.value = false

    if (!silent && lastError) {
      toast.add({
        title: '请求失败',
        description: lastError.message || '未知错误',
        color: 'error'
      })
    }

    return null
  }

  return {
    data,
    loading,
    error,
    execute
  }
}
