import { createHash } from 'node:crypto'
export const probeColumns = {
  source: ['operation_id','operation_key','tenant_code','deployment_code','source_app','target_app','operation_code','required_capability','idempotency_key','command_schema_version','command_sha256','status','attempt_count','locked_by','locked_until','target_receipt_id','target_biz_type','target_biz_code','response_summary_sha256'],
  receipt: ['receipt_id','operation_id','tenant_code','source_deployment_code','deployment_code','source_app','target_app','operation_code','required_capability','idempotency_key','command_schema_version','command_sha256','status','locked_by','locked_until','target_biz_type','target_biz_code','response_summary_sha256'],
  notification: ['id','notification_id','channel','provider','status','attempt_count']
}
export function hashProbeRows(rows) {
  const hash = createHash('sha256')
  const number = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(value)); hash.update(bytes) }
  for (const row of rows) { number(row.length); for (const value of row) { if (value === null) hash.update(Buffer.from([0])); else { const bytes=Buffer.from(String(value)); hash.update(Buffer.from([1])); number(bytes.length); hash.update(bytes) } } }
  return hash.digest('hex')
}
const ident = value => { if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw Error('Invalid registered schema'); return `\`${value}\`` }
export function probeSql(kind, schema) {
  const columns = probeColumns[kind]
  if (!columns) throw Error('Unsupported receipt probe')
  const table = kind === 'source' ? 'integration_operation' : kind === 'receipt' ? 'service_command_receipt' : 'portal_notification_deliveries'
  // Cast to stable strings before hashing; credentials and response bodies are absent.
  return `SELECT ${columns.map(column => `CAST(${kind === 'notification' ? 'd.' : ''}\`${column}\` AS CHAR)`).join(',')} FROM ${ident(schema)}.\`${table}\`${kind === 'receipt' ? " WHERE tenant_code=? AND source_app IN ('aims','assets')" : kind === 'notification' ? ` d JOIN ${ident(schema)}.portal_notifications n ON n.notification_id=d.notification_id WHERE n.source_app_code IN ('aims','assets')` : ''} ORDER BY ${kind === 'source' ? 'operation_id' : kind === 'receipt' ? 'receipt_id' : 'd.id'}`
}
export async function collectProviderReceipts(connection, binding) {
  if (binding.tenant !== 'C000001' || binding.environment !== 'test') throw Error('Exact test identity required')
  const [[instance]] = await connection.query('SELECT @@server_uuid instanceId')
  if (instance.instanceId !== binding.instanceId) throw Error('Provider instance mismatch')
  const probes = [], entries = []
  const records = (probe, rows) => rows.map(row => Object.fromEntries(probeColumns[probe.kind].map((column,index) => [column,row[index]])))
  const datasets = new Map()
  for (const definition of [...binding.sources.map(source => ({ ...source, kind: 'source' })), ...binding.providers.map(provider => ({ ...provider, kind: provider.app === 'console' ? 'notification' : 'receipt' }))]) {
    const probe = { kind: definition.kind, app: definition.app, schema: definition.schema, deployment: definition.deployment }
    ident(probe.schema)
    let rows
    try { [rows] = await connection.query({ sql: probeSql(probe.kind,probe.schema), rowsAsArray:true }, probe.kind === 'receipt' ? [binding.tenant] : []) }
    catch (error) { if (!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR','ER_TABLEACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR'].includes(error.code)) throw error; probe.unavailable=error.code; probes.push(probe); entries.push({ id:`coverage:${probe.kind}:${probe.app}`, classification:'manual-required', reason:probe.unavailable }); continue }
    probe.count=rows.length; probe.hash=hashProbeRows(rows); probe.rows=rows; probes.push(probe); datasets.set(`${probe.kind}:${probe.app}`,records(probe,rows))
  }
  const derived = classifyProviderEvidence(binding, probes)
  return { schemaVersion:'enterprise-provider-receipts.v1', binding, probes, entries:derived, automaticCount:derived.filter(entry=>entry.classification==='automatic').length, manualCount:derived.filter(entry=>entry.classification==='manual-required').length, blockedCount:derived.filter(entry=>entry.classification==='blocked').length, ready:false }
}

export function classifyProviderEvidence(binding, probes) {
  const entries=[], datasets=new Map()
  for (const probe of probes) {
    if(probe.unavailable) { entries.push({id:`coverage:${probe.kind}:${probe.app}`,classification:['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(probe.unavailable)?'manual-required':'blocked',reason:probe.unavailable}); continue }
    if(!Array.isArray(probe.rows)||probe.count!==probe.rows.length||probe.hash!==hashProbeRows(probe.rows))throw Error('Probe rows/hash mismatch')
    datasets.set(`${probe.kind}:${probe.app}`,probe.rows.map(row=>Object.fromEntries(probeColumns[probe.kind].map((column,index)=>[column,row[index]]))))
  }
  for (const source of binding.sources) {
    for (const operation of datasets.get(`source:${source.app}`) || []) {
      const id=`operation:${source.app}:${operation.operation_id}`
      if (operation.tenant_code !== binding.tenant || operation.deployment_code !== source.deployment || operation.source_app !== source.app || !['succeeded','cancelled'].includes(operation.status) || operation.locked_by || operation.locked_until) { entries.push({id,classification:'blocked',reason:'source-not-terminal-or-identity-mismatch'}); continue }
      const provider=binding.providers.find(value=>value.app===operation.target_app)
      const receipts=(datasets.get(`receipt:${operation.target_app}`)||[]).filter(receipt=>receipt.operation_id===operation.operation_id)
      const matches=receipts.filter(receipt=>provider && receipt.tenant_code===binding.tenant && receipt.source_deployment_code===source.deployment && receipt.deployment_code===provider.deployment && ['source_app','target_app','operation_code','required_capability','idempotency_key','command_schema_version','command_sha256'].every(column=>receipt[column]===operation[column]))
      const receipt=matches[0]
      if (matches.length===1 && receipts.length===1 && operation.status==='succeeded' && receipt.status==='succeeded' && !receipt.locked_by && !receipt.locked_until && receipt.receipt_id===operation.target_receipt_id && ['target_biz_type','target_biz_code','response_summary_sha256'].every(column=>receipt[column] && receipt[column]===operation[column])) entries.push({id,classification:'automatic',reason:'exact-durable-provider-receipt',receiptId:receipt.receipt_id,commandSha256:operation.command_sha256})
      else entries.push({id,classification:receipts.length ? 'blocked' : 'manual-required',reason:receipts.length ? 'provider-receipt-mismatch-or-nonterminal' : 'provider-receipt-unavailable-or-send-outcome-unknown',commandSha256:operation.command_sha256})
    }
  }
  for (const notification of datasets.get('notification:console') || []) {
    entries.push({id:`notification:${notification.id}`,classification:notification.channel==='in_app' && notification.status==='success' ? 'automatic' : 'manual-required',reason:notification.channel==='in_app' && notification.status==='success' ? 'durable-in-app-delivery' : 'provider-delivery-not-proven-by-local-status',notificationId:notification.notification_id,channel:notification.channel,status:notification.status})
  }
  const observations=binding.observations
  const workers=observations?.workers || []
  for(const app of binding.unconfiguredProviders || []) {
    const hasTarget=binding.sources.some(source=>(datasets.get(`source:${source.app}`)||[]).some(operation=>operation.target_app===app))
    const disabled=workers.length===2 && workers.every(worker=>worker.providerUrls?.[`HZY_${app.toUpperCase()}_API_URL`]===`https://hzy-test.huizhi.yun/${app}` && !worker.services.some(service=>service.service===`hzy-test-${app}`)) && observations.routes?.some(route=>route.app===app&&route.explicitDisabled) && !observations.runtime?.appEnabled?.[app]
    entries.push({id:`coverage:unconfigured-provider:${app}`,classification:!hasTarget&&disabled?'not-applicable':'manual-required',reason:!hasTarget&&disabled?'no-frozen-target-and-observed-path-disabled':'no-trusted-local-provider-binding'})
  }
  entries.push({id:'coverage:deployed-worker-versions-and-direct-bindings',classification:workers.length===2&&workers.some(worker=>!worker.drainBoundaryBound)?'blocked':'manual-required',reason:workers.length===2&&workers.some(worker=>!worker.drainBoundaryBound)?'actual-worker-boundary-not-deployed':'registered-artifact-coverage-evidence-required'})
  entries.push({id:'coverage:pre-wrapper-inflight-history',classification:'manual-required',reason:'historical-external-send-outcomes-require-evidence'})
  entries.push({id:'coverage:runtime-direct-callers',classification:observations?.runtime?.tenant===binding.tenant&&observations.runtime.deployment===binding.runtimeDeployment?'automatic':'manual-required',reason:observations?.runtime?.tenant===binding.tenant&&observations.runtime.deployment===binding.runtimeDeployment?'actual-runtime-bindings-observed-source-DML-still-rechecked-by-fence':'runtime-binding-evidence-unavailable'})
  entries.push({id:'coverage:external-notification-providers',classification:'manual-required',reason:'provider-history-not-implied-by-local-delivery-count'})
  entries.push({id:'coverage:scheduled-consumers-and-other-app-outboxes',classification:workers.length===2&&workers.every(worker=>Array.isArray(worker.schedules?.schedules)&&worker.schedules.schedules.length===0)?'automatic':'manual-required',reason:workers.length===2&&workers.every(worker=>Array.isArray(worker.schedules?.schedules)&&worker.schedules.schedules.length===0)?'actual-app-CF-crons-empty-other-callers-retained-in-boundary-coverage':'actual-scheduler-inventory-required'})
  return entries
}
