import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const executionPage = readFileSync(
  new URL('../app/pages/projects/[id]/board/[workItemId]/execution.vue', import.meta.url),
  'utf8'
)

test('execution page treats repository paths as linked deliverable documents', () => {
  assert.match(
    executionPage,
    /function hasLinkedDocument\(d: DeliverableItem\)[\s\S]*?d\.documentSource === 'repo'[\s\S]*?Boolean\(d\.repoProjectCode && d\.repoFilePath\)[\s\S]*?Boolean\(d\.documentUuid\)/
  )
  assert.match(
    executionPage,
    /if \(d\.deliverableType === 'document'\) return !hasLinkedDocument\(d\)/
  )
  assert.match(
    executionPage,
    /:label="hasLinkedDocument\(d\) \? '更换文档' : '选择文档'"/
  )
  assert.match(
    executionPage,
    /v-if="d\.deliverableType === 'document' && hasLinkedDocument\(d\)"/
  )
  assert.match(executionPage, /\{\{ d\.repoFilePath \}\}/)
  assert.match(executionPage, /d\.repoCommitId\.slice\(0, 8\)/)
})

test('execution page replaces the deliverable with the canonical update response', () => {
  assert.match(
    executionPage,
    /const response = await \$fetch<[\s\S]*?deliverable\?: DeliverableItem[\s\S]*?\/deliverables\/\$\{deliverableId\}/
  )
  assert.match(
    executionPage,
    /await loadContext\(\)[\s\S]*?const updatedDeliverable = response\.data\?\.deliverable[\s\S]*?context\.value\.deliverables\.splice\(index, 1, updatedDeliverable\)/
  )
})
