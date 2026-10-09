import { UNASSIGNED_OWNER_LABEL, UNASSIGNED_OWNER_UID } from '../../shared/utils/reservedDirectorySubject'

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

// Built-in users are resolved locally for display only and are never sent to
// Console Directory. They are not identities: see reservedDirectorySubject.
const BUILTIN_DIRECTORY_USERS: Record<string, BuiltinDirectoryUser> = {
  [UNASSIGNED_OWNER_UID]: {
    id: 0,
    uid: UNASSIGNED_OWNER_UID,
    username: UNASSIGNED_OWNER_UID,
    displayName: UNASSIGNED_OWNER_LABEL,
    realName: UNASSIGNED_OWNER_LABEL,
    nickname: null,
    email: '',
    mobile: null,
    avatar: null,
    // 0: not a usable account. Selectors skip status 0 users.
    status: 0,
    deptCode: null,
    deptName: null
  },
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
