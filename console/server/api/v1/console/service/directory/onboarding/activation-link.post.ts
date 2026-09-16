import { readBody } from 'h3'
import { issueConsoleDirectoryActivationCredentialForServiceCommand } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { NotificationDeliveryError, sendNotification } from '@hzy/foundation/server/utils/notify'
import { configuredDeploymentPublicUrl } from '~~/server/utils/authClients'
import {
  resolvePeopleDirectoryTargetBinding,
  verifyPeopleDirectorySignature
} from '~~/server/utils/directoryLifecycleReliable'
import { parseOnboardingProvisioningCommand } from '~~/server/utils/onboardingProvisioningContract'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', 'console:directory-user:provision', {
    requireBoundTargetApp: true
  })
  const binding = resolvePeopleDirectoryTargetBinding(event, actor.tenantCode)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  verifyPeopleDirectorySignature(event, body, binding)
  const { command, uid } = parseOnboardingProvisioningCommand(body, 'activation-link')
  const providerCode = String(command.providerCode || '').trim().toLowerCase()
  if (providerCode !== 'dingtalk') {
    throw createError({ statusCode: 409, message: '受控入职激活链接目前只支持投递到钉钉员工身份。' })
  }

  const issued = await issueConsoleDirectoryActivationCredentialForServiceCommand(
    event,
    body,
    String(command.actorUid || '').trim()
  )
  const issuedData = (issued.data || {}) as Record<string, unknown>
  const token = String(issuedData.activationToken || '')
  const credentialId = String(issuedData.activationCredentialId || '')
  const expiresAt = String(issuedData.activationExpiresAt || '')
  const base = String(configuredDeploymentPublicUrl() || '').replace(/\/+$/, '')
  if (!base || !token || !credentialId) {
    throw createError({ statusCode: 503, message: 'Console 无法生成员工激活链接。' })
  }

  try {
    await sendNotification({
      event,
      touser: uid,
      externalRecipients: String(command.providerSubject || '').trim(),
      channel: 'dingtalk',
      integrationCode: 'dingtalk.default',
      title: '激活你的企业账号',
      description: expiresAt
        ? `请在 ${expiresAt} 前打开链接设置登录密码。链接仅可使用一次。`
        : '请打开链接设置登录密码。链接仅可使用一次。',
      url: `${base}/set-password?token=${encodeURIComponent(token)}`,
      // 站内通知是持久数据，只保存无凭据的入口；带 token 的 URL 仅交给外部钉钉 API。
      inAppUrl: `${base}/set-password`,
      btntxt: '设置密码',
      category: 'directory',
      eventType: 'directory.account.activation',
      severity: 'info',
      bizType: 'directory_user',
      bizId: uid,
      // 使用不敏感且真正唯一的凭据 ID，避免同一秒连续重发时 expiresAt 相同、
      // 新 token 却撞上旧投递幂等键。
      idempotencyKey: `directory:activation:${uid}:${credentialId}`
    })
  } catch (error) {
    // Fetch errors may retain request options; the external URL contains the
    // one-time bearer token, so log only bounded classification metadata.
    console.error('[Directory] DingTalk activation delivery failed', {
      uid,
      code: String((error as { code?: unknown })?.code || 'notification_delivery_failed'),
      failedChannels: error instanceof NotificationDeliveryError ? error.failedChannels : []
    })
    return { code: 0, message: 'delivery_failed', data: { activationDelivered: false, activationExpiresAt: expiresAt } }
  }

  return { code: 0, message: 'ok', data: { activationDelivered: true, activationExpiresAt: expiresAt } }
})
