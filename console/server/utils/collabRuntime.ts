import type { CollabRuntime, CollabRuntimeStatus } from 'collab'

export type ConsoleCollabMode = 'embedded' | 'external' | 'disabled'
export type ConsoleCollabStatus = 'starting' | 'running' | 'external' | 'disabled' | 'failed' | 'stopped'

export interface ConsoleCollabRuntimeState {
  mode: ConsoleCollabMode
  status: ConsoleCollabStatus
  runtime?: CollabRuntime
  runtimeStatus?: CollabRuntimeStatus
  error?: string
  updatedAt: string
}

export interface PublicConsoleCollabRuntimeState {
  mode: ConsoleCollabMode
  status: ConsoleCollabStatus
  runtime?: CollabRuntimeStatus
  error?: string
  updatedAt: string
}

declare global {
  var __hzyConsoleCollabRuntime: ConsoleCollabRuntimeState | undefined
}

function now() {
  return new Date().toISOString()
}

export function setConsoleCollabRuntimeState(state: Omit<ConsoleCollabRuntimeState, 'updatedAt'>) {
  globalThis.__hzyConsoleCollabRuntime = {
    ...state,
    updatedAt: now()
  }
}

export function getConsoleCollabRuntimeState(): ConsoleCollabRuntimeState {
  return globalThis.__hzyConsoleCollabRuntime || {
    mode: 'disabled',
    status: 'disabled',
    updatedAt: now()
  }
}

export function getPublicConsoleCollabRuntimeState(): PublicConsoleCollabRuntimeState {
  const state = getConsoleCollabRuntimeState()
  const runtime = state.runtime?.getStatus() || state.runtimeStatus

  return {
    mode: state.mode,
    status: state.status,
    runtime,
    error: state.error,
    updatedAt: state.updatedAt
  }
}
