const MAX_DEPARTMENT_DEPTH = 64

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export async function buildNotificationDetailDepartmentTree(
  deptCodeInput: string,
  load: (deptCode: string) => Promise<{ deptCode: string, parentDeptCode: string | null } | null>
) {
  const deptCode = stringValue(deptCodeInput)
  if (!deptCode) return undefined

  const result: string[] = []
  const seen = new Set<string>()
  let current = deptCode
  for (let depth = 0; depth < MAX_DEPARTMENT_DEPTH; depth += 1) {
    if (seen.has(current)) throw new Error('directory_department_cycle')
    seen.add(current)
    const row = await load(current)
    if (!row || stringValue(row.deptCode) !== current) {
      throw new Error('directory_department_not_found')
    }
    result.push(current)
    const parent = stringValue(row.parentDeptCode)
    if (!parent) return result
    current = parent
  }
  throw new Error('directory_department_depth_exceeded')
}
