import { createError } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { getDirectoryUser, listDirectoryUsers, type AccountUserItem } from '~~/server/utils/directoryRuntime'

interface IdentityRow extends RowDataPacket {
  identityId: number
  uid: string
  providerCode: string
  providerSubject: string
  providerUsername: string | null
}

interface ResolveIdentityInput {
  providerCode: string
  providerSubject: string
  providerUsername?: string | null
  email?: string | null
  mobileTail4?: string | null
  uidCandidates?: Array<string | null | undefined>
  profile?: Record<string, unknown> | null
}

function normalizeString(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeProviderCode(value: unknown) {
  const normalized = normalizeString(value)?.toLowerCase()
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'auth provider code is required' })
  }
  return normalized
}

function normalizeSubject(value: unknown) {
  const normalized = normalizeString(value)
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'provider subject is required' })
  }
  return normalized
}

async function findActiveIdentity(providerCode: string, providerSubject: string) {
  return queryRow<IdentityRow>(
    `SELECT di.id AS identityId,
            di.uid,
            di.provider_code AS providerCode,
            di.provider_subject AS providerSubject,
            di.provider_username AS providerUsername
       FROM directory_identities di
       INNER JOIN directory_users u
          ON u.uid = di.uid
         AND u.status = 'active'
      WHERE di.provider_code = ?
        AND di.provider_subject = ?
        AND di.status = 'active'
      LIMIT 1`,
    [providerCode, providerSubject]
  )
}

async function findIdentityByUidProvider(uid: string, providerCode: string) {
  return queryRow<IdentityRow>(
    `SELECT id AS identityId,
            uid,
            provider_code AS providerCode,
            provider_subject AS providerSubject,
            provider_username AS providerUsername
       FROM directory_identities
      WHERE uid = ?
        AND provider_code = ?
        AND status = 'active'
      LIMIT 1`,
    [uid, providerCode]
  )
}

async function touchIdentity(identityId: number) {
  await execute(
    `UPDATE directory_identities
        SET last_login_at = UTC_TIMESTAMP(),
            updated_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [identityId]
  )
}

async function findUserByEmail(email: string | null) {
  if (!email) return null
  const response = await listDirectoryUsers({ search: email })
  return response.items.find(user => user.email?.toLowerCase() === email.toLowerCase()) || null
}

async function findUserByCandidates(candidates: Array<string | null | undefined>) {
  const uniqueCandidates = [...new Set(candidates.map(value => normalizeString(value)).filter(Boolean) as string[])]
  for (const candidate of uniqueCandidates) {
    const user = await getDirectoryUser(candidate)
    if (user) return user
  }
  return null
}

async function resolveMatchedUser(input: ResolveIdentityInput) {
  const email = normalizeString(input.email)
  const byEmail = await findUserByEmail(email)
  if (byEmail) return byEmail

  const byCandidates = await findUserByCandidates([
    ...(input.uidCandidates || []),
    input.providerSubject,
    normalizeString(input.providerSubject)?.toLowerCase()
  ])
  if (byCandidates) return byCandidates

  throw createError({
    statusCode: 403,
    message: `No active directory user found for ${input.providerCode}:${input.providerSubject}`
  })
}

async function bindIdentity(input: Required<Pick<ResolveIdentityInput, 'providerCode' | 'providerSubject'>> & ResolveIdentityInput, user: AccountUserItem) {
  const existingForUid = await findIdentityByUidProvider(user.uid, input.providerCode)

  if (existingForUid && existingForUid.providerSubject !== input.providerSubject) {
    throw createError({
      statusCode: 409,
      message: `directory identity already exists for uid=${user.uid}, provider=${input.providerCode}`
    })
  }

  if (!existingForUid) {
    await execute(
      `INSERT INTO directory_identities (
         uid,
         provider_code,
         provider_subject,
         provider_username,
         email,
         mobile_tail4,
         profile_json,
         last_login_at,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), UTC_TIMESTAMP(), 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         uid = VALUES(uid),
         provider_username = VALUES(provider_username),
         email = VALUES(email),
         mobile_tail4 = VALUES(mobile_tail4),
         profile_json = VALUES(profile_json),
         last_login_at = UTC_TIMESTAMP(),
         status = 'active',
         updated_at = UTC_TIMESTAMP()`,
      [
        user.uid,
        input.providerCode,
        input.providerSubject,
        normalizeString(input.providerUsername),
        normalizeString(input.email) || user.email || null,
        normalizeString(input.mobileTail4) || user.mobileTail4 || null,
        JSON.stringify(input.profile || {})
      ]
    )
  } else {
    await touchIdentity(existingForUid.identityId)
  }

  const identity = await findActiveIdentity(input.providerCode, input.providerSubject)
  if (!identity) {
    throw createError({
      statusCode: 500,
      message: `failed to bind directory identity for ${input.providerCode}:${input.providerSubject}`
    })
  }
  return identity
}

export async function resolveOrBindDirectoryIdentity(input: ResolveIdentityInput) {
  const providerCode = normalizeProviderCode(input.providerCode)
  const providerSubject = normalizeSubject(input.providerSubject)

  const existing = await findActiveIdentity(providerCode, providerSubject)
  if (existing) {
    await touchIdentity(existing.identityId)
    const user = await getDirectoryUser(existing.uid)
    if (!user) {
      throw createError({
        statusCode: 403,
        message: `No active directory user found for uid=${existing.uid}`
      })
    }
    return {
      identityId: existing.identityId,
      uid: existing.uid,
      providerCode,
      providerSubject,
      user
    }
  }

  const user = await resolveMatchedUser({
    ...input,
    providerCode,
    providerSubject
  })
  const identity = await bindIdentity({
    ...input,
    providerCode,
    providerSubject
  }, user)

  return {
    identityId: identity.identityId,
    uid: identity.uid,
    providerCode,
    providerSubject,
    user
  }
}
