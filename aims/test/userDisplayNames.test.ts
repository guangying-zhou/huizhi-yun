import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('requirement detail and impact views resolve user identifiers through the directory', () => {
  const detail = source('../app/components/requirements/detail/Drawer.vue')
  const impact = source('../app/components/requirements/change/TaskImpactPanel.vue')

  for (const component of [detail, impact]) {
    assert.match(component, /useAccountUsers\(\)/)
    assert.match(component, /function getUserName/)
  }
  assert.match(detail, /getUserName\(req\.createdBy\)/)
  assert.match(detail, /getUserName\(v\.approvedBy\)/)
  assert.match(impact, /getUserName\(task\.assigneeUid\)/)
  assert.doesNotMatch(detail, /\{\{\s*req\.createdBy\s*\}\}/)
  assert.doesNotMatch(impact, /\{\{\s*task\.assigneeUid\s*\}\}/)
})

test('work item and document audit person labels do not render bare UIDs', () => {
  const workItems = source('../app/pages/projects/[id]/work-items.vue')
  const documents = source('../app/pages/projects/[id]/documents.vue')

  assert.match(workItems, /getUserName\(row\.original\.assigneeUid\)/)
  assert.match(workItems, /getUserName\(workItemStore\.currentItem\.reporterUid\)/)
  assert.match(workItems, /getUserName\(comment\.authorUid\)/)
  assert.match(documents, /displayUserName\(item\.actorUid, 'system'\)/)
})
