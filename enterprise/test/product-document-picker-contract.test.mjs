import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('product document picker uses existing Codocs ACL lists and leaves link authorization intact', () => {
  const page = read('../../aims/layer/pages/enterprise-product-documents.vue')
  const personal = read('../server/utils/enterpriseCodocsDocumentReads.ts')
  const shared = read('../server/utils/enterpriseCodocsCollaboration.ts')
  const link = read('../server/utils/enterpriseProductDocumentLink.ts')

  assert.match(page, /\$fetch<[^\n]+>\('\/codocs\/api\/documents'/)
  assert.match(page, /query: \{ type: 'private', \.\.\.\(pickerSearch\.value \? \{ search: pickerSearch\.value \} : \{\}\), page: pickerPage\.value, pageSize: pickerPageSize \}/)
  assert.match(page, /\$fetch<[^\n]+>\('\/codocs\/api\/collab-docs'/)
  assert.match(page, /query: \{ category: 'shared', scope: 'all', keyword: pickerSearch\.value \}/)
  assert.match(page, /linkDocumentUuid\.value = document\.uuid/)
  assert.match(page, /documentUuid: linkDocumentUuid\.value\.trim\(\)/)
  assert.match(personal, /loadAuthorizationSnapshotFromConsoleRuntime/)
  assert.match(personal, /authorizationResourcesAllow\(authorization\.resources, 'documents', permission/)
  assert.match(shared, /authorizationResourcesAllow\(snapshot\.resources, 'documents', 'view'/)
  assert.match(link, /checkProductPermission/)
  assert.match(link, /callEnterpriseRuntime/)
})
