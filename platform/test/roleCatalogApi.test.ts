import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('tenant-admin role catalog API', () => {
  test('categorizes the full matched role set before category filtering and pagination', () => {
    const content = source('server/api/platform/tenant-admin/role-catalog.get.ts')

    assert.match(content, /async function loadRoleCatalogRows\(whereSql: string, params: Array<string \| number>, includeMetadata: boolean\)/)
    assert.doesNotMatch(content, /LIMIT \? OFFSET \?/)
    assert.match(content, /const allCategorized = rows[\s\S]*deriveRoleCatalogCategory/)
    assert.match(content, /const categorized = allCategorized\.filter\(row => !category \|\| row\.category === category\)/)
    assert.match(content, /const pagedItems = categorized\.slice\(offset, offset \+ pageSize\)/)
    assert.match(content, /items: pagedItems/)
    assert.match(content, /total: categorized\.length/)
    assert.match(content, /count: allCategorized\.filter\(role => role\.category === item\.value\)\.length/)
  })

  test('role catalog UI consumes API totals and exposes pagination controls', () => {
    const content = source('app/components/console/RoleCatalogManager.vue')

    assert.match(content, /const page = ref\(1\)/)
    assert.match(content, /const pageSize = 100/)
    assert.match(content, /const totalRoles = ref\(0\)/)
    assert.match(content, /const totalPages = computed\(\(\) => Math\.max\(1, Math\.ceil\(totalRoles\.value \/ pageSize\)\)\)/)
    assert.match(content, /const visibleStart = computed/)
    assert.match(content, /const visibleEnd = computed/)
    assert.match(content, /page: page\.value/)
    assert.match(content, /pageSize/)
    assert.match(content, /totalRoles\.value = response\.data\.total/)
    assert.match(content, /function applyCatalogFilters\(\)/)
    assert.match(content, /function pageCatalog\(delta: number\)/)
    assert.match(content, /@keyup\.enter="applyCatalogFilters"/)
    assert.match(content, /@click="applyCatalogFilters"/)
    assert.match(content, /共 \{\{ totalRoles \}\} 个角色 · 显示 \{\{ visibleStart \}\}-\{\{ visibleEnd \}\} · 第 \{\{ page \}\} \/ \{\{ totalPages \}\} 页/)
    assert.match(content, /@click="pageCatalog\(-1\)"/)
    assert.match(content, /@click="pageCatalog\(1\)"/)
  })
})
