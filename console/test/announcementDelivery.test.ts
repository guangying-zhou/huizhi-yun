import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAnnouncementDelivery, type AnnouncementDelivery } from '../server/utils/announcementDeliveryCore'

test('outbox channels stay independent; failure is acknowledged for durable retry', async () => {
  const base = { id: 'a', revision: 1, uid: 'alice', lease: 'lease', key: 'stable-key' }
  const jobs: AnnouncementDelivery[] = [{ ...base, channel: 'in_app' }, { ...base, channel: 'wecom' }]
  const acknowledgements: unknown[] = []
  const bell: string[] = []
  const wecom: string[] = []
  const result = await runAnnouncementDelivery({
    claim: async () => jobs.shift() || null,
    ack: async (job, success) => { acknowledgements.push([job.channel, job.key, success]) },
    bell: async (job) => { bell.push(job.uid) },
    wecom: async (job) => {
      wecom.push(job.uid)
      throw Error('simulated provider failure')
    }
  })
  assert.deepEqual(bell, ['alice'])
  assert.deepEqual(wecom, ['alice'])
  assert.deepEqual(acknowledgements, [['in_app', 'stable-key', true], ['wecom', 'stable-key', false]])
  assert.equal(result.delivered, 1)
})

test('failed ack propagates so the original key is recovered after lease expiry', async () => {
  const job: AnnouncementDelivery = { id: 'a', revision: 1, uid: 'alice', channel: 'wecom', lease: 'lease', key: 'stable-key' }
  let sends = 0
  await assert.rejects(runAnnouncementDelivery({
    claim: async () => job,
    ack: async () => { throw Error('ack lost') },
    bell: async () => {},
    wecom: async () => { sends++ }
  }), /ack lost/)
  assert.equal(sends, 1)
})
