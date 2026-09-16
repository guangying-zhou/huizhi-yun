import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Codocs document download URLs', () => {
  test('browser downloads are resolved against the current Codocs app URL', () => {
    const helper = source('app/composables/useDocumentDownload.ts')

    assert.match(helper, /const \{ resolveCurrentAppUrl \} = useAppUrls\(\)/)
    assert.match(
      helper,
      /resolveCurrentAppUrl\(`\/api\/documents\/\$\{encodeURIComponent\(normalizedUuid\)\}\/download`\)/
    )
    assert.match(helper, /link\.href = href/)
  })

  test('preview and document list pages use the app-aware download helper', () => {
    const pages = [
      'app/pages/mydocs/index.vue',
      'app/pages/departments/index.vue',
      'app/pages/projects/index.vue',
      'app/pages/mydocs/favorites.vue',
      'app/pages/mydocs/recently.vue'
    ]

    for (const page of pages) {
      const content = source(page)
      assert.match(content, /const \{ downloadDocument \} = useDocumentDownload\(\)/, `${page} should use useDocumentDownload`)
      assert.doesNotMatch(content, /link\.href\s*=\s*`\/api\/documents\/\$\{uuid\}\/download`/, `${page} should not hard-code root-relative document downloads`)
    }
  })
})
