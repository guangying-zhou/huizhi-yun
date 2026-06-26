import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'
import { getRequestURL } from 'h3'
import { execute, queryRow, withTransaction } from '~~/server/utils/db'

const scryptAsync = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>

const PASSWORD_HASH_VERSION = 'scrypt-v1'
const SCRYPT_OPTIONS: ScryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
}
const PASSWORD_KEY_LENGTH = 64
const ACTIVATION_TOKEN_BYTES = 32
const DEFAULT_ACTIVATION_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_EMAIL_FROM = 'no-repiy@huizhi.yun'

interface AccountRow extends RowDataPacket {
  id: number
  uid: string
  username: string
  email: string
  display_name: string
  account_type: string
  password_hash: string | null
  status: string
}

interface ActivationTokenRow extends RowDataPacket {
  id: number
  token_hash: string
  account_id: number
  email: string
  expires_at: string
  account_status: string
}

type EmailAuthAccount = Pick<AccountRow, 'id' | 'uid' | 'username' | 'email' | 'display_name' | 'account_type' | 'status'>

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

export function normalizeEmail(value: unknown) {
  return normalizeString(value).toLowerCase()
}

export function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255
}

export function validatePassword(password: string) {
  return password.length >= 8 && password.length <= 128
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function generateUid() {
  return `u_${randomBytes(12).toString('base64url')}`
}

function usernameFromEmail(email: string) {
  return `email_${sha256(email).slice(0, 24)}`
}

function buildDisplayName(email: string, displayName?: string) {
  const normalized = normalizeString(displayName)
  if (normalized) {
    return normalized.slice(0, 255)
  }

  return (email.split('@')[0] || email).slice(0, 255)
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const key = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH, SCRYPT_OPTIONS)

  return [
    PASSWORD_HASH_VERSION,
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt,
    key.toString('base64url')
  ].join('$')
}

export async function verifyPassword(password: string, passwordHash: string | null) {
  if (!passwordHash) {
    return false
  }

  const parts = passwordHash.split('$')
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_VERSION) {
    return false
  }

  const [, nRaw, rRaw, pRaw, salt, expectedRaw] = parts
  if (!nRaw || !rRaw || !pRaw || !salt || !expectedRaw) {
    return false
  }

  const expected = Buffer.from(expectedRaw, 'base64url')
  if (!expected.length) {
    return false
  }

  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: 64 * 1024 * 1024
  })

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function generateActivationToken() {
  return randomBytes(ACTIVATION_TOKEN_BYTES).toString('base64url')
}

export function hashActivationToken(token: string) {
  return sha256(token)
}

function activationTtlSeconds() {
  const runtimeConfig = useRuntimeConfig()
  return Number(runtimeConfig.auth?.emailActivationTtlSeconds || DEFAULT_ACTIVATION_TTL_SECONDS) || DEFAULT_ACTIVATION_TTL_SECONDS
}

function buildActivationUrl(event: H3Event, token: string, redirect?: string) {
  const runtimeConfig = useRuntimeConfig()
  const configuredBaseUrl = normalizeString(runtimeConfig.auth?.activationBaseUrl || runtimeConfig.public?.serviceUrl)
  const origin = configuredBaseUrl || getRequestURL(event).origin
  const activationUrl = new URL('/activate-email', origin)
  activationUrl.searchParams.set('token', token)

  const normalizedRedirect = normalizeRedirect(redirect)
  if (normalizedRedirect) {
    activationUrl.searchParams.set('redirect', normalizedRedirect)
  }

  return activationUrl.toString()
}

export function normalizeRedirect(value: unknown, fallback = '/dashboard') {
  const redirect = normalizeString(value)
  if (!redirect || !redirect.startsWith('/dashboard') || redirect.startsWith('//')) {
    return fallback
  }

  return redirect
}

function toPublicAccount(account: EmailAuthAccount) {
  return {
    uid: account.uid,
    username: account.username,
    email: account.email,
    displayName: account.display_name,
    accountType: account.account_type
  }
}

export async function sendActivationEmail(event: H3Event, options: {
  email: string
  displayName: string
  token: string
  redirect?: string
}) {
  const runtimeConfig = useRuntimeConfig()
  const apiKey = normalizeString(runtimeConfig.auth?.resendApiKey)
  const from = normalizeString(runtimeConfig.auth?.emailFrom) || DEFAULT_EMAIL_FROM
  const appName = normalizeString(runtimeConfig.public?.appDisplayName) || '汇智云平台'

  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Resend API key is not configured'
    })
  }

  const activationUrl = buildActivationUrl(event, options.token, options.redirect)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: options.email,
      subject: `激活你的${appName}账号`,
      html: [
        `<p>${options.displayName}，你好。</p>`,
        `<p>请点击下面的链接激活你的${appName}账号：</p>`,
        `<p><a href="${activationUrl}">${activationUrl}</a></p>`,
        '<p>该链接会在 24 小时后失效。如果不是你本人操作，可以忽略这封邮件。</p>'
      ].join('\n'),
      text: [
        `${options.displayName}，你好。`,
        `请打开下面的链接激活你的${appName}账号：`,
        activationUrl,
        '该链接会在 24 小时后失效。如果不是你本人操作，可以忽略这封邮件。'
      ].join('\n')
    })
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `Resend email send failed: ${response.status}${responseText ? ` ${responseText.slice(0, 160)}` : ''}`
    })
  }
}

