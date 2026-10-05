import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('department workspaces revalidate Directory membership after using cached content', () => {
  for (const path of [
    '../app/pages/departments/index.vue',
    '../app/pages/departments/cabinet.vue',
    '../app/pages/departments/weekly-reports.vue',
    '../app/components/department/AssetBrowser.vue'
  ]) {
    const content = source(path)
    assert.match(content, /const cachedDepartments = departmentsCache\.value/)
    assert.doesNotMatch(content, /if \(deptCode\.value\) return/)
    assert.match(content, /\/api\/account\/user-departments/)
  }
})

test('quick document creation does not treat a cached department list as authoritative', () => {
  const content = source('../app/composables/useQuickCreateDoc.ts')

  assert.doesNotMatch(
    content,
    /if \(cached\?\.departments\?\.length\) \{[\s\S]{0,240}return\s*\}/
  )
  assert.match(content, /\/api\/account\/user-departments/)
})
