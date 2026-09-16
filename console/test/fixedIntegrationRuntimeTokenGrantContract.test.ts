import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const seed = readFileSync(
  new URL('../docs/sql/Console-SQL-Seed-v1.93-fixed-integration-runtime-token-grants.sql', import.meta.url),
  'utf8'
)
const verify = readFileSync(
  new URL('../docs/sql/Console-SQL-Verify-v1.93-fixed-integration-runtime-token-grants.sql', import.meta.url),
  'utf8'
)

describe('fixed integration Runtime token grants', () => {
  test('issues the plural execute capability for both Runtime audiences', () => {
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      const resource = `${audience}:integration_operations`
      assert.match(seed, new RegExp(`'${resource}'(?: AS [^,]+)?\\s*,\\s*'execute'`))
      assert.match(verify, new RegExp(`'${resource}'`))
    }

    for (const appCode of ['aims', 'codocs', 'altoc', 'assets', 'workflow']) {
      assert.match(seed, new RegExp(`'${appCode}'`))
    }
  })

  test('repairs the operation policy instead of overwriting GitLab with WeCom', () => {
    const combinedPolicy = seed.slice(
      seed.indexOf('-- Aims and Codocs consume both GitLab and WeCom fixed operations.'),
      seed.indexOf('-- The remaining consumers use only the two fixed WeCom identity operations.')
    )
    const wecomOnlyPolicy = seed.slice(
      seed.indexOf('-- The remaining consumers use only the two fixed WeCom identity operations.'),
      seed.indexOf('COMMIT;')
    )

    for (const integrationCode of ['gitlab.default', 'wecom.default']) {
      assert.match(combinedPolicy, new RegExp(`'${integrationCode.replace('.', '\\.')}'`))
      assert.match(verify, new RegExp(`'${integrationCode.replace('.', '\\.')}'`))
    }
    for (const operation of [
      'gitlab.project-info',
      'gitlab.markdown-tree',
      'gitlab.file',
      'wecom.oauth-user',
      'wecom.user-detail'
    ]) {
      assert.match(combinedPolicy, new RegExp(`'${operation.replace('.', '\\.')}'`))
    }

    assert.match(combinedPolicy, /sc\.`app_code` IN \('aims', 'codocs'\)/)
    assert.match(wecomOnlyPolicy, /sc\.`app_code` IN \('altoc', 'assets', 'workflow'\)/)
    assert.doesNotMatch(wecomOnlyPolicy, /gitlab\.|'aims'|'codocs'/)
    assert.match(seed, /'integration_operations'(?: AS [^,]+)?\s*,\s*'execute'/)
    assert.match(seed, /ON DUPLICATE KEY UPDATE[\s\S]*`scope_json` = VALUES\(`scope_json`\)/)
    assert.match(seed, /START TRANSACTION;[\s\S]*COMMIT;/)
  })
})
