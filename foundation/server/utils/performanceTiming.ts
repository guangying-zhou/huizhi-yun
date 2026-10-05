import { appendResponseHeader, type H3Event } from 'h3'
import { cloudflareEnvFromEvent } from './consoleServiceBinding'

// Explicit diagnostics only. Emit durations, never identities, URLs or tokens.
export async function measureRequestStage<T>(event: H3Event, stage: string, run: () => Promise<T>): Promise<T> {
  if (cloudflareEnvFromEvent(event).HZY_PERF_TIMING_ENABLED !== 'true') return run()
  const start = performance.now()
  try {
    return await run()
  } finally {
    appendResponseHeader(event, 'server-timing', `${stage};dur=${(performance.now() - start).toFixed(1)}`)
  }
}
