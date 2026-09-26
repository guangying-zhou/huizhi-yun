// Explicit transport selection for the retained Aims delivery worker. Unknown
// operations fail rather than silently accessing a second persistence source.
export function unifiedIntegrationOperationRoute(path: string, body: Record<string, unknown>) {
  const prefix = '/v1/enterprise/aims/integration-operations:'
  const notificationList = /^\/v1\/aims\/integration-operations:(pending-failure-notifications|pending-dead-letter-actionables|pending-dead-letter-closures)$/.exec(path)
  if (notificationList) return { path: `${prefix}${notificationList[1]}`, body: { ...body } }
  const notificationAck = /^\/v1\/aims\/integration-operations\/([^/?#]+):(failure-notified|dead-letter-actionable-published|dead-letter-closure-acknowledged)$/.exec(path)
  if (notificationAck) {
    const operationId = decodeURIComponent(notificationAck[1]!)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/.test(operationId)) throw new Error('Invalid operation ID.')
    if ('operationId' in body && body.operationId !== operationId) throw new Error('Conflicting operation ID.')
    return { path: `${prefix}${notificationAck[2]}`, body: { ...body, operationId } }
  }
  if (path === '/v1/aims/integration-operations:claim-next') {
    if (Object.keys(body).length) throw new Error('Claim-next does not accept worker or binding overrides.')
    return { path: `${prefix}claim`, body: {} }
  }
  const match = /^\/v1\/aims\/integration-operations\/([^/?#]+):(claim|succeed|fail)$/.exec(path)
  if (!match) throw new Error('Unified integration operation route is not implemented.')
  const operationKey = decodeURIComponent(match[1]!)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$/.test(operationKey)) throw new Error('Invalid operation key.')
  if ('operationKey' in body && body.operationKey !== operationKey) throw new Error('Conflicting operation key.')
  return { path: `${prefix}${match[2]}`, body: { ...body, operationKey } }
}
