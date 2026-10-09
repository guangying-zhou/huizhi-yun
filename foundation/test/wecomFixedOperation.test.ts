import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const foundation = readFileSync(
  new URL('../server/utils/wecomIntegration.ts', import.meta.url),
  'utf8'
)

describe('WeCom fixed Tenant Runtime operations', () => {
  test('keeps public OAuth metadata but never returns a credential or access token', () => {
    assert.match(foundation, /getWecomOAuthIntegrationConfig/)
    assert.match(foundation, /integration_operations:execute/)
    assert.match(foundation, /wecom\/\$\{operation\}/)
    assert.match(foundation, /getWecomOAuthUser/)
    assert.match(foundation, /getWecomUserProfile/)
    assert.doesNotMatch(
      foundation,
      /getWecomRuntimeConfig|resolveIntegrationSecret|corpsecret|access_token|PRIVATE-TOKEN/
    )
  })

  test('business adapters do not reconstruct direct WeCom calls', () => {
    for (const modulePath of [
      '../../aims/server/utils/wecom.ts',
      '../../codocs/server/utils/wecom.ts',
      '../../altoc/server/utils/wecom.ts',
      '../../assets/server/utils/wecom.ts',
      '../../workflow/server/utils/wecom.ts'
    ]) {
      const source = readFileSync(new URL(modulePath, import.meta.url), 'utf8')
      assert.match(source, /getWecomOAuthUser|getWecomUserProfile/)
      assert.doesNotMatch(source, /access_token|getWecomIntegrationAccessToken|getWecomIntegrationConfig/)
    }
  })
})
