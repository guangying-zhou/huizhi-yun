import {
  createConsoleDirectoryUser,
  queueConsoleDirectoryLDAPUserCreate
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { NotificationDeliveryError, sendNotification } from '@hzy/foundation/server/utils/notify'
import { configuredDeploymentPublicUrl } from '~~/server/utils/authClients'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryUserInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryUserForAdmin, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { setResponseStatus } from 'h3'

async function deliverActivationLink(
  event: Parameters<typeof sendNotification>[0]['event'],
  uid: string,
  token: string,
  credentialId: string,
  expiresAt: string
) {
  // 复用 Console 既有的部署公网地址解析，不另起一套 env 优先级。
  const base = String(configuredDeploymentPublicUrl() || '').replace(/\/+$/, '')
  if (!base) throw createError({ statusCode: 503, message: 'Console 部署公网地址未配置，无法生成激活链接' })
  const url = `${base}/set-password?token=${encodeURIComponent(token)}`
  try {
    await sendNotification({
      event,
      touser: uid,
      title: '激活你的企业账号',
      description: expiresAt
        ? `请在 ${expiresAt} 前打开链接设置登录密码。链接仅可使用一次。`
        : '请打开链接设置登录密码。链接仅可使用一次。',
      url,
      inAppUrl: `${base}/set-password`,
      btntxt: '设置密码',
      category: 'directory',
      eventType: 'directory.account.activation',
      severity: 'info',
      bizType: 'directory_user',
      bizId: uid,
      idempotencyKey: `directory:activation:${uid}:${credentialId}`
    })
    return true
  } catch (error) {
    // 投递失败不回滚已排队的建号操作：账号本身是有效的，管理员可以重新签发
    // 激活链接。把失败吞掉伪装成成功会让员工永远等不到链接。
    // External fetch errors may retain their request options, including the
    // one-time bearer URL. Never pass the raw error object to a persistent log.
    console.error('[Directory] activation link delivery failed', {
      uid,
      code: String((error as { code?: unknown })?.code || 'notification_delivery_failed'),
      failedChannels: error instanceof NotificationDeliveryError ? error.failedChannels : []
    })
    return false
  }
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_users', 'edit', '需要目录用户编辑权限')
  requireIdempotencyKey(event)

  await requireConsoleRequestUid(event)
  const body = await readBody<DirectoryUserInput & { provisioningTarget?: unknown, initialPassword?: unknown }>(event)
  if (String(body.provisioningTarget || '').trim() === 'ldap') {
    const { provisioningTarget: _provisioningTarget, ...ldapBody } = body
    const operation = await queueConsoleDirectoryLDAPUserCreate(event, ldapBody as Record<string, unknown>)
    setResponseStatus(event, 202)

    const data = (operation as { data?: Record<string, unknown> }).data || {}
    const activationToken = String(data.activationToken || '')
    const activationCredentialId = String(data.activationCredentialId || '')
    if (!activationToken || !activationCredentialId) return operation

    // 激活令牌只能直达员工本人。它绝不回传给调用方——People 受控入职按约束
    // 不得接收明文凭据，HR 也不需要经手。这里发送后从响应里剔除令牌，
    // 只保留投递结果与有效期。
    const uid = String(body.uid || '').trim()
    const delivered = await deliverActivationLink(
      event,
      uid,
      activationToken,
      activationCredentialId,
      String(data.activationExpiresAt || '')
    )
    const { activationToken: _token, ...safeData } = data
    return { ...operation, data: { ...safeData, activationDelivered: delivered } }
  }
  const { provisioningTarget: _provisioningTarget, ...directoryBody } = body
  await createConsoleDirectoryUser(event, directoryBody as Record<string, unknown>)

  const uid = String(body.uid || '').trim()
  return ok(await getDirectoryUserForAdmin(uid))
})
