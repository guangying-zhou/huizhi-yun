/**
 * Collaboration authentication extension.
 *
 * Validates the short-lived document token issued by Codocs.
 */

import type { Extension, onAuthenticatePayload } from '@hocuspocus/server'
import { createHookError, resolveDocumentContext } from '../utils/document-context.js'
import { verifyCollaborationToken } from '../utils/collaboration-auth.js'
import { isV2Ticket, type V2Snapshots } from '../utils/v2-snapshots.js'

export class AuthenticationExtension implements Extension {
  private v2: V2Snapshots | null = null

  useV2(v2: V2Snapshots | null) {
    this.v2 = v2
  }

  /**
   * 用户认证回调
   * 在 WebSocket 连接建立时调用
   */
  async onAuthenticate(data: onAuthenticatePayload): Promise<{
    user: { id: string, name: string, color: string }
    docId: number
    docUuid: string
    docType: string
    ossPath: string
    ownerUid: string
    actorUid: string
    actorName: string
    sharePermission: 'read' | 'write' | null
    readonly: boolean
  } | {
    user: { id: string, name: string, color: string }
    mode: 'v2'
    sessionId: string
    docUuid: string
    actorUid: string
    readonly: boolean
  }> {
    const token = String(data.token || '').trim()
    if (isV2Ticket(token)) {
      // v2: redeem the one-time ticket before any document state is loaded.
      if (!this.v2) throw createHookError('authentication-required')
      const admission = await this.v2.admit(token, data.documentName).catch(() => {
        throw createHookError('authentication-required')
      })
      data.connectionConfig.readOnly = admission.access !== 'write'
      return {
        user: { id: admission.userUid, name: admission.userUid, color: this.generateUserColor(admission.userUid) },
        mode: 'v2',
        sessionId: admission.sessionId,
        docUuid: admission.documentUuid,
        actorUid: admission.userUid,
        readonly: admission.access !== 'write'
      }
    }
    const identity = await this.resolveIdentity(data)
    const documentContext = identity.documentContext || await resolveDocumentContext({
      documentName: data.documentName,
      actorUid: identity.id,
      actorName: identity.name
    })

    data.connectionConfig.readOnly = documentContext.readonly

    const user = {
      id: identity.id,
      name: identity.name,
      color: this.generateUserColor(identity.id)
    }

    console.log(
      `[collab] authenticated user: ${user.name} for ${data.documentName} (${documentContext.readonly ? 'readonly' : 'read-write'})`
    )

    return {
      user,
      ...documentContext
    }
  }

  /**
   * 解析当前连接身份
   * 仅接受由 Codocs 服务端签发的短期协同 token。
   */
  private async resolveIdentity(data: onAuthenticatePayload): Promise<{
    id: string
    name: string
    documentContext?: {
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
  }> {
    const token = String(data.token || '').trim()
    const payload = verifyCollaborationToken(token, data.documentName)

    if (payload) {
      return {
        id: payload.uid,
        name: payload.name || payload.uid,
        documentContext: {
          docId: payload.document.docId,
          docUuid: payload.document.docUuid,
          docType: payload.document.docType,
          ossPath: payload.document.ossPath,
          ownerUid: payload.document.ownerUid,
          actorUid: payload.uid,
          actorName: payload.name || payload.uid,
          sharePermission: payload.document.sharePermission,
          readonly: payload.document.readonly
        }
      }
    }

    throw createHookError('authentication-required')
  }

  /**
   * 根据用户 ID 生成固定颜色
   */
  private generateUserColor(userId: string): string {
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash)
    }

    const colors = [
      '#f87171', '#fb923c', '#fbbf24', '#a3e635',
      '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8',
      '#c084fc', '#f472b6'
    ]

    return colors[Math.abs(hash) % colors.length] ?? '#f87171'
  }
}
