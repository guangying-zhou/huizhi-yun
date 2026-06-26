import * as Y from 'yjs'

type YXmlChild = Y.XmlElement | Y.XmlText

const normalizeInline = (value: string) => value
  .replace(/\u00a0/g, ' ')
  .replace(/\n{3,}/g, '\n\n')

function hasMeaningfulMarkdownContent(value: string) {
  const normalized = String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .trim()

  return normalized.length > 0
}

const escapeTableCell = (value: string) => normalizeInline(value)
  .replace(/\|/g, '\\|')
  .replace(/\n+/g, '<br>')
  .trim()

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
  if (node instanceof Y.XmlText) return textFromXmlText(node)
  if (node instanceof Y.XmlElement) {
    if (node.nodeName === 'hardbreak') return '\n'
    if (node.nodeName === 'image') {
      const src = String(node.getAttribute('src') || '')
      const alt = String(node.getAttribute('alt') || '')
      return src ? `![${alt}](${src})` : ''
    }
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
  if (node instanceof Y.XmlText) return normalizeInline(textFromXmlText(node))

  if (node.nodeName === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node.getAttribute('level') || 1)))
    return `${'#'.repeat(level)} ${normalizeInline(inlineContent(node)).trim()}`
  }
  if (node.nodeName === 'paragraph') return normalizeInline(inlineContent(node)).trim()
  if (node.nodeName === 'hr') return '---'
  if (node.nodeName === 'blockquote') {
    return childrenOf(node).map(child => blockContent(child).trim()).filter(Boolean).join('\n\n')
      .split('\n').map(line => `> ${line}`).join('\n')
  }
  if (node.nodeName === 'bullet_list') return renderList(node)
  if (node.nodeName === 'ordered_list') return renderList(node, true)
  if (node.nodeName === 'code_block') {
    const language = String(node.getAttribute('language') || node.getAttribute('params') || '')
    return `\`\`\`${language}\n${inlineContent(node)}\n\`\`\``
  }
  if (node.nodeName === 'table') return renderTable(node)

  return normalizeInline(childrenOf(node).map(child => blockContent(child).trim()).filter(Boolean).join('\n\n'))
}

export function yjsDocumentToMarkdown(document: Y.Doc) {
  const markdownMirror = document.getText('content').toString()
  if (hasMeaningfulMarkdownContent(markdownMirror)) return markdownMirror

  return childrenOf(document.getXmlFragment('prosemirror'))
    .map(child => blockContent(child).trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
}
