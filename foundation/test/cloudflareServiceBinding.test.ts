import assert from 'node:assert/strict'
import test from 'node:test'
import type { H3Event } from 'h3'
import {
  cloudflareServiceBinding,
  tenantGatewayServiceBinding
} from '../server/utils/cloudflareServiceBinding.ts'

test('resolves only callable Cloudflare Service Bindings from the event runtime', () => {
  const gateway = { fetch: async () => new Response('ok') }
  const event = {
    context: {
      cloudflare: {
        env: {
          HZY_TENANT_GATEWAY_SERVICE: gateway,
          HZY_BROKEN_SERVICE: { fetch: 'not-callable' }
        }
      }
    }
  } as unknown as H3Event

  assert.equal(tenantGatewayServiceBinding(event), gateway)
  assert.equal(cloudflareServiceBinding(event, 'HZY_BROKEN_SERVICE'), null)
  assert.equal(cloudflareServiceBinding(event, 'HZY_MISSING_SERVICE'), null)
})
