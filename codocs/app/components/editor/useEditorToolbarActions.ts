import { ref, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

export interface EditorToolbarSelection {
  empty: boolean
  from: number
  to: number
  isText: boolean
}

export interface EditorToolbarToast {
  add: (message: { title: string, color: 'warning' | 'error' | 'success' }) => void
}

interface ClipboardEntry {
  content: string
  contentType: string
}

interface UseEditorToolbarActionsOptions {
  readonly: MaybeRefOrGetter<boolean>
  getSelection: () => EditorToolbarSelection | null
  getSelectionText: (selection: EditorToolbarSelection) => string
  getSelectionCoords: (selection: EditorToolbarSelection) => { top: number, left: number }
  getAiButtonRect: () => { top: number, left: number, bottom: number } | null
  replaceMarkdown: (input: { from: number, to: number, markdown: string }) => boolean
  serializeSelection: (selection: EditorToolbarSelection) => string
  getCurrentUserId: () => string
  writeClipboard: (input: { uid: string, content: string }) => Promise<void>
  readClipboard: (uid: string) => Promise<ClipboardEntry | null>
  toast: EditorToolbarToast
}

/**
 * 编辑器工具栏的交互状态与动作。
 *
 * Crepe 的创建、表格命令和协作生命周期仍属于 MilkdownEditor；这里仅消费一个
 * 已就绪的编辑器视图，避免工具栏行为再与表格/Yjs/持久化交叉耦合。
 */
export const useEditorToolbarActions = ({
  readonly,
  getSelection,
  getSelectionText,
  getSelectionCoords,
  getAiButtonRect,
  replaceMarkdown,
  serializeSelection,
  getCurrentUserId,
  writeClipboard,
  readClipboard,
  toast
}: UseEditorToolbarActionsOptions) => {
  const aiMenuVisible = ref(false)
  const aiSelectedText = ref('')
  const aiMenuPosition = ref({ top: 0, left: 0 })
  const aiSelectionRange = ref<{ from: number, to: number } | null>(null)

  const closeAiMenu = () => {
    aiMenuVisible.value = false
    aiSelectedText.value = ''
    aiSelectionRange.value = null
  }

  const openAiMenu = () => {
    if (toValue(readonly)) return
    const selection = getSelection()
    if (!selection || selection.empty || !selection.isText) return

    const text = getSelectionText(selection)
    if (text.trim().length < 2) return

    aiSelectedText.value = text
    aiSelectionRange.value = { from: selection.from, to: selection.to }

    const aiButtonRect = getAiButtonRect()
    if (aiButtonRect) {
      aiMenuPosition.value = {
        top: aiButtonRect.bottom + 4,
        left: aiButtonRect.left
      }
    } else {
      const coords = getSelectionCoords(selection)
      aiMenuPosition.value = {
        top: coords.top + 60,
        left: coords.left
      }
    }
    aiMenuVisible.value = true
  }

  const applyAiText = (newText: string) => {
    if (!aiSelectionRange.value) return
    const { from, to } = aiSelectionRange.value
    if (!replaceMarkdown({ from, to, markdown: newText })) return
    closeAiMenu()
  }

  const copyToCloudClipboard = async () => {
    const selection = getSelection()
    if (!selection || selection.empty) {
      toast.add({ title: '请先选中内容', color: 'warning' })
      return
    }

    const uid = getCurrentUserId()
    if (!uid) {
      toast.add({ title: '未登录，无法使用粘贴板', color: 'error' })
      return
    }

    const markdown = serializeSelection(selection)
    if (!markdown.trim()) {
      toast.add({ title: '选中内容为空', color: 'warning' })
      return
    }

    try {
      await writeClipboard({ uid, content: markdown })
      toast.add({ title: '已复制到汇智云粘贴板', color: 'success' })
    } catch {
      toast.add({ title: '复制到粘贴板失败', color: 'error' })
    }
  }

  const pasteFromCloudClipboard = async () => {
    const uid = getCurrentUserId()
    if (!uid) {
      toast.add({ title: '未登录，无法使用粘贴板', color: 'error' })
      return
    }

    try {
      const entry = await readClipboard(uid)
      if (!entry) {
        toast.add({ title: '粘贴板为空或已过期', color: 'warning' })
        return
      }

      const selection = getSelection()
      if (!selection || !replaceMarkdown({ from: selection.from, to: selection.to, markdown: entry.content })) return
      toast.add({ title: '已从汇智云粘贴板粘贴', color: 'success' })
    } catch {
      toast.add({ title: '从粘贴板粘贴失败', color: 'error' })
    }
  }

  return {
    aiMenuVisible,
    aiSelectedText,
    aiMenuPosition,
    aiSelectionRange,
    openAiMenu,
    applyAiText,
    closeAiMenu,
    copyToCloudClipboard,
    pasteFromCloudClipboard
  }
}
