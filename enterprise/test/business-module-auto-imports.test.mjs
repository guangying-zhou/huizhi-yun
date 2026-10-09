import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { businessModules } from '../composition/registry.mjs'
import {
  businessModuleAliasPlugin,
  businessModuleAutoImports,
  hostAutoImports,
  scanAutoImportExports
} from '../composition/business-module-alias.mjs'

const root = resolve(import.meta.dirname, '../..')
const transform = (source, file) => businessModuleAliasPlugin().transform(source, file)

test('composed Assets pages receive their own module composables (useAssetLabels / useAssetDictionaries)', async () => {
  for (const [page, name] of [
    ['assets/app/pages/physical.vue', 'useAssetLabels'],
    ['assets/app/pages/resources.vue', 'useAssetLabels'],
    ['assets/app/pages/items/[id].vue', 'useAssetLabels'],
    ['assets/app/pages/admin/dictionaries.vue', 'useAssetDictionaries'],
    ['assets/app/components/assets/AssetCategoryEditModal.vue', 'useAssetDictionaries']
  ]) {
    const file = resolve(root, page)
    const result = await transform(readFileSync(file, 'utf8'), file)
    assert.ok(result, page)
    const target = resolve(root, `assets/app/composables/${name}`)
    assert.ok(result.code.includes(`import { ${name} } from ${JSON.stringify(target)}`), `${page} must import ${name}`)
    // Injected inside <script setup>, never ahead of the SFC.
    assert.ok(result.code.indexOf('<script') < result.code.indexOf(`import { ${name} }`), page)
  }
})

test('Host-owned names stay with the Host; only module-local names are injected', async () => {
  // Codocs/Assets re-export names the Host must resolve to its single Foundation
  // session. A new collision needs an explicit decision, so keep this list exact.
  const host = hostAutoImports()
  const collisions = {}
  for (const module of ['aims', 'assets', 'codocs', 'altoc', 'finance']) {
    const own = scanAutoImportExports([resolve(root, module, 'app/composables'), resolve(root, module, 'app/utils')])
    const shadowed = [...own.keys()].filter(name => host.has(name)).sort()
    if (shadowed.length) collisions[module] = shadowed
    for (const name of shadowed) assert.equal(businessModuleAutoImports(module).has(name), false, `${module}:${name}`)
  }
  assert.deepEqual(collisions, {
    aims: ['formatDate'],
    assets: ['formatDate', 'useCookieOptions', 'useDashboard'],
    codocs: ['formatDate', 'resolveAvatarProps', 'resolveAvatarSrc', 'useAccountDepartments', 'useAccountUser', 'useAccountUserProjects', 'useAccountUsers', 'useAppInfo', 'useAuth', 'useCookieOptions', 'usePermissions'],
    altoc: ['formatDate'],
    finance: ['formatMoney', 'getShortApplicationName', 'isApplicationIconName', 'useAppInfo', 'useAuthorization', 'useUserApplications']
  })

  const favorites = resolve(root, 'codocs/app/pages/mydocs/favorites.vue')
  const result = await transform(readFileSync(favorites, 'utf8'), favorites)
  assert.doesNotMatch(result?.code || '', /codocs\/app\/composables\/useAuth/)

  // Host files are never touched; explicit imports and local declarations win.
  assert.equal(await transform('<script setup>const x = useAssetLabels(\'a\')</script>', resolve(root, 'enterprise/app/pages/index.vue')), null)
  const physical = resolve(root, 'assets/app/pages/physical.vue')
  assert.equal(await transform('<script setup>\nimport { useAssetLabels } from \'./x\'\nuseAssetLabels(\'a\')\n</script>', physical), null)
  assert.equal(await transform('<script setup>\nfunction useAssetLabels() {}\nuseAssetLabels()\n</script>', physical), null)
  assert.equal(await transform('<script setup>\n// useAssetLabels(\'a\')\nconst s = "useAssetLabels()"\n</script>', physical), null)
  assert.equal(await transform('<script setup>\nobj.useAssetLabels()\n</script>', physical), null)
  // Style/template sub-requests are not scripts.
  assert.equal(await transform('.a{}', `${physical}?vue&type=style&index=0&lang.css`), null)
  // A Vue script sub-request and a plain TS module are handled as scripts.
  const script = await transform('const a = useAssetLabels(\'x\')', `${physical}?vue&type=script&setup=true&lang.ts`)
  assert.match(script.code, /^import \{ useAssetLabels \} from /m)
  const templateOnly = await transform('<template><span>{{ useAssetLabels(\'x\') }}</span></template>\n<script setup lang="ts">\nconst a = 1\n</script>', physical)
  assert.match(templateOnly.code, /import \{ useAssetLabels \}/)
})

