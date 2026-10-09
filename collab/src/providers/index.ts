import type { CollabConfig } from '../config.js'
import type { CollabProvider } from './types.js'
import { createHocuspocusProvider } from './hocuspocus.js'

export async function createCollabProvider(config: CollabConfig): Promise<CollabProvider> {
  if (config.provider === 'hocuspocus') {
    return createHocuspocusProvider(config)
  }

  throw new Error(`Unsupported collab provider: ${config.provider}`)
}
