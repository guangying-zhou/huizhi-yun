import type { Crepe } from '@milkdown/crepe'
import { serializerCtx } from '@milkdown/core'
import type { Node as ProsemirrorNode } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'
import { TableMap } from '@milkdown/prose/tables'

export interface TableMergeCellMeta {
  row: number
  col: number
  rowspan: number
  colspan: number
}

export interface TableLayoutMeta {
  merges: TableMergeCellMeta[]
  colwidths: (number | null)[]
  alignments: string[]
}

export const TABLE_TARGET_WIDTH = 800

const TABLE_MERGE_META_RE = /<!--\s*HZY_TABLE_MERGE:([^\n]*?)\s*-->/g

const normalizeTableMergeMetaTables = (tables: unknown): TableMergeCellMeta[][] => {
  if (!Array.isArray(tables)) return []

  return tables.map((table) => {
    if (!Array.isArray(table)) return []

    const cells: TableMergeCellMeta[] = []
    for (const rawCell of table) {
      if (!rawCell || typeof rawCell !== 'object') continue
      const row = Number((rawCell as { row?: unknown }).row)
      const col = Number((rawCell as { col?: unknown }).col)
      const rowspan = Number((rawCell as { rowspan?: unknown }).rowspan)
      const colspan = Number((rawCell as { colspan?: unknown }).colspan)

      if (!Number.isFinite(row) || !Number.isFinite(col) || !Number.isFinite(rowspan) || !Number.isFinite(colspan)) continue

      const safeRow = Math.max(0, Math.floor(row))
      const safeCol = Math.max(0, Math.floor(col))
      const safeRowspan = Math.max(1, Math.floor(rowspan))
      const safeColspan = Math.max(1, Math.floor(colspan))
      if (safeRowspan <= 1 && safeColspan <= 1) continue

      cells.push({
        row: safeRow,
        col: safeCol,
        rowspan: safeRowspan,
        colspan: safeColspan
      })
    }

    cells.sort((a, b) => ((b.rowspan * b.colspan) - (a.rowspan * a.colspan)) || (a.row - b.row) || (a.col - b.col))
    return cells
  })
}

const normalizeTableColwidths = (colwidths: unknown): (number | null)[] => {
  if (!Array.isArray(colwidths)) return []

  return colwidths.map((rawWidth) => {
    if (rawWidth == null) return null
    const width = Number(rawWidth)
    if (!Number.isFinite(width) || width <= 0) return null
    return Math.max(1, Math.round(width))
  })
}

const normalizeColumnWidthsToTarget = (
  widths: (number | null)[],
  targetWidth = TABLE_TARGET_WIDTH,
  minWidth = 40
): number[] => {
  if (widths.length === 0) return []
  const effectiveMinWidth = Math.min(minWidth, Math.max(8, Math.floor(targetWidth / Math.max(1, widths.length))))

  if (widths.length === 1) {
    const onlyWidth = widths[0]
    if (onlyWidth == null) return [targetWidth]
    return [Math.max(effectiveMinWidth, targetWidth)]
  }

  const lastIndex = widths.length - 1
  const numericWidths = widths.map((width) => {
    if (width == null || width <= 0) return effectiveMinWidth
    return Math.max(effectiveMinWidth, Math.round(width))
  })
  const totalWidth = numericWidths.reduce((sum, width) => sum + width, 0)
  if (totalWidth <= 0) {
    return widths.map(() => effectiveMinWidth)
  }

  const normalized: number[] = []
  let allocated = 0

  for (let index = 0; index < lastIndex; index++) {
    const sourceWidth = numericWidths[index]!
    const width = Math.max(effectiveMinWidth, Math.round(sourceWidth * targetWidth / totalWidth))
    normalized.push(width)
    allocated += width
  }

  while (allocated > targetWidth - effectiveMinWidth) {
    const widestIndex = normalized.reduce(
      (bestIndex, width, index, arr) => (width > arr[bestIndex]! ? index : bestIndex),
      0
    )
    const nextWidth = normalized[widestIndex]! - 1
    if (nextWidth < effectiveMinWidth) break
    normalized[widestIndex] = nextWidth
    allocated -= 1
  }

  const lastWidth = Math.max(effectiveMinWidth, targetWidth - allocated)
  return [...normalized, lastWidth]
}

