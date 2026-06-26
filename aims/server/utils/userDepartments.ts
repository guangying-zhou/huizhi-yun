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
  parentId?: string | null
  children?: RawDeptNode[]
  managerId?: string | null
  leaderId?: string | null
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
  managedDeptCodes: string[]
}

export async function fetchAccessibleDepartments(uid: string): Promise<RawDeptNode[]> {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) return []

  const response = await $fetch<{ code: number, data?: RawDeptNode[] }>(
    `${requireDirectoryConfig().consoleApiUrl}/api/v1/departments/accessible`,
    {
      headers: getDirectoryAuthHeaders(),
      params: { uid: normalizedUid },
      timeout: 10000
    }
  )

  return response.code === 0 && Array.isArray(response.data) ? response.data : []
}

function treeIncludesDept(nodes: DeptNode[], targetDeptCode: string): boolean {
  for (const node of nodes) {
    if (node.deptCode === targetDeptCode) return true
    if (node.children?.length && treeIncludesDept(node.children, targetDeptCode)) return true
  }
  return false
}

function collectRawDeptCodes(node: RawDeptNode, codes: Set<string>) {
  if (node.deptCode) codes.add(node.deptCode)
  for (const child of node.children || []) {
    collectRawDeptCodes(child, codes)
  }
}

export async function fetchUserDepartments(uid: string): Promise<UserDepartmentsResult> {
  if (!uid) {
    return { departments: [], primaryDeptCode: null, managedDeptCodes: [] }
  }

  const deptResponse = await $fetch<{
    code: number
    data: { tree: RawDeptNode[], flat: RawDeptNode[] }
  }>(
    `${requireDirectoryConfig().consoleApiUrl}/api/v1/directory/departments`,
    {
      headers: getDirectoryAuthHeaders(),
      timeout: 10000
    }
  )

  if (deptResponse.code !== 0 || !deptResponse.data) {
    return { departments: [], primaryDeptCode: null, managedDeptCodes: [] }
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
  const managedAccessDeptCodes = new Set<string>()

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
    if (node) {
      collectRawDeptCodes(node, managedAccessDeptCodes)
      departments.push(formatNode(node))
    }
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

  return { departments, primaryDeptCode, managedDeptCodes: [...managedAccessDeptCodes] }
}

export async function hasDepartmentAccess(uid: string, deptCode: string): Promise<boolean> {
  const normalizedUid = String(uid || '').trim()
  const normalizedDeptCode = String(deptCode || '').trim()
  if (!normalizedUid || !normalizedDeptCode) return false

  const { departments, primaryDeptCode } = await fetchUserDepartments(normalizedUid)
  if (primaryDeptCode === normalizedDeptCode) return true
  return treeIncludesDept(departments, normalizedDeptCode)
}
