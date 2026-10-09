import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const middleware = readFileSync(
  new URL('../server/middleware/tenant-runtime.ts', import.meta.url),
  'utf8'
)

describe('Aims project-management facts service boundary', () => {
  test('only People can read facts with the exact capability', () => {
    assert.match(middleware, /suffix === '\/service\/project-management-facts'[\s\S]{0,80}method === 'GET'/)
    assert.match(middleware, /scope: 'aims:project-management-facts:read', allowedApps: \['people'\]/)
  })
})
