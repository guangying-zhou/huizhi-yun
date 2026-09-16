import { createEvent, type H3Event } from 'h3'
import { useEvent } from 'nitropack/runtime'

/**
 * Runtime bootstrap and heartbeat jobs have no browser request. They still
 * need a request-shaped context so the shared Tenant Runtime client can read
 * process/Cloudflare bindings and issue the Console service token.
 */
export function getBackgroundRuntimeEvent(): H3Event {
  try {
    const event = useEvent() as H3Event | undefined
    if (event) return event
  } catch {
    // Startup and scheduled work can run outside Nitro's async request scope.
  }
  // Use H3's event so URL/method/header getters behave like real requests.
  const event = createEvent({
    headers: {},
    method: 'GET',
    url: '/'
  } as H3Event['node']['req'], {} as H3Event['node']['res'])
  // Nitro's useRuntimeConfig(event) caches on context.nitro.runtimeConfig.
  event.context.nitro = {} as NonNullable<H3Event['context']['nitro']>
  return event
}
