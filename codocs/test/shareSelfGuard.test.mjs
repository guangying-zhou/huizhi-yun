import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('both share entry points exclude actor and reject stale self selection', () => {
  const editor = readFileSync(new URL('../app/components/editor/EditorShare.vue', import.meta.url), 'utf8')
  const modal = readFileSync(new URL('../app/components/document/ShareDocumentModal.vue', import.meta.url), 'utf8')
  assert.match(editor, /if \(user.uid === currentUser.value\) return false/)
  assert.match(editor, /!uid \|\| uid === currentUser.value/)
  assert.match(modal, /:exclude-uids="user \? \[user\] : \[\]"/)
  assert.match(modal, /targetUser.uid === user.value/)
})
