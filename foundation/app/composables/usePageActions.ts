const refreshHandler = ref<(() => void) | null>(null)

export function usePageActions() {
  function setRefresh(handler: () => void) {
    refreshHandler.value = handler
  }

  function clearRefresh() {
    refreshHandler.value = null
  }

  return { refreshHandler, setRefresh, clearRefresh }
}
