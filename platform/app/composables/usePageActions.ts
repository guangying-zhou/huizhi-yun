type RefreshHandler = (() => void | Promise<void>) | null

export function usePageActions() {
  const refreshHandler = useState<RefreshHandler>('platform-page-refresh-handler', () => null)

  function setRefreshHandler(handler: RefreshHandler) {
    refreshHandler.value = handler
  }

  function clearRefreshHandler(handler?: RefreshHandler) {
    if (!handler || refreshHandler.value === handler) {
      refreshHandler.value = null
    }
  }

  return {
    refreshHandler,
    setRefreshHandler,
    clearRefreshHandler
  }
}
