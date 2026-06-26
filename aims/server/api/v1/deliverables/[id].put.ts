/**
 * 更新交付物（提交/审核）
 * PUT /api/v1/deliverables/:id
 */
export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的交付物ID' })
  }

  const body = await readBody(event)

  const fieldMap: Record<string, string> = {
    status: 'status',
    name: 'name',
    description: 'description',
    acceptanceCriteria: 'acceptance_criteria',
    deliverableType: 'deliverable_type',
    required: 'required',
    sortOrder: 'sort_order',
    documentUuid: 'document_uuid',
    documentTitle: 'document_title',
    evidenceUrl: 'evidence_url',
    evidenceNote: 'evidence_note'
  }

  const fields: string[] = []
  const params: unknown[] = []

  for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
    if (body[bodyKey] !== undefined) {
      fields.push(`${dbCol} = ?`)
      params.push(body[bodyKey] ?? null)
    }
  }

  // 提交时自动填充提交人和时间
  if (body.status === 'submitted') {
    fields.push('submitted_by = ?')
    params.push(uid)
    fields.push('submitted_at = NOW()')
  }

  if (fields.length === 0) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  params.push(id)
  await execute(
    `UPDATE deliverables SET ${fields.join(', ')} WHERE id = ?`,
    params
  )

  return { code: 0, data: null }
})