// Independent sweep over every composed page closure: after the Host transform,
// no file may still call a module-local composable, util or store it neither
// imports nor declares. Pinia stores are not auto-imported by the Host either,
// so they must stay explicit imports.
function pageFiles(pages, out = []) {
  for (const page of pages) {
    out.push(page.file)
    if (page.children) pageFiles(page.children, out)
  }
  return out
}

function scriptOf(file, source) {
  if (!file.endsWith('.vue')) return { script: source, template: '' }
  const script = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n')
  const start = source.indexOf('<template')
  const end = source.lastIndexOf('</template>')
  return { script, template: start >= 0 && end > start ? source.slice(start, end) : '' }
}

test('no composed page closure calls an unresolved module composable, util or store', async () => {
  const failures = []
  for (const module of businessModules) {
    const moduleRoot = resolve(root, module.code)
    const local = scanAutoImportExports(['app/composables', 'app/utils', 'app/stores'].map(dir => resolve(moduleRoot, dir)))
    const host = hostAutoImports()
    const queue = [...new Set(pageFiles(module.pages))]
    const seen = new Set()
    while (queue.length) {
      const file = queue.shift()
      if (seen.has(file) || !existsSync(file)) continue
      seen.add(file)
      const original = readFileSync(file, 'utf8')
      const transformed = (await transform(original, file))?.code || original
      const { script, template } = scriptOf(file, transformed)
      // Read textually: raw TypeScript can defeat a JavaScript lexer.
      const bound = new Set()
      for (const match of script.matchAll(/\bimport\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
        for (const name of match[1].replace(/[{}*]/g, ',').split(',').map(part => part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, '').trim())) {
          if (name) bound.add(name)
        }
      }
      for (const match of script.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        // Follow module-owned relative and absolute (alias-rewritten) imports.
        const base = specifier.startsWith('.') ? resolve(dirname(file), specifier) : specifier.startsWith(moduleRoot) ? specifier : null
        if (!base) continue
        for (const suffix of ['', '.ts', '.vue', '.js', '/index.ts']) {
          const candidate = base + suffix
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            if (candidate.startsWith(moduleRoot)) queue.push(candidate)
            break
          }
        }
      }
      const usage = `${script}\n${template}`
      for (const [name, source] of local) {
        if (bound.has(name) || host.has(name)) continue
        if (!new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`).test(usage)) continue
        if (new RegExp(`\\b(?:function|const|let|var|class)\\s+${name}(?![\\w$])|\\b(?:const|let|var)\\s*\\{[^}]*(?<![\\w$])${name}(?![\\w$])[^}]*\\}\\s*=`).test(script)) continue
        failures.push(`${relative(root, file)} calls ${name} (${relative(root, source)}) without an import`)
      }
    }
  }
  assert.deepEqual(failures, [])
})

// The Vite pre-transform sees raw TypeScript for every composed-module file. It
// must not fail on any of them (a build once broke on `a[i]! / b`).
test('every composed-module source file survives the Host transform', async () => {
  const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? (entry.name === 'node_modules' ? [] : walk(join(dir, entry.name))) : [join(dir, entry.name)]) : []
  const failures = []
  for (const module of ['aims', 'assets', 'codocs', 'finance']) {
    for (const file of [...walk(resolve(root, module, 'app')), ...walk(resolve(root, module, 'layer'))]) {
      if (!/\.(?:vue|ts|mjs|js)$/.test(file) || file.endsWith('.d.ts')) continue
      try {
        await transform(readFileSync(file, 'utf8'), file)
      } catch (error) {
        failures.push(`${relative(root, file)}: ${error.message}`)
      }
    }
  }
  assert.deepEqual(failures, [])
  const codec = resolve(root, 'codocs/app/components/editor/editorTableCodec.ts')
  await transform(readFileSync(codec, 'utf8'), codec)
})
