import { getDirectoryUser, listDirectoryUsers } from '~~/server/utils/directoryRuntime'

interface AccountUser {
  id: number
  uid: string
  realName: string | null
  nickname: string | null
  email: string | null
  mobile?: string | null
  avatar: string | null
  gender?: number
  status?: number
  deptCode?: string | null
  deptName?: string | null
  department?: {
    id: number
    name: string
    code: string
  }
}

function attachDepartment(user: Awaited<ReturnType<typeof getDirectoryUser>>): AccountUser | null {
  if (!user) return null
  return {
    ...user,
    department: user.deptCode
      ? {
          id: 0,
          name: user.deptName || user.deptCode,
          code: user.deptCode
        }
      : undefined
  }
}

export async function getDirectoryAccountUserByEmail(email: string): Promise<AccountUser | null> {
  const response = await listDirectoryUsers({ search: email })
  const matched = response.items.find(
    user => user.email?.toLowerCase() === email.toLowerCase()
  )
  if (!matched) return null
  return attachDepartment(await getDirectoryUser(matched.uid))
}

export async function getDirectoryAccountUserByUid(uid: string): Promise<AccountUser | null> {
  return attachDepartment(await getDirectoryUser(uid))
}
