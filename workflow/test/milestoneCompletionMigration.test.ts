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
    assert.match(deployment, /现有库只执行尚未应用的迁移/)
    assert.match(deployment, /不得对 migrations\/\*\.sql 做通配循环/)
    assert.match(deployment, /010_aims_milestone_completion_verify\.sql/)
    assert.match(deployment, /verify 必须得到 `PASS`/)
    assert.match(deployment, /set -o pipefail/)
    assert.match(deployment, /mysql --show-warnings[^\n]*013_bounded_delivery_outbox\.sql \|\| exit 1/)
    assert.match(deployment, /mysql --show-warnings[^\n]*014_delivery_recovery_attribution\.sql \|\| exit 1/)
    assert.match(deployment, /013_bounded_delivery_outbox_verify\.sql \\\n\s*\| awk -v expected=4[^\n]*\|\| exit 1/)
    assert.match(deployment, /014_delivery_recovery_attribution_verify\.sql \\\n\s*\| awk -v expected=1[^\n]*\|\| exit 1/)
    const migration013 = deployment.indexOf('mysql --show-warnings -u root -p hzy_workflow < workflow/docs/migrations/013_bounded_delivery_outbox.sql')
    const verification013 = deployment.indexOf('mysql --show-warnings --batch --skip-column-names -u root -p hzy_workflow < workflow/docs/migrations/013_bounded_delivery_outbox_verify.sql')
    const migration014 = deployment.indexOf('mysql --show-warnings -u root -p hzy_workflow < workflow/docs/migrations/014_delivery_recovery_attribution.sql')
    const verification014 = deployment.indexOf('mysql --show-warnings --batch --skip-column-names -u root -p hzy_workflow < workflow/docs/migrations/014_delivery_recovery_attribution_verify.sql')
    assert.ok(migration013 >= 0 && migration013 < verification013)
    assert.ok(verification013 < migration014 && migration014 < verification014)
  })
})
