interface DeptNode {
  deptCode: string
  name: string
  orgType?: string
  parentId?: string | null
  managerId?: string | null
  leaderId?: string | null
  children?: DeptNode[]
}

interface AccountUserDepartment {
  deptCode?: string
  committees?: Array<{ deptCode?: string | null }>
}

interface UserDepartmentsResult {
  departments: DeptNode[]
  primaryDeptCode: string | null
}

export async function fetchUserDepartments(uid: string): Promise<UserDepartmentsResult> {
  if (!uid) {
    return { departments: [], primaryDeptCode: null }
  }

  const config = useRuntimeConfig()
  const { apiBaseUrl, apiKey, apiSecret } = config.hzy as {
    apiBaseUrl: string
    apiKey: string
    apiSecret: string
  }

  const authHeaders = {
    Authorization: `Bearer ${apiKey}:${apiSecret}`
  }

  const deptResponse = await $fetch<{
    code: number
    data: { tree: DeptNode[], flat: DeptNode[] }
  }>(`${apiBaseUrl}/api/v1/departments`, {
    headers: authHeaders,
    timeout: 10000
  })

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
    const userDeptResponse = await $fetch<{ code: number, data: AccountUserDepartment }>(
      `${apiBaseUrl}/api/v1/users/${encodeURIComponent(uid)}/department`,
      { headers: authHeaders, timeout: 5000 }
    )
    if (userDeptResponse.code === 0 && userDeptResponse.data) {
      if (userDeptResponse.data.deptCode) primaryDeptCode = userDeptResponse.data.deptCode
      if (Array.isArray(userDeptResponse.data.committees)) {
        userCommitteeIds = userDeptResponse.data.committees
          .map(c => c.deptCode)
          .filter((deptCode): deptCode is string => Boolean(deptCode))
      }
    }
  } catch {
    if (managedDeptCodes.size > 0) {
      primaryDeptCode = [...managedDeptCodes][0] || null
    }
  }

  const findNodeInTree = (nodes: DeptNode[], targetDeptCode: string): DeptNode | null => {
    for (const node of nodes) {
      if (node.deptCode === targetDeptCode) return node
      if (node.children?.length) {
        const found = findNodeInTree(node.children, targetDeptCode)
        if (found) return found
      }
    }
    return null
  }

  const formatNode = (node: DeptNode): DeptNode => ({
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
