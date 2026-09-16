import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

test('Altoc entity document service routes authenticate, bind, and verify the first-hop command before runtime or OSS', () => {
  const content = read('server/api/v1/service/altoc-entity-documents/[uuid]/content.post.ts')
  const attach = read('server/api/v1/service/altoc-entity-documents/[uuid]/attach.post.ts')
  const middleware = read('server/middleware/tenant-runtime.ts')
  const policy = read('server/lib/serviceAuthPolicy.ts')

  for (const route of [content, attach]) {
    assert.match(route, /requireCodocsServiceTenantDeploymentBinding/)
    assert.match(route, /validateAltocEntityDocumentCommand/)
    assert.match(route, /verifyAltocEntityDocumentCommandHeaders/)
    assert.match(route, /callCodocsTenantRuntime/)
    assert.ok(route.indexOf('requireCodocsServiceTenantDeploymentBinding') < route.indexOf('readBody<'))
    assert.ok(route.lastIndexOf('verifyAltocEntityDocumentCommandHeaders') < route.lastIndexOf('callCodocsTenantRuntime'))
  }
  assert.match(content, /downloadDocument/)
  assert.ok(content.indexOf('callCodocsTenantRuntime') < content.indexOf('downloadDocument'))
  assert.doesNotMatch(content, /ossPath:\s*grant\./)
  assert.match(policy, /codocs:altoc-entity-document:content:read/)
  assert.match(policy, /codocs:altoc-entity-document:attach/)
  assert.match(middleware, /altoc-entity-documents/)
})

test('runtime accepts only Altoc source-bound commands and intersects original Codocs ACL', () => {
  const runtime = read('../data-runtime/internal/apps/codocs/altoc_entity_document_service.go')
  const adapter = read('../data-runtime/internal/apps/codocs/adapter.go')

  assert.match(runtime, /TrustedServiceCommandSourceAppKey\)\) != "altoc"/)
  assert.match(runtime, /TrustedServiceCommandSourceClientKey\)\) != "altoc"/)
  assert.match(runtime, /query\.Get\("hzy_runtime_actor_purpose"\)\) != "service-command"/)
  assert.match(runtime, /a\.documentAccess\(ctx, uuid, query\)/)
  assert.match(runtime, /boolValue\(document\["readonly"\]\)/)
  assert.match(runtime, /isAltocEntityDocumentType/)
  assert.match(adapter, /service\/altoc-entity-documents/)
})
