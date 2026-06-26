import { nextTick, type Ref } from 'vue'
import mermaid from 'mermaid'

export const EDITOR_MERMAID_RENDERER_VARIANT = '2026-04-20-flowchart-svg-labels-v3'

const MERMAID_FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif'

interface CreateEditorMermaidPreviewOptions {
  isEditorDestroying: Ref<boolean>
  createId: () => string
  getCachedSvg: (content: string) => string | null
  getPersistentSvg: (content: string) => Promise<string | null>
  setCachedSvg: (content: string, svg: string) => Promise<void>
}

const cleanupMermaidArtifacts = (svgId: string) => {
  const leakedSvg = document.getElementById(svgId)
  if (leakedSvg && !leakedSvg.closest('.mermaid-preview')) {
    leakedSvg.remove()
  }

  const dElement = document.getElementById('d')
  if (dElement) {
    dElement.remove()
  }
}

const waitForDocumentFonts = async () => {
  if (typeof document === 'undefined') return

  try {
    await document.fonts?.ready
  } catch {
    // Ignore font readiness failures and fall back to immediate render.
  }
}

export const initEditorMermaid = (isDark: boolean) => {
  const bg = isDark ? '#1a1b26' : '#ffffff'
  const fg = isDark ? '#a9b1d6' : '#27272A'
  const accent = isDark ? '#7aa2f7' : '#0969da'
  const line = isDark ? '#565f89' : '#d1d9e0'
  const muted = isDark ? '#565f89' : '#6e7781'
  const surface = isDark ? '#24283b' : '#f6f8fa'

  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    fontFamily: MERMAID_FONT_FAMILY,
    // Mermaid 11 prioritizes the root htmlLabels setting over flowchart.htmlLabels.
    // Force SVG text labels globally so node text does not get clipped by foreignObject sizing.
    htmlLabels: false,
    flowchart: {
      useMaxWidth: false,
      // Keep flowchart-scoped flag aligned for older internals and future compatibility.
      htmlLabels: false,
      // Slightly tighten node inner padding to reduce excess top/bottom whitespace.
      padding: 11,
      // Move subgraph titles slightly farther from the top border.
      subGraphTitleMargin: {
        top: 2,
        bottom: 0
      },
      curve: 'basis'
    },
    block: {
      useMaxWidth: true,
      padding: 4
    },
    sequence: {
      useMaxWidth: false,
      mirrorActors: false
    },
    gantt: {
      useMaxWidth: false,
      titleTopMargin: 25
    },
    themeVariables: {
      fontFamily: MERMAID_FONT_FAMILY,
      darkMode: isDark,
      background: bg,
      primaryColor: surface,
      primaryTextColor: fg,
      primaryBorderColor: line,
      secondaryColor: isDark ? '#2d3f5f' : '#e6f0ff',
      secondaryTextColor: fg,
      secondaryBorderColor: line,
      tertiaryColor: isDark ? '#3d2f4f' : '#f3e8ff',
      tertiaryTextColor: fg,
      tertiaryBorderColor: line,
      mainBkg: surface,
      secondBkg: isDark ? '#2d3f5f' : '#e6f0ff',
      tertiaryBkg: isDark ? '#3d2f4f' : '#f3e8ff',
      textColor: fg,
      nodeTextColor: fg,
      mainTextColor: fg,
      labelTextColor: fg,
      loopTextColor: fg,
      titleColor: fg,
      edgeLabelColor: muted,
      lineColor: line,
      arrowheadColor: accent,
      defaultLinkColor: line,
      nodeBorder: line,
      clusterBorder: line,
      borderColor: line,
      border1: line,
      border2: line,
      clusterBkg: bg,
      edgeLabelBackground: bg,
      actorBkg: surface,
      actorBorder: line,
      actorTextColor: fg,
      actorLineColor: line,
      signalColor: line,
      signalTextColor: fg,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: line,
      noteBorderColor: accent,
      noteBkgColor: isDark ? '#2d3f5f' : '#e6f0ff',
      noteTextColor: fg,
      activationBorderColor: line,
      activationBkgColor: isDark ? '#2d3f5f' : '#e6f0ff',
      sequenceNumberColor: fg,
      gridColor: line,
      todayLineColor: accent,
      taskBkgColor: surface,
      taskBorderColor: line,
      taskTextColor: fg,
      taskTextOutsideColor: fg,
      taskTextLightColor: fg,
      taskTextColor0: fg,
      taskTextColor1: fg,
      taskTextColor2: fg,
      taskTextColor3: fg,
      activeTaskBkgColor: accent,
      activeTaskBorderColor: accent,
      doneTaskBkgColor: muted,
      doneTaskBorderColor: muted,
      critBkgColor: isDark ? '#f87171' : '#fca5a5',
      critBorderColor: isDark ? '#dc2626' : '#ef4444',
      classText: fg,
      relationColor: line,
      relationLabelBackground: bg,
      relationLabelColor: fg,
      labelColor: fg,
      git0: isDark ? '#7aa2f7' : '#0969da',
      git1: isDark ? '#bb9af7' : '#8250df',
      git2: isDark ? '#9ece6a' : '#1a7f37',
      git3: isDark ? '#e0af68' : '#bf8700',
      git4: isDark ? '#f7768e' : '#cf222e',
      git5: isDark ? '#73daca' : '#1f6feb',
      git6: isDark ? '#b4f9f8' : '#54aeff',
      git7: isDark ? '#ff9e64' : '#fb8500',
      gitBranchLabel0: bg,
      gitBranchLabel1: bg,
      gitBranchLabel2: bg,
      gitBranchLabel3: bg,
      gitBranchLabel4: bg,
      gitBranchLabel5: bg,
      gitBranchLabel6: bg,
      gitBranchLabel7: bg,
      gitInv0: fg,
      gitInv1: fg,
      gitInv2: fg,
      gitInv3: fg,
      gitInv4: fg,
      gitInv5: fg,
      gitInv6: fg,
      gitInv7: fg
    }
  })
}

