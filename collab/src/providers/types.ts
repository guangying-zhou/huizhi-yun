import type { CollabConfig } from '../config.js'

export interface CollabRuntimeStatus {
  appCode: string
  provider: string
  runtimeMode: 'standalone' | 'embedded'
  port: number
  address: string
  basePath: string
  startedAt: string
  codocsRuntime: {
    endpointConfigured: boolean
    endpoint?: string
  }
  redisStatus: string
  persistence: {
    ossConfigured: boolean
    integrationCode?: string
    defaultBucket?: string
    projectsBucket?: string
    imagesBucket?: string
  }
}

export interface CollabProvider {
  name: string
  config: CollabConfig
  getStatus(): CollabRuntimeStatus
  start(): Promise<void>
  stop(): Promise<void>
}
