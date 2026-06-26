import { writeHeartbeat } from '~~/server/utils/runtimeCompat'

export default defineEventHandler(async (event) => {
  await writeHeartbeat(await readBody(event))
  return { success: true }
})
