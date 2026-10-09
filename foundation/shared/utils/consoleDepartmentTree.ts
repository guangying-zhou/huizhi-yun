import type { ConsoleDirectoryDepartment } from '../../app/types/consoleDirectory'

export function flattenDepartmentTree(nodes: ConsoleDirectoryDepartment[], search: string, expandedCodes: Set<string>, level = 0): Array<ConsoleDirectoryDepartment & { displayLevel: number }> {
  const result: Array<ConsoleDirectoryDepartment & { displayLevel: number }> = []
  for (const node of nodes) {
    const matched = !search || [node.deptCode, node.name, node.manager, node.leader]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(search.toLowerCase()))

    const children = flattenDepartmentTree(node.children || [], search, expandedCodes, level + 1)
    if (matched || children.length) {
      result.push({ ...node, displayLevel: level })
      if (expandedCodes.has(node.deptCode) || search) {
        result.push(...children)
      }
    }
  }
  return result
}
