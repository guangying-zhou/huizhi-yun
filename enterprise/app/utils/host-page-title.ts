export interface HostPageTitleState {
  title: string
  visible: boolean
}

// Observe the real shared heading inside the Host scroll viewport. Do not infer
// a name from routes/browser metadata: pages without this heading stay empty.
export function observeHostPageTitle(root: HTMLElement, update: (state: HostPageTitleState) => void): () => void {
  let heading: HTMLElement | null = null
  let aboveViewport = false
  let stopped = false
  let previous: HostPageTitleState | undefined
  const publish = () => {
    const title = heading?.textContent?.trim() || ''
    const state = { title, visible: Boolean(title) && aboveViewport }
    if (previous?.title !== title || previous.visible !== state.visible) {
      previous = state
      update(state)
    }
  }
  publish()
  if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return () => {}

  const intersection = new IntersectionObserver((entries) => {
    if (stopped) return
    for (const entry of entries) {
      if (entry.target !== heading) continue
      // A heading below the viewport (or hidden in a tab) is not scrolled past.
      aboveViewport = !entry.isIntersecting && entry.boundingClientRect.height > 0
        && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? root.getBoundingClientRect().top)
      publish()
    }
  }, { root, threshold: 0 })
  const refresh = () => {
    if (stopped) return
    const next = root.querySelector<HTMLElement>('[data-host-page-title]')
    if (next !== heading) {
      if (heading) intersection.unobserve(heading)
      heading = next
      aboveViewport = false
      if (heading) intersection.observe(heading)
    }
    publish()
  }
  const mutations = new MutationObserver(refresh)
  mutations.observe(root, { childList: true, characterData: true, subtree: true })
  refresh()
  return () => {
    stopped = true
    intersection.disconnect()
    mutations.disconnect()
    heading = null
    aboveViewport = false
    publish()
  }
}
