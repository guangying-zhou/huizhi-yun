import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('table quick-action command behavior is isolated from the Milkdown editor shell', () => {
  const editor = source('app/components/editor/MilkdownEditor.client.vue')
  const quickActions = source('app/components/editor/useEditorTableQuickActions.ts')
  const quickActionsOverlay = source('app/components/editor/EditorTableQuickActions.vue')

  assert.match(editor, /useEditorTableQuickActions/)
  assert.match(editor, /<EditorTableQuickActions/)
  assert.match(editor, /handleTableQuickAction/)
  assert.doesNotMatch(editor, /const focusTableCellForQuickAction/)
  assert.match(quickActions, /isTableColumnResizing\.value/)
  assert.match(quickActions, /CellSelection/)
  assert.match(quickActions, /rescaleToContainer\(view\)/)
  assert.match(quickActions, /updatePosition\(\)/)
  assert.match(quickActions, /options\?\.failHint/)
  assert.match(quickActionsOverlay, /defineEmits/)
  assert.match(quickActionsOverlay, /emit\('action', 'merge'\)/)
  assert.match(quickActionsOverlay, /:disabled="!canMerge"/)
  assert.doesNotMatch(quickActionsOverlay, /@milkdown/)
})
