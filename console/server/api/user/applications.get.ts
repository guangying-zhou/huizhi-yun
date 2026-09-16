import { getConsoleUserApplications } from '~~/server/utils/userApplications'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  const uid = await requireConsoleRequestUid(event)

  return {
    code: 0,
    data: await getConsoleUserApplications(event, String(uid))
  }
})
