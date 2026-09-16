import { useDbPool } from '../../utils/db'
import { logOperationFromEvent } from '../../utils/log'

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const body = await readBody<{ projectCode: string, memberUids: string[] }>(event)

  if (!body.projectCode) {
    throw createError({ statusCode: 400, message: '缺少 projectCode' })
  }
  if (!Array.isArray(body.memberUids)) {
    throw createError({ statusCode: 400, message: 'memberUids 必须是数组' })
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query('DELETE FROM git_project_members WHERE project_code = ?', [body.projectCode])

    if (body.memberUids.length > 0) {
      const values = body.memberUids.map(uid => [body.projectCode, uid, 'member'])
      await conn.query('INSERT INTO git_project_members (project_code, uid, role) VALUES ?', [values])
    }

    await conn.commit()
    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'project.members.update',
      targetType: 'project',
      targetId: body.projectCode,
      detail: {
        projectCode: body.projectCode,
        memberCount: body.memberUids.length,
        memberUids: body.memberUids
      }
    })
    return { code: 0, message: `已更新成员，共 ${body.memberUids.length} 人` }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})
