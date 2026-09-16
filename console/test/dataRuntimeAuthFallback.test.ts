import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../server/utils/dataRuntimeManagement.ts', import.meta.url),
  'utf8'
)
const issuerSource = readFileSync(
  new URL('../server/plugins/service-token-issuer.ts', import.meta.url),
  'utf8'
)

test('data runtime audience fallback never hides the configured-audience failure', () => {
  const start = source.indexOf('async function fetchRuntimeManagement<')
  const end = source.indexOf('\nexport async function resolveDataRuntimeParameters', start)
  const managementBlock = start >= 0 && end > start ? source.slice(start, end) : ''

  assert.match(managementBlock, /let firstError: unknown = null/)
  assert.match(managementBlock, /firstError \|\|= error/)
  assert.match(managementBlock, /const surfacedError = firstError \|\| error/)
  assert.match(managementBlock, /errorMessage\(surfacedError\)/)
})

test('data runtime update retries with the gateway-bound runtime deployment for legacy agents', () => {
  const start = source.indexOf('async function fetchRuntimeManagement<')
  const end = source.indexOf('\nexport async function resolveDataRuntimeParameters', start)
  const managementBlock = start >= 0 && end > start ? source.slice(start, end) : ''

  assert.match(managementBlock, /runtimeDeployment\?: string \| null/)
  assert.match(
    managementBlock,
    /if \(!staticToken && runtimeDeployment && input\.preferRuntimeDeployment\)/
  )
  assert.match(managementBlock, /resolveRuntimeBearerToken\(event, audience, runtimeDeployment\)/)
  assert.match(source, /runtimeDeployment: overview\.runtime\.deployment/)
  assert.match(source, /preferRuntimeDeployment: overview\.runtime\.version === '0\.3\.103'/)
  assert.match(issuerSource, /scope === 'data-runtime:runtime:update'/)
  assert.match(issuerSource, /\? 'runtime\.update'/)
})

test('data runtime discovery headers require the authenticated tenant gateway', () => {
  assert.match(
    source,
    /import \{ isTrustedTenantGatewayRequest \} from '~~\/server\/utils\/platformRuntime'/
  )
  assert.doesNotMatch(
    source,
    /function isTrustedTenantGatewayRequest\(event: H3Event\)/
  )
})

test('Platform Runtime bootstrap JWT is exchanged instead of sent to the update endpoint', () => {
  const start = source.indexOf('function resolveRuntimeStaticToken(')
  const end = source.indexOf('\nasync function resolveRuntimeBearerToken', start)
  const staticTokenBlock = start >= 0 && end > start ? source.slice(start, end) : ''

  assert.match(
    source,
    /import \{ isPlatformRuntimeBootstrapToken \} from '@hzy\/foundation\/server\/utils\/tenantRuntimeClient'/
  )
  assert.match(staticTokenBlock, /isPlatformRuntimeBootstrapToken\(gatewayToken\)/)
  assert.match(staticTokenBlock, /return ''/)
})
