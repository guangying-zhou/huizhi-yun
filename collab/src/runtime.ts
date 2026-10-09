import type { CollabConfig, LoadCollabConfigOptions } from './config.js'
import { loadCollabConfig } from './config.js'
import { createCollabProvider } from './providers/index.js'
import type { CollabProvider, CollabRuntimeStatus } from './providers/types.js'

export interface CreateCollabRuntimeOptions extends LoadCollabConfigOptions {
  config?: CollabConfig
}

export interface CollabRuntime {
  provider: CollabProvider
  config: CollabConfig
  getStatus(): CollabRuntimeStatus
  start(): Promise<void>
  stop(): Promise<void>
}

export async function createCollabRuntime(options: CreateCollabRuntimeOptions = {}): Promise<CollabRuntime> {
  const config = options.config || loadCollabConfig(options)
  const provider = await createCollabProvider(config)

  return {
    provider,
    config,
    getStatus: () => provider.getStatus(),
    start: () => provider.start(),
    stop: () => provider.stop()
  }
}

export async function startCollabRuntime(options: CreateCollabRuntimeOptions = {}): Promise<CollabRuntime> {
  const runtime = await createCollabRuntime(options)
  await runtime.start()
  return runtime
}
