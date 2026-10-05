import { createHmac } from 'node:crypto'

/** Distinct local egress credential; never forwards the service client secret. */
export function localCodocsEgressCredential(serviceClientSecret: string): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(serviceClientSecret)) throw Error('Local Codocs service credential unavailable')
  return createHmac('sha256', serviceClientSecret)
    .update('hzy0-codocs-console-egress:C000001:test:C000001-test-codocs:v1')
    .digest('base64url')
}
