import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function source(path: string) {
  return readFileSync(`${root}/${path}`, 'utf8')
}

test('Aims Cloudflare config binds every cross-app delivery target', () => {
  const render = source('scripts/render-cloudflare-config.mjs')
  const bindings = [
    ['HZY_ALTOC_SERVICE', 'HZY_ALTOC_WORKER_NAME', 'hzy-altoc'],
    ['HZY_ASSETS_SERVICE', 'HZY_ASSETS_WORKER_NAME', 'hzy-assets'],
    ['HZY_PEOPLE_SERVICE', 'HZY_PEOPLE_WORKER_NAME', 'hzy-people'],
    ['HZY_FINANCE_SERVICE', 'HZY_FINANCE_WORKER_NAME', 'hzy-finance'],
    ['HZY_CODOCS_SERVICE', 'HZY_CODOCS_WORKER_NAME', 'hzy-codocs']
  ]

  for (const [binding, workerEnv, defaultWorker] of bindings) {
    assert.ok(render.includes(`binding: '${binding}'`), `${binding} must be declared`)
    assert.ok(
      render.includes(`service: value('${workerEnv}', '${defaultWorker}')`),
      `${binding} must resolve its deployed Worker name`
    )
  }
})

test('Aims delivery operations use target Service Bindings and trusted target context', () => {
  const delivery = source('server/utils/serviceTicketDeliveryOperation.ts')
  const targets = Array.from(
    delivery.matchAll(/serviceAppFetch<RuntimeEnvelope<RuntimeRow>>\(\s*event,\s*'(altoc|people|codocs)'/g),
    match => match[1]
  )

  assert.deepEqual(targets, ['altoc', 'altoc', 'people', 'codocs'])
  for (const target of ['altoc', 'people', 'codocs']) {
    assert.ok(
      delivery.includes(`forwardedContextHeaders(event, '${target}', idempotencyKey)`),
      `${target} requests must rewrite app, deployment and prefix for the target`
    )
  }
  assert.match(delivery, /trustedServiceRequestHeaders\(event, targetAppCode\)/)
  assert.match(delivery, /buildServiceCommandRuntimeHeaders/)
  assert.match(delivery, /const sourceDeploymentCode = text\(operation\.deploymentCode\)/)
  assert.match(delivery, /targetDeploymentCode/)
  assert.match(delivery, /'x-request-id': requestId/)
  assert.match(delivery, /callAltocDeliveryService\(null,/)
  assert.match(delivery, /callAltocReceivableService\(null,/)
  assert.match(delivery, /callPeopleContributionService\(null,/)
  assert.match(delivery, /callCodocsOperationService\(\s*null,/)
  assert.match(delivery, /targetDeployments\.codocs/)
  assert.doesNotMatch(delivery, /\$fetch/)
})

test('Aims Assets calls use the Assets binding and target-bound headers', () => {
  const paths = [
    'server/utils/projectEnvironmentAssetsSync.ts',
    'server/api/v1/projects/[id]/environments/upsert.post.ts',
    'server/api/v1/product-assets.get.ts'
  ]

  for (const path of paths) {
    const content = source(path)
    assert.match(content, /serviceAppFetch<[\s\S]*?>\(\s*event,\s*'assets'/)
    assert.match(content, /trustedServiceRequestHeaders\(event, 'assets'\)/)
    assert.doesNotMatch(content, /\$fetch/)
  }
})

test('cost rules use Finance transport in request and scheduled IO with explicit deployment', () => {
  const delivery = source('server/utils/serviceTicketDeliveryOperation.ts')
  assert.match(delivery, /sendProductCostRules\(event, operation, command\)/)
  assert.match(delivery, /sendProductCostRules\(null, operation, command, targetDeployments\.finance \|\| ''\)/)
  assert.match(source('server/utils/integrationOperationDrain.ts'), /finance: binding\.financeTargetDeployment/)
  assert.match(source('server/utils/scheduledRuntime.ts'), /financeTargetDeployment = envValue\(\['HZY_FINANCE_TARGET_DEPLOYMENT'\]\)/)
})
