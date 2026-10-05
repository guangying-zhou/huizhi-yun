#!/usr/bin/env node
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, INPUT_SCHEMA, OBSERVATION_SCHEMA } from '../evidence.mjs'
import { writeProtectedNew } from '../protected-files.mjs'

export function makeFixture(directory, clockMs = Date.now()) {
  const at = minutes => new Date(clockMs + minutes * 60_000).toISOString()
  const binding = { tenant: 'C000001', environment: 'test', cutoverKey: 'SYNTHETIC-ONLY', targetGeneration: '1', instanceId: 'synthetic-instance', runtimeDeployment: 'synthetic-runtime' }
  const rows = [{ schema: 'hzy_aims', table: 'work_items', count: '2', checksum: '123' }]
  const observation = (kind, minute, result) => ({ schemaVersion: OBSERVATION_SCHEMA, binding, kind, observedStart: at(minute), observedEnd: at(minute), collector: 'synthetic-fixture', result })
  const source = minute => ({ tables: structuredClone(rows) })
  const observations = [
    observation('c2-source-first', -12, source()), observation('c2-source-second', -7, source()),
    observation('dump-link', -6, { sha256: 'a'.repeat(64) }), observation('provider-report', -5, { sha256: 'b'.repeat(64) }),
    observation('p-gateway', -2, { routeDisabled: true, workerDisabled: true, routeId: 'fixture-route', workerVersion: 'fixture-version' }),
    observation('p-runtime', -2, { serviceInactive: true, timerInactive: true, unit: 'fixture.service', timer: 'fixture.timer' }),
    observation('p-source', -2, source()),
    observation('p-nginx', -2, { maintenanceConfig: true, maintenanceResponse: true, serverName: 'fixture.invalid' })
  ]
  const input = { schemaVersion: INPUT_SCHEMA, phase: 'p', binding, files: observations.map(item => ({ kind: item.kind, name: `${item.kind}.json` })), approval: null }
  for (const item of observations) writeProtectedNew(join(directory, `${item.kind}.json`), canonicalJson(item))
  writeProtectedNew(join(directory, 'manifest.json'), canonicalJson(input))
  return { count: observations.length, phase: 'p' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { process.stderr.write('EVIDENCE_FIXTURE_USAGE\n'); process.exitCode = 1 }
  else {
    try { process.stdout.write(`${canonicalJson(makeFixture(resolve(process.argv[2])))}`) }
    catch { process.stderr.write('EVIDENCE_FIXTURE_FAILED\n'); process.exitCode = 1 }
  }
}
