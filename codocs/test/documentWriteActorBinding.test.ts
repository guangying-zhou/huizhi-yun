import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Codocs document write actor binding', () => {
  test('BFF document mutations do not send a client-controlled authorization bypass', () => {
    for (const path of [
      'server/api/documents/[uuid]/index.patch.ts',
      'server/api/documents/[uuid]/index.put.ts',
      'server/api/documents/[uuid]/index.delete.ts',
      'server/api/documents/[uuid]/restore.post.ts'
    ]) {
      assert.doesNotMatch(source(path), /serverAuthorized|server_authorized/)
    }
  })

  test('annotation BFF routes neither require nor forward browser-supplied identity fields', () => {
    const create = source('server/api/documents/[uuid]/annotations/index.post.ts')
    const update = source('server/api/documents/[uuid]/annotations/[id].patch.ts')
    const reply = source('server/api/documents/[uuid]/annotations/[id]/replies.post.ts')

    for (const route of [create, update, reply]) {
      assert.doesNotMatch(route, /author_id|author_name|resolved_by|deleted_by/)
    }
    assert.match(create, /Missing required fields \(content, selected_text\)/)
    assert.match(reply, /Content is required/)
  })

  test('annotation BFF routes authenticate and authorize before calling tenant runtime', () => {
    const routes = [
      [source('server/api/documents/[uuid]/annotations/index.get.ts'), 'view'],
      [source('server/api/documents/[uuid]/annotations/index.post.ts'), 'edit'],
      [source('server/api/documents/[uuid]/annotations/[id].patch.ts'), 'edit'],
      [source('server/api/documents/[uuid]/annotations/[id]/replies.post.ts'), 'edit'],
      [source('server/api/documents/[uuid]/annotations/[id]/replies/[replyId].delete.ts'), 'edit']
    ] as const

    for (const [route, action] of routes) {
      assert.match(route, /requireRequestUid\(event\)/)
      assert.match(route, new RegExp(`requirePermission\\(event,\\s*'documents',\\s*'${action}'`))
      assert.ok(route.indexOf('requireRequestUid(event)') < route.lastIndexOf('callCodocsTenantRuntime'))
    }
  })

  test('runtime actor injection removes legacy bypass fields before the adapter receives the body', () => {
    const runtimeAuth = source('../data-runtime/internal/apps/codocs/runtime_auth.go')

    assert.match(runtimeAuth, /"serverAuthorized":\s+true/)
    assert.match(runtimeAuth, /"server_authorized":\s+true/)
  })
})
