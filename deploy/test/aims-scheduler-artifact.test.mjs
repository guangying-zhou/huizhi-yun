import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { schedulerWorkerConfig } from '../../aims/deploy/cloudflare/scheduler-worker-config.mjs'
import { assertAimsSchedulerArtifact } from '../assert-aims-scheduler-artifact.mjs'

test('sixth artifact requires baked schedulerOnly and no runtime override or assets', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hzy-aims-scheduler-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'chunks'))
  const bundle = join(dir, 'chunks/nitro.mjs')
  const config = schedulerWorkerConfig('production')
  writeFileSync(bundle, 'const runtimeConfig={hzy:{schedulerOnly:!0}}')
  assert.doesNotThrow(() => assertAimsSchedulerArtifact(dir, config))
  writeFileSync(bundle, 'const runtimeConfig={hzy:{schedulerOnly:!1}}')
  assert.throws(() => assertAimsSchedulerArtifact(dir, config), /schedulerOnly build value invalid/)
  writeFileSync(bundle, 'const runtimeConfig={hzy:{schedulerOnly:!0}}')
  assert.throws(() => assertAimsSchedulerArtifact(dir, { ...config, assets: { directory: '.output/public' } }), /no public ingress/)
  assert.throws(() => assertAimsSchedulerArtifact(dir, { ...config, vars: { ...config.vars, NUXT_HZY_SCHEDULER_ONLY: 'false' } }), /build-time runtimeConfig/)
})
