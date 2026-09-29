import { verifyActivityResolution } from './activity-verifier.mjs'
import { verifyActivationEnvelope } from './activation-verifier.mjs'
// Internal-only Durable Object. No TTL turns an unfinished request into drained.
const json = (data, status = 200) => Response.json(data, { status })
export class TestDrainCoordinator {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.sql = state.storage.sql
    this.sql.exec("CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,mode TEXT NOT NULL,contract TEXT NOT NULL)")
    this.sql.exec("CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,actor TEXT NOT NULL,admitted_revision INTEGER NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,detail TEXT)")
    this.sql.exec("CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT NOT NULL)")
  }
  rows(query, ...args) { return [...this.sql.exec(query, ...args)] }
  transaction(fn) { return this.state.storage.transactionSync(fn) }
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (this.env.HZY_DRAIN_CONTROL_TOKEN && this.env.HZY_DRAIN_CONTROL_TOKEN === this.env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN) return json({ error: 'control_credential_isolation_required' }, 503)
    const requiredToken = ['/begin', '/finish'].includes(path) ? this.env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN : this.env.HZY_DRAIN_CONTROL_TOKEN
    if (!requiredToken || request.headers.get('authorization') !== `Bearer ${requiredToken}`) return json({ error: 'unauthorized' }, 401)
    let body
    try { body = await request.json() } catch { return json({ error: 'invalid_json' }, 400) }
    if (!body || body.tenant !== 'C000001' || body.environment !== 'test') return json({ error: 'identity_mismatch' }, 403)
    try {
      let activation
      if (path === '/release') {
        try { activation = await verifyActivationEnvelope(body.activation, this.env) } catch { return json({ error: 'verified_activation_required' }, 409) }
      }
      if (path === '/reconcile') {
        try { activation = await verifyActivityResolution(body.resolution, this.env) } catch { return json({ error: 'verified_activity_resolution_required' }, 409) }
      }
      let activityHash, activityOriginal
      if (path === '/resolve-test-uncertain') {
        const row = this.rows('SELECT * FROM activity WHERE id=?', body.activityId)[0]
        if (row) { activityOriginal = JSON.stringify(row); activityHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(row))))].map(value => value.toString(16).padStart(2, '0')).join('') }
      }
      const response = this.transaction(() => this.handle(path, body, activation, activityHash, activityOriginal))
      if (path !== '/snapshot' || !response.ok) return response
      const payload = await response.text()
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.env.HZY_DRAIN_CONTROL_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))].map(value => value.toString(16).padStart(2, '0')).join('')
      return json({ payload, signature, alg: 'HS256' })
    } catch { return json({ error: 'coordinator_unavailable' }, 503) }
  }
  handle(path, body, activation, activityHash, activityOriginal) {
    const current = this.rows('SELECT * FROM control WHERE id=1')[0]
    if (path === '/register') {
      if (!body.requestId || !Array.isArray(body.actors) || body.actors.length !== 2 || body.actors.some(actor => !['aims', 'assets'].includes(actor.app) || actor.deployment !== `C000001-test-${actor.app}` || !/^[a-f0-9]{64}$/.test(actor.artifactSha256)) || new Set(body.actors.map(actor => actor.app)).size !== 2) return json({ error: 'invalid_contract' }, 400)
      const contract = JSON.stringify({ tenant: body.tenant, environment: body.environment, actors: [...body.actors].sort((a, b) => a.app.localeCompare(b.app)) })
      if (current) return current.contract === contract ? json({ revision: current.revision, mode: current.mode, replayed: true }) : json({ error: 'contract_conflict' }, 409)
      this.sql.exec("INSERT INTO control VALUES(1,1,'closed',?)", contract)
      this.sql.exec('INSERT INTO audit VALUES(?,?,?)', body.requestId, JSON.stringify(body), JSON.stringify({ revision: 1, mode: 'closed' }))
      return json({ revision: 1, mode: 'closed' })
    }
    if (!current) return json({ error: 'not_registered' }, 503)
    if (path === '/begin') {
      const contract = JSON.parse(current.contract)
      if (!body.id || !contract.actors.some(actor => actor.app === body.app && actor.deployment === body.deployment && actor.artifactSha256 === body.artifactSha256)) return json({ error: 'actor_mismatch' }, 403)
      if (current.mode !== 'open') return json({ error: 'maintenance_closed' }, 503)
      if (this.rows('SELECT id FROM activity WHERE id=?', body.id).length) return json({ error: 'request_replay' }, 409)
      this.sql.exec("INSERT INTO activity(id,actor,admitted_revision,status,started_at) VALUES(?,?,?,'active',?)", body.id, body.app, current.revision, new Date().toISOString())
      return json({ admitted: true, revision: current.revision })
    }
    if (path === '/finish') {
      const row = this.rows('SELECT * FROM activity WHERE id=?', body.id)[0]
      const actor = JSON.parse(current.contract).actors.find(value => value.app === body.app && value.deployment === body.deployment && value.artifactSha256 === body.artifactSha256)
      if (!actor || !row || !Number.isSafeInteger(body.admissionRevision) || body.admissionRevision !== row.admitted_revision || row.actor !== body.app || !['settled', 'uncertain'].includes(body.outcome)) return json({ error: 'activity_mismatch' }, 409)
      if (row.status !== 'active') return row.status === body.outcome ? json({ finished: true, replayed: true }) : json({ error: 'outcome_conflict' }, 409)
      this.sql.exec('UPDATE activity SET status=?,finished_at=?,detail=? WHERE id=?', body.outcome, new Date().toISOString(), String(body.reason || '').slice(0, 128), body.id)
      return json({ finished: true })
    }
    if (path === '/resolve-test-uncertain') {
      if (current.mode !== 'closed' || !body.requestId || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== current.revision
        || typeof body.activityId !== 'string' || !body.activityId || !/^[a-f0-9]{64}$/.test(body.activitySha256)
        || !body.ownerAuthorization || typeof body.ownerAuthorization !== 'object'
        || typeof body.ownerAuthorization.reference !== 'string' || body.ownerAuthorization.reference.trim() !== body.ownerAuthorization.reference || body.ownerAuthorization.reference.length < 8 || body.ownerAuthorization.reference.length > 1000
        || !/^[a-f0-9]{64}$/.test(body.ownerAuthorization.evidenceSha256)
        || typeof body.disposition !== 'string' || body.disposition.trim() !== body.disposition || body.disposition.length < 16 || body.disposition.length > 1000) return json({ error: 'test_disposition_input_invalid' }, 400)
      const previous = this.rows('SELECT * FROM audit WHERE id=?', body.requestId)[0]
      const payload = JSON.stringify(body)
      if (previous) return previous.payload === payload ? json({ ...JSON.parse(previous.result), replayed: true }) : json({ error: 'test_disposition_replay_conflict' }, 409)
      const row = this.rows('SELECT * FROM activity WHERE id=?', body.activityId)[0]
      if (!row || row.status !== 'uncertain' || !row.finished_at || JSON.stringify(row) !== activityOriginal || activityHash !== body.activitySha256) return json({ error: 'uncertain_activity_hash_or_state_mismatch' }, 409)
      const result = { resolved: true, id: row.id, revision: current.revision, mode: current.mode, detail: 'test-disposition' }
      this.sql.exec('UPDATE activity SET status=\'settled\',detail=? WHERE id=?', `test-disposition:${body.disposition}`, row.id)
      this.sql.exec('INSERT INTO audit VALUES(?,?,?)', body.requestId, payload, JSON.stringify({ ...result, activity: row, disposition: body.disposition, ownerAuthorization: body.ownerAuthorization }))
      return json(result)
    }
      if (path === '/reconcile') {
      if (!activation || body.requestId !== activation.requestId) return json({error:'resolution_request_mismatch'},409)
      const previous = this.rows('SELECT * FROM audit WHERE id=?',body.requestId)[0]
      if(previous) return JSON.parse(previous.payload).approvalSha256===activation.approvalSha256 ? json({...JSON.parse(previous.result),replayed:true}) : json({error:'resolution_replay_conflict'},409)
      const row=this.rows('SELECT * FROM activity WHERE id=?',activation.activity.id)[0]
      const actor=JSON.parse(current.contract).actors.find(value=>value.app===activation.actor?.app && value.deployment===activation.actor?.deployment && value.artifactSha256===activation.actor?.artifactSha256)
      if(current.mode!=='closed' || body.expectedRevision!==current.revision || activation.closedRevision!==current.revision || !row || !actor || row.actor!==actor.app || JSON.stringify(row)!==JSON.stringify(activation.activity))return json({error:'resolution_state_mismatch'},409)
      const result={reconciled:true,id:row.id,revision:current.revision,mode:'closed'}
      this.sql.exec("UPDATE activity SET status='settled',finished_at=?,detail=? WHERE id=?",new Date().toISOString(),`review:${activation.approvalSha256}`,row.id)
      this.sql.exec('INSERT INTO audit VALUES(?,?,?)',body.requestId,JSON.stringify(activation),JSON.stringify(result))
      return json(result)
    }
    if (path === '/release') {
      const seal = this.rows("SELECT payload FROM audit WHERE json_extract(result,'$.mode')='sealed' ORDER BY rowid DESC LIMIT 1").map(row => JSON.parse(row.payload))[0]
      if (!activation || current.mode !== 'sealed' || !seal || body.expectedRevision !== current.revision || activation.sealRevision !== current.revision || activation.cutoverKey !== seal.cutoverKey || activation.generation !== seal.targetGeneration || JSON.stringify(activation.actors) !== JSON.stringify(JSON.parse(current.contract).actors) || !body.requestId) return json({ error: 'activation_binding_mismatch' }, 409)
      const result = { revision: current.revision + 1, mode: 'open', generation: activation.generation }
      this.sql.exec("UPDATE control SET revision=?,mode='open' WHERE id=1", result.revision)
      this.sql.exec('INSERT INTO audit VALUES(?,?,?)', body.requestId, JSON.stringify({ ...body, verifiedActivation: activation }), JSON.stringify(result))
      return json(result)
    }
    if (['/open', '/close', '/seal'].includes(path)) {
      if (!body.requestId || !Number.isSafeInteger(body.expectedRevision)) return json({ error: 'revision_required' }, 400)
      const payload = JSON.stringify(body)
      const previous = this.rows('SELECT * FROM audit WHERE id=?', body.requestId)[0]
      if (previous) return previous.payload === payload ? json(JSON.parse(previous.result)) : json({ error: 'replay_conflict' }, 409)
      if (body.expectedRevision !== current.revision) return json({ error: 'revision_conflict' }, 409)
      if (current.mode === 'sealed') return json({ error: 'sealed_contract' }, 409)
      if (path === '/seal' && (current.mode !== 'closed' || !body.cutoverKey || typeof body.targetGeneration !== 'string' || !/^[1-9][0-9]{0,19}$/.test(body.targetGeneration) || BigInt(body.targetGeneration) > 18446744073709551615n)) return json({ error: 'closed_cutover_required' }, 409)
      if (['/open', '/seal'].includes(path) && this.rows("SELECT id FROM activity WHERE status IN ('active','uncertain') LIMIT 1").length) return json({ error: 'unresolved_activity' }, 409)
      const result = { revision: current.revision + 1, mode: path === '/open' ? 'open' : path === '/seal' ? 'sealed' : 'closed' }
      this.sql.exec('UPDATE control SET revision=?,mode=? WHERE id=1', result.revision, result.mode)
      this.sql.exec('INSERT INTO audit VALUES(?,?,?)', body.requestId, payload, JSON.stringify(result))
      return json(result)
    }
    if (path === '/snapshot') {
      const counts = this.rows('SELECT actor,status,COUNT(*) count FROM activity GROUP BY actor,status ORDER BY actor,status')
      return json({ schemaVersion: 'enterprise-external-drain.v1', tenant: 'C000001', environment: 'test', revision: current.revision, mode: current.mode, seal: this.rows("SELECT payload FROM audit WHERE json_extract(result,'$.mode')='sealed' ORDER BY rowid DESC LIMIT 1").map(row => JSON.parse(row.payload))[0] || null, contract: JSON.parse(current.contract), counts, unresolved: this.rows("SELECT * FROM activity WHERE status IN ('active','uncertain') ORDER BY id"), workerCredentialConfigured: !!this.env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN && this.env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN !== this.env.HZY_DRAIN_CONTROL_TOKEN, ingressDrained: ['closed', 'sealed'].includes(current.mode) && !counts.some(row => row.status !== 'settled'), externalReceiptsVerified: false })
    }
    return json({ error: 'not_found' }, 404)
  }
}
export default {
  async fetch(request, env) {
    if (!env.HZY_DRAIN_STATE) return json({ error: 'coordinator_binding_missing' }, 503)
    return env.HZY_DRAIN_STATE.get(env.HZY_DRAIN_STATE.idFromName('C000001:test')).fetch(request)
  }
}
