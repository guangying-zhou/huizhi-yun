import { resolveSharedApiPath } from '../../shared/utils/sharedApiPath'

/**
 * Browser path for a Foundation shared user API. Standalone applications keep
 * the root `/api/<operation>` contract; the Enterprise Host maps it onto its
 * server-configured `sharedApiBase`. Without a Nuxt context (a server render
 * outside setup, or an isolated unit test) the root contract is kept.
 */
export function sharedApiPath(path: string) {
  const nuxtApp = typeof tryUseNuxtApp === 'function' ? tryUseNuxtApp() : null
  return resolveSharedApiPath(path, nuxtApp?.$config?.public as Record<string, unknown> | undefined)
}
