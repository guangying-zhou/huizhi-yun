<script setup lang="ts">
/**
 * Milkdown Crepe 编辑器客户端组件
 *
 * 使用 Milkdown Crepe 预配置编辑器套件
 * 内置：Block Handles、Toolbar、Slash Menu、代码高亮等
 * 支持 Mermaid 图表渲染（通过 renderPreview API）
 *
 * 参考文档：https://milkdown.dev/docs/guide/using-crepe
 */

import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { replaceAll, callCommand } from '@milkdown/utils'
import mermaid from 'mermaid'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import { upload, uploadConfig } from '@milkdown/plugin-upload'
import remarkBreaks from 'remark-breaks'
import { remarkPluginsCtx, editorViewCtx, prosePluginsCtx, parserCtx, serializerCtx } from '@milkdown/core'
import { TextSelection, Plugin, PluginKey } from '@milkdown/prose/state'
import type { Node as ProsemirrorNode } from '@milkdown/prose/model'
import type { Ctx } from '@milkdown/ctx'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  mergeCells,
  selectedRect,
  splitCell,
  TableMap,
  toggleHeaderRow
} from '@milkdown/prose/tables'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import AnnotationDialog from './annotations/AnnotationDialog.vue'
import AnnotationCard from './annotations/AnnotationCard.vue'
import {
  applyColwidthFromMarkdown,
  encodeColwidthInMarkdown,
  encodeTableMergeInMarkdown,
  getTableByIndex,
  parseTableMergeMetaFromMarkdown,
  rescaleTableColwidthsToContainer
} from './editorTableCodec'
import { StableEditorTableView, createEnsureTableColgroupPlugin } from './editorTableColgroupPlugin'
import { createEditorMermaidPreview, EDITOR_MERMAID_RENDERER_VARIANT, initEditorMermaid } from './editorMermaid'
import { createMermaidSvgCache } from './editorMermaidCache'
import { createEditorToolbarConfig } from './editorToolbarConfig'
import type { TableCommand } from './editorToolbarConfig'
import { useEditorAnnotations } from './useEditorAnnotations'
import { useEditorImageUpload } from './useEditorImageUpload'
import { useEditorModeSync } from './useEditorModeSync'
import { useReadonlyEditorOverlay } from './useReadonlyEditorOverlay'
import { useEditorTableUi } from './useEditorTableUi'

// 必须导入 Crepe 主题样式
// 移除静态主题导入，改用动态 CSS 变量
// import '@milkdown/crepe/theme/common/style.css'
// import '@milkdown/crepe/theme/frame.css'
import '@milkdown/crepe/theme/common/style.css' // 仅保留 common 样式

interface VersionItem {
  id: number
  versionNum: number
  createdAt: string
  editorName?: string
  contentSize?: number
}

interface AnnotationReply {
  id: number
  content: string
  author_id: string
  author_name: string
  created_at: string
}

interface Annotation {
  id: number
  content: string
  selected_text: string
  author_id: string
  author_name: string
  created_at: string
  status?: string
  replies?: AnnotationReply[]
  context_before?: string
  context_after?: string
  position_hint?: number
}

// Props
interface Props {
  modelValue?: string
  readonly?: boolean
  watermarkText?: string
  theme?: 'frame' | 'classic' | 'nord'
  showSidebar?: boolean
  documentId?: string
  versions?: VersionItem[]
  versionsLoading?: boolean
  showVersionHistory?: boolean
  showSharePanel?: boolean
  docType?: string
  projectRepoUrl?: string
  docPath?: string
  viewMode?: 'edit' | 'source'
  annotations?: Annotation[]
  containerHeight?: string // 新增：自定义容器高度
  allowShare?: boolean
  canManageShares?: boolean
  activeVersionNum?: number | null
  aiAbstract?: string
  collaborationDoc?: Y.Doc | null
  collaborationAwareness?: Awareness | null
  collaborationEnabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  readonly: false,
  watermarkText: '',
  theme: 'frame',
  showSidebar: true,
  documentId: '',
  versions: () => [],
  versionsLoading: false,
  showVersionHistory: false,
  showSharePanel: false,
  docType: 'private',
  projectRepoUrl: '',
  docPath: '',
  viewMode: 'edit',
  annotations: () => [],
  containerHeight: 'w-full', // 默认高度
  allowShare: true,
  canManageShares: true,
  activeVersionNum: null,
  aiAbstract: '',
  collaborationDoc: null,
  collaborationAwareness: null,
  collaborationEnabled: false
})

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'change': [value: string]
  'ready': []
  'close-sidebar': []
  'load-versions': []
  'view-version': [versionId: number]
  'diff-version': [versionId: number]
  'share': [data: { uid: string, permission: 'read' | 'write' }]
  'remove-share': [shareId: number]
  'update-permission': [data: { shareId: number, permission: 'read' | 'write' }]
  'create-annotation': [data: { selectedText: string, contextBefore: string, contextAfter: string, positionHint: number, content: string }]
  'reply-annotation': [annotationId: number, content: string]
  'resolve-annotation': [annotationId: number]
  'delete-annotation': [annotationId: number]
  'delete-reply': [annotationId: number, replyId: number]
  'click-annotation': [annotationId: number]
  'update-abstract': [text: string]
}>()

const editorRef = ref<HTMLDivElement | null>(null)
const sourceTextareaRef = ref<HTMLTextAreaElement | null>(null)
const sidebarRef = ref<InstanceType<typeof import('./EditorSidebar.vue').default> | null>(null)
const isLoading = ref(true)
const toast = useToast()
let crepe: Crepe | null = null
let mermaidIdCounter = 0
let collaborationSyncFrame: number | null = null
let collaborationServiceBound = false
let pendingSourceToEditSync = false
let tableLayoutObserver: ResizeObserver | null = null
let colwidthRestoreTimer: number | null = null
let tableMergeRestoreTimer: number | null = null
let tableLayoutRestoreLockUntil = 0
let lastKnownEditorMarkdown = ''
const isTableColumnResizing = ref(false)
const isEditorCreated = ref(false)
const isEditorDestroying = ref(false)
const pendingTimeouts = new Set<number>()
const mermaidSvgCache = createMermaidSvgCache({
  namespace: 'codocs-mermaid-svg-cache',
  getVariant: () => JSON.stringify({
    colorMode: colorMode.value === 'dark' ? 'dark' : 'light',
    mermaidVersion: (mermaid as { version?: string }).version ?? 'unknown',
    rendererVariant: EDITOR_MERMAID_RENDERER_VARIANT
  }),
  maxMemoryEntries: 10,
  maxSvgChars: 90000,
  maxPersistentEntries: 96
})

// AI 下拉菜单状态（整合到 Crepe 工具栏）
const aiMenuVisible = ref(false)
const aiSelectedText = ref('')
const aiMenuPosition = ref({ top: 0, left: 0 })
const aiSelectionRange = ref<{ from: number, to: number } | null>(null)

// Annotation UI State
const isCollaborationActive = computed(() => Boolean(props.collaborationEnabled && props.collaborationDoc))

const runEditorTimeout = (handler: () => void, delay: number) => {
  if (typeof window === 'undefined' || isEditorDestroying.value) return null

  const timerId = window.setTimeout(() => {
    pendingTimeouts.delete(timerId)
    if (isEditorDestroying.value) return
    handler()
  }, delay)

  pendingTimeouts.add(timerId)
  return timerId
}

const cancelEditorTimeout = (timerId: number | null) => {
  if (timerId === null || typeof window === 'undefined') return
  window.clearTimeout(timerId)
  pendingTimeouts.delete(timerId)
}

const lockTableLayoutRescale = (duration = 320) => {
  if (typeof window === 'undefined') return
  tableLayoutRestoreLockUntil = window.performance.now() + duration
}

const isTableLayoutRescaleLocked = () => {
  if (typeof window === 'undefined') return false
  return window.performance.now() < tableLayoutRestoreLockUntil
}

// 调度一次 colwidth 恢复。不对相同 delay 做 debounce（每次都独立排队），
// applyColwidthFromMarkdown 自身是幂等的（只在需要时才 dispatch），多跑几次无副作用。
// 但对 ResizeObserver 这种可能高频触发的来源，我们用 colwidthRestoreTimer 做一次微节流。
const scheduleColwidthRestoreFromModel = (delay = 0, markdown?: string, throttleKey = false) => {
  if (typeof window === 'undefined' || isEditorDestroying.value) return
  if (isTableColumnResizing.value) return
  const source = markdown ?? (lastKnownEditorMarkdown || props.modelValue || '')
  if (!source || !isEditorCreated.value || props.viewMode !== 'edit') return

  // 仅当 throttleKey=true 时才和上一次同类调度合并（用于 ResizeObserver 节流）；
  // 其它明确的一次性触发（初始化、viewMode 切换、modelValue 到达）不受其影响
  if (throttleKey && colwidthRestoreTimer !== null) {
    cancelEditorTimeout(colwidthRestoreTimer)
    colwidthRestoreTimer = null
  }

  const timerId = runEditorTimeout(() => {
    if (throttleKey) colwidthRestoreTimer = null
    lockTableLayoutRescale()
    applyColwidthFromMarkdownToEditor(source)
  }, delay)

  if (throttleKey && timerId !== null) {
    colwidthRestoreTimer = timerId
  }
}

const getEditorViewSafe = () => {
  if (!crepe || !isEditorCreated.value || isEditorDestroying.value) return null

  try {
    return crepe.editor.ctx.get(editorViewCtx)
  } catch {
    return null
  }
}

const encodeColwidthInMarkdownWithEditor = (markdown: string) => {
  const view = getEditorViewSafe()
  if (!view) return markdown
  return encodeColwidthInMarkdown({
    markdown,
    view
  })
}

const encodeTableMergeInMarkdownWithEditor = (markdown: string, fullSerialize = false) => {
  const view = getEditorViewSafe()
  if (!view || !crepe) return markdown
  return encodeTableMergeInMarkdown({
    markdown,
    view,
    crepe,
    fullSerialize,
    encodeColwidth: encodeColwidthInMarkdownWithEditor
  })
}

const applyColwidthFromMarkdownToEditor = (markdown: string, attempt = 0) => {
  applyColwidthFromMarkdown({
    markdown,
    getView: getEditorViewSafe,
    getEditorRoot: () => editorRef.value,
    runLater: (handler, delay) => {
      runEditorTimeout(handler, delay)
    },
    attempt
  })
}

const {
  annotationPlugin,
  isAnnotationDialogOpen,
  annotationSelection,
  marginIcons,
  overlayStyle,
  activeAnnotationId,
  getAnnotation,
  openAnnotationDialog,
  handleCreateAnnotation,
  toggleAnnotation,
  scrollToAnnotation
} = useEditorAnnotations({
  annotations: computed(() => props.annotations || []),
  getEditorView: getEditorViewSafe,
  emitCreateAnnotation: (payload) => {
    emit('create-annotation', payload)
  },
  emitClickAnnotation: (id) => {
    emit('click-annotation', id)
  },
  onPluginViewUpdate: (view) => {
    if (aiMenuVisible.value && view.state.selection.empty && !aiSelectionRange.value) {
      aiMenuVisible.value = false
    }
  }
})

const {
  readonlyCodeBlocks,
  readonlyLinks,
  readonlyWatermarkStyle,
  scheduleReadonlyCodeBlockRefresh,
  setupReadonlyCodeBlockObserver,
  syncReadonlyCodeBlockObserver,
  teardownReadonlyCodeBlockObserver,
  copyReadonlyCodeBlock,
  copyReadonlyLink
} = useReadonlyEditorOverlay({
  editorRef,
  readonly: computed(() => props.readonly),
  viewMode: computed(() => props.viewMode),
  watermarkText: computed(() => props.watermarkText || ''),
  isEditorDestroying,
  toast
})

