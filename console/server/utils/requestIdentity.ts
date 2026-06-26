import type { H3Event } from 'h3'
import { resolveConsoleSession } from '~~/server/utils/authSession'

export async function requireConsoleRequestUid(event: H3Event) {
  const session = await resolveConsoleSession(event)
  return session.uid
}
