import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { businessApiRoutes } from '../composition/business-api-routes.generated.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const util = read('../server/utils/enterpriseAimsPortfolios.ts')
const client = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
const spec = read('../../data-runtime/internal/server/enterprise_project_portfolios.go')
const delegated = read('../../data-runtime/internal/server/enterprise_delegated.go')
const accessible = read('../../data-runtime/internal/server/enterprise_project_document_accessible.go')
const aims = read('../../data-runtime/internal/apps/aims/portfolio_documents.go')
const members = read('../../data-runtime/internal/apps/aims/portfolio_members.go')
const codocs = read('../../data-runtime/internal/apps/codocs/enterprise_portfolio_document_access.go')
const projectPolicy = read('../../data-runtime/internal/apps/codocs/document_access.go')

// Document asset design DOC-05, batch 5b-1: portfolio documents, read only.
test('the portfolio document list is one fixed read inside the existing Aims Host capability', () => {
  assert.match(client, /'aims\.project-portfolio-documents-list': \{ path: '\/v1\/enterprise\/aims\/project-portfolios:documents-list' \}/)
  assert.match(spec, /"documents-list": \{\s*Method: http\.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,\s*Target:/)
  // The list itself takes no payload and no caller query key.
  const action = spec.slice(spec.indexOf('"documents-list": {'), spec.indexOf('"documents-create": {'))
  assert.doesNotMatch(action, /AllowPayload|QueryKeys/)
  // No new service capability or grant.
  assert.doesNotMatch(client + spec + util, /aims:portfolio|portfolio-documents:(?:read|write|execute)/)
  assert.ok(businessApiRoutes.some(([method, route]) => method === 'GET' && route === '/aims/api/v1/portfolios/:id/documents'))
})

test('Host requires portfolios:view and never supplies a relation', () => {
  const branch = util.slice(util.indexOf('operation === \'aims.project-portfolio-documents-list\''), util.indexOf('operation === \'aims.project-portfolio-members-list\''))
  assert.match(branch, /'portfolios', 'view'/)
  assert.doesNotMatch(branch, /current_user_can_manage_portfolios|relation/)
  const handler = util.slice(util.indexOf('export async function enterpriseAimsPortfolioDocumentList'), util.indexOf('const documentCreateKeys'))
  assert.match(handler, /Object\.keys\(getQuery\(event\)\)\.length\) throw createError\(\{ statusCode: 400/)
  assert.doesNotMatch(handler, /readBody|payload|actorUid|relation|ownerInactive/)
})

test('Runtime derives the relation from the signed actor and current rows', () => {
  assert.match(aims, /actor := strings\.TrimSpace\(query\.Get\("current_user"\)\)/)
  assert.match(aims, /ownerUID != "" && !facts\.inactive && ownerUID == actor/)
  assert.match(aims, /WHERE portfolio_id=\? AND uid=\? AND "\+portfolioMemberEffective/)
  assert.match(aims, /FROM aims_projects p WHERE p\.portfolio_id=\? AND \(p\.leader_uid=\? OR EXISTS \(\s*SELECT 1 FROM aims_project_members m WHERE m\.project_id=p\.id AND m\.uid=\? AND m\.status='active'\)\)/)
  assert.match(aims, /portfolio_document_relation_required/)
  // Only portfolio-owned rows; the project list keeps excluding them.
  assert.match(aims, /d\.portfolio_id = \? AND d\.project_id IS NULL AND d\.milestone_id IS NULL AND d\.work_item_id IS NULL/)
  // The body or query can never carry the relation or owner facts.
  assert.doesNotMatch(aims, /query\.Get\("(?:relation|portfolio_relation|owner_inactive)"\)|body\[/)
})

test('typed in-process dependencies are injected by the server only for relation operations', () => {
  assert.match(delegated, /spec\.Resource == "project-portfolios" && enterprisePortfolioRelationAction\(route\.Action\)/)
  assert.match(spec, /case "members-list", "members-save", "doc-repo-save", "documents-list", "documents-content", "documents-create", "documents-delete", "documents-policy":/)
  assert.match(spec, /aimsapp\.WithPortfolioOwnerStatus\(ctx, s\.directory\.EnterpriseActiveEmployee\)/)
  assert.match(spec, /s\.codocs\.CheckEnterprisePortfolioDocument\(ctx, uuid, ref, codocsapp\.EnterprisePortfolioDocumentFacts\{ActorUID: f\.ActorUID, PortfolioCode: f\.PortfolioCode, Relation: f\.Relation\}\)/)
  assert.match(spec, /s\.directory == nil \|\| \(documents && s\.codocs == nil\)/)
  // The project list gets the same dependencies for its read-only section.
  assert.match(accessible, /s\.enterprisePortfolioContext\(r\.Context\(\), verified\.ActorUID, true\)/)
  // No service token is signed for these calls (ADR-018a D11).
  assert.doesNotMatch(spec + aims + codocs, /ServiceToken|service-tokens|Authorization: Bearer/)
})

test('an inactive owner counts as no owner, bound to the locked row', () => {
  assert.match(members, /if f\.checked && f\.uid != lockedOwner \{\s*return httperror\.New\(http\.StatusConflict, "portfolio_owner_changed"/)
  assert.match(members, /facts, err := a\.portfolioOwnerPreRead\(ctx, id\)\s*if err != nil \{\s*return nil, err\s*\}\s*tx, tables, err := a\.beginPortfolioMemberTx\(ctx\)/)
  assert.equal(members.split('a.portfolioOwnerPreRead(ctx, id)').length - 1, 3)
})

test('Codocs policy: explicit portfolio ownership, L0/L1 inheritance only, no project-member shortcut', () => {
  assert.match(codocs, /matched := err == nil && ownerType == "portfolio" && ownerCode == f\.PortfolioCode/)
  assert.match(codocs, /stage, level, permission, inherit = "draft", "L2", "none", false/)
  assert.match(codocs, /case matched && \(level == "L0" \|\| level == "L1"\) && inherit:/)
  assert.match(codocs, /Readonly: true/)
  assert.doesNotMatch(codocs, /source_project_member|actorProjectCodes|isSourceProjectMember/)
  assert.match(codocs, /codocs_portfolio_policy_unavailable/)
  // The project path refuses a policy explicitly owned by something else.
  assert.match(projectPolicy, /isSourceProjectMember = ownerType == "project"/)
  // The reconcile only rewrites the owner of existing rows.
  assert.match(codocs, /UPDATE document_access_policies SET source_owner_type='portfolio', source_project_code=\?, updated_by=\? WHERE id=\?/)
  const reconcile = codocs.slice(codocs.indexOf('func (a *Adapter) ReconcilePortfolioPolicyOwners'))
  assert.doesNotMatch(reconcile, /INSERT INTO document_access_policies|DELETE FROM/)
})

// Batch 5b-2: linking, removing references and policy maintenance.
const writes = read('../../data-runtime/internal/apps/aims/portfolio_document_write.go')
const projectWrite = read('../../data-runtime/internal/apps/aims/enterprise_project_document_write.go')

test('portfolio document writes are three fixed operations with an intent key and no new capability', () => {
  for (const [name, method, extra] of [
    ['documents-create', 'http.MethodPost', 'AllowPayload: true'],
    ['documents-delete', 'http.MethodDelete', 'NeedsSub: true'],
    ['documents-policy', 'http.MethodPut', 'NeedsSub: true']
  ]) {
    assert.match(client, new RegExp(`'aims\\.project-portfolio-${name}': \\{ path: '/v1/enterprise/aims/project-portfolios:${name}' \\}`))
    const action = spec.slice(spec.indexOf(`"${name}": {`))
    assert.match(action.slice(0, 400), new RegExp(`Method: ${method.replace('.', '\\.')}, PermitAction: "edit", NeedsObject: true`))
    assert.ok(action.slice(0, 400).includes(extra), name)
    assert.doesNotMatch(action.slice(0, action.indexOf('},\n\t\t"')), /QueryKeys/)
  }
  assert.match(delegated, /resource == "project-portfolios" && \(action == "create" \|\| action == "update" \|\| action == "documents-create" \|\| action == "documents-delete" \|\| action == "documents-policy"\)/)
  assert.doesNotMatch(client + spec + util, /aims:portfolio|portfolio-documents:(?:read|write|execute)/)
  for (const [method, route] of [['POST', '/aims/api/v1/portfolios/:id/documents'], ['DELETE', '/aims/api/v1/portfolios/:id/documents/:docId'], ['PUT', '/aims/api/v1/portfolios/:id/documents/:docId/policy']]) {
    assert.ok(businessApiRoutes.some(([m, r]) => m === method && r === route), route)
  }
  // No content creation or upload inside a portfolio in this batch.
  assert.doesNotMatch(util.slice(util.indexOf('const documentCreateKeys')), /createCodocsDocument|uploadCodocs|readMultipartFormData|contentBase64/)
})

test('Host requires portfolios:edit, exact payloads, and freezes the repository commit itself', () => {
  const branch = util.slice(util.indexOf('documentWrites.has(operation)'), util.indexOf('operation === \'aims.project-portfolio-members-list\''))
  assert.match(branch, /'portfolios', 'edit'/)
  assert.doesNotMatch(branch, /current_user_can_manage_portfolios = '1'|relation/)
  const handlers = util.slice(util.indexOf('const documentCreateKeys'))
  assert.match(handlers, /exactPayload\(await payloadOf\(event\), documentCreateKeys/)
  assert.match(handlers, /exactPayload\(await payloadOf\(event\), documentPolicyKeys/)
  // Owner fields are simply not part of the accepted payload.
  assert.doesNotMatch(handlers.slice(0, handlers.indexOf('function requireDocumentID')), /projectId|portfolioId|milestoneId|workItemId|project_code|createdBy/)
  // The repository is the registered one, read server side; the commit is the one GitLab returns.
  assert.match(handlers, /portfolioCall<[^>]+>\(event, 'aims\.project-portfolio-members-list', \{ objectId \}\)/)
  assert.match(handlers, /getGitRepositoryFile\(\{ repoPath, path: filePath, commitId: selected \|\| undefined \}\)/)
  assert.match(handlers, /payload\.repoCommitId = file\.commitId/)
  assert.doesNotMatch(handlers, /payload\.repoProjectCode|repoPath: text\(payload/)
  assert.match(handlers, /idempotencyKey: requireIntentKey\(event\)/)
  assert.match(handlers, /`portfolio-document-delete:\$\{objectId\}:\$\{subId\}`/)
})

test('Runtime rechecks the relation on locked rows and confirms the share capability before its transaction', () => {
  assert.match(writes, /SELECT code,owner_uid FROM project_portfolios WHERE id=\? FOR UPDATE/)
  assert.match(writes, /WHERE portfolio_id=\? AND uid=\? AND "\+portfolioMemberEffective\+" FOR UPDATE/)
  assert.match(writes, /writer\.relation != "manager" && writer\.relation != "contributor"/)
  assert.match(writes, /if writer\.relation != "manager" \{\s*return nil, httperror\.New\(http\.StatusForbidden, "portfolio_document_manager_required"/)
  // Share check, then the write transaction.
  const create = writes.slice(writes.indexOf('func (a *Adapter) createPortfolioDocument'), writes.indexOf('func (a *Adapter) deletePortfolioDocument'))
  assert.ok(create.indexOf('check(ctx, codocsUUID, actor, checkedCode)') > 0)
  assert.ok(create.indexOf('check(ctx, codocsUUID, actor, checkedCode)') < create.indexOf('a.beginPortfolioMemberTx(ctx)'))
  // The body can never name an owner.
  assert.match(create, /case "uuid", "title", "parentId", "isFolder", "docCategory", "documentSource", "codocsUuid", "repoFilePath", "repoCommitId":/)
  // Policy: Codocs first (authoritative), mirror afterwards, same transaction window.
  const policy = writes.slice(writes.indexOf('func (a *Adapter) savePortfolioDocumentPolicy'))
  assert.ok(policy.indexOf('save(ctx, PortfolioDocumentPolicy{') < policy.indexOf('UPDATE project_documents SET access_lifecycle_stage'))
  // The project entry points still refuse portfolio-owned documents.
  assert.match(projectWrite, /project_document_portfolio_owner_unsupported/)
  assert.doesNotMatch(projectWrite, /portfolioDocumentWriter|createPortfolioDocument/)
})

test('Codocs: owner-only linking and a policy that is never taken over', () => {
  assert.match(codocs, /if owner != actor \{\s*return PortfolioDocumentLinkFacts\{\}, httperror\.New\(http\.StatusForbidden, "portfolio_document_share_required"/)
  assert.match(codocs, /case ownerType != "portfolio" \|\| code\.String != in\.PortfolioCode:\s*return nil, httperror\.New\(http\.StatusConflict, "portfolio_document_policy_owned_elsewhere"/)
  // The only policy insert is an explicit portfolio policy; the only updates keep the owner.
  assert.match(codocs, /VALUES \('codocs_document', \?, 'aims', 'portfolio', \?/)
  assert.doesNotMatch(codocs.slice(codocs.indexOf('func (a *Adapter) SaveEnterprisePortfolioDocumentPolicy'), codocs.indexOf('type PortfolioPolicyOwner struct')), /source_owner_type\s*=|source_project_code\s*=\s*\?/)
})

// Batch 5c-2: opening the content of a portfolio document.
test('content is opened through one fixed read that returns a locator to the Host only', () => {
  assert.match(client, /'aims\.project-portfolio-documents-content': \{ path: '\/v1\/enterprise\/aims\/project-portfolios:documents-content' \}/)
  const action = spec.slice(spec.indexOf('"documents-content": {'), spec.indexOf('"documents-create": {'))
  assert.match(action, /Method: http\.MethodGet, PermitAction: "view", NeedsObject: true, NeedsSub: true/)
  assert.doesNotMatch(action, /AllowPayload|QueryKeys/)
  assert.ok(businessApiRoutes.some(([method, route]) => method === 'GET' && route === '/aims/api/v1/portfolios/:id/documents/:docId/open'))
  assert.match(spec, /s\.codocs\.ReadEnterprisePortfolioDocument\(ctx, uuid, codocsapp\.EnterprisePortfolioDocumentFacts\{ActorUID: f\.ActorUID, PortfolioCode: f\.PortfolioCode, Relation: f\.Relation\}\)/)
  // portfolios:view on the Host, same branch as the list.
  assert.match(util, /operation === 'aims\.project-portfolio-documents-list' \|\| operation === 'aims\.project-portfolio-documents-content'/)
})

test('one decision core, and "not allowed" is "not found"', () => {
  // The list check and the content read share the decision.
  assert.equal(codocs.split('a.decidePortfolioDocument(ctx, uuid,').length - 1, 2)
  const read = codocs.slice(codocs.indexOf('func (a *Adapter) ReadEnterprisePortfolioDocument'), codocs.indexOf('func portfolioPolicyEtag'))
  // Document and policy are both read, and the decision audited, before the outcome is looked at.
  assert.ok(read.indexOf('FROM documents WHERE uuid = ?') < read.indexOf('a.decidePortfolioDocument('))
  assert.ok(read.indexOf('a.decidePortfolioDocument(') < read.indexOf('if !exists || !allowed {'))
  assert.match(read, /if !exists \|\| !allowed \{\s*return nil, portfolioDocumentNotFound\(\)/)
  assert.match(read, /a\.annotateSnapshotState\(ctx, \[\]map\[string\]any\{source\}, true\)/)
  // Aims answers the same 404 and takes the read path even when there is nothing to read.
  const content = aims.slice(aims.indexOf('func (a *Adapter) readPortfolioDocumentContent'))
  assert.match(content, /read\(ctx, portfolioDocumentProbeUUID, facts\)/)
  assert.match(content, /if found && !readable && access\.direct\(\) \{/)
  assert.doesNotMatch(content, /query\.Get\("(?:uuid|oss_path|relation)"\)/)
})

test('Host re-reads before releasing bytes and never returns the locator', () => {
  const open = util.slice(util.indexOf('export async function enterpriseAimsPortfolioDocumentOpen'))
  assert.match(open, /Object\.keys\(getQuery\(event\)\)\.length\) throw createError\(\{ statusCode: 400/)
  assert.ok(open.indexOf('const first = portfolioDocumentContent(await read(), subId)') < open.indexOf('withEnterpriseCodocsDocumentContent('))
  assert.ok(open.indexOf('withEnterpriseCodocsDocumentContent(') < open.indexOf('const current = portfolioDocumentContent(await read(), subId)'))
  assert.match(open, /\{ bodyRef: 'required' \}/)
  assert.match(open, /\['oss_path', 'updated_at', 'snapshot_generation', 'snapshot_ref', 'body_ref', 'doc_type'\]\.every\(same\)/)
  assert.match(open, /relationRank\[current\.data\.access\.relation!\]! < relationRank\[first\.data\.access\.relation!\]!/)
  assert.match(open, /permissionRank\[current\.data\.access\.permission!\]! < permissionRank\[first\.data\.access\.permission!\]!/)
  // The response is built field by field: no storage path, reference or UUID.
  const response = open.slice(open.indexOf('return {'))
  assert.doesNotMatch(response, /oss_path|snapshot_ref|body_ref|source: |uuid/)
  assert.doesNotMatch(open, /readBody|getRouterParam\(event, 'uuid'\)/)
})

test('Host portfolio update binds browser intent and version to the fenced owning writer', () => {
  assert.match(util, /typeof payload.expectedVersion !== 'string'/)
  assert.match(util, /getHeader\(event, 'Idempotency-Key'\)/)
  assert.match(delegated, /UpdateEnterprisePortfolio/)
  const writer = read('../../data-runtime/internal/apps/aims/enterprise_portfolio_update.go')
  assert.match(writer, /version != expected/)
  assert.match(writer, /portfolio_version_conflict/)
  assert.match(writer, /beginEnterpriseWrite/)
  assert.match(writer, /ExecuteInTransaction/)
})
