import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

interface DeptNode {
  deptCode: string
  name: string
  orgType?: string
  parentId?: string | null
  children?: DeptNode[]
}

interface RawDeptNode {
  deptCode: string
  name: string
  orgType?: string
  managerId?: string
  leaderId?: string
  children?: RawDeptNode[]
}

interface ConsoleUserDepartmentResponseData {
  departments?: Array<{
    deptCode: string
    name: string
    orgType?: string | null
    parentId?: string | null
  }>
  primaryDeptCode?: string | null
}

interface UserDepartmentsResult {
  departments: DeptNode[]
  primaryDeptCode: string | null
}

export async function fetchUserDepartments(uid: string): Promise<UserDepartmentsResult> {
  if (!uid) {
    return { departments: [], primaryDeptCode: null }
  }

  const deptResponse = await fetchDirectoryApi<{
    code: number
    data: { tree: RawDeptNode[], flat: RawDeptNode[] }
  }>('/api/v1/directory/departments')

  if (deptResponse.code !== 0 || !deptResponse.data) {
    return { departments: [], primaryDeptCode: null }
  }

  const fullTree = deptResponse.data.tree
  const allFlat = deptResponse.data.flat

  const managedDeptCodes = new Set<string>()
  let primaryDeptCode: string | null = null

  for (const dept of allFlat) {
    if (dept.managerId === uid) managedDeptCodes.add(dept.deptCode)
    if (dept.leaderId === uid) managedDeptCodes.add(dept.deptCode)
  }

  let userCommitteeIds: string[] = []
  try {
    const userDeptResponse = await fetchDirectoryApi<{ code: number, data: ConsoleUserDepartmentResponseData }>(
      '/api/v1/directory/user-departments',
      { params: { uid } }
    )
    if (userDeptResponse.code === 0 && userDeptResponse.data) {
      primaryDeptCode = userDeptResponse.data.primaryDeptCode || null
      userCommitteeIds = (userDeptResponse.data.departments || [])
        .filter(dept => dept.orgType === 'committee')
        .map(dept => dept.deptCode)
    }
  } catch {
    if (managedDeptCodes.size > 0) {
      primaryDeptCode = [...managedDeptCodes][0] || null
    }
  }

  const findNodeInTree = (nodes: RawDeptNode[], targetDeptCode: string): RawDeptNode | null => {
    for (const node of nodes) {
      if (node.deptCode === targetDeptCode) return node
      if (node.children?.length) {
        const found = findNodeInTree(node.children, targetDeptCode)
        if (found) return found
      }
    }
    return null
  }

  const formatNode = (node: RawDeptNode): DeptNode => ({
    deptCode: node.deptCode,
    name: node.name,
    orgType: node.orgType || 'department',
    children: (node.children || []).map(child => formatNode(child))
  })

  const departments: DeptNode[] = []

  const sortedManagedIds = [...managedDeptCodes].sort((a, b) => {
    const aNode = findNodeInTree(fullTree, a)
    const bInA = aNode ? findNodeInTree([aNode], b) : null
    if (bInA) return -1
    const bNode = findNodeInTree(fullTree, b)
    const aInB = bNode ? findNodeInTree([bNode], a) : null
    if (aInB) return 1
    return 0
  })

  for (const deptCode of sortedManagedIds) {
    const alreadyIncluded = departments.some(
      dept => findNodeInTree([dept], deptCode) !== null
    )
    if (alreadyIncluded) continue

    const node = findNodeInTree(fullTree, deptCode)
    if (node) departments.push(formatNode(node))
  }

  if (primaryDeptCode && !departments.some(dept => findNodeInTree([dept], primaryDeptCode!) !== null)) {
    const node = findNodeInTree(fullTree, primaryDeptCode)
    if (node) departments.push(formatNode(node))
  }

  for (const committeeDeptCode of userCommitteeIds) {
    if (departments.some(dept => findNodeInTree([dept], committeeDeptCode) !== null)) continue
    const node = findNodeInTree(fullTree, committeeDeptCode)
    if (node) departments.push(formatNode(node))
  }

  return { departments, primaryDeptCode }
}
