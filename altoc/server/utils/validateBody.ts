/**
 * Zod body 验证 helper
 *
 * 统一用 zod schema 校验请求体，失败时抛 400 错误并返回可读的字段错误列表。
 *
 * 使用示例：
 * ```ts
 * import { customerCreateSchema } from '~~/shared/schemas/entities'
 *
 * export default defineEventHandler(async (event) => {
 *   await requirePermission(event, 'customer', 'edit')
 *   const data = await validateBody(event, customerCreateSchema)
 *   // data 是类型推导后的干净数据，可放心使用
 * })
 * ```
 *
 * 错误响应结构：
 * ```json
 * {
 *   "statusCode": 400,
 *   "statusMessage": "参数校验失败",
 *   "data": {
 *     "issues": [
 *       { "path": "name", "message": "客户名称不能为空" },
 *       { "path": "amount_tax_inclusive", "message": "金额不能为负" }
 *     ]
 *   }
 * }
 * ```
 */
import type { H3Event } from 'h3'
import type { ZodIssue, ZodType } from 'zod'

export async function validateBody<T>(
  event: H3Event,
  schema: ZodType<T>
): Promise<T> {
  const body = await readBody(event).catch(() => ({}))
  const result = schema.safeParse(body)

  if (!result.success) {
    const issues = result.error.issues.map((issue: ZodIssue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
    const firstMsg = issues[0]?.message || '参数校验失败'
    throw createError({
      statusCode: 400,
      statusMessage: firstMsg,
      data: { issues }
    })
  }

  return result.data
}
