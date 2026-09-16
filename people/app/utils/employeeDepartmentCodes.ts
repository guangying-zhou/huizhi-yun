export interface EmployeeDepartmentNode {
  deptCode: string
  orgType?: string
  children?: EmployeeDepartmentNode[]
}

function findEmployeeDepartmentNode(
  nodes: EmployeeDepartmentNode[],
  deptCode: string
): EmployeeDepartmentNode | null {
  for (const node of nodes) {
    if (node.deptCode === deptCode) return node
    const match = findEmployeeDepartmentNode(node.children || [], deptCode)
    if (match) return match
  }
  return null
}

function collectFormalDepartmentCodes(node: EmployeeDepartmentNode): string[] {
  const codes = [node.deptCode]
  for (const child of node.children || []) {
    if (child.orgType && child.orgType !== 'department') continue
    codes.push(...collectFormalDepartmentCodes(child))
  }
  return codes
}

export function resolveEmployeeDepartmentCodes(
  nodes: EmployeeDepartmentNode[],
  selectedDeptCode: string,
  omitSingleRoot = false
): string[] {
  if (!selectedDeptCode) return []

  const selectedNode = findEmployeeDepartmentNode(nodes, selectedDeptCode)
  if (!selectedNode || (selectedNode.orgType && selectedNode.orgType !== 'department')) {
    return [selectedDeptCode]
  }

  // A single formal root represents the tenant company. Omitting the filter is
  // equivalent to selecting its complete subtree and avoids an unbounded URL.
  if (omitSingleRoot && nodes.length === 1 && nodes[0]?.deptCode === selectedDeptCode) return []

  return [...new Set(collectFormalDepartmentCodes(selectedNode))]
}
