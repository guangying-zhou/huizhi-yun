export function directoryActiveStatuses(uids: string[], users: Array<{ uid: string, status?: unknown, statusKey?: unknown }>) {
  const byUid = new Map(users.map(user => [user.uid, user]))
  return [...new Set(uids)].map((uid) => {
    const user = byUid.get(uid)
    const status = String(user?.statusKey ?? user?.status ?? '')
    return { uid, active: status === 'active' || status === '1' }
  })
}
