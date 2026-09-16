import * as Y from 'yjs'
import { downloadDocumentBuffer } from './oss'

type YXmlChild = Y.XmlElement | Y.XmlText

function getYjsSnapshotPath(ossPath: string) {
  return ossPath.endsWith('.md') ? ossPath.replace(/\.md$/, '.yjs') : `${ossPath}.yjs`
}

function normalizeInline(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

export function hasMeaningfulMarkdownContent(value: string | null | undefined) {
  const normalized = String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .trim()

  return normalized.length > 0
}

function escapeTableCell(value: string) {
  return normalizeInline(value)
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, '<br>')
    .trim()
}

function textFromXmlText(node: Y.XmlText) {
  try {
    const delta = node.toDelta() as Array<{ insert?: unknown }>
    return delta.map(item => typeof item.insert === 'string' ? item.insert : '').join('')
  } catch {
    return node.toString()
  }
}

function childrenOf(node: Y.XmlElement | Y.XmlFragment): YXmlChild[] {
  try {
    return node.toArray() as YXmlChild[]
  } catch {
    return []
  }
}

function inlineContent(node: YXmlChild | Y.XmlFragment): string {
  if (node instanceof Y.XmlText) {
    return textFromXmlText(node)
  }

  if (node instanceof Y.XmlElement) {
    const name = node.nodeName
    if (name === 'hardbreak') return '\n'
    if (name === 'image') {
      const src = String(node.getAttribute('src') || '')
      const alt = String(node.getAttribute('alt') || '')
      return src ? `![${alt}](${src})` : ''
    }
    return childrenOf(node).map(inlineContent).join('')
  }

  return childrenOf(node).map(inlineContent).join('')
}

function tableCellText(cell: Y.XmlElement) {
  return escapeTableCell(childrenOf(cell).map(child => blockContent(child).trim()).filter(Boolean).join('\n'))
}

function tableRowCells(row: Y.XmlElement) {
  return childrenOf(row)
    .filter(child => child instanceof Y.XmlElement && (child.nodeName === 'table_cell' || child.nodeName === 'table_header')) as Y.XmlElement[]
}

function renderTable(table: Y.XmlElement) {
  const rows = childrenOf(table)
    .filter(child => child instanceof Y.XmlElement && (child.nodeName === 'table_header_row' || child.nodeName === 'table_row')) as Y.XmlElement[]

  if (rows.length === 0) return ''

  const renderedRows = rows.map(row => tableRowCells(row).map(tableCellText))
  const width = Math.max(...renderedRows.map(row => row.length), 1)
  const normalizedRows = renderedRows.map(row => Array.from({ length: width }, (_, index) => row[index] || ''))
  const firstRowIsHeader = rows[0]?.nodeName === 'table_header_row'
  const header = firstRowIsHeader ? normalizedRows[0]! : normalizedRows[0]!.map((_, index) => `列${index + 1}`)
  const body = firstRowIsHeader ? normalizedRows.slice(1) : normalizedRows

  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`)
  ].join('\n')
}

function renderList(list: Y.XmlElement, ordered = false) {
  return childrenOf(list)
    .filter(child => child instanceof Y.XmlElement && child.nodeName === 'list_item')
    .map((item, index) => {
      const content = childrenOf(item as Y.XmlElement).map(child => blockContent(child).trim()).filter(Boolean).join('\n')
      const prefix = ordered ? `${index + 1}. ` : '- '
      return `${prefix}${content.replace(/\n/g, '\n  ')}`
    })
    .join('\n')
}

function blockContent(node: YXmlChild): string {
  if (node instanceof Y.XmlText) {
    return normalizeInline(textFromXmlText(node))
  }

  const name = node.nodeName
  if (name === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node.getAttribute('level') || 1)))
    return `${'#'.repeat(level)} ${normalizeInline(inlineContent(node)).trim()}`
  }
  if (name === 'paragraph') return normalizeInline(inlineContent(node)).trim()
  if (name === 'hr') return '---'
  if (name === 'blockquote') {
    return childrenOf(node)
      .map(child => blockContent(child).trim())
      .filter(Boolean)
      .join('\n\n')
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
  }
  if (name === 'bullet_list') return renderList(node)
  if (name === 'ordered_list') return renderList(node, true)
  if (name === 'code_block') {
    const language = String(node.getAttribute('language') || node.getAttribute('params') || '')
    return `\`\`\`${language}\n${inlineContent(node)}\n\`\`\``
  }
  if (name === 'table') return renderTable(node)

  return normalizeInline(childrenOf(node).map(child => blockContent(child).trim()).filter(Boolean).join('\n\n'))
}

export function yjsSnapshotToMarkdown(snapshot: Uint8Array) {
  const document = new Y.Doc()
  Y.applyUpdate(document, snapshot)

  const markdownMirror = document.getText('content').toString()
  if (hasMeaningfulMarkdownContent(markdownMirror)) {
    document.destroy()
    return markdownMirror
  }

  const fragment = document.getXmlFragment('prosemirror')
  const content = childrenOf(fragment)
    .map(child => blockContent(child).trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()

  document.destroy()
  return content
}

export async function recoverMarkdownFromYjsSnapshot(ossPath: string, docType?: string) {
  const snapshot = await downloadDocumentBuffer(getYjsSnapshotPath(ossPath), docType)
  if (!snapshot || snapshot.length === 0) return ''
  return yjsSnapshotToMarkdown(new Uint8Array(snapshot))
}
