import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePlatformSigningKeyEnvelope,
  resolveConfiguredPlatformBundleSigningKey,
  resolvePlatformBundleSigningKey
} from '../server/utils/platformSigningKeyResolver.ts'

const config = {
  activationMode: 'managed-cloud-multitenant',
  baseUrl: 'https://platform.example.test',
  platformServiceToken: 'internal-token',
  signingKid: 'psk_20260531_old',
  signingPubkey: '-----BEGIN PUBLIC KEY-----\\nold\\n-----END PUBLIC KEY-----'
}

test('platform signing key resolver：bundle kid 命中本地配置时直接使用配置公钥', () => {
  const key = resolveConfiguredPlatformBundleSigningKey(config, 'psk_20260531_old')

  assert.equal(key?.kid, 'psk_20260531_old')
  assert.equal(key?.alg, 'Ed25519')
  assert.equal(key?.source, 'configured')
  assert.match(key?.publicKey || '', /\nold\n/)
})

test('platform signing key resolver：bundle kid 不同时可接受 Platform 内部返回的 active key', () => {
  const key = normalizePlatformSigningKeyEnvelope({
    success: true,
    data: {
      kid: 'psk_20260621_new',
      alg: 'Ed25519',
      publicKey: '-----BEGIN PUBLIC KEY-----\\nnew\\n-----END PUBLIC KEY-----',
      status: 'active'
    }
  }, 'psk_20260621_new')

  assert.equal(key.kid, 'psk_20260621_new')
  assert.equal(key.source, 'platform-internal')
  assert.match(key.publicKey, /\nnew\n/)
})

test('platform signing key resolver：拒绝 revoked 或非 active/rotated 的远端 key', () => {
  assert.throws(() => normalizePlatformSigningKeyEnvelope({
    success: true,
    data: {
      kid: 'psk_20260621_new',
      alg: 'Ed25519',
      publicKey: 'public',
      status: 'revoked',
      revokedAt: '2026-06-21T00:00:00.000Z'
    }
  }, 'psk_20260621_new'), /not trusted/)

  assert.throws(() => normalizePlatformSigningKeyEnvelope({
    success: true,
    data: {
      kid: 'psk_20260621_new',
      alg: 'Ed25519',
      publicKey: 'public',
      status: 'pending'
    }
  }, 'psk_20260621_new'), /not trusted/)
})

test('platform signing key resolver：managed cloud 在 kid 不同时按 kid 请求 Platform 内部公钥', async () => {
  const globalWithFetch = globalThis as typeof globalThis & {
    $fetch?: (url: string, options: { headers?: Record<string, string>, timeout?: number }) => Promise<unknown>
  }
  const originalFetch = globalWithFetch.$fetch
  const calls: Array<{ url: string, authorization: string | undefined }> = []

  globalWithFetch.$fetch = async (url, options) => {
    calls.push({
      url,
      authorization: options.headers?.Authorization
    })
    return {
      success: true,
      data: {
        kid: 'psk_20260621_new',
        alg: 'Ed25519',
        publicKey: '-----BEGIN PUBLIC KEY-----\\nnew\\n-----END PUBLIC KEY-----',
        status: 'rotated'
      }
    }
  }

  try {
    const key = await resolvePlatformBundleSigningKey(config, 'psk_20260621_new')

    assert.equal(key.kid, 'psk_20260621_new')
    assert.equal(key.source, 'platform-internal')
    assert.deepEqual(calls, [{
      url: 'https://platform.example.test/api/platform/internal/signing-keys/psk_20260621_new',
      authorization: 'Bearer internal-token'
    }])
  } finally {
    globalWithFetch.$fetch = originalFetch
  }
})
