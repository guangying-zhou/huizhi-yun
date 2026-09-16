import { getAllUsers } from '~~/server/utils/dingtalk'

export default defineEventHandler(async (_event) => {
  try {
    const users = await getAllUsers()
    return { success: true, count: users.length, data: users.slice(0, 2) }
  } catch (err: unknown) {
    const error = err as { message?: string }
    return { success: false, error: error.message }
  }
})
