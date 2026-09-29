import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../server/api/activation/diagnostics.get.ts', import.meta.url), 'utf8')

test('gateway-forwarded requests never count as local diagnostics access', () => {
  const body = source.slice(source.indexOf('function isLocalRequest'), source.indexOf('function assertDiagnosticsAccess'))
  // The gateway marker is checked before any loopback Host/peer reasoning,
  // so a forwarded request cannot pass by claiming x-forwarded-for: 127.0.0.1.
  const marker = body.indexOf('getHeader(event, \'x-hzy-gateway\')')
  assert.ok(marker > 0)
  assert.ok(marker < body.indexOf('getHeader(event, \'host\')'))
  assert.ok(marker < body.indexOf('getHeader(event, \'x-forwarded-for\')'))
})
