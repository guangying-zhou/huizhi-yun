import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../manual-workflow-drain.mjs', import.meta.url), 'utf8')

test('the one-shot Aims wake runs only for exactly the listed pending completion operations', () => {
  assert.match(source, /operation: \{ type: 'string', multiple: true \}/)
  // The pending queue must equal the preflighted set: same size, every row listed and pending.
  assert.match(source, /queue\.length === operationIds\.length && queue\.every\(row => operationIds\.includes/)
  assert.match(source, /row\.status === 'pending' && row\.target_app === 'workflow' && row\.operation_code === 'aims\.work-item\.completion\.workflow-submit\.v1'/)
  assert.match(source, /new Set\(operationIds\)\.size !== operationIds\.length/)
  assert.match(source, /emptyProbe \? queue\.length !== 0 : !approvedQueue/)
})
