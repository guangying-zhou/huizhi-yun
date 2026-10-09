import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Console runtime instance conflict explanation helper', () => {
  test('exports a Foundation helper instead of requiring business apps to call Platform directly', () => {
    const content = source('server/utils/platformBundleAuthorization.ts')

    assert.match(content, /export async function loadInstanceConflictExplanationFromConsoleRuntime/)
    assert.match(content, /\/api\/v1\/console\/user\/instance-conflict-explain/)
    assert.match(content, /\/api\/auth\/instance-conflict-explain/)
    assert.doesNotMatch(content, /\/api\/platform\/tenant-admin\/instance-conflict-explain/)
  })

  test('forwards object context and same-actor principals to Console', () => {
    const content = source('server/utils/platformBundleAuthorization.ts')

    assert.match(content, /includeBaseline: options\.includeBaseline \?\? true/)
    assert.match(content, /object: options\.object \|\| undefined/)
    assert.match(content, /principals: options\.principals \|\| undefined/)
    assert.match(content, /resourceCode,\s+action,/)
  })

  test('rejects missing permission tuple and mismatched users', () => {
    const content = source('server/utils/platformBundleAuthorization.ts')

    assert.match(content, /resourceCode and action are required for instance conflict explanation/)
    assert.match(content, /Console instance conflict explanation uid mismatch/)
  })

  test('propagates Console policyRevision through authorization helpers', () => {
    const content = source('server/utils/platformBundleAuthorization.ts')

    assert.match(content, /policyRevision\?: number \| null/)
    assert.match(content, /policyRevision\?: number \| string \| null/)
    assert.match(content, /policyRevision: numberOrNull\(data\.policyRevision\)/)
  })
})
