import { listDirectoryDepartments, listDirectoryUserDepartments } from '~~/server/utils/directoryRuntime'

interface DeptNode {
  deptCode: string
  name: string
  orgType?: string
  parentId?: string | null
  children?: DeptNode[]
}

interface UserDepartmentsResult {
  departments: DeptNode[]
  primaryDeptCode: string | null
}

function findNodeInTree(nodes: DeptNode[], targetDeptCode: string): DeptNode | null {
  for (const node of nodes) {
    if (node.deptCode === targetDeptCode) return node
    if (node.children?.length) {
      const found = findNodeInTree(node.children, targetDeptCode)
      if (found) return found
    }
  }
  return null
}

function formatNode(node: DeptNode): DeptNode {
  return {
    deptCode: node.deptCode,
    name: node.name,
    orgType: node.orgType || 'department',
    parentId: node.parentId || null,
    children: (node.children || []).map(child => formatNode(child))
  }
}

export async function fetchUserDepartments(uid: string): Promise<UserDepartmentsResult> {
  if (!uid) return { departments: [], primaryDeptCode: null }

  const [deptResponse, userDeptResponse] = await Promise.all([
    listDirectoryDepartments(),
    listDirectoryUserDepartments(uid)
  ])

  const payload = userDeptResponse as {
    departments?: Array<{ deptCode: string }>
    primaryDeptCode?: string | null
  }
  const departments: DeptNode[] = []
  const sourceCodes = [
    payload.primaryDeptCode,
    ...(payload.departments || []).map(dept => dept.deptCode)
  ].filter((code): code is string => Boolean(code))

  for (const deptCode of [...new Set(sourceCodes)]) {
    if (departments.some(dept => findNodeInTree([dept], deptCode))) continue
    const node = findNodeInTree(deptResponse.tree, deptCode)
    if (node) departments.push(formatNode(node))
  }

  return {
    departments,
    primaryDeptCode: payload.primaryDeptCode || null
  }
}
