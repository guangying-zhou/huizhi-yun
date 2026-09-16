import { getAllDepartments } from '~~/server/utils/dingtalk'

export default defineEventHandler(async (_event) => {
  try {
    const depts = await getAllDepartments()
    return { success: true, count: depts.length, data: depts }
  } catch (err: unknown) {
    const error = err as { message?: string }
    return { success: false, error: error.message }
  }
})