const buildColumnWidthsFromDashCounts = (
  dashCounts: number[],
  tableWidth: number,
  minWidth = 40
): number[] => {
  const totalDashes = dashCounts.reduce((sum, count) => sum + count, 0)
  if (totalDashes <= 0) return []
  const effectiveMinWidth = Math.min(minWidth, Math.max(8, Math.floor(tableWidth / Math.max(1, dashCounts.length))))

  const widths: number[] = []
  let allocated = 0
  for (let index = 0; index < dashCounts.length; index++) {
    if (index === dashCounts.length - 1) {
      widths.push(Math.max(effectiveMinWidth, tableWidth - allocated))
    } else {
      const width = Math.max(effectiveMinWidth, Math.round((dashCounts[index]! / totalDashes) * tableWidth))
      widths.push(width)
      allocated += width
    }
  }
  return widths
}

const normalizeMeasuredWidthsToTarget = (
  measuredWidths: number[],
  targetWidth = TABLE_TARGET_WIDTH,
  minWidth = 40
) => {
  if (measuredWidths.length === 0) return []
  const effectiveMinWidth = Math.min(minWidth, Math.max(8, Math.floor(targetWidth / Math.max(1, measuredWidths.length))))
  if (measuredWidths.length === 1) return [Math.max(effectiveMinWidth, targetWidth)]

  const normalized = measuredWidths.map(width => Math.max(effectiveMinWidth, Math.round(width)))
  const lastIndex = normalized.length - 1
  let allocated = normalized.slice(0, lastIndex).reduce((sum, width) => sum + width, 0)
  let remaining = targetWidth - allocated

  if (remaining < effectiveMinWidth) {
    let deficit = effectiveMinWidth - remaining
    for (let index = lastIndex - 1; index >= 0 && deficit > 0; index -= 1) {
      const shrinkable = Math.max(0, normalized[index]! - effectiveMinWidth)
      if (shrinkable <= 0) continue
      const delta = Math.min(shrinkable, deficit)
      normalized[index] = normalized[index]! - delta
      deficit -= delta
      allocated -= delta
    }
    remaining = targetWidth - allocated
  }

  normalized[lastIndex] = Math.max(effectiveMinWidth, remaining)
  return normalized
}

const shouldPreferDashFallback = (
  explicitWidths: (number | null)[],
  dashWidths: (number | null)[],
  targetWidth = TABLE_TARGET_WIDTH
) => {
  if (explicitWidths.length !== dashWidths.length || explicitWidths.length < 2) return false

  let totalDiff = 0
  for (let index = 0; index < explicitWidths.length - 1; index++) {
    const explicitWidth = explicitWidths[index] ?? 0
    const dashWidth = dashWidths[index] ?? 0
    const diff = Math.abs(explicitWidth - dashWidth)
    totalDiff += diff
    if (diff > Math.max(120, Math.round(targetWidth * 0.18))) return true
  }

  return totalDiff > Math.round(targetWidth * 0.25)
}

const normalizeTableAlignments = (alignments: unknown, fallbackLength: number): string[] => {
  const safeAlign = (value: unknown) => {
    if (value === 'center' || value === 'right') return value
    return 'left'
  }

  if (!Array.isArray(alignments)) {
    return Array.from({ length: fallbackLength }, () => 'left')
  }

  const normalized = alignments.map(safeAlign)
  while (normalized.length < fallbackLength) normalized.push('left')
  return normalized
}

