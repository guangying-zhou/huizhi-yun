/**
 * Collaboration authentication extension.
 *
 * Validates the short-lived document token issued by Codocs.
 */

import type { Extension, onAuthenticatePayload } from '@hocuspocus/server'
import { createHookError, resolveDocumentContext } from '../utils/document-context.js'
import { verifyCollaborationToken } from '../utils/collaboration-auth.js'

export class AuthenticationExtension implements Extension {
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
  }> {
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
