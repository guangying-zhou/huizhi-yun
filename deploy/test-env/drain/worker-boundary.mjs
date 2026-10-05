// Opt-in wrapper covers direct Service Binding fetches as well as Gateway calls.
// A lost finish remains active forever; elapsed time never grants drain approval.
export function withTestDrainBoundary(worker, actor) {
  if (!['aims', 'assets'].includes(actor.app) || actor.deployment !== `C000001-test-${actor.app}` || !/^[a-f0-9]{64}$/.test(actor.artifactSha256)) throw Error('Invalid immutable drain actor')
  async function call(env, path, payload) {
    if (!env.HZY_DRAIN_COORDINATOR || !env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN) throw Error('Drain binding unavailable')
    const response = await env.HZY_DRAIN_COORDINATOR.fetch(new Request(`https://drain.internal${path}`, { method: 'POST', headers: { authorization: `Bearer ${env.HZY_TENANT_GATEWAY_INTERNAL_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ tenant: 'C000001', environment: 'test', ...actor, ...payload }) }))
    if (!response.ok) throw Error(`Drain coordinator rejected ${path}`)
    return response.json()
  }
  async function begin(env) {
    const id = crypto.randomUUID()
    const admission = await call(env, '/begin', { id })
    return { id, admissionRevision: admission.revision }
  }
  function contextWithTracking(ctx) {
    const tasks = []
    const tracked = new Proxy(ctx || {}, { get(target, key) { if (key === 'waitUntil') return promise => { const task = Promise.resolve(promise); task.catch(() => {}); tasks.push(task) }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } })
    return { tracked, async settle() { let offset = 0; let failed = false; while (offset < tasks.length) { const batch = tasks.slice(offset); offset = tasks.length; const outcomes = await Promise.allSettled(batch); failed ||= outcomes.some(outcome => outcome.status === 'rejected') } return !failed } }
  }
  const boundary = {
    ...worker,
    async fetch(request, env, ctx) {
      let id
      try { id = await begin(env) } catch { return new Response('Test maintenance boundary unavailable', { status: 503 }) }
      const { tracked, settle } = contextWithTracking(ctx)
      let response
      try { response = await worker.fetch(request, env, tracked) } catch (error) {
        const finish = settle().then(() => call(env, '/finish', { ...id, outcome: 'uncertain', reason: 'handler_error' }))
        ctx.waitUntil(finish)
        throw error
      }
      let resolveBody
      const bodyDone = new Promise(resolve => { resolveBody = resolve })
      let body = null
      if (response.body) {
        const reader = response.body.getReader()
        body = new ReadableStream({ async pull(controller) { try { const next = await reader.read(); if (next.done) { controller.close(); resolveBody(true) } else controller.enqueue(next.value) } catch (error) { resolveBody(false); controller.error(error) } }, async cancel(reason) { resolveBody(false); await reader.cancel(reason) } })
      } else resolveBody(true)
      ctx.waitUntil(bodyDone.then(async streamSettled => { const tasksSettled = await settle(); return call(env, '/finish', { ...id, outcome: tasksSettled && streamSettled && response.status < 500 ? 'settled' : 'uncertain', reason: 'fetch_complete' }) }))
      return new Response(body, response)
    },
    async scheduled(event, env, ctx) {
      const id = await begin(env)
      const { tracked, settle } = contextWithTracking(ctx)
      let outcome = 'settled'
      try { await worker.scheduled?.(event, env, tracked) } catch { outcome = 'uncertain' }
      if (!await settle()) outcome = 'uncertain'
      await call(env, '/finish', { ...id, outcome, reason: 'scheduled_complete' })
      if (outcome !== 'settled') throw Error('Scheduled drain outcome unresolved')
    }
  }
  for (const name of ['queue', 'email', 'tail', 'trace']) {
    if (typeof worker[name] !== 'function') continue
    boundary[name] = async (event, env, ctx) => {
      const admission = await begin(env)
      const { tracked, settle } = contextWithTracking(ctx)
      let value, outcome = 'settled'
      try { value = await worker[name](event, env, tracked) } catch { outcome = 'uncertain' }
      if (!await settle() || typeof value === 'function') outcome = 'uncertain'
      await call(env, '/finish', { ...admission, outcome, reason: `${name}_complete` })
      if (outcome !== 'settled') throw Error('Worker lifecycle outcome unresolved')
      return value
    }
  }
  return boundary
}
