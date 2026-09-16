import type { H3Event } from 'h3'
import { resolveConsoleSession } from '~~/server/utils/authSession'
import { consoleSessionActorContext } from '~~/server/utils/consoleSessionActor'

export async function requireConsoleRequestUid(event: H3Event) {
  const session = await resolveConsoleSession(event)
  event.context.consoleAuth = consoleSessionActorContext(
    session,
    event.context.consoleAuth as Record<string, unknown> | undefined
  )
  return session.uid
}
