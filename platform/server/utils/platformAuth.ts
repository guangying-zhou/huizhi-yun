import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { createHash } from 'node:crypto'
import {
  deleteCookie,
  getCookie,
  getHeader,
  getRequestIP,
  setCookie
} from 'h3'
import { execute, queryRow, withTransaction } from '~~/server/utils/db'
import { ensureOpsRbacReady, grantOpsSuperAdminRoleToAccount } from '~~/server/utils/platformOpsRbac'

export type PlatformSessionScope = 'platform_admin' | 'tenant_admin'

export const PLATFORM_SESSION_COOKIE = 'hzy_platform_session'
export const PLATFORM_ADMIN_SESSION_COOKIE = 'hzy_platform_admin_session'
export const TENANT_DASHBOARD_SESSION_COOKIE = 'hzy_tenant_dashboard_session'
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60

interface SessionRow extends RowDataPacket {
  session_uuid: string
  account_id: number
  session_scope: string
  tenant_code: string | null
  expires_at: string
  uid: string
  username: string
  email: string
  display_name: string
  account_type: string
}

interface AccountRow extends RowDataPacket {
  id: number
  uid: string
  username: string
  email: string
  display_name: string
  account_type: string
}

export interface PlatformSessionContext {
  sessionUuid: string
  accountId: number
  uid: string
  username: string
  email: string
  displayName: string
  accountType: string
  sessionScope: string
  tenantCode: string | null
  expiresAt: string
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeEmail(value: unknown) {
  return normalizeString(value).toLowerCase()
}

function usernameFromEmail(email: string) {
  const localPart = email.split('@')[0] || email
  return localPart
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'google-user'
}

function uidFromGoogleSubject(subject: string) {
  const suffix = subject
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 57)
  return `google-${suffix || 'user'}`
}

function sanitizeUid(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function uidFromWecomUserid(userid: string) {
  const normalized = sanitizeUid(userid).slice(0, 64)
  return normalized || 'wecom-user'
}

function fallbackUidFromWecomUserid(userid: string) {
  const normalized = sanitizeUid(userid).slice(0, 45)
  const digest = createHash('sha256').update(userid).digest('hex').slice(0, 12)
  return `wecom-${normalized || 'user'}-${digest}`.slice(0, 64)
}

function localPlatformEmail(uid: string) {
  return `${uid.toLowerCase()}@local.platform`
}

function normalizeSessionScope(value: unknown): PlatformSessionScope {
  return value === 'tenant_admin' ? 'tenant_admin' : 'platform_admin'
}

function sessionCookieNameForScope(scope: PlatformSessionScope) {
  return scope === 'tenant_admin'
    ? TENANT_DASHBOARD_SESSION_COOKIE
    : PLATFORM_ADMIN_SESSION_COOKIE
}

function expectedAccountTypeForScope(scope: PlatformSessionScope) {
  return scope === 'tenant_admin' ? 'tenant_admin' : 'staff'
}

function sessionCookieOptions(maxAge = DEFAULT_SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge
  }
}

function getClientIp(event: H3Event) {
  return normalizeString(getRequestIP(event, { xForwardedFor: true }))
}

function getUserAgent(event: H3Event) {
  return normalizeString(getHeader(event, 'user-agent')).slice(0, 500)
}

function toSessionContext(row: SessionRow): PlatformSessionContext {
  return {
    sessionUuid: row.session_uuid,
    accountId: Number(row.account_id),
    uid: row.uid,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    accountType: row.account_type,
    sessionScope: row.session_scope,
    tenantCode: row.tenant_code,
    expiresAt: row.expires_at
  }
}

function readSessionUuid(event: H3Event, scope?: PlatformSessionScope) {
  if (scope) {
    return normalizeString(getCookie(event, sessionCookieNameForScope(scope)))
  }

  return normalizeString(
    getCookie(event, PLATFORM_ADMIN_SESSION_COOKIE)
    || getCookie(event, TENANT_DASHBOARD_SESSION_COOKIE)
    || getCookie(event, PLATFORM_SESSION_COOKIE)
  )
}

