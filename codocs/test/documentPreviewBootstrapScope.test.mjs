import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { computed, effectScope, nextTick, ref, watch } from 'vue'

test('document preview bootstrap is isolated by Codocs cache scope and auth session', async () => {
  const source = readFileSync(new URL('../app/composables/useDocumentPreviewBootstrap.ts', import.meta.url), 'utf8')
  const user = ref('user-a')
  const tenant = ref('tenant-a')
  const moduleScope = ref('deployment-a')
  let hosted = true
  const states = new Map()
  const useState = (key, factory) => {
    if (!states.has(key)) states.set(key, ref(factory()))
    return states.get(key)
  }
  const useAuth = () => ({ user, tenant })
  const useCodocsModule = () => ({
    cacheKey: key => hosted ? `hzy:enterprise:${moduleScope.value}:codocs:${key}` : key
  })
  const env = { computed, nextTick, ref, watch, useState, useAuth, useCodocsModule }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const factory = await new AsyncFunction(
    ...Object.keys(env),
    `${stripTypeScriptTypes(source).replace(/^import .*$/m, '').replace('export const useDocumentPreviewBootstrap', 'const useDocumentPreviewBootstrap')}\nreturn useDocumentPreviewBootstrap;`
  )(...Object.values(env))
  const instances = []
  const makeInstance = () => {
    const scope = effectScope()
    const instance = scope.run(factory)
    instances.push(scope)
    return instance
  }

  const first = makeInstance()
  first.setPayload('same-uuid', { content: 'user-a' })
  assert.deepEqual(first.getPayload('same-uuid'), { content: 'user-a' })

  user.value = 'user-b'
  user.value = 'user-a'
  await nextTick()
  assert.equal(first.getPayload('same-uuid'), undefined, 'a stale composable cannot reactivate after A→B→A')
  first.setPayload('same-uuid', { content: 'late-user-a' })
  const sameSession = makeInstance()
  assert.equal(sameSession.getPayload('same-uuid'), undefined, 'a late write cannot cross users')
  user.value = 'user-b'
  await nextTick()
  const second = makeInstance()
  assert.equal(second.getPayload('same-uuid'), undefined, 'a new user cannot read the old payload')
  second.setPayload('same-uuid', { content: 'user-b' })

  tenant.value = 'tenant-b'
  await nextTick()
  assert.equal(second.getPayload('same-uuid'), undefined, 'tenant changes clear the prior payload')
  second.setPayload('same-uuid', { content: 'late-tenant-a' })
  moduleScope.value = 'deployment-b'
  await nextTick()
  assert.equal(second.getPayload('same-uuid'), undefined, 'deployment changes clear the prior payload')
  const newDeployment = makeInstance()
  assert.equal(newDeployment.getPayload('same-uuid'), undefined, 'a fresh deployment cannot read the prior payload')
  newDeployment.setPayload('same-uuid', { content: 'deployment-b body' })
  moduleScope.value = 'deployment-c'
  newDeployment.setPayload('same-uuid', { content: 'late deployment-b body' })
  assert.equal(makeInstance().getPayload('same-uuid'), undefined, 'deployment-only change isolates a populated cache')

  user.value = 'user-a'
  await nextTick()
  first.setPayload('same-uuid', { content: 'old-user-a-again' })
  const third = makeInstance()
  assert.equal(third.getPayload('same-uuid'), undefined, 'an old instance cannot reactivate after A→B→A')

  third.setPayload('same-uuid', { content: 'current' })
  assert.deepEqual(third.consumePayload('same-uuid'), { content: 'current' })
  assert.equal(third.consumePayload('same-uuid'), undefined, 'consume is one-shot')
  third.setPayload('same-uuid', { content: 'before-logout' })
  user.value = null
  await nextTick()
  assert.equal(third.getPayload('same-uuid'), undefined, 'logout clears the active session payload')
  third.setPayload('same-uuid', { content: 'late-logout' })
  assert.equal(third.getPayload('same-uuid'), undefined, 'logout cannot write a new payload')

  user.value = 'standalone-user'
  hosted = false
  const standalone = makeInstance()
  standalone.setPayload('standalone-uuid', { content: 'still-compatible' })
  assert.deepEqual(standalone.getPayload('standalone-uuid'), { content: 'still-compatible' }, 'standalone keeps the existing API')
  standalone.clearPayload('standalone-uuid')
  assert.equal(standalone.getPayload('standalone-uuid'), undefined)
  for (const scope of instances) scope.stop()
})
