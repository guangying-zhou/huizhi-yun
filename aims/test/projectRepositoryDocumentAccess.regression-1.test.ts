import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../server/utils/accessibleProjectDocuments.ts', import.meta.url),
  'utf8'
)

// Regression: ISSUE-016 — repository-backed project documents were sent to
// Codocs with the AIMS row UUID and disappeared from the project document page.
// Found by /qa on 2026-08-25.
test('repository documents use project membership instead of Codocs UUID access checks', () => {
  const branch = source.slice(
    source.indexOf('if (doc.documentSource === \'repo\')'),
    source.indexOf('const uuid = documentUuid(doc)')
  )

  assert.match(branch, /directProjectMemberAccess\(doc, projectContext, projectId\)/)
  assert.match(branch, /allowedDocumentIds\.add\(doc\.id\)/)
  assert.match(branch, /accessById\.set\(doc\.id, access\)/)
  assert.doesNotMatch(branch, /checkCodocsDocumentAccess/)
})

test('Codocs denial and dependency errors never fall back to project membership', () => {
  const branch = source.slice(source.indexOf('const uuid = documentUuid(doc)'))
  assert.doesNotMatch(branch, /directProjectMemberAccess/)
  assert.match(branch, /if \(!access.allowed\) return/)
  assert.match(branch, /if \(status === 403 \|\| status === 404\) return/)
  assert.match(branch, /throw error/)
  assert.doesNotMatch(source, /updateCodocsDocumentAccessPolicy|canRepairMissingSourcePolicy/)
})

test('empty project folders are retained only for project members', () => {
  assert.match(source, /filter\(doc => doc.isFolder && projectContext.isMember/)
  assert.match(source, /isDirectProjectDocument\(doc, projectId, projectContext.projectCode\)/)
})