export const createEditorMermaidPreview = ({
  isEditorDestroying,
  createId,
  getCachedSvg,
  getPersistentSvg,
  setCachedSvg
}: CreateEditorMermaidPreviewOptions) => {
  const observerCleanups = new Set<() => void>()
  const renderQueue: Array<() => Promise<void>> = []
  let isProcessingRenderQueue = false

  const processRenderQueue = async () => {
    if (isProcessingRenderQueue || typeof window === 'undefined' || isEditorDestroying.value) return

    isProcessingRenderQueue = true
    try {
      while (renderQueue.length > 0) {
        const task = renderQueue.shift()
        if (!task || isEditorDestroying.value) continue
        await task()

        if (renderQueue.length > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0)
          })
        }
      }
    } finally {
      isProcessingRenderQueue = false
    }
  }

  const enqueueRender = (task: () => Promise<void>) => {
    renderQueue.push(task)
    void processRenderQueue()
  }

  const observeLazyRender = (target: HTMLElement, onVisible: () => void, onHidden?: () => void) => {
    if (typeof window === 'undefined' || isEditorDestroying.value) return

    if (typeof IntersectionObserver === 'undefined') {
      onVisible()
      return
    }

    const root = target.closest('.crepe-wrapper') as HTMLElement | null
    let disconnected = false
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        onVisible()
        return
      }
      onHidden?.()
    }, {
      root,
      // 较大的 rootMargin：保证略微滚动不触发卸载，避免频繁抖动。
      rootMargin: '720px 0px'
    })

    const cleanup = () => {
      if (disconnected) return
      disconnected = true
      observer.disconnect()
      observerCleanups.delete(cleanup)
    }

    observerCleanups.add(cleanup)
    observer.observe(target)
  }

  const renderPreview = (language: string, content: string) => {
    if (language !== 'mermaid' || !content) return null

    const id = createId()
    const containerId = `mermaid-container-${id}`
    const svgId = `mermaid-svg-${id}`
    const container = document.createElement('div')
    container.id = containerId
    container.className = 'mermaid-preview'
    container.dataset.mermaidRendered = '0'

    nextTick(() => {
      const targetContainer = document.getElementById(containerId)
      if (!targetContainer) return

      const releaseWhenHidden = () => {
        const currentContainer = document.getElementById(containerId) as HTMLDivElement | null
        if (!currentContainer) return
        if (currentContainer.dataset.mermaidRendered !== '1') return

        // 滚出可视区域后释放大体积 SVG，降低长文档常驻内存占用。
        currentContainer.dataset.mermaidRendered = '0'
        currentContainer.innerHTML = '<div class="mermaid-placeholder">正在渲染...</div>'
      }

      const renderWhenVisible = () => {
        const currentContainer = document.getElementById(containerId) as HTMLDivElement | null
        if (!currentContainer || currentContainer.dataset.mermaidRendered === '1') return

        const cachedSvg = getCachedSvg(content)
        if (cachedSvg) {
          currentContainer.innerHTML = cachedSvg
          currentContainer.dataset.mermaidRendered = '1'
          return
        }

        currentContainer.dataset.mermaidRendered = '1'
        currentContainer.innerHTML = '<div class="mermaid-placeholder">正在渲染...</div>'
        void (async () => {
          const persistentSvg = await getPersistentSvg(content)
          const liveContainer = document.getElementById(containerId) as HTMLDivElement | null
          if (!liveContainer || isEditorDestroying.value || liveContainer.dataset.mermaidRendered !== '1') return

          if (persistentSvg) {
            liveContainer.innerHTML = persistentSvg
            return
          }

          enqueueRender(async () => {
            if (isEditorDestroying.value) return

            const queuedContainer = document.getElementById(containerId) as HTMLDivElement | null
            if (!queuedContainer || queuedContainer.dataset.mermaidRendered !== '1') return

            try {
              await waitForDocumentFonts()
              const { svg, bindFunctions } = await mermaid.render(svgId, content)
              const latestContainer = document.getElementById(containerId) as HTMLDivElement | null
              if (!latestContainer || latestContainer.dataset.mermaidRendered !== '1') return

              latestContainer.innerHTML = svg
              bindFunctions?.(latestContainer)
              void setCachedSvg(content, svg)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              console.error('Mermaid error:', message)
              const latestContainer = document.getElementById(containerId) as HTMLDivElement | null
              if (latestContainer && latestContainer.dataset.mermaidRendered === '1') {
                latestContainer.innerHTML = '<div class="mermaid-error-msg">语法不完整，继续编辑...</div>'
              }
            } finally {
              cleanupMermaidArtifacts(svgId)
            }
          })
        })()
      }

      observeLazyRender(targetContainer, renderWhenVisible, releaseWhenHidden)
    })

    return container
  }

  const cleanup = () => {
    observerCleanups.forEach(stop => stop())
    observerCleanups.clear()
    renderQueue.length = 0
  }

  return {
    renderPreview,
    cleanup
  }
}
