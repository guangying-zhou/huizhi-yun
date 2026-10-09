import { useRuntimeConfig, useState } from '#imports'

export function useFinanceModule() {
  const hosted = useRuntimeConfig().public.appCode === 'enterprise'
  const local = (path: string) => {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /(^|\/)\.\.?($|\/)/.test(path)) throw new Error('Expected a local Finance path')
    return path
  }
  return {
    hosted,
    sessionScope: hosted ? useState<string>('enterprise-cache-scope', () => '') : null,
    moduleUrl: (path: string) => hosted ? `/finance${local(path)}` : local(path),
    apiUrl: (path: string) => hosted ? `/finance/api/v1${local(path)}` : `/api/v1/finance${local(path)}`
  }
}
