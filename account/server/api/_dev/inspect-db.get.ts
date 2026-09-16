import { execute, queryRows } from '~~/server/utils/db'

function getErrorInfo(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    }
  }

  return {
    message: String(error),
    stack: undefined
  }
}

export default defineEventHandler(async (_event) => {
  try {
    const columns = await execute('DESCRIBE system_users')
    const indices = await execute('SHOW INDEX FROM system_users')

    // Check for user existence safely
    let userCheck: unknown[] = []
    try {
      userCheck = await queryRows('SELECT * FROM system_users WHERE uid = "zhouguangying"')
    } catch (error) {
      userCheck = [`Error checking uid: ${getErrorInfo(error).message}`]
    }

    let uidCheck: unknown[] = []
    try {
      uidCheck = await queryRows('SELECT * FROM system_users WHERE ldap_uid = "zhouguangying" LIMIT 1')
    } catch (error) {
      uidCheck = [`Error checking ldap_uid: ${getErrorInfo(error).message}`]
    }

    return {
      columns,
      indices,
      userCheck,
      uidCheck
    }
  } catch (error) {
    const errorInfo = getErrorInfo(error)
    return { error: errorInfo.message, stack: errorInfo.stack }
  }
})
