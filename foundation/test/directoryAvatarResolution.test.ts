import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveAvatarSrc } from '../app/composables/useAvatar.ts'

const read = (name: string) => readFileSync(new URL(`../app/components/${name}`, import.meta.url), 'utf8')

// Directory rows carry OSS object paths such as "abc.png". Bound directly as an
// <img src>, the browser resolves them against the page URL and requests
// /enterprise/directory/abc.png (404); they must go through the avatar proxy.
test('directory member, user and selector avatars go through the shared avatar resolver', () => {
  for (const [file, pattern] of [
    ['DirectoryCommitteeMembersTable.vue', /:src="resolveAvatarSrc\(row\.original\.avatar\) \|\| undefined"/],
    ['DirectoryUsersTable.vue', /src: resolveAvatarSrc\(user\.avatar\) \|\| undefined/],
    ['UserTreeSelector.vue', /avatar: resolveAvatarSrc\(u\.avatar\)/]
  ] as const) {
    const source = read(file)
    assert.match(source, /import \{ resolveAvatarSrc \} from '\.\.\/composables\/useAvatar'/, file)
    assert.match(source, pattern, file)
    assert.doesNotMatch(source, /(?:original|user|u)\.avatar \|\| (?:undefined|null)/, file)
  }
})

test('a bare OSS object path never becomes a page-relative image URL', () => {
  const globals = globalThis as { window?: unknown }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://tenant.example.test' } } })
  try {
    assert.equal(resolveAvatarSrc('abc.png'), 'https://tenant.example.test/api/oss/avatar?path=abc.png&v=abc.png')
    assert.equal(resolveAvatarSrc('/api/oss/avatar?path=abc.png'), '/api/oss/avatar?path=abc.png')
    assert.equal(resolveAvatarSrc(null), null)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete globals.window
  }
})