const {
  onUpload: handleImageBlockUpload,
  uploader
} = useEditorImageUpload({
  editorRef,
  documentId: computed(() => props.documentId)
})

const getCachedMermaidSvg = (content: string) => {
  return mermaidSvgCache.getFromMemory(content)
}

const getPersistentMermaidSvg = (content: string) => {
  return mermaidSvgCache.getFromPersistent(content)
}

const setCachedMermaidSvg = async (content: string, svg: string) => {
  await mermaidSvgCache.setPersistent(content, svg)
}

const mermaidPreview = createEditorMermaidPreview({
  isEditorDestroying,
  createId: () => `mermaid-${Date.now()}-${mermaidIdCounter++}`,
  getCachedSvg: getCachedMermaidSvg,
  getPersistentSvg: getPersistentMermaidSvg,
  setCachedSvg: setCachedMermaidSvg
})

const {
  tableQuickActions,
  hideTableQuickActions,
  getActiveTableQuickActionCell,
  updateTableQuickActionsPosition,
  setupTableQuickActions,
  teardownTableQuickActions,
  setupBlockHandlePointerRelay,
  teardownBlockHandlePointerRelay
} = useEditorTableUi({
  editorRef,
  readonly: computed(() => props.readonly),
  viewMode: computed(() => props.viewMode),
  isEditorDestroying,
  isEditorCreated,
  isTableColumnResizing,
  getEditorView: getEditorViewSafe,
  canMergeSelection: () => canRunTableQuickAction(mergeCellsCombineContent, { preserveSelection: true }),
  canSplitSelection: () => canRunTableQuickAction(splitCell, { preserveSelection: true })
})

let pendingViewRefresh = false
const scheduleEditorViewRefresh = () => {
  if (pendingViewRefresh || isEditorDestroying.value) return
  pendingViewRefresh = true
  runEditorTimeout(() => {
    pendingViewRefresh = false
    const view = getEditorViewSafe()
    if (!view) return
    try {
      const tr = view.state.tr
      tr.setMeta('addToHistory', false)
      view.dispatch(tr)
    } catch {
      // 视图重建/销毁窗口期内可能抛错，忽略即可
    }
  }, 0)
}

const getCollaborationServiceSafe = () => {
  if (!crepe || !isEditorCreated.value || isEditorDestroying.value) return null

  try {
    return crepe.editor.ctx.get(collabServiceCtx)
  } catch {
    return null
  }
}

watch(() => props.viewMode, () => {
  nextTick(() => {
    scheduleEditorViewRefresh()
    if (props.viewMode === 'source' || props.readonly) {
      hideTableQuickActions()
    } else {
      setupTableQuickActions()
    }
  })
})

watch(() => props.annotations, () => {
  nextTick(() => {
    scheduleEditorViewRefresh()
  })
}, { deep: true })

watch(() => props.readonly, () => {
  nextTick(() => {
    if (props.readonly || props.viewMode === 'source') {
      hideTableQuickActions()
    } else {
      setupTableQuickActions()
    }
  })
})

const headingBackspaceGuardPluginKey = new PluginKey('heading-backspace-guard')
const emptyListItemBackspacePluginKey = new PluginKey('empty-list-item-backspace')

function isBlankLikeNode(node: ProsemirrorNode): boolean {
  if (!node?.isBlock) return false
  if (node.type?.name !== 'paragraph') return false

  if (node.childCount === 0) return true

  let allBlank = true
  node.content.forEach((child) => {
    if (!allBlank) return
    if (child.type?.name === 'hardbreak') return
    if (child.isText) {
      if ((child.text || '').replace(/\u00A0/g, ' ').trim().length > 0) allBlank = false
      return
    }

    allBlank = false
  })
  return allBlank
}

// 标题 Backspace 守卫：
//   1. 上方是空段落 → 删除空段落（保留标题）；
//   2. 上方是 atom/isolating 块（图片块、hr 等，无法 joinBackward）→ 将标题改为普通段落；
//   3. 标题是文档首个块 → 将标题改为普通段落（相当于"删除标题身份"）；
//   4. 其他情况（如上方为普通段落）→ 放行，让默认 Backspace 合并处理。
const headingBackspaceGuardPlugin = new Plugin({
  key: headingBackspaceGuardPluginKey,
  props: {
    handleKeyDown(view, event) {
      if (props.readonly) return false
      if (event.key !== 'Backspace') return false

      const { selection, schema } = view.state
      if (!selection.empty) return false

      const { $from } = selection
      if ($from.parent.type.name !== 'heading') return false
      if ($from.parentOffset !== 0) return false

      const blockDepth = $from.depth
      const parentDepth = blockDepth - 1
      if (parentDepth < 0) return false

      const blockIndex = $from.index(parentDepth)
      const parentNode = $from.node(parentDepth)
      const paragraphType = schema.nodes.paragraph

      const convertHeadingToParagraph = () => {
        if (!paragraphType) return false
        const tr = view.state.tr
        const headingStart = $from.before(blockDepth)
        const headingEnd = $from.after(blockDepth)
        tr.setBlockType(headingStart, headingEnd, paragraphType)
        view.dispatch(tr)
        event.preventDefault()
        return true
      }

      if (blockIndex > 0) {
        const previousNode = parentNode.child(blockIndex - 1)

        // Case 1: 上方为空段落 → 删除空段落
        if (isBlankLikeNode(previousNode)) {
          const currentBlockPos = $from.before(blockDepth)
          const previousBlockPos = currentBlockPos - previousNode.nodeSize
          view.dispatch(view.state.tr.delete(previousBlockPos, currentBlockPos))
          event.preventDefault()
          return true
        }

        // Case 2: 上方为 atom/isolating 块（图片块、分割线等）→ 标题转段落
        const spec = previousNode.type.spec
        const isAtomic = previousNode.isAtom || spec.isolating === true
        if (isAtomic) {
          return convertHeadingToParagraph()
        }
      } else {
        // Case 3: 标题是文档首个块 → 转为段落
        return convertHeadingToParagraph()
      }

      // 其他情况放行（默认 Backspace 通常会与上一段落合并）
      return false
    }
  }
})

// 处理空列表项（含 hardbreak 或纯空白）的退格删除
const emptyListItemBackspacePlugin = new Plugin({
  key: emptyListItemBackspacePluginKey,
  props: {
    handleKeyDown(view, event) {
      if (props.readonly) return false
      if (event.key !== 'Backspace' && event.key !== 'Delete') return false

      const { selection } = view.state
      if (!selection.empty) return false

      const { $from } = selection

      // 光标所在的直接父节点必须是空白段落
      if (!isBlankLikeNode($from.parent)) return false

      // 查找当前所在的 list_item 节点
      let listItemDepth = -1
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === 'list_item') {
          listItemDepth = d
          break
        }
      }
      if (listItemDepth < 0) return false

      const listItemNode = $from.node(listItemDepth)

      // 找到包裹的列表节点（ordered_list 或 bullet_list）
      const listDepth = listItemDepth - 1
      if (listDepth < 0) return false

      const listNode = $from.node(listDepth)

      // 检查列表项是否完全空白（没有嵌套的子列表等非空内容）
      let allChildrenBlank = true
      listItemNode.content.forEach((child) => {
        if (!allChildrenBlank) return
        if (!isBlankLikeNode(child)) allChildrenBlank = false
      })

      if (allChildrenBlank) {
        // 情况1：列表项完全空白
        if (listNode.childCount === 1) {
          // 列表只有一个空列表项：删除整个列表，替换为空段落
          const listStart = $from.before(listDepth)
          const listEnd = $from.after(listDepth)
          const paragraphNode = view.state.schema.nodes.paragraph
          if (!paragraphNode) return false
          const paragraph = paragraphNode.create()
          const tr = view.state.tr.replaceWith(listStart, listEnd, paragraph)
          tr.setSelection(TextSelection.create(tr.doc, listStart + 1))
          view.dispatch(tr)
        } else {
          // 列表有多个项：删除当前空列表项
          const itemStart = $from.before(listItemDepth)
          const itemEnd = $from.after(listItemDepth)
          const tr = view.state.tr.delete(itemStart, itemEnd)
          view.dispatch(tr)
        }
      } else {
        // 情况2：列表项第一段空白但有嵌套内容（如子列表）
        // 收集嵌套的非空内容节点
        const nestedNodes: ProsemirrorNode[] = []
        listItemNode.content.forEach((child) => {
          if (!isBlankLikeNode(child)) nestedNodes.push(child)
        })

        if (listNode.childCount === 1) {
          // 列表只有当前这一项：用嵌套内容替换整个列表
          const listStart = $from.before(listDepth)
          const listEnd = $from.after(listDepth)
          const tr = view.state.tr.replaceWith(listStart, listEnd, nestedNodes)
          tr.setSelection(TextSelection.create(tr.doc, listStart + 1))
          view.dispatch(tr)
        } else {
          // 列表有多项：删除当前列表项，将嵌套内容插入到列表之后
          const itemStart = $from.before(listItemDepth)
          const itemEnd = $from.after(listItemDepth)
          const afterList = $from.after(listDepth)
          const tr = view.state.tr
          tr.delete(itemStart, itemEnd)
          // 删除后位置偏移
          const offset = itemEnd - itemStart
          const insertPos = afterList - offset
          nestedNodes.forEach((node, i) => {
            tr.insert(insertPos + i, node)
          })
          view.dispatch(tr)
        }
      }

      event.preventDefault()
      return true
    }
  }
})

// GFM 表格 cellContent 为 'paragraph'（单段落），prosemirror-tables 的 mergeCells
// 在合并多个有内容的单元格时会产生多段落，违反 schema 并破坏 markdown 序列化。
// 这里在合并前检查：如果有 >1 个格子有内容，阻止合并并弹出提示。
function countNonEmptyCellsInSelection(state: import('@milkdown/prose/state').EditorState): number {
  if (!(state.selection instanceof CellSelection)) return 0
  try {
    const rect = selectedRect(state)
    const { map } = rect
    const seen = new Set<number>()
    let count = 0
    for (let row = rect.top; row < rect.bottom; row++) {
      for (let col = rect.left; col < rect.right; col++) {
        const cellPos = map.map[row * map.width + col]!
        if (seen.has(cellPos)) continue
        seen.add(cellPos)
        const cell = rect.table.nodeAt(cellPos)
        if (!cell) continue
        const hasContent = cell.textContent.trim().length > 0
        if (hasContent) count++
      }
    }
    return count
  } catch {
    return 0
  }
}

const mergeCellsCombineContent = (state: import('@milkdown/prose/state').EditorState, dispatch?: (tr: import('@milkdown/prose/state').Transaction) => void): boolean => {
  if (countNonEmptyCellsInSelection(state) > 1) {
    // dispatch 为空时是 canRun 干跑检测，不弹提示；有 dispatch 才是真正执行
    if (dispatch) {
      toast.add({
        title: '无法合并',
        description: '请先清空多余单元格的内容，仅保留一个单元格有内容后再合并',
        color: 'warning'
      })
    }
    return false
  }
  return mergeCells(state, dispatch)
}

type TableEditCommand = TableCommand

const runTableEditCommandOnView = (view: import('@milkdown/prose/view').EditorView, command: TableEditCommand) => {
  if (props.readonly) return false
  if (!isInTable(view.state)) return false

  const executed = command(view.state, tr => view.dispatch(tr))
  if (!executed) return false

  // 表格结构变化后，按当前容器宽度重新收敛一次列宽，避免新增/删除列后比例漂移
  runEditorTimeout(() => {
    if (isEditorDestroying.value || !isEditorCreated.value) return
    rescaleTableColwidthsToContainer(view)
    updateTableQuickActionsPosition()
  }, 0)
  return true
}

