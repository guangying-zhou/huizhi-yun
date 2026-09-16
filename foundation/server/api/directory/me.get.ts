import { fetchConsoleApi } from '../../utils/directoryApi'

interface ConsoleCurrentUserResponse {
  code?: number
  data?: {
    authenticated?: boolean
    directory?: {
      uid?: string
      username?: string | null
      displayName?: string | null
      realName?: string | null
      nickname?: string | null
      email?: string | null
      mobileTail4?: string | null
      avatarUrl?: string | null
      primaryDeptCode?: string | null
      primaryDeptName?: string | null
      positionTitle?: string | null
      userType?: string | null
    } | null
  }
}

export default defineEventHandler(async (event) => {
  const response = await fetchConsoleApi<ConsoleCurrentUserResponse>('/auth/me', { event })
  const directory = response.data?.directory
  if (response.code !== 0 || !response.data?.authenticated || !directory?.uid) {
    throw createError({ statusCode: 401, message: 'Console login required' })
  }
  const mobileTail4 = String(directory.mobileTail4 || '').trim()

  return {
    code: 0,
    message: 'ok',
    data: {
      id: 0,
      uid: directory.uid,
      username: directory.username || null,
      displayName: directory.displayName || directory.realName || directory.username || directory.uid,
      realName: directory.realName || directory.displayName || directory.username || directory.uid,
      nickname: directory.nickname || null,
      email: directory.email || '',
      mobile: null,
      mobileTail4: /^\d{4}$/.test(mobileTail4) ? mobileTail4 : null,
      avatar: directory.avatarUrl || null,
      gender: 0,
      status: 1,
      deptCode: directory.primaryDeptCode || null,
      deptName: directory.primaryDeptName || null,
      positionTitle: directory.positionTitle || null,
      userType: directory.userType || null
    }
  }
})
