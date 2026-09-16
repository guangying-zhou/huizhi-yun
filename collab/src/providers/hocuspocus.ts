import { Redis } from '@hocuspocus/extension-redis'
import { Server } from '@hocuspocus/server'
import type { Extension } from '@hocuspocus/server'
import IORedis from 'ioredis'
import type { CollabConfig } from '../config.js'
import { AuthenticationExtension } from '../extensions/authentication.js'
import { PersistenceExtension } from '../extensions/persistence.js'
import { RuntimeHttpExtension } from '../extensions/runtime-http.js'
import { configureCodocsRuntime } from '../utils/codocs-runtime.js'
import type { CollabProvider, CollabRuntimeStatus } from './types.js'

export function createHocuspocusProvider(config: CollabConfig): CollabProvider {
  let redisStatus = 'disabled'
  const startedAt = new Date().toISOString()
  let server: Server | null = null
  let redisClient: IORedis | null = null
  const persistenceStatus = () => ({
    ossConfigured: Boolean(config.oss.accessKeyId && config.oss.accessKeySecret && config.oss.bucketName && config.oss.endpoint),
    integrationCode: config.oss.integrationCode,
    defaultBucket: config.oss.bucketName || undefined,
    projectsBucket: config.oss.projectsBucketName || config.oss.bucketName || undefined,
    imagesBucket: config.oss.imagesBucketName || config.oss.bucketName || undefined
  })

  const getStatus = (): CollabRuntimeStatus => ({
    appCode: config.appCode,
    provider: 'hocuspocus',
    runtimeMode: config.runtimeMode,
    port: config.port,
    address: config.address,
    basePath: config.basePath,
    startedAt,
    codocsRuntime: {
      endpointConfigured: Boolean(config.codocsRuntime.endpoint),
      endpoint: config.codocsRuntime.endpoint || undefined
    },
    redisStatus,
    persistence: persistenceStatus()
  })

  const startRedis = async (extensions: Extension[]) => {
    if (config.redis.disabled) {
      redisStatus = 'disabled by REDIS_DISABLED=true'
      console.log('[collab] Redis extension disabled by REDIS_DISABLED=true')
      return
    }

    redisClient = new IORedis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      lazyConnect: true,
      connectTimeout: config.redis.connectTimeout,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy: () => null
    })

    redisClient.on('error', (error) => {
      console.error('[collab] Redis error:', error.message)
    })

    try {
      await redisClient.connect()
      await redisClient.ping()

      redisStatus = `${config.redis.host}:${config.redis.port}`
      console.log(`[collab] Redis connected: ${redisStatus}`)

      extensions.unshift(
        new Redis({
          redis: redisClient,
          identifier: 'collab'
        })
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      redisStatus = `disabled (fallback: ${message})`
      console.warn(`[collab] Redis unavailable, continue without Redis extension: ${message}`)

      try {
        await redisClient.quit()
      } catch {
        redisClient.disconnect()
      }
      redisClient = null
    }
  }

  return {
    name: 'hocuspocus',
    config,
    getStatus,
    async start() {
      configureCodocsRuntime(config.codocsRuntime)

      const extensions: Extension[] = [
        new RuntimeHttpExtension(config.basePath, getStatus),
        new AuthenticationExtension(),
        new PersistenceExtension(config.oss)
      ]

      await startRedis(extensions)

      server = new Server({
        port: config.port,
        address: config.address,
        stopOnSignals: config.stopOnSignals,
        debounce: 2000,
        maxDebounce: 10000,
        unloadImmediately: false,
        extensions,
        async onConnect(data) {
          console.log(`[collab] Client connected: ${data.documentName}`)
          return Promise.resolve()
        },
        async onDisconnect(data) {
          console.log(`[collab] Client disconnected: ${data.documentName}`)
        },
        async onStoreDocument(data) {
          console.log(`[collab] Document stored: ${data.documentName}`)
        },
        async onListen(data) {
          console.log(`[collab] runtime listening on ${data.port} (provider=hocuspocus, redis=${redisStatus})`)
        }
      })

      await server.listen()
    },
    async stop() {
      if (server) {
        await server.destroy()
        server = null
      }
      if (redisClient) {
        await redisClient.quit()
        redisClient = null
      }
    }
  }
}
