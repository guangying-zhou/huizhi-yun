import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../../aims/layer/pages/enterprise-portfolio-detail.vue')
const overview = read('../../aims/app/pages/projects/index.vue')
const projectDocuments = read('../../aims/app/pages/projects/[id]/documents.vue')

// Document asset design DOC-05, batch 5c-1.
test('the portfolio page is a registered Host page reached from the project overview', () => {
  const pages = registerBusinessPages([], businessModules, 'placeholder.vue')
  const registered = pages.find(entry => entry.path === '/aims/portfolios/:id')
  assert.ok(registered, 'route')
  assert.match(registered.file, /aims\/layer\/pages\/enterprise-portfolio-detail\.vue$/)
  // In the Host the portfolio name links to the page through the module prefix.
  assert.match(overview, /:to="moduleUrl\(`\/portfolios\/\$\{group\.portfolio\.id\}`\)"/)
})

test('the page only calls registered Host routes through the module prefix', () => {
  const calls = [...page.matchAll(/moduleUrl\(`([^`]+)`\)/g)].map(match => match[1].replace(/\$\{[^}]+\}/g, ':x'))
  assert.deepEqual([...new Set(calls)].filter(path => path.startsWith('/api/')).sort(), [
    '/api/v1/portfolios/:x/doc-repo',
    '/api/v1/portfolios/:x/documents',
    '/api/v1/portfolios/:x/documents/:x',
    '/api/v1/portfolios/:x/documents/:x/policy',
    '/api/v1/portfolios/:x/members'
  ])
  // No raw fetch outside the module prefix, and no direct Codocs or Runtime call.
  assert.doesNotMatch(page, /\$fetch(?:<[^(]*>)?\(\s*['`]\//)
  assert.doesNotMatch(page, /\/v1\/enterprise\/|codocsUrl|tenant-runtime/)
})

test('writes carry an intent key and never send an owner, an actor or a relation of the caller', () => {
  for (const marker of ['portfolio-member:', 'portfolio-doc-repo:', 'portfolio-document:', 'portfolio-document-policy:']) {
    assert.ok(page.includes(`'Idempotency-Key': \`${marker}`), marker)
  }
  // Each request body runs from `body:` to the end of its $fetch options.
  const bodies = page.split('body: {').slice(1).map(part => part.slice(0, part.indexOf('\n    })'))).join('\n')
  assert.equal(page.split('body: {').length - 1, 5)
  assert.doesNotMatch(bodies, /projectId|portfolioId|actorUid|current_user|createdBy|ownerUid|canManage/)
  // The linked document's identity is generated once per attempt, not per retry.
  assert.match(page, /uuid: crypto\.randomUUID\(\) \}\n {2}showLink\.value = true/)
})

