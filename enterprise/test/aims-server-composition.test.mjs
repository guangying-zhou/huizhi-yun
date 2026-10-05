import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'

const root = resolve(import.meta.dirname, '../..')
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) ? [resolve(directory, entry.name)] : [])
const parse = (file, source = readFileSync(file, 'utf8')) => {
  if (file.endsWith('.vue')) {
    const { descriptor } = parseSfc(source, { filename: file })
    source = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n')
  }
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
}
const visit = (node, fn) => {
  fn(node)
  ts.forEachChild(node, child => visit(child, fn))
}

function literal(node, constants = new Map(), seen = new Set()) {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return literal(node.expression, constants, seen)
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent) && parent.parameters.some(parameter => parameter.name.getText() === node.text)) break
      if (!ts.isBlock(parent) && !ts.isSourceFile(parent)) continue
      for (const statement of parent.statements) {
        if (!ts.isVariableStatement(statement)) continue
        const declaration = statement.declarationList.declarations.find(value => ts.isIdentifier(value.name) && value.name.text === node.text)
        if (!declaration) continue
        if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !declaration.initializer) throw Error('Mutable or missing literal binding')
        return literal(declaration.initializer, constants, new Set([...seen, node.text]))
      }
    }
  }
  throw Error(`Non-literal module/scope/client/operation expression: ${node?.getText()}`)
}
function moduleLiteral(node) {
  if (!node || !ts.isStringLiteralLike(node)) throw Error('Non-literal import/require is forbidden')
  return node.text
}
function inspect(ast) {
  const constants = new Map(), imports = [], calls = [], aliases = new Map()
  visit(ast, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0 && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer)
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const element of node.importClause.namedBindings.elements) aliases.set(element.name.text, element.propertyName?.text || element.name.text)
    }
  })
  visit(ast, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) imports.push(moduleLiteral(node.moduleSpecifier))
    if (!ts.isCallExpression(node)) return
    const name = ts.isIdentifier(node.expression) ? (aliases.get(node.expression.text) || node.expression.text) : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require') imports.push(moduleLiteral(node.arguments[0]))
    calls.push({ node, name, constants })
  })
  return { imports, calls }
}
function localTarget(file, specifier) {
  const domain = relative(root, file).split('/')[0]
  let target
  if (specifier.startsWith('.')) target = resolve(dirname(file), specifier)
  else if (specifier.startsWith('~~/') || specifier.startsWith('~/')) target = resolve(root, domain, specifier.replace(/^~~?\//, ''))
  else if (specifier.startsWith('@hzy/')) target = resolve(root, specifier.slice(5))
  else if (specifier === '#imports') throw Error(`${file}: implicit #imports cannot prove a closed transport graph`)
  else return null // external package is not a local application edge
  if (target.endsWith('.json') && existsSync(target)) return null
  for (const candidate of [target, `${target}.ts`, resolve(target, 'index.ts')]) if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate
  throw Error(`${file}: unresolved local import ${specifier}`)
}
function assertTokenCalls(ast, file) {
  for (const { node, name, constants } of inspect(ast).calls) {
    if (!['requestServiceAccessToken', 'requestWithServiceAccessToken', 'maybeCallTenantRuntime'].includes(name)) continue
    for (const argument of node.arguments) {
      assert.ok(ts.isObjectLiteralExpression(argument) || (argument === node.arguments[0] && name === 'maybeCallTenantRuntime'), `${file}: opaque token options`)
      if (!ts.isObjectLiteralExpression(argument)) continue
      for (const property of argument.properties) {
        assert.ok(ts.isPropertyAssignment(property), `${file}: opaque token option/spread`)
        assert.ok(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name), `${file}: computed token option`)
        const key = property.name.getText().replace(/^['"]|['"]$/g, '')
        if (!['scope', 'clientId', 'clientCode', 'sourceClientId', 'appCode'].includes(key)) continue
        const value = literal(property.initializer, constants)
        assert.notEqual(value, 'aims.runtime', file)
        if (key === 'scope') assert.ok(!['aims.read', 'aims.write'].includes(value), file)
        if (key === 'appCode') assert.notEqual(value, 'aims', file)
      }
    }
  }
}

test('AST recognizes aliases, reexports, dynamic imports, require and rejects opaque scopes', () => {
  const ast = parse('fixture.ts', `import { requestServiceAccessToken as issue } from './a'; export * from '~~/b'; import('./c'); require('./d'); const scope='aims.write'; issue({scope});`)
  assert.deepEqual(inspect(ast).imports, ['./a', '~~/b', './c', './d'])
  assert.throws(() => assertTokenCalls(ast, 'fixture'))
  assert.throws(() => inspect(parse('f.ts', 'import(destination)')))
  assert.throws(() => assertTokenCalls(parse('f.ts', 'requestServiceAccessToken({ scope: calculate() })'), 'f'))
  assert.throws(() => assertTokenCalls(parse('f.ts', 'const scope=\'console:read\'; function f(scope) { requestServiceAccessToken({ scope }) }'), 'f'))
  assert.throws(() => assertTokenCalls(parse('f.ts', 'const key=\'scope\'; requestServiceAccessToken({ [key]: \'aims.read\' })'), 'f'))
  assert.throws(() => localTarget(resolve(root, 'aims/core.ts'), '#imports'))
  assert.equal(localTarget(resolve(root, 'aims/core.ts'), '~~/layer/server/index'), resolve(root, 'aims/layer/server/index.ts'))
})

test('owning cores import only relative modules or Foundation; ingress uses public entries', () => {
  for (const file of files(resolve(root, 'aims/layer/server'))) {
    for (const specifier of inspect(parse(file)).imports) assert.ok(specifier.startsWith('.') || specifier.startsWith('@hzy/foundation/'), `${file}: ${specifier}`)
  }
  for (const file of files(resolve(root, 'enterprise/server/routes/enterprise/api/v1/service'))) {
    for (const specifier of inspect(parse(file)).imports) {
      const target = localTarget(file, specifier)
      for (const domain of ['aims', 'assets']) if (target?.startsWith(resolve(root, domain) + '/')) assert.equal(target, resolve(root, `${domain}/layer/server/index.ts`), file)
    }
  }
})

test('Host Aims and owning cores use literal channel operations, never aims.runtime', () => {
  for (const file of [...files(resolve(root, 'enterprise/server/routes/aims')), ...files(resolve(root, 'aims/layer/server'))]) {
    assertTokenCalls(parse(file), file)
  }
})

test('six document bridges traverse imports, reexports and dynamic edges without an Aims HTTP hop', () => {
  const visited = new Set()
  function walk(file) {
    if (visited.has(file)) return
    visited.add(file)
    const ast = parse(file)
    for (const { node, name, constants } of inspect(ast).calls) {
      if (['serviceAppFetch', 'resolveTrustedServiceAppRoute', 'resolveServiceAppBaseUrl', 'trustedServiceRequestHeaders'].includes(name)) {
        const argument = node.arguments[1]
        assert.ok(argument, `${file}: missing transport target`)
        assert.notEqual(literal(argument, constants), 'aims', file)
      }
    }
    for (const specifier of inspect(ast).imports) {
      if (specifier.startsWith('@hzy/foundation/')) continue // separately audited shared transport boundary
      const target = localTarget(file, specifier)
      if (target) walk(target)
    }
  }
  for (const name of ['enterpriseAimsProjectDocuments', 'enterpriseAimsProjectDocumentWrites', 'enterpriseAimsProjectDocumentAccess', 'enterpriseAimsProjectDocumentFiles', 'enterpriseAimsProjectDocumentSources', 'enterpriseAimsAccessibleDocuments']) {
    const file = resolve(root, `enterprise/server/utils/${name}.ts`)
    assert.ok(inspect(parse(file)).imports.some(value => value.endsWith('aims/layer/server/index')))
    walk(file)
  }
  assert.ok(visited.has(resolve(root, 'aims/server/utils/codocsApi.ts')))
  assert.ok(visited.has(resolve(root, 'aims/layer/server/internal/projectDocumentPorts.ts')))
})

test('actual five ESLint configurations enforce the owning public import boundary', async () => {
  const { ESLint } = await import('eslint')
  for (const domain of ['enterprise', 'aims', 'foundation', 'codocs', 'console']) {
    const lint = new ESLint({ cwd: resolve(root, domain) })
    const filePath = resolve(root, domain, 'server/boundary-fixture.ts')
    for (const specifier of ['../../aims/server/utils/serviceAuth', '@hzy/aims/server/utils/codocsApi.ts', '../aims/layer/server/internal/private', '@hzy/aims/layer/server/internal/private']) {
      const [result] = await lint.lintText(`import value from '${specifier}'\nvoid value\n`, { filePath })
      assert.ok(result.messages.some(message => message.ruleId === 'no-restricted-imports'), `${domain}: ${specifier}`)
    }
    const [normalHandler] = await lint.lintText('import handler from \'../../aims/server/api/v1/projects/index.get\'\nvoid handler\n', { filePath })
    assert.ok(!normalHandler.messages.some(message => message.ruleId === 'no-restricted-imports'))
    const [allowed] = await lint.lintText('import { receiveWorkflowCallback } from \'@hzy/aims/layer/server/index\'\nvoid receiveWorkflowCallback\n', { filePath })
    assert.ok(!allowed.messages.some(message => message.ruleId === 'no-restricted-imports'))
    assert.equal(JSON.parse(readFileSync(resolve(root, domain, 'package.json'), 'utf8')).scripts.lint, 'eslint .')
  }
})

test('baseline is frozen to existing files; new files cannot acquire helper exemptions', async () => {
  const { createHash } = await import('node:crypto')
  const { existingAimsCompositionFiles } = await import('../eslint.config.mjs')
  assert.equal(existingAimsCompositionFiles.length, 78)
  assert.equal(createHash('sha256').update(existingAimsCompositionFiles.join('\n')).digest('hex'), '6fc2c2c2f0f6cf4b4fdee7067895eabe7d93301047a7e8bacb1b1cf417ab8f7c')
  // Snapshot taken at d0c1b264; hash keeps the guard independent of Git clone depth.
  for (const file of existingAimsCompositionFiles) {
    assert.ok(existsSync(resolve(root, 'enterprise', file)), `baseline file no longer exists: ${file}`)
    assert.ok(!file.includes('*'), 'baseline must be exact files, never directory globs')
  }
  const { ESLint } = await import('eslint')
  const lint = new ESLint({ cwd: resolve(root, 'enterprise') })
  for (const file of existingAimsCompositionFiles) {
    const [entry] = await lint.lintText('import value from \'@hzy/aims/server/utils/serviceAuth\'\nvoid value\n', { filePath: resolve(root, 'enterprise', file) })
    assert.ok(!entry.messages.some(message => message.ruleId === 'no-restricted-imports'), `baseline override did not match ${file}`)
  }
  const oldPath = resolve(root, 'enterprise', existingAimsCompositionFiles[0])
  const newPath = resolve(root, 'enterprise/server/utils/new-composition-fixture.ts')
  for (const specifier of ['@hzy/aims/server/utils/serviceAuth', '@hzy/aims/server/utils/codocsApi']) {
    const code = `import value from '${specifier}'\nvoid value\n`
    const [oldFile] = await lint.lintText(code, { filePath: oldPath })
    const [newFile] = await lint.lintText(code, { filePath: newPath })
    assert.ok(!oldFile.messages.some(message => message.ruleId === 'no-restricted-imports'))
    assert.ok(newFile.messages.some(message => message.ruleId === 'no-restricted-imports'))
  }
  const [internal] = await lint.lintText('import value from \'@hzy/aims/layer/server/internal/private\'\nvoid value\n', { filePath: oldPath })
  assert.ok(internal.messages.some(message => message.ruleId === 'no-restricted-imports'), 'baseline must never exempt internal cores')
})

test('all production modules enforce internal and new service-helper boundaries, including reexports and dynamic imports', async () => {
  const { aimsServiceHelpers } = await import('../../foundation/eslint/aims-server-boundary.mjs')
  const { existingAimsCompositionFiles } = await import('../eslint.config.mjs')
  const snapshotText = readFileSync(resolve(root, 'enterprise/test/aims-helper-baseline.json'), 'utf8')
  const { createHash } = await import('node:crypto')
  assert.equal(createHash('sha256').update(snapshotText).digest('hex'), 'b6e5a79761b8b2f3724e6db8cee3d3e0cf6ee5fd207570465ba2979097d12e51')
  const snapshot = JSON.parse(snapshotText)
  assert.deepEqual(Object.keys(snapshot), existingAimsCompositionFiles)
  function checkHelper(file, helper) {
    assert.ok(snapshot[relative(resolve(root, 'enterprise'), file)]?.includes(helper), `${file}: helper outside frozen per-file set: ${helper}`)
  }
  const first = resolve(root, 'enterprise', existingAimsCompositionFiles[0])
  const extra = aimsServiceHelpers.find(helper => !snapshot[existingAimsCompositionFiles[0]].includes(helper))
  assert.throws(() => checkHelper(first, extra), /outside frozen/)
  assert.throws(() => inspect(parse('fixture.vue', '<script setup>const path="./x"; import(path)</script>')), /Non-literal/)
  assert.throws(() => inspect(parse('fixture.vue', '<script>require(destination)</script>')), /Non-literal/)
  assert.deepEqual(inspect(parse('fixture.vue', '<script>export * from "./a"</script><script setup>import("./b")</script>')).imports, ['./a', './b'])
  for (const module of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'aims' && !entry.name.startsWith('.') && existsSync(resolve(root, entry.name, 'package.json')))) {
    const sources = ['server', 'app', 'layer/server', 'layer/pages'].map(directory => resolve(root, module.name, directory)).filter(existsSync)
    for (const file of sources.flatMap(files)) {
      for (const specifier of inspect(parse(file)).imports) {
        assert.ok(!specifier.includes('aims/layer/server/internal'), `${file}: external internal-core import`)
        if (specifier.includes('aims/server/utils/')) {
          const helper = specifier.split('aims/server/utils/')[1].replace(/\.(ts|js|mjs)$/, '')
          if (Object.hasOwn(snapshot, relative(resolve(root, 'enterprise'), file)) || aimsServiceHelpers.includes(helper)) checkHelper(file, helper)
        }
      }
    }
  }
})
