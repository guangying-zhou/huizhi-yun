import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import install, { compositionRestartRequired, createCompositionReload, compositionFingerprint } from '../composition/dev-watch.mjs'

const root = resolve('/tmp/hzy-dev-watch-fixture')
test('frozen composition and manifest inputs reload while normal page edits do not', () => {
  for (const [event, path] of [['change', 'console/app.manifest.json'], ['change', 'aims/layer/entry.mjs'], ['change', 'enterprise/composition/registry.mjs'], ['add', 'enterprise/app/pages/enterprise/admin/new.vue'], ['unlink', 'enterprise/app/pages/enterprise/admin/new.vue']]) {
    assert.equal(compositionRestartRequired(event, resolve(root, path), root), true)
  }

  for (const path of ['enterprise/app/pages/enterprise/index.vue', 'aims/app/pages/products/index.vue', 'enterprise/server/api/example.get.ts', 'console/server/utils/checkPermission.ts', 'console/app.manifest.json.other']) {
    assert.equal(compositionRestartRequired('change', resolve(root, path), root), false)
  }
})

test('immutable hzy0 installs no composition restart watcher', () => {
  const previous = process.env.HZY0_LOCAL_ENTERPRISE

  try {
    process.env.HZY0_LOCAL_ENTERPRISE = 'true'

    const nuxt = { options: { dev: true, watch: [] }, hook() {
      assert.fail('must not install a watcher')
    }, callHook() {
      assert.fail('must not restart')
    } }

    install({}, nuxt)

    assert.deepEqual(nuxt.options.watch, [])
  } finally {
    if (previous === undefined)
      delete process.env.HZY0_LOCAL_ENTERPRISE
    else
      process.env.HZY0_LOCAL_ENTERPRISE = previous
  }
})

function fixture() {
  let content = 'old', queued, count = 0, canceled = 0

  const reload = createCompositionReload({
    fingerprint: () => content,
    restart: async () => {
      count++
    },
    schedule: (fn) => {
      queued = fn

      return 1
    },
    cancel: () => {
      canceled++
    }
  })

  return { reload, set: (value) => {
    content = value
  }, flush: () => queued(), count: () => count, canceled: () => canceled }
}
test('burst coalesces once; identical bytes and add/unlink with no final change do not restart', async () => {
  const f = fixture()

  f.reload.changed()

  await f.flush()

  assert.equal(f.count(), 0)

  f.set('new')

  f.reload.changed()

  f.reload.changed()

  f.reload.changed()

  await f.flush()

  assert.equal(f.count(), 1)

  f.reload.changed()

  await f.flush()

  assert.equal(f.count(), 1)

  f.set('temporary')

  f.reload.changed()

  f.set('new')

  await f.flush()

  assert.equal(f.count(), 1)

  f.set('another')

  f.reload.changed()

  f.reload.close()

  await f.flush()

  assert.equal(f.count(), 1)
})
test('restart in flight cannot overlap; failure emits fixed diagnostic and permits explicit next change', async () => {
  let content = 'a', queued, finish, count = 0, failures = 0

  const reload = createCompositionReload({ fingerprint: () => content, schedule: (fn) => {
    queued = fn
  }, cancel: () => {}, restart: () => {
    count++

    return new Promise((resolve) => {
      finish = resolve
    })
  }, failed: () => {
    failures++
  } })

  content = 'b'

  reload.changed()

  const running = queued()

  reload.changed()

  assert.equal(count, 1)

  finish()

  await running

  assert.equal(failures, 0)

  reload.close()

  const broken = createCompositionReload({ fingerprint: () => content, schedule: (fn) => {
    queued = fn
  }, cancel: () => {}, restart: async () => {
    throw Error('secret')
  }, failed: () => {
    failures++
  } })

  content = 'c'

  broken.changed()

  await queued()

  assert.equal(failures, 1)

  broken.close()
})
test('fingerprint includes frozen bytes and page membership, excludes normal page contents and generated API readiness', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')

  const { tmpdir } = await import('node:os')

  const dir = await mkdtemp(resolve(tmpdir(), 'hzy-composition-'))

  try {
    await mkdir(resolve(dir, 'enterprise/app/pages'), { recursive: true })

    await mkdir(resolve(dir, 'enterprise/composition'), { recursive: true })

    const first = compositionFingerprint(dir)

    await writeFile(resolve(dir, 'enterprise/app/pages/a.vue'), 'first')

    const second = compositionFingerprint(dir)

    assert.notEqual(first, second)

    await writeFile(resolve(dir, 'enterprise/app/pages/a.vue'), 'edit')

    assert.equal(compositionFingerprint(dir), second)

    await writeFile(resolve(dir, 'enterprise/composition/business-api-routes.generated.mjs'), 'generated')

    assert.equal(compositionFingerprint(dir), second)

    await writeFile(resolve(dir, 'enterprise/composition/registry.mjs'), 'changed')

    assert.notEqual(compositionFingerprint(dir), second)

    assert.equal(compositionRestartRequired('change', resolve(dir, 'enterprise/composition/business-api-routes.generated.mjs'), dir), false)

    assert.equal(compositionRestartRequired('addDir', resolve(dir, 'enterprise/app/pages/empty'), dir), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
