import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import { resolveAvatarSrc } from '../app/composables/useAvatar.ts'

type RuntimeConfig = {
  public?: Record<string, unknown>
}

const globals = globalThis as typeof globalThis & {
  useRuntimeConfig?: () => RuntimeConfig
}
const originalUseRuntimeConfig = globals.useRuntimeConfig
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeEach(() => {
  globals.useRuntimeConfig = () => ({ public: {} })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined
  })
})

after(() => {
  if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
  else delete globals.useRuntimeConfig

  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    delete (globalThis as typeof globalThis & { window?: unknown }).window
  }
})

describe('Codocs avatar URL resolution', () => {
  test('uses the current tenant gateway instead of a static Account deployment URL', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          origin: 'https://tenant.example.test'
        }
      }
    })
    globals.useRuntimeConfig = () => ({
      public: {
        accountUrl: 'https://console.example.test'
      }
    })

    assert.equal(
      resolveAvatarSrc('avatars/zhouguangying.png'),
      'https://tenant.example.test/api/oss/avatar?path=zhouguangying.png&v=zhouguangying.png'
    )
  })

  test('keeps a tenant-gateway-relative URL for server rendering', () => {
    globals.useRuntimeConfig = () => ({
      public: {
        accountUrl: 'https://console.example.test/'
      }
    })

    assert.equal(
      resolveAvatarSrc('zhouguangying.png'),
      '/api/oss/avatar?path=zhouguangying.png&v=zhouguangying.png'
    )
  })
})
