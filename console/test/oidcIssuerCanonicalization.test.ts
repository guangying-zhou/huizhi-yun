import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const oidcSource = readFileSync(
  new URL('../server/utils/oidc.ts', import.meta.url),
  'utf8'
)
const cloudflareConfigSource = readFileSync(
  new URL('../scripts/render-cloudflare-config.mjs', import.meta.url),
  'utf8'
)

test('OIDC issuer uses a verified Tenant Gateway host before the shared Cloudflare issuer', () => {
  const issuerBlock = oidcSource
    .split('export function getOidcIssuer(event: H3Event) {')[1]
    ?.split('function getCloudflareEnv(event: H3Event)')[0] || ''

  assert.match(issuerBlock, /resolveTrustedTenantGatewayContext\(event\)/)
  assert.match(issuerBlock, /normalizePublicUrl\(`https:\/\/\$\{trustedGateway\.forwardedHost\}`\)/)
  assert.match(issuerBlock, /runtimeEnvValue\(event, 'CONSOLE_OIDC_ISSUER'\)/)
  assert.ok(
    issuerBlock.indexOf('resolveTrustedTenantGatewayContext(event)')
    < issuerBlock.indexOf('runtimeEnvValue(event, \'CONSOLE_OIDC_ISSUER\')'),
    'the verified tenant gateway issuer must take precedence over the shared canonical issuer'
  )
  assert.ok(
    issuerBlock.indexOf('runtimeEnvValue(event, \'CONSOLE_OIDC_ISSUER\')')
    < issuerBlock.indexOf('resolveCurrentAppHomeUrl(event)'),
    'the shared canonical issuer must remain the direct-origin fallback'
  )
})

test('Cloudflare production config pins Console OIDC issuer to the canonical Console URL', () => {
  assert.match(
    cloudflareConfigSource,
    /const oidcIssuer = trimTrailingSlash\(value\('CONSOLE_OIDC_ISSUER', CLOUDFLARE_CONSOLE_PUBLIC_URL\)\)/
  )
  assert.match(
    cloudflareConfigSource,
    /\['CONSOLE_OIDC_ISSUER', oidcIssuer, CLOUDFLARE_CONSOLE_PUBLIC_URL\]/
  )
  assert.match(cloudflareConfigSource, /CONSOLE_OIDC_ISSUER: oidcIssuer/)
})
