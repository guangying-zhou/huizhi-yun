// Defaults to a signed read-only snapshot. Mutations require --apply and an exact input file.
import { readFile, mkdir, writeFile, cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { coordinatorConfig } from './build-config.mjs'

const [operation = 'snapshot', ...args] = process.argv.slice(2)
const get = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1] }
if (operation === 'prepare') {
  const directory = resolve(get('--output') || 'deploy/test-env/.cloudflare-workers/drain-coordinator')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (const name of ['coordinator.mjs', 'activation-verifier.mjs', 'activity-verifier.mjs']) await cp(new URL(`./${name}`, import.meta.url), resolve(directory, name))
  await writeFile(resolve(directory, 'wrangler.json'), JSON.stringify(coordinatorConfig(), null, 2) + '\n', { mode: 0o600 })
  process.stdout.write(JSON.stringify({ prepared: true, deployed: false, directory }) + '\n')
} else {
  if (!['snapshot', 'register', 'open', 'close', 'seal', 'release', 'reconcile', 'resolve-test-uncertain'].includes(operation)) throw Error('Unsupported control operation')
  const input = get('--input') ? JSON.parse(await readFile(resolve(get('--input')), 'utf8')) : {}
  if (input.tenant && input.tenant !== 'C000001' || input.environment && input.environment !== 'test') throw Error('Exact test tenant required')
  const body = { ...input, tenant: 'C000001', environment: 'test' }
  if (operation !== 'snapshot' && !args.includes('--apply')) {
    process.stdout.write(JSON.stringify({ operation, apply: false, body }) + '\n')
  } else {
    const token = process.env.HZY_DRAIN_CONTROL_TOKEN
    if (!token) throw Error('Dedicated HZY_DRAIN_CONTROL_TOKEN required in process environment')
    const response = await fetch(`https://hzy-test.huizhi.yun/__test/drain/${operation}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw Error(`Drain control rejected with HTTP ${response.status}`)
    const result = await response.json()
    if (operation === 'snapshot') {
      if (result.alg !== 'HS256' || typeof result.payload !== 'string' || !/^[a-f0-9]{64}$/.test(result.signature)) throw Error('Unsigned drain evidence rejected')
      const expected = createHmac('sha256', token).update(result.payload).digest()
      if (!timingSafeEqual(expected, Buffer.from(result.signature, 'hex'))) throw Error('Invalid drain signature')
      const snapshot = JSON.parse(result.payload)
      if (snapshot.tenant !== 'C000001' || snapshot.environment !== 'test') throw Error('Evidence identity mismatch')
    }
    if (get('--output')) await writeFile(resolve(get('--output')), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
}
