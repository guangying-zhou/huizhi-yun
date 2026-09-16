import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const optIn = fileURLToPath(new URL('../shared/types/nitro-fetch.d.ts', import.meta.url))
const virtualFile = fileURLToPath(new URL('./nitro-fetch-type-fixture.ts', import.meta.url))

function checkTypes(source: string, enabled: boolean) {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    paths: { 'nitropack/types': [join(dirname(require.resolve('nitropack/package.json')), 'types.d.ts')] }
  }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, ...rest) => name === virtualFile
    ? ts.createSourceFile(name, source, languageVersion, true)
    : getSourceFile(name, languageVersion, ...rest)
  const program = ts.createProgram([virtualFile, ...(enabled ? [optIn] : [])], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n'
  }))
}

const calls = `
import type { $Fetch, H3Event$Fetch, NitroFetchConfig } from 'nitropack/types'
declare const fetcher: $Fetch
declare const eventFetch: H3Event$Fetch
declare const dynamicUrl: string
type Assert<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

declare module 'nitropack/types' {
  interface InternalApi {
    '/type-test/fixed': { get: { kind: 'fixed', value: number } }
    '/type-test/items/:id': { get: { kind: 'item', id: string }, post: { created: true } }
    '/type-test/files/**': { get: { path: string } }
    '/type-test/fallback': { default: { fallback: true } }
  }
}

const fixed = await fetcher('/type-test/fixed')
type Fixed = Assert<Equal<typeof fixed, { kind: 'fixed', value: number }>>
// @ts-expect-error response typing must not silently become any
fixed.missing
// @ts-expect-error literal routes retain their allowed method check
await fetcher('/type-test/fixed', { method: 'DELETE' })
const created = await fetcher('/type-test/items/42', { method: 'POST' })
type Created = Assert<Equal<typeof created, { created: true }>>
const item = await fetcher('/type-test/items/42')
type Item = Assert<Equal<typeof item, { kind: 'item', id: string }>>
const file = await fetcher('/type-test/files/a/b')
type File = Assert<Equal<typeof file, { path: string }>>
const fallback = await fetcher('/type-test/fallback', { method: 'PATCH' })
type Fallback = Assert<Equal<typeof fallback, { fallback: true }>>
const eventResult = await eventFetch('/type-test/fixed')
type Event = Assert<Equal<typeof eventResult, typeof fixed>>
const client = fetcher.create({ headers: { 'x-test': 'types' } })
const raw = await client.raw('/type-test/fixed')
type Raw = Assert<Equal<typeof raw._data, typeof fixed | undefined>>
// @ts-expect-error raw calls also retain method checking
await client.raw('/type-test/fixed', { method: 'DELETE' })
const explicit = await fetcher<{ total: number }>(dynamicUrl, { method: 'POST' })
type Explicit = Assert<Equal<typeof explicit, { total: number }>>
const request = await fetcher<{ total: number }>(new Request('https://example.invalid/test'))
type RequestResult = Assert<Equal<typeof request, { total: number }>>
const unknown = await fetcher(dynamicUrl)
type Unknown = Assert<Equal<typeof unknown, unknown>>
`

test('large Nitro route sets retain response and method checking with Aims opt-in', () => {
  const routes = Array.from({ length: 600 }, (_, id) => `
    '/api/type-regression/products/${id}/versions/:versionId/plan/items/:scopeId': {
      get: { product: ${id} }, patch: { updated: ${id} }
    }
  `).join('\n')
  checkTypes(`${calls}
    type Enabled = Assert<Equal<NitroFetchConfig, { flatRequest: true }>>
    declare module 'nitropack/types' { interface InternalApi { ${routes} } }
  `, true)
})

test('other TypeScript projects keep the default Nitro contract without opt-in', () => {
  checkTypes(`${calls}
    type Disabled = Assert<Equal<NitroFetchConfig extends { flatRequest: true } ? true : false, false>>
  `, false)
})