export async function registerEmailAccount(options: {
  email: string
  password: string
  displayName?: string
}) {
  const email = normalizeEmail(options.email)
  const password = String(options.password || '')

  if (!validateEmail(email)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '请输入有效邮箱地址'
    })
  }

  if (!validatePassword(password)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '密码长度必须为 8-128 位'
    })
  }

  const displayName = buildDisplayName(email, options.displayName)
  const passwordHash = await hashPassword(password)
  const token = generateActivationToken()
  const tokenHash = hashActivationToken(token)
  const ttlSeconds = activationTtlSeconds()

  const account = await withTransaction<EmailAuthAccount>(async (tx) => {
    const existing = await tx.queryRow<AccountRow>(
      `SELECT id, uid, username, email, display_name, account_type, password_hash, status
       FROM platform_accounts
       WHERE email = ?
       LIMIT 1`,
      [email]
    )

    if (existing && existing.account_type !== 'tenant_admin') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: '该邮箱已被平台员工账号使用'
      })
    }

    if (existing && existing.status !== 'pending_activation') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: '该邮箱已注册，请直接登录'
      })
    }

    if (existing) {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_accounts
         SET display_name = ?, password_hash = ?, updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [displayName, passwordHash, existing.id]
      )
    } else {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_accounts
          (uid, account_type, username, email, display_name, password_hash, oidc_sub, mfa_enabled, status, email_verified_at, created_at, updated_at)
         VALUES (?, 'tenant_admin', ?, ?, ?, ?, NULL, 0, 'pending_activation', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [generateUid(), usernameFromEmail(email), email, displayName, passwordHash]
      )
    }

    const account = await tx.queryRow<AccountRow>(
      `SELECT id, uid, username, email, display_name, account_type, password_hash, status
       FROM platform_accounts
       WHERE email = ?
       LIMIT 1`,
      [email]
    )

    if (!account) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'failed to create platform account'
      })
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_account_identities
        (account_id, provider_type, provider_code, external_subject_key, external_tenant_key, profile_json, status, last_login_at, created_at, updated_at)
       VALUES (?, 'local_email', 'default', ?, NULL, CAST(? AS JSON), 'pending_activation', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id),
         profile_json = VALUES(profile_json),
         status = 'pending_activation',
         updated_at = UTC_TIMESTAMP()`,
      [
        account.id,
        email,
        JSON.stringify({
          email,
          displayName,
          provider: 'local-email'
        })
      ]
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_email_activation_tokens
       SET status = 'revoked', updated_at = UTC_TIMESTAMP()
       WHERE account_id = ?
         AND status = 'pending'`,
      [account.id]
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_email_activation_tokens
        (account_id, email, token_hash, expires_at, consumed_at, status, created_at, updated_at)
       VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), NULL, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [account.id, email, tokenHash, ttlSeconds]
    )

    return account
  })

  return {
    account: toPublicAccount(account),
    token
  }
}

export async function resendActivationToken(email: string) {
  const normalizedEmail = normalizeEmail(email)
  const token = generateActivationToken()
  const tokenHash = hashActivationToken(token)
  const ttlSeconds = activationTtlSeconds()

  const account = await withTransaction<EmailAuthAccount>(async (tx) => {
    const account = await tx.queryRow<AccountRow>(
      `SELECT id, uid, username, email, display_name, account_type, password_hash, status
       FROM platform_accounts
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    )

    if (!account || account.status !== 'pending_activation') {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '未找到待激活账号'
      })
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_email_activation_tokens
       SET status = 'revoked', updated_at = UTC_TIMESTAMP()
       WHERE account_id = ?
         AND status = 'pending'`,
      [account.id]
    )

    await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_email_activation_tokens
        (account_id, email, token_hash, expires_at, consumed_at, status, created_at, updated_at)
       VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), NULL, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [account.id, normalizedEmail, tokenHash, ttlSeconds]
    )

    return account
  })

  return {
    account: toPublicAccount(account),
    token
  }
}

export async function findAccountForPasswordLogin(email: string) {
  return await queryRow<AccountRow>(
    `SELECT id, uid, username, email, display_name, account_type, password_hash, status
     FROM platform_accounts
     WHERE email = ?
     LIMIT 1`,
    [normalizeEmail(email)]
  )
}

export async function activateEmailAccount(token: string) {
  const normalizedToken = normalizeString(token)

  if (!normalizedToken) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '激活链接无效'
    })
  }

  const tokenHash = hashActivationToken(normalizedToken)

  const account = await withTransaction<EmailAuthAccount>(async (tx) => {
    const tokenRow = await tx.queryRow<ActivationTokenRow>(
      `SELECT peat.id, peat.token_hash, peat.account_id, peat.email, peat.expires_at,
              pa.status AS account_status
       FROM platform_email_activation_tokens peat
       INNER JOIN platform_accounts pa
         ON pa.id = peat.account_id
       WHERE peat.token_hash = ?
         AND peat.status = 'pending'
         AND peat.expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [tokenHash]
    )

    if (!tokenRow) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '激活链接无效或已过期'
      })
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_email_activation_tokens
       SET status = 'consumed', consumed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [tokenRow.id]
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_accounts
       SET status = 'active', email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [tokenRow.account_id]
    )

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_account_identities
       SET status = 'active', updated_at = UTC_TIMESTAMP()
       WHERE provider_type = 'local_email'
         AND provider_code = 'default'
         AND external_subject_key = ?`,
      [tokenRow.email]
    )

    const account = await tx.queryRow<AccountRow>(
      `SELECT id, uid, username, email, display_name, account_type, password_hash, status
       FROM platform_accounts
       WHERE id = ?
       LIMIT 1`,
      [tokenRow.account_id]
    )

    if (!account) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'failed to activate platform account'
      })
    }

    return account
  })

  return toPublicAccount(account)
}

export async function markLocalEmailIdentityLogin(accountId: number) {
  await execute<ResultSetHeader>(
    `UPDATE platform_account_identities
     SET last_login_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
     WHERE account_id = ?
       AND provider_type = 'local_email'
       AND provider_code = 'default'`,
    [accountId]
  )
}
