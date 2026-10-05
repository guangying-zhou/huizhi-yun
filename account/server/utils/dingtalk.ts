/**
 * 钉钉 API 工具库
 *
 * 提供：
 * - Access Token 获取与缓存
 * - 部门列表获取（递归）
 * - 部门用户详情获取（分页）
 */

// ============================================================
// 类型定义
// ============================================================

export interface DingTalkDepartment {
  dept_id: number
  name: string
  parent_id: number
  auto_add_user?: boolean
  create_dept_group?: boolean
}

export interface DingTalkUser {
  userid: string
  unionid?: string
  name: string
  avatar?: string
  mobile?: string
  email?: string
  title?: string
  job_number?: string
  dept_id_list?: number[]
  active?: boolean
}

interface DingTalkTokenResponse {
  accessToken: string
  expireIn: number
}

interface DingTalkOApiResponse {
  errcode: number
  errmsg: string
  result?: {
    list?: DingTalkUser[]
    has_more?: boolean
    next_cursor?: number
  } | DingTalkDepartment[]
}

// ============================================================
// Token 缓存
// ============================================================

let tokenCache: {
  access_token: string | null
  expires_at: number
} = {
  access_token: null,
  expires_at: 0
}

// ============================================================
// 核心函数
// ============================================================

function getDingtalkConfig() {
  const config = useRuntimeConfig()
  return {
    appId: config.dingtalk.appId,
    appSecret: config.dingtalk.appSecret
  }
}

export function isDingtalkConfigured(): boolean {
  const { appId, appSecret } = getDingtalkConfig()
  return Boolean(appId && appSecret)
}

/**
 * 获取 Access Token（新版 API）
 */
async function getAccessToken(): Promise<string> {
  if (tokenCache.access_token && tokenCache.expires_at > Date.now()) {
    return tokenCache.access_token
  }

  const { appId, appSecret } = getDingtalkConfig()
  if (!appId || !appSecret) {
    throw new Error('缺少钉钉配置 (DINGTALK_APP_ID / DINGTALK_APP_SECRET)')
  }

  const result = await $fetch<DingTalkTokenResponse>('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    body: {
      appKey: appId,
      appSecret: appSecret
    }
  })

  if (!result.accessToken) {
    throw new Error('获取钉钉 token 失败')
  }

  tokenCache = {
    access_token: result.accessToken,
    expires_at: Date.now() + (result.expireIn - 300) * 1000
  }

  return result.accessToken
}

/**
 * 获取子部门列表
 */
async function getSubDepartments(parentId: number): Promise<DingTalkDepartment[]> {
  const token = await getAccessToken()
  const result = await $fetch<DingTalkOApiResponse>(
    `https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${token}`,
    {
      method: 'POST',
      body: { dept_id: parentId, language: 'zh_CN' }
    }
  )

  if (result.errcode !== 0) {
    throw new Error(`获取部门列表失败: ${result.errcode} - ${result.errmsg}`)
  }

  return (result.result as DingTalkDepartment[]) || []
}

/**
 * 递归获取完整部门树
 */
export async function getAllDepartments(): Promise<DingTalkDepartment[]> {
  const allDepts: DingTalkDepartment[] = []

  async function fetchRecursive(parentId: number) {
    const children = await getSubDepartments(parentId)
    for (const child of children) {
      allDepts.push(child)
      await fetchRecursive(child.dept_id)
    }
  }

  // 根部门 ID = 1
  await fetchRecursive(1)
  return allDepts
}

/**
 * 获取指定部门的用户列表（分页）
 */
async function getDepartmentUsers(deptCode: number): Promise<DingTalkUser[]> {
  const users: DingTalkUser[] = []
  let cursor = 0
  let hasMore = true

  while (hasMore) {
    const token = await getAccessToken()
    const result = await $fetch<DingTalkOApiResponse>(
      `https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${token}`,
      {
        method: 'POST',
        body: {
          dept_id: deptCode,
          cursor,
          size: 100,
          language: 'zh_CN'
        }
      }
    )

    if (result.errcode !== 0) {
      throw new Error(`获取部门用户失败: ${result.errcode} - ${result.errmsg}`)
    }

    const resObj = result.result as {
      list?: DingTalkUser[]
      has_more?: boolean
      next_cursor?: number
    }
    const list = resObj?.list || []
    users.push(...list)
    hasMore = resObj?.has_more || false
    cursor = resObj?.next_cursor || 0
  }

  return users
}

