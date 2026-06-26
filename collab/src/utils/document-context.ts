import { callCodocsRuntime } from './codocs-runtime.js'

const DOCUMENT_NAME_PREFIX = 'doc:'
const DOCUMENT_NAME_PATTERN = /^doc:([0-9a-fA-F-]{36})$/

export interface CollaborationDocumentContext {
  docId: number
  docUuid: string
  docType: string
  ossPath: string
  ownerUid: string
  actorUid: string
  actorName: string
  sharePermission: 'read' | 'write' | null
  readonly: boolean
}

interface CollaborationVersionInput {
  docId: number
  docUuid?: string
  editorUid?: string
  actorUid?: string
  ossVersionId?: string
  contentSize?: number
}

interface ResolveDocumentContextOptions {
  documentName: string
  actorUid: string
  actorName?: string
}

interface StoredDocumentContext {
  docId?: unknown
  docUuid?: unknown
  docType?: unknown
  ossPath?: unknown
  ownerUid?: unknown
  actorUid?: unknown
  actorName?: unknown
  sharePermission?: unknown
  readonly?: unknown
}

export const createHookError = (reason: string) => {
  const error = new Error(reason) as Error & { reason: string }
  error.reason = reason
  return error
}

export const parseDocumentName = (documentName: string): string => {
  const normalized = String(documentName || '').trim()
  const match = DOCUMENT_NAME_PATTERN.exec(normalized)

  if (!match?.[1]) {
    throw createHookError(`invalid-document-name:${DOCUMENT_NAME_PREFIX}<uuid> expected`)
  }

  return match[1]
}

export const resolveDocumentContext = async (options: ResolveDocumentContextOptions): Promise<CollaborationDocumentContext> => {
  const actorUid = String(options.actorUid || '').trim()
  if (!actorUid) {
    throw createHookError('authentication-required')
  }

  const uuid = parseDocumentName(options.documentName)

  return await callCodocsRuntime<CollaborationDocumentContext>(`/v1/codocs/collaboration/documents/${uuid}/context`, {
    query: {
      actorUid,
      actorName: String(options.actorName || actorUid).trim() || actorUid
    }
  })
}

export const getStoredDocumentContext = (context: unknown): CollaborationDocumentContext | null => {
  const value = (context || {}) as StoredDocumentContext

  if (
    typeof value.docId !== 'number'
    || typeof value.docUuid !== 'string'
    || typeof value.docType !== 'string'
    || typeof value.ossPath !== 'string'
    || typeof value.ownerUid !== 'string'
    || typeof value.actorUid !== 'string'
    || typeof value.actorName !== 'string'
    || typeof value.readonly !== 'boolean'
  ) {
    return null
  }

  return {
    docId: value.docId,
    docUuid: value.docUuid,
    docType: value.docType,
    ossPath: value.ossPath,
    ownerUid: value.ownerUid,
    actorUid: value.actorUid,
    actorName: value.actorName,
    sharePermission: value.sharePermission === 'read' || value.sharePermission === 'write'
      ? value.sharePermission
      : null,
    readonly: value.readonly
  }
}

export const loadDocumentContext = async (documentName: string, context?: unknown): Promise<CollaborationDocumentContext> => {
  const storedContext = getStoredDocumentContext(context)
  if (storedContext) {
    return storedContext
  }

  const uuid = parseDocumentName(documentName)

  return await callCodocsRuntime<CollaborationDocumentContext>(`/v1/codocs/collaboration/documents/${uuid}/context`)
}

export const createDocumentVersion = async (input: CollaborationVersionInput): Promise<void> => {
  const path = input.docUuid
    ? `/v1/codocs/documents/${input.docUuid}/versions`
    : '/v1/codocs/collaboration/versions'

  await callCodocsRuntime(path, {
    method: 'POST',
    body: input
  })
}
