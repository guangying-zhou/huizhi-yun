import { ref, type Ref } from 'vue'
import { CellSelection } from '@milkdown/prose/tables'
import type { EditorView } from '@milkdown/prose/view'

interface TableQuickActionsState {
  visible: boolean
  rowTop: number
  rowLeft: number
  colTop: number
  colLeft: number
  selectionTop: number
  selectionLeft: number
  selectionVisible: boolean
  toolbarTop: number
  toolbarLeft: number
}

interface UseEditorTableUiOptions {
  editorRef: Ref<HTMLDivElement | null>
  readonly: Ref<boolean>
  viewMode: Ref<'edit' | 'source'>
  isEditorDestroying: Ref<boolean>
  isEditorCreated: Ref<boolean>
  isTableColumnResizing: Ref<boolean>
  getEditorView: () => EditorView | null
  canMergeSelection: () => boolean
  canSplitSelection: () => boolean
}

const defaultTableQuickActionsState = (): TableQuickActionsState => ({
  visible: false,
  rowTop: 0,
  rowLeft: 0,
  colTop: 0,
  colLeft: 0,
  selectionTop: 0,
  selectionLeft: 0,
  selectionVisible: false,
  toolbarTop: 0,
  toolbarLeft: 0
})

export const useEditorTableUi = ({
  editorRef,
  readonly,
  viewMode,
  isEditorDestroying,
  isEditorCreated,
  isTableColumnResizing,
  getEditorView,
  canMergeSelection,
  canSplitSelection
}: UseEditorTableUiOptions) => {
  const tableQuickActions = ref<TableQuickActionsState>(defaultTableQuickActionsState())
  let tableQuickActionCellEl: HTMLTableCellElement | null = null
  let tableQuickActionsCleanup: (() => void) | null = null
  let blockHandlePointerRelayCleanup: (() => void) | null = null

  const hideTableQuickActions = () => {
    tableQuickActions.value.visible = false
    tableQuickActions.value.selectionVisible = false
    tableQuickActionCellEl = null
  }

  const getActiveTableQuickActionCell = () => tableQuickActionCellEl

  const getTableCellElementForPos = (
    view: EditorView,
    pos: number
  ): HTMLTableCellElement | null => {
    try {
      const domAtPos = view.domAtPos(Math.min(pos + 1, view.state.doc.content.size))
      let dom: Node | null = domAtPos.node
      while (dom) {
        if (dom instanceof HTMLTableCellElement) return dom
        dom = dom.parentNode
      }
      return null
    } catch {
      return null
    }
  }

  const updateTableQuickActionsPosition = (cellEl?: HTMLTableCellElement | null) => {
    if (
      readonly.value
      || viewMode.value === 'source'
      || isEditorDestroying.value
      || !isEditorCreated.value
      || isTableColumnResizing.value
    ) {
      hideTableQuickActions()
      return
    }

    const wrapper = editorRef.value?.closest('.crepe-wrapper') as HTMLElement | null
    const view = getEditorView()
    if (!view || !wrapper) {
      hideTableQuickActions()
      return
    }

    const activeCell = cellEl ?? tableQuickActionCellEl
    if (!activeCell || !wrapper.contains(activeCell)) {
      hideTableQuickActions()
      return
    }

    const tableEl = activeCell.closest('table') as HTMLTableElement | null
    if (!tableEl) {
      hideTableQuickActions()
      return
    }

    const wrapperRect = wrapper.getBoundingClientRect()
    const cellRect = activeCell.getBoundingClientRect()
    const tableRect = tableEl.getBoundingClientRect()
    const offsetTop = wrapper.scrollTop
    const offsetLeft = wrapper.scrollLeft

    const tableTop = tableRect.top - wrapperRect.top + offsetTop
    const tableLeft = tableRect.left - wrapperRect.left + offsetLeft
    const tableRight = tableLeft + tableRect.width
    const tableBottom = tableTop + tableRect.height
    const rowCenterY = cellRect.top - wrapperRect.top + offsetTop + cellRect.height / 2
    const colCenterX = cellRect.left - wrapperRect.left + offsetLeft + cellRect.width / 2

    const ACTION_EDGE_OFFSET = -4
    const ROW_GROUP_WIDTH = 24
    const ROW_GROUP_HEIGHT = 80
    const COL_GROUP_WIDTH = 80
    const COL_GROUP_HEIGHT = 24
    const TABLE_GROUP_WIDTH = 52
    const SELECTION_GROUP_WIDTH = 52
    const SELECTION_GROUP_HEIGHT = 24

    const rowTop = Math.min(
      Math.max(tableTop + 6, rowCenterY - ROW_GROUP_HEIGHT / 2),
      Math.max(tableTop + 6, tableBottom - ROW_GROUP_HEIGHT - 6)
    )
    const rowLeft = Math.max(2, tableLeft - ROW_GROUP_WIDTH / 2 + ACTION_EDGE_OFFSET)

    const colTop = Math.max(2, tableTop - COL_GROUP_HEIGHT / 2 + ACTION_EDGE_OFFSET)
    const colLeft = Math.min(
      Math.max(tableLeft + 6, colCenterX - COL_GROUP_WIDTH / 2),
      Math.max(tableLeft + 6, tableRight - COL_GROUP_WIDTH - 6)
    )

    const toolbarTop = Math.max(2, tableTop - COL_GROUP_HEIGHT / 2 + ACTION_EDGE_OFFSET)
    const toolbarLeft = Math.max(
      tableLeft + 6,
      tableRight - TABLE_GROUP_WIDTH + ACTION_EDGE_OFFSET
    )

    const selection = view.state.selection
    const selectedCells: HTMLTableCellElement[] = []
    if (selection instanceof CellSelection) {
      selection.forEachCell((_node, pos) => {
        const selectedCellEl = getTableCellElementForPos(view, pos)
        if (selectedCellEl && tableEl.contains(selectedCellEl)) {
          selectedCells.push(selectedCellEl)
        }
      })
    } else {
      const selectedCellEl = getTableCellElementForPos(view, selection.from)
      if (selectedCellEl && tableEl.contains(selectedCellEl)) {
        selectedCells.push(selectedCellEl)
      }
    }

    let selectionLeft = toolbarLeft
    let selectionTop = toolbarTop
    let selectionVisible = false

    if (selectedCells.length > 0) {
      let selTop = Number.POSITIVE_INFINITY
      let selRight = Number.NEGATIVE_INFINITY
      selectedCells.forEach((cell) => {
        const rect = cell.getBoundingClientRect()
        selTop = Math.min(selTop, rect.top - wrapperRect.top + offsetTop)
        selRight = Math.max(selRight, rect.right - wrapperRect.left + offsetLeft)
      })

      if (Number.isFinite(selTop) && Number.isFinite(selRight)) {
        selectionLeft = Math.min(
          Math.max(tableLeft + 6, selRight - SELECTION_GROUP_WIDTH),
          Math.max(tableLeft + 6, tableRight - SELECTION_GROUP_WIDTH - 6)
        )
        selectionTop = Math.max(2, selTop - SELECTION_GROUP_HEIGHT - 8)
        selectionVisible = canMergeSelection() || canSplitSelection()
      }
    }

    tableQuickActions.value = {
      visible: true,
      rowTop,
      rowLeft,
      colTop,
      colLeft,
      selectionTop,
      selectionLeft,
      selectionVisible,
      toolbarTop,
      toolbarLeft
    }
    tableQuickActionCellEl = activeCell
  }

  const teardownTableQuickActions = () => {
    tableQuickActionsCleanup?.()
    tableQuickActionsCleanup = null
    hideTableQuickActions()
  }

  const setupTableQuickActions = () => {
    teardownTableQuickActions()
    if (readonly.value || viewMode.value === 'source' || !isEditorCreated.value) return

    const wrapper = editorRef.value?.closest('.crepe-wrapper') as HTMLElement | null
    const view = getEditorView()
    if (!wrapper || !view) return

    const onMouseMove = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('.table-quick-actions')) return

      const cell = target.closest('.ProseMirror td, .ProseMirror th') as HTMLTableCellElement | null
      if (cell) {
        updateTableQuickActionsPosition(cell)
        return
      }

      if (tableQuickActions.value.visible && tableQuickActionCellEl) {
        const tableEl = tableQuickActionCellEl.closest('table') as HTMLTableElement | null
        if (tableEl) {
          const wrapperRect = wrapper.getBoundingClientRect()
          const tableRect = tableEl.getBoundingClientRect()
          const x = event.clientX - wrapperRect.left + wrapper.scrollLeft
          const y = event.clientY - wrapperRect.top + wrapper.scrollTop
          const margin = 44
          const left = tableRect.left - wrapperRect.left + wrapper.scrollLeft - margin
          const right = tableRect.right - wrapperRect.left + wrapper.scrollLeft + margin
          const top = tableRect.top - wrapperRect.top + wrapper.scrollTop - margin
          const bottom = tableRect.bottom - wrapperRect.top + wrapper.scrollTop + margin
          if (x >= left && x <= right && y >= top && y <= bottom) return
        }
      }

      hideTableQuickActions()
    }

    const onScroll = () => {
      if (!tableQuickActions.value.visible) return
      updateTableQuickActionsPosition()
    }

    const onMouseLeave = () => {
      hideTableQuickActions()
    }

    wrapper.addEventListener('mousemove', onMouseMove, { passive: true })
    wrapper.addEventListener('mouseleave', onMouseLeave)
    wrapper.addEventListener('scroll', onScroll, true)

    tableQuickActionsCleanup = () => {
      wrapper.removeEventListener('mousemove', onMouseMove)
      wrapper.removeEventListener('mouseleave', onMouseLeave)
      wrapper.removeEventListener('scroll', onScroll, true)
    }
  }

  const teardownBlockHandlePointerRelay = () => {
    blockHandlePointerRelayCleanup?.()
    blockHandlePointerRelayCleanup = null
  }

  const setupBlockHandlePointerRelay = () => {
    teardownBlockHandlePointerRelay()

    if (readonly.value || !editorRef.value || isEditorDestroying.value) return
    blockHandlePointerRelayCleanup = null
  }

  return {
    tableQuickActions,
    hideTableQuickActions,
    getActiveTableQuickActionCell,
    updateTableQuickActionsPosition,
    setupTableQuickActions,
    teardownTableQuickActions,
    setupBlockHandlePointerRelay,
    teardownBlockHandlePointerRelay
  }
}
