// Temporary desktop disclosure. The caller owns its collapsed preference;
// neither pointer nor keyboard disclosure ever writes that preference.
export function createHostSidebarPeek(options: {
  collapsed: () => boolean
  desktop: () => boolean
  hover: () => boolean
  update: (expanded: boolean) => void
}) {
  let pointerInside = false
  let focusInside = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const eligible = () => !stopped && options.collapsed() && options.desktop()
  const reset = () => {
    clear()
    pointerInside = false
    focusInside = false
    options.update(false)
  }
  const closeLater = () => {
    clear()
    if (!pointerInside && !focusInside) timer = setTimeout(() => options.update(false), 220)
  }
  return {
    pointerEnter(pointerType: string) {
      if (!eligible() || !options.hover() || pointerType !== 'mouse') return
      clear()
      pointerInside = true
      timer = setTimeout(() => {
        if (eligible() && pointerInside) options.update(true)
      }, 160)
    },
    pointerLeave() {
      pointerInside = false
      closeLater()
    },
    focus() {
      if (!eligible()) return
      clear()
      focusInside = true
      options.update(true)
    },
    blur() {
      focusInside = false
      closeLater()
    },
    reset,
    stop() {
      stopped = true
      reset()
    }
  }
}
