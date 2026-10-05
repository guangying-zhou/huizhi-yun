import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('PM2 env parser restores escaped JSON and multiline values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hzy-console-pm2-env-'))
  const envFile = join(directory, '.env.test')
  writeFileSync(envFile, [
    'JSON_TOKEN="{\\"schemaVersion\\":\\"license-token.v1\\"}"',
    'PUBLIC_KEY="line-1\\nline-2"',
    'PLAIN_VALUE=plain',
    ''
  ].join('\n'))

  const ecosystemFile = fileURLToPath(new URL('../ecosystem.config.cjs', import.meta.url))
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      'const config = require(process.argv[1]); process.stdout.write(JSON.stringify(config.apps[0].env))',
      ecosystemFile
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HZY_CONSOLE_ENV_FILE: envFile,
        HZY_CONSOLE_PM2_NAME: 'hzy-console-env-parser-test'
      }
    }
  )
  const parsed = JSON.parse(output) as Record<string, string>

  assert.equal(parsed.JSON_TOKEN, '{"schemaVersion":"license-token.v1"}')
  assert.equal(parsed.PUBLIC_KEY, 'line-1\nline-2')
  assert.equal(parsed.PLAIN_VALUE, 'plain')
})
