import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import { resolveAvatarSrc } from '../app/composables/useAvatar.ts'

type RuntimeConfig = {
  app?: { baseURL?: string }
  public?: Record<string, unknown>
}

const globals = globalThis as typeof globalThis & {
  useRuntimeConfig?: () => RuntimeConfig
}
const originalUseRuntimeConfig = globals.useRuntimeConfig
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeEach(() => {
  globals.useRuntimeConfig = () => ({ app: { baseURL: '/' }, public: {} })
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

describe('avatar URL resolution', () => {
  test('server rendering keeps a tenant-gateway-relative proxy URL and preserves nested object paths', () => {
    globals.useRuntimeConfig = () => ({
      app: { baseURL: '/assets/' },
      public: {
        consoleUrl: 'https://console.example.test/',
        accountUrl: 'https://legacy-account.example.com/'
      }
    })

    assert.equal(
      resolveAvatarSrc('C000001/zhouguangying/digest.png'),
      '/api/oss/avatar?path=C000001%2Fzhouguangying%2Fdigest.png&v=C000001%2Fzhouguangying%2Fdigest.png'
    )
  })

  test('Console itself falls back to its local OSS proxy', () => {
    assert.equal(
      resolveAvatarSrc('zhouguangying.png'),
      '/api/oss/avatar?path=zhouguangying.png&v=zhouguangying.png'
    )
  })

  test('browser requests use the current tenant gateway instead of the static Console deployment', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          origin: 'https://tenant.example.test'
        }
      }
    })
    globals.useRuntimeConfig = () => ({
      app: { baseURL: '/people/' },
      public: {
        consoleUrl: 'https://console.example.test'
      }
    })

    assert.equal(
      resolveAvatarSrc('zhouguangying.png'),
      'https://tenant.example.test/api/oss/avatar?path=zhouguangying.png&v=zhouguangying.png'
    )
  })

  test('an existing tenant-gateway proxy URL is never prefixed with the business application base path', () => {
    globals.useRuntimeConfig = () => ({
      app: { baseURL: '/people/' },
      public: {}
    })

    assert.equal(
      resolveAvatarSrc('/api/oss/avatar?path=zhouguangying.png'),
      '/api/oss/avatar?path=zhouguangying.png'
    )
  })

  test('absolute and preview URLs are returned unchanged', () => {
    assert.equal(resolveAvatarSrc('https://cdn.example.com/avatar.png'), 'https://cdn.example.com/avatar.png')
    assert.equal(resolveAvatarSrc('blob:https://tenant.example.test/preview'), 'blob:https://tenant.example.test/preview')
  })
})
