import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function source(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `${left} not found`)
  assert.notEqual(rightIndex, -1, `${right} not found`)
  assert.ok(leftIndex < rightIndex, `${left} should appear before ${right}`)
}

test('document editor keeps collaboration content pending until a preview snapshot is written', () => {
  const content = source('app/pages/documents/[uuid].vue')

  assert.match(content, /const needsCollaborationPreviewSnapshotFlush = ref\(false\)/)
  assert.match(
    content,
    /const hasPendingContentFlush = computed\(\(\) => editorContent\.value !== savedState\.value\.content \|\| needsCollaborationPreviewSnapshotFlush\.value\)/
  )
  assert.match(
    content,
    /const shouldSaveContent = options\?\.forceContent \|\| shouldPersistContentViaHttp\.value \|\| needsCollaborationPreviewSnapshotFlush\.value/
  )
  assert.match(content, /content: shouldSaveContent \? contentToSave : savedState\.value\.content/)
  assert.match(content, /if \(shouldSaveContent\) {\n\s+needsCollaborationPreviewSnapshotFlush\.value = false/)
  assert.match(content, /if \(syncedContent !== savedState\.value\.content && !isCollaborationReadonlyScope\.value\) {\n\s+needsCollaborationPreviewSnapshotFlush\.value = true/)
  assert.match(content, /if \(isCollaborationReadonlyScope\.value\) return false/)
  assert.doesNotMatch(content, /content: syncedContent/)
})

test('document editor waits for a markdown snapshot flush before route leave', () => {
  const content = source('app/pages/documents/[uuid].vue')

  assert.match(content, /async function flushDocumentBeforeRouteLeave\(\)/)
  assert.match(content, /const contentToSave = getCurrentEditorMarkdown\(\)/)
  assertBefore(content, 'await flushDocumentBeforeRouteLeave()', 'return true')
})

test('document editor uses PUT keepalive fetch for direct page exit flushes', () => {
  const content = source('app/pages/documents/[uuid].vue')

  assert.doesNotMatch(content, /navigator\.sendBeacon/)
  assert.match(content, /void fetch\(url, \{\n\s+method: 'PUT'/)
  assert.match(content, /keepalive: true/)
})
