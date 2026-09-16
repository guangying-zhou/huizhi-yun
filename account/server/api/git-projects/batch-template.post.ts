import { useDbPool } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'

interface BatchTemplateBody {
  projectCodes: string[]
  isTemplate: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<BatchTemplateBody>(event)
  const pool = useDbPool()

  if (!body.projectCodes || !Array.isArray(body.projectCodes) || body.projectCodes.length === 0) {
    throw createError({
      statusCode: 400,
      message: '请提供要设置的项目列表'
    })
  }

  const isTemplate = body.isTemplate ? 1 : 0

  try {
    const placeholders = body.projectCodes.map(() => '?').join(', ')
    await pool.query(
      `UPDATE git_projects SET is_template = ? WHERE project_code IN (${placeholders}) AND is_group = 0`,
      [isTemplate, ...body.projectCodes]
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'project.batch-template',
      targetType: 'project',
      targetId: body.projectCodes.join(','),
      detail: {
        projectCodes: body.projectCodes,
        isTemplate
      }
    })

    return {
      success: true,
      message: `已${isTemplate ? '设为' : '取消'}模板：${body.projectCodes.length} 个项目`
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('Failed to batch update template:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '批量设置模板失败'
    })
  }
})