const normalizeTableLayoutMetaTables = (tables: unknown): TableLayoutMeta[] => {
  if (!Array.isArray(tables)) return []

  return tables.map((table) => {
    if (Array.isArray(table)) {
      return {
        merges: normalizeTableMergeMetaTables([table])[0] || [],
        colwidths: [],
        alignments: []
      }
    }

    if (!table || typeof table !== 'object') {
      return {
        merges: [],
        colwidths: [],
        alignments: []
      }
    }

    const raw = table as {
      merges?: unknown
      colwidths?: unknown
      alignments?: unknown
    }
    const colwidths = normalizeTableColwidths(raw.colwidths)

    return {
      merges: normalizeTableMergeMetaTables([raw.merges])[0] || [],
      colwidths,
      alignments: normalizeTableAlignments(raw.alignments, colwidths.length)
    }
  })
}

export const parseTableMergeMetaFromMarkdown = (md: string) => {
  let layouts: TableLayoutMeta[] = []

  const cleanMarkdown = md.replace(TABLE_MERGE_META_RE, (_full, rawPayload: string) => {
    try {
      const decoded = decodeURIComponent(rawPayload.trim())
      const parsed = JSON.parse(decoded) as { v?: unknown, tables?: unknown } | unknown
      const candidate = (
        parsed
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
        && 'tables' in parsed
      )
        ? (parsed as { tables?: unknown }).tables
        : parsed
      layouts = normalizeTableLayoutMetaTables(candidate)
    } catch {
      // 非法元数据忽略
    }
    return ''
  }).trimEnd()

  return {
    cleanMarkdown,
    tables: layouts.map(layout => layout.merges),
    layouts
  }
}

export const collectTableMergeMetaFromDoc = (view: EditorView) => {
  const tables: TableMergeCellMeta[][] = []

  view.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return false

    const map = TableMap.get(node)
    const seen = new Set<number>()
    const cells: TableMergeCellMeta[] = []

    for (const relativeCellPos of map.map) {
      if (seen.has(relativeCellPos)) continue
      seen.add(relativeCellPos)

      const rect = map.findCell(relativeCellPos)
      const rowspan = rect.bottom - rect.top
      const colspan = rect.right - rect.left
      if (rowspan <= 1 && colspan <= 1) continue

      cells.push({
        row: rect.top,
        col: rect.left,
        rowspan,
        colspan
      })
    }

    cells.sort((a, b) => ((b.rowspan * b.colspan) - (a.rowspan * a.colspan)) || (a.row - b.row) || (a.col - b.col))
    tables.push(cells)
    return false
  })

  return tables
}

export const collectTableLayoutMetaFromDoc = (view: EditorView): TableLayoutMeta[] => {
  const mergeTables = collectTableMergeMetaFromDoc(view)
  const layouts: TableLayoutMeta[] = []
  let tableIndex = 0

  view.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return false

    const headerRow = node.firstChild
    const colwidths: (number | null)[] = []
    const alignments: string[] = []

    if (headerRow) {
      headerRow.forEach((cell) => {
        colwidths.push(cell.attrs.colwidth?.[0] ?? null)
        alignments.push(cell.attrs.alignment || 'left')
      })
    }

    const normalizedColwidths = normalizeColumnWidthsToTarget(colwidths)

    layouts.push({
      merges: mergeTables[tableIndex] || [],
      colwidths: normalizedColwidths,
      alignments
    })
    tableIndex++
    return false
  })

  return layouts
}

