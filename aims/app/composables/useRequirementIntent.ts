import { useAimsModule } from '../../layer/useAimsModule'

/** Keep the same key after an uncertain response; a changed intent gets a new key. */
export function useRequirementIntent() {
  const { moduleUrl, hosted } = useAimsModule()
  const keys = new Map<string, string>()
  async function mutate<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', payload: Record<string, unknown>, projectId: number): Promise<T> {
    const body = hosted && !path.startsWith('/api/v1/projects/') ? { ...payload, projectId } : payload
    const intent = JSON.stringify([path, method, body])
    const key = keys.get(intent) || crypto.randomUUID()
    keys.set(intent, key)
    const result = await $fetch<T>(moduleUrl(path), { method, body, headers: { 'Idempotency-Key': key } })
    keys.delete(intent)
    return result
  }
  return { mutate }
}
