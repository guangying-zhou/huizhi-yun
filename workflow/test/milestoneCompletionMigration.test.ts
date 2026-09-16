import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const migration = readFileSync(
  new URL('../docs/migrations/010_aims_milestone_completion.sql', import.meta.url),
  'utf8'
)
const verification = readFileSync(
  new URL('../docs/migrations/010_aims_milestone_completion_verify.sql', import.meta.url),
  'utf8'
)
const deployment = readFileSync(new URL('../docs/DEPLOYMENT.md', import.meta.url), 'utf8')

describe('Aims milestone completion Workflow migration', () => {
  it('creates the action definition, flow schema, and active default route', () => {
    assert.match(migration, /'aims_milestone_completion'/)
    assert.match(migration, /'aims'[\s\S]*'milestones'[\s\S]*'milestone_completion'/)
    assert.match(migration, /INSERT INTO flow_routes/)
    assert.match(migration, /is_default[\s\S]*status/)
  })

  it('fails closed when any required Workflow configuration is missing', () => {
    assert.match(verification, /CHECK \(passed = 1\)/)
    assert.match(verification, /active_action_definition/)
    assert.match(verification, /active_flow_schema/)
    assert.match(verification, /active_default_route/)
    assert.match(verification, /COUNT\(\*\) = 1/)
  })

  it('requires migrations and their verification scripts during deployment', () => {
    assert.match(deployment, /workflow\/docs\/migrations\/\*\.sql/)
    assert.match(deployment, /mysql --show-warnings[\s\S]*\|\| exit 1/)
    assert.match(deployment, /010_aims_milestone_completion_verify\.sql/)
  })
})