const runTableEditCommand: (ctx: Ctx, command: TableEditCommand) => void = (ctx, command) => {
  const view = ctx.get(editorViewCtx)
  runTableEditCommandOnView(view, command)
}

const canRunTableQuickAction = (command: TableEditCommand, options?: { preserveSelection?: boolean }) => {
  if (props.readonly || isTableColumnResizing.value) return false
  const view = getEditorViewSafe()
  if (!view || !isInTable(view.state)) return false

  // 合并单元格依赖 CellSelection，普通 TextSelection 不显示可用态
  if (options?.preserveSelection && (command === mergeCells || command === mergeCellsCombineContent) && !(view.state.selection instanceof CellSelection)) {
    return false
  }

  try {
    return Boolean(command(view.state))
  } catch {
    return false
  }
}

const focusTableCellForQuickAction = (view: import('@milkdown/prose/view').EditorView, cellEl: HTMLTableCellElement) => {
  if (!view.dom.contains(cellEl)) return false
  try {
    const beforePos = view.posAtDOM(cellEl, 0)
    const insidePos = Math.min(Math.max(1, beforePos + 1), view.state.doc.content.size)
    const selection = TextSelection.near(view.state.doc.resolve(insidePos))
    view.dispatch(view.state.tr.setSelection(selection))
    return true
  } catch {
    return false
  }
}

const runTableQuickAction = (
  command: TableEditCommand,
  options?: {
    preserveSelection?: boolean
    failHint?: string
  }
) => {
  if (props.readonly || isTableColumnResizing.value) return
  const view = getEditorViewSafe()
  const cellEl = getActiveTableQuickActionCell()
  if (!view || !cellEl) return

  view.focus()
  if (!options?.preserveSelection) {
    if (!focusTableCellForQuickAction(view, cellEl)) return
  }

  const executed = runTableEditCommandOnView(view, command)
  if (!executed && options?.failHint) {
    toast.add({
      title: options.failHint,
      color: 'warning'
    })
  }
}

// Formatting Handlers
const _toggleFormat = (command: { key: string }) => {
  crepe?.editor.action(callCommand(command.key))
  // Keep sidebar visible but maybe update position if selection changed?
  // Actually, formatting might keep selection, so button stays.
}

// AI 工具栏按钮点击 → 打开下拉菜单
const openAiMenu = () => {
  if (props.readonly || !crepe) return
  const view = getEditorViewSafe()
  if (!view) return
  const { selection } = view.state
  if (selection.empty || !(selection instanceof TextSelection)) return
  const text = view.state.doc.textBetween(selection.from, selection.to)
  if (text.trim().length < 2) return

  aiSelectedText.value = text
  aiSelectionRange.value = { from: selection.from, to: selection.to }

  // 定位到工具栏 AI 按钮（最后一个 .toolbar-item）下方
  const toolbar = editorRef.value?.querySelector('.milkdown-toolbar') as HTMLElement
  const allItems = toolbar?.querySelectorAll('.toolbar-item')
  const aiBtn = allItems?.[allItems.length - 1] as HTMLElement
  if (aiBtn) {
    const rect = aiBtn.getBoundingClientRect()
    aiMenuPosition.value = {
      top: rect.bottom + 4,
      left: rect.left
    }
  } else {
    // 兜底：定位到选区末尾下方
    const coords = view.coordsAtPos(selection.to)
    aiMenuPosition.value = {
      top: coords.top + 60,
      left: coords.left
    }
  }
  aiMenuVisible.value = true
}

const handleAiApply = (newText: string) => {
  if (!crepe || !aiSelectionRange.value) return
  const view = getEditorViewSafe()
  if (!view) return

  const { from, to } = aiSelectionRange.value

  // 用 Milkdown parser 将 Markdown 解析为 ProseMirror 节点，避免特殊字符被转义
  let parser
  try {
    parser = crepe.editor.ctx.get(parserCtx)
  } catch {
    return
  }
  const doc = parser(newText)
  // 提取文档内容（跳过最外层 doc 节点）
  const fragment = doc.content
  const tr = view.state.tr.replaceWith(from, to, fragment)
  view.dispatch(tr)

  aiMenuVisible.value = false
  aiSelectionRange.value = null
}

const handleAiMenuClose = () => {
  aiMenuVisible.value = false
  aiSelectionRange.value = null
}

// ── 汇智云粘贴板 ──────────────────────────────────────
const { user: authUser } = useAuth()

/** 将选中内容序列化为 Markdown 并发送到汇智云粘贴板 */
const copyToCloudClipboard = async () => {
  if (!crepe) return
  const view = getEditorViewSafe()
  if (!view) return
  const { selection } = view.state
  if (selection.empty) {
    toast.add({ title: '请先选中内容', color: 'warning' })
    return
  }

  const uid = String(authUser.value || '').trim()
  if (!uid) {
    toast.add({ title: '未登录，无法使用粘贴板', color: 'error' })
    return
  }

  // 将选区切片序列化为 Markdown
  let markdown = ''
  try {
    const serializer = crepe.editor.ctx.get(serializerCtx)
    const slice = view.state.selection.content()
    const tempDoc = view.state.schema.topNodeType.create(null, slice.content)
    markdown = serializer(tempDoc)
  } catch {
    // 降级：纯文本
    markdown = view.state.doc.textBetween(selection.from, selection.to, '\n')
  }

  if (!markdown.trim()) {
    toast.add({ title: '选中内容为空', color: 'warning' })
    return
  }

  try {
    await $fetch('/api/account/clipboard', {
      method: 'POST',
      body: { uid, content: markdown, contentType: 'markdown', sourceApp: 'codocs' }
    })
    toast.add({ title: '已复制到汇智云粘贴板', color: 'success' })
  } catch {
    toast.add({ title: '复制到粘贴板失败', color: 'error' })
  }
}

/** 从汇智云粘贴板获取内容并插入到光标位置 */
const pasteFromCloudClipboard = async () => {
  if (!crepe) return
  const view = getEditorViewSafe()
  if (!view) return

  const uid = String(authUser.value || '').trim()
  if (!uid) {
    toast.add({ title: '未登录，无法使用粘贴板', color: 'error' })
    return
  }

  try {
    const res = await $fetch<{ code: number, data: { content: string, contentType: string } | null }>('/api/account/clipboard', {
      params: { uid }
    })

    if (!res.data) {
      toast.add({ title: '粘贴板为空或已过期', color: 'warning' })
      return
    }

    const { content } = res.data

    // 用 Milkdown parser 将 Markdown 解析为 ProseMirror 节点并插入
    const parser = crepe.editor.ctx.get(parserCtx)
    const parsed = parser(content)
    const fragment = parsed.content

    const { from, to } = view.state.selection
    const tr = view.state.tr.replaceWith(from, to, fragment)
    view.dispatch(tr)

    toast.add({ title: '已从汇智云粘贴板粘贴', color: 'success' })
  } catch {
    toast.add({ title: '从粘贴板粘贴失败', color: 'error' })
  }
}

const editorToolbarConfig = createEditorToolbarConfig({
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
})

// 获取颜色模式
const colorMode = useColorMode()

// 监听颜色模式变化，重新初始化 Mermaid 并清除缓存（主题色变化后旧 SVG 失效）
watch(() => colorMode.value, () => {
  mermaidSvgCache.clearMemory()
  initEditorMermaid(colorMode.value === 'dark')
})

// 初始化
initEditorMermaid(colorMode.value === 'dark')

onMounted(async () => {
  isEditorDestroying.value = false
  // 等待下一个 tick 确保 DOM 已渲染
  await nextTick()

  if (editorRef.value) {
    try {
      await initEditor()
    } catch (error) {
      console.error('Crepe editor initialization failed:', error)
    }
  }

  window.addEventListener('resize', scheduleReadonlyCodeBlockRefresh)
})

onUnmounted(() => {
  isEditorDestroying.value = true
  teardownBlockHandlePointerRelay()
  teardownTableQuickActions()
  teardownReadonlyCodeBlockObserver()
  mermaidPreview.cleanup()
  window.removeEventListener('resize', scheduleReadonlyCodeBlockRefresh)
  tableLayoutObserver?.disconnect()
  tableLayoutObserver = null
  mermaidSvgCache.destroy()
  if (collaborationSyncFrame !== null) {
    window.cancelAnimationFrame(collaborationSyncFrame)
    collaborationSyncFrame = null
  }
  if (colwidthRestoreTimer !== null) {
    window.clearTimeout(colwidthRestoreTimer)
    pendingTimeouts.delete(colwidthRestoreTimer)
    colwidthRestoreTimer = null
  }
  if (tableMergeRestoreTimer !== null) {
    window.clearTimeout(tableMergeRestoreTimer)
    pendingTimeouts.delete(tableMergeRestoreTimer)
    tableMergeRestoreTimer = null
  }
  for (const timeoutId of pendingTimeouts) {
    window.clearTimeout(timeoutId)
  }
  pendingTimeouts.clear()
  // 在销毁编辑器前先断开协作服务，防止 collab 插件在销毁过程中 dispatch 事务
  if (crepe && collaborationServiceBound) {
    try {
      const collabService = crepe.editor.ctx.get(collabServiceCtx)
      collabService.disconnect()
    } catch {
      // 上下文可能已被清除，忽略
    }
    collaborationServiceBound = false
  }
  if (crepe) {
    crepe.destroy()
    crepe = null
  }
  isEditorCreated.value = false
})

