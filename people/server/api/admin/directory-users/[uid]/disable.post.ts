import { createError, getRouterParam, readBody } from 'h3'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { disableConsoleDirectoryUser } from '~~/server/utils/consoleDirectoryProjection'

interface DisableDirectoryUserBody {
  activeRoleCode?: string | null
  active_role_code?: string | null
  operatorUid?: string | null
  leaveDate?: string | null
  reason?: string | null
}

function text(value: unknown) {
  return String(value || '').trim()
}

async function assertOffboardingPermission(event: Parameters<typeof assertPeoplePermission>[0], activeRoleCode: string) {
  try {
    return await assertPeoplePermission(event, activeRoleCode, 'employees', 'edit')
  } catch (error) {
    if (Number((error as { statusCode?: unknown }).statusCode || 500) !== 403) throw error
    return await assertPeoplePermission(event, activeRoleCode, 'assignments', 'edit')
  }
}

export default defineEventHandler(async (event) => {
  const uid = text(getRouterParam(event, 'uid'))
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required.' })

  const body = await readBody<DisableDirectoryUserBody>(event).catch(() => ({} as DisableDirectoryUserBody))
  const activeRoleCode = text(body.activeRoleCode || body.active_role_code)
  const snapshot = await assertOffboardingPermission(event, activeRoleCode)

  const result = await disableConsoleDirectoryUser(event, {
    employeeUid: uid,
    operatorUid: text(body.operatorUid) || snapshot.uid || '',
    leaveDate: text(body.leaveDate),
    reason: text(body.reason) || 'people_offboarding'
  })

  return {
    code: 0,
    message: 'ok',
    data: result
  }
})
