import { queryRows } from '~~/server/utils/db'

export default defineEventHandler(async (_event) => {
  try {
    const roles = await queryRows('SELECT * FROM user_roles WHERE uid = \'manager1561\'')
    const zhouRoles = await queryRows('SELECT * FROM user_roles WHERE uid = \'zhouguangying\'')
    return { success: true, managerRoles: roles, zhouRoles }
  } catch (err: unknown) {
    const error = err as { message?: string }
    return { success: false, error: error.message }
  }
})
