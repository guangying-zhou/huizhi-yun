import { describe, it, expect } from 'vitest'
import { classifyHost, classifyHostWithRuntime, normalizeHost } from '../server/utils/hostClassifier'

const baseDomains = ['repoinsight.com', 'lvh.me', 'localhost']
const reserved = ['auth', 'api', 'admin', 'storage']

function c(host: string) {
  return classifyHost(host, { platformBaseDomains: baseDomains, reservedSubdomains: reserved })
}

describe('normalizeHost', () => {
  it('lowercases and strips trailing dot', () => {
    expect(normalizeHost('WWW.repoinsight.com.')).toBe('www.repoinsight.com')
  })
  it('returns empty for falsy', () => {
    expect(normalizeHost(undefined)).toBe('')
    expect(normalizeHost('')).toBe('')
  })
})

describe('classifyHost platform root', () => {
  it('apex domain => platform-root', () => {
    const r = c('repoinsight.com')
    expect(r.kind).toBe('platform-root')
    expect(r.isRootLike).toBe(true)
    expect(r.baseDomain).toBe('repoinsight.com')
  })
  it('www apex => platform-root', () => {
    const r = c('www.repoinsight.com')
    expect(r.kind).toBe('platform-root')
    expect(r.isRootLike).toBe(true)
  })
})

describe('classifyHost reserved subdomain', () => {
  it('direct reserved subdomain', () => {
    const r = c('www.repoinsight.com')
    expect(r.kind).toBe('platform-reserved-subdomain')
    expect(r.subdomain).toBe('auth')
  })
  it('treat www as reserved when not root-like pattern (already handled separately)', () => {
    const r = c('www.lvh.me')
    expect(r.kind).toBe('platform-root') // because root-like condition triggers
  })
})

describe('classifyHost tenant subdomain', () => {
  it('single-level subdomain => tenant-subdomain', () => {
    const r = c('huifang.repoinsight.com')
    expect(r.kind).toBe('tenant-subdomain')
    expect(r.tenantName).toBe('huifang')
  })
  it('dev root domain subdomain', () => {
    const r = c('alice.lvh.me')
    expect(r.kind).toBe('tenant-subdomain')
    expect(r.baseDomain).toBe('lvh.me')
  })
})

describe('classifyHost custom-domain', () => {
  it('unrelated domain => custom-domain', () => {
    const r = c('example.org')
    expect(r.kind).toBe('custom-domain')
  })
  it('multi-level over platform base => custom-domain (safety)', () => {
    const r = c('a.b.repoinsight.com')
    expect(r.kind).toBe('custom-domain')
  })
})

describe('classifyHostWithRuntime', () => {
  it('mirrors classifyHost behavior', () => {
    const runtimePublic = { platformBaseDomains: baseDomains, platformReservedSubdomains: reserved }
    const r = classifyHostWithRuntime('www.repoinsight.com', runtimePublic)
    expect(r.kind).toBe('platform-reserved-subdomain')
  })
})
