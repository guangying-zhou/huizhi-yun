import { defineEventHandler, type EventHandler, type H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

/**
 * Mounts one existing Foundation user API handler under the Host shared API
 * base (`/enterprise/api/foundation/**`, see Foundation `sharedApiPath`).
 *
 * The tenant gateway sends root `/api/*` to Console, which does not recognise
 * the Host session, so the Host serves the operations its pages use at this
 * reserved base instead. The handler is reused unchanged: its own checks and
 * the Console calls behind it keep authorizing each request. The Host adds
 * only the verified Host user session every `/enterprise/api` route requires,
 * so a service client credential used inside a handler can never answer an
 * anonymous or service-token caller. No identity is taken from headers.
 */
export function enterpriseSharedApi(handler: EventHandler) {
  return defineEventHandler(async (event: H3Event) => {
    await requireEnterpriseUser(event)
    return await handler(event)
  })
}