const initEditor = async () => {
  if (!editorRef.value) {
    console.error('Editor ref not available')
    return
  }

  console.log('Initializing Crepe editor with root:', editorRef.value)

  crepe = new Crepe({
    root: editorRef.value as unknown as Node,
    defaultValue: isCollaborationActive.value ? '' : (props.modelValue || ''),
    features: {
      [CrepeFeature.CodeMirror]: true,
      [CrepeFeature.ListItem]: true,
      [CrepeFeature.LinkTooltip]: true,
      [CrepeFeature.Cursor]: !props.readonly, // Disable custom cursor in readonly to allow text selection
      [CrepeFeature.ImageBlock]: true,
      [CrepeFeature.BlockEdit]: !props.readonly, // Disable block editing in readonly
      [CrepeFeature.Toolbar]: !props.readonly, // Disable toolbar in readonly
      [CrepeFeature.Placeholder]: true,
      // 关闭 Crepe Table NodeView，改用 prosemirror-tables 的稳定 TableView（含 tableWrapper+colgroup）
      [CrepeFeature.Table]: false,
      [CrepeFeature.Latex]: true
    },
    featureConfigs: {
      [CrepeFeature.Placeholder]: {
        text: '请输入......'
      },
      [CrepeFeature.CodeMirror]: {
        renderPreview: (language: string, content: string, _applyPreview: (html: string) => void) =>
          mermaidPreview.renderPreview(language, content)
      },
      [CrepeFeature.BlockEdit]: editorToolbarConfig.blockEdit,
      [CrepeFeature.Toolbar]: editorToolbarConfig.toolbar,
      [CrepeFeature.ImageBlock]: {
        blockConfirmButton: '确认',
        blockUploadButton: '上传图片',
        blockCaptionPlaceholderText: '输入图片标题...',
        blockUploadPlaceholderText: '或粘贴图片链接',
        inlineUploadButton: '上传',
        inlineConfirmButton: '确认',
        inlineUploadPlaceholderText: '或粘贴链接',
        onUpload: handleImageBlockUpload
      }
    }
  })

  crepe.editor
    .config((ctx) => {
      // 启用 remark-breaks 插件，使单行回车也解析为换行
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.update(remarkPluginsCtx, prev => [...prev, remarkBreaks as any])

      // Register editor behavior plugins
      const TABLE_CELL_MIN_WIDTH = 40
      const ensureTableColgroupPlugin = createEnsureTableColgroupPlugin({
        tableCellMinWidth: TABLE_CELL_MIN_WIDTH,
        getEditorView: getEditorViewSafe,
        getIsEditorDestroying: () => isEditorDestroying.value,
        getIsEditorCreated: () => isEditorCreated.value,
        getIsTableColumnResizing: () => isTableColumnResizing.value,
        setIsTableColumnResizing: (value) => {
          isTableColumnResizing.value = value
        },
        lockTableLayoutRescale,
        runLater: runEditorTimeout,
        cancelLater: cancelEditorTimeout
      })
      // lastColumnResizable: false —— 禁止拖拽最后一列右边缘，避免右侧边界手柄误触
      ctx.update(prosePluginsCtx, prev => [...prev, emptyListItemBackspacePlugin, headingBackspaceGuardPlugin, annotationPlugin, columnResizing({ defaultCellMinWidth: TABLE_CELL_MIN_WIDTH, View: StableEditorTableView, lastColumnResizable: false }), ensureTableColgroupPlugin])

      ctx.update(uploadConfig.key, prev => ({
        ...prev,
        uploader
      }))
    })
    .use(upload)
    .use(collab)

  // 创建编辑器 - 这是关键步骤！
  await crepe.create()
  isEditorCreated.value = true
  lastKnownEditorMarkdown = props.modelValue || ''
  setupBlockHandlePointerRelay()
  setupTableQuickActions()
  setupReadonlyCodeBlockObserver()
  scheduleReadonlyCodeBlockRefresh()

  // 初始化时先恢复 markdown 中编码的列宽。
  // 这里保留两次调度，是为了兼容 Crepe 初始渲染时 table DOM 尚未完全就绪的情况。
  scheduleColwidthRestoreFromModel(0)
  scheduleTableMergeRestoreFromModel(20)
  scheduleColwidthRestoreFromModel(120)
  scheduleTableMergeRestoreFromModel(180)

  const editorView = getEditorViewSafe()
  if (editorView) {
    tableLayoutObserver?.disconnect()
    tableLayoutObserver = new ResizeObserver(() => {
      if (isTableColumnResizing.value || isEditorDestroying.value || !isEditorCreated.value) return
      if (isTableLayoutRescaleLocked()) return

      // 容器变化时，先节流恢复一次缺失的 colwidth，再按当前容器宽度重算。
      scheduleColwidthRestoreFromModel(16, undefined, true)
      runEditorTimeout(() => {
        if (isTableColumnResizing.value || isEditorDestroying.value || !isEditorCreated.value) return
        if (isTableLayoutRescaleLocked()) return
        rescaleTableColwidthsToContainer(editorView)
      }, 16)
    })
    tableLayoutObserver.observe(editorView.dom)
    const wrapper = editorView.dom.closest('.crepe-wrapper')
    if (wrapper) {
      tableLayoutObserver.observe(wrapper)
    }
  }

  // 只有在编辑器完全创建后，才开始监听内容变化
  // 这样可以避免初始化过程中产生的空内容或占位符触发父组件的保存逻辑
  let lastEmittedMarkdown = ''
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      // 源码模式以 textarea 内容为唯一数据源，隐藏编辑器的内部更新不能反向覆盖源码文本
      if (props.viewMode === 'source') return
      const encoded = encodeTableMergeInMarkdownWithEditor(
        encodeColwidthInMarkdownWithEditor(markdown)
      )
      lastKnownEditorMarkdown = encoded
      // 防止内容未实际变化时的重复 emit（列宽微调、合并元数据追加等场景
      // 容易产生微小差异 → 父组件 v-model 写回 → 后续链路再次触发，形成循环）
      if (encoded === lastEmittedMarkdown) return
      lastEmittedMarkdown = encoded
      emit('update:modelValue', encoded)
      emit('change', encoded)
    })
  })

  // 绑定块句柄点击事件 - 实现点击六个点选中段落
  // 使用 mousedown 捕获阶段拦截，防止 ProseMirror 处理光标移动
  if (editorRef.value) {
    editorRef.value.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement
      const operationItem = target.closest('.operation-item')
      const handle = target.closest('.milkdown-block-handle')

      // 只处理拖拽图标（六个点），不处理添加图标（加号）
      if (handle && operationItem) {
        const items = handle.querySelectorAll('.operation-item')

        // 加号（第一个 operation-item）：让 Milkdown 原生处理
        if (items.length >= 1 && operationItem === items[0]) {
          return
        }

        // 六个点的拖拽图标（第二个 operation-item）
        if (items.length >= 2 && operationItem === items[1]) {
          e.preventDefault()
          e.stopPropagation()

          const view = getEditorViewSafe()
          if (!view) return

          // 关键：先聚焦编辑器，再等焦点生效后设置选区
          // Crepe 工具栏的 shouldShow 会检查 view.hasFocus()
          // 如果先设选区再 focus，首次点击时 hasFocus()=false，工具栏不会显示
          view.focus()

          const handleRect = handle.getBoundingClientRect()

          // 延迟设置选区，确保 focus 已生效（匹配工具栏 debounce: 20ms）
          runEditorTimeout(() => {
            const safeView = getEditorViewSafe()
            if (!safeView) return
            const top = handleRect.top + handleRect.height / 2
            const left = handleRect.right + 20

            const pos = safeView.posAtCoords({ left, top })
            if (pos) {
              const { doc } = safeView.state
              const $pos = doc.resolve(pos.pos)
              const depth = $pos.depth
              const start = $pos.start(depth)
              const end = $pos.end(depth)
              const selection = TextSelection.create(doc, start, end)
              safeView.dispatch(safeView.state.tr.setSelection(selection))
            }
          }, 30)
        }
      }
    }, true)
  }

  isLoading.value = false

  // 从初始 Markdown 分隔行横线数量恢复表格列宽
  // 协同模式下内容由 Y.Doc 同步填充，需要监听 modelValue 变化后再应用
  if (props.modelValue) {
    scheduleColwidthRestoreFromModel(0)
    scheduleTableMergeRestoreFromModel(20)
  } else {
    // 协同模式下 modelValue 初始为空，等待首次内容填充后恢复列宽
    const stopColwidthWatch = watch(() => props.modelValue, (newVal) => {
      if (newVal) {
        scheduleColwidthRestoreFromModel(0)
        scheduleTableMergeRestoreFromModel(20)
        stopColwidthWatch()
      }
    })
  }

  emit('ready')

  watch(() => props.modelValue, () => {
    nextTick(() => {
      scheduleReadonlyCodeBlockRefresh()
    })
  })

  watch(() => props.readonly, () => {
    nextTick(() => {
      syncReadonlyCodeBlockObserver()
      if (props.readonly || props.viewMode === 'source') {
        hideTableQuickActions()
      } else {
        setupTableQuickActions()
      }
    })
  })

  watch(() => props.viewMode, () => {
    nextTick(() => {
      syncReadonlyCodeBlockObserver()
      if (props.viewMode === 'source' || props.readonly) {
        hideTableQuickActions()
      } else {
        setupTableQuickActions()
      }
    })
  })
  console.log('Crepe editor created successfully with Mermaid support')
}

const syncCollaborationService = () => {
  if (!crepe || !isEditorCreated.value) return

  const collabService = getCollaborationServiceSafe()
  if (!collabService) return

  if (!props.collaborationEnabled || !props.collaborationDoc) {
    collabService.disconnect()
    return
  }

  // 源码模式下断开协同服务，防止 Y.Doc XML 与源码编辑冲突
  if (props.viewMode === 'source') {
    collabService.disconnect()
    return
  }

  if (!collaborationServiceBound) {
    collabService.bindDoc(props.collaborationDoc)
    collaborationServiceBound = true
  }

  if (props.collaborationAwareness) {
    collabService.setAwareness(props.collaborationAwareness)
  }

  // 源码模式切回编辑模式时：先 connect 让 ySyncPlugin 接管，
  // 再在单个 Y 事务里 delete + applyTemplate，避免 disconnect 期间产生的本地 ops 与服务器 state 合并翻倍
  if (pendingSourceToEditSync) {
    pendingSourceToEditSync = false
    collabService.connect()
    if (props.modelValue) {
      try {
        const sourceMarkdown = props.modelValue
        const { cleanMarkdown } = parseTableMergeMetaFromMarkdown(sourceMarkdown)
        const xmlFragment = props.collaborationDoc.getXmlFragment('prosemirror')
        const markdownMirror = props.collaborationDoc.getText('content')
        props.collaborationDoc.transact(() => {
          if (xmlFragment.length > 0) {
            xmlFragment.delete(0, xmlFragment.length)
          }
          if (markdownMirror.length > 0) {
            markdownMirror.delete(0, markdownMirror.length)
          }
        }, 'source-mode-sync')
        collabService.applyTemplate(cleanMarkdown)
        // applyTemplate 已同步推动 ySyncPlugin 更新 PM doc，立即（同一执行栈）dispatch
        // colwidth，浏览器只会绘制一次（带 colwidth 的结果），避免先均分再跳正常的闪烁。
        lockTableLayoutRescale()
        applyColwidthFromMarkdownToEditor(cleanMarkdown)
        scheduleTableMergeRestoreFromModel(20, sourceMarkdown)
      } catch {
        // Y.Doc fragment 清理失败，忽略
      }
    }
    return
  }

  // applyTemplate 仅用于首次 bootstrap：要求 prosemirror fragment 和 content text 都为空
  // 否则 CRDT 合并时会和服务器已有的 Y state 产生双份 ops，导致文档末尾追加全文
  if (props.modelValue) {
    const { cleanMarkdown } = parseTableMergeMetaFromMarkdown(props.modelValue)
    const existingFragment = props.collaborationDoc.getXmlFragment('prosemirror')
    const existingText = props.collaborationDoc.getText('content')
    if (existingFragment.length === 0 && existingText.length === 0) {
      collabService.applyTemplate(cleanMarkdown)
    } else if (existingFragment.length === 0 && existingText.length > 0) {
      // 服务端 .md fallback 路径：content 有但 fragment 空。
      // 将文本镜像升级为真正的 ProseMirror fragment，并清空旧镜像，避免后续保存继续读取旧 content。
      const sourceMarkdown = existingText.toString() || props.modelValue
      const { cleanMarkdown: cleanFallbackMarkdown } = parseTableMergeMetaFromMarkdown(sourceMarkdown)
      props.collaborationDoc.transact(() => {
        if (existingText.length > 0) {
          existingText.delete(0, existingText.length)
        }
      }, 'markdown-text-bootstrap')
      collabService.applyTemplate(cleanFallbackMarkdown)
      lockTableLayoutRescale()
      applyColwidthFromMarkdownToEditor(cleanFallbackMarkdown)
      scheduleTableMergeRestoreFromModel(20, sourceMarkdown)
    }
  }

  collabService.connect()

  // 初始 Y-sync 渲染校正：
  // 协同模式下，如果 Y.Doc 在编辑器 display:none 阶段就已经有内容，ySyncPlugin 首次 sync
  // 会把内容写入 PM doc，但 view 的 DOM 可能没触发重绘（具体表现：图文页空白，大纲能显示；
  // 手动切到源码再切回来会强制 delete fragment + applyTemplate 重建，DOM 随之恢复）。
  // 这里在 connect 后延迟检测：如果 PM doc 有内容但 view.dom 几乎没文本，说明渲染失败，
  // 自动走一遍「delete fragment + applyTemplate」的 reset 流程。
  runEditorTimeout(() => {
    if (isEditorDestroying.value || !isEditorCreated.value) return
    if (!props.collaborationDoc) return
    if (props.viewMode !== 'edit') return
    const view = getEditorViewSafe()
    if (!view) return
    const docTextLen = view.state.doc.textContent.length
    const domTextLen = (view.dom.textContent || '').length
    // PM doc 非空但 DOM 几乎空（≤ 10% 同步率），视作初始渲染失败
    if (docTextLen > 20 && domTextLen < docTextLen * 0.1) {
      const sourceMarkdown = props.modelValue
      if (!sourceMarkdown) return
      try {
        const { cleanMarkdown } = parseTableMergeMetaFromMarkdown(sourceMarkdown)
        const fragment = props.collaborationDoc.getXmlFragment('prosemirror')
        props.collaborationDoc.transact(() => {
          if (fragment.length > 0) fragment.delete(0, fragment.length)
        }, 'init-sync-recovery')
        collabService.applyTemplate(cleanMarkdown)
      } catch {
        // 忽略恢复失败，不影响主流程
      }
    }
  }, 400)
}

