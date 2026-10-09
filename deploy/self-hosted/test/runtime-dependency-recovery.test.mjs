import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const root = new URL('../systemd/', import.meta.url)
const apps = ['console', 'enterprise', 'workflow', 'aims', 'codocs', 'collab']
test('Runtime starts dependents and explicit restarts propagate while strict requirements remain', () => {
  const runtime = readFileSync(new URL('hzy-data-runtime.override.conf.example', root), 'utf8')
  for (const app of [...apps, 'tenant-gateway']) assert.match(runtime, new RegExp(`hzy-${app}\\.service`))
  for (const app of apps) {
    const unit = readFileSync(new URL(`hzy-${app}.service`, root), 'utf8')
    assert.match(unit, /^Requires=hzy-data-runtime.service$/m)
    assert.match(unit, /^PartOf=hzy-data-runtime.service$/m)
    assert.match(unit, /^Restart=on-failure$/m)
    assert.match(unit, /^ExecStartPre=.*verify.mjs/m)
  }
  const gateway = readFileSync(new URL('hzy-tenant-gateway.override.conf.example', root), 'utf8')
  assert.match(gateway, /^Requires=hzy-data-runtime.service$/m)
  assert.match(gateway, /^PartOf=hzy-data-runtime.service$/m)
})
