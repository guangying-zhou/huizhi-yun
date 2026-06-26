import type { Ref } from 'vue'
import { callCommand } from '@milkdown/utils'
import { editorViewCtx } from '@milkdown/core'
import type { Ctx } from '@milkdown/ctx'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  listItemSchema,
  headingSchema,
  paragraphSchema,
  blockquoteSchema,
  hrSchema,
  bulletListSchema,
  orderedListSchema,
  wrapInBlockTypeCommand,
  addBlockTypeCommand
} from '@milkdown/preset-commonmark'
import { liftListItem, wrapInList } from '@milkdown/prose/schema-list'
import { setBlockType } from '@milkdown/prose/commands'
import { toggleStrikethroughCommand } from '@milkdown/preset-gfm'

interface BuilderChain<Item> {
  clear: () => BuilderChain<Item>
  addItem: (key: string, item: Item) => BuilderChain<Item>
}

interface GroupBuilder<Item> {
  getGroup: (name: string) => BuilderChain<Item>
  addGroup: (name: string, label: string) => BuilderChain<Item>
  clear: () => void
}

interface SlashMenuItem {
  label: string
  icon: string
  onRun: (ctx: Ctx) => void
}

interface ToolbarItem {
  icon: string
  onRun: (ctx: Ctx) => void
  active: (ctx: Ctx) => boolean
}

export type TableCommand = (state: EditorState, dispatch?: ((tr: Transaction) => void) | undefined) => boolean

const blockEditIcons = {
  text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/></svg>',
  h1: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></svg>',
  h2: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>',
  h3: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></svg>',
  h4: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10v4h4"/><path d="M21 10v8"/></svg>',
  quote: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8"/><path d="M5 14c.83 0 1.5-.67 1.5-1.5S5.83 11 5 11s-1.5.67-1.5 1.5S4.17 14 5 14z"/><path d="M14 21c3 0 7-1 7-8"/><path d="M16 14c.83 0 1.5-.67 1.5-1.5S16.83 11 16 11s-1.5.67-1.5 1.5S15.17 14 16 14z"/></svg>',
  divider: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" x2="19" y1="12" y2="12"/></svg>'
}

const tableEditIcons = {
  addRowAbove: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V6"/><path d="m9 9 3-3 3 3"/><path d="M3 3v18"/><path d="M21 3v18"/><path d="M3 12h18"/></svg>',
  addRowBelow: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v12"/><path d="m15 15-3 3-3-3"/><path d="M3 3v18"/><path d="M21 3v18"/><path d="M3 12h18"/></svg>',
  deleteRow: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18"/><path d="M21 3v18"/><path d="M3 12h18"/><path d="M8 7h8"/><path d="M8 17h8"/></svg>',
  addColumnLeft: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 12H6"/><path d="m9 9-3 3 3 3"/><path d="M3 3h18"/><path d="M3 21h18"/><path d="M12 3v18"/></svg>',
  addColumnRight: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h12"/><path d="m15 9 3 3-3 3"/><path d="M3 3h18"/><path d="M3 21h18"/><path d="M12 3v18"/></svg>',
  deleteColumn: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18"/><path d="M3 21h18"/><path d="M12 3v18"/><path d="M7 8v8"/><path d="M17 8v8"/></svg>',
  toggleHeader: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M8 13v5"/><path d="M16 13v5"/><path d="M12 13v5"/></svg>',
  deleteTable: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/><path d="M15 21V9"/><path d="m8 8 8 8"/><path d="m16 8-8 8"/></svg>'
}

const liftSelectionOutOfList = (ctx: Ctx) => {
  const view = ctx.get(editorViewCtx)
  const listItemNodeType = listItemSchema.type(ctx)
  const liftCmd = liftListItem(listItemNodeType)
  let selectionFrom = view.state.selection.from
  let selectionTo = view.state.selection.to

  const dispatchWithReselection = (tr: Parameters<typeof view.dispatch>[0]) => {
    const docSize = Math.max(1, tr.doc.content.size)
    selectionFrom = Math.min(Math.max(tr.mapping.map(selectionFrom), 1), docSize)
    selectionTo = Math.min(Math.max(tr.mapping.map(selectionTo), 1), docSize)
    tr.setSelection(TextSelection.create(tr.doc, Math.min(selectionFrom, selectionTo), Math.max(selectionFrom, selectionTo)))
    view.dispatch(tr)
  }

  for (let index = 0; index < 10; index += 1) {
    const { $from } = view.state.selection
    let inList = false
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      if ($from.node(depth).type === listItemNodeType) {
        inList = true
        break
      }
    }
    if (!inList) break
    if (!liftCmd(view.state, dispatchWithReselection)) break
  }

  return view
}

const setTextBlock = (ctx: Ctx) => {
  const view = liftSelectionOutOfList(ctx)
  setBlockType(paragraphSchema.type(ctx))(view.state, view.dispatch)
}

