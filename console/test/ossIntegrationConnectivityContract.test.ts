import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const consoleSource = readFileSync(
  new URL('../server/utils/integrations.ts', import.meta.url),
  'utf8'
)
const runtimeSource = readFileSync(
  new URL('../../data-runtime/internal/apps/console/integrations.go', import.meta.url),
  'utf8'
)

test('OSS connectivity check is executed inside tenant runtime with a fixed signed request', () => {
  assert.match(
    runtimeSource,
    /summary\["checkMode"\] = "oss_list"[\s\S]*checkOSSConnectivity/
  )
  assert.match(runtimeSource, /base\.RawQuery = "max-keys=1"/)
  assert.match(runtimeSource, /canonical := "GET\\n\\n\\n" \+ date \+ "\\n\/" \+ bucket \+ "\/"/)
  assert.match(runtimeSource, /request\.Header\.Set\("Authorization", "OSS "\+accessKeyID/)
  assert.doesNotMatch(consoleSource, /new OSS|\.listV2?\(/)
})
