import { randomUUID } from 'node:crypto'
import { sendRedirect, setHeader, type H3Event } from 'h3'
import { resolveCurrentAppUrl } from '@hzy/foundation/server/utils/appUrls'
import { loginFailureReason } from '../../shared/utils/loginFailure'

/** Browser callback only. Token/API failures retain their JSON contracts. */
export function redirectLoginFailure(event: H3Event, error: unknown) {
  const requestId = randomUUID()
  const reason = loginFailureReason(error)
  setHeader(event, 'x-request-id', requestId)
  setHeader(event, 'cache-control', 'no-store')
  console.warn('[Login Denied]', { requestId, reason })
  const query = new URLSearchParams({ login_failure: reason, request_id: requestId, prompt: 'login' })
  return sendRedirect(event, `${resolveCurrentAppUrl(event, '/login')}?${query}`, 303)
}
