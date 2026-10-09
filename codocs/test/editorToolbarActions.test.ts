import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useEditorToolbarActions } from '../app/components/editor/useEditorToolbarActions.ts'

type Selection = {
  empty: boolean
  from: number
  to: number
  isText: boolean
}

function createToolbarActions(options?: {
  selection?: Selection
  userId?: string
  clipboardContent?: string | null
}) {
  let selection = options?.selection || { empty: false, from: 4, to: 9, isText: true }
  const replacements: Array<{ from: number, to: number, markdown: string }> = []
  const clipboardWrites: Array<{ uid: string, content: string }> = []
  const toastMessages: Array<{ title: string, color: string }> = []
  let clipboardReads = 0

  const actions = useEditorToolbarActions({
    readonly: false,
    getSelection: () => selection,
    getSelectionText: () => 'selected text',
    getSelectionCoords: () => ({ top: 100, left: 200 }),
    getAiButtonRect: () => null,
    replaceMarkdown: (input) => {
      replacements.push(input)
      return true
    },
    serializeSelection: () => 'serialized markdown',
    getCurrentUserId: () => options?.userId ?? 'u-1',
    writeClipboard: async (input) => {
      clipboardWrites.push(input)
    },
    readClipboard: async () => {
      clipboardReads += 1
      return options?.clipboardContent === null
        ? null
        : { content: options?.clipboardContent || 'clipboard markdown', contentType: 'markdown' }
    },
    toast: {
      add: (message) => {
        toastMessages.push(message)
      }
    }
  })

  return {
    actions,
    replacements,
    clipboardWrites,
    toastMessages,
    get clipboardReads() {
      return clipboardReads
    },
    setSelection(nextSelection: Selection) {
      selection = nextSelection
    }
  }
}

test('editor toolbar AI ignores an empty selection and clears its stale selection range when closed', () => {
  const harness = createToolbarActions({
    selection: { empty: true, from: 4, to: 4, isText: true }
  })

  harness.actions.openAiMenu()
  assert.equal(harness.actions.aiMenuVisible.value, false)
  assert.equal(harness.actions.aiSelectionRange.value, null)

  harness.setSelection({ empty: false, from: 4, to: 9, isText: true })
  harness.actions.openAiMenu()
  assert.deepEqual(harness.actions.aiSelectionRange.value, { from: 4, to: 9 })
  assert.equal(harness.actions.aiMenuVisible.value, true)

  harness.actions.closeAiMenu()
  assert.equal(harness.actions.aiMenuVisible.value, false)
  assert.equal(harness.actions.aiSelectionRange.value, null)
  assert.equal(harness.actions.aiSelectedText.value, '')
})

test('editor toolbar AI replaces exactly the range captured when the menu opens', () => {
  const harness = createToolbarActions()

  harness.actions.openAiMenu()
  harness.setSelection({ empty: false, from: 20, to: 24, isText: true })
  harness.actions.applyAiText('replacement **markdown**')

  assert.deepEqual(harness.replacements, [{
    from: 4,
    to: 9,
    markdown: 'replacement **markdown**'
  }])
  assert.equal(harness.actions.aiSelectionRange.value, null)
})

test('cloud clipboard makes no request for an empty selection or unauthenticated user', async () => {
  const emptySelection = createToolbarActions({
    selection: { empty: true, from: 4, to: 4, isText: true }
  })
  await emptySelection.actions.copyToCloudClipboard()
  assert.deepEqual(emptySelection.clipboardWrites, [])
  assert.equal(emptySelection.clipboardReads, 0)

  const unauthenticated = createToolbarActions({ userId: '' })
  await unauthenticated.actions.copyToCloudClipboard()
  await unauthenticated.actions.pasteFromCloudClipboard()
  assert.deepEqual(unauthenticated.clipboardWrites, [])
  assert.equal(unauthenticated.clipboardReads, 0)
  assert.deepEqual(unauthenticated.replacements, [])
})

test('cloud clipboard paste replaces only the current editor selection', async () => {
  const harness = createToolbarActions({ clipboardContent: 'pasted text' })
  harness.setSelection({ empty: false, from: 31, to: 36, isText: true })

  await harness.actions.pasteFromCloudClipboard()

  assert.equal(harness.clipboardReads, 1)
  assert.deepEqual(harness.replacements, [{
    from: 31,
    to: 36,
    markdown: 'pasted text'
  }])
})
