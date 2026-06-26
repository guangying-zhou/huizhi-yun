export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'token')
  if (!token) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const config = useRuntimeConfig()
  const { apiBaseUrl, apiKey, apiSecret } = config.hzy

  if (!apiBaseUrl || !apiKey || !apiSecret) {
    throw createError({ statusCode: 500, message: 'Account API not configured' })
  }

  // Fetch users from Account module
  const res = await $fetch<{
    code: number
    data: {
      items: Array<{
        uid: string
        realName: string
        email: string | null
        deptCode: string | null
        deptName: string | null
      }>
    }
  }>(`${apiBaseUrl}/api/v1/users`, {
    headers: { Authorization: `Bearer ${apiKey}:${apiSecret}` }
  })

  if (res.code !== 0 || !res.data?.items) {
    throw createError({ statusCode: 502, message: 'Failed to fetch users from Account' })
  }

  const users = res.data.items
  let created = 0
  let updated = 0
  let skipped = 0

  for (const user of users) {
    if (!user.uid) {
      skipped++
      continue
    }

    // Look up department_id by account_dept_code
    let departmentId: number | null = null
    if (user.deptCode) {
      const dept = await queryRow<{ id: number }>(
        'SELECT id FROM org_departments WHERE account_dept_code = ? OR code = ?',
        [user.deptCode, user.deptCode]
      )
      departmentId = dept?.id ?? null
    }

    // Check if person already exists by account_uid or email
    const existing = await queryRow<{ id: number, account_uid: string | null }>(
      'SELECT id, account_uid FROM org_persons WHERE account_uid = ? OR email = ?',
      [user.uid, user.email]
    )

    if (existing) {
      // Update existing person with Account info
      await execute(
        `UPDATE org_persons SET
          real_name = ?,
          email = ?,
          account_uid = ?,
          department_id = COALESCE(?, department_id),
          is_active = 1
        WHERE id = ?`,
        [user.realName, user.email, user.uid, departmentId, existing.id]
      )
      updated++
    } else {
      // Create new person — use uid as username (can be updated later when SCM mapping is done)
      await execute(
        `INSERT INTO org_persons (username, real_name, email, account_uid, department_id, is_active, is_coder)
         VALUES (?, ?, ?, ?, ?, 1, 0)`,
        [user.uid, user.realName, user.email, user.uid, departmentId]
      )
      created++
    }
  }

  return {
    success: true,
    created,
    updated,
    skipped,
    total: users.length,
    message: `同步完成：新建 ${created} 人，更新 ${updated} 人，跳过 ${skipped} 人`
  }
})
