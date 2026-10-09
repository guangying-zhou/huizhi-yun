import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')
const start = page.indexOf('const handleRestoreFromDiff = async () => {')
const end = page.indexOf('\n}\n', start)
const body = page.slice(start, end + 2)

type Toast = { title: string, color?: string }

function restoreHarness(saveResult: unknown, options: { realtime?: boolean, readOnly?: boolean } = {}) {
  const calls: string[] = []
  const toasts: Toast[] = []
  const ref = <T>(value: T) => ({ value })
  const scope = {
    isEditingDisabled: ref(Boolean(options.readOnly)),
    isRealtimeCollaboration: ref(Boolean(options.realtime)),
    diffVersionData: ref({ id: 7, content: '# v7' }),
    editorContent: ref(''),
    milkdownEditorRef: ref({ setMarkdown: () => {} }),
    viewingVersion: ref(null),
    originalContent: ref(''),
    showDiffModal: ref(true),
    documentId: ref('doc-1'),
    mirrorCollaborationMarkdown: () => {},
    moduleUrl: (path: string) => path,
    saveDocument: async () => {
      calls.push('save')
      return saveResult
    },
    $fetch: async (url: string, init: { method?: string }) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      return {}
    },
    fetchVersionHistory: async () => {
      calls.push('history')
    },
    toast: { add: (item: Toast) => toasts.push(item) },
    console: { error: () => {} }
  }
  const run = new Function(...Object.keys(scope), `${body}\nreturn handleRestoreFromDiff()`)
  return { calls, toasts, done: run(...Object.values(scope)) as Promise<void> }
}

test('restore deletes the source version and reports success only after a confirmed save', async () => {
  const ok = restoreHarness(true)
  await ok.done
  assert.deepEqual(ok.calls, ['save', 'DELETE /api/documents/doc-1/versions/7', 'history'])
  assert.equal(ok.toasts.at(-1)?.color, 'success')

  for (const result of [false, undefined, null]) {
    const failed = restoreHarness(result)
    await failed.done
    assert.deepEqual(failed.calls, ['save'], `save result ${String(result)} must stop the restore`)
    assert.equal(failed.toasts.some(item => item.color === 'success'), false)
  }
})

test('read-only documents neither save nor delete history', async () => {
  const readOnly = restoreHarness(true, { readOnly: true })
  await readOnly.done
  assert.deepEqual(readOnly.calls, [])
})

test('the diff loader keeps the selected version id instead of trusting the detail DTO', () => {
  assert.match(page, /diffVersionData\.value = \{ \.\.\.response\.data, id: versionId \}/)
})
