// Consume the complete active Directory flat projection. No process-global
// cache: the caller must obtain it from the current tenant runtime.
export function subjectDepartmentTreeIndex(rows: unknown): Record<string, string[]> {
  if (!Array.isArray(rows)) throw new Error('subject_department_tree_invalid')
  const parents = new Map<string, string | null>()
  for (const row of rows) {
    if (!row || typeof row.deptCode !== 'string' || !row.deptCode || row.deptCode !== row.deptCode.trim()
      || parents.has(row.deptCode) || !(row.parentId === null || typeof row.parentId === 'string')) throw new Error('subject_department_tree_invalid')
    if (row.orgType === 'department') parents.set(row.deptCode, row.parentId || null)
  }
  const index: Record<string, string[]> = Object.create(null)
  for (const code of parents.keys()) index[code] = []
  for (const code of parents.keys()) {
    const visited = new Set<string>()
    let ancestor: string | null = code
    while (ancestor && parents.has(ancestor)) {
      if (visited.has(ancestor)) throw new Error('subject_department_tree_cycle')
      visited.add(ancestor)
      index[ancestor]!.push(code)
      ancestor = parents.get(ancestor) || null
    }
  }
  for (const descendants of Object.values(index)) descendants.sort()
  return index
}
