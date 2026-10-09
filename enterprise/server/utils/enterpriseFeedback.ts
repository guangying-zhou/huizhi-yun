import type { H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { executeFeedbackRequest } from '../../../console/server/public/feedback'

type HostFeedbackOperation = 'attachment-put' | 'attachment-read' | 'options' | 'draft' | 'submit' | 'list' | 'detail'
export async function enterpriseFeedback(event: H3Event, op: HostFeedbackOperation) {
  const operation = `console.feedback-${op}` as const
  return executeFeedbackRequest(event, op, {
    identity: async () => {
      const user = await requireEnterpriseUser(event)
      await prepareEnterpriseRuntime(event, operation)
      return user
    },
    authorize: (uid, resourceCode, action) => loadScopedAuthorizationFromConsoleRuntime(event, uid, 'console', { resourceCode, action }),
    call: (body, idempotencyKey) => callEnterpriseRuntime(event, operation, body, { idempotencyKey })
  })
}
