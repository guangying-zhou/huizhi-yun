import { createError, type H3Event } from 'h3'
import {
  getConsoleDirectoryUser,
  resolveOrBindConsoleAuthIdentity
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import type { AccountUserItem } from '~~/server/utils/directoryRuntime'

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

export async function resolveOrBindDirectoryIdentity(
  event: H3Event,
  input: ResolveIdentityInput
) {
  const providerCode = normalizeProviderCode(input.providerCode)
  const providerSubject = normalizeSubject(input.providerSubject)
  const resolved = await resolveOrBindConsoleAuthIdentity(event, {
    ...input,
    providerCode,
    providerSubject
  }, `console:auth-identity:${crypto.randomUUID()}`)
  const userEnvelope = await getConsoleDirectoryUser(event, resolved.data.uid)
  const user = userEnvelope.data as AccountUserItem | null
  if (!user) {
    throw createError({
      statusCode: 403,
      message: `No active directory user found for uid=${resolved.data.uid}`
    })
  }
  return {
    ...resolved.data,
    user
  }
}
