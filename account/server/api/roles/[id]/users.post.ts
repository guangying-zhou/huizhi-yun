import { useDatabase } from '../../../utils/database'
import { logOperationFromEvent } from '../../../utils/log'
import type { RowDataPacket } from 'mysql2/promise'

interface AddUserBody {
  uid?: string
  uids?: string[]
}

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')
  const body = await readBody<AddUserBody>(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '角色ID不能为空'
    })
  }

  const requestedUids = Array.from(new Set(
    (body.uids && body.uids.length > 0 ? body.uids : body.uid ? [body.uid] : [])
      .map(uid => uid.trim())
      .filter(Boolean)
  ))

  if (requestedUids.length === 0) {
    throw createError({
      statusCode: 400,
      message: '用户名不能为空'
    })
  }

  try {
    // 检查角色是否存在
    const [roleRows] = await pool.query(
      'SELECT id, role_code FROM roles WHERE id = ?',
      [id]
    ) as [RowDataPacket[], unknown]

    if (roleRows.length === 0) {
      throw createError({
        statusCode: 404,
        message: '角色不存在'
      })
    }

    const role = roleRows[0] as { role_code: string }

    const placeholders = requestedUids.map(() => '?').join(',')
    const [existingRows] = await pool.query(
      `SELECT uid FROM user_roles WHERE role_id = ? AND uid IN (${placeholders})`,
      [id, ...requestedUids]
    ) as [RowDataPacket[], unknown]

    const existingUidSet = new Set(
      (existingRows as Array<{ uid: string }>).map(row => row.uid)
    )
    const uidsToInsert = requestedUids.filter(uid => !existingUidSet.has(uid))

    if (uidsToInsert.length === 0) {
      throw createError({
        statusCode: 400,
        message: '所选用户已全部在该角色中'
      })
    }

    const insertPlaceholders = uidsToInsert.map(() => '(?, ?)').join(', ')
    const insertValues = uidsToInsert.flatMap(uid => [id, uid])
    await pool.query(
      `INSERT INTO user_roles (role_id, uid) VALUES ${insertPlaceholders}`,
      insertValues
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'role.user.add',
      targetType: 'role',
      targetId: role.role_code,
      detail: {
        roleId: Number(id),
        uids: uidsToInsert,
        requestedUids
      }
    })

    return {
      code: 0,
      message: '添加成功',
      data: {
        addedCount: uidsToInsert.length,
        skippedCount: requestedUids.length - uidsToInsert.length
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('添加用户到角色失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '添加用户到角色失败'
    })
  }
})
