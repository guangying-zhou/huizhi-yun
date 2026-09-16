import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { Node as ProsemirrorNode } from '@milkdown/prose/model'
import type { EditorView, ViewMutationRecord } from '@milkdown/prose/view'
import { TableMap, TableView, columnResizingPluginKey } from '@milkdown/prose/tables'
import { TABLE_TARGET_WIDTH, getTableElementForPos } from './editorTableCodec'

interface CreateEnsureTableColgroupPluginOptions {
  tableCellMinWidth: number
  getEditorView: () => EditorView | null
  getIsEditorDestroying: () => boolean
  getIsEditorCreated: () => boolean
  getIsTableColumnResizing: () => boolean
  setIsTableColumnResizing: (value: boolean) => void
  lockTableLayoutRescale: (duration?: number) => void
  runLater: (handler: () => void, delay: number) => number | null
  cancelLater: (timerId: number | null) => void
}

interface DragCompensationSnapshot {
  tablePos: number
  leftColumn: number
  baseWidths: number[]
  startX: number
  startWidth: number
  latestClientX: number
}

export class StableEditorTableView extends TableView {
  override ignoreMutation(record: ViewMutationRecord): boolean {
    if (record.type === 'attributes') {
      return record.target === this.table || this.colgroup.contains(record.target)
    }

    if (record.type === 'childList') {
      return record.target === this.table || record.target === this.colgroup
    }

    return false
  }
}

