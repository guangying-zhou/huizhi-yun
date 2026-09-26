import { createError, type H3Event } from 'h3'
import { fetchDirectoryActiveStatuses } from '@hzy/foundation/server/utils/directoryApi'
import { enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { lookupActiveEnterprisePersonnelUID } from './enterpriseAimsPersonnelContract'

export async function enterpriseAimsPersonnel(event: H3Event, user: { uid: string, tenant: string, deployment: string }, input: Record<string, unknown>, field: string, resource: string, objectId: string, action: string) {
  const value = input[field]
  if (value == null || value === '') return []
  if (typeof value !== 'string' || !value.trim()) throw createError({ statusCode: 400, message: '人员参数无效' })
  const uid = value.trim()
  try {
    await lookupActiveEnterprisePersonnelUID(uid, uids => fetchDirectoryActiveStatuses(event, uids))
  } catch (error) {
    const failure = error as { statusCode: number, message: string }
    throw createError({ statusCode: failure.statusCode, message: failure.message })
  }
  return [{ actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource, objectId, action, field, uid, status: 'active', expiresAt: enterpriseRuntimePermitExpiresAt() }]
}
