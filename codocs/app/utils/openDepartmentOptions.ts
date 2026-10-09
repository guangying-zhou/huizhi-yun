interface DepartmentOption { value: string, label: string }
interface DirectoryDepartment { deptCode: string, name: string }
interface OpenDepartment { deptCode: string, deptName: string }

/** Directory supplies selectable departments; open-document data supplies only authorized contents. */
export function openDepartmentOptions(directory: DirectoryDepartment[], groups: OpenDepartment[]): DepartmentOption[] {
  const departments = new Map(directory.map(dept => [dept.deptCode, dept.name]))
  for (const group of groups) if (!departments.has(group.deptCode)) departments.set(group.deptCode, group.deptName)
  return [...departments].map(([value, label]) => ({ label, value }))
}

export function openDepartmentSelection<T extends OpenDepartment>(code: string, options: DepartmentOption[], groups: T[]) {
  const group = groups.find(group => group.deptCode === code)
  if (group) return group
  const department = options.find(dept => dept.value === code)
  return department ? { deptCode: department.value, deptName: department.label, documentCount: 0, folders: [] } : null
}
