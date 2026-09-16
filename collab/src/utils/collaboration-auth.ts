import crypto from 'node:crypto'

interface CollaborationDocumentClaims {
  docId: number
  docUuid: string
  docType: string
  ossPath: string
  ownerUid: string
  sharePermission: 'read' | 'write' | null
  readonly: boolean
}

interface CollaborationAuthPayload {
  uid: string
  name: string
  documentName: string
  issuedAt: number
  expiresAt: number
  document: CollaborationDocumentClaims
}

const DEV_FALLBACK_SECRET = 'codocs-collaboration-dev-secret'

const getCollaborationAuthSecret = () => {
  const secret = String(process.env.COLLABORATION_AUTH_SECRET || '').trim()

  if (secret) {
    return secret
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEV_FALLBACK_SECRET
  }

  throw new Error('collaboration-auth-secret-missing')
}

const createSignature = (encodedPayload: string, secret: string) => crypto
  .createHmac('sha256', secret)
  .update(encodedPayload)
  .digest('base64url')

const decodePayload = (encodedPayload: string): CollaborationAuthPayload | null => {
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8')) as Partial<CollaborationAuthPayload>
    const issuedAt = Number(payload.issuedAt)
    const expiresAt = Number(payload.expiresAt)

    if (
      typeof payload.uid !== 'string'
      || typeof payload.name !== 'string'
      || typeof payload.documentName !== 'string'
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || typeof payload.document !== 'object'
      || payload.document === null
    ) {
      return null
    }

    const document = payload.document as Partial<CollaborationDocumentClaims>

    if (
      typeof document.docId !== 'number'
      || typeof document.docUuid !== 'string'
      || typeof document.docType !== 'string'
      || typeof document.ossPath !== 'string'
      || typeof document.ownerUid !== 'string'
      || typeof document.readonly !== 'boolean'
      || (
        document.sharePermission !== null
        && document.sharePermission !== 'read'
        && document.sharePermission !== 'write'
      )
    ) {
      return null
    }

    return {
      uid: payload.uid,
      name: payload.name,
      documentName: payload.documentName,
      issuedAt,
      expiresAt,
      document: {
        docId: document.docId,
        docUuid: document.docUuid,
        docType: document.docType,
        ossPath: document.ossPath,
        ownerUid: document.ownerUid,
        sharePermission: document.sharePermission,
        readonly: document.readonly
      }
    }
  } catch {
    return null
  }
}

export const verifyCollaborationToken = (
  token: string,
  expectedDocumentName: string
): CollaborationAuthPayload | null => {
  const [encodedPayload, signature] = String(token || '').split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = createSignature(encodedPayload, getCollaborationAuthSecret())
  const actual = Buffer.from(signature, 'utf-8')
  const expected = Buffer.from(expectedSignature, 'utf-8')

  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return null
  }

  const payload = decodePayload(encodedPayload)

  if (!payload) {
    return null
  }

  if (payload.documentName !== expectedDocumentName) {
    return null
  }

  if (payload.expiresAt <= Date.now()) {
    return null
  }

  return payload
}
