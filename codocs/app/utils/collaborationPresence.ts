import type { Awareness } from 'y-protocols/awareness'

export type PresenceStatus = 'online' | 'away' | 'offline'
export interface PresenceMember { id: string, name: string, color: string, status: PresenceStatus }
export const presenceLabels: Record<PresenceStatus, string> = { online: '在线', away: '离开', offline: '离线' }

/** Awareness is ephemeral presence, never an authorization fact. Missing metadata supports older clients. */
export function presenceMembers(awareness: Awareness): PresenceMember[] {
  const members = new Map<string, PresenceMember>()
  for (const state of awareness.getStates().values()) {
    const user = state.user
    if (!user || typeof user.id !== 'string' || !user.id) continue
    const status: PresenceStatus = state.presence?.status === 'away' ? 'away' : 'online'
    const member = { id: user.id, name: String(user.name || user.id), color: /^#[\da-f]{6}$/i.test(user.color) ? user.color : '#818cf8', status }
    // A visible active tab wins over the same user's hidden/idle tabs.
    if (!members.has(user.id) || status === 'online') members.set(user.id, member)
  }
  return [...members.values()]
}

/** Publishes only presence, preserving the cursor and user awareness fields. */
export function attachPresence(awareness: Awareness, page: Document, activity: Window, idleMs = 60_000) {
  let lastActivity = Date.now()
  const publish = () => {
    const status = page.visibilityState === 'hidden' || Date.now() - lastActivity >= idleMs ? 'away' : 'online'
    if (awareness.getLocalState()?.presence?.status !== status) awareness.setLocalStateField('presence', { status })
  }
  const active = () => {
    lastActivity = Date.now()
    publish()
  }
  const events = ['pointerdown', 'keydown', 'pointermove', 'focus'] as const
  for (const event of events) activity.addEventListener(event, active, { passive: true })
  const visibility = () => page.visibilityState === 'visible' ? active() : publish()
  page.addEventListener('visibilitychange', visibility)
  const timer = setInterval(publish, Math.min(idleMs, 5000))
  publish()
  return () => {
    clearInterval(timer)
    for (const event of events) activity.removeEventListener(event, active)
    page.removeEventListener('visibilitychange', visibility)
  }
}

/** Keep a bounded session roster so departed clients can be distinguished from idle clients. */
export function updatePresenceRoster(previous: PresenceMember[], current: PresenceMember[], connected: boolean): PresenceMember[] {
  const live = new Map(current.map(member => [member.id, member]))
  const departed = previous.filter(member => !live.has(member.id)).map(member => ({ ...member, status: 'offline' as const }))
  return [...current, ...departed.slice(0, 20)].map(member => connected ? member : { ...member, status: 'offline' })
}