const cloneTableWithoutMerges = (tableNode: ProsemirrorNode): ProsemirrorNode => {
  const schema = tableNode.type.schema
  const paragraphType = schema.nodes.paragraph
  const tableCellType = schema.nodes.table_cell
  const tableHeaderType = schema.nodes.table_header
  const hardbreakType = schema.nodes.hardbreak
  if (!paragraphType || !tableCellType) return tableNode

  const flattenCellContent = (cellNode: ProsemirrorNode): ProsemirrorNode => {
    const paragraphCount = (() => {
      let n = 0
      cellNode.content.forEach((c) => {
        if (c.type === paragraphType) n++
      })
      return n
    })()

    const hasHardbreak = (() => {
      let found = false
      if (!hardbreakType) return false
      cellNode.descendants((n) => {
        if (found) return false
        if (n.type === hardbreakType) {
          found = true
          return false
        }
        return true
      })
      return found
    })()

    if (paragraphCount <= 1 && !hasHardbreak) return cellNode

    const inline: ProsemirrorNode[] = []
    let first = true
    cellNode.content.forEach((child) => {
      if (child.type !== paragraphType) {
        inline.push(child)
        return
      }
      if (child.childCount === 0) return
      if (!first) {
        try {
          inline.push(schema.text(' '))
        } catch { /* ignore */ }
      }
      child.content.forEach((node) => {
        if (hardbreakType && node.type === hardbreakType) {
          try {
            inline.push(schema.text(' '))
          } catch { /* ignore */ }
          return
        }
        inline.push(node)
      })
      first = false
    })

    try {
      const combined = inline.length > 0 ? paragraphType.create(null, inline) : paragraphType.create()
      return cellNode.type.create(cellNode.attrs, combined)
    } catch {
      return cellNode
    }
  }

  const map = TableMap.get(tableNode)
  const rowNodes: ProsemirrorNode[] = []

  for (let row = 0; row < map.height; row++) {
    const rowNode = tableNode.child(row)
    const isHeaderRow = rowNode.type.name === 'table_header_row'
    const cellTypeForRow = isHeaderRow && tableHeaderType ? tableHeaderType : tableCellType
    const cells: ProsemirrorNode[] = []

    for (let col = 0; col < map.width; col++) {
      const relativePos = map.map[row * map.width + col]
      if (relativePos === undefined) continue
      const rect = map.findCell(relativePos)
      const cellNode = tableNode.nodeAt(relativePos)
      if (!cellNode) continue

      const isPrimary = rect.top === row && rect.left === col
      if (isPrimary) {
        const flattened = flattenCellContent(cellNode)
        const clonedAttrs = {
          ...flattened.attrs,
          colspan: 1,
          rowspan: 1,
          colwidth: null
        }
        try {
          cells.push(flattened.type.create(clonedAttrs, flattened.content))
        } catch {
          cells.push(flattened)
        }
      } else {
        const placeholderAttrs = {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          alignment: cellNode.attrs?.alignment || 'left'
        }
        try {
          const emptyPara = paragraphType.create()
          cells.push(cellTypeForRow.create(placeholderAttrs, emptyPara))
        } catch {
          // 忽略
        }
      }
    }

    try {
      rowNodes.push(rowNode.type.create(rowNode.attrs, cells))
    } catch {
      rowNodes.push(rowNode)
    }
  }

  try {
    return tableNode.type.create(tableNode.attrs, rowNodes)
  } catch {
    return tableNode
  }
}

const splitTableMergesInDoc = (doc: ProsemirrorNode): ProsemirrorNode => {
  const rewrite = (node: ProsemirrorNode): ProsemirrorNode => {
    if (node.type.name === 'table') return cloneTableWithoutMerges(node)
    if (node.childCount === 0) return node

    const newChildren: ProsemirrorNode[] = []
    let changed = false
    node.content.forEach((child) => {
      const rewritten = rewrite(child)
      if (rewritten !== child) changed = true
      newChildren.push(rewritten)
    })
    if (!changed) return node
    try {
      return node.type.create(node.attrs, newChildren, node.marks)
    } catch {
      return node
    }
  }
  return rewrite(doc)
}

const serializeDocSplittingMerges = (crepe: Crepe, view: EditorView): string | null => {
  try {
    const serializer = crepe.editor.ctx.get(serializerCtx)
    const clonedDoc = splitTableMergesInDoc(view.state.doc)
    return serializer(clonedDoc)
  } catch (e) {
    console.warn('[TableMerge] 序列化克隆 doc 失败，回退到默认 markdown', e)
    return null
  }
}

