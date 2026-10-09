import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const page = readFileSync(
  new URL('../app/pages/projects/new.vue', import.meta.url),
  'utf8'
)
const runtimeTemplates = readFileSync(
  new URL('../../data-runtime/internal/apps/aims/project_templates.go', import.meta.url),
  'utf8'
)

describe('project create template selection', () => {
  test('ignores stale template list and detail responses after category changes', () => {
    assert.match(page, /let templateVersionsRequestId = 0/)
    assert.match(page, /let templateVersionDetailRequestId = 0/)
    assert.match(page, /const requestId = \+\+templateVersionsRequestId/)
    assert.match(page, /requestId !== templateVersionsRequestId\s*\|\|\s*effectiveProjectCategory\.value !== category/)
    assert.match(page, /const requestId = \+\+templateVersionDetailRequestId/)
    assert.match(page, /requestId !== templateVersionDetailRequestId[\s\S]*detail\.category !== category/)
  })

  test('does not submit a template from another project category', () => {
    assert.match(page, /const isTemplateSelectionReady = computed/)
    assert.match(page, /detail\.category === effectiveProjectCategory\.value/)
    assert.match(page, /if \(!isTemplateSelectionReady\.value\)/)
    assert.match(page, /:disabled="[^"]*!isTemplateSelectionReady[^"]*"/)
    assert.match(
      runtimeTemplates,
      /if rowCategory != category \{[\s\S]*http\.StatusBadRequest, "project_template_category_mismatch"/
    )
  })

  test('surfaces the runtime business error instead of leaving an unhandled rejection', () => {
    assert.match(page, /catch \(err: unknown\) \{[\s\S]*title: '创建项目失败'/)
    assert.match(page, /getErrorMessage\(err, '创建项目失败，请稍后重试'\)/)
  })
})
