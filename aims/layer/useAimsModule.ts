import { useRuntimeConfig, useState } from '#imports'
import { modulePath } from './modulePath.mjs'

export function useAimsModule() {
  const config = useRuntimeConfig()
  const hosted = config.public.appCode === 'enterprise'
  const sessionScope = hosted ? useState<string>('enterprise-cache-scope', () => '') : null
  return { moduleUrl: (path: string) => modulePath('aims', hosted, path), hosted, cacheKey: (key: string) => hosted ? `hzy:enterprise:${sessionScope?.value || 'unverified'}:aims:${key}` : key }
}
