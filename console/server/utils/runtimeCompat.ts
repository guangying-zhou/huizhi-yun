import type { H3Event } from 'h3'
import {
  getConsoleRuntimeClipboard,
  getConsoleRuntimeOnlineHeartbeats,
  setConsoleRuntimeClipboard,
  writeConsoleRuntimeHeartbeat
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export interface ClipboardInput {
  content?: string
  contentType?: 'markdown' | 'text' | 'json' | string
  sourceApp?: string
}

export interface HeartbeatInput {
  sourceApp?: string
  page?: string
  status?: 'active' | 'idle' | 'offline' | string
}

export async function setClipboard(event: H3Event, input: ClipboardInput) {
  const response = await setConsoleRuntimeClipboard(event, input as Record<string, unknown>)
  return response.data
}

export async function getClipboard(event: H3Event) {
  const response = await getConsoleRuntimeClipboard(event)
  return response.data
}

export async function writeHeartbeat(event: H3Event, input: HeartbeatInput) {
  const response = await writeConsoleRuntimeHeartbeat(event, input as Record<string, unknown>)
  return response.data
}

export async function listOnlineHeartbeats(event: H3Event, sourceApp?: string) {
  const response = await getConsoleRuntimeOnlineHeartbeats(event, sourceApp ? { sourceApp } : {})
  return response.data
}
