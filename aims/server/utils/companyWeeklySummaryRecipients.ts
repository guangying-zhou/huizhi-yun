import { createError, type H3Event } from 'h3'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

interface RecipientSelection {
  subjectType: 'user' | 'department'
  subjectCode: string
  subjectName: string
}

interface DirectoryUser {
  uid?: string
  realName?: string
  displayName?: string
  deptCode?: string
}

interface DepartmentNode {
  deptCode?: string
  children?: DepartmentNode[]
}

interface DirectoryEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

interface UserPage {
  items?: DirectoryUser[]
  total?: number
  page?: number
  pageSize?: number
}

function text(value: unknown) {
  return String(value || '').trim()
}

function normalizeSelections(value: unknown): RecipientSelection[] {
  if (!Array.isArray(value)) return []
  const result: RecipientSelection[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const subjectType = text(row.subjectType) as RecipientSelection['subjectType']
    const subjectCode = text(row.subjectCode)
    const subjectName = text(row.subjectName)
    const key = `${subjectType}:${subjectCode}`
    if ((subjectType !== 'user' && subjectType !== 'department') || !subjectCode || !subjectName || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push({ subjectType, subjectCode, subjectName })
  }
  return result
}

function collectDepartmentCodes(nodes: DepartmentNode[], targetCode: string): string[] {
  for (const node of nodes) {
    if (text(node.deptCode) === targetCode) {
      const result: string[] = []
      const visit = (current: DepartmentNode) => {
        const code = text(current.deptCode)
        if (code) result.push(code)
        for (const child of current.children || []) visit(child)
      }
      visit(node)
      return result
    }
    const nested: string[] = collectDepartmentCodes(node.children || [], targetCode)
    if (nested.length) return nested
  }
  return []
}

async function directoryUsersByUIDs(event: H3Event, uids: string[]) {
  if (!uids.length) return []
  const response = await fetchConsoleDirectoryApi<DirectoryEnvelope<DirectoryUser[]>>('/users', {
    event,
    params: { uids: uids.join(',') }
  })
  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || '读取抄送人员目录失败' })
  }
  return Array.isArray(response.data) ? response.data : []
}

async function directoryUsersByDepartment(event: H3Event, deptCode: string) {
  const result: DirectoryUser[] = []
  let page = 1
  for (;;) {
    const response = await fetchConsoleDirectoryApi<DirectoryEnvelope<UserPage>>('/users', {
      event,
      params: { dept_code: deptCode, page, pageSize: 100 }
    })
    if (response.code !== undefined && response.code !== 0) {
      throw createError({ statusCode: 502, message: response.message || '读取部门抄送人员失败' })
    }
    const items = response.data?.items || []
    result.push(...items)
    const total = Number(response.data?.total || result.length)
    if (!items.length || result.length >= total) break
    page++
    if (page > 1000) {
      throw createError({ statusCode: 502, message: '部门人员目录分页异常' })
    }
  }
  return result
}

export async function resolveCompanyWeeklySummaryRecipients(
  event: H3Event,
  rawSelections: unknown
) {
  const selections = normalizeSelections(rawSelections)
  if (!selections.length) {
    return { resolvedRecipients: [], coveredSelectionKeys: [] }
  }

  const directSelections = selections.filter(item => item.subjectType === 'user')
  const departmentSelections = selections.filter(item => item.subjectType === 'department')
  const directUsers = await directoryUsersByUIDs(event, directSelections.map(item => item.subjectCode))
  const directUserMap = new Map(directUsers.map(user => [text(user.uid), user]))

  let departmentTree: DepartmentNode[] = []
  if (departmentSelections.length) {
    const response = await fetchConsoleDirectoryApi<DirectoryEnvelope<{ tree?: DepartmentNode[] }>>('/departments', { event })
    if (response.code !== undefined && response.code !== 0) {
      throw createError({ statusCode: 502, message: response.message || '读取抄送部门目录失败' })
    }
    departmentTree = response.data?.tree || []
  }

  const candidates: Array<{
    selection: RecipientSelection
    user: DirectoryUser
  }> = []
  const coveredSelectionKeys = new Set<string>()
  for (const selection of directSelections) {
    const user = directUserMap.get(selection.subjectCode)
    if (!user) {
      throw createError({
        statusCode: 409,
        message: `抄送人员 ${selection.subjectName} 已离职、不存在或不再可用，请更新抄送清单`
      })
    }
    candidates.push({ selection, user })
    coveredSelectionKeys.add(`user:${selection.subjectCode}`)
  }
  for (const selection of departmentSelections) {
    const departmentCodes = collectDepartmentCodes(departmentTree, selection.subjectCode)
    if (!departmentCodes.length) {
      throw createError({
        statusCode: 409,
        message: `抄送部门 ${selection.subjectName} 不存在，请更新抄送清单`
      })
    }
    const users = (await Promise.all(
      departmentCodes.map(code => directoryUsersByDepartment(event, code))
    )).flat()
    const validUsers = users.filter(user => text(user.uid))
    if (!validUsers.length) {
      throw createError({
        statusCode: 409,
        message: `抄送部门 ${selection.subjectName} 当前没有可用人员，请更新抄送清单`
      })
    }
    for (const user of validUsers) candidates.push({ selection, user })
    coveredSelectionKeys.add(`department:${selection.subjectCode}`)
  }

  const resolvedRecipients: Array<{
    subjectType: string
    subjectCode: string
    uid: string
    displayName: string
    departmentCode: string
  }> = []
  const seenUIDs = new Set<string>()
  for (const candidate of candidates) {
    const uid = text(candidate.user.uid)
    if (!uid || seenUIDs.has(uid)) continue
    seenUIDs.add(uid)
    resolvedRecipients.push({
      subjectType: candidate.selection.subjectType,
      subjectCode: candidate.selection.subjectCode,
      uid,
      displayName: text(candidate.user.realName || candidate.user.displayName) || uid,
      departmentCode: text(candidate.user.deptCode)
    })
  }
  resolvedRecipients.sort((left, right) => left.uid.localeCompare(right.uid))
  return {
    resolvedRecipients,
    coveredSelectionKeys: [...coveredSelectionKeys].sort()
  }
}
