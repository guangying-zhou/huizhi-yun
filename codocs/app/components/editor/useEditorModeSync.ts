import { nextTick, watch, type Ref } from 'vue'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

interface UseEditorModeSyncOptions {
  viewMode: Ref<'edit' | 'source' | undefined>
  modelValue: Ref<string | undefined>
  sourceTextareaRef: Ref<HTMLTextAreaElement | null>
  editorRef: Ref<HTMLDivElement | null>
  collaborationEnabled: Ref<boolean>
  collaborationDocPresent: Ref<boolean>
  isEditorDestroying: Ref<boolean>
  getEditorView: () => EditorView | null
  applySourceMarkdownToEditor: (cleanMarkdown: string) => void
  /** 同步将 markdown 中编码的列宽落到 PM doc，必须与 applySourceMarkdownToEditor 在同一执行栈调用 */
  applyColwidthFromMarkdownSync: (cleanMarkdown: string) => void
  markPendingSourceToEditSync: () => void
  parseTableMergeMetaFromMarkdown: (markdown: string) => { cleanMarkdown: string }
  scheduleTableMergeRestoreFromModel: (delay?: number, markdown?: string, throttleKey?: boolean) => void
  runLater: (handler: () => void, delay: number) => number | null
  encodeEditorMarkdownForModel: () => string
  emitModelValue: (value: string) => void
  emitChange: (value: string) => void
}

const findSourceCursorOffset = (view: EditorView, markdown: string) => {
  const cursorPos = view.state.selection.from
  const textBefore = view.state.doc.textBetween(0, cursorPos, '\n', '\n')
  const anchor = textBefore.slice(-40)
  if (!anchor.length) return 0

  const index = markdown.indexOf(anchor)
  if (index !== -1) {
    return index + anchor.length
  }

  const fullText = view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n')
  const ratio = textBefore.length / (fullText.length || 1)
  return Math.round(ratio * markdown.length)
}

const findAnchorTextNearCursor = (markdown: string, cursorOffset: number) => {
  const linesBefore = markdown.substring(0, cursorOffset).split('\n')
  for (let index = linesBefore.length - 1; index >= 0; index -= 1) {
    const stripped = (linesBefore[index] ?? '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^>\s+/, '')
      .replace(/\*{1,3}|_{1,3}/g, '')
      .replace(/`/g, '')
      .trim()
    if (stripped.length >= 4) {
      return stripped.slice(0, 30)
    }
  }
  return ''
}

const restoreEditorSelectionFromSource = ({
  view,
  anchorText,
  cursorOffset,
  markdown
}: {
  view: EditorView
  anchorText: string
  cursorOffset: number
  markdown: string
}) => {
  const doc = view.state.doc
  const docSize = doc.content.size
  if (docSize <= 2) return

  let targetPos = -1

  if (anchorText.length >= 4) {
    doc.descendants((node, pos) => {
      if (targetPos !== -1) return false
      if (node.isText && node.text) {
        const index = node.text.indexOf(anchorText)
        if (index !== -1) {
          targetPos = pos + index + anchorText.length
          return false
        }
      }
      return true
    })
  }

  if (targetPos === -1 && cursorOffset > 0 && markdown.length > 0) {
    const ratio = cursorOffset / markdown.length
    targetPos = Math.round(ratio * docSize)
  }

  if (targetPos > 0) {
    targetPos = Math.min(targetPos, docSize - 1)
    try {
      const selection = TextSelection.near(doc.resolve(targetPos))
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
    } catch {
      // fall through to scroll ratio restore
    }
  }
}

export const useEditorModeSync = ({
  viewMode,
  modelValue,
  sourceTextareaRef,
  editorRef,
  collaborationEnabled,
  collaborationDocPresent,
  isEditorDestroying,
  getEditorView,
  applySourceMarkdownToEditor,
  applyColwidthFromMarkdownSync,
  markPendingSourceToEditSync,
  parseTableMergeMetaFromMarkdown,
  scheduleTableMergeRestoreFromModel,
  runLater,
  encodeEditorMarkdownForModel,
  emitModelValue,
  emitChange
}: UseEditorModeSyncOptions) => {
  watch(viewMode, (newMode, oldMode) => {
    if (oldMode === 'edit' && newMode === 'source') {
      nextTick(() => {
        const textarea = sourceTextareaRef.value
        const view = getEditorView()
        if (!textarea || !view) return

        try {
          const markdown = modelValue.value || ''
          const offset = findSourceCursorOffset(view, markdown)
          textarea.focus()
          textarea.setSelectionRange(offset, offset)

          const linesBefore = markdown.substring(0, offset).split('\n').length
          const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20
          textarea.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight)
        } catch {
          // ignore selection sync failures during mode switch
        }
      })
      return
    }

    if (oldMode !== 'source' || newMode !== 'edit') return

    const textarea = sourceTextareaRef.value
    const cursorOffset = textarea?.selectionStart ?? 0
    const markdown = modelValue.value || ''
    const { cleanMarkdown } = parseTableMergeMetaFromMarkdown(markdown)
    const scrollRatio = textarea
      ? textarea.scrollTop / (textarea.scrollHeight - textarea.clientHeight || 1)
      : 0

    if (collaborationEnabled.value && collaborationDocPresent.value) {
      // 协同路径：标记 pending，让 syncCollaborationService 在 applyTemplate 后
      // 同步触发 colwidth 恢复，避免与 PM 首帧渲染之间出现均分闪烁。
      markPendingSourceToEditSync()
    } else {
      // 非协同路径：两次 dispatch（内容、colwidth）必须在同一执行栈里完成，
      // 才能让浏览器只绘制一次（带 colwidth 的结果），不会闪现等宽。
      applySourceMarkdownToEditor(cleanMarkdown)
      applyColwidthFromMarkdownSync(cleanMarkdown)
      scheduleTableMergeRestoreFromModel(20, markdown)
    }

    const anchorText = findAnchorTextNearCursor(markdown, cursorOffset)

    const flushMergedEncoded = () => {
      if (viewMode.value !== 'edit' || isEditorDestroying.value) return
      try {
        const encoded = encodeEditorMarkdownForModel()
        if (encoded && encoded !== modelValue.value) {
          emitModelValue(encoded)
          emitChange(encoded)
        }
      } catch {
        // ignore encoding failures during async flush
      }
    }

    runLater(flushMergedEncoded, 600)
    runLater(flushMergedEncoded, 1200)

    runLater(() => {
      try {
        const view = getEditorView()
        if (!view) return

        restoreEditorSelectionFromSource({
          view,
          anchorText,
          cursorOffset,
          markdown
        })

        const wrapper = editorRef.value?.closest('.crepe-wrapper') as HTMLElement | null
        if (wrapper && scrollRatio > 0.05) {
          const maxScroll = wrapper.scrollHeight - wrapper.clientHeight
          wrapper.scrollTop = scrollRatio * maxScroll
        }

        view.focus()
      } catch {
        // ignore selection restore failures during mode switch
      }
    }, 150)
  })
}
