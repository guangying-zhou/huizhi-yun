import { useCodocsModule } from '../../layer/useCodocsModule'

interface DocumentPreviewBootstrapPayload {
  content: string
  aiAbstract?: string
}

type DocumentPreviewBootstrapState = Record<string, DocumentPreviewBootstrapPayload | undefined>
type DocumentPreviewBootstrapScopes = Record<string, DocumentPreviewBootstrapState | undefined>

export const useDocumentPreviewBootstrap = () => {
  const { cacheKey } = useCodocsModule()
  const auth = useAuth()
  let instanceActive = true
  const scopeValue = (value: unknown) => {
    if (value && typeof value === 'object' && 'value' in value) {
      return (value as { value?: unknown }).value
    }
    return value
  }
  const cacheScope = computed(() => cacheKey(JSON.stringify([
    scopeValue(auth.user) || '',
    scopeValue(auth.tenant) || ''
  ])))
  const state = useState<DocumentPreviewBootstrapScopes>(cacheKey('document-preview-bootstrap'), () => ({}))
  const instanceScope = cacheScope.value

  watch(cacheScope, (nextScope, previousScope) => {
    if (!previousScope || nextScope === previousScope) return
    instanceActive = false
    const { [previousScope]: _omitted, ...nextState } = state.value
    state.value = nextState
  }, { flush: 'sync' })

  const activeState = () => {
    if (!instanceActive || cacheScope.value !== instanceScope || !String(scopeValue(auth.user) || '').trim()) return undefined
    return state.value[instanceScope] || {}
  }

  const updateState = (nextDocuments: DocumentPreviewBootstrapState) => {
    if (cacheScope.value !== instanceScope) return false
    state.value = { ...state.value, [instanceScope]: nextDocuments }
    return true
  }

  const getPayload = (uuid: string) => activeState()?.[uuid]

  const setPayload = (uuid: string, payload: DocumentPreviewBootstrapPayload) => {
    const currentState = activeState()
    if (!currentState) return
    updateState({ ...currentState, [uuid]: payload })
  }

  const consumePayload = (uuid: string) => {
    const currentState = activeState()
    if (!currentState) return undefined
    const payload = currentState[uuid]

    if (!payload) {
      return undefined
    }

    const { [uuid]: _omitted, ...nextState } = currentState
    updateState(nextState)

    return payload
  }

  const clearPayload = (uuid: string) => {
    const currentState = activeState()
    if (!currentState || !(uuid in currentState)) {
      return
    }

    const { [uuid]: _omitted, ...nextState } = currentState
    updateState(nextState)
  }

  return {
    getPayload,
    setPayload,
    consumePayload,
    clearPayload
  }
}
