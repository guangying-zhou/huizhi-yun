import type { Ref } from 'vue'
import { CellSelection, isInTable } from '@milkdown/prose/tables'
import { TextSelection } from '@milkdown/prose/state'
import type { Ctx } from '@milkdown/ctx'
import { editorViewCtx } from '@milkdown/core'
import type { EditorView } from '@milkdown/prose/view'
import type { TableCommand } from './editorToolbarConfig'

export type TableQuickActionCommand = TableCommand

interface UseEditorTableQuickActionsOptions {
  readonly: Ref<boolean>
  isTableColumnResizing: Ref<boolean>
  isEditorDestroying: Ref<boolean>
  isEditorCreated: Ref<boolean>
  getEditorView: () => EditorView | null
  getActiveCell: () => HTMLTableCellElement | null
  runLater: (handler: () => void, delay: number) => number | null
  rescaleToContainer: (view: EditorView) => void
  updatePosition: () => void
  warn: (title: string) => void
}

export const useEditorTableQuickActions = ({
  readonly,
  isTableColumnResizing,
  isEditorDestroying,
  isEditorCreated,
  getEditorView,
  getActiveCell,
  runLater,
  rescaleToContainer,
  updatePosition,
  warn
}: UseEditorTableQuickActionsOptions) => {
  const runTableEditCommandOnView = (view: EditorView, command: TableQuickActionCommand) => {
    if (readonly.value || !isInTable(view.state)) return false

    const executed = command(view.state, transaction => view.dispatch(transaction))
    if (!executed) return false

    runLater(() => {
      if (isEditorDestroying.value || !isEditorCreated.value) return
      rescaleToContainer(view)
      updatePosition()
    }, 0)
    return true
  }

  const runTableEditCommand = (ctx: Ctx, command: TableQuickActionCommand) => {
    runTableEditCommandOnView(ctx.get(editorViewCtx), command)
  }

  const canRunTableQuickAction = (command: TableQuickActionCommand, options?: { preserveSelection?: boolean }) => {
    if (readonly.value || isTableColumnResizing.value) return false
    const view = getEditorView()
    if (!view || !isInTable(view.state)) return false
    if (options?.preserveSelection && !(view.state.selection instanceof CellSelection)) return false

    try {
      return Boolean(command(view.state))
    } catch {
      return false
    }
  }

  const focusTableCell = (view: EditorView, cellEl: HTMLTableCellElement) => {
    if (!view.dom.contains(cellEl)) return false
    try {
      const beforePos = view.posAtDOM(cellEl, 0)
      const insidePos = Math.min(Math.max(1, beforePos + 1), view.state.doc.content.size)
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(insidePos))))
      return true
    } catch {
      return false
    }
  }

  const runTableQuickAction = (
    command: TableQuickActionCommand,
    options?: { preserveSelection?: boolean, failHint?: string }
  ) => {
    if (readonly.value || isTableColumnResizing.value) return
    const view = getEditorView()
    const cellEl = getActiveCell()
    if (!view || !cellEl) return

    view.focus()
    if (!options?.preserveSelection && !focusTableCell(view, cellEl)) return

    if (!runTableEditCommandOnView(view, command) && options?.failHint) warn(options.failHint)
  }

  return {
    runTableEditCommandOnView,
    runTableEditCommand,
    canRunTableQuickAction,
    runTableQuickAction
  }
}
