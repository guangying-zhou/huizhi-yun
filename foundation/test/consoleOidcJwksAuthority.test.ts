import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../server/utils/consoleOidc.ts', import.meta.url),
  'utf8'
)

test('Console OIDC fetches user JWT keys from the direct Console endpoint with tenant-runtime context', () => {
  const verificationBlock = source
    .split('export async function resolveConsoleAuthContext')[1]
    ?.split('export async function requireConsoleAuthContext')[0] || ''

  assert.match(verificationBlock, /jwtVerify\(token, getIssuerJwks\(event,\s*config\.issuer,\s*endpointBaseUrl\)/)
  assert.match(verificationBlock, /issuer:\s*issuerCandidates\(event,\s*config\.issuer\)/)
  assert.match(verificationBlock, /validateConsoleOidcServiceToken\(event, config, token\)/)
  assert.match(verificationBlock, /validateIntrospectedServiceTokenClaims\(/)
  assert.match(verificationBlock, /decodedTokenUse === 'service'/)
  assert.match(source, /\[customFetch\]/)
  assert.match(source, /consoleBackendRequestHeaders\(event\)/)
})

test('Console session bridge forwards tenant-runtime context to the Console Worker', () => {
  const bridgeSource = readFileSync(
    new URL('../server/utils/consoleSessionBridge.ts', import.meta.url),
    'utf8'
  )

  for (const header of [
    'x-hzy-app-code',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-code',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience'
  ]) {
    assert.match(bridgeSource, new RegExp(`'${header}'`))
  }
})
