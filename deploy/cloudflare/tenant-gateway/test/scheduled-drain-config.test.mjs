import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const workspace = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))

function render(appCode, output, env = {}) {
  const prefix = appCode.toUpperCase()
  return spawnSync(process.execPath, [`${appCode}/scripts/render-cloudflare-config.mjs`], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      [`HZY_${prefix}_WRANGLER_OUTPUT`]: output,
      [`HZY_${prefix}_SCHEDULED_DRAIN_ENABLED`]: 'false',
      ...env
    }
  })
}

test('business drain crons are default-off for shared workers and require explicit binding', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hzy-drain-config-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const aimsDefault = join(dir, 'aims-default.jsonc')
  const altocDefault = join(dir, 'altoc-default.jsonc')
  assert.equal(render('aims', aimsDefault).status, 0)
  assert.equal(render('altoc', altocDefault).status, 0)
  assert.deepEqual(JSON.parse(readFileSync(aimsDefault, 'utf8')).triggers.crons, ['15 2 * * *'])
  assert.equal(JSON.parse(readFileSync(altocDefault, 'utf8')).triggers, undefined)

  const invalid = render('altoc', join(dir, 'invalid.jsonc'), {
    HZY_ALTOC_SCHEDULED_DRAIN_ENABLED: 'true',
    HZY_TENANT_RUNTIME_URL: '',
    HZY_DATA_RUNTIME_URL: '',
    HZY_TENANT_RUNTIME_TENANT: '',
    HZY_DATA_RUNTIME_TENANT: '',
    HZY_TENANT_RUNTIME_DEPLOYMENT: '',
    HZY_DATA_RUNTIME_DEPLOYMENT: ''
  })
  assert.notEqual(invalid.status, 0)
  assert.match(`${invalid.stdout}\n${invalid.stderr}`, /requires explicit binding vars/)

  const boundOutput = join(dir, 'altoc-bound.jsonc')
  const bound = render('altoc', boundOutput, {
    HZY_ALTOC_SCHEDULED_DRAIN_ENABLED: 'true',
    HZY_TENANT_RUNTIME_URL: 'https://runtime.example.test',
    HZY_TENANT_RUNTIME_TENANT: 'tenant-test',
    HZY_TENANT_RUNTIME_DEPLOYMENT: 'deployment-test',
    HZY_ALTOC_SERVICE_CLIENT_ID: 'altoc.runtime'
  })
  assert.equal(bound.status, 0, `${bound.stdout}\n${bound.stderr}`)
  const config = JSON.parse(readFileSync(boundOutput, 'utf8'))
  assert.deepEqual(config.triggers.crons, ['*/5 * * * *'])
  assert.equal(config.vars.HZY_TENANT_RUNTIME_TENANT, 'tenant-test')
  assert.equal(config.vars.HZY_TENANT_RUNTIME_DEPLOYMENT, 'deployment-test')
  assert.equal(config.vars.HZY_ALTOC_SERVICE_CLIENT_ID, 'altoc.runtime')
  assert.equal(Object.keys(config.vars).some(key => /RUNTIME_TOKEN|CLIENT_SECRET/.test(key)), false)
})
