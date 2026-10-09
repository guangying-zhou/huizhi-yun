import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Altoc document preview scoped authorization', () => {
  test('existing Codocs UUID attachment requires entity edit before the narrow Codocs write-share check and link write', () => {
    const content = source('server/api/v1/documents/index.post.ts')

    assert.match(content, /requirePermission\(event, entityConfig\.permissionResource, 'edit'\)/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery\(event, entityConfig\.permissionResource, 'edit'\)/)
    assert.match(content, /getEntityCode\(event, entityType, entityId, dataAccessQuery\)/)
    assert.match(content, /authorizeCodocsAltocEntityDocumentAttach/)
    assert.doesNotMatch(content, /getCodocsDocumentSummary/)
    assertBefore(content, 'await requirePermission(event, entityConfig.permissionResource, \'edit\')', 'await authorizeCodocsAltocEntityDocumentAttach')
    assertBefore(content, 'const entityCode = await getEntityCode', 'await authorizeCodocsAltocEntityDocumentAttach')
    assertBefore(content, 'await authorizeCodocsAltocEntityDocumentAttach', 'const link = await callAltocRuntime')
  })

  test('server preview verifies scoped document link before fetching Codocs content', () => {
    const content = source('server/api/v1/documents/preview.get.ts')

    assert.match(content, /maybeCallTenantRuntime/)
    assert.match(content, /requirePermission\(event, entityConfig\.permissionResource, 'view'\)/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery\(event, entityConfig\.permissionResource, 'view'\)/)
    assert.match(content, /\/v1\/altoc\/documents\/\$\{encodeURIComponent\(input\.linkId\)\}/)
    assert.match(content, /'\/v1\/altoc\/documents'/)
    assert.match(content, /matchesRequestedLink\(link, input\)/)
    assert.match(content, /文档未关联或无权预览/)
    assert.match(content, /getCodocsAltocEntityDocumentContent/)
    assertBefore(content, 'await verifyDocumentLinkAccess(event', 'await getCodocsAltocEntityDocumentContent')
  })

  test('server preview requires entity context in addition to document UUID', () => {
    const content = source('server/api/v1/documents/preview.get.ts')

    assert.match(content, /const entityType = text\(query\.entity_type \|\| query\.entityType\)/)
    assert.match(content, /const entityId = positiveInteger\(query\.entity_id \|\| query\.entityId\)/)
    assert.match(content, /const linkId = text\(query\.link_id \|\| query\.linkId\)/)
    assert.match(content, /if \(!entityType \|\| !entityId\)/)
  })

  test('external document view verifies scoped link before redirecting', () => {
    const content = source('server/api/v1/documents/external-view.get.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /safeExternalDocumentUrl\(text\(query\.url\)\)/)
    assert.match(content, /parsed\.protocol !== 'https:'/)
    assert.match(content, /requirePermission\(event, entityConfig\.permissionResource, 'view'\)/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery\(event, entityConfig\.permissionResource, 'view'\)/)
    assert.match(content, /\/v1\/altoc\/documents\/\$\{encodeURIComponent\(input\.linkId\)\}/)
    assert.match(content, /matchesRequestedExternalLink\(link, input\)/)
    assert.match(content, /sendRedirect\(event, url, 302\)/)
    assertBefore(content, 'await verifyExternalDocumentLinkAccess(event', 'return sendRedirect(event, url, 302)')
    assert.match(middleware, /apiPath === '\/api\/v1\/documents\/external-view'/)
  })

  test('document preview component sends entity and link context', () => {
    const content = source('app/components/DocumentPreview.vue')

    assert.match(content, /entityType\?: string/)
    assert.match(content, /entityId\?: number \| string/)
    assert.match(content, /linkId\?: number \| string/)
    assert.match(content, /entity_type: props\.entityType/)
    assert.match(content, /entity_id: props\.entityId/)
    assert.match(content, /link_id: props\.linkId/)
  })

  test('document panel passes the current Altoc entity context into preview', () => {
    const content = source('app/components/DocumentsPanel.vue')

    assert.match(content, /const previewLinkId = ref<number \| undefined>\(\)/)
    assert.match(content, /previewLinkId\.value = doc\.id/)
    assert.match(content, /:entity-type="props\.entityType"/)
    assert.match(content, /:entity-id="props\.entityId"/)
    assert.match(content, /:link-id="previewLinkId"/)
  })

  test('document panel opens external links through scoped proxy route', () => {
    const content = source('app/components/DocumentsPanel.vue')

    assert.match(content, /function externalDocumentViewUrl\(doc: DocumentLink\)/)
    assert.match(content, /params\.set\('url', String\(doc\.external_url \|\| ''\)\)/)
    assert.match(content, /params\.set\('entity_type', props\.entityType\)/)
    assert.match(content, /params\.set\('entity_id', String\(props\.entityId\)\)/)
    assert.match(content, /params\.set\('link_id', String\(doc\.id\)\)/)
    assert.match(content, /return `\/api\/v1\/documents\/external-view\?\$\{params\.toString\(\)\}`/)
    assert.match(content, /externalPreviewUrl\.value = externalDocumentViewUrl\(doc\)/)
    assert.match(content, /@click\.stop="openExternalDocument\(doc\)"/)
    assert.doesNotMatch(content, /externalPreviewUrl\.value = externalUrl/)
    assert.doesNotMatch(content, /@click\.stop="openExternalUrl\(doc\.external_url\)"/)
  })
})