/**
 * 获取所有部门下的全部用户（去重）
 */
export async function getAllUsers(): Promise<DingTalkUser[]> {
  const depts = await getAllDepartments()
  const userMap = new Map<string, DingTalkUser>()

  for (const dept of depts) {
    const users = await getDepartmentUsers(dept.dept_id)
    for (const user of users) {
      if (!userMap.has(user.userid)) {
        userMap.set(user.userid, user)
      }
    }
  }

  // 也获取根部门 (1) 的直属用户
  const rootUsers = await getDepartmentUsers(1)
  for (const user of rootUsers) {
    if (!userMap.has(user.userid)) {
      userMap.set(user.userid, user)
    }
  }

  return Array.from(userMap.values())
}

/**
 * 获取部门名称映射 (dept_id → name)
 */
export async function getDepartmentNameMap(): Promise<Map<number, string>> {
  const depts = await getAllDepartments()
  const map = new Map<number, string>()
  map.set(1, '根部门')
  for (const d of depts) {
    map.set(d.dept_id, d.name)
  }
  return map
}

// ============================================================
// 日志/周报
// ============================================================

export interface DingTalkReportContent {
  key: string
  value: string
  type?: string
  sort?: string
}

export interface DingTalkReport {
  report_id: string
  template_name: string
  creator_id: string
  creator_name: string
  dept_name: string
  create_time: number
  modified_time: number
  remark: string
  contents: DingTalkReportContent[]
}

interface DingTalkReportListResponse {
  errcode: number
  errmsg: string
  result?: {
    data_list?: DingTalkReport[]
    has_more?: boolean
    next_cursor?: number
    size?: number
  }
}

/**
 * 获取钉钉日志/周报列表
 * @param params.userid 员工 userid（可选，不传则获取全员）
 * @param params.startTime 开始时间（毫秒时间戳）
 * @param params.endTime 结束时间（毫秒时间戳）
 * @param params.templateName 模板名称（如"日报"、"周报"，可选）
 */
export async function getReportList(params: {
  userid?: string
  startTime: number
  endTime: number
  templateName?: string
}): Promise<DingTalkReport[]> {
  const allReports: DingTalkReport[] = []
  let cursor = 0
  let hasMore = true

  // 确保时间戳为正整数
  const startTime = Math.floor(Number(params.startTime))
  const endTime = Math.floor(Number(params.endTime))
  if (!startTime || !endTime || startTime <= 0 || endTime <= 0) {
    throw new Error(`无效的时间参数: start_time=${params.startTime}, end_time=${params.endTime}`)
  }

  while (hasMore) {
    const token = await getAccessToken()
    const body: Record<string, unknown> = {
      start_time: startTime,
      end_time: endTime,
      cursor,
      size: 20
    }
    if (params.userid) body.userid = params.userid

    console.log('[DingTalk] getReportList request:', JSON.stringify(body))

    const result = await $fetch<DingTalkReportListResponse>(
      `https://oapi.dingtalk.com/topapi/report/list?access_token=${token}`,
      { method: 'POST', body }
    )

    console.log('[DingTalk] getReportList response:', JSON.stringify({ errcode: result.errcode, errmsg: result.errmsg, count: result.result?.data_list?.length }))

    if (result.errcode !== 0) {
      throw new Error(`获取钉钉日志失败: ${result.errcode} - ${result.errmsg}`)
    }

    const dataList = result.result?.data_list || []
    allReports.push(...dataList)
    hasMore = result.result?.has_more || false
    cursor = result.result?.next_cursor || 0
  }

  // 日志：输出获取到的模板名称，便于排查
  const templateNames = [...new Set(allReports.map(r => r.template_name))]
  console.log(`[DingTalk] getReportList fetched ${allReports.length} reports, templates: [${templateNames.join(', ')}], filter: ${params.templateName || '(none)'}`)

  // 按模板名称过滤（不在请求参数中传 template_name，避免 40035 错误）
  if (params.templateName) {
    const filtered = allReports.filter(r => r.template_name.includes(params.templateName!))
    console.log(`[DingTalk] after filter: ${filtered.length} reports`)
    return filtered
  }
  return allReports
}
