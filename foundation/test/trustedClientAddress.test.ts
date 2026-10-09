import assert from 'node:assert/strict'
import test from 'node:test'
import type { H3Event } from 'h3'
import { reportedUserAgent, trustedClientAddress } from '../server/utils/trustedClientAddress.ts'

const event = (remoteAddress: string | undefined, headers: Record<string, string>) => ({ node: { req: { headers, socket: { remoteAddress } } } }) as unknown as H3Event

test('client address for sensitive audit never comes from browser-controlled forwarding headers', () => {
  // Direct connection: forwarding headers are whatever the browser sent, so they are ignored.
  assert.equal(trustedClientAddress(event('203.0.113.7', { 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '198.51.100.9' })), '203.0.113.7')
  // Behind a Gateway on loopback or a private address: the header it overwrites is used.
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.5', '172.20.0.3', '192.168.1.2', '100.64.72.59']) {
    assert.equal(trustedClientAddress(event(peer, { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9, 203.0.113.7' })), '203.0.113.7', peer)
  }
  // X-Forwarded-For alone is never trusted, not even its last hop.
  assert.equal(trustedClientAddress(event('127.0.0.1', { 'x-forwarded-for': '198.51.100.9' })), '127.0.0.1')
  // A Gateway that strips the headers (local test gateway) leaves the peer address.
  assert.equal(trustedClientAddress(event('::ffff:127.0.0.1', {})), '127.0.0.1')
  // Garbage is not an address.
  assert.equal(trustedClientAddress(event('127.0.0.1', { 'x-real-ip': 'evil.example' })), '127.0.0.1')
  assert.equal(trustedClientAddress(event('127.0.0.1', { 'x-real-ip': '203.0.113.7, 10.0.0.1' })), '127.0.0.1')
  assert.equal(trustedClientAddress(event(undefined, { 'x-real-ip': '203.0.113.7' })), '')
})

test('user agent is bounded and printable', () => {
  assert.equal(reportedUserAgent(event('127.0.0.1', { 'user-agent': ` Mozilla\u0000/5.0\n${'x'.repeat(400)}` })).length, 255)
  assert.equal([...reportedUserAgent(event('127.0.0.1', { 'user-agent': 'a\u0001b\r\nc' }))].some(c => c.charCodeAt(0) < 0x20), false)
  assert.equal(reportedUserAgent(event('127.0.0.1', {})), '')
})
