import assert from 'node:assert/strict'
import { test } from 'node:test'
import { marked } from 'marked'
import { buildPreviewChunks } from '../app/components/editor/previewMarkdownChunks.ts'

const cover = `# 职级管理制度V2.0

| 拟制：王敏 | 日期：2026.8.25 |
| --- | --- |
| 审核： | 日期： |
| 批准：周光营 | 日期：2026.9.1 |

山东汇智科技发展有限公司

版权所有 翻印必究

**文件修改记录**

| 版本号 | 修改章节号 | 修改内容 | 修改人及日期 | 批准人及日期 | 生效日期 |
| --- | --- | --- | --- | --- | --- |
| V1.0 | 全部 | 首次发布 | 王敏2022.7.8 | 周光营2022.7.8 | 2022.7.8 |
| V2.0 | 全部 | 重构职级序列 | 王敏2026.8.25 | 周光营2026.9.1 | 2026.9.1 |

## 一、目的

建立有序的职级体系。
`

test('preview keeps cover text outside two independent tables with different column counts', () => {
  const chunks = buildPreviewChunks(cover)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0], cover)
  const tokens = marked.lexer(chunks[0]!)
  const tables = tokens.filter(token => token.type === 'table')
  assert.deepEqual(tables.map(table => table.header.length), [2, 6])
  assert.deepEqual(tables.map(table => table.rows.length), [2, 2])
  assert.ok(tokens.some(token => token.type === 'paragraph' && token.text === '山东汇智科技发展有限公司'))
  assert.ok(tokens.some(token => token.type === 'heading' && token.text === '一、目的'))
})

test('multi-chunk preview preserves all normalized whitespace and block boundaries', () => {
  const markdown = `${cover}\n${'独立段落。'.repeat(800)}\n\n${cover}`
  const chunks = buildPreviewChunks(markdown.replace(/\n/g, '\r\n'))
  assert.ok(chunks.length > 1)
  assert.equal(chunks.join(''), markdown)
  const types = (source: string) => marked.lexer(source).filter(token => token.type !== 'space').map(token => token.type)
  assert.deepEqual(chunks.flatMap(types), types(markdown))
})

test('oversized tables, lists and fenced code stay intact', () => {
  const table = `| A | B |\n| --- | --- |\n${'| left | right |\n'.repeat(400)}\n`
  const code = `\`\`\`mermaid\ngraph TD\n${'A --> B\n'.repeat(500)}\`\`\`\n\n`
  const list = `${'- list item\n'.repeat(500)}\n`
  const markdown = table + code + list
  const chunks = buildPreviewChunks(markdown)
  assert.equal(chunks.join(''), markdown)
  for (const block of [table, code, list]) assert.ok(chunks.some(chunk => chunk.includes(block)))
})

test('global table layout metadata stays with the full body even beyond chunk thresholds', () => {
  const payload = encodeURIComponent(JSON.stringify({ v: 2, tables: [{ merges: [{ row: 0, col: 0, rowspan: 1, colspan: 2 }], colwidths: [200, 600] }] }))
  for (const gap of ['', ' ', '\n']) {
    const markdown = `${cover.repeat(12)}\n<!--${gap}HZY_TABLE_MERGE:${payload} -->`
    assert.deepEqual(buildPreviewChunks(markdown), [markdown])
  }
})

test('empty and whitespace-only content is preserved', () => {
  for (const markdown of ['', '\n', '\n\n', '  \n \n', 'text', 'text\n']) {
    assert.equal(buildPreviewChunks(markdown).join(''), markdown)
  }
})
