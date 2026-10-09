import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const source = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
const start = source.slice(source.indexOf('function startConsole('), source.indexOf('function publicPolicyTrust('))
test('feedback wake is opt-in only for Console and does not enable background jobs or external notification', () => {
  for (const flag of [undefined, false, true, 'true']) {
    let env
    const launch = runInNewContext(`${start}\nstartConsole`, {
      root: '/fixture', values: { profile: '/private/profile.json' }, dirname, resolve,
      publicPolicyTrust: () => ({ signingKid: 'fixture', signingPubkey: 'fixture' }), existsSync: () => false,
      processEnvironment: () => ({}), spawn: (_command, _args, options) => { env = options.env }
    })
    launch({ identity: { consoleFacadeMode: 'local-canonical-facade', canonicalIssuer: 'https://fixture/console' }, features: { feedbackDeliveryEnabled: flag, notificationsInAppOnly: true }, publicOrigin: 'https://fixture' })
    assert.equal(env.HZY_CONSOLE_FEEDBACK_DELIVERY_ENABLED, flag === true ? 'true' : 'false')
    assert.equal(env.HZY_CONSOLE_BACKGROUND_JOBS_ENABLED, 'false')
    assert.equal(env.HZY0_NOTIFICATIONS_IN_APP_ONLY, 'true')
  }
})
