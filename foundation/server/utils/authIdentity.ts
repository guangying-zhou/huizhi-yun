import { createError, type H3Event } from 'h3'
import { resolveConsoleAuthWithSessionBridge } from './consoleSessionBridge'

type ConsoleUserAuth = {
  authenticated?: boolean
  subjectType?: string
  uid?: string
}

function verifiedUserUid(context: ConsoleUserAuth | undefined) {
  if (!context?.authenticated || context.subjectType !== 'user') return ''
  return String(context.uid || '').trim()
}

/**
 * Directory compatibility routes are browser BFFs.  They may use the
 * application's Console Directory client to fetch a view, but that client
 * credential must never turn an anonymous request into a directory reader.
 */
export async function requireFoundationSessionUid(event: H3Event, message = '请先登录') {
  const existing = event.context.consoleAuth as ConsoleUserAuth | undefined
  const existingUid = verifiedUserUid(existing)
  if (existingUid) return existingUid

  const resolved = await resolveConsoleAuthWithSessionBridge(event)
  event.context.consoleAuth = resolved
  const uid = verifiedUserUid(resolved)
  if (!uid) {
    throw createError({ statusCode: 401, message })
  }

  return uid
}