const scheduleSyncCollaborationService = () => {
  if (isEditorDestroying.value) return
  if (collaborationSyncFrame !== null) {
    window.cancelAnimationFrame(collaborationSyncFrame)
  }

  collaborationSyncFrame = window.requestAnimationFrame(() => {
    collaborationSyncFrame = window.requestAnimationFrame(() => {
      collaborationSyncFrame = null
      syncCollaborationService()
    })
  })
}

const applyTableMergeFromMarkdown = (md: string, attempt = 0) => {
  if (!crepe || isEditorDestroying.value) return

  const { tables } = parseTableMergeMetaFromMarkdown(md)
  if (!tables.some(table => table.length > 0)) return

  let hasMissingTable = false
  let changed = false

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const merges = tables[tableIndex] || []
    if (!merges.length) continue

    for (const merge of merges) {
      const view = getEditorViewSafe()
      if (!view) return

      const tableInfo = getTableByIndex(view.state.doc, tableIndex)
      if (!tableInfo) {
        hasMissingTable = true
        continue
      }

      const tableNode = tableInfo.node
      const map = TableMap.get(tableNode)

      const bottomRow = merge.row + merge.rowspan - 1
      const rightCol = merge.col + merge.colspan - 1
      if (
        merge.row < 0
        || merge.col < 0
        || bottomRow >= map.height
        || rightCol >= map.width
      ) continue

      const anchorRelativePos = map.positionAt(merge.row, merge.col, tableNode)
      const headRelativePos = map.positionAt(bottomRow, rightCol, tableNode)
      // tableInfo.pos 是 table 节点之前的位置；表格内容起始位置需要 +1
      // （prosemirror-tables 内部也是 start + positionAt 的用法）
      const tableContentStart = tableInfo.pos + 1
      const anchorPos = tableContentStart + anchorRelativePos
      const headPos = tableContentStart + headRelativePos

      let selectionApplied = false
      try {
        const selection = CellSelection.create(view.state.doc, anchorPos, headPos)
        const tr = view.state.tr.setSelection(selection)
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
        selectionApplied = true
      } catch {
        selectionApplied = false
      }
      if (!selectionApplied) continue

      const merged = mergeCells(view.state, (tr) => {
        tr.setMeta('addToHistory', false)
        view.dispatch(tr)
      })
      if (merged) changed = true
    }
  }

  if (changed) {
    // 合并单元格只改变 ProseMirror 节点的 colspan/rowspan 属性，
    // 序列化后的 Markdown 文本不变，因此 Milkdown 的 markdownUpdated 不会触发。
    // 这里手动把带 HZY_TABLE_MERGE 注释的 Markdown 回写到 modelValue，
    // 避免源码模式切回后注释被之前的 cleanMarkdown emit 覆盖丢失。
    if (props.viewMode === 'edit' && crepe) {
      try {
        const plainMd = crepe.getMarkdown()
        const encoded = encodeTableMergeInMarkdownWithEditor(
          encodeColwidthInMarkdownWithEditor(plainMd),
          true
        )
        if (encoded && encoded !== props.modelValue) {
          emit('update:modelValue', encoded)
          emit('change', encoded)
        }
      } catch {
        // 忽略序列化失败
      }
    }
    runEditorTimeout(() => {
      updateTableQuickActionsPosition()
    }, 0)
  }

  if (hasMissingTable && attempt < 6) {
    runEditorTimeout(() => {
      applyTableMergeFromMarkdown(md, attempt + 1)
    }, 50 * (attempt + 1))
  }
}

const scheduleTableMergeRestoreFromModel = (delay = 0, markdown?: string, throttleKey = false) => {
  if (typeof window === 'undefined' || isEditorDestroying.value) return
  const source = markdown ?? props.modelValue ?? ''
  if (!source || !isEditorCreated.value || props.viewMode !== 'edit') return

  if (throttleKey && tableMergeRestoreTimer !== null) {
    cancelEditorTimeout(tableMergeRestoreTimer)
    tableMergeRestoreTimer = null
  }

  const timerId = runEditorTimeout(() => {
    if (throttleKey) tableMergeRestoreTimer = null
    applyTableMergeFromMarkdown(source)
  }, delay)

  if (throttleKey && timerId !== null) {
    tableMergeRestoreTimer = timerId
  }
}

// ========== Markdown 读写 ==========

// 获取 Markdown 内容（保存时编码列宽到分隔行）
const getMarkdown = (): string => {
  if (!crepe || isEditorDestroying.value) return ''
  const md = crepe.getMarkdown() || ''
  return encodeTableMergeInMarkdownWithEditor(
    encodeColwidthInMarkdownWithEditor(md),
    true
  )
}

// 设置 Markdown 内容（加载后恢复列宽）
const setMarkdown = (value: string) => {
  if (!crepe || isEditorDestroying.value) return

  try {
    lastKnownEditorMarkdown = value
    const { cleanMarkdown } = parseTableMergeMetaFromMarkdown(value)
    crepe.editor.action(replaceAll(cleanMarkdown))
    scheduleColwidthRestoreFromModel(0, cleanMarkdown)
    scheduleTableMergeRestoreFromModel(20, value)
  } catch {
    // 编辑器销毁阶段忽略同步写入
  }
}

// 在文档末尾追加 Markdown 内容（不替换已有内容，避免重建已有节点）
const appendMarkdown = (value: string) => {
  if (!crepe || isEditorDestroying.value || !value.trim()) return
  const currentMarkdown = getMarkdown()
  const { cleanMarkdown: currentCleanMarkdown } = parseTableMergeMetaFromMarkdown(currentMarkdown)
  const { cleanMarkdown } = parseTableMergeMetaFromMarkdown(value)
  if (!cleanMarkdown.trim()) return
  crepe.editor.action((ctx: Ctx) => {
    const view = ctx.get(editorViewCtx)
    const parser = ctx.get(parserCtx)
    const parsed = parser(cleanMarkdown)
    const endPos = view.state.doc.content.size
    const tr = view.state.tr.insert(endPos, parsed.content)
    view.dispatch(tr)
  })

  const combinedMarkdown = [currentCleanMarkdown.trimEnd(), value.trimStart()]
    .filter(Boolean)
    .join('\n\n')
  lastKnownEditorMarkdown = combinedMarkdown
  scheduleColwidthRestoreFromModel(0, combinedMarkdown)
  scheduleTableMergeRestoreFromModel(20, combinedMarkdown)
}

useEditorModeSync({
  viewMode: computed(() => props.viewMode),
  modelValue: computed(() => props.modelValue),
  sourceTextareaRef,
  editorRef,
  collaborationEnabled: computed(() => Boolean(props.collaborationEnabled)),
  collaborationDocPresent: computed(() => Boolean(props.collaborationDoc)),
  isEditorDestroying,
  getEditorView: getEditorViewSafe,
  applySourceMarkdownToEditor: (cleanMarkdown) => {
    if (!crepe || cleanMarkdown === crepe.getMarkdown()) return
    crepe.editor.action(replaceAll(cleanMarkdown))
  },
  applyColwidthFromMarkdownSync: (cleanMarkdown) => {
    lockTableLayoutRescale()
    applyColwidthFromMarkdownToEditor(cleanMarkdown)
  },
  markPendingSourceToEditSync: () => {
    pendingSourceToEditSync = true
  },
  parseTableMergeMetaFromMarkdown,
  scheduleTableMergeRestoreFromModel,
  runLater: runEditorTimeout,
  encodeEditorMarkdownForModel: getMarkdown,
  emitModelValue: (value) => {
    emit('update:modelValue', value)
  },
  emitChange: (value) => {
    emit('change', value)
  }
})

watch(
  () => [isEditorCreated.value, props.collaborationDoc, props.collaborationAwareness, props.collaborationEnabled, props.viewMode] as const,
  () => {
    nextTick(() => {
      scheduleSyncCollaborationService()
    })
  },
  { immediate: true }
)

// 处理源码模式下的输入
const handleSourceInput = (e: Event) => {
  const target = e.target as HTMLInputElement
  const value = target.value
  emit('update:modelValue', value)
  emit('change', value)
}

// 暴露方法给父组件
const switchToTab = (tab: 'outline' | 'history' | 'share' | 'annotations' | 'ai') => {
  sidebarRef.value?.switchToTab(tab)
}

defineExpose({
  getMarkdown,
  setMarkdown,
  appendMarkdown,
  switchToTab
})
</script>