export async function resolvePlatformSession(event: H3Event, options: {
  scope?: PlatformSessionScope
} = {}) {
  const scope = options.scope
  const sessionUuid = readSessionUuid(event, scope)
  if (!sessionUuid) {
    return null
  }

  const where: string[] = [
    'ps.session_uuid = ?',
    'ps.status = \'active\'',
    'ps.expires_at > UTC_TIMESTAMP()'
  ]
  const params: unknown[] = [sessionUuid]

  if (scope) {
    where.push('ps.session_scope = ?')
    params.push(scope)
    where.push('pa.account_type = ?')
    params.push(expectedAccountTypeForScope(scope))
  }

  const row = await queryRow<SessionRow>(
    `SELECT ps.session_uuid, ps.account_id, ps.session_scope, ps.tenant_code, ps.expires_at,
            pa.uid, pa.username, pa.email, pa.display_name, pa.account_type
     FROM platform_sessions ps
     INNER JOIN platform_accounts pa
       ON pa.id = ps.account_id
      AND pa.status = 'active'
     WHERE ${where.join(' AND ')}
     LIMIT 1`,
    params
  )

  if (!row) {
    if (scope) {
      deleteCookie(event, sessionCookieNameForScope(scope), sessionCookieOptions(0))
    } else {
      deleteCookie(event, PLATFORM_ADMIN_SESSION_COOKIE, sessionCookieOptions(0))
      deleteCookie(event, TENANT_DASHBOARD_SESSION_COOKIE, sessionCookieOptions(0))
      deleteCookie(event, PLATFORM_SESSION_COOKIE, sessionCookieOptions(0))
    }
    return null
  }

  return toSessionContext(row)
}

export async function createPlatformSession(event: H3Event, options: {
  accountId: number
  idpType: string
  sessionScope?: string
  tenantCode?: string | null
  ttlSeconds?: number
}) {
  const sessionUuid = crypto.randomUUID()
  const ttlSeconds = options.ttlSeconds || DEFAULT_SESSION_TTL_SECONDS
  const sessionScope = normalizeSessionScope(options.sessionScope)
  const expectedAccountType = expectedAccountTypeForScope(sessionScope)

  const account = await queryRow<AccountRow>(
    `SELECT id, uid, username, email, display_name, account_type
     FROM platform_accounts
     WHERE id = ?
       AND status = 'active'
     LIMIT 1`,
    [options.accountId]
  )

  if (!account || account.account_type !== expectedAccountType) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `account type mismatch for ${sessionScope}`
    })
  }

  await execute<ResultSetHeader>(
    `INSERT INTO platform_sessions
      (session_uuid, account_id, session_scope, tenant_code, idp_type, issued_at, expires_at, refreshed_at, status, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), NULL, 'active', ?, ?, UTC_TIMESTAMP())`,
    [
      sessionUuid,
      options.accountId,
      sessionScope,
      options.tenantCode || null,
      options.idpType,
      ttlSeconds,
      getClientIp(event) || null,
      getUserAgent(event) || null
    ]
  )

  deleteCookie(event, PLATFORM_SESSION_COOKIE, sessionCookieOptions(0))
  setCookie(event, sessionCookieNameForScope(sessionScope), sessionUuid, sessionCookieOptions(ttlSeconds))

  return sessionUuid
}

export async function revokePlatformSession(event: H3Event, options: {
  scope?: PlatformSessionScope
} = {}) {
  const scopes = options.scope ? [options.scope] : ['platform_admin', 'tenant_admin'] as PlatformSessionScope[]
  const sessionUuids = new Set<string>()

  for (const scope of scopes) {
    const sessionUuid = normalizeString(getCookie(event, sessionCookieNameForScope(scope)))
    if (sessionUuid) {
      sessionUuids.add(sessionUuid)
    }
  }

  const legacySessionUuid = normalizeString(getCookie(event, PLATFORM_SESSION_COOKIE))
  if (!options.scope && legacySessionUuid) {
    sessionUuids.add(legacySessionUuid)
  }

  for (const sessionUuid of sessionUuids) {
    await execute<ResultSetHeader>(
      `UPDATE platform_sessions
       SET status = 'revoked', refreshed_at = UTC_TIMESTAMP()
       WHERE session_uuid = ?`,
      [sessionUuid]
    )
  }

  for (const scope of scopes) {
    deleteCookie(event, sessionCookieNameForScope(scope), sessionCookieOptions(0))
  }

  if (!options.scope) {
    deleteCookie(event, PLATFORM_SESSION_COOKIE, sessionCookieOptions(0))
  }
}

