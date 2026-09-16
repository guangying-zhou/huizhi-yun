import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { matchRouteRule } from '../app/config/permissions.ts'

describe('matchRouteRule', () => {
  test('wildcard section rules also match the section root path', () => {
    assert.deepEqual(
      matchRouteRule('/dashboard'),
      { pattern: '/dashboard/**', resource: 'dashboard', action: 'view' }
    )
    assert.deepEqual(
      matchRouteRule('/dashboard/'),
      { pattern: '/dashboard/**', resource: 'dashboard', action: 'view' }
    )
  })

  test('wildcard section rules still match descendants', () => {
    assert.deepEqual(
      matchRouteRule('/customers/C-001'),
      { pattern: '/customers/**', resource: 'customer', action: 'view' }
    )
  })
})