<template>
  <div class="crepe-container" :class="{ 'with-sidebar': showSidebar }" :style="{ height: containerHeight }">
    <div class="crepe-wrapper group relative">
      <!-- Loading 状态 -->
      <div v-if="isLoading" class="crepe-loading">
        <div class="loading-spinner" />
        <span class="loading-text">编辑器加载中...</span>
      </div>

      <!-- 编辑器容器 -->
      <div
        ref="editorRef"
        class="crepe-editor relative"
        :style="readonlyWatermarkStyle"
        :class="{
          'crepe-readonly': readonly,
          'crepe-hidden': isLoading || viewMode === 'source',
          'crepe-visible': !isLoading && viewMode !== 'source',
          [`milkdown-theme-${theme}`]: true
        }"
      />

      <button
        v-for="block in readonlyCodeBlocks"
        :key="block.id"
        type="button"
        class="readonly-code-copy-btn absolute z-30 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium shadow-sm"
        :style="{ top: `${block.top}px`, right: `${block.right}px` }"
        @click="copyReadonlyCodeBlock(block.text)"
      >
        <UIcon name="i-lucide-copy" class="h-3.5 w-3.5" />
        复制
      </button>

      <button
        v-for="link in readonlyLinks"
        :key="link.id"
        type="button"
        class="readonly-link-copy-btn absolute z-30 inline-flex items-center justify-center rounded-full border shadow-sm"
        :style="{ top: `${link.top}px`, left: `${link.left}px` }"
        :title="`复制链接: ${link.href}`"
        @click="copyReadonlyLink(link.href)"
      >
        <UIcon name="i-lucide-copy" class="h-3 w-3" />
      </button>

      <div
        v-if="tableQuickActions.visible && !readonly && viewMode !== 'source'"
        class="table-quick-actions absolute inset-0 pointer-events-none z-40"
      >
        <div
          class="pointer-events-auto absolute table-quick-actions-group"
          :style="{ top: `${tableQuickActions.rowTop}px`, left: `${tableQuickActions.rowLeft}px` }"
        >
          <button
            type="button"
            class="table-quick-action-btn"
            title="上方插入行"
            @mousedown.prevent.stop="runTableQuickAction(addRowBefore)"
          >
            <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="table-quick-action-btn table-quick-action-btn-danger"
            title="删除当前行"
            @mousedown.prevent.stop="runTableQuickAction(deleteRow)"
          >
            <UIcon name="i-lucide-minus" class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="table-quick-action-btn"
            title="下方插入行"
            @mousedown.prevent.stop="runTableQuickAction(addRowAfter)"
          >
            <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          class="pointer-events-auto absolute table-quick-actions-group table-quick-actions-group-horizontal"
          :style="{ top: `${tableQuickActions.colTop}px`, left: `${tableQuickActions.colLeft}px` }"
        >
          <button
            type="button"
            class="table-quick-action-btn"
            title="左侧插入列"
            @mousedown.prevent.stop="runTableQuickAction(addColumnBefore)"
          >
            <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="table-quick-action-btn table-quick-action-btn-danger"
            title="删除当前列"
            @mousedown.prevent.stop="runTableQuickAction(deleteColumn)"
          >
            <UIcon name="i-lucide-minus" class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="table-quick-action-btn"
            title="右侧插入列"
            @mousedown.prevent.stop="runTableQuickAction(addColumnAfter)"
          >
            <UIcon name="i-lucide-plus" class="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          class="pointer-events-auto absolute table-quick-actions-group table-quick-actions-group-horizontal"
          :style="{ top: `${tableQuickActions.toolbarTop}px`, left: `${tableQuickActions.toolbarLeft}px` }"
        >
          <button
            type="button"
            class="table-quick-action-btn"
            title="切换当前行为表头"
            @mousedown.prevent.stop="runTableQuickAction(toggleHeaderRow)"
          >
            <UIcon name="i-lucide-heading-1" class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="table-quick-action-btn table-quick-action-btn-danger"
            title="删除整个表格"
            @mousedown.prevent.stop="runTableQuickAction(deleteTable)"
          >
            <UIcon name="i-lucide-trash-2" class="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          v-show="tableQuickActions.selectionVisible"
          class="pointer-events-auto absolute table-quick-actions-group table-quick-actions-group-horizontal"
          :style="{ top: `${tableQuickActions.selectionTop}px`, left: `${tableQuickActions.selectionLeft}px` }"
        >
          <button
            type="button"
            class="table-quick-action-btn"
            :disabled="!canRunTableQuickAction(mergeCellsCombineContent, { preserveSelection: true })"
            title="合并单元格（先框选多个单元格）"
            @mousedown.prevent.stop="runTableQuickAction(mergeCellsCombineContent, { preserveSelection: true, failHint: '请先框选多个单元格' })"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <rect
                x="7"
                y="7"
                width="10"
                height="10"
                rx="1"
              />
            </svg>
          </button>
          <button
            type="button"
            class="table-quick-action-btn"
            :disabled="!canRunTableQuickAction(splitCell, { preserveSelection: true })"
            title="拆分单元格"
            @mousedown.prevent.stop="runTableQuickAction(splitCell, { preserveSelection: true, failHint: '当前单元格不可拆分' })"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 19H5a2 2 0 0 1-2-2v-2" />
              <path d="M8 5H5a2 2 0 0 0-2 2v2" />
              <path d="M16 19h3a2 2 0 0 0 2-2v-2" />
              <path d="M16 5h3a2 2 0 0 1 2 2v2" />
              <path d="M12 4v16" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 右侧标注图标 Overlay -->
      <div v-show="viewMode !== 'source'" class="absolute top-0 h-full pointer-events-none" :style="overlayStyle">
        <!-- Transparent Backdrop for closing popover -->
        <div
          v-if="activeAnnotationId !== null"
          class="fixed inset-0 z-40 pointer-events-auto"
          @click.stop="activeAnnotationId = null"
        />

        <div
          v-for="icon in marginIcons"
          :key="icon.id"
          class="absolute pointer-events-auto z-50"
          :style="{ top: icon.top + 'px', marginTop: '-4px' }"
        >
          <div class="relative group">
            <!-- Icon -->
            <div
              class="cursor-pointer flex items-center justify-center w-8 h-8 rounded-full shadow-sm border hover:scale-110 transition-transform"
              :class="getAnnotation(icon.id)?.status === 'resolved'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-700'
                : 'bg-white dark:bg-gray-800 text-yellow-600 dark:text-yellow-400 border-gray-200 dark:border-gray-700'"
              @click.stop="toggleAnnotation(icon.id)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="lucide lucide-message-square-text"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M13 8H7" />
                <path d="M17 12H7" />
              </svg>
            </div>

            <!-- Manual Popover Content -->
            <div
              v-if="activeAnnotationId === icon.id && getAnnotation(icon.id)"
              class="absolute right-full top-0 mr-3 w-80 max-w-sm bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden transform origin-top-right transition-all"
            >
              <AnnotationCard
                :annotation="getAnnotation(icon.id)!"
                :show-close="true"
                @close="activeAnnotationId = null"
                @reply="(id, content) => emit('reply-annotation', id, content)"
                @resolve="(id) => emit('resolve-annotation', id)"
                @delete="(id) => emit('delete-annotation', id)"
                @delete-reply="(id, replyId) => emit('delete-reply', id, replyId)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 源码模式编辑器 -->
      <div v-show="viewMode === 'source'" class="crepe-source-editor">
        <textarea
          ref="sourceTextareaRef"
          :value="modelValue"
          class="w-full h-full py-8 px-4 sm:py-16 sm:px-32 font-mono text-sm leading-relaxed bg-white dark:bg-gray-900 border-none outline-none resize-none"
          spellcheck="false"
          placeholder="请输入......"
          @input="handleSourceInput"
        />
      </div>
    </div>

    <!-- 侧边栏（大纲+版本历史+共享+标注）- 移动端隐藏 -->
    <EditorSidebar
      v-if="showSidebar && !isLoading"
      ref="sidebarRef"
      class="hidden sm:block h-full min-h-0 shrink-0"
      :markdown="modelValue || ''"
      :document-id="documentId"
      :versions="versions"
      :versions-loading="versionsLoading"
      :show-version-history="showVersionHistory"
      :show-share-panel="showSharePanel"
      :is-project-doc="docType === 'project'"
      :project-repo-url="projectRepoUrl"
      :doc-path="docPath"
      :view-mode="viewMode"
      :annotations="annotations"
      :allow-share="allowShare"
      :can-manage-shares="canManageShares"
      :active-version-num="activeVersionNum"
      :ai-abstract="aiAbstract"
      :readonly="readonly"
      @close="emit('close-sidebar')"
      @update-abstract="(text: string) => emit('update-abstract', text)"
      @load-versions="emit('load-versions')"
      @view-version="(id) => emit('view-version', id)"
      @diff-version="(id) => emit('diff-version', id)"
      @share="(data) => emit('share', data)"
      @remove-share="(id) => emit('remove-share', id)"
      @update-permission="(data) => emit('update-permission', data)"
      @reply-annotation="(id, content) => emit('reply-annotation', id, content)"
      @resolve-annotation="(id) => emit('resolve-annotation', id)"
      @delete-annotation="(id) => emit('delete-annotation', id)"
      @delete-reply="(id, replyId) => emit('delete-reply', id, replyId)"
      @click-annotation="scrollToAnnotation"
    />

    <AnnotationDialog
      v-model:open="isAnnotationDialogOpen"
      :selected-text="annotationSelection?.text || ''"
      @create="handleCreateAnnotation"
    />

    <!-- AI 下拉菜单（从 Crepe 工具栏 AI 按钮触发） -->
    <EditorAiToolbar
      v-if="!readonly"
      :visible="aiMenuVisible"
      :selected-text="aiSelectedText"
      :position="aiMenuPosition"
      @apply="handleAiApply"
      @close="handleAiMenuClose"
    />
  </div>
</template>

<style>
/* 图片上传中旋转动画 */
.milkdown-image-block .image-icon .animate-spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 编辑器容器布局 */
.crepe-container {
    display: flex;
    width: 100%;
    /* height 通过 style 绑定动态设置 */
    min-height: 0;
    overflow: hidden;
}

.crepe-container.with-sidebar {
    position: relative;
    align-items: stretch;
}

/* Crepe 编辑器包装容器 */
.crepe-wrapper {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow-y: auto;
    /* 内容最小宽度 800，窗口更窄时启用横向滚动 */
    overflow-x: auto;
    position: relative;
    background-color: var(--crepe-color-background, #ffffff);
}

.crepe-editor {
    overflow: visible;
}

@media (min-width: 640px) {
  /* Reserve a deterministic left gutter for Milkdown block handles.
     The handle is appended to .crepe-editor and positioned to the left of the block,
     so this avoids relying on ancestor overflow behavior. */
  .crepe-editor {
    box-sizing: border-box;
    padding-left: 4rem;
  }

  .crepe-editor > .milkdown {
    width: calc(100% + 4rem);
    margin-left: -4rem;
  }
}

.dark .crepe-wrapper {
    background-color: var(--crepe-color-background, #1a1a1a);
}

/* 源码模式编辑器 */
.crepe-source-editor {
    width: 100%;
    min-height: 100%;
}

.crepe-source-editor textarea {
    min-height: calc(100vh - 120px);
    color: var(--crepe-color-on-background);
    background-color: var(--crepe-color-background);
}

/* Loading 状态 */
.crepe-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1rem;
}

.loading-spinner {
    width: 60px;
    height: 60px;
    border: 3px solid #e5e7eb;
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

/* ==================================================================================
   Theme Configurations
   支持 Frame, Classic, Nord 主题切换
   ================================================================================== */

/* --- Theme: Frame (Default) --- */
.milkdown-theme-frame .milkdown {
    --crepe-color-background: #ffffff;
    --crepe-color-on-background: #000000;
    --crepe-color-surface: #f7f7f7;
    --crepe-color-surface-low: #ededed;
    --crepe-color-on-surface: #1c1c1c;
    --crepe-color-on-surface-variant: #4d4d4d;
    --crepe-color-outline: #a8a8a8;
    --crepe-color-primary: #333333;
    --crepe-color-secondary: #cfcfcf;
    --crepe-color-on-secondary: #000000;
    --crepe-color-inverse: #f0f0f0;
    --crepe-color-on-inverse: #1a1a1a;
    --crepe-color-inline-code: #ba1a1a;
    --crepe-color-error: #ba1a1a;
    --crepe-color-hover: #e0e0e0;
    --crepe-color-selected: #d5d5d5;
    --crepe-color-inline-area: #cacaca;

    --crepe-font-title: 'Noto Serif', Cambria, 'Times New Roman', Times, serif;
    --crepe-font-default: 'Noto Sans', Arial, Helvetica, sans-serif;
    --crepe-font-code: 'Space Mono', Fira Code, Menlo, Monaco, 'Courier New', Courier, monospace;

    --crepe-shadow-1: 0px 1px 3px 1px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.3);
    --crepe-shadow-2: 0px 2px 6px 2px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.3);
}

.dark .milkdown-theme-frame .milkdown {
    --crepe-color-background: #1a1a1a;
    --crepe-color-on-background: #e6e6e6;
    --crepe-color-surface: #121212;
    --crepe-color-surface-low: #1c1c1c;
    --crepe-color-on-surface: #d1d1d1;
    --crepe-color-on-surface-variant: #a9a9a9;
    --crepe-color-outline: #757575;
    --crepe-color-primary: #b5b5b5;
    --crepe-color-secondary: #4d4d4d;
    --crepe-color-on-secondary: #d6d6d6;
    --crepe-color-inverse: #e5e5e5;
    --crepe-color-on-inverse: #2a2a2a;
    --crepe-color-inline-code: #ff6666;
    --crepe-color-error: #ff6666;
    --crepe-color-hover: #2a2f36;
    --crepe-color-selected: rgba(120, 170, 255, 0.32);
    --crepe-color-inline-area: #2b2b2b;
}

