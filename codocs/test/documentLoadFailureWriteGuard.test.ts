import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')

describe('document load failure write guard', () => {
  test('does not persist the placeholder title unless document metadata loaded successfully', () => {
    assert.match(page, /const hasLoadedDocument = ref\(false\)/)
    assert.match(page, /loading\.value = true\s+hasLoadedDocument\.value = false/)
    assert.match(page, /savedState\.value = \{[\s\S]*?hasLoadedDocument\.value = true/)
    assert.match(page, /if \(!hasLoadedDocument\.value \|\| !isPageReady\.value \|\| saving\.value\) return/)
    assert.match(page, /if \(!import\.meta\.client \|\| !documentId\.value \|\| !hasLoadedDocument\.value \|\| !isPageReady\.value\) return/)
    assert.match(page, /const handleEditorReady = \(\) => \{[\s\S]*?if \(!hasLoadedDocument\.value\) return[\s\S]*?isPageReady\.value = true/)
  })

  test('load failure shows a retry state and never a collaboration banner or placeholder shell', () => {
    assert.match(page, /documentLoadFailureMessage\.value = documentLoadErrorMessage\(/)
    assert.match(page, /v-else-if="initialLoadPending"/)
    assert.match(page, /initialLoadPending\.value = false/)
    assert.match(page, /shouldLoadFromCollaboration = computed\(\(\) => supportsCollaboration\.value && !documentLoadFailure\.value/)
    assert.match(page, /shouldShowCollaborationStatusBar = computed\(\(\) => !isStaticReadonlyDoc\.value && !documentLoadFailure\.value/)
    assert.match(page, /label="重试"/)
  })

  test('company/knowledge/product documents never join collaboration', () => {
    assert.match(page, /isStaticReadonlyDoc = computed\(\(\) => \['company', 'knowledge', 'product'\]\.includes\(docState\.value\.doc_type\)\)/)
    assert.match(page, /&& !isRepositorySyncDoc\.value && !isStaticReadonlyDoc\.value/)
    assert.match(page, /!isStaticReadonlyDoc \? '协作未连接' : '只读'/)
  })
})