test('entries follow the server answers and the interaction rules', () => {
  // Visibility of every write entry comes from the server response.
  assert.match(page, /const canManage = computed\(\(\) => membersData\.value\?\.canManage === true\)/)
  assert.match(page, /const canLink = computed\(\(\) => documentsData\.value\?\.canLink === true\)/)
  assert.match(page, /const canManagePolicy = computed\(\(\) => documentsData\.value\?\.canManagePolicy === true\)/)
  // Dangerous actions use the shared confirm dialog; no native dialogs.
  assert.equal(page.split('await confirm({').length - 1, 2)
  assert.match(page, /tone: 'danger'/)
  assert.match(page, /tone: 'warning'/)
  assert.doesNotMatch(page, /window\.(?:confirm|alert|prompt)|[^.\w](?:alert|prompt)\(/)
  // Tables declare loading and an empty state; semantic colours only.
  assert.equal(page.split('<UTable').length - 1, 2)
  assert.equal(page.split(':loading="documentsLoading"').length + page.split(':loading="membersLoading"').length - 2, 2)
  assert.equal(page.split('<template #empty>').length - 1, 2)
  assert.doesNotMatch(page, /color="(?:red|green|blue|gray|yellow|orange)"/)
  // No content creation inside a portfolio, and the page says what to do instead.
  assert.match(page, /项目集下不能直接新建文档/)
  assert.doesNotMatch(page, /type="file"|multipart|contentBase64/)
  // Only Codocs documents with an existing source link to the read-only open page.
  assert.match(page, /v-if="!row\.original\.isFolder && !row\.original\.missingSource && row\.original\.documentSource !== 'repo'"\s+:to="moduleUrl\(`\/portfolios\/\$\{portfolioId\}\/documents\/\$\{row\.original\.id\}`\)"/)
  assert.match(page, /暂不支持在线查看/)
  // A cell slot that renders nothing falls back to the raw value (an English
  // enum, or a level on a folder row): every conditional cell has an else.
  for (const cell of ['accessConfidentialityLevel', 'accessLifecycleStage', 'inherit']) {
    const slot = page.slice(page.indexOf(`<template #${cell}-cell=`))
    assert.match(slot.slice(0, slot.indexOf('</template>\n                  <template #')), /<span v-else class="text-muted">—<\/span>/, cell)
  }
  // Narrow screens: no character-by-character wrapping; the wrapper scrolls.
  assert.equal(page.split(':ui="tableUi"').length - 1, 2)
  assert.match(page, /const tableUi = \{ th: 'whitespace-nowrap', td: 'whitespace-nowrap' \}/)
  assert.equal(page.split('<div class="overflow-x-auto">').length - 1, 2)
  // Empty-state text inside the no-wrap table still wraps.
  assert.equal(page.split('<div class="whitespace-normal">').length - 1, 2)
  for (const slot of page.split('<template #empty>').slice(1)) assert.match(slot.slice(0, 120), /<div class="whitespace-normal">\s*<CommonEmptyState/)
  // A policy owned elsewhere and a dangling reference are shown, not hidden.
  assert.match(page, /policy\?\.ownedElsewhere/)
  assert.match(page, /missingSource/)
})

test('the project documents page shows the portfolio section read only', () => {
  assert.match(projectDocuments, /portfolioSection\.value = res\.data\?\.portfolioDocuments \|\| null/)
  assert.match(projectDocuments, /portfolioSectionUnavailable\.value = res\.data\?\.portfolioDocumentsUnavailable === true/)
  assert.match(projectDocuments, /项目集文档暂不可用，不影响本项目文档。/)
  assert.match(projectDocuments, /:to="moduleUrl\(`\/portfolios\/\$\{portfolioSection\.portfolioId\}`\)"/)
})

test('the open page is registered, read only, and does not tell "forbidden" from "missing"', () => {
  const pages = registerBusinessPages([], businessModules, 'placeholder.vue')
  assert.ok(pages.some(entry => entry.path === '/aims/portfolios/:id/documents/:docId' && /enterprise-portfolio-document-open\.vue$/.test(entry.file)))
  const open = read('../../aims/layer/pages/enterprise-portfolio-document-open.vue')
  assert.match(open, /moduleUrl\(`\/api\/v1\/portfolios\/\$\{portfolioId\.value\}\/documents\/\$\{documentId\.value\}\/open`\)/)
  assert.match(open, /\[403, 404\]\.includes\(failure\.statusCode \|\| 0\)\s+\? '文档不存在，或你没有查看权限。'/)
  // Rendered as text: never v-html, no edit, download or collaboration entry.
  // Rendered by the shared safe Markdown component (raw HTML escaped, URL
  // protocols allow-listed); the page itself never injects HTML. Plain text
  // is the fallback when rendering fails or yields nothing.
  assert.doesNotMatch(open, /v-html|innerHTML|method: '(?:POST|PUT|DELETE)'|download|CodocsEditor|iframe/)
  assert.match(open, /import MarkdownContent from '\.\.\/\.\.\/app\/components\/MarkdownContent\.vue'/)
  assert.match(open, /<MarkdownContent v-if="renderable" :markdown="markdown"/)
  assert.match(open, /<pre v-else-if="markdown"/)
  // Long code lines and wide tables scroll inside the card, on this page only.
  assert.match(open, /\.portfolio-document-body :deep\(pre\) \{\s*max-width: 100%;\s*overflow-x: auto;/)
  assert.match(open, /\.portfolio-document-body :deep\(table\) \{\s*display: block;\s*max-width: 100%;\s*overflow-x: auto;/)
  assert.match(open, /<style scoped>/)
  const renderer = read('../../aims/app/utils/safeMarkdown.ts')
  assert.match(renderer, /renderer\.html = \(\{ text \}: Tokens\.HTML \| Tokens\.Tag\) => escapeHtml\(text\)/)
  assert.match(renderer, /const linkProtocols = new Set\(\['http:', 'https:', 'mailto:', 'tel:'\]\)/)
})