const setHeading = (level: number) => (ctx: Ctx) => {
  const view = liftSelectionOutOfList(ctx)
  const { state } = view
  const headingNodeType = headingSchema.type(ctx)
  const { from, to } = state.selection
  const tr = state.tr
  tr.setBlockType(from, to, headingNodeType, { level })
  for (const name of ['strong', 'emphasis', 'strikethrough', 'inlineCode']) {
    const markType = state.schema.marks[name]
    if (markType) tr.removeMark(from, to, markType)
  }
  view.dispatch(tr)
}

const isSelectionInListOfType = (
  state: import('@milkdown/prose/state').EditorState,
  listTypeName: 'bullet_list' | 'ordered_list'
) => {
  const { $from, $to } = state.selection
  const check = ($pos: typeof $from) => {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === listTypeName) return true
    }
    return false
  }
  return check($from) && check($to)
}

const toggleListOfType = (ctx: Ctx, target: 'bullet_list' | 'ordered_list') => {
  const view = ctx.get(editorViewCtx)
  if (isSelectionInListOfType(view.state, target)) {
    liftSelectionOutOfList(ctx)
    return
  }

  const otherType = target === 'bullet_list' ? 'ordered_list' : 'bullet_list'
  const startView = isSelectionInListOfType(view.state, otherType) ? liftSelectionOutOfList(ctx) : view
  const listType = target === 'bullet_list' ? bulletListSchema.type(ctx) : orderedListSchema.type(ctx)
  wrapInList(listType)(startView.state, startView.dispatch)
}

const setBulletList = (ctx: Ctx) => toggleListOfType(ctx, 'bullet_list')
const setOrderedList = (ctx: Ctx) => toggleListOfType(ctx, 'ordered_list')

const setQuoteBlock = (ctx: Ctx) => {
  liftSelectionOutOfList(ctx)
  callCommand(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) })(ctx)
}

const insertDividerBlock = (ctx: Ctx) => {
  liftSelectionOutOfList(ctx)
  callCommand(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) })(ctx)
}

interface CreateEditorToolbarConfigOptions {
  isAnnotationDialogOpen: Ref<boolean>
  aiMenuVisible: Ref<boolean>
  pasteFromCloudClipboard: () => void
  copyToCloudClipboard: () => void
  openAnnotationDialog: () => void
  openAiMenu: () => void
  runTableEditCommand: (ctx: Ctx, command: TableCommand) => void
  addRowBefore: TableCommand
  addRowAfter: TableCommand
  deleteRow: TableCommand
  addColumnBefore: TableCommand
  addColumnAfter: TableCommand
  deleteColumn: TableCommand
  toggleHeaderRow: TableCommand
  deleteTable: TableCommand
}

