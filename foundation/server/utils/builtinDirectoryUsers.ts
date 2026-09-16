export interface BuiltinDirectoryUser {
  id: number
  uid: string
  username: string
  displayName: string
  realName: string
  nickname: string | null
  email: string
  mobile: string | null
  avatar: string | null
  status: number
  deptCode: string | null
  deptName: string | null
}

const BUILTIN_DIRECTORY_USERS: Record<string, BuiltinDirectoryUser> = {
  system: {
    id: 0,
    uid: 'system',
    username: 'system',
    displayName: '系统',
    realName: '系统',
    nickname: null,
    email: '',
    mobile: null,
    avatar: null,
    status: 1,
    deptCode: null,
    deptName: null
  }
}

export function normalizeDirectoryUid(uid: unknown) {
  return String(uid || '').trim()
}

export function getBuiltinDirectoryUser(uid: unknown) {
  const normalized = normalizeDirectoryUid(uid).toLowerCase()
  return normalized ? BUILTIN_DIRECTORY_USERS[normalized] || null : null
}

export function splitBuiltinDirectoryUids(uids: unknown[]) {
  const builtinUsers: BuiltinDirectoryUser[] = []
  const externalUids: string[] = []
  const seen = new Set<string>()

  for (const uid of uids) {
    const normalized = normalizeDirectoryUid(uid)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)

    const builtinUser = getBuiltinDirectoryUser(normalized)
    if (builtinUser) {
      builtinUsers.push(builtinUser)
    } else {
      externalUids.push(normalized)
    }
  }

  return { builtinUsers, externalUids }
}
