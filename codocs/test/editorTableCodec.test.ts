import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Schema } from '@milkdown/prose/model'
import { EditorState } from '@milkdown/prose/state'
import { tableNodes } from '@milkdown/prose/tables'
import type { EditorView } from '@milkdown/prose/view'
import {
  applyColwidthFromMarkdown,
  collectTableLayoutMetaFromDoc,
  encodeColwidthInMarkdown,
  parseTableMergeMetaFromMarkdown
} from '../app/components/editor/editorTableCodec.ts'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { content: 'inline*', group: 'block' },
    ...tableNodes({
      tableGroup: 'block',
      cellContent: 'paragraph+'
    })
  }
})

const paragraph = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
const cell = (attrs: Record<string, unknown>, text = '') => schema.nodes.table_cell.create(attrs, paragraph(text))
const row = (...cells: ReturnType<typeof cell>[]) => schema.nodes.table_row.create(null, cells)

function mergedTableDoc(colwidth: number[] | null = [200, 600]) {
  return schema.nodes.doc.create(null, schema.nodes.table.create(null, [
    row(cell({ colspan: 2, rowspan: 1, colwidth }, 'merged')),
    row(cell({ colspan: 1, rowspan: 1, colwidth: colwidth ? [colwidth[0]] : null }, 'left'), cell({ colspan: 1, rowspan: 1, colwidth: colwidth ? [colwidth[1]] : null }, 'right'))
  ]))
}

function fakeView(doc: ReturnType<typeof mergedTableDoc>) {
  let state = EditorState.create({ schema, doc })
  let lastAddToHistory: unknown
  return {
    get state() {
      return state
    },
    get lastAddToHistory() {
      return lastAddToHistory
    },
    dispatch(transaction: ReturnType<typeof EditorState.create>['tr']) {
      lastAddToHistory = transaction.getMeta('addToHistory')
      state = state.apply(transaction)
    }
  } as unknown as EditorView & { readonly lastAddToHistory: unknown }
}

test('table layout metadata expands a merged cell to every logical column', () => {
  const view = fakeView(mergedTableDoc())
  const layout = collectTableLayoutMetaFromDoc(view)[0]

  assert.deepEqual(layout?.colwidths, [200, 600])
  assert.deepEqual(layout?.alignments, ['left', 'left'])

  const encoded = encodeColwidthInMarkdown({
    markdown: '| left | right |\n| --- | --- |\n| a | b |',
    view
  })
  const separator = encoded.split('\n')[1]
  assert.match(separator || '', /^\|[^|]+\|[^|]+\|$/)
})

test('merged table restores explicit logical widths without adding an undo history entry', () => {
  const view = fakeView(mergedTableDoc(null))
  const payload = encodeURIComponent(JSON.stringify({
    v: 2,
    tables: [{
      merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }],
      colwidths: [200, 600],
      alignments: ['left', 'left']
    }]
  }))
  const markdown = `| left | right |\n| :---------------------------- | :------------------------------------------------------------------------------------ |\n| a | b |\n\n<!-- HZY_TABLE_MERGE:${payload} -->`

  applyColwidthFromMarkdown({
    markdown,
    getView: () => view,
    getEditorRoot: () => null,
    runLater: () => undefined
  })

  const table = view.state.doc.firstChild
  const mergedCell = table?.firstChild?.firstChild
  assert.deepEqual(mergedCell?.attrs.colwidth, [200, 600])
  assert.equal(view.lastAddToHistory, false)
})

test('invalid table metadata is stripped without changing the markdown body', () => {
  const markdown = '| a | b |\n| --- | --- |\n| 1 | 2 |\n<!-- HZY_TABLE_MERGE:not-valid -->'
  const parsed = parseTableMergeMetaFromMarkdown(markdown)

  assert.equal(parsed.cleanMarkdown, '| a | b |\n| --- | --- |\n| 1 | 2 |')
  assert.deepEqual(parsed.layouts, [])
})