export const encodeTableMergeInMarkdown = ({
  markdown,
  view,
  crepe,
  fullSerialize = false,
  encodeColwidth
}: {
  markdown: string
  view: EditorView
  crepe: Crepe
  fullSerialize?: boolean
  encodeColwidth: (markdown: string) => string
}): string => {
  const { cleanMarkdown: parsedClean } = parseTableMergeMetaFromMarkdown(markdown)
  const tableLayouts = collectTableLayoutMetaFromDoc(view)
  const hasLayoutMeta = tableLayouts.some(table =>
    table.merges.length > 0
    || table.colwidths.some(width => width !== null && width > 0)
  )
  if (!hasLayoutMeta) return parsedClean

  let cleanMarkdown = parsedClean
  if (fullSerialize) {
    const reSerialized = serializeDocSplittingMerges(crepe, view)
    if (reSerialized) {
      cleanMarkdown = encodeColwidth(reSerialized)
    }
  }

  const payload = encodeURIComponent(JSON.stringify({
    v: 2,
    tables: tableLayouts
  }))

  if (!cleanMarkdown) return `<!-- HZY_TABLE_MERGE:${payload} -->`
  return `${cleanMarkdown}\n\n<!-- HZY_TABLE_MERGE:${payload} -->`
}

export const getTableByIndex = (doc: ProsemirrorNode, tableIndex: number): { node: ProsemirrorNode, pos: number } | null => {
  let currentIndex = -1
  let found: { node: ProsemirrorNode, pos: number } | null = null

  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name !== 'table') return true

    currentIndex++
    if (currentIndex === tableIndex) {
      found = { node, pos }
      return false
    }
    return false
  })

  return found
}

export const getTableElementForPos = (view: EditorView, tablePos: number): HTMLTableElement | null => {
  try {
    const domAtPos = view.domAtPos(tablePos + 1)
    let dom: Node | null = domAtPos.node
    while (dom && (dom as Element).nodeName !== 'TABLE') dom = dom.parentNode
    return dom as HTMLTableElement | null
  } catch {
    return null
  }
}

export const getTableRenderWidth = ({
  view,
  tablePos,
  editorRoot
}: {
  view: EditorView
  tablePos: number
  editorRoot: HTMLElement | null
}): number | null => {
  const tableEl = getTableElementForPos(view, tablePos)
  if (!tableEl) return null

  const wrapper = tableEl.closest('.tableWrapper, .table-wrapper') as HTMLElement | null
  const prose = (editorRoot?.querySelector('.ProseMirror') || view.dom) as HTMLElement | null
  const fallbackWidth = wrapper?.clientWidth
    || tableEl.parentElement?.clientWidth
    || prose?.clientWidth
    || 0

  const measuredWidth = tableEl.offsetWidth > 0 ? tableEl.offsetWidth : 0
  const width = Math.max(measuredWidth, fallbackWidth)

  return width > 0 ? Math.round(width) : null
}

const applyColumnWidthsToTable = ({
  tr,
  node,
  pos,
  widths
}: {
  tr: EditorView['state']['tr']
  node: ProsemirrorNode
  pos: number
  widths: (number | null)[]
}) => {
  let changed = false

  node.forEach((row, rowOffset) => {
    let colIdx = 0
    row.forEach((cell, cellOffset) => {
      if (colIdx < widths.length) {
        const targetW = widths[colIdx]
        const cellPos = pos + 1 + rowOffset + 1 + cellOffset
        const currWidth = cell.attrs.colwidth?.[0] ?? null
        const targetAttr = targetW == null ? null : [targetW]
        if (currWidth !== (targetW ?? null)) {
          tr.setNodeMarkup(cellPos, null, { ...cell.attrs, colwidth: targetAttr })
          changed = true
        }
      }
      colIdx++
    })
  })

  return changed
}