export async function touchAccountLogin(accountId: number) {
  await execute<ResultSetHeader>(
    `UPDATE platform_accounts
     SET last_login_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [accountId]
  )
}

export async function upsertDevWechatAdmin(options: {
  uid: string
  displayName: string
  externalSubjectKey: string
  phone?: string
  bootstrapUids?: string[]
}) {
  const uid = normalizeString(options.uid)
  const username = uid.toLowerCase()
  const displayName = normalizeString(options.displayName) || uid
  const email = `${username}@local.platform`
  const externalSubjectKey = normalizeString(options.externalSubjectKey)

  await ensureOpsRbacReady([...(options.bootstrapUids || []), uid])

  const existingAccount = await queryRow<AccountRow>(
    `SELECT id, uid, username, email, display_name, account_type
     FROM platform_accounts
     WHERE uid = ?
        OR email = ?
     LIMIT 1`,
    [uid, email]
  )

  if (existingAccount && existingAccount.account_type !== 'staff') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: '该账号已被企业管理员主体使用'
    })
  }

  await execute<ResultSetHeader>(
    `INSERT INTO platform_accounts
      (uid, account_type, username, email, display_name, password_hash, oidc_sub, mfa_enabled, status, created_at, updated_at)
     VALUES (?, 'staff', ?, ?, ?, NULL, NULL, 0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       account_type = 'staff',
       display_name = VALUES(display_name),
       status = 'active',
       updated_at = UTC_TIMESTAMP()`,
    [uid, username, email, displayName]
  )

  const account = await queryRow<AccountRow>(
    `SELECT id, uid, username, email, display_name, account_type
     FROM platform_accounts
     WHERE uid = ?
     LIMIT 1`,
    [uid]
  )

  if (!account) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to seed platform admin account'
    })
  }

  await execute<ResultSetHeader>(
    `INSERT INTO platform_account_identities
      (account_id, provider_type, provider_code, external_subject_key, external_tenant_key, profile_json, status, last_login_at, created_at, updated_at)
     VALUES (?, 'wechat_dev', 'dev', ?, NULL, CAST(? AS JSON), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       account_id = VALUES(account_id),
       profile_json = VALUES(profile_json),
       status = 'active',
       last_login_at = UTC_TIMESTAMP(),
       updated_at = UTC_TIMESTAMP()`,
    [
      account.id,
      externalSubjectKey,
      JSON.stringify({
        uid,
        displayName,
        phone: options.phone || null,
        provider: 'dev-wechat'
      })
    ]
  )

  return account
}

export async function upsertGoogleAdmin(options: {
  email: string
  emailVerified: boolean
  subject: string
  displayName: string
  picture?: string
  hostedDomain?: string
  allowProvision?: boolean
}) {
  const email = normalizeEmail(options.email)
  const subject = normalizeString(options.subject)
  const preferredUid = usernameFromEmail(email)
  const displayName = normalizeString(options.displayName) || email
  const hostedDomain = normalizeString(options.hostedDomain).toLowerCase() || null

  if (!email || !subject || !options.emailVerified) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Google 账号邮箱未验证，不能用于平台员工登录'
    })
  }

  const account = await withTransaction<AccountRow>(async (tx) => {
    const existingEmailAccount = await tx.queryRow<AccountRow>(
      `SELECT id, uid, username, email, display_name, account_type
       FROM platform_accounts
       WHERE email = ?
       LIMIT 1`,
      [email]
    )
    const preferredUidAccount = await tx.queryRow<AccountRow>(
      `SELECT id, uid, username, email, display_name, account_type
       FROM platform_accounts
       WHERE uid = ?
       LIMIT 1`,
      [preferredUid]
    )
    let accountUid = preferredUid
    let accountEmail = email
    let existingAccount: AccountRow | null = null

    if (existingEmailAccount?.account_type === 'staff') {
      existingAccount = existingEmailAccount
      accountUid = existingEmailAccount.uid
    } else if (existingEmailAccount) {
      accountEmail = localPlatformEmail(preferredUid)

      if (preferredUidAccount?.account_type === 'staff') {
        existingAccount = preferredUidAccount
        accountUid = preferredUidAccount.uid
        accountEmail = preferredUidAccount.email
      } else if (preferredUidAccount) {
        accountUid = uidFromGoogleSubject(subject)
        accountEmail = localPlatformEmail(accountUid)
        existingAccount = await tx.queryRow<AccountRow>(
          `SELECT id, uid, username, email, display_name, account_type
           FROM platform_accounts
           WHERE uid = ?
           LIMIT 1`,
          [accountUid]
        )
      }
    } else if (preferredUidAccount?.account_type === 'staff') {
      existingAccount = preferredUidAccount
      accountUid = preferredUidAccount.uid
    } else if (preferredUidAccount) {
      accountUid = uidFromGoogleSubject(subject)
      existingAccount = await tx.queryRow<AccountRow>(
        `SELECT id, uid, username, email, display_name, account_type
         FROM platform_accounts
         WHERE uid = ?
         LIMIT 1`,
        [accountUid]
      )
    }

    if (existingAccount && existingAccount.account_type !== 'staff') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: '该 Google 账号与已有企业管理员 UID 冲突'
      })
    }

    if (
      existingEmailAccount?.account_type === 'staff'
      && preferredUidAccount?.account_type === 'staff'
      && existingEmailAccount.id !== preferredUidAccount.id
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: '该 Google 账号与已有平台员工 UID 冲突'
      })
    }

    if (!existingAccount && !options.allowProvision) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: '该 Google 账号未被授权为平台员工'
      })
    }

    let accountId = existingAccount?.id || 0
    if (existingAccount) {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_accounts
         SET email = ?,
             display_name = ?,
             oidc_sub = ?,
             email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()),
             status = 'active',
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [accountEmail, displayName, subject, existingAccount.id]
      )
    } else {
      const result = await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_accounts
          (uid, account_type, username, email, display_name, password_hash, oidc_sub, mfa_enabled, status, email_verified_at, created_at, updated_at)
         VALUES (?, 'staff', ?, ?, ?, NULL, ?, 0, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [accountUid, accountUid, accountEmail, displayName, subject]
      )
      accountId = Number(result.insertId) || 0
    }

    const account = accountId
      ? await tx.queryRow<AccountRow>(
          `SELECT id, uid, username, email, display_name, account_type
           FROM platform_accounts
           WHERE id = ?
             AND account_type = 'staff'
           LIMIT 1`,
          [accountId]
        )
      : await tx.queryRow<AccountRow>(
          `SELECT id, uid, username, email, display_name, account_type
           FROM platform_accounts
           WHERE uid = ?
             AND account_type = 'staff'
           LIMIT 1`,
          [accountUid]
        )

    if (!account) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'failed to resolve Google platform admin account'
      })
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_account_identities
        (account_id, provider_type, provider_code, external_subject_key, external_tenant_key, profile_json, status, last_login_at, created_at, updated_at)
       VALUES (?, 'google_oidc', 'google', ?, ?, CAST(? AS JSON), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id),
         external_tenant_key = VALUES(external_tenant_key),
         profile_json = VALUES(profile_json),
         status = 'active',
         last_login_at = UTC_TIMESTAMP(),
         updated_at = UTC_TIMESTAMP()`,
      [
        account.id,
        subject,
        hostedDomain,
        JSON.stringify({
          sub: subject,
          email,
          emailVerified: options.emailVerified,
          displayName,
          picture: options.picture || null,
          hostedDomain,
          provider: 'google'
        })
      ]
    )

    return account
  })

  if (options.allowProvision) {
    await grantOpsSuperAdminRoleToAccount(account.id)
  }

  return account
}

