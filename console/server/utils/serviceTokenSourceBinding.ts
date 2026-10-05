export function serviceTokenSourceBindingForCredential(
  clientSecret: string,
  requestedBinding?: unknown
) {
  if (String(clientSecret || '').trim()) return 'service-client-policy' as const
  return String(requestedBinding || '').trim() === 'service-client-policy'
    ? 'service-client-policy' as const
    : 'trusted-gateway' as const
}