export const encodeColwidthInMarkdown = ({
  markdown,
  view
}: {
  markdown: string
  view: EditorView
}): string => {
  const tables: { colwidths: (number | null)[], alignments: string[] }[] = []

  view.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return
    const headerRow = node.firstChild
    if (!headerRow) return
    const colwidths: (number | null)[] = []
    const alignments: string[] = []
    headerRow.forEach((cell) => {
      colwidths.push(cell.attrs.colwidth?.[0] ?? null)
      alignments.push(cell.attrs.alignment || 'left')
    })

    tables.push({
      colwidths: normalizeColumnWidthsToTarget(colwidths),
      alignments
    })
  })

  if (tables.length === 0) return markdown

  const lines = markdown.split('\n')
  let tableIdx = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[i]!)) continue
    if (tableIdx >= tables.length) break

    const { colwidths, alignments } = tables[tableIdx]!
    tableIdx++

    if (!colwidths.some(w => w !== null && w > 0)) continue

    const defaultWidth = 40
    const totalWidth = colwidths.reduce((sum: number, w) => sum + (w || defaultWidth), 0)
    const maxDashes = 120

    const separators = colwidths.map((w, j) => {
      const proportion = (w || defaultWidth) / totalWidth
      const dashCount = Math.max(3, Math.round(proportion * maxDashes))
      const dashes = '-'.repeat(dashCount)
      const align = alignments[j] || 'left'
      if (align === 'center') return ` :${dashes}: `
      if (align === 'right') return ` ${dashes}: `
      return ` :${dashes} `
    })

    lines[i] = `|${separators.join('|')}|`
  }

  return lines.join('\n')
}

export const rescaleTableColwidthsToContainer = (view: EditorView) => {
  const tr = view.state.tr
  let changed = false

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return
    const headerRow = node.firstChild
    if (!headerRow) return

    const MIN_W = 40
    let hasExplicit = false
    headerRow.forEach((cell) => {
      const w = cell.attrs.colwidth?.[0]
      if (w && w > 0) {
        hasExplicit = true
      }
    })
    if (!hasExplicit) return false

    const tableEl = getTableElementForPos(view, pos)
    if (!tableEl) return false

    const colEls = Array.from(tableEl.querySelectorAll(':scope > colgroup > col')) as HTMLElement[]
    if (colEls.length < 2) return false

    const measuredWidths = colEls.map(col => Math.round(col.getBoundingClientRect().width))
    if (measuredWidths.some(w => w <= 0)) return false

    const currentSum = measuredWidths.reduce((a, b) => a + b, 0)
    if (currentSum <= 0) return false

    const targetWidth = TABLE_TARGET_WIDTH
    if (targetWidth <= 0) return false
    if (Math.abs(currentSum - targetWidth) < 2) return false

    const newWidths = normalizeMeasuredWidthsToTarget(measuredWidths, targetWidth, MIN_W)
    // 不再对"极端分布"做内容等宽回退——那会让用户主动拉出的窄/宽列被抹平为等宽。
    if (newWidths.length !== measuredWidths.length) return false

    node.forEach((row, rowOffset) => {
      let colIdx = 0
      row.forEach((cell, cellOffset) => {
        const cellPos = pos + 1 + rowOffset + 1 + cellOffset
        if (colIdx < newWidths.length) {
          const w = newWidths[colIdx]!
          if (!cell.attrs.colwidth || cell.attrs.colwidth[0] !== w) {
            tr.setNodeMarkup(cellPos, null, { ...cell.attrs, colwidth: [w] })
            changed = true
          }
        }
        colIdx++
      })
    })
    return false
  })

  if (changed) {
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  }
}

