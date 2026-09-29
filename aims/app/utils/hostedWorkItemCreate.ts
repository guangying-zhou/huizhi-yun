type Response = { code: number, data?: Record<string, unknown> }
type Request = (path: string, options?: { method: 'POST', body: Record<string, unknown>, headers: Record<string, string>, retry: 0 }) => Promise<Response>

/** Keep an uncertain Host command paired with its original key; store no draft text. */
export function hostedWorkItemCreator(request: Request, storage: () => Storage | undefined = () => typeof sessionStorage === 'undefined' ? undefined : sessionStorage) {
  const keys = new Map<string, string>()
  const flights = new Map<string, Promise<Record<string, unknown>>>()
  return async (scope: string, projectId: number, input: unknown) => {
    const commandInput = JSON.stringify({ projectId, input })
    const flightName = `${scope}:${commandInput}`
    const current = flights.get(flightName)
    if (current) return await current
    const command = (async () => {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(commandInput)))).map(value => value.toString(16).padStart(2, '0')).join('')
      const name = `${scope}:work-item-create:${projectId}:${digest}`
      let key = keys.get(name) || ''
      try {
        key = storage()?.getItem(name) || key
      } catch { /* Memory fallback. */ }
      if (!key) key = crypto.randomUUID()
      keys.set(name, key)
      try {
        storage()?.setItem(name, key)
      } catch { /* Memory fallback. */ }
      const receipt = await request(`/api/v1/projects/${projectId}/work-items`, { method: 'POST', body: (JSON.parse(commandInput) as { input: Record<string, unknown> }).input, headers: { 'Idempotency-Key': key }, retry: 0 })
      const id = Number((receipt.data?.result as { id?: unknown } | undefined)?.id)
      if (receipt.code !== 0 || !Number.isSafeInteger(id) || id < 1) throw Error('工作项创建回执无效，请使用原操作标识重试')
      const detail = await request(`/api/v1/work-items/${id}`)
      if (detail.code !== 0 || Number(detail.data?.id) !== id) throw Error('工作项详情暂不可用，请使用原操作标识重试')
      keys.delete(name)
      try {
        storage()?.removeItem(name)
      } catch { /* Memory fallback. */ }
      return detail.data!
    })()
    flights.set(flightName, command)
    try {
      return await command
    } finally {
      flights.delete(flightName)
    }
  }
}
