import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse, compileScript } from '@vue/compiler-sfc'

// The manifest declares ownership; the actual Host SFC confirms it. Never
// accept an entire URL prefix or register a second copy of the native route.
export function projectHostNativePages(contributor) {
  const declaration = contributor.hostNavigation
  if (declaration?.schemaVersion !== 1 || declaration.placement !== 'host-native' || !Array.isArray(declaration.pages) || !Array.isArray(declaration.entries)) throw Error('Invalid Host navigation declaration')
  const seen = new Set()
  return declaration.pages.map((path) => {
    if (typeof path !== 'string' || (!(path === '/enterprise' && contributor.code === 'console') && !/^\/(?:enterprise|altoc)\/(?:[a-z][a-z0-9-]*\/)*[a-z][a-z0-9-]*(?:\/:(?:notificationId|announcementId|feedbackId|jobCode|customerId|contractId|planId|leadId|opportunityId|quotationId|tenderId|agreementId|ticketId|renewalId))?$/.test(path)) || seen.has(path)) throw Error(`Invalid or duplicate Host native page: ${path}`)
    if (path !== '/enterprise' && !path.startsWith(contributor.code === 'altoc' ? '/altoc/' : '/enterprise/')) throw Error(`Host native page owner mismatch: ${path}`)
    seen.add(path)
    const stem = (path === '/enterprise' ? 'index' : path.slice(1)).replace(/:(notificationId|announcementId|feedbackId|jobCode|customerId|contractId|planId|leadId|opportunityId|quotationId|tenderId|agreementId|ticketId|renewalId)$/, '[$1]')
    const candidates = [`${stem}.vue`, `${stem}/index.vue`].map(file => new URL(`../app/pages/${file}`, import.meta.url)).filter(existsSync)
    if (candidates.length !== 1) throw Error(`Host native page is missing or ambiguous: ${path}`)
    const file = fileURLToPath(candidates[0])
    const source = readFileSync(file, 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    if (errors.length || !descriptor.scriptSetup) throw Error(`Invalid Host native page metadata: ${path}`)
    const ast = compileScript(descriptor, { id: path }).scriptSetupAst
    const calls = ast.filter(node => node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.name === 'definePageMeta')
    const object = calls.length === 1 && calls[0].expression.arguments[0]
    const literal = key => object?.type === 'ObjectExpression' && object.properties.find(property => property.type === 'ObjectProperty' && property.key.name === key)?.value
    const owner = literal('navigationOwner'), name = literal('name')
    if (path === '/enterprise') {
      const alias = literal('alias')
      if (alias?.type !== 'ArrayExpression' || !alias.elements.some(node => node?.type === 'StringLiteral' && node.value === '/enterprise')) throw Error('Host home alias is missing')
    }
    if (owner?.type !== 'StringLiteral' || owner.value !== contributor.code || name?.type !== 'StringLiteral' || !name.value) throw Error(`Host native page owner mismatch: ${path}`)
    return { path, name: name.value, file, module: contributor.code }
  })
}

export function validateHostNativePages(existing, projection) {
  const flatten = (pages, parent = '') => pages.flatMap((page) => {
    const path = page.path.startsWith('/') ? page.path : `${parent}/${page.path}`.replace(/\/$/, '')
    return [{ ...page, path: path.replace(/:([A-Za-z][A-Za-z0-9_]*)\(\)/g, ':$1') }, ...flatten(page.children || [], path)]
  })
  const actual = flatten(existing)
  for (const page of projection) {
    const matches = actual.filter(candidate => (candidate.path === page.path || (page.path === '/enterprise' && candidate.path === '/')) && candidate.file === page.file)
    if (matches.length !== 1) throw Error(`Host native page differs from Nuxt registration: ${page.path}`)
  }
}

// A Host-native page reads the browser permission snapshot of the module that
// declared it (Foundation useAuthorization reads `meta.authorizationApp`). The
// owner comes from the validated projection, never from the page's own URL.
export function annotateHostNativePageAuthorization(existing, projection) {
  const visit = (pages, parent = '') => {
    for (const page of pages) {
      const raw = page.path.startsWith('/') ? page.path : `${parent}/${page.path}`.replace(/\/$/, '')
      const path = raw.replace(/:([A-Za-z][A-Za-z0-9_]*)\(\)/g, ':$1')
      const owner = projection.find(native => (native.path === path || (native.path === '/enterprise' && path === '/')) && native.file === page.file)
      if (owner) page.meta = { ...page.meta, authorizationApp: owner.module }
      if (page.children) visit(page.children, raw)
    }
  }
  visit(existing)
}