export const createEditorToolbarConfig = ({
  isAnnotationDialogOpen,
  aiMenuVisible,
  pasteFromCloudClipboard,
  copyToCloudClipboard,
  openAnnotationDialog,
  openAiMenu,
  runTableEditCommand,
  addRowBefore,
  addRowAfter,
  deleteRow,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  toggleHeaderRow,
  deleteTable
}: CreateEditorToolbarConfigOptions) => ({
  blockEdit: {
    textGroup: {
      label: '文本',
      text: { label: '正文' },
      h1: { label: '一级标题' },
      h2: { label: '二级标题' },
      h3: { label: '三级标题' },
      h4: { label: '四级标题' },
      h5: null,
      h6: null,
      quote: { label: '引用' },
      divider: { label: '分隔线' }
    },
    listGroup: {
      label: '列表',
      bulletList: { label: '无序列表' },
      orderedList: { label: '有序列表' },
      taskList: { label: '待办事项' }
    },
    advancedGroup: {
      label: '高级',
      image: { label: '图片' },
      codeBlock: { label: '代码块' },
      table: { label: '表格' },
      math: { label: '数学公式' }
    },
    buildMenu: (builder: GroupBuilder<SlashMenuItem>) => {
      builder.getGroup('text')
        .clear()
        .addItem('text', { label: '正文', icon: blockEditIcons.text, onRun: (ctx: Ctx) => { setTextBlock(ctx) } })
        .addItem('h1', { label: '一级标题', icon: blockEditIcons.h1, onRun: (ctx: Ctx) => { setHeading(1)(ctx) } })
        .addItem('h2', { label: '二级标题', icon: blockEditIcons.h2, onRun: (ctx: Ctx) => { setHeading(2)(ctx) } })
        .addItem('h3', { label: '三级标题', icon: blockEditIcons.h3, onRun: (ctx: Ctx) => { setHeading(3)(ctx) } })
        .addItem('h4', { label: '四级标题', icon: blockEditIcons.h4, onRun: (ctx: Ctx) => { setHeading(4)(ctx) } })
        .addItem('quote', { label: '引用', icon: blockEditIcons.quote, onRun: (ctx: Ctx) => { setQuoteBlock(ctx) } })
        .addItem('divider', { label: '分隔线', icon: blockEditIcons.divider, onRun: (ctx: Ctx) => { insertDividerBlock(ctx) } })

      builder.addGroup('cloud', '汇智云').addItem('cloudPaste', {
        label: '从汇智云粘贴',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-download"><path d="M12 13v8"/><path d="m4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4 4 4-4"/></svg>',
        onRun: () => { pasteFromCloudClipboard() }
      })

      builder.addGroup('tableEdit', '表格编辑')
        .addItem('addRowBefore', { label: '上方插入行', icon: tableEditIcons.addRowAbove, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, addRowBefore) } })
        .addItem('addRowAfter', { label: '下方插入行', icon: tableEditIcons.addRowBelow, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, addRowAfter) } })
        .addItem('deleteRow', { label: '删除当前行', icon: tableEditIcons.deleteRow, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, deleteRow) } })
        .addItem('addColumnBefore', { label: '左侧插入列', icon: tableEditIcons.addColumnLeft, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, addColumnBefore) } })
        .addItem('addColumnAfter', { label: '右侧插入列', icon: tableEditIcons.addColumnRight, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, addColumnAfter) } })
        .addItem('deleteColumn', { label: '删除当前列', icon: tableEditIcons.deleteColumn, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, deleteColumn) } })
        .addItem('toggleHeaderRow', { label: '切换当前行为表头', icon: tableEditIcons.toggleHeader, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, toggleHeaderRow) } })
        .addItem('deleteTable', { label: '删除整个表格', icon: tableEditIcons.deleteTable, onRun: (ctx: Ctx) => { runTableEditCommand(ctx, deleteTable) } })
    }
  },
  toolbar: {
    buildToolbar: (builder: GroupBuilder<ToolbarItem>) => {
      builder.clear()

      builder.addGroup('heading', 'Heading')
        .addItem('h1', { icon: blockEditIcons.h1, onRun: (ctx: Ctx) => { setHeading(1)(ctx) }, active: () => false })
        .addItem('h2', { icon: blockEditIcons.h2, onRun: (ctx: Ctx) => { setHeading(2)(ctx) }, active: () => false })
        .addItem('h3', { icon: blockEditIcons.h3, onRun: (ctx: Ctx) => { setHeading(3)(ctx) }, active: () => false })
        .addItem('h4', { icon: blockEditIcons.h4, onRun: (ctx: Ctx) => { setHeading(4)(ctx) }, active: () => false })

      builder.addGroup('list', 'List')
        .addItem('bulletList', {
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
          onRun: (ctx: Ctx) => { setBulletList(ctx) },
          active: (ctx: Ctx) => isSelectionInListOfType(ctx.get(editorViewCtx).state, 'bullet_list')
        })
        .addItem('orderedList', {
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
          onRun: (ctx: Ctx) => { setOrderedList(ctx) },
          active: (ctx: Ctx) => isSelectionInListOfType(ctx.get(editorViewCtx).state, 'ordered_list')
        })

      builder.addGroup('format', 'Basic Format')
        .addItem('strong', { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bold"><path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/></svg>', onRun: (ctx: Ctx) => { callCommand(toggleStrongCommand.key)(ctx) }, active: () => false })
        .addItem('emphasis', { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-italic"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>', onRun: (ctx: Ctx) => { callCommand(toggleEmphasisCommand.key)(ctx) }, active: () => false })
        .addItem('strikethrough', { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-strikethrough"><path d="M16 4H9a3 3 0 0 0-2.83 2.83"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg>', onRun: (ctx: Ctx) => { callCommand(toggleStrikethroughCommand.key)(ctx) }, active: () => false })
        .addItem('inlineCode', { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>', onRun: (ctx: Ctx) => { callCommand(toggleInlineCodeCommand.key)(ctx) }, active: () => false })
        .addItem('link', { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-link"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>', onRun: (ctx: Ctx) => { callCommand(toggleLinkCommand.key)(ctx) }, active: () => false })

      builder.addGroup('annotation', 'Annotation')
        .addItem('createAnnotation', {
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-square-plus"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" x2="15" y1="10" y2="10"/><line x1="12" x2="12" y1="7" y2="13"/></svg>',
          onRun: () => { openAnnotationDialog() },
          active: () => isAnnotationDialogOpen.value
        })
        .addItem('cloudCopy', {
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-upload"><path d="M12 13v8"/><path d="m4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/></svg>',
          onRun: () => { copyToCloudClipboard() },
          active: () => false
        })

      builder.addGroup('ai', 'AI')
        .addItem('aiMenu', {
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" style="fill: none !important;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>',
          onRun: () => { openAiMenu() },
          active: () => aiMenuVisible.value
        })
    }
  }
})