export const applyColwidthFromMarkdown = ({
  markdown,
  getView,
  getEditorRoot: _getEditorRoot,
  runLater: _runLater,
  attempt: _attempt = 0
}: {
  markdown: string
  getView: () => EditorView | null
  getEditorRoot: () => HTMLElement | null
  runLater: (handler: () => void, delay: number) => void
  attempt?: number
}) => {
  const { cleanMarkdown, layouts } = parseTableMergeMetaFromMarkdown(markdown)
  const lines = cleanMarkdown.split('\n')
  const dashCountsByTable: number[][] = []
  for (const line of lines) {
    if (!/^\|(\s*:?-+:?\s*\|)+\s*$/.test(line)) continue
    const cells = line.split('|').slice(1, -1)
    const counts = cells.map(cell => (cell.match(/-/g) || []).length)
    // dashes 是唯一比例信号，即使各列差距很小也据实应用（等值 dashes 就渲染等宽）。
    // 之前以 max-min<=1 时丢弃 counts，会在协同编辑轻微抖动时退化为等宽回退路径。
    dashCountsByTable.push(counts)
  }

  const view = getView()
  if (!view) return

  const tr = view.state.tr
  let tableIdx = 0
  let changed = false

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return
    if (tableIdx >= dashCountsByTable.length) return

    const dashCounts = dashCountsByTable[tableIdx]!
    const explicitColwidths = layouts[tableIdx]?.colwidths || []
    tableIdx++

    // 列宽恢复统一以固定目标宽度为基准，避免把当前异常渲染宽度（例如 1237px）再写回节点。
    const tableWidth = TABLE_TARGET_WIDTH

    const headerRow = node.firstChild
    // 以显式 colwidth 元数据优先；dashes 次之；再其次对既有部分 colwidth 做等比缩放。
    // 这里不再按"内容长度"回退，避免协同编辑时因数据抖动退化为等宽。
    if (headerRow && explicitColwidths.length === headerRow.childCount && explicitColwidths.some(width => width !== null && width > 0)) {
      const normalizedWidths = normalizeColumnWidthsToTarget(explicitColwidths)
      const dashWidths = dashCounts.length === headerRow.childCount
        ? buildColumnWidthsFromDashCounts(dashCounts, tableWidth)
        : []
      const widthsToApply = (
        dashWidths.length === normalizedWidths.length
        && shouldPreferDashFallback(normalizedWidths, dashWidths)
      )
        ? dashWidths
        : normalizedWidths

      if (applyColumnWidthsToTable({
        tr,
        node,
        pos,
        widths: widthsToApply
      })) {
        changed = true
      }
      return false
    }

    if (headerRow && dashCounts.length === 0) {
      const existingFirstWidths: number[] = []
      let hasAnyColwidth = false
      headerRow.forEach((cell, _, i) => {
        const w = cell.attrs.colwidth?.[0]
        if (w && w > 0) hasAnyColwidth = true
        if (i < (headerRow.childCount - 1)) {
          existingFirstWidths.push(w && w > 0 ? w : 0)
        }
      })

      if (hasAnyColwidth) {
        const existingFirstSum = existingFirstWidths.reduce((s, w) => s + w, 0)
        if (existingFirstSum >= tableWidth * 0.6) {
          return false
        }

        const avgFirst = existingFirstSum / Math.max(1, existingFirstWidths.length)
        const naturalTotal = existingFirstSum + avgFirst
        if (naturalTotal <= 0) return false
        const scale = tableWidth / naturalTotal
        const MIN_W = 40
        const rescaled: (number | null)[] = existingFirstWidths.map(w =>
          Math.max(MIN_W, Math.round(w * scale))
        )
        rescaled.push(null)

        if (applyColumnWidthsToTable({
          tr,
          node,
          pos,
          widths: rescaled
        })) {
          changed = true
        }
        return false
      }
    }

    if (dashCounts.length === 0) return false

    const columnWidths = buildColumnWidthsFromDashCounts(dashCounts, tableWidth)
    if (columnWidths.length === 0) return false

    if (applyColumnWidthsToTable({
      tr,
      node,
      pos,
      widths: columnWidths
    })) {
      changed = true
    }
  })

  if (changed) {
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  }
}