/* --- Theme: Classic (Crepe) --- */
.milkdown-theme-classic .milkdown {
    --crepe-color-background: #fffdfb;
    --crepe-color-on-background: #1f1b16;
    --crepe-color-surface: #fff8f4;
    --crepe-color-surface-low: #fff1e5;
    --crepe-color-on-surface: #201b13;
    --crepe-color-on-surface-variant: #4f4539;
    --crepe-color-outline: #817567;
    --crepe-color-primary: #805610;
    --crepe-color-secondary: #fbdebc;
    --crepe-color-on-secondary: #271904;
    --crepe-color-inverse: #362f27;
    --crepe-color-on-inverse: #fcefe2;
    --crepe-color-inline-code: #ba1a1a;
    --crepe-color-error: #ba1a1a;
    --crepe-color-hover: #f9ecdf;
    --crepe-color-selected: #ede0d4;
    --crepe-color-inline-area: #e4d8cc;

    --crepe-font-title: Georgia, Cambria, 'Times New Roman', Times, serif;
    --crepe-font-default: 'Open Sans', Arial, Helvetica, sans-serif;
    --crepe-font-code: Fira Code, Menlo, Monaco, 'Courier New', Courier, monospace;
}

.dark .milkdown-theme-classic .milkdown {
    --crepe-color-background: #1f1b16;
    --crepe-color-on-background: #eae1d9;
    --crepe-color-surface: #18120b;
    --crepe-color-surface-low: #201b13;
    --crepe-color-on-surface: #ede0d4;
    --crepe-color-on-surface-variant: #d3c4b4;
    --crepe-color-outline: #9c8f80;
    --crepe-color-primary: #f4bd6f;
    --crepe-color-secondary: #56442a;
    --crepe-color-on-secondary: #fbdebc;
    --crepe-color-inverse: #ede0d4;
    --crepe-color-on-inverse: #362f27;
    --crepe-color-inline-code: #ffb4ab;
    --crepe-color-error: #ffb4ab;
    --crepe-color-hover: #2e271d;
    --crepe-color-selected: rgba(244, 189, 111, 0.28);
    --crepe-color-inline-area: #3f3830;
}

/* --- Theme: Nord --- */
.milkdown-theme-nord .milkdown {
    --crepe-color-background: #fdfcff;
    --crepe-color-on-background: #1b1c1d;
    --crepe-color-surface: #f8f9ff;
    --crepe-color-surface-low: #f2f3fa;
    --crepe-color-on-surface: #191c20;
    --crepe-color-on-surface-variant: #43474e;
    --crepe-color-outline: #73777f;
    --crepe-color-primary: #37618e;
    --crepe-color-secondary: #d7e3f8;
    --crepe-color-on-secondary: #101c2b;
    --crepe-color-inverse: #2e3135;
    --crepe-color-on-inverse: #eff0f7;
    --crepe-color-inline-code: #ba1a1a;
    --crepe-color-error: #ba1a1a;
    --crepe-color-hover: #eceef4;
    --crepe-color-selected: #e1e2e8;
    --crepe-color-inline-area: #d8dae0;

    --crepe-font-title: Rubik, Cambria, 'Times New Roman', Times, serif;
    --crepe-font-default: Inter, Arial, Helvetica, sans-serif;
    --crepe-font-code: 'JetBrains Mono', Menlo, Monaco, 'Courier New', Courier, monospace;
}

.dark .milkdown-theme-nord .milkdown {
    --crepe-color-background: #1b1c1d;
    --crepe-color-on-background: #f8f9ff;
    --crepe-color-surface: #111418;
    --crepe-color-surface-low: #191c20;
    --crepe-color-on-surface: #e1e2e8;
    --crepe-color-on-surface-variant: #c3c6cf;
    --crepe-color-outline: #8d9199;
    --crepe-color-primary: #a1c9fd;
    --crepe-color-secondary: #3c4858;
    --crepe-color-on-secondary: #d7e3f8;
    --crepe-color-inverse: #e1e2e8;
    --crepe-color-on-inverse: #2e3135;
    --crepe-color-inline-code: #ffb4ab;
    --crepe-color-error: #ffb4ab;
    --crepe-color-hover: #242a33;
    --crepe-color-selected: rgba(161, 201, 253, 0.3);
    --crepe-color-inline-area: #111418;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.loading-text {
    color: #9ca3af;
    font-size: 0.875rem;
}

/* 编辑器容器 */
.crepe-editor {
    min-height: calc(100vh - 135px);
    border-radius: 0.5rem;
}

.crepe-hidden {
    display: none;
}

/* 只读模式 */
.crepe-readonly {
    pointer-events: none;
    opacity: 0.8;
}

.readonly-code-copy-btn {
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.96);
  color: #334155;
  border-color: rgba(148, 163, 184, 0.55);
  backdrop-filter: blur(8px);
}

.readonly-code-copy-btn:hover {
  background: rgba(248, 250, 252, 0.98);
  border-color: rgba(100, 116, 139, 0.75);
}

.dark .readonly-code-copy-btn {
  background: rgba(17, 24, 39, 0.94);
  color: #e5e7eb;
  border-color: rgba(100, 116, 139, 0.6);
}

.dark .readonly-code-copy-btn:hover {
  background: rgba(31, 41, 55, 0.98);
  border-color: rgba(148, 163, 184, 0.78);
}

.readonly-link-copy-btn {
  width: 1.25rem;
  height: 1.25rem;
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.96);
  color: #475569;
  border-color: rgba(148, 163, 184, 0.5);
  backdrop-filter: blur(8px);
}

.readonly-link-copy-btn:hover {
  background: rgba(248, 250, 252, 0.98);
  border-color: rgba(100, 116, 139, 0.72);
}

.dark .readonly-link-copy-btn {
  background: rgba(17, 24, 39, 0.94);
  color: #e5e7eb;
  border-color: rgba(100, 116, 139, 0.6);
}

.dark .readonly-link-copy-btn:hover {
  background: rgba(31, 41, 55, 0.98);
  border-color: rgba(148, 163, 184, 0.78);
}

/* 确保只读模式下代码块可见 */
.crepe-readonly .milkdown-code-block:not(:has(.mermaid-preview)),
.crepe-readonly .milkdown-code-block:not(:has(.mermaid-preview)) .codemirror-host,
.crepe-readonly .milkdown-code-block:not(:has(.mermaid-preview)) .cm-editor,
.crepe-readonly .milkdown-code-block:not(:has(.mermaid-preview)) .cm-content,
.crepe-readonly .milkdown-code-block:not(:has(.mermaid-preview)) .cm-scroller,
.crepe-readonly .milkdown-code-block:not(:has(.mermaid-preview)) .cm-line,
.crepe-readonly .code-fence:not(:has(.mermaid-preview)),
.crepe-readonly .code-fence:not(:has(.mermaid-preview)) .cm-editor,
.crepe-readonly .code-fence:not(:has(.mermaid-preview)) .cm-content,
.crepe-readonly .code-fence:not(:has(.mermaid-preview)) .cm-scroller,
.crepe-readonly .code-fence:not(:has(.mermaid-preview)) .cm-line {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
}

/* 确保代码块的父容器也可见 */
.crepe-readonly .milkdown-code-block:not(:has(.mermaid-preview)),
.crepe-readonly .code-fence:not(:has(.mermaid-preview)) {
    background: var(--crepe-color-surface, #f7f7f7) !important;
    border: 1px solid var(--crepe-color-outline, #e2e8f0) !important;
    border-radius: 0.375rem !important;
    padding: 0.5rem !important;
    margin: 0.5rem 0 !important;
}

/* 隐藏只读模式下的工具栏 */
.crepe-readonly .milkdown-code-block .tools {
    display: none !important;
}

/* 隐藏只读模式下的行号和折叠按钮 */
.crepe-readonly .milkdown-code-block .cm-gutters,
.crepe-readonly .milkdown-code-block .cm-lineNumbers,
.crepe-readonly .milkdown-code-block .cm-foldGutter {
    display: none !important;
}

/* 调整只读模式下代码块的 scroller 左边距（因为隐藏了 gutter） */
.crepe-readonly .milkdown-code-block .cm-scroller {
    padding-left: 0.5rem !important;
}

/* 调整只读模式下代码块的 scroller 左边距 */

/* 加深只读模式下代码块的文字颜色 */
.crepe-readonly .milkdown-code-block .cm-content,
.crepe-readonly .milkdown-code-block .cm-line {
    color: #1a1a1a !important;
}

.dark .crepe-readonly .milkdown-code-block .cm-content,
.dark .crepe-readonly .milkdown-code-block .cm-line {
    color: #e5e5e5 !important;
}

/* 加深编辑模式下代码块的文字颜色 */
.milkdown-code-block .cm-content,
.milkdown-code-block .cm-line {
    color: #1a1a1a !important;
}

.dark .milkdown-code-block .cm-content,
.dark .milkdown-code-block .cm-line {
    color: #e5e5e5 !important;
}

/* Crepe 编辑器全局样式覆盖 */
.crepe-editor .milkdown {
    min-height: calc(100vh - 135px);
}

.crepe-editor .ProseMirror {
  min-height: calc(100vh - 135px);
  /* In edit mode, left padding reserves space for block handles, right for annotation icons */
  padding: 0.75rem 2.5rem 0.75rem 0.75rem !important;
  outline: none;
  letter-spacing: 0.03em;
  /* A4 视觉宽度：最小 800px，窗口更窄时由 .crepe-wrapper 横向滚动；
     更宽时正文随容器撑开，但表格保持固定宽度（见下） */
  min-width: 800px;
  box-sizing: border-box;
}

@media (min-width: 640px) {
  .crepe-editor .ProseMirror {
    padding: 1rem 5.5rem 1rem 5.5rem !important;
  }
}

/* 表格固定宽度：800px，不随容器宽度变化，与 A4 打印效果对齐。
   关键：min-width / max-width 都要锁住，否则 prosemirror-tables 会基于 sum(colwidth)
   设置 table.style.minWidth 把表格撑宽（min-width 优先级高于 width） */
.crepe-editor .ProseMirror table {
  width: 800px !important;
  min-width: 800px !important;
  max-width: 800px !important;
  table-layout: fixed;
}

.crepe-editor .ProseMirror:focus {
    outline: none;
}

/* ========== 修复表格列宽拖拽 UI ========== */
/* 统一表格宽度来源：table 始终保持 100% 满宽，列比例由 colwidth + 最后一列剩余空间共同决定 */
.crepe-editor .ProseMirror .tableWrapper {
  overflow-x: auto;
}

/* 统一保留固定 800px 宽度策略；这里只补充表格边框与折叠样式，不再覆盖 width。 */
.crepe-editor .ProseMirror table {
  border-collapse: collapse;
  border-spacing: 0;
  border: 1px solid #d1d5db;
}

.crepe-editor .ProseMirror td,
.crepe-editor .ProseMirror th {
  vertical-align: top;
  box-sizing: border-box;
  position: relative;
  border: 1px solid #d1d5db;
  padding: 0.5rem 0.75rem;
}

.crepe-editor .ProseMirror th {
  background: #f9fafb;
}

.dark .crepe-editor .ProseMirror table,
.dark .crepe-editor .ProseMirror th,
.dark .crepe-editor .ProseMirror td {
  border-color: #4b5563;
}

.dark .crepe-editor .ProseMirror th {
  background: #1f2937;
}

.table-quick-actions-group {
  display: inline-flex;
  flex-direction: column;
  gap: 0.25rem;
}

.table-quick-actions-group-horizontal {
  flex-direction: row;
}

.table-quick-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 9999px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.16);
  transition: transform 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.table-quick-action-btn:hover {
  transform: scale(1.05);
  border-color: #94a3b8;
  background: #f8fafc;
}

.table-quick-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.table-quick-action-btn:disabled:hover {
  border-color: #cbd5e1;
  background: #ffffff;
}

.table-quick-action-btn-danger {
  color: #b91c1c;
  border-color: #fecaca;
}

.table-quick-action-btn-danger:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}

