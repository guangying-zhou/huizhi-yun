import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const server = resolve(import.meta.dirname, '../server')

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : /\.(?:ts|js|mjs)$/.test(entry.name) ? [path] : []
  })
}

function unwrap(node) {
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = node.expression
  return node
}

test('Enterprise server modules do not bind Nuxt request globals during module initialization', () => {
  const violations = []
  for (const path of files(server)) {
    const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of ast.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue
        const initializer = unwrap(declaration.initializer)
        const accessed = ts.isCallExpression(initializer) ? initializer.expression : initializer
        if (ts.isIdentifier(accessed) && ['$fetch', 'useRuntimeConfig'].includes(accessed.text)) {
          violations.push(`${relative(server, path)}:${ast.getLineAndCharacterOfPosition(declaration.getStart(ast)).line + 1}`)
        }
      }
    }
  }
  assert.deepEqual(violations, [], 'request globals may be unavailable while a server module loads')
})
