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
})
