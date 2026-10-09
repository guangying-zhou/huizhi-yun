import { readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import ts from 'typescript'
import { deriveBusinessApiSurface } from '../composition/business-api-surface.mjs'

const root = resolve(import.meta.dirname, '../..')
const domains = ['enterprise', 'aims', 'assets', 'codocs', 'foundation', 'console', 'workflow', 'altoc', 'people', 'finance']
function files(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(dir, e.name)) : /\.(ts|mjs|js)$/.test(e.name) ? [resolve(dir, e.name)] : [])
}
const inputs = domains.flatMap(d => files(resolve(root, d, 'server')).concat(files(resolve(root, d, 'layer/server'))))
function target(file, name) {
  const domain = relative(root, file).split('/')[0]
  let path
  if (name.startsWith('.')) path = resolve(dirname(file), name)
  else if (/^~~?\//.test(name)) path = resolve(root, domain, name.replace(/^~~?\//, ''))
  else if (name.startsWith('@hzy/')) path = resolve(root, name.slice(5))
  else return undefined
  return [path, path + '.ts', path + '.mjs', path + '.js', resolve(path, 'index.ts')].find(p => existsSync(p) && /\.(ts|js|mjs)$/.test(p))
}
export function auditHostAimsScopes({ overrides = {}, routeFilter = () => true } = {}) {
  const host = ts.createCompilerHost({ allowJs: true })
  const nativeRead = host.readFile
  host.readFile = file => overrides[file] ?? nativeRead(file)
  host.resolveModuleNames = (names, file) => names.map((name) => {
    const path = target(file, name)
    return path ? { resolvedFileName: path, extension: path.endsWith('.ts') ? ts.Extension.Ts : ts.Extension.Js } : undefined
  })
  const program = ts.createProgram(inputs, { allowJs: true, noLib: true, noResolve: false }, host)
  const checker = program.getTypeChecker()
  const auto = new Map()
  for (const file of inputs.filter(f => f.includes('/server/utils/'))) {
    const source = program.getSourceFile(file)
    for (const statement of source.statements) {
      if (!statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      const nodes = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement]
      for (const node of nodes) if (node.name && ts.isIdentifier(node.name)) {
        const key = relative(root, file).split('/')[0] + ':' + node.name.text
        auto.set(key, [...(auto.get(key) || []), node])
      }
    }
  }
  const results = [], unresolved = []
  const unknown = Symbol('unknown')
  function declarationOf(node) {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return symbol?.declarations?.[0]
  }
  function value(node, bindings, seen = new Set()) {
    if (!node) return undefined
    if (seen.has(node)) return unknown
    seen = new Set([...seen, node])
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isAwaitExpression(node) || ts.isNonNullExpression(node)) return value(node.expression, bindings, seen)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) return { callable: true }
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text
      for (const span of node.templateSpans) {
        const part = value(span.expression, bindings, seen)
        if (part === unknown) return unknown
        text += String(part) + span.literal.text
      }
      return text
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = value(node.left, bindings, seen), right = value(node.right, bindings, seen)
      return left === unknown || right === unknown ? unknown : left + right
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.filter(p => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)).map(p => [p.name.getText().replace(/^['"]|['"]$/g, ''), value(ts.isShorthandPropertyAssignment(p) ? p.name : p.initializer, bindings, seen)]))
    if (ts.isIdentifier(node)) {
      const decl = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent)?.declarations?.[0] : declarationOf(node)
      if (bindings.has(decl)) return bindings.get(decl)
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return value(decl.initializer, bindings, seen)
      if (node.text === 'undefined') return undefined
    }
    if (ts.isPropertyAccessExpression(node)) {
      const base = value(node.expression, bindings, seen)
      return base === unknown ? unknown : base?.[node.name.text]
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
      const a = value(node.left, bindings, seen), b = value(node.right, bindings, seen)
      if (a !== unknown && b !== unknown) return node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? a === b : a !== b
    }
    if (ts.isConditionalExpression(node)) {
      const condition = value(node.condition, bindings, seen)
      return condition === unknown ? unknown : value(condition ? node.whenTrue : node.whenFalse, bindings, seen)
    }
    if (ts.isCallExpression(node)) {
      const decl = declarationOf(node.expression)
      if (decl && ts.isFunctionDeclaration(decl) && decl.body) {
        const returned = decl.body.statements.filter(ts.isReturnStatement)
        if (returned.length === 1) return value(returned[0].expression, bindings, seen)
      }
    }
    return unknown
  }
  for (const route of deriveBusinessApiSurface().routes.filter(routeFilter)) {
    const source = program.getSourceFile(resolve(root, 'enterprise/server/routes', route.file))
    if (!source) continue
    const seen = new Map()
    function walk(node, chain, bindings = new Map()) {
      const used = new Set()
      function dependencies(child) {
        if (ts.isIdentifier(child)) {
          const declaration = declarationOf(child)
          if (bindings.has(declaration)) used.add(declaration)
        }
        ts.forEachChild(child, dependencies)
      }
      dependencies(node)
      const state = JSON.stringify([...used].map(parameter => [parameter.getSourceFile().fileName + ':' + parameter.pos, bindings.get(parameter)]), (_key, fact) => typeof fact === 'symbol' ? '<unknown>' : fact)
      const states = seen.get(node) || new Set()
      if (states.has(state)) return
      states.add(state)
      seen.set(node, states)
      const file = node.getSourceFile().fileName
      const label = relative(root, file) + ':' + (node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1)
      const next = [...chain, label]
      function visit(n) {
        if (ts.isTypeNode(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return
        if (ts.isBlock(n)) {
          for (const statement of n.statements) {
            visit(statement)
            if (ts.isIfStatement(statement) && value(statement.expression, bindings) !== unknown && value(statement.expression, bindings)) {
              const body = ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement]
              if (body.some(ts.isReturnStatement)) break
            }
          }
          return
        }
        if (ts.isIfStatement(n)) {
          visit(n.expression)
          const condition = value(n.expression, bindings)
          if (condition === unknown || condition) visit(n.thenStatement)
          if (n.elseStatement && (condition === unknown || !condition)) visit(n.elseStatement)
          return
        }
        if (ts.isConditionalExpression(n)) {
          visit(n.condition)
          const condition = value(n.condition, bindings)
          if (condition === unknown) {
            visit(n.whenTrue)
            visit(n.whenFalse)
          } else visit(condition ? n.whenTrue : n.whenFalse)
          return
        }
        if (ts.isCallExpression(n)) {
          for (const argument of n.arguments) {
            if (!ts.isObjectLiteralExpression(argument)) continue
            const targetSymbol = checker.getSymbolAtLocation(n.expression)
            const targetName = targetSymbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(targetSymbol).name : targetSymbol?.name
            const app = argument.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText().replace(/^['"]|['"]$/g, '') === 'appCode')
            if (targetName === 'maybeCallTenantRuntime' && app && value(app.initializer, bindings) === 'aims') {
              results.push({ route: `${route.method} ${route.route}`, scope: 'legacy Aims Runtime request outside U/S/purpose channels', chain: next })
            }
            for (const property of argument.properties) {
              if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
              if (property.name.getText().replace(/^['"]|['"]$/g, '') !== 'scope') continue
              const expression = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
              const scope = value(expression, bindings)
              if (typeof scope === 'string' && /(^|\s)(?:(?:data-runtime|tenant-runtime):)?aims[.:](read|write)(\s|$)/.test(scope)) results.push({ route: `${route.method} ${route.route}`, scope, chain: next })
              else if (scope === unknown) {
                // Unknown control flow is conservative: inspect both possible
                // scope branches, including a template with a dynamic suffix.
                function scanScope(child) {
                  const text = ts.isStringLiteralLike(child) ? child.text : ts.isTemplateExpression(child) ? child.head.text : ''
                  if (/(^|\s)(?:(?:data-runtime|tenant-runtime):)?aims[.:](read|write)(\s|$)/.test(text)) results.push({ route: `${route.method} ${route.route}`, scope: child.getText(), chain: next })
                  ts.forEachChild(child, scanScope)
                }
                scanScope(expression)
              }
            }
          }
        }
        if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
          const arg = n.arguments[0]
          if (!ts.isStringLiteralLike(arg)) unresolved.push({ route: route.route, file: label, expression: n.getText() })
          else {
            const path = target(file, arg.text)
            if (path) walk(program.getSourceFile(path), next)
          }
        }
        if ((ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
          let symbol = checker.getSymbolAtLocation(n)
          if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
          let declarations = symbol?.declarations || []
          if (!declarations.length && ts.isCallExpression(n.parent) && n.parent.expression === n) {
            const domain = relative(root, file).split('/')[0]
            const alias = checker.getSymbolAtLocation(n)?.declarations?.find(ts.isImportSpecifier)
            const name = alias?.propertyName?.text || alias?.name?.text || n.text
            declarations = auto.get(domain + ':' + name) || auto.get('foundation:' + name) || []
          }
          for (const declaration of declarations) {
            if (declaration === n.parent || (!declaration.getSourceFile().fileName.startsWith(root + '/') || declaration.getSourceFile().fileName.includes('/node_modules/'))) continue
            // Generic token/Runtime transports consume the caller's options;
            // inspect those at the call site, not every unrelated enum branch
            // inside the shared transport implementation.
            if (declaration.getSourceFile().fileName.includes('/foundation/server/utils/') && ts.isFunctionDeclaration(declaration)
              && ['requestServiceAccessToken', 'requestWithServiceAccessToken', 'maybeCallTenantRuntime', 'callEnterpriseRuntime'].includes(declaration.name?.text)) continue
            if (ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration) || ts.isExportAssignment(declaration)) {
              const bound = new Map(bindings)
              if (ts.isFunctionDeclaration(declaration) && ts.isCallExpression(n.parent) && n.parent.expression === n) {
                declaration.parameters.forEach((p, i) => bound.set(p, n.parent.arguments[i] ? value(n.parent.arguments[i], bindings) : p.initializer ? value(p.initializer, bindings) : undefined))
              }
              walk(declaration, next, bound)
            }
          }
        }
        ts.forEachChild(n, visit)
      }
      visit(node)
    }
    for (const statement of source.statements) if (!ts.isImportDeclaration(statement) && !ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) walk(statement, [])
  }
  return { routes: deriveBusinessApiSurface().routes.length, results, unresolved }
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(auditHostAimsScopes(), null, 2))
