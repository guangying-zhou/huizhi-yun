#!/usr/bin/env node
// Test-only issuance probes. Never print or persist bearer tokens or payloads.
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

try {
  const env = parseEnv(readFileSync(new URL('./.local-workers/gateway/.dev.vars', import.meta.url), 'utf8'))
  const bootstrapResponse = await fetch('https://hzy.wiztek.cn/api/platform/internal/tenant-gateway/runtime-bootstrap-token', {
    method: 'POST', headers: { authorization: `Bearer ${env.HZY_PLATFORM_INTERNAL_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tenantCode: 'C000001', environment: 'test', appCode: 'console' }), signal: AbortSignal.timeout(15000)
  })
  if (!bootstrapResponse.ok) throw Error('bootstrap')
  const bootstrap = (await bootstrapResponse.json()).data
  if (bootstrap.tenantCode !== 'C000001' || bootstrap.deploymentCode !== 'wiztek-test-console') throw Error('binding')
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const scope of ['console:policy-bundle:read', 'console:policy-bundle:write', 'console:policy-bundle:read console:policy-bundle:write']) {
      const response = await fetch('http://127.0.0.1:18080/v1/console/auth/service-tokens/issue', {
        method: 'POST', headers: { authorization: `Bearer ${bootstrap.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ audience, scope, issuer: 'https://hzy0.isme.dev', ttlSeconds: 60, sourceBinding: 'service-client-policy' }), signal: AbortSignal.timeout(20000)
      })
      if (!response.ok) throw Error('issue')
      const token = (await response.json()).data.accessToken
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
      if (claims.aud !== audience || claims.tenant !== 'C000001' || claims.deployment !== 'wiztek-test-console'
        || claims.source_app !== 'console' || claims.target_app !== audience || claims.token_use !== 'service'
        || claims.scope !== scope) throw Error('claims')
      console.log(JSON.stringify({ audience, scope, issued: true, bindingVerified: true }))
    }
  }
} catch {
  console.error('Test policy token issuance probe failed (sensitive response suppressed).')
  process.exitCode = 1
}
