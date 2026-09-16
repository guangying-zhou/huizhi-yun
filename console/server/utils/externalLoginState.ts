import { createHash, randomBytes } from 'node:crypto'
import { createError, getCookie, getHeader, setCookie, type H3Event } from 'h3'
import { getAuthCookieOptions } from '@hzy/foundation/server/utils/cookie-domain'
import {
  consumeConsoleExternalLoginTransaction,
  issueConsoleExternalLoginTransaction
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { normalizeConsoleAuthReturnRedirect } from './authReturnRedirect'

type ExternalLoginProvider = 'wecom' | 'dingtalk'

const BINDING_COOKIE = 'hzy_external_login_binding'

function normalizeIntegrationCode(value: unknown) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,126}[a-zA-Z0-9]$/.test(normalized)) {
    throw createError({ statusCode: 400, message: '企业登录集成代码无效' })
  }
  return normalized
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeTargetApp(value: unknown, fallback: string) {
  const normalized = String(value || fallback).trim().toLowerCase()
  return /^[a-z][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : fallback
}

function browserBinding(event: H3Event) {
  const existing = String(getCookie(event, BINDING_COOKIE) || '').trim()
  const value = /^hzy_eb_[A-Za-z0-9_-]{32,}$/.test(existing)
    ? existing
    : `hzy_eb_${randomBytes(32).toString('base64url')}`
  const secure = String(getHeader(event, 'x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase() === 'https'
  setCookie(event, BINDING_COOKIE, value, getAuthCookieOptions(event, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 10 * 60
  }))
  return value
}

export async function issueExternalLoginTransaction(event: H3Event, input: {
  provider: ExternalLoginProvider
  integrationCode?: unknown
  targetApp?: unknown
  redirect?: unknown
  defaultApp: string
}) {
  const state = `hzy_es_${randomBytes(32).toString('base64url')}`
  const targetApp = normalizeTargetApp(input.targetApp, input.defaultApp)
  const redirectPath = normalizeConsoleAuthReturnRedirect(input.redirect)
  const integrationCode = normalizeIntegrationCode(input.integrationCode)
  const runtime = await issueConsoleExternalLoginTransaction(event, {
    provider: input.provider,
    integrationCode,
    stateSha256: sha256(state),
    browserBindingSha256: sha256(browserBinding(event)),
    targetApp,
    redirect: redirectPath
  })
  return { state, expiresAt: runtime.data.expiresAt }
}

export async function consumeExternalLoginTransaction(event: H3Event, input: {
  provider: ExternalLoginProvider
  state: unknown
}) {
  const state = String(input.state || '').trim()
  const browserValue = String(getCookie(event, BINDING_COOKIE) || '').trim()
  if (!/^hzy_es_[A-Za-z0-9_-]{32,}$/.test(state) || !/^hzy_eb_[A-Za-z0-9_-]{32,}$/.test(browserValue)) {
    throw createError({ statusCode: 400, message: '企业登录状态无效或已过期' })
  }
  const runtime = await consumeConsoleExternalLoginTransaction(event, {
    provider: input.provider,
    stateSha256: sha256(state),
    browserBindingSha256: sha256(browserValue)
  })
  return {
    targetApp: runtime.data.targetApp,
    integrationCode: runtime.data.integrationCode,
    redirect: normalizeConsoleAuthReturnRedirect(runtime.data.redirect)
  }
}
