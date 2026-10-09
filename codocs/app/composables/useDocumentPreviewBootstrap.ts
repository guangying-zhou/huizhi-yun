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
  // The Enterprise session coordinator runs clearNuxtState() on every session
  // scope change, which leaves this key undefined (e.g. after a page refresh
  // once the verified scope lands). Treat a cleared store as empty.
  const scopes = (): DocumentPreviewBootstrapScopes => state.value || {}

  watch(cacheScope, (nextScope, previousScope) => {
    if (!previousScope || nextScope === previousScope) return
    instanceActive = false
    const { [previousScope]: _omitted, ...nextState } = scopes()
    state.value = nextState
  }, { flush: 'sync' })

  const activeState = () => {
    if (!instanceActive || cacheScope.value !== instanceScope || !String(scopeValue(auth.user) || '').trim()) return undefined
    return scopes()[instanceScope] || {}
  }

  const updateState = (nextDocuments: DocumentPreviewBootstrapState) => {
    if (cacheScope.value !== instanceScope) return false
    state.value = { ...scopes(), [instanceScope]: nextDocuments }
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
