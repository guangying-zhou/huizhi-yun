import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serviceRoute = readFileSync(new URL('../server/api/v1/service/codocs-publish-approval.post.ts', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../../data-runtime/internal/apps/workflow/codocs_publish_receipt.go', import.meta.url), 'utf8')

test('Codocs publish command only accepts the fixed service contract and delegated actor', () => {
  assert.match(serviceRoute, /sourceApp !== 'codocs'/)
  assert.match(serviceRoute, /workflow:document-publish:create/)
  assert.match(serviceRoute, /serviceCommandActor:\s*\{ uid: actorUid \}/)
  assert.match(runtime, /ReceiptCommandFromBody\(body, "workflow", codocsPublishWorkflowOperationCode, codocsPublishWorkflowCapability\)/)
  assert.match(runtime, /receiptInput\.TrustedContext\.SourceApp != "codocs"/)
  assert.match(runtime, /fmt\.Sprint\(body\["current_user"\]\)\) != actorUID/)
})

test('Workflow owns Codocs publish target fields and restores the same receipt target on retry', () => {
  assert.match(runtime, /actionDefByKeyOn\(ctx, tx, "codocs", "documents", "publish"\)/)
  assert.match(runtime, /"biz_url": "\/reviews\/" \+ strconv\.FormatInt\(requestID, 10\)/)
  assert.match(runtime, /"callback_url": codocsPublishWorkflowCallback/)
  assert.match(runtime, /if executed\.Existing \{/)
  assert.match(runtime, /WHERE instance_no = \? AND app_code = 'codocs' AND resource_code = 'documents' AND action_code = 'publish'/)
  assert.doesNotMatch(runtime, /command\["bizUrl"\]/)
  assert.doesNotMatch(runtime, /command\["callbackUrl"\]/)
})
