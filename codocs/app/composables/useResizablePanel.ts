import { ref, watch } from 'vue'

/**
 * 可调整宽度面板的 composable
 * 支持拖拽右边框调整宽度，宽度小于最小值时自动折叠，折叠后可通过按钮恢复。
 * 用户调整的宽度保存到 cookie（所有页面共用同一个 key）。
 */
export function useResizablePanel(defaultWidth: number) {
  const minWidth = Math.round(defaultWidth * 4 / 5)
  const maxWidth = defaultWidth * 2

  // 从 cookie 读取上次保存的宽度，各调用方共用同一个 cookie key
  const savedWidth = useCookie<number>('list-panel-width', {
    default: () => defaultWidth,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/'
  })

  // 初始宽度：取 cookie 值，但需约束在合法范围内
  const initialWidth = Math.min(maxWidth, Math.max(minWidth, savedWidth.value))
  const panelWidth = ref(initialWidth)
  const panelCollapsed = ref(false)
  // 记录上次有效宽度，折叠后恢复时使用
  const lastVisibleWidth = ref(initialWidth)

  // 当 panelWidth 变化时同步到 cookie
  watch(panelWidth, (w) => {
    if (w >= minWidth) {
      savedWidth.value = w
    }
  })

  const onResizeStart = (e: MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth.value

    const onMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startX
      panelWidth.value = Math.min(maxWidth, Math.max(0, startWidth + diff))
    }

    const onMouseUp = () => {
      if (panelWidth.value < minWidth) {
        panelCollapsed.value = true
        panelWidth.value = lastVisibleWidth.value
      } else {
        lastVisibleWidth.value = panelWidth.value
      }
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const showPanel = () => {
    panelWidth.value = lastVisibleWidth.value
    panelCollapsed.value = false
  }

  return {
    panelWidth,
    panelCollapsed,
    onResizeStart,
    showPanel
  }
}