export async function upsertWecomAdmin(options: {
  userid: string
  corpid: string
  displayName: string
  email?: string
  mobile?: string
  avatar?: string
  allowProvision?: boolean
}) {
  const userid = normalizeString(options.userid)
  const corpid = normalizeString(options.corpid)
  const email = normalizeEmail(options.email)
  const displayName = normalizeString(options.displayName) || userid
  const preferredUid = uidFromWecomUserid(userid)

  if (!userid || !corpid) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '企业微信账号信息不完整，不能用于平台员工登录'
    })
  }

  const account = await withTransaction<AccountRow>(async (tx) => {
    const existingIdentityAccount = await tx.queryRow<AccountRow>(
      `SELECT pa.id, pa.uid, pa.username, pa.email, pa.display_name, pa.account_type
       FROM platform_account_identities pai
       INNER JOIN platform_accounts pa
         ON pa.id = pai.account_id
       WHERE pai.provider_type = 'wecom'
         AND pai.provider_code = 'platform_admin'
         AND pai.external_subject_key = ?
       LIMIT 1`,
      [userid]
    )
    const existingEmailAccount = email
      ? await tx.queryRow<AccountRow>(
          `SELECT id, uid, username, email, display_name, account_type
           FROM platform_accounts
           WHERE email = ?
           LIMIT 1`,
          [email]
        )
      : null
    const preferredUidAccount = await tx.queryRow<AccountRow>(
      `SELECT id, uid, username, email, display_name, account_type
       FROM platform_accounts
       WHERE uid = ?
       LIMIT 1`,
      [preferredUid]
    )

    let accountUid = preferredUid
    let accountEmail = email || localPlatformEmail(accountUid)
    let existingAccount: AccountRow | null = null

    if (existingIdentityAccount) {
      if (existingIdentityAccount.account_type !== 'staff') {
        throw createError({
          statusCode: 409,
          statusMessage: 'Conflict',
          message: '该企业微信账号已绑定到企业管理员主体'
        })
      }

      existingAccount = existingIdentityAccount
      accountUid = existingIdentityAccount.uid
      accountEmail = email && (!existingEmailAccount || existingEmailAccount.id === existingIdentityAccount.id)
        ? email
        : existingIdentityAccount.email
    } else if (
      existingEmailAccount?.account_type === 'staff'
      && preferredUidAccount?.account_type === 'staff'
      && existingEmailAccount.id !== preferredUidAccount.id
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: '该企业微信账号与已有平台员工 UID 冲突'
      })
    } else if (existingEmailAccount?.account_type === 'staff') {
      existingAccount = existingEmailAccount
      accountUid = existingEmailAccount.uid
      accountEmail = existingEmailAccount.email
    } else if (preferredUidAccount?.account_type === 'staff') {
      existingAccount = preferredUidAccount
      accountUid = preferredUidAccount.uid
      accountEmail = email && !existingEmailAccount ? email : preferredUidAccount.email
    } else if (preferredUidAccount) {
      accountUid = fallbackUidFromWecomUserid(userid)
      accountEmail = email && !existingEmailAccount ? email : localPlatformEmail(accountUid)

      const fallbackUidAccount = await tx.queryRow<AccountRow>(
        `SELECT id, uid, username, email, display_name, account_type
         FROM platform_accounts
         WHERE uid = ?
         LIMIT 1`,
        [accountUid]
      )

      if (fallbackUidAccount) {
        if (fallbackUidAccount.account_type !== 'staff') {
          throw createError({
            statusCode: 409,
            statusMessage: 'Conflict',
            message: '该企业微信账号与已有企业管理员 UID 冲突'
          })
        }

        existingAccount = fallbackUidAccount
        accountUid = fallbackUidAccount.uid
        accountEmail = fallbackUidAccount.email
      }
    } else if (existingEmailAccount) {
      accountEmail = localPlatformEmail(accountUid)
    }

    if (!existingAccount && !options.allowProvision) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: '该企业微信账号未被授权为平台员工'
      })
    }

    let accountId = existingAccount?.id || 0
    if (existingAccount) {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_accounts
         SET email = ?,
             display_name = ?,
             oidc_sub = ?,
             email_verified_at = CASE WHEN ? <> '' THEN COALESCE(email_verified_at, UTC_TIMESTAMP()) ELSE email_verified_at END,
             status = 'active',
             updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [accountEmail, displayName, userid, email, existingAccount.id]
      )
    } else {
      const result = await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_accounts
          (uid, account_type, username, email, display_name, password_hash, oidc_sub, mfa_enabled, status, email_verified_at, created_at, updated_at)
         VALUES (?, 'staff', ?, ?, ?, NULL, ?, 0, 'active', CASE WHEN ? <> '' THEN UTC_TIMESTAMP() ELSE NULL END, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [accountUid, accountUid, accountEmail, displayName, userid, email]
      )
      accountId = Number(result.insertId) || 0
    }

    const account = accountId
      ? await tx.queryRow<AccountRow>(
          `SELECT id, uid, username, email, display_name, account_type
           FROM platform_accounts
           WHERE id = ?
             AND account_type = 'staff'
           LIMIT 1`,
          [accountId]
        )
      : await tx.queryRow<AccountRow>(
          `SELECT id, uid, username, email, display_name, account_type
           FROM platform_accounts
           WHERE uid = ?
             AND account_type = 'staff'
           LIMIT 1`,
          [accountUid]
        )

    if (!account) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'failed to resolve WeCom platform admin account'
      })
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_account_identities
        (account_id, provider_type, provider_code, external_subject_key, external_tenant_key, profile_json, status, last_login_at, created_at, updated_at)
       VALUES (?, 'wecom', 'platform_admin', ?, ?, CAST(? AS JSON), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id),
         external_tenant_key = VALUES(external_tenant_key),
         profile_json = VALUES(profile_json),
         status = 'active',
         last_login_at = UTC_TIMESTAMP(),
         updated_at = UTC_TIMESTAMP()`,
      [
        account.id,
        userid,
        corpid,
        JSON.stringify({
          userid,
          corpid,
          displayName,
          email: email || null,
          mobile: options.mobile || null,
          avatar: options.avatar || null,
          provider: 'wecom'
        })
      ]
    )

    return account
  })

  if (options.allowProvision) {
    await grantOpsSuperAdminRoleToAccount(account.id)
  }

  return account
}
