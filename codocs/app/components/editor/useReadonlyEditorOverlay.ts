import { computed, ref, type Ref } from 'vue'

interface ToastLike {
  add: (options: {
    title: string
    description?: string
    color?: 'error' | 'info' | 'success' | 'primary' | 'secondary' | 'warning' | 'neutral'
    icon?: string
  }) => void
}

interface UseReadonlyEditorOverlayOptions {
  editorRef: Ref<HTMLDivElement | null>
  readonly: Ref<boolean>
  viewMode: Ref<'edit' | 'source'>
  watermarkText: Ref<string>
  isEditorDestroying: Ref<boolean>
  toast: ToastLike
}

export const useReadonlyEditorOverlay = ({
  editorRef,
  readonly,
  viewMode,
  watermarkText,
  isEditorDestroying,
  toast
}: UseReadonlyEditorOverlayOptions) => {
  const readonlyCodeBlocks = ref<Array<{
    id: string
    top: number
    right: number
    text: string
  }>>([])
  const readonlyLinks = ref<Array<{
    id: string
    top: number
    left: number
    href: string
  }>>([])

  const readonlyWatermarkCount = ref(0)
  let watermarkResizeObserver: ResizeObserver | null = null
  let codeBlockObserver: MutationObserver | null = null
  let codeBlockRefreshTimer: number | null = null
  const isReadonlyOverlayActive = () => readonly.value && viewMode.value !== 'source'

  const readonlyWatermarkText = computed(() => {
    if (!readonly.value || viewMode.value === 'source') return ''
    return String(watermarkText.value || '').trim()
  })

  const getReadonlyCodeBlockText = (block: HTMLElement) => {
    const lines = Array.from(block.querySelectorAll('.cm-line'))
      .map(line => line.textContent || '')

    if (lines.length > 0) {
      return lines.join('\n').replace(/\u00A0/g, ' ').trim()
    }

    const content = block.querySelector('.cm-content, pre, code') as HTMLElement | null
    return content?.innerText?.replace(/\u00A0/g, ' ').trim() || ''
  }

  const refreshReadonlyCodeBlocks = () => {
    if (!isReadonlyOverlayActive() || !editorRef.value) {
      readonlyCodeBlocks.value = []
      readonlyLinks.value = []
      return
    }

    const wrapper = editorRef.value.closest('.crepe-wrapper') as HTMLElement | null
    if (!wrapper) {
      readonlyCodeBlocks.value = []
      readonlyLinks.value = []
      return
    }

    const wrapperRect = wrapper.getBoundingClientRect()
    readonlyWatermarkCount.value = Math.max(1, Math.floor(wrapperRect.width / 280)) * Math.ceil(wrapperRect.height / 180)
    const candidates = Array.from(editorRef.value.querySelectorAll('.milkdown-code-block, .code-fence')) as HTMLElement[]
    const seen = new Set<HTMLElement>()

    readonlyCodeBlocks.value = candidates
      .filter((block) => {
        if (seen.has(block)) return false
        seen.add(block)
        return !block.querySelector('.mermaid-preview')
      })
      .map((block, index) => {
        const rect = block.getBoundingClientRect()
        return {
          id: `${index}-${Math.round(rect.top)}-${Math.round(rect.left)}`,
          top: rect.top - wrapperRect.top + wrapper.scrollTop + 8,
          right: Math.max(8, wrapperRect.right - rect.right + 8),
          text: getReadonlyCodeBlockText(block)
        }
      })
      .filter(block => block.text)

    const linkCandidates = Array.from(editorRef.value.querySelectorAll('a[href]')) as HTMLAnchorElement[]
    readonlyLinks.value = linkCandidates
      .map((link, index) => {
        const href = link.getAttribute('href')?.trim() || ''
        if (!href) return null

        const rects = link.getClientRects()
        const lastRect = (rects.length > 0 ? rects[rects.length - 1] : undefined) ?? link.getBoundingClientRect()
        return {
          id: `link-${index}-${Math.round(lastRect.top)}-${Math.round(lastRect.left)}`,
          top: lastRect.top - wrapperRect.top + wrapper.scrollTop + (lastRect.height - 20) / 2,
          left: lastRect.right - wrapperRect.left + wrapper.scrollLeft + 4,
          href
        }
      })
      .filter((link): link is { id: string, top: number, left: number, href: string } => Boolean(link))
  }

  const scheduleReadonlyCodeBlockRefresh = () => {
    if (typeof window === 'undefined' || isEditorDestroying.value) return
    if (!isReadonlyOverlayActive()) {
      readonlyCodeBlocks.value = []
      readonlyLinks.value = []
      return
    }
    if (codeBlockRefreshTimer !== null) {
      window.cancelAnimationFrame(codeBlockRefreshTimer)
    }

    codeBlockRefreshTimer = window.requestAnimationFrame(() => {
      codeBlockRefreshTimer = null
      refreshReadonlyCodeBlocks()
    })
  }

  const setupReadonlyCodeBlockObserver = () => {
    codeBlockObserver?.disconnect()
    codeBlockObserver = null

    if (!editorRef.value || !isReadonlyOverlayActive()) return

    codeBlockObserver = new MutationObserver(() => {
      scheduleReadonlyCodeBlockRefresh()
    })

    watermarkResizeObserver?.disconnect()
    watermarkResizeObserver = new ResizeObserver(scheduleReadonlyCodeBlockRefresh)
    const wrapper = editorRef.value.closest('.crepe-wrapper')
    if (wrapper) watermarkResizeObserver.observe(wrapper)

    codeBlockObserver.observe(editorRef.value as unknown as Node, {
      childList: true,
      subtree: true,
      characterData: true
    })

    scheduleReadonlyCodeBlockRefresh()
  }

  const syncReadonlyCodeBlockObserver = () => {
    if (!isReadonlyOverlayActive()) {
      teardownReadonlyCodeBlockObserver()
      readonlyCodeBlocks.value = []
      readonlyLinks.value = []
      return
    }

    setupReadonlyCodeBlockObserver()
  }

  const teardownReadonlyCodeBlockObserver = () => {
    watermarkResizeObserver?.disconnect()
    watermarkResizeObserver = null
    codeBlockObserver?.disconnect()
    codeBlockObserver = null

    if (typeof window !== 'undefined' && codeBlockRefreshTimer !== null) {
      window.cancelAnimationFrame(codeBlockRefreshTimer)
      codeBlockRefreshTimer = null
    }
  }

  const copyReadonlyCodeBlock = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.add({
        title: '复制成功',
        description: '代码块内容已复制到剪贴板',
        color: 'success',
        icon: 'i-lucide-check-circle'
      })
    } catch {
      toast.add({
        title: '复制失败',
        description: '无法访问剪贴板，请手动复制',
        color: 'error',
        icon: 'i-lucide-x-circle'
      })
    }
  }

  const copyReadonlyLink = async (href: string) => {
    try {
      await navigator.clipboard.writeText(href)
      toast.add({
        title: '复制成功',
        description: '链接地址已复制到剪贴板',
        color: 'success',
        icon: 'i-lucide-check-circle'
      })
    } catch {
      toast.add({
        title: '复制失败',
        description: '无法访问剪贴板，请手动复制链接',
        color: 'error',
        icon: 'i-lucide-x-circle'
      })
    }
  }

  return {
    readonlyCodeBlocks,
    readonlyLinks,
    readonlyWatermarkText,
    readonlyWatermarkCount,
    scheduleReadonlyCodeBlockRefresh,
    setupReadonlyCodeBlockObserver,
    syncReadonlyCodeBlockObserver,
    teardownReadonlyCodeBlockObserver,
    copyReadonlyCodeBlock,
    copyReadonlyLink
  }
}