.dark .table-quick-action-btn {
  border-color: #475569;
  background: #0f172a;
  color: #e2e8f0;
  box-shadow: 0 1px 3px rgba(2, 6, 23, 0.5);
}

.dark .table-quick-action-btn:hover {
  border-color: #64748b;
  background: #1e293b;
}

.dark .table-quick-action-btn:disabled:hover {
  border-color: #475569;
  background: #0f172a;
}

.dark .table-quick-action-btn-danger {
  color: #fca5a5;
  border-color: #7f1d1d;
}

.dark .table-quick-action-btn-danger:hover {
  background: #450a0a;
  border-color: #991b1b;
}

/* 关掉 Crepe 的列拖拽指示线和顶部加号，避免和 prosemirror-tables 的列宽拖拽视觉打架 */
.crepe-editor .milkdown .milkdown-table-block .handle.line-handle[data-role=y-line-drag-handle],
.crepe-editor .milkdown .milkdown-table-block .handle.line-handle[data-role=y-line-drag-handle] .add-button,
.crepe-editor .milkdown .milkdown-table-block .drag-preview[data-direction=vertical],
.crepe-editor .milkdown .milkdown-table-block .line-handle[data-role=y-line-drag-handle],
.crepe-editor .milkdown .milkdown-table-block .line-handle[data-role=y-line-drag-handle] .add-button {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
  background: transparent !important;
  width: 0 !important;
}

/* prosemirror-tables 的 column-resize-handle 基础定位 + 增强可视反馈
   @milkdown/prose/lib/style/tables.css 未被导入，需在此补全定位属性 */
.crepe-editor .ProseMirror .column-resize-handle {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  z-index: 20;
  pointer-events: none;
  background-color: rgba(59, 130, 246, 0.45);
  width: 4px;
}

.crepe-editor .ProseMirror.resize-cursor {
  cursor: ew-resize;
  cursor: col-resize;
}

/* 拖拽中真正会跟随列边界移动的是被标记的单元格边缘，而不是 Crepe 的叠层线 */
.crepe-editor .ProseMirror td.column-resize-dragging,
.crepe-editor .ProseMirror th.column-resize-dragging {
  position: relative;
}

.crepe-editor .ProseMirror td.column-resize-dragging::after,
.crepe-editor .ProseMirror th.column-resize-dragging::after {
  content: '';
  position: absolute;
  top: -1px;
  right: -2px;
  bottom: -1px;
  width: 3px;
  background: rgb(37, 99, 235);
  pointer-events: none;
  z-index: 4;
}

.dark .crepe-editor .ProseMirror .column-resize-handle {
  background-color: rgba(96, 165, 250, 0.6);
}

.dark .crepe-editor .ProseMirror td.column-resize-dragging::after,
.dark .crepe-editor .ProseMirror th.column-resize-dragging::after {
  background: rgb(96, 165, 250);
}

/* Mermaid 图表样式 - 简化设计，遵循 beautiful-mermaid 理念 */
.mermaid-preview {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    text-align: center;
    padding: 1.5rem;
    margin: 1rem 0;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
}

.mermaid-preview:empty {
    overflow: hidden;
    padding: 0;
    margin: 0;
    background: transparent;
    border: 0;
}

.dark .mermaid-preview {
    background: #1a1b26;
    border-color: #565f89;
}

.mermaid-preview .mermaid-placeholder,
.mermaid-preview .mermaid-error-msg {
    min-height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    font-size: 14px;
    line-height: 1.5;
    white-space: normal;
}

.dark .mermaid-preview .mermaid-placeholder,
.dark .mermaid-preview .mermaid-error-msg {
    color: #c0caf5;
}

.mermaid-preview svg {
    max-width: 100% !important;
    display: block;
    margin: 0 auto;
    height: auto;
}

/* 硬换行样式 - 确保 remark-breaks 生成的换行正确显示 */
[data-type="hardbreak"] {
    display: block;
    height: 0;
    line-height: 0;
}

/* 或者使用 ::after 伪元素来模拟换行 */
[data-type="hardbreak"]::after {
    content: '\A';
    white-space: pre;
}

/* 覆盖默认的 padding设置，确保只读模式下（预览）左边距为 1rem，同时也重置右边距
   注意：元素类名可能是 ProseMirror 或 editor
*/
.crepe-editor.crepe-readonly .ProseMirror,
.crepe-editor.crepe-readonly .editor {
    /* Make read-only mode perfectly symmetrical and centered, removing the space reserved for toolbars */
    padding: 1rem !important;
    max-width: none !important;
  background-image: var(--readonly-watermark-image, none);
  background-repeat: repeat;
  background-size: 280px 180px;
  background-attachment: local;

    /* Ensure text can be selected in read-only mode */
    user-select: text !important;
    -webkit-user-select: text !important;
}

/* Force ProseMirror to show the selection highlight even if it thinks the editor is not focused */
.crepe-editor.crepe-readonly .ProseMirror *::selection,
.crepe-editor.crepe-readonly .editor *::selection {
    background-color: var(--crepe-color-selected, rgba(0, 100, 255, 0.2)) !important;
    color: inherit !important;
}

.crepe-editor .ProseMirror *::selection,
.crepe-editor .editor *::selection,
.crepe-source-editor textarea::selection {
  background-color: rgba(69, 124, 255, 0.22) !important;
  color: inherit !important;
}

.dark .crepe-editor .ProseMirror *::selection,
.dark .crepe-editor .editor *::selection,
.dark .crepe-source-editor textarea::selection {
  background-color: rgba(120, 170, 255, 0.38) !important;
  color: #f8fbff !important;
}

.dark .milkdown .milkdown-toolbar {
  background: rgba(24, 28, 34, 0.96) !important;
  border: 1px solid rgba(120, 170, 255, 0.18);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42), 0 2px 10px rgba(0, 0, 0, 0.22) !important;
  backdrop-filter: blur(10px);
}

.dark .milkdown .milkdown-toolbar .divider {
  background: rgba(195, 198, 207, 0.18) !important;
}

.dark .milkdown .milkdown-toolbar .toolbar-item:hover {
  background: rgba(120, 170, 255, 0.14) !important;
}

.dark .milkdown .milkdown-toolbar .toolbar-item:active,
.dark .milkdown .milkdown-toolbar .toolbar-item.active {
  background: rgba(120, 170, 255, 0.2) !important;
}

.dark .milkdown .milkdown-toolbar .toolbar-item svg {
  color: #cfd7e6 !important;
  fill: #cfd7e6 !important;
}

.dark .milkdown .milkdown-toolbar .toolbar-item.active svg {
  color: #9fcbff !important;
  fill: #9fcbff !important;
}

.crepe-editor.crepe-readonly .ProseMirror *,
.crepe-editor.crepe-readonly .editor * {
    user-select: text !important;
    -webkit-user-select: text !important;
}

@media (min-width: 640px) {

    .crepe-editor.crepe-readonly .ProseMirror,
    .crepe-editor.crepe-readonly .editor {
        padding: 2rem !important;
    }
}

/* ========== 移动端优化 ========== */
@media (max-width: 640px) {
  .crepe-container,
  .crepe-wrapper,
  .crepe-editor,
  .crepe-editor .milkdown,
  .crepe-editor .ProseMirror {
    overflow-x: hidden !important;
    max-width: 100% !important;
  }

  .milkdown .milkdown-toolbar {
    max-width: calc(100vw - 0.75rem) !important;
    border-radius: 6px !important;
  }

  .milkdown .milkdown-toolbar .divider {
    height: 18px !important;
    margin: 5px 2px !important;
  }

  /* 只读模式移动端 padding */
    .crepe-editor.crepe-readonly .ProseMirror,
    .crepe-editor.crepe-readonly .editor {
        padding: 0.75rem !important;
    }

    /* 源码模式移动端 */
    .crepe-source-editor textarea {
        min-height: calc(100vh - 100px);
        font-size: 13px;
    }

    /* 移动端保留右侧标注图标，但贴近右边缘 */
    .crepe-container .absolute.top-0.h-full.pointer-events-none {
      right: 0.25rem !important;
      left: auto !important;
      width: 2rem !important;
    }

    /* 移动端隐藏块句柄，避免加号和段落图标撑出屏幕 */
    .milkdown .milkdown-block-handle,
    .crepe-editor [data-type="block-handle"] {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* 注释弹出卡片移动端适配 */
    .crepe-container .w-80 {
        width: 70vw;
        max-width: 280px;
    }
}

/* 打印样式 */
@media print {
    /* 显式声明纸张边距，避免浏览器默认值左右不一致 */
    @page {
        margin: 1.6cm 1.4cm;
    }

    /* 隐藏侧边栏（版本历史、标注、AI 摘要、AI 助手等） */
    .crepe-container > :not(.crepe-wrapper) {
        display: none !important;
    }

    /* 隐藏标注图标层 */
    .absolute.top-0.h-full.pointer-events-none {
        display: none !important;
    }

    /* 确保编辑器内容可见且正确分页 */
    .crepe-container {
        display: block !important;
        width: 100% !important;
        height: auto !important;
    }

    .crepe-wrapper {
        display: block !important;
        width: 100% !important;
        height: auto !important;
        overflow: visible !important;
        box-shadow: none !important;
        border: none !important;
        margin: 0 !important;
        padding: 0 !important;
    }

    .crepe-editor {
        display: block !important;
        width: 100% !important;
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        border-radius: 0 !important;
        /* 屏幕态预留的左侧 block-handle 槽位在打印时无意义，重置以恢复内容左右对齐 */
        padding-left: 0 !important;
    }

    .crepe-editor .milkdown {
        min-height: auto !important;
        height: auto !important;
        width: 100% !important;
        margin-left: 0 !important;
    }

    .crepe-editor .ProseMirror,
    .crepe-editor .ProseMirror,
    .crepe-editor .editor {
        display: block !important;
        height: auto !important;
        min-height: auto !important;
        overflow: visible !important;
        padding: 0 !important;
        margin: 0 !important;
        /* 解除屏幕态的 800px 最小宽度，让内容跟随 A4 纸张实际可用宽度 */
        min-width: 0 !important;
        width: 100% !important;
    }

    /* 打印时表格撑满 A4 可用宽度，覆盖屏幕态固定的 624px 限制 */
    .crepe-editor .ProseMirror table {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
    }

    /* 确保所有内容块都可见 */
    .crepe-editor * {
        overflow: visible !important;
    }

    /* Lists - preserve Milkdown's flex layout, no extra indentation */
    .crepe-editor ol,
    .crepe-editor ul {
        display: block !important;
    }

    /* 标题允许跨页 */
    .crepe-editor h1,
    .crepe-editor h2,
    .crepe-editor h3 {
        page-break-after: avoid;
    }

    /* 代码块避免跨页断裂 */
    .crepe-editor pre,
    .crepe-editor .milkdown-code-block {
        page-break-inside: avoid;
    }

    /* 隐藏代码块工具栏 */
    .crepe-editor .milkdown-code-block .tools {
        display: none !important;
    }

    /* Mermaid 图表 */
    .mermaid-preview {
        page-break-inside: avoid;
    }
}
</style>
