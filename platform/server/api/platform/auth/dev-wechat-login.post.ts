import { readBody } from 'h3'
import { ok } from '~~/server/utils/api'
import {
  createPlatformSession,
  touchAccountLogin,
  upsertDevWechatAdmin
} from '~~/server/utils/platformAuth'
import { parseCsvSet } from '~~/server/utils/access'

type DevWechatLoginBody = {
  uid?: string
  displayName?: string
  phone?: string
  redirect?: string
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function firstCsvValue(value: unknown) {
  return [...parseCsvSet(value)][0] || ''
}

function normalizeRedirect(value: unknown) {
  const redirect = normalizeString(value)
  if (!redirect || !redirect.startsWith('/admin') || redirect.startsWith('//')) {
    return '/admin'
  }

  return redirect
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const authConfig = runtimeConfig.auth || {}
  const securityConfig = runtimeConfig.security || {}

  if (!authConfig.devMockEnabled || process.env.NODE_ENV === 'production') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'dev wechat login is disabled'
    })
  }

  const body = await readBody<DevWechatLoginBody | null>(event).catch(() => null)
  const fallbackUid = normalizeString(authConfig.devUid)
    || firstCsvValue(securityConfig.opsBootstrapUids)
    || firstCsvValue(securityConfig.opsUids)
    || normalizeString(process.env.USER)
    || 'dev-admin'
  const uid = normalizeString(body?.uid) || fallbackUid
  const displayName = normalizeString(body?.displayName)
    || normalizeString(authConfig.devDisplayName)
    || uid
  const externalSubjectKey = `dev-wechat:${uid}`
  const bootstrapUids = [
    ...parseCsvSet(securityConfig.opsBootstrapUids),
    uid
  ]
  const account = await upsertDevWechatAdmin({
    uid,
    displayName,
    phone: normalizeString(body?.phone) || undefined,
    externalSubjectKey,
    bootstrapUids
  })

  const sessionUuid = await createPlatformSession(event, {
    accountId: account.id,
    idpType: 'wechat_dev',
    sessionScope: 'platform_admin',
    ttlSeconds: Number(authConfig.sessionTtlSeconds) || undefined
  })

  await touchAccountLogin(account.id)

  return ok({
    account: {
      uid: account.uid,
      username: account.username,
      email: account.email,
      displayName: account.display_name,
      accountType: account.account_type
    },
    session: {
      sessionUuid,
      scope: 'platform_admin'
    },
    redirect: normalizeRedirect(body?.redirect)
  })
})
