export interface ConsoleMutationRequest {
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: Record<string, unknown>
}
export function createConsoleMutationIntent(prefix: string, key: () => string = () => `${prefix}:${globalThis.crypto.randomUUID()}`) {
  let intent: (ConsoleMutationRequest & { key: string, fingerprint: string }) | null = null
  let busy = false
  let uncertain = false
  const fingerprint = (input: ConsoleMutationRequest) => JSON.stringify([input.method, input.path, input.body || {}])
  return {
    get pending() { return intent },
    get busy() { return busy },
    get uncertain() { return uncertain },
    reset() {
      if (busy || uncertain) return false
      intent = null
      return true
    },
    async submit(input: ConsoleMutationRequest, send: (request: ConsoleMutationRequest, key: string) => Promise<unknown>) {
      if (busy) return false
      const signature = fingerprint(input)
      if (uncertain && intent?.fingerprint !== signature) throw Error('请先重试未完成的操作，再开始新的修改。')
      if (!intent || intent.fingerprint !== signature) intent = { ...structuredClone(input), key: key(), fingerprint: signature }
      busy = true
      try {
        await send(structuredClone(intent), intent.key)
        intent = null
        uncertain = false
        return true
      } catch (error) {
        const record = error as { statusCode?: number, status?: number, response?: { status?: number } }
        const status = Number(record.statusCode || record.status || record.response?.status || 0)
        uncertain = ![400, 401, 403, 404, 412, 422].includes(status)
        throw error
      } finally {
        busy = false
      }
    }
  }
}
