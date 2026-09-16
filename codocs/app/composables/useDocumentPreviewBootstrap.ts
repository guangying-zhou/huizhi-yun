interface DocumentPreviewBootstrapPayload {
  content: string
  aiAbstract?: string
}

type DocumentPreviewBootstrapState = Record<string, DocumentPreviewBootstrapPayload | undefined>

export const useDocumentPreviewBootstrap = () => {
  const state = useState<DocumentPreviewBootstrapState>('document-preview-bootstrap', () => ({}))

  const getPayload = (uuid: string) => state.value[uuid]

  const setPayload = (uuid: string, payload: DocumentPreviewBootstrapPayload) => {
    state.value = {
      ...state.value,
      [uuid]: payload
    }
  }

  const consumePayload = (uuid: string) => {
    const payload = state.value[uuid]

    if (!payload) {
      return undefined
    }

    const { [uuid]: _omitted, ...nextState } = state.value
    state.value = nextState

    return payload
  }

  const clearPayload = (uuid: string) => {
    if (!(uuid in state.value)) {
      return
    }

    const { [uuid]: _omitted, ...nextState } = state.value
    state.value = nextState
  }

  return {
    getPayload,
    setPayload,
    consumePayload,
    clearPayload
  }
}
