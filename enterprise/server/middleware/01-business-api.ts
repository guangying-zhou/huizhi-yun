import { createError, defineEventHandler, getRequestURL } from 'h3'
import { isBusinessApiPath, isBusinessApiReady } from '../../composition/business-api-readiness.mjs'

// Explicit readiness boundary for business module APIs. The allowed surface is
// derived from the registered route files rather than restated here, so a route
// can never ship behind a stale whitelist. Unknown paths under a module prefix
// stay denied: readiness reports whether the Host serves an endpoint at all,
// never whether this person may use it.
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!isBusinessApiPath(path) || isBusinessApiReady(event.method, path)) return
  throw createError({ statusCode: 503, statusMessage: 'Business module unavailable', data: { code: 'enterprise_module_runtime_not_ready' } })
})
