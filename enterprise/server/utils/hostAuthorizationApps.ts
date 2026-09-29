import { createError } from 'h3'
import { enterpriseNavigation } from '../../app/utils/enterprise-navigation'

// Modules whose pages the Host composes, generated from the composition
// registry (business modules plus Host-native navigation contributors). A
// browser permission snapshot is only ever read for one of these codes; the
// list is never restated by hand.
export const hostAuthorizationApps: readonly string[] = Object.freeze(
  enterpriseNavigation.navigationSources.map(source => source.appCode)
)

/** Exactly one `app` query value from the composed-module allowlist, else 400. */
export function resolveHostAuthorizationApp(query: Record<string, unknown>) {
  const keys = Object.keys(query)
  const app = query.app
  if (keys.length !== 1 || keys[0] !== 'app' || typeof app !== 'string' || !hostAuthorizationApps.includes(app)) {
    throw createError({ statusCode: 400, message: 'Unknown authorization module', data: { code: 'enterprise_authorization_module_invalid' } })
  }
  return app
}
