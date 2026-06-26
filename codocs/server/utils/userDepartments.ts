import { fetchDirectoryData } from './directoryCompat'
import type { Department, DepartmentResponse } from '~/types/account'

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

interface DirectoryUserDepartmentItem {
  deptCode: string
  name?: string
  parentId?: string | null
  orgType?: string
  relationType?: string
  isPrimary?: boolean
}

interface DirectoryUserDepartmentsData {
  departments?: DirectoryUserDepartmentItem[]
  primaryDeptCode?: string | null
}

export async function fetchUserDepartments(uid: string): Promise<UserDepartmentsResult> {
  if (!uid) {
    return { departments: [], primaryDeptCode: null }
  }

  const deptResponse = await fetchDirectoryData<DepartmentResponse>('/departments')
  if (!deptResponse) {
    return { departments: [], primaryDeptCode: null }
  }

  const fullTree = deptResponse.tree || []
  const allFlat = deptResponse.flat || []

  const managedDeptCodes = new Set<string>()
  let primaryDeptCode: string | null = null

  for (const dept of allFlat) {
    if (dept.managerId === uid) {
      managedDeptCodes.add(dept.deptCode)
    }
    if (dept.leaderId === uid) {
      managedDeptCodes.add(dept.deptCode)
    }
  }

  let userCommitteeIds: string[] = []
  try {
    const userDeptResponse = await fetchDirectoryData<DirectoryUserDepartmentsData>(
      '/user-departments',
      { params: { uid } }
    )
    if (userDeptResponse) {
      if (userDeptResponse.primaryDeptCode) {
        primaryDeptCode = userDeptResponse.primaryDeptCode
      }
      const directDepartments = Array.isArray(userDeptResponse.departments)
        ? userDeptResponse.departments
        : []
      if (!primaryDeptCode) {
        primaryDeptCode = directDepartments.find(dept =>
          (dept.orgType || 'department') === 'department'
          && (dept.relationType || 'member') === 'member'
          && (dept.isPrimary !== false)
        )?.deptCode || null
      }
      userCommitteeIds = directDepartments
        .filter(dept => (dept.orgType || '') === 'committee')
        .map(dept => dept.deptCode)
        .filter((code): code is string => Boolean(code))
      if (!userCommitteeIds.length) {
        userCommitteeIds = directDepartments
          .map(c => c.deptCode)
          .filter(code => Boolean(allFlat.find(dept => dept.deptCode === code && dept.orgType === 'committee')))
          .filter((code): code is string => Boolean(code))
      }
    }
  } catch {
    if (managedDeptCodes.size > 0) {
      primaryDeptCode = [...managedDeptCodes][0] || null
    }
  }

  const findNodeInTree = <T extends { deptCode: string, children?: T[] }>(
    nodes: T[],
    targetDeptCode: string
  ): T | null => {
    for (const node of nodes) {
      if (node.deptCode === targetDeptCode) return node
      if (node.children?.length) {
        const found = findNodeInTree(node.children, targetDeptCode)
        if (found) return found
      }
    }
    return null
  }

  const formatNode = (node: Department): DeptNode => {
    return {
      deptCode: node.deptCode,
      name: node.name,
      orgType: node.orgType || 'department',
      children: (node.children || []).map(child => formatNode(child))
    }
  }

  const departments: DeptNode[] = []
  const addedDeptCodes = new Set<string>()

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
      departments.push(formatNode(node))
      addedDeptCodes.add(deptCode)
    }
  }

  if (primaryDeptCode && !addedDeptCodes.has(primaryDeptCode)) {
    const isChildOfAdded = departments.some(
      dept => findNodeInTree([dept], primaryDeptCode!) !== null
    )
    if (!isChildOfAdded) {
      const node = findNodeInTree(fullTree, primaryDeptCode)
      if (node) {
        departments.push(formatNode(node))
      }
    }
  }

  for (const committeeDeptCode of userCommitteeIds) {
    if (departments.some(dept => findNodeInTree([dept], committeeDeptCode) !== null)) continue
    const node = findNodeInTree(fullTree, committeeDeptCode)
    if (node) {
      departments.push(formatNode(node))
    }
  }

  return {
    departments,
    primaryDeptCode
  }
}

export function serializeUserDepartmentsCache(data: UserDepartmentsResult): string {
  return JSON.stringify({
    departments: data.departments || [],
    primaryDeptCode: data.primaryDeptCode || null
  })
}
