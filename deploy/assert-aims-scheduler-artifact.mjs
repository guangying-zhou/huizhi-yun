import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Nitro serializes private runtimeConfig into its server bundle. Assert the
// actual built value, not a Wrangler var that cannot change the baked value.
export function assertAimsSchedulerArtifact(serverDir, config) {
  if (config.workers_dev !== false || config.preview_urls !== false || config.routes || config.route || config.triggers || config.assets) {
    throw Error('Aims scheduler Worker must have no public ingress, cron or static assets')
  }
  if ('NUXT_HZY_SCHEDULER_ONLY' in (config.vars || {}) || 'HZY_AIMS_SCHEDULER_ONLY' in (config.vars || {})) {
    throw Error('Aims schedulerOnly is build-time runtimeConfig, not a deploy var')
  }
  const modules = readdirSync(serverDir, { recursive: true })
    .filter(file => file.endsWith('.mjs'))
    .map(file => readFileSync(join(serverDir, file), 'utf8'))
  const enabled = modules.filter(code => /\bschedulerOnly\s*:\s*(?:!0|true)\b/.test(code))
  const disabled = modules.filter(code => /\bschedulerOnly\s*:\s*(?:!1|false)\b/.test(code))
  if (enabled.length !== 1 || disabled.length !== 0) {
    throw Error(`Aims schedulerOnly build value invalid: enabled=${enabled.length}, disabled=${disabled.length}`)
  }
}
