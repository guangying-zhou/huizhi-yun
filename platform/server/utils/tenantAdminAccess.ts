import type { H3Event } from 'h3'

export function requireTenantOwnerForTenantAdmin(event: H3Event, message: string) {
  if (event.context.platformAccessScope !== 'tenant-admin') return

  const membership = event.context.platformTenantMembership as { isOwner?: boolean } | undefined
  if (membership?.isOwner) return

  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message
  })
}
