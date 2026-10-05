import { listAccessibleDepartments, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const uid = String(query.uid || '').trim()
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })
  return ok(await listAccessibleDepartments(uid))
})