export const createEnsureTableColgroupPlugin = ({
  tableCellMinWidth,
  getEditorView,
  getIsEditorDestroying,
  getIsEditorCreated,
  getIsTableColumnResizing,
  setIsTableColumnResizing,
  lockTableLayoutRescale,
  runLater,
  cancelLater
}: CreateEnsureTableColgroupPluginOptions) => new Plugin({
  key: new PluginKey('ensureTableColgroup'),
  view(editorView) {
    const getEffectiveMinWidth = (columnCount: number) => (
      Math.max(8, Math.min(tableCellMinWidth, Math.floor(TABLE_TARGET_WIDTH / Math.max(1, columnCount))))
    )

    const readMeasuredWidthsFromDom = (view: EditorView, tablePos: number) => {
      const tableEl = getTableElementForPos(view, tablePos)
      if (!tableEl) return null

      const colEls = Array.from(tableEl.querySelectorAll(':scope > colgroup > col')) as HTMLElement[]
      if (colEls.length < 2) return null

      const measured = colEls.map(col => Math.round(col.getBoundingClientRect().width))
      if (measured.some(width => width <= 0)) return null
      return measured
    }

    const setMeasuredWidthsToTable = (tr: EditorView['state']['tr'], node: ProsemirrorNode, pos: number, measured: number[]) => {
      let changed = false

      node.forEach((row, rowOffset) => {
        let columnIndex = 0
        row.forEach((cell, cellOffset) => {
          const span = Math.max(1, Number(cell.attrs.colspan) || 1)
          const cellPos = pos + 1 + rowOffset + 1 + cellOffset

          const targetColwidth = Array.from({ length: span }, (_, spanOffset) => {
            const source = measured[columnIndex + spanOffset] ?? measured[measured.length - 1]
            if (!source || source <= 0) return getEffectiveMinWidth(measured.length)
            return Math.max(1, Math.round(source))
          })

          const currColwidth = Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth : null
          const isSame = Boolean(
            currColwidth
            && currColwidth.length === targetColwidth.length
            && currColwidth.every((value, idx) => value === targetColwidth[idx])
          )

          if (!isSame) {
            tr.setNodeMarkup(cellPos, null, { ...cell.attrs, colwidth: targetColwidth })
            changed = true
          }

          columnIndex += span
        })
      })

      return changed
    }

    const getDragHandleContext = (view: EditorView, handlePos: number): { tablePos: number, leftColumn: number } | null => {
      try {
        const $cell = view.state.doc.resolve(handlePos)
        if (!$cell.nodeAfter) return null

        const tableNode = $cell.node(-1)
        if (tableNode.type.name !== 'table') return null

        const tableStart = $cell.start(-1)
        const tablePos = tableStart - 1
        const map = TableMap.get(tableNode)
        const colspan = Math.max(1, Number($cell.nodeAfter.attrs.colspan) || 1)
        const leftColumn = map.colCount($cell.pos - tableStart) + colspan - 1

        if (leftColumn < 0 || leftColumn >= map.width - 1) return null
        return { tablePos, leftColumn }
      } catch {
        return null
      }
    }

    const getDomTableAndCols = (view: EditorView, tablePos: number) => {
      const tableEl = getTableElementForPos(view, tablePos)
      if (!tableEl) return null
      const colEls = Array.from(tableEl.querySelectorAll(':scope > colgroup > col')) as HTMLElement[]
      if (colEls.length < 2) return null
      return { tableEl, colEls }
    }

    const normalizeWidthsToTarget = (widths: number[]) => {
      if (widths.length === 0) return []
      const minWidth = getEffectiveMinWidth(widths.length)
      if (widths.length === 1) return [TABLE_TARGET_WIDTH]

      const normalized = widths.map(width => Math.max(minWidth, Math.round(width || minWidth)))
      const total = normalized.reduce((sum, width) => sum + width, 0)
      if (total <= 0) return normalized

      const scaled: number[] = []
      const lastIndex = normalized.length - 1
      let allocated = 0
      for (let index = 0; index < lastIndex; index++) {
        const width = Math.max(minWidth, Math.round(normalized[index]! * TABLE_TARGET_WIDTH / total))
        scaled.push(width)
        allocated += width
      }

      while (allocated > TABLE_TARGET_WIDTH - minWidth) {
        const widestIndex = scaled.reduce(
          (bestIndex, width, index, arr) => (width > arr[bestIndex]! ? index : bestIndex),
          0
        )
        const nextWidth = scaled[widestIndex]! - 1
        if (nextWidth < minWidth) break
        scaled[widestIndex] = nextWidth
        allocated -= 1
      }

      scaled.push(Math.max(minWidth, TABLE_TARGET_WIDTH - allocated))
      return scaled
    }

    const getNodeColumnWidths = (tableNode: ProsemirrorNode) => {
      const headerRow = tableNode.firstChild
      if (!headerRow) return []

      const widths: number[] = []
      headerRow.forEach((cell) => {
        const span = Math.max(1, Number(cell.attrs.colspan) || 1)
        const colwidth = Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth : null
        for (let index = 0; index < span; index++) {
          const raw = Number(colwidth?.[index])
          widths.push(Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0)
        }
      })
      return widths
    }

    const buildAdjacentCompensatedWidths = (baseWidths: number[], leftColumn: number, desiredLeftWidth: number) => {
      const rightColumn = leftColumn + 1
      if (leftColumn < 0 || rightColumn >= baseWidths.length || baseWidths.length < 2) return null

      const lockedSum = baseWidths.reduce((sum, width, idx) => {
        if (idx === leftColumn || idx === rightColumn) return sum
        return sum + width
      }, 0)

      const available = TABLE_TARGET_WIDTH - lockedSum
      if (available <= 16) return null

      let minWidth = getEffectiveMinWidth(baseWidths.length)
      if (available < minWidth * 2) {
        minWidth = Math.max(8, Math.floor(available / 2))
      }

      const preferredLeft = Number.isFinite(desiredLeftWidth) && desiredLeftWidth > 0
        ? Math.round(desiredLeftWidth)
        : baseWidths[leftColumn]!
      let nextLeft = Math.max(minWidth, Math.min(preferredLeft, available - minWidth))
      let nextRight = available - nextLeft

      if (nextRight < minWidth) {
        nextRight = minWidth
        nextLeft = available - nextRight
      }
      if (nextLeft < minWidth) {
        nextLeft = minWidth
        nextRight = available - nextLeft
      }
      if (nextLeft <= 0 || nextRight <= 0) return null

      const normalized = baseWidths.slice()
      normalized[leftColumn] = nextLeft
      normalized[rightColumn] = nextRight
      return normalized
    }

    const buildDragCompensationSnapshot = (view: EditorView, handlePos: number): DragCompensationSnapshot | null => {
      const context = getDragHandleContext(view, handlePos)
      if (!context) return null

      const tableNode = view.state.doc.nodeAt(context.tablePos)
      if (!tableNode || tableNode.type.name !== 'table') return null

      const resizeState = columnResizingPluginKey.getState(view.state)
      const dragging = resizeState?.dragging
      if (!dragging) return null

      const measured = readMeasuredWidthsFromDom(view, context.tablePos)
      const nodeWidths = getNodeColumnWidths(tableNode)
      const columnCount = Math.max(nodeWidths.length, measured?.length ?? 0)
      if (columnCount < 2) return null
      if (context.leftColumn < 0 || context.leftColumn >= columnCount - 1) return null

      const source = Array.from({ length: columnCount }, (_, index) => {
        const measuredWidth = measured?.[index] ?? 0
        if (measuredWidth > 0) return measuredWidth
        const nodeWidth = nodeWidths[index] ?? 0
        if (nodeWidth > 0) return nodeWidth
        return getEffectiveMinWidth(columnCount)
      })

      const normalizedBaseWidths = normalizeWidthsToTarget(source)
      const adjustedBaseWidths = buildAdjacentCompensatedWidths(
        normalizedBaseWidths,
        context.leftColumn,
        dragging.startWidth
      )
      if (!adjustedBaseWidths) return null
      const startX = Math.round(dragging.startX)
      const startWidth = adjustedBaseWidths[context.leftColumn]!

      return {
        tablePos: context.tablePos,
        leftColumn: context.leftColumn,
        baseWidths: adjustedBaseWidths,
        startX,
        startWidth,
        latestClientX: startX
      }
    }

    let dragSnapshot: DragCompensationSnapshot | null = null
    const getDragCompensationSnapshot = (view: EditorView, handlePos: number) => {
      const context = getDragHandleContext(view, handlePos)
      if (!context) return null

      if (
        dragSnapshot
        && dragSnapshot.tablePos === context.tablePos
        && dragSnapshot.leftColumn === context.leftColumn
      ) {
        return dragSnapshot
      }

      dragSnapshot = buildDragCompensationSnapshot(view, handlePos)
      return dragSnapshot
    }

    const applyLiveDomCompensation = (view: EditorView, handlePos: number) => {
      const snapshot = getDragCompensationSnapshot(view, handlePos)
      if (!snapshot) return

      const dom = getDomTableAndCols(view, snapshot.tablePos)
      if (!dom) return
      if (dom.colEls.length !== snapshot.baseWidths.length) return

      const deltaX = snapshot.latestClientX - snapshot.startX
      const desiredLeft = snapshot.startWidth + deltaX
      const compensated = buildAdjacentCompensatedWidths(snapshot.baseWidths, snapshot.leftColumn, desiredLeft)
      if (!compensated || compensated.length !== dom.colEls.length) return

      dom.colEls.forEach((col, index) => {
        col.style.width = `${compensated[index]}px`
      })
      dom.tableEl.style.width = `${TABLE_TARGET_WIDTH}px`
      dom.tableEl.style.minWidth = ''
    }

    const settleDraggedAdjacentColumns = (view: EditorView, handlePos: number) => {
      const snapshot = getDragCompensationSnapshot(view, handlePos)
      if (!snapshot) return false

      const deltaX = snapshot.latestClientX - snapshot.startX
      const desiredLeft = snapshot.startWidth + deltaX
      const compensated = buildAdjacentCompensatedWidths(snapshot.baseWidths, snapshot.leftColumn, desiredLeft)
      if (!compensated) return false

      const tableNode = view.state.doc.nodeAt(snapshot.tablePos)
      if (!tableNode || tableNode.type.name !== 'table') return false

      const tr = view.state.tr
      const changed = setMeasuredWidthsToTable(tr, tableNode, snapshot.tablePos, compensated)
      if (changed) {
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
      }
      return changed
    }

    const handleResizeMouseMove = (event: MouseEvent) => {
      const resizeState = columnResizingPluginKey.getState(editorView.state)
      if (!resizeState?.dragging) return
      const handle = resizeState.activeHandle ?? -1
      if (handle < 0) return
      if (dragSnapshot) {
        dragSnapshot.latestClientX = Math.round(event.clientX)
      }
      applyLiveDomCompensation(editorView, handle)
    }

    const handleResizePointerMove = (event: PointerEvent) => {
      const resizeState = columnResizingPluginKey.getState(editorView.state)
      if (!resizeState?.dragging) return
      if (dragSnapshot) {
        dragSnapshot.latestClientX = Math.round(event.clientX)
      }
    }

    let liveCompensationRaf: number | null = null
    let globalDragMoveListenersBound = false

    const bindGlobalDragMoveListeners = () => {
      if (typeof window === 'undefined' || globalDragMoveListenersBound) return
      window.addEventListener('mousemove', handleResizeMouseMove, true)
      window.addEventListener('pointermove', handleResizePointerMove, true)
      globalDragMoveListenersBound = true
    }

    const unbindGlobalDragMoveListeners = () => {
      if (typeof window === 'undefined' || !globalDragMoveListenersBound) return
      window.removeEventListener('mousemove', handleResizeMouseMove, true)
      window.removeEventListener('pointermove', handleResizePointerMove, true)
      globalDragMoveListenersBound = false
    }

    const cancelLiveCompensationLoop = () => {
      if (typeof window === 'undefined') return
      if (liveCompensationRaf === null) return
      window.cancelAnimationFrame(liveCompensationRaf)
      liveCompensationRaf = null
    }

    const ensureLiveCompensationLoop = () => {
      if (typeof window === 'undefined') return
      if (liveCompensationRaf !== null) return

      const tick = () => {
        liveCompensationRaf = null
        const safeView = getEditorView()
        if (!safeView || getIsEditorDestroying() || !getIsEditorCreated()) return

        const resizeState = columnResizingPluginKey.getState(safeView.state)
        const isDragging = Boolean(resizeState?.dragging)
        const handle = resizeState?.activeHandle ?? -1
        if (!isDragging || handle < 0) return

        applyLiveDomCompensation(safeView, handle)
        liveCompensationRaf = window.requestAnimationFrame(tick)
      }

      liveCompensationRaf = window.requestAnimationFrame(tick)
    }

    editorView.dom.addEventListener('mousemove', handleResizeMouseMove, true)
    editorView.dom.addEventListener('pointermove', handleResizePointerMove, true)

    let postUpdateTimer: number | null = null
    let pendingPostUpdate = {
      settleHandle: -1,
      finishResize: false
    }

    const schedulePostUpdateMaintenance = (flags: { settleHandle?: number, finishResize?: boolean }) => {
      pendingPostUpdate = {
        settleHandle: typeof flags.settleHandle === 'number' ? flags.settleHandle : pendingPostUpdate.settleHandle,
        finishResize: pendingPostUpdate.finishResize || Boolean(flags.finishResize)
      }
      if (postUpdateTimer !== null) return

      postUpdateTimer = runLater(() => {
        postUpdateTimer = null
        const task = pendingPostUpdate
        pendingPostUpdate = { settleHandle: -1, finishResize: false }

        const safeView = getEditorView()
        if (!safeView || getIsEditorDestroying() || !getIsEditorCreated()) {
          if (task.finishResize) {
            dragSnapshot = null
            setIsTableColumnResizing(false)
          }
          return
        }
        if (getIsTableColumnResizing() && !task.finishResize) return

        if (task.settleHandle >= 0) {
          settleDraggedAdjacentColumns(safeView, task.settleHandle)
        }
        if (task.finishResize) {
          dragSnapshot = null
          setIsTableColumnResizing(false)
        }
      }, 0)
    }

    return {
      update(view, prevState) {
        const prevResizeState = columnResizingPluginKey.getState(prevState)
        const currResizeState = columnResizingPluginKey.getState(view.state)
        const isDragging = Boolean(currResizeState?.dragging)
        const wasDragging = Boolean(prevResizeState?.dragging)
        const activeHandle = currResizeState?.activeHandle ?? -1
        const prevActiveHandle = prevResizeState?.activeHandle ?? -1
        const activeHandleForDragEnd = prevActiveHandle >= 0 ? prevActiveHandle : activeHandle

        if (!wasDragging && isDragging) {
          setIsTableColumnResizing(true)
          lockTableLayoutRescale(1200)
          dragSnapshot = activeHandle >= 0 ? buildDragCompensationSnapshot(view, activeHandle) : null
          bindGlobalDragMoveListeners()
          ensureLiveCompensationLoop()
        }

        if (wasDragging && !isDragging) {
          cancelLiveCompensationLoop()
          unbindGlobalDragMoveListeners()
          lockTableLayoutRescale(1200)
          schedulePostUpdateMaintenance({
            settleHandle: activeHandleForDragEnd,
            finishResize: true
          })
        }
      },
      destroy() {
        editorView.dom.removeEventListener('mousemove', handleResizeMouseMove, true)
        editorView.dom.removeEventListener('pointermove', handleResizePointerMove, true)
        cancelLiveCompensationLoop()
        unbindGlobalDragMoveListeners()
        cancelLater(postUpdateTimer)
        postUpdateTimer = null
        dragSnapshot = null
        setIsTableColumnResizing(false)
      }
    }
  }
})
