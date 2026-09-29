import { useRuntimeConfig, useState } from '#imports'
import { modulePath } from './modulePath.mjs'

export function useAssetsModule() {
  const config = useRuntimeConfig()
  const hosted = config.public.appCode === 'enterprise'
  const sessionScope = hosted ? useState<string>('enterprise-cache-scope', () => '') : null
  return { moduleUrl: (path: string) => modulePath('assets', hosted, path), hosted, cacheKey: (key: string) => hosted ? `hzy:enterprise:${sessionScope?.value || 'unverified'}:assets:${key}` : key }
}
