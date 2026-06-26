import { readBody } from 'h3'
import { ok } from '~~/server/utils/api'
import { createPlatformSession, touchAccountLogin } from '~~/server/utils/platformAuth'
import {
  findAccountForPasswordLogin,
  markLocalEmailIdentityLogin,
  normalizeEmail,
  normalizeRedirect,
  verifyPassword
} from '~~/server/utils/emailAuth'

type LoginBody = {
  email?: string
  password?: string
  redirect?: string
}

function publicAccount(account: {
  uid: string
  username: string
  email: string
  display_name: string
  account_type: string
}) {
  return {
    uid: account.uid,
    username: account.username,
    email: account.email,
    displayName: account.display_name,
    accountType: account.account_type
  }
}

function throwInvalidLogin(): never {
  throw createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    message: '邮箱或密码不正确'
  })
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const body = await readBody<LoginBody | null>(event).catch(() => null)
  const email = normalizeEmail(body?.email)
  const password = String(body?.password || '')
  const account = await findAccountForPasswordLogin(email)

  if (!account) {
    throwInvalidLogin()
  }

  const passwordMatched = await verifyPassword(password, account.password_hash)
  if (!passwordMatched) {
    throwInvalidLogin()
  }

  if (account.status === 'pending_activation') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '账号尚未激活，请先通过邮件链接激活'
    })
  }

  if (account.status !== 'active') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '账号不可用，请联系管理员'
    })
  }

  if (account.account_type !== 'tenant_admin') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '该入口仅允许企业管理员账号登录'
    })
  }

  const sessionUuid = await createPlatformSession(event, {
    accountId: account.id,
    idpType: 'local_email',
    sessionScope: 'tenant_admin',
    ttlSeconds: Number(runtimeConfig.auth?.sessionTtlSeconds) || undefined
  })

  await touchAccountLogin(account.id)
  await markLocalEmailIdentityLogin(account.id)

  return ok({
    account: publicAccount(account),
    session: {
      sessionUuid,
      scope: 'tenant_admin'
    },
    redirect: normalizeRedirect(body?.redirect)
  })
})
