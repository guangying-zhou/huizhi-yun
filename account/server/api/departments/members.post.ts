import { useDbPool } from '../../utils/db'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket } from 'mysql2/promise'

interface SetMembersBody {
  deptCode: string
  memberUids: string[]
}

interface DeptRow extends RowDataPacket {
  id: number
  org_type: string | null
  dept_code: string
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const body = await readBody<SetMembersBody>(event)

  if (!body.deptCode) {
    throw createError({ statusCode: 400, message: '缺少 deptCode' })
  }
  if (!Array.isArray(body.memberUids)) {
    throw createError({ statusCode: 400, message: 'memberUids 必须是数组' })
  }

  try {
    const [existing] = await pool.query<DeptRow[]>(
      'SELECT id, org_type FROM departments WHERE dept_code = ?',
      [body.deptCode]
    )

    if (existing.length === 0) {
      throw createError({ statusCode: 404, message: '部门/委员会不存在' })
    }

    const isCommittee = existing[0]!.org_type === 'committee'

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      // 部门（非委员会）：一个用户只能属于一个部门，先移除这些用户在其他部门的记录
      if (!isCommittee && body.memberUids.length > 0) {
        // 获取所有非委员会部门 dept_code
        const [deptRows] = await conn.query<DeptRow[]>(
          'SELECT dept_code FROM departments WHERE org_type = \'department\''
        )
        const deptCodes = deptRows.map(r => r.dept_code)
        if (deptCodes.length > 0) {
          await conn.query(
            'DELETE FROM user_departments WHERE uid IN (?) AND dept_code IN (?)',
            [body.memberUids, deptCodes]
          )
        }
      } else {
        // 委员会：只清除当前委员会的成员
        await conn.query(
          'DELETE FROM user_departments WHERE dept_code = ?',
          [body.deptCode]
        )
      }

      if (body.memberUids.length > 0) {
        const values = body.memberUids.map(uid => [uid, body.deptCode])
        await conn.query(
          'INSERT IGNORE INTO user_departments (uid, dept_code) VALUES ?',
          [values]
        )
      }

      await conn.commit()
      await logOperationFromEvent(event, {
        sourceApp: 'account',
        action: 'department.members.update',
        targetType: 'department',
        targetId: body.deptCode,
        detail: {
          deptCode: body.deptCode,
          memberCount: body.memberUids.length,
          memberUids: body.memberUids
        }
      })
      return { code: 0, message: `已更新成员，共 ${body.memberUids.length} 人` }
    } catch (err: unknown) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to set members:', error)
    throw createError({ statusCode: 500, message: error.message || '设置成员失败' })
  }
})
