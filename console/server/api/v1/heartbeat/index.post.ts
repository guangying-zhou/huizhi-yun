import { writeHeartbeat } from '~~/server/utils/runtimeCompat'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requireConsoleRequestUid(event)
  await writeHeartbeat(event, await readBody(event))
  return { success: true }
})
