#!/usr/bin/env node
// Bundles the standalone Collab runtime into a single ESM file so the release
// package is self-contained (no node_modules on the host). No deployment and
// no configuration values are embedded: everything is read from the process
// environment (systemd EnvironmentFile) at start.
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// esbuild is a dependency of collab's `tsx` dev dependency; resolve it from
// there so the lockfile does not need a new direct dependency.
export async function loadEsbuild(collabDir) {
  const tsxPackage = createRequire(join(collabDir, 'package.json')).resolve('tsx/package.json')
  const esbuildPath = createRequire(tsxPackage).resolve('esbuild')
  return import(pathToFileURL(esbuildPath).href)
}

// Hocuspocus 3.4.4 accepts `address` but calls `httpServer.listen(port)`, which binds
// the wildcard address (verified: lsof shows *:PORT with COLLAB_ADDRESS=127.0.0.1).
// collab/src is not ours to change here, so the bundle pins every host-less numeric
// listen() to COLLAB_ADDRESS (default 127.0.0.1) before any application code runs.
// health.mjs still verifies the result from the outside at every start.
export const LOOPBACK_BANNER = [
  "import { createRequire as __hzyCreateRequire } from 'node:module';",
  "import { Server as __hzyNetServer } from 'node:net';",
  'const require = __hzyCreateRequire(import.meta.url);',
  '{const __hzyHost = (process.env.COLLAB_ADDRESS || "127.0.0.1").trim() || "127.0.0.1";',
  'const __hzyListen = __hzyNetServer.prototype.listen;',
  '__hzyNetServer.prototype.listen = function (...args) {',
  '  const first = args[0];',
  '  if (typeof first === "number" || (typeof first === "string" && /^[0-9]+$/.test(first))) { if (typeof args[1] !== "string") args.splice(1, 0, __hzyHost) }',
  '  else if (first && typeof first === "object" && first.port !== undefined && first.host === undefined && first.path === undefined) args[0] = { ...first, host: __hzyHost };',
  '  return __hzyListen.apply(this, args)',
  '}}'
].join('\n')

export async function bundleCollab({ repo, outDir }) {
  if (!isAbsolute(outDir)) throw Error('outDir must be absolute')
  const collabDir = join(repo, 'collab')
  const esbuild = await loadEsbuild(collabDir)
  const target = join(outDir, '.output/server')
  await mkdir(target, { recursive: true })
  await esbuild.build({
    entryPoints: [join(collabDir, 'src/server.ts')],
    outfile: join(target, 'index.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24', legalComments: 'none',
    // CJS dependencies (ali-oss, ioredis, ws) use require()/__dirname.
    banner: { js: LOOPBACK_BANNER },
    // Optional modules guarded by try/catch in ws and urllib (ali-oss); absent by design.
    external: ['bufferutil', 'utf-8-validate', 'proxy-agent'],
    logLevel: 'warning'
  })
  await writeFile(join(outDir, '.output/package.json'), '{"private":true,"type":"module"}\n')
  return join(target, 'index.mjs')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { repo: { type: 'string' }, out: { type: 'string' } } })
  if (!values.repo || !values.out) throw Error('usage: bundle-collab.mjs --repo ABSOLUTE_REPO --out ABSOLUTE_PACKAGE_DIR')
  console.log(await bundleCollab({ repo: resolve(values.repo), outDir: values.out }))
}
