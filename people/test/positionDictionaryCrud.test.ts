import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const page = readFileSync(new URL('../app/pages/settings/positions.vue', import.meta.url), 'utf8')

describe('People position dictionary CRUD', () => {
  test('create and update share one editor while keeping position codes immutable', () => {
    assert.match(page, /v-model:open="editorOpen"/)
    assert.match(page, /method: current \? 'PATCH' : 'POST'/)
    assert.match(page, /\? `\/api\/v1\/positions\/\$\{current\.id\}`/)
    assert.match(page, /\.\.\.\(!current \? \{ positionCode \} : \{\}\)/)
    assert.match(page, /:disabled="Boolean\(editingPosition\)"/)
    assert.match(page, /ensurePeoplePermission\('positions', 'admin'\)/)
  })

  test('delete is explicit, permission guarded and confirmed as destructive', () => {
    assert.match(page, /method: 'DELETE'/)
    assert.match(page, /`\/api\/v1\/positions\/\$\{position\.id\}`/)
    assert.match(page, /tone: 'danger'/)
    assert.match(page, /已有员工和任职记录中的岗位快照不会被修改/)
    assert.match(page, /删除岗位 \$\{row\.original\.position_name\}/)
  })

  test('list keeps server pagination and debounced search behavior', () => {
    assert.match(page, /page_size: pageSize\.value/)
    assert.match(page, /onChange: \(\) => \{\s*page\.value = 1/)
    assert.match(page, /@keyup\.enter="flushSearch"/)
    assert.match(page, /<UPagination/)
  })
})
