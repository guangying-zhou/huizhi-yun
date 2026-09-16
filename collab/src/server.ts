import 'dotenv/config'
import { startCollabRuntime } from './runtime.js'

try {
  await startCollabRuntime({
    runtimeMode: 'standalone',
    stopOnSignals: true
  })
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[collab] failed to start: ${message}`)
  process.exit(1)
}
