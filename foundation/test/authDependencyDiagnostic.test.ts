import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { H3Event } from 'h3'
import { authDiagnosticRequestId, logAuthDependencyFailure } from '../server/utils/authDependencyDiagnostic.ts'

test('auth dependency log contains only stage, bounded status, class and a safe correlation id', () => {
  const event = { context: {}, node: { req: { headers: { 'x-request-id': 'test-request_1' } } } } as unknown as H3Event
  const lines: string[] = []
  const original = console.warn
  console.warn = value => { lines.push(String(value)) }
  try {
    logAuthDependencyFailure(event, 'runtime-session', { statusCode: 503, name: 'FetchError',
      message: 'Bearer secret-should-not-appear', response: { data: { cookie: 'private' } } }, 17.6)
  } finally { console.warn = original }
  assert.deepEqual(JSON.parse(lines[0] || '{}'), { event: 'console-auth-dependency-failure',
    requestId: 'test-request_1', stage: 'runtime-session', status: 503, errorClass: 'FetchError', durationMs: 18 })
  assert.doesNotMatch(lines[0] || '', /secret-should-not-appear|private/)
})

test('unsafe caller request ids are replaced and memoized on the event', () => {
  const event = { context: {}, node: { req: { headers: { 'x-request-id': 'bad\nsecret' } } } } as unknown as H3Event
  const first = authDiagnosticRequestId(event)
  assert.match(first, /^[0-9a-f-]{36}$/)
  assert.equal(authDiagnosticRequestId(event), first)
})

test('JWKS wrapper retains the upstream status only for safe diagnostics', () => {
  const event = { context: {}, node: { req: { headers: {} } } } as unknown as H3Event
  const lines: string[] = []
  const original = console.warn
  console.warn = value => { lines.push(String(value)) }
  try {
    const wrapped = Object.assign(new Error('public unavailable'), { statusCode: 503 })
    Object.defineProperty(wrapped, 'dependencyStatus', { value: 403 })
    logAuthDependencyFailure(event, 'jwks', wrapped, 3)
  } finally { console.warn = original }
  assert.equal(JSON.parse(lines[0] || '{}').status, 403)
  assert.doesNotMatch(lines[0] || '', /public unavailable/)
})

test('dependency log permits only fixed transport error codes', () => {
  const event = { context: {}, node: { req: { headers: {} } } } as unknown as H3Event
  const lines: string[] = []
  const original = console.warn
  console.warn = value => { lines.push(String(value)) }
  try {
    logAuthDependencyFailure(event, 'service-token-issue-http', { name: 'FetchError',
      cause: { code: 'ECONNRESET', message: 'private endpoint' } }, 8)
    logAuthDependencyFailure(event, 'service-token-issue-http', { name: 'FetchError',
      cause: { code: 'PRIVATE_SECRET', message: 'private endpoint' } }, 9)
  } finally { console.warn = original }
  assert.equal(JSON.parse(lines[0] || '{}').networkCode, 'ECONNRESET')
  assert.equal(JSON.parse(lines[1] || '{}').networkCode, undefined)
  assert.doesNotMatch(lines.join(' '), /PRIVATE_SECRET|private endpoint/)
})
