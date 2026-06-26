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

  // Fetch departments from Account module
  const res = await $fetch<{ code: number, data: { tree: AccountDept[] } }>(`${apiBaseUrl}/api/v1/departments`, {
    headers: { Authorization: `Bearer ${apiKey}:${apiSecret}` }
  })

  if (res.code !== 0 || !res.data?.tree) {
    throw createError({ statusCode: 502, message: 'Failed to fetch departments from Account' })
  }

  // Flatten tree
  interface AccountDept {
    deptCode: string
    name: string
    parentId: string | null
    managerId?: string
    children?: AccountDept[]
  }

  interface FlatDept {
    deptCode: string
    name: string
    parentDeptCode: string | null
    managerId: string | null
  }

  function flatten(nodes: AccountDept[], parentCode: string | null = null): FlatDept[] {
    const result: FlatDept[] = []
    for (const n of nodes) {
      result.push({
        deptCode: n.deptCode,
        name: n.name,
        parentDeptCode: parentCode,
        managerId: n.managerId || null
      })
      if (n.children?.length) {
        result.push(...flatten(n.children, n.deptCode))
      }
    }
    return result
  }

  const depts = flatten(res.data.tree)

  // Upsert into org_departments
  const pool = useDbPool()
  let created = 0
  let updated = 0

  // First pass: create/update departments (without parent_id FK)
  for (const dept of depts) {
    const [existing] = await queryRows<{ id: number, name: string }>(
      'SELECT id, name FROM org_departments WHERE account_dept_code = ? OR code = ?',
      [dept.deptCode, dept.deptCode]
    )

    if (existing) {
      await execute(
        'UPDATE org_departments SET name = ?, code = ?, account_dept_code = ? WHERE id = ?',
        [dept.name, dept.deptCode, dept.deptCode, existing.id]
      )
      updated++
    } else {
      await execute(
        'INSERT INTO org_departments (name, code, account_dept_code, is_active) VALUES (?, ?, ?, 1)',
        [dept.name, dept.deptCode, dept.deptCode]
      )
      created++
    }
  }

  // Second pass: set parent_id relationships
  for (const dept of depts) {
    if (dept.parentDeptCode) {
      await execute(
        `UPDATE org_departments SET parent_id = (
          SELECT id FROM (SELECT id FROM org_departments WHERE code = ?) AS p
        ) WHERE code = ?`,
        [dept.parentDeptCode, dept.deptCode]
      )
    }
  }

  return {
    success: true,
    created,
    updated,
    total: depts.length,
    message: `同步完成：新建 ${created} 个，更新 ${updated} 个`
  }
})
