import type { H3Event } from 'h3'
import { cloudflareEnvFromEvent, type CloudflareServiceBinding } from './consoleServiceBinding'

export function cloudflareServiceBinding(
  event: H3Event | null | undefined,
  bindingName: string
): CloudflareServiceBinding | null {
  const candidate = cloudflareEnvFromEvent(event)[bindingName] as Partial<CloudflareServiceBinding> | undefined
  return candidate && typeof candidate.fetch === 'function'
    ? candidate as CloudflareServiceBinding
    : null
}

export function tenantGatewayServiceBinding(event: H3Event | null | undefined) {
  return cloudflareServiceBinding(event, 'HZY_TENANT_GATEWAY_SERVICE')
}
