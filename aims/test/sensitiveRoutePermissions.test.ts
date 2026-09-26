import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { matchRouteRule, routeRuleRequirements } from '../app/config/permissions.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function modulePathExists(path: string) {
  return existsSync(new URL(`../${path}`, import.meta.url))
}

function moduleFileNames(path: string) {
  return readdirSync(new URL(`../${path}`, import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
}

function moduleFilePaths(path: string): string[] {
  return readdirSync(new URL(`../${path}`, import.meta.url), { withFileTypes: true })
    .flatMap((entry) => {
      const childPath = `${path}/${entry.name}`
      if (entry.isDirectory()) return moduleFilePaths(childPath)
      if (entry.isFile()) return [childPath]
      return []
    })
}

function assertGuardBefore(path: string, guard: string, protectedOperation: string) {
  const content = source(path)
  const guardIndex = content.indexOf(guard)
  const operationIndex = content.indexOf(protectedOperation)

  assert.notEqual(guardIndex, -1, `${path} missing ${guard}`)
  assert.notEqual(operationIndex, -1, `${path} missing ${protectedOperation}`)
  assert.ok(guardIndex < operationIndex, `${path} must check ${guard} before protected operation`)
}

describe('Aims sensitive route permissions', () => {
  test('server utils do not keep local DB fallback helpers', () => {
    const offenders = moduleFileNames('server/utils')
      .filter(name => name.endsWith('.ts') && name !== 'db.ts')
      .filter((name) => {
        const content = source(`server/utils/${name}`)
        return /server\/utils\/db|\.\/db|queryRows|queryRow|withTransaction|useDbPool/.test(content)
      })

    assert.deepEqual(offenders, [])
  })

  test('server API and middleware do not import local DB fallback helpers', () => {
    const files = [
      ...moduleFilePaths('server/api'),
      ...moduleFilePaths('server/middleware')
    ].filter(path => path.endsWith('.ts'))

    const offenders = files.filter((path) => {
      const content = source(path)
      return /server\/utils\/db|~~\/server\/utils\/db|\.{1,2}\/utils\/db|queryRows|queryRow|withTransaction|useDbPool|PoolConnection/.test(content)
    })

    assert.deepEqual(offenders, [])
  })

  test('auth permissions snapshot is sourced from Console runtime without local bundle fallback', () => {
    const content = source('server/api/auth/permissions.get.ts')

    assert.match(content, /loadAuthorizationSnapshotFromConsoleRuntime/)
    assert.match(content, /业务应用不再读取本地 policy bundle/)
    assert.doesNotMatch(content, /回退本地 Platform policy bundle/)
    assert.doesNotMatch(content, /loadAuthorizationFromCachedPlatformBundle/)
    assert.doesNotMatch(content, /loadAuthorizationFromPlatformBundle/)
  })

  test('legacy Account-named Directory compatibility routes require a verified Aims session', () => {
    const guardedRoutes = [
      'server/api/account/accessible-departments.get.ts',
      'server/api/account/business-domains.get.ts',
      'server/api/account/config-check.get.ts',
      'server/api/account/departments.get.ts',
      'server/api/account/projects/index.get.ts',
      'server/api/account/projects/index.post.ts',
      'server/api/account/user-departments.get.ts',
      'server/api/account/users/[uid].get.ts',
      'server/api/account/users/[uid]/projects.get.ts',
      'server/api/account/users/batch.post.ts',
      'server/api/account/users/index.get.ts'
    ]

    for (const path of guardedRoutes) {
      assert.match(source(path), /requireAimsSessionUid\(event\)|requireCurrentAimsSessionUid\(event,/)
    }

    const identity = source('server/utils/authIdentity.ts')
    assert.match(identity, /requireFoundationSessionUid/)
    assert.match(identity, /return await requireFoundationSessionUid\(event, message\)/)
    assert.doesNotMatch(identity, /resolveConsoleAuthWithSessionBridge/)
    assert.match(identity, /targetUid !== actorUid/)
    assert.doesNotMatch(identity, /accountApi|HZY_ACCOUNT_API/)
  })

  test('repository catalog verifies exact group access before reading the live paginated GitLab catalog', () => {
    const projects = source('server/api/account/projects/index.get.ts')

    assert.match(projects, /const uid = await requireAimsSessionUid\(event\)/)
    assert.match(projects, /`\/api\/v1\/users\/\$\{encodeURIComponent\(uid\)\}\/projects`/)
    assert.match(projects, /query\.parent_id \?\? query\.parentId/)
    assert.match(projects, /only_group:\s*'true'/)
    assert.match(projects, /queryText\(item\.projectCode\) === parentId/)
    assert.ok(
      projects.indexOf('groupItems.some(item => queryText(item.projectCode) === parentId)')
      < projects.lastIndexOf('listGitGroupProjects'),
      'exact Directory group access must be checked before the live GitLab catalog call'
    )
    assert.match(projects, /groupPath:\s*parentId/)
    assert.match(projects, /includeArchived:\s*false/)
    assert.doesNotMatch(projects, /\/api\/v1\/directory\/projects/)
  })

  test('product development initiation is blocked server-side until a repository is linked', () => {
    const middleware = source('server/middleware/project-manager-actions.ts')
    const settings = source('app/pages/projects/[id]/settings.vue')
    const overview = source('app/pages/projects/[id]/index.vue')
    const workflowPanel = workspaceSource('foundation/app/components/WorkflowPanel.vue')

    assert.match(middleware, /url\.pathname === '\/api\/workflow-proxy\/instances'/)
    assert.match(middleware, /workflowRequest\.actionCode === 'initiation'/)
    assert.match(middleware, /getProjectInitiationRepositoryIssue\(projectContext\.project\)/)
    assert.ok(
      middleware.indexOf('if (!projectContext.isManager)')
      < middleware.indexOf('getProjectInitiationRepositoryIssue(projectContext.project)'),
      'project manager authorization must run before the repository completeness check'
    )
    assert.match(settings, /getProjectInitiationRepositoryIssue\(project\.value\)/)
    assert.ok(
      settings.indexOf('getProjectInitiationRepositoryIssue(project.value)')
      < settings.indexOf('buildWorkflowAction(\'initiation\''),
      'the settings page must surface the repository issue before enabling initiation submission'
    )
    assert.match(overview, /form_data:\s*\{[\s\S]*actionCode:\s*'initiation'[\s\S]*projectId:\s*project\.value\.id/)
    assert.match(workflowPanel, /v-if="capabilities\.can_resubmit"[\s\S]*@click="handleLaunchSubmit"/)
    assert.match(workflowPanel, /async function handleLaunchSubmit\(\)[\s\S]*createInstance\(\{[\s\S]*form_data:\s*props\.launchPayload\.formData/)
  })

  test('routine containers cannot enter the project initiation workflow', () => {
    const middleware = source('server/middleware/project-manager-actions.ts')
    const settings = source('app/pages/projects/[id]/settings.vue')

    assert.match(middleware, /getProjectInitiationApplicabilityIssue\(projectContext\.project\)/)
    assert.match(middleware, /statusCode:\s*409/)
    assert.ok(
      middleware.indexOf('if (!projectContext.isManager)')
      < middleware.indexOf('getProjectInitiationApplicabilityIssue(projectContext.project)'),
      'manager authorization must run before the routine applicability check'
    )
    assert.match(settings, /if \(!projectRequiresInitiation\(project\.value\)\) return issues/)
    assert.match(settings, /!projectRequiresInitiation\(project\.value\)[^\n]*status === 'draft'/)
  })

  test('repository document picker surfaces API failures instead of reporting an empty repository', () => {
    const composable = source('app/composables/useAimsDocumentPicker.ts')
    const component = source('app/components/AimsDocumentPicker.vue')

    assert.match(composable, /const repoError = ref\(''\)/)
    assert.match(composable, /repoError\.value = extractRequestErrorMessage\(error/)
    assert.match(component, /v-else-if="repoError"/)
    assert.ok(
      component.indexOf('v-else-if="repoError"') < component.indexOf('!repoTree || repoTree.files.length === 0'),
      'the API error must be rendered before the empty repository state'
    )
  })

  test('legacy self-service Directory relationship reads bind the requested UID to the verified subject', () => {
    const departmentPath = 'server/api/account/user-departments.get.ts'
    const projectPath = 'server/api/account/users/[uid]/projects.get.ts'
    const departments = source('server/api/account/user-departments.get.ts')
    const projects = source('server/api/account/users/[uid]/projects.get.ts')

    assertGuardBefore(departmentPath, 'requireCurrentAimsSessionUid(event, uid)', 'fetchUserDepartments(event, actorUid)')
    assertGuardBefore(projectPath, 'requireCurrentAimsSessionUid(event, uid', 'encodeURIComponent(actorUid)')
    assert.doesNotMatch(departments, /fetchUserDepartments\(uid\)/)
    assert.doesNotMatch(projects, /encodeURIComponent\(uid\)\/projects/)
  })

  test('department proposal selection uses the authoritative accessible department set and source-bound list metadata', () => {
    const helper = source('server/utils/userDepartments.ts')
    const accessHelper = helper.slice(helper.indexOf('export async function hasDepartmentAccess'))
    const projectCreationPage = source('app/pages/projects/new.vue')

    assert.match(accessHelper, /await fetchAccessibleDepartments\(event, normalizedUid\)/)
    assert.doesNotMatch(accessHelper, /fetchUserDepartments/)
    assert.match(projectCreationPage, /proposalDepartmentDocuments\.value\.find\(doc => doc\.uuid === uuid\)/)
    assert.match(projectCreationPage, /readonlyFlag:\s*1/)
    assert.doesNotMatch(projectCreationPage, /codocs\/documents\/\$\{uuid\}\/summary/)
  })

  test('legacy Account-named Git document routes bind a verified project member to an exact linked repository', () => {
    for (const path of [
      'server/api/account/projects/docs-tree/[projectCode].get.ts',
      'server/api/account/projects/doc/[projectCode].get.ts'
    ]) {
      const content = source(path)
      assertGuardBefore(path, 'requireAimsSessionUid(event)', 'assertAimsProjectRepositoryAccess')
      assert.match(content, /aimsProjectId is required/)
      assert.match(
        content,
        /getRouterParam\(event, 'projectCode', \{ decode: true \}\)/,
        `${path} must decode repository codes containing a namespace separator`
      )
      const accessIndex = content.indexOf('await assertAimsProjectRepositoryAccess')
      assert.match(
        content,
        /repoPath:\s*projectCode/,
        `${path} must pass the verified GitLab repository path directly instead of resolving it as a Directory project code`
      )
      assert.doesNotMatch(content, /projectCode:\s*projectCode/)
      if (path.endsWith('doc/[projectCode].get.ts')) {
        assert.ok(accessIndex < content.lastIndexOf('getGitRepositoryFile'), `${path} must check repository access before Git file reads`)
      } else {
        assert.ok(accessIndex < content.lastIndexOf('listGitMarkdownTree'), `${path} must check repository access before Git tree reads`)
      }
    }

    const access = source('server/utils/projectDocumentAccess.ts')
    assert.match(access, /export async function assertAimsProjectRepositoryAccess/)
    assert.match(access, /\/v1\/aims\/projects\/\$\{encodeURIComponent\(String\(projectId\)\)\}\/repos/)
    assert.match(access, /projectContext\.isMember/)
    assert.match(access, /repoProjectCode.*repo_project_code/s)

    const picker = source('app/composables/useAimsDocumentPicker.ts')
    assert.match(picker, /aimsProjectId: aimsProjectId \|\| ''/)
    assert.match(picker, /params\.aimsProjectId = String\(options\.aimsProjectId\)/)

    const fileRoute = source('server/api/account/projects/doc/[projectCode].get.ts')
    assert.match(fileRoute, /commit_id:\s*data\.commitId/)
    assert.match(fileRoute, /last_commit_id:\s*data\.lastCommitId/)
    assert.match(fileRoute, /blob_id:\s*data\.blobId/)
  })

  test('disabled due reminder scheduler does not keep a Nuxt DB scanning plugin', () => {
    assert.equal(modulePathExists('server/plugins/due-reminder.ts'), false)
  })

  test('approval callbacks require projects/approve before forwarding to runtime', () => {
    for (const path of [
      'server/api/v1/requirement-reviews/[batchId]/approve.post.ts',
      'server/api/v1/requirement-reviews/[batchId]/reject.post.ts'
    ]) {
      assertGuardBefore(
        path,
        'requirePermission(event, \'projects\', \'approve\'',
        'const data = await forwardAimsRuntimePost'
      )
    }
    assertGuardBefore(
      'server/api/v1/milestones/[id]/completion-requests.post.ts',
      'requirePermission(event, \'projects\', \'edit\'',
      'const data = await forwardAimsRuntimePost'
    )
    assert.match(
      source('server/api/v1/milestones/[id]/review-approve.post.ts'),
      /statusCode: 410/
    )
  })

  test('direct approval decision handler is runtime-only without local DB fallback', () => {
    const content = source('server/api/v1/approvals/[id].put.ts')

    assert.match(content, /tenant-runtime is required to process approval decisions/)
    assert.doesNotMatch(content, /server\/utils\/db/)
    assert.doesNotMatch(content, /initializeProjectMilestonesOnActivation/)
    assert.doesNotMatch(content, /requirePermission/)
    assert.doesNotMatch(content, /getRequestUid/)
    assert.doesNotMatch(content, /readBody/)
    assert.doesNotMatch(content, /queryRow/)
    assert.doesNotMatch(content, /queryRows/)
    assert.doesNotMatch(content, /execute\(/)
    assert.doesNotMatch(content, /approval_records/)
    assert.doesNotMatch(content, /aims_projects/)
    assert.doesNotMatch(content, /milestones/)
    assert.doesNotMatch(content, /work_items/)
    assert.doesNotMatch(content, /UPDATE/i)
  })

  test('approval list is runtime forwarded without local DB fallback', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    assert.ok(middleware.includes('\'/approvals\''))
    assert.match(middleware, /context\.suffix === '\/approvals'/)
    assert.match(middleware, /context\.method === 'GET' && context\.suffix === '\/approvals'/)

    const content = source('server/api/v1/approvals/index.get.ts')
    assert.match(content, /tenant-runtime is required to list approvals/)
    assert.doesNotMatch(content, /server\/utils\/db/)
    assert.doesNotMatch(content, /getAimsOwnerEntity/)
    assert.doesNotMatch(content, /getRequestUid/)
    assert.doesNotMatch(content, /queryRow/)
    assert.doesNotMatch(content, /queryRows/)
    assert.doesNotMatch(content, /execute\(/)
    assert.doesNotMatch(content, /approval_records/)
  })

  test('direct requirement collection lists carry project visibility and scoped admin query', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const runtimeList = workspaceSource('data-runtime/internal/apps/aims/direct_requirement_lists.go')

    for (const suffix of ['/requirements', '/requirement-contents', '/requirement-reviews']) {
      assert.ok(middleware.includes(`context.suffix === '${suffix}'`), `${suffix} missing middleware suffix`)
      assert.ok(middleware.includes(`|| context.suffix === '${suffix}'`), `${suffix} missing project visibility/admin query branch`)
    }

    const routeIndex = runtimeWorkspace.indexOf('a.directRequirementCollectionList(ctx, path, query)')
    const genericIndex = runtimeWorkspace.indexOf('a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)')
    assert.notEqual(routeIndex, -1, 'runtime workspace must route direct requirement collections')
    assert.notEqual(genericIndex, -1, 'runtime workspace must still keep generic fallback')
    assert.ok(routeIndex < genericIndex, 'direct requirement collection route must run before generic fallback')
    assert.match(runtimeList, /JOIN aims_projects p ON p\.id = .*\.project_id/)
    assert.match(runtimeList, /projectVisibilityWhere\(query, "p", currentUser\)/)
    assert.match(runtimeList, /directRequirementListConfigs = map\[string\]directRequirementListConfig/)
  })

  test('direct work item collection list carries project visibility and scoped admin query', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const runtimeList = workspaceSource('data-runtime/internal/apps/aims/project_work_items.go')

    assert.ok(middleware.includes('context.suffix === \'/work-items\''), 'missing direct work-items suffix context')
    assert.match(middleware, /context\.method === 'GET' && \([\s\S]*context\.suffix === '\/work-items'[\s\S]*\) return true/)

    const routeIndex = runtimeWorkspace.indexOf('a.directWorkItems(ctx, query)')
    const detailIndex = runtimeWorkspace.indexOf('a.workItemDetail(ctx, workItemID, query)')
    const genericIndex = runtimeWorkspace.indexOf('a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)')
    assert.notEqual(routeIndex, -1, 'runtime workspace must route direct work item collection')
    assert.notEqual(detailIndex, -1, 'runtime workspace must still keep direct work item detail route')
    assert.notEqual(genericIndex, -1, 'runtime workspace must still keep generic fallback')
    assert.ok(routeIndex < detailIndex, 'direct work item collection route must run before detail route')
    assert.ok(routeIndex < genericIndex, 'direct work item collection route must run before generic fallback')
    assert.match(runtimeList, /JOIN aims_projects p ON p\.id = wi\.project_id/)
    assert.match(runtimeList, /projectVisibilityWhere\(query, "p", currentUser\)/)
    assert.match(runtimeList, /func \(a \*Adapter\) directWorkItems\(ctx context\.Context, query url\.Values\)/)
  })

  test('project list scoped admin relation scopes are carried into trusted runtime query', () => {
    const helper = source('server/utils/aimsScopedAuthorization.ts')
    const scopeCore = source('server/utils/aimsProjectListScopeCore.ts')
    const runtimeProjects = workspaceSource('data-runtime/internal/apps/aims/projects.go')

    assert.match(helper, /aimsProjectListAdminScopeQueryFromGrants\(scoped\.grants, context\)/)
    assert.match(scopeCore, /query\.current_user_project_admin_member_scope = '1'/)
    assert.match(scopeCore, /query\.current_user_project_admin_owner_scope = '1'/)
    assert.match(scopeCore, /predicate === 'code' && value/)
    assert.match(scopeCore, /current_user_project_admin_member_project_codes/)
    assert.match(scopeCore, /current_user_project_admin_owner_project_codes/)
    assert.doesNotMatch(helper, /__hzy_current_user_project_member__/)
    assert.doesNotMatch(helper, /__hzy_current_user_project_owner__/)

    assert.match(runtimeProjects, /func projectAdminCurrentUser\(query url\.Values\) string/)
    assert.match(runtimeProjects, /func projectAdminMemberScope\(query url\.Values\) bool/)
    assert.match(runtimeProjects, /func projectAdminOwnerScope\(query url\.Values\) bool/)
    assert.match(runtimeProjects, /projectAdminOwnerScope\(query\) && adminActor != ""/)
    assert.match(runtimeProjects, /projectAdminMemberScope\(query\) && adminActor != ""/)
    assert.match(runtimeProjects, /EXISTS \(SELECT 1 FROM aims_project_members pam WHERE pam\.project_id = %sid AND pam\.uid = \? AND pam\.status = 'active'\)/)
  })

  test('approval create is runtime forwarded without local DB fallback', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    assert.ok(middleware.includes('\'/approvals\''))

    const content = source('server/api/v1/approvals/index.post.ts')
    assert.match(content, /tenant-runtime is required to create approval records/)
    assert.doesNotMatch(content, /server\/utils\/db/)
    assert.doesNotMatch(content, /aimsOwners/)
    assert.doesNotMatch(content, /getRequestUid/)
    assert.doesNotMatch(content, /readBody/)
    assert.doesNotMatch(content, /queryRow/)
    assert.doesNotMatch(content, /queryRows/)
    assert.doesNotMatch(content, /execute\(/)
    assert.doesNotMatch(content, /approval_records/)
    assert.doesNotMatch(content, /resolveAimsOwnerColumns/)
    assert.doesNotMatch(content, /resolveAimsProjectContext/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const postIndex = runtimeWorkspace.indexOf('if method == http.MethodPost {')
    assert.notEqual(postIndex, -1, 'workspace runtime missing POST branch')
    const postSegment = runtimeWorkspace.slice(postIndex)
    const createIndex = postSegment.indexOf('a.createApprovalRecord(ctx, query, body)')
    const genericIndex = postSegment.indexOf('handleProjectScopedGenericRuntime')
    assert.notEqual(createIndex, -1, 'workspace runtime missing dedicated approval create route')
    assert.ok(genericIndex === -1 || createIndex < genericIndex, 'approval create route must run before generic runtime fallback')
  })

  test('runtime post forwarder carries actor only in trusted query', () => {
    const content = source('server/utils/aimsRuntimeForward.ts')

    assert.match(content, /function sanitizeRuntimeBody/)
    assert.match(content, /delete runtimeBody\.current_user/)
    assert.match(content, /delete runtimeBody\.operator_uid/)
    assert.match(content, /query: \{ \.\.\.\(options\.query \|\| \{\}\), current_user: options\.uid \}/)
    assert.match(content, /body: sanitizeRuntimeBody\(options\.body\)/)
    assert.doesNotMatch(content, /body:\s*\{\s*\.{3}\(options\.body \|\| \{\}\),\s*current_user: options\.uid\s*\}/)
    assert.doesNotMatch(content, /body:\s*\{\s*\.{3}\(options\.body \|\| \{\}\),\s*operator_uid: options\.uid\s*\}/)
  })

  test('work item confirmation/rejection callbacks require work_items/confirm before forwarding to runtime', () => {
    for (const path of [
      'server/api/v1/work-items/[id]/confirm-append.post.ts',
      'server/api/v1/work-items/[id]/reject-append.post.ts',
      'server/api/v1/work-items/[id]/confirm-distribute.post.ts'
    ]) {
      assertGuardBefore(
        path,
        'requirePermission(event, \'work_items\', \'confirm\'',
        'const data = await forwardAimsRuntimePost'
      )
    }
  })

  test('product asset service proxy requires Aims project view before requesting Assets service token', () => {
    const path = 'server/api/v1/product-assets.get.ts'
    const content = source(path)

    assert.match(content, /requirePermission\(event, 'projects', 'view'/)
    assert.match(content, /productLineLabel:\s*row\.productLineLabel \?\? row\.product_line_label/)
    assert.match(content, /productLineSortOrder:\s*row\.productLineSortOrder \?\? row\.product_line_sort_order/)
    assert.match(content, /resolveServiceAppBaseUrl\(event, 'assets', \{ directTarget: true \}\)/)
    assert.match(content, /trustedServiceRequestHeaders\(event, 'assets'\)/)
    assert.doesNotMatch(content, /function forwardedContextHeaders/)
    assertGuardBefore(
      path,
      'requirePermission(event, \'projects\', \'view\'',
      'const token = await requestServiceAccessToken'
    )
    assert.doesNotMatch(content, /server\/utils\/db/)
    assert.doesNotMatch(content, /queryRow/)
    assert.doesNotMatch(content, /queryRows/)
  })

  test('product management keeps Assets product line code case and uses service label', () => {
    const content = source('app/pages/admin/products.vue')
    const productDomainValueBlock = content.slice(
      content.indexOf('function productDomainValue'),
      content.indexOf('function productDomainRank')
    )
    const productDomainDisplayLabelBlock = content.slice(
      content.indexOf('function productDomainDisplayLabel'),
      content.indexOf('function productInvestmentStrategyDisplayLabel')
    )
    const productDomainRankBlock = content.slice(
      content.indexOf('function productDomainRank'),
      content.indexOf('function productDomainDisplayLabel')
    )

    assert.match(content, /productLineLabel\?: string \| null/)
    assert.match(content, /productLineSortOrder\?: number \| string \| null/)
    assert.match(productDomainValueBlock, /normalizeText\(product\.productLine \|\| product\.businessDomain/)
    assert.doesNotMatch(productDomainValueBlock, /normalizeDictionaryValue/)
    assert.match(productDomainRankBlock, /\.map\(productLineSortRank\)/)
    assert.match(productDomainRankBlock, /Math\.min\(\.\.\.definedRanks\)/)
    assert.match(content, /const items = \[\.\.\.products\.value\]\.sort\(compareProductCode\)/)
    assert.match(productDomainDisplayLabelBlock, /productLineLabel/)
    assert.match(productDomainDisplayLabelBlock, /return productDomainLabel\[normalized\] \|\| text/)
  })

  test('product version service API only accepts Assets service caller before runtime access', () => {
    const path = 'server/api/v1/service/products/[productCode]/versions.get.ts'
    const content = source(path)
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /requireServiceScope\(event, \{ scope: 'aims:read', allowedApps: \['assets'\] \}\)/)
    assert.doesNotMatch(content, /allowedApps: \['assets', 'altoc'\]/)
    assert.match(middleware, /method === 'GET' && \/\^\\\/service\\\/products\\\/\[\^\/\]\+\\\/versions\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'aims:read'[\s\S]{0,80}allowedApps: \['assets'\]/)
    assertGuardBefore(
      path,
      'requireServiceScope(event, { scope: \'aims:read\', allowedApps: [\'assets\'] })',
      'const productCode = String(getRouterParam(event, \'productCode\') || \'\').trim()'
    )
    assertGuardBefore(
      path,
      'requireServiceScope(event, { scope: \'aims:read\', allowedApps: [\'assets\'] })',
      'const runtime = await maybeCallTenantRuntime'
    )
  })

  test('project cost summary service APIs forward to runtime and require Finance or People service callers', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('if (/^\\/service\\/projects\\/[^/]+\\/cost-summary$/.test(suffix)) return method === \'GET\''))
    assert.ok(content.includes('if (/^\\/service\\/projects\\/[^/]+\\/cost-summary:recalculate$/.test(suffix)) return method === \'POST\''))
    assert.match(content, /method === 'GET' && \/\^\\\/service\\\/projects\\\/\[\^\/\]\+\\\/cost-summary\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'aims:read'[\s\S]{0,80}allowedApps: \['finance', 'people'\]/)
    assert.match(content, /\/\^\\\/service\\\/projects\\\/\[\^\/\]\+\\\/cost-summary:recalculate\$\/\.test\(suffix\)[\s\S]{0,120}scope: 'aims:write'[\s\S]{0,80}allowedApps: \['finance', 'people'\]/)
    assert.doesNotMatch(content, /cost-summary[\s\S]{0,180}allowedApps: \['altoc'/)
    assert.doesNotMatch(content, /cost-summary[\s\S]{0,180}allowedApps: \['assets'/)
    assertGuardBefore(
      path,
      'requireForwardedServiceCapability(event)',
      'maybeProxyCurrentApiToTenantRuntime(event'
    )

    const runtime = workspaceSource('data-runtime/internal/apps/aims/project_cost_summary.go')
    assert.match(runtime, /handleProjectCostSummaryRuntime/)
    assert.match(runtime, /\/v1\/aims\/service\/projects\//)
    assert.match(runtime, /\/cost-summary/)
    assert.match(runtime, /\/cost-summary:recalculate/)
  })

  test('unknown service-only Aims paths are rejected before tenant-runtime proxy', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assertGuardBefore(
      path,
      'requireForwardedServiceCapability(event)',
      'maybeProxyCurrentApiToTenantRuntime(event'
    )
    assert.match(content, /suffix\.startsWith\('\/service\/'\)[\s\S]{0,160}Unsupported Aims service endpoint capability/)
  })

  test('work item completion callback has the same Workflow-only service gate as existing callbacks', () => {
    const content = source('server/middleware/tenant-runtime.ts')
    const nuxtOnly = content.split('const NUXT_ONLY_PATTERNS = [')[1]?.split('\n]')[0] || ''
    assert.match(nuxtOnly, /\^\\\/api\\\/v1\\\/service\\\/work-item-completion\\\/workflow-callback\$/)
    assert.match(content, /if \(NUXT_ONLY_PATTERNS\.some\(pattern => pattern\.test\(apiPath\)\)\) return true/)
    assert.match(
      content,
      /suffix === '\/service\/workflow\/callback' \|\| suffix === '\/service\/work-item-completion\/workflow-callback'\)\s*\{\s*return \{ scope: 'workflow:callback', allowedApps: \['workflow'\] \}/
    )
    assertGuardBefore(
      'server/middleware/tenant-runtime.ts',
      'requireForwardedServiceCapability(event)',
      'maybeProxyCurrentApiToTenantRuntime(event'
    )
    const handler = source('server/api/v1/service/work-item-completion/workflow-callback.post.ts')
    assert.match(handler, /requireServiceScope\(event, \{ scope: 'workflow:callback', allowedApps: \['workflow'\] \}\)/)
  })

  test('requirements export requires reports/export before reading runtime export data', () => {
    assertGuardBefore(
      'server/api/v1/projects/[id]/requirements/export.get.ts',
      'requirePermission(event, \'reports\', \'export\'',
      'const runtime = await maybeCallTenantRuntime'
    )
  })

  test('weekly report summary export carries project visibility scope into runtime query', () => {
    const path = 'server/api/v1/weekly-reports/export.get.ts'
    const content = source(path)

    assertGuardBefore(
      path,
      'checkPermission(event, \'reports\', \'export\'',
      'const runtime = await maybeCallTenantRuntime'
    )
    assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(content, /query: await buildAimsProjectListRuntimeAccessQuery\(event, \{\s*uid,\s*baseQuery:/s)
    assert.match(content, /current_user_can_view_weekly_report_summary: '1'/)
    assert.match(content, /includeWorkItems: '1'/)
  })

  test('weekly report project progress fields use controlled options and previous snapshots', () => {
    const content = source('app/pages/projects/[id]/weekly-reports.vue')
    const currentStageIndex = content.indexOf('label="当前阶段"')
    const progressStatusIndex = content.indexOf('label="进度情况"')
    const previousProgressIndex = content.indexOf('label="上期进度"')
    const completionIndex = content.indexOf('label="总体完成进度"')
    const contractStatusIndex = content.indexOf('label="合同状态"')
    const contractAmountIndex = content.indexOf('label="合同额"')
    const previousLaborCostIndex = content.indexOf('label="已填报人力成本"')
    const cumulativeLaborCostIndex = content.indexOf('label="累计人力成本"')

    assert.match(content, /const milestoneStore = useMilestoneStore\(\)/)
    assert.match(content, /const progressStatusOptions = \[[\s\S]*正常推进[\s\S]*超出计划[\s\S]*落后计划[\s\S]*严重滞后/)
    assert.match(content, /const contractStatusOptions = \[[\s\S]*未签订[\s\S]*已签订[\s\S]*已完成/)
    assert.match(content, /currentStageReadonly/)
    assert.match(content, /previousProgressDisplay/)
    assert.match(content, /previousLaborCostDisplay/)
    assert.ok(currentStageIndex >= 0 && progressStatusIndex > currentStageIndex)
    assert.ok(previousProgressIndex > progressStatusIndex && completionIndex > previousProgressIndex)
    assert.ok(contractStatusIndex > completionIndex && contractAmountIndex > contractStatusIndex)
    assert.ok(previousLaborCostIndex > contractAmountIndex && cumulativeLaborCostIndex > previousLaborCostIndex)
  })

  test('work item decompose submit carries project scoped admin list query', () => {
    const path = 'server/api/v1/work-items/[id]/decompose-submit.post.ts'
    const content = source(path)

    assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(content, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
    assertGuardBefore(
      path,
      'const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery',
      'const runtime = await maybeCallTenantRuntime'
    )
    assert.match(content, /query: runtimeQuery/)
    assert.match(content, /const runtimeBody = \{ \.\.\.\(body \|\| \{\}\) \}/)
    assert.match(content, /delete runtimeBody\.current_user/)
    assert.match(content, /delete runtimeBody\.operator_uid/)
    assert.match(content, /delete runtimeBody\.uid/)
    assert.match(content, /body: runtimeBody/)
    assert.doesNotMatch(content, /body:\s*\{\s*\.{3}body,\s*current_user: uid\s*\}/)
  })

  test('work item decompose context read carries project scoped admin list query and runtime guard', () => {
    const path = 'server/api/v1/work-items/[id]/decompose-context.get.ts'
    const content = source(path)

    assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(content, /query: await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
    assertGuardBefore(
      path,
      'query: await buildAimsProjectListRuntimeAccessQuery',
      'const runtimeData = unwrapRuntimeData'
    )

    const runtime = workspaceSource('data-runtime/internal/apps/aims/decompose_context.go')
    const workItemIndex = runtime.indexOf('itemRow, err := a.decomposeWorkItem(ctx, workItemID)')
    const guardIndex = runtime.indexOf('a.requireProjectMemberOrScopedAdmin(ctx, itemRow.workItem.ProjectID, uid, query)')
    const sourceProjectIndex = runtime.indexOf('sourceProjectCodes, err := a.decomposeSourceProjectCodes')
    assert.notEqual(workItemIndex, -1, 'runtime must read the target work item project context')
    assert.notEqual(guardIndex, -1, 'runtime must guard decompose context by project member or scoped admin')
    assert.notEqual(sourceProjectIndex, -1, 'runtime must still return source project candidates')
    assert.ok(workItemIndex < guardIndex, 'runtime guard needs resolved work item project context')
    assert.ok(guardIndex < sourceProjectIndex, 'runtime guard must run before source project code reads')
  })

  test('work item breakdown and append writes carry project scoped admin list query', () => {
    for (const path of [
      'server/api/v1/work-items/[id]/breakdown.put.ts',
      'server/api/v1/work-items/[id]/append-tasks.post.ts',
      'server/api/v1/work-items/[id]/revoke-distribute.post.ts'
    ]) {
      const content = source(path)

      assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
      assert.match(content, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
      assertGuardBefore(
        path,
        'const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery',
        'const data = await forwardAimsRuntimePost'
      )
      assert.match(content, /query: runtimeQuery/)
    }
  })

  test('work item breakdown context read is runtime forwarded without local DB fallback', () => {
    const middlewarePath = 'server/middleware/tenant-runtime.ts'
    assertGuardBefore(
      middlewarePath,
      'if (context.method === \'GET\' && /^\\/work-items\\/[^/]+\\/breakdown-context$/.test(context.suffix)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )

    const handlerSource = source('server/api/v1/work-items/[id]/breakdown-context.get.ts')
    assert.match(handlerSource, /tenant-runtime is required to read work item breakdown context/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /hasWorkItemStartDateColumn/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /work_items/)
    assert.doesNotMatch(handlerSource, /deliverables/)
    assert.doesNotMatch(handlerSource, /project_documents/)
    assert.doesNotMatch(handlerSource, /approval_records/)
  })

  test('work item clone from template carries project scoped admin list query', () => {
    const path = 'server/api/v1/work-items/[id]/clone-from-template.post.ts'
    const content = source(path)

    assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(content, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
    assertGuardBefore(
      path,
      'const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery',
      'const data = await forwardAimsRuntimePost'
    )
    assert.match(content, /query: runtimeQuery/)
  })

  test('requirement derived writes carry project scoped admin list query', () => {
    for (const path of [
      'server/api/v1/requirements/[reqId]/create-task.post.ts',
      'server/api/v1/requirements/[reqId]/changes/index.post.ts',
      'server/api/v1/requirement-contents/[contentId]/restore.post.ts'
    ]) {
      const content = source(path)

      assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
      assert.match(content, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
      assertGuardBefore(
        path,
        'const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery',
        'const data = await forwardAimsRuntimePost'
      )
      assert.match(content, /query: runtimeQuery/)
    }
  })

  test('project requirement content create is runtime forwarded with scoped admin query and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /RUNTIME_NESTED_RESOURCES/)
    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/requirement-contents$/'))
    assert.match(content, /const needsAdminListScopeContext = needsProjectScopedAdminListContext\(context\)/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)

    const handlerSource = source('server/api/v1/projects/[id]/requirement-contents.post.ts')
    assert.match(handlerSource, /tenant-runtime is required to create requirement content/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /requirementContentCreate/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /readBody/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /assertProjectActive/)
    assert.doesNotMatch(handlerSource, /requirement_contents/)
    assert.doesNotMatch(handlerSource, /project_documents/)
  })

  test('project requirement create is runtime forwarded with scoped admin query and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /RUNTIME_NESTED_RESOURCES/)
    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/requirements$/'))
    assert.match(content, /const needsAdminListScopeContext = needsProjectScopedAdminListContext\(context\)/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)

    const handlerSource = source('server/api/v1/projects/[id]/requirements/index.post.ts')
    assert.match(handlerSource, /tenant-runtime is required to create requirements/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /requirementTarget/)
    assert.doesNotMatch(handlerSource, /requirementCode/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /readBody/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /assertProjectActive/)
    assert.doesNotMatch(handlerSource, /requirement_items/)
    assert.doesNotMatch(handlerSource, /requirement_item_contents/)
    assert.doesNotMatch(handlerSource, /project_documents/)
  })

  test('requirement detail read is runtime forwarded with scoped admin query and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isRequirementDetailRuntimePath/)
    assert.ok(content.includes('context.method === \'GET\''))
    assert.ok(content.includes('/^\\/requirements\\/[^/]+$/.test(context.suffix)'))
    assertGuardBefore(
      path,
      'if (isRequirementDetailRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )
    assert.match(content, /\|\| isRequirementDetailRuntimePath\(context\)/)

    const handlerSource = source('server/api/v1/requirements/[reqId]/index.get.ts')
    assert.match(handlerSource, /tenant-runtime is required to read requirement detail/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /requirement_items/)
    assert.doesNotMatch(handlerSource, /requirement_contents/)
    assert.doesNotMatch(handlerSource, /work_items/)
    assert.doesNotMatch(handlerSource, /requirement_versions/)
  })

  test('requirement metadata update is runtime forwarded with scoped admin query and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN/)
    assert.match(content, /requirements/)
    assert.match(content, /\|\| isRequirementDetailRuntimePath\(context\)/)
    assert.match(content, /const needsAdminListScopeContext = needsProjectScopedAdminListContext\(context\)/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)

    const handlerSource = source('server/api/v1/requirements/[reqId]/index.patch.ts')
    assert.match(handlerSource, /tenant-runtime is required to update requirement metadata/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /readBody/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /requirement_items/)
    assert.doesNotMatch(handlerSource, /project_documents/)
    assert.doesNotMatch(handlerSource, /UPDATE\s+requirement_items/i)
  })

  test('requirement delete is runtime forwarded with scoped admin query and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN/)
    assert.match(content, /requirements/)
    assert.match(content, /const needsAdminListScopeContext = needsProjectScopedAdminListContext\(context\)/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)

    const handlerSource = source('server/api/v1/requirements/[reqId]/index.delete.ts')
    assert.match(handlerSource, /tenant-runtime is required to delete or deprecate requirements/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /PoolConnection/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /connection\./)
    assert.doesNotMatch(handlerSource, /requirement_items/)
    assert.doesNotMatch(handlerSource, /requirement_contents/)
    assert.doesNotMatch(handlerSource, /requirement_item_contents/)
    assert.doesNotMatch(handlerSource, /project_documents/)
  })

  test('requirement content update and delete are runtime forwarded with scoped admin query and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN/)
    assert.match(content, /requirement-contents/)
    assert.match(content, /const needsAdminListScopeContext = needsProjectScopedAdminListContext\(context\)/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)

    const updateSource = source('server/api/v1/requirement-contents/[contentId]/index.patch.ts')
    assert.match(updateSource, /tenant-runtime is required to update requirement content/)
    assert.doesNotMatch(updateSource, /server\/utils\/db/)
    assert.doesNotMatch(updateSource, /getRequestUid/)
    assert.doesNotMatch(updateSource, /readBody/)
    assert.doesNotMatch(updateSource, /queryRow/)
    assert.doesNotMatch(updateSource, /queryRows/)
    assert.doesNotMatch(updateSource, /execute\(/)
    assert.doesNotMatch(updateSource, /useDbPool/)
    assert.doesNotMatch(updateSource, /requirement_contents/)
    assert.doesNotMatch(updateSource, /requirement_item_contents/)
    assert.doesNotMatch(updateSource, /project_documents/)

    const deleteSource = source('server/api/v1/requirement-contents/[contentId]/index.delete.ts')
    assert.match(deleteSource, /tenant-runtime is required to delete or deprecate requirement content/)
    assert.doesNotMatch(deleteSource, /server\/utils\/db/)
    assert.doesNotMatch(deleteSource, /getRequestUid/)
    assert.doesNotMatch(deleteSource, /useDbPool/)
    assert.doesNotMatch(deleteSource, /PoolConnection/)
    assert.doesNotMatch(deleteSource, /queryRow/)
    assert.doesNotMatch(deleteSource, /queryRows/)
    assert.doesNotMatch(deleteSource, /execute\(/)
    assert.doesNotMatch(deleteSource, /connection\./)
    assert.doesNotMatch(deleteSource, /requirement_contents/)
    assert.doesNotMatch(deleteSource, /requirement_item_contents/)
    assert.doesNotMatch(deleteSource, /project_documents/)
  })

  test('requirement review project writes carry project scoped admin list query', () => {
    for (const path of [
      'server/api/v1/requirement-reviews/[batchId]/create-tasks.post.ts',
      'server/api/v1/requirement-reviews/[batchId]/append-requirements.post.ts',
      'server/api/v1/requirement-reviews/[batchId]/withdraw.post.ts'
    ]) {
      const content = source(path)

      assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
      assert.match(content, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
      assertGuardBefore(
        path,
        'const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery',
        'const data = await forwardAimsRuntimePost'
      )
      assert.match(content, /query: runtimeQuery/)
    }
  })

  test('project environment user writes preflight before side effects and carry project scoped admin query', () => {
    for (const path of [
      'server/api/v1/projects/[id]/environments/upsert.post.ts',
      'server/api/v1/projects/[id]/environments/[environmentCommand].post.ts'
    ]) {
      const content = source(path)

      assert.match(content, /buildAimsProjectListRuntimeAccessQuery/)
      assert.match(content, /assertProjectEnvironmentWriteAccess\(project\)/)
      assert.match(content, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
      assert.match(content, /query: runtimeQuery/)
      assertGuardBefore(
        path,
        'assertProjectEnvironmentWriteAccess(project)',
        path.includes('upsert') ? 'const environment = await callAssetsService' : 'const statusUpdate = await forwardAimsRuntimePost'
      )
      assertGuardBefore(
        path,
        'const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery',
        path.includes('upsert') ? 'const aimsUpsert = await forwardAimsRuntimePost' : 'const statusUpdate = await forwardAimsRuntimePost'
      )
    }
  })

  test('direct project object writes receive trusted project scoped admin list query in runtime middleware', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function needsProjectScopedAdminListContext/)
    assert.match(content, /\(context\.method === 'PATCH' \|\| context\.method === 'PUT' \|\| context\.method === 'DELETE'\)/)
    assert.match(content, /DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN/)
    for (const resource of ['deliverables', 'milestones', 'requirements', 'requirement-contents', 'requirement-reviews', 'work-items']) {
      assert.match(content, new RegExp(resource))
    }
    assert.match(content, /const needsAdminListScopeContext = needsProjectScopedAdminListContext\(context\)/)
    assert.match(content, /Object\.assign\(sanitizedQuery, await resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)\)/)
  })

  test('work item commit reads and writes are runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemCommitRuntimePath/)
    assert.match(content, /function isWorkItemCommitWritePath/)
    assert.ok(content.includes('context.method === \'GET\' && /^\\/work-items\\/[^/]+\\/commits$/.test(context.suffix)'))
    assert.ok(content.includes('context.method === \'POST\' && /^\\/work-items\\/[^/]+\\/commits$/.test(context.suffix)'))
    assert.ok(content.includes('context.method === \'DELETE\' && /^\\/work-items\\/[^/]+\\/commits\\/[^/]+$/.test(context.suffix)'))
    assertGuardBefore(
      path,
      'if (isWorkItemCommitWritePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )
    assert.match(content, /\|\| isWorkItemCommitRuntimePath\(context\)/)

    for (const handler of [
      'server/api/v1/work-items/[id]/commits.get.ts',
      'server/api/v1/work-items/[id]/commits.post.ts',
      'server/api/v1/work-items/[id]/commits/[commitId].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /UPDATE\s+gitlab_commits/i)
    }
  })

  test('work item commit diff keeps Git integration in BFF and moves DB facts to runtime', () => {
    const handlerSource = source('server/api/v1/work-items/[id]/commits/[commitId]/diff.get.ts')

    assert.match(handlerSource, /getGitCommitDiff/)
    assert.match(handlerSource, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(handlerSource, /forwardAimsRuntimeGet/)
    assert.match(handlerSource, /forwardAimsRuntimePost/)
    assert.match(handlerSource, /\/diff-metadata/)
    assert.match(handlerSource, /\/files-changed/)
    assert.match(handlerSource, /repoPath:\s*repoProjectCode/)
    assert.doesNotMatch(handlerSource, /projectCode:\s*repoProjectCode/)
    assertGuardBefore(
      'server/api/v1/work-items/[id]/commits/[commitId]/diff.get.ts',
      'const commit = await forwardAimsRuntimeGet',
      'const data = await getGitCommitDiff'
    )
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /gitlab_commits/)
  })

  test('Aims repository bindings are passed to GitLab as repository paths', () => {
    const syncHandler = source('server/api/v1/projects/[id]/sync-gitlab.post.ts')
    assert.match(syncHandler, /repoPath:\s*repo\.repoProjectCode/)
    assert.doesNotMatch(syncHandler, /projectCode:\s*repo\.repoProjectCode/)
  })

  test('work item comment reads and writes are runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemCommentRuntimePath/)
    assert.ok(content.includes('(context.method === \'GET\' || context.method === \'POST\')'))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/comments$/.test(context.suffix)'))
    assert.match(content, /\|\| isWorkItemCommentRuntimePath\(context\)/)

    for (const handler of [
      'server/api/v1/work-items/[id]/comments.get.ts',
      'server/api/v1/work-items/[id]/comments.post.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /work_item_comments/)
    }
  })

  test('work item document reads and writes are runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemDocumentRuntimePath/)
    assert.ok(content.includes('(context.method === \'GET\' || context.method === \'POST\' || context.method === \'DELETE\')'))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/documents$/.test(context.suffix)'))
    assert.ok(content.includes('context.method === \'DELETE\''))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/documents\\/[^/]+$/.test(context.suffix)'))
    assert.match(content, /\|\| isWorkItemDocumentRuntimePath\(context\)/)

    for (const handler of [
      'server/api/v1/work-items/[id]/documents.get.ts',
      'server/api/v1/work-items/[id]/documents.post.ts',
      'server/api/v1/work-items/[id]/documents.delete.ts',
      'server/api/v1/work-items/[id]/documents/[documentId].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /projectPermission/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /project_documents/)
      assert.doesNotMatch(handlerSource, /work_items/)
    }
  })

  test('work item deliverable evidence/status updates are runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemDeliverableRuntimePath/)
    assert.ok(content.includes('(context.method === \'PATCH\' || context.method === \'PUT\')'))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/deliverables\\/[^/]+$/.test(context.suffix)'))
    assertGuardBefore(
      path,
      'if (isWorkItemDeliverableRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )
    assert.match(content, /\|\| isWorkItemDeliverableRuntimePath\(context\)/)

    const handlerSource = source('server/api/v1/work-items/[id]/deliverables/[deliverableId].patch.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /UPDATE\s+deliverables/i)
  })

  test('work item submit approval is runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemSubmitRuntimePath/)
    assert.ok(content.includes('context.method === \'POST\''))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/submit$/.test(context.suffix)'))
    assertGuardBefore(
      path,
      'if (isWorkItemSubmitRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )
    assert.match(content, /\|\| isWorkItemSubmitRuntimePath\(context\)/)

    const handlerSource = source('server/api/v1/work-items/[id]/submit.post.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /INSERT INTO approval_records/i)
    assert.doesNotMatch(handlerSource, /UPDATE\s+work_items/i)
  })

  test('work item approval withdraw is runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemWithdrawRuntimePath/)
    assert.ok(content.includes('context.method === \'POST\''))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/withdraw$/.test(context.suffix)'))
    assertGuardBefore(
      path,
      'if (isWorkItemWithdrawRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )
    assert.match(content, /\|\| isWorkItemWithdrawRuntimePath\(context\)/)

    const handlerSource = source('server/api/v1/work-items/[id]/withdraw.post.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /approval_records/i)
    assert.doesNotMatch(handlerSource, /UPDATE\s+work_items/i)
  })

  test('deliverable batch create is runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isDeliverableBatchRuntimePath/)
    assert.ok(content.includes('context.method === \'POST\''))
    assert.ok(content.includes('context.suffix === \'/deliverables/batch\''))
    assertGuardBefore(
      path,
      'if (isDeliverableBatchRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )
    assert.match(content, /\|\| isDeliverableBatchRuntimePath\(context\)/)

    const handlerSource = source('server/api/v1/deliverables/batch.post.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /resolveAimsProjectContext/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /INSERT INTO deliverables/i)
  })

  test('work item batch update is runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemBatchRuntimePath/)
    assert.ok(content.includes('context.method === \'PATCH\''))
    assert.ok(content.includes('context.suffix === \'/work-items/batch\''))
    assertGuardBefore(
      path,
      'if (isWorkItemBatchRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )
    assert.match(content, /\|\| isWorkItemBatchRuntimePath\(context\)/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const patchIndex = runtimeWorkspace.indexOf('if method == http.MethodPatch || method == http.MethodPut {')
    assert.notEqual(patchIndex, -1, 'runtime missing PATCH/PUT branch')
    const patchSegment = runtimeWorkspace.slice(patchIndex)
    const batchIndex = patchSegment.indexOf('a.batchUpdateWorkItems(ctx, query, body)')
    const directIndex = patchSegment.indexOf('directPathParam(path, "/v1/aims/work-items/")')
    assert.notEqual(batchIndex, -1, 'runtime missing work item batch update route')
    assert.notEqual(directIndex, -1, 'runtime missing direct work item update route')
    assert.ok(batchIndex < directIndex, 'work item batch route must run before direct work item update')

    const handlerSource = source('server/api/v1/work-items/batch.patch.ts')
    assert.match(handlerSource, /tenant-runtime is required to update work items in batch/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getProjectLifecycleStatus/)
    assert.doesNotMatch(handlerSource, /validateTransition/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /readBody/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /work_items/)
    assert.doesNotMatch(handlerSource, /work_item_changelog/)
    assert.doesNotMatch(handlerSource, /workflow_transitions/)
  })

  test('work item batch update requires edit permission before runtime forwarding reads the request body', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)
    const guardStart = content.indexOf('async function enforceWorkItemBatchUpdateApiAccess')
    const guardEnd = content.indexOf('async function enforceProjectDocumentDeleteApiAccess', guardStart)

    assert.notEqual(guardStart, -1, 'batch edit permission guard is required')
    assert.notEqual(guardEnd, -1, 'batch edit permission guard must remain a bounded helper')
    assertGuardBefore(path, 'await enforceWorkItemBatchUpdateApiAccess(event, pathname)', 'const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime')

    const guard = content.slice(guardStart, guardEnd)
    assert.match(guard, /method !== 'PATCH' \|\| apiPath !== '\/api\/v1\/work-items\/batch'/)
    assert.match(guard, /requirePermission\(event, 'work_items', 'edit'/)
  })

  test('direct deliverable list and writes are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('context.suffix === \'/deliverables\''))
    assert.match(content, /DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN/)
    assert.match(content, /deliverables/)
    assert.match(content, /\|\| isDeliverableBatchRuntimePath\(context\)/)
    const scopedAdminListBlock = content.slice(
      content.indexOf('function needsProjectScopedAdminListContext'),
      content.indexOf('function needsProductAdminContext')
    )
    assert.match(scopedAdminListBlock, /context\.method === 'GET' && \([\s\S]*context\.suffix === '\/deliverables'[\s\S]*\) return true/)

    for (const handler of [
      'server/api/v1/deliverables/index.get.ts',
      'server/api/v1/deliverables/[id].put.ts',
      'server/api/v1/deliverables/[id].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /UPDATE\s+deliverables\s+SET/i)
      assert.doesNotMatch(handlerSource, /DELETE FROM deliverables/i)
    }
  })

  test('milestone detail is runtime forwarded with project visibility and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isMilestoneDetailRuntimePath/)
    assert.ok(content.includes('/^\\/milestones\\/[^/]+\\/detail$/.test(context.suffix)'))
    assert.ok((content.match(/isMilestoneDetailRuntimePath\(context\)/g) || []).length >= 3)

    const handlerSource = source('server/api/v1/milestones/[id]/detail.get.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /fetchMilestoneDeliverables/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /work_items/)
    assert.doesNotMatch(handlerSource, /deliverables/)
  })

  test('direct milestone collection list carries project visibility and scoped admin query', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const runtimeMilestones = workspaceSource('data-runtime/internal/apps/aims/project_milestones.go')

    assert.ok(middleware.includes('context.suffix === \'/milestones\''), 'missing direct milestones suffix context')
    assert.match(middleware, /context\.method === 'GET' && \([\s\S]*context\.suffix === '\/milestones'[\s\S]*\) return true/)

    const directIndex = runtimeWorkspace.indexOf('a.handleDirectMilestonesRuntime(ctx, method, path, query, body)')
    const genericIndex = runtimeWorkspace.indexOf('a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)')
    assert.notEqual(directIndex, -1, 'runtime workspace must route direct milestones before generic fallback')
    assert.notEqual(genericIndex, -1, 'runtime workspace must still keep generic fallback')
    assert.ok(directIndex < genericIndex, 'direct milestones runtime must run before generic fallback')
    assert.match(runtimeMilestones, /path == "\/v1\/aims\/milestones"/)
    assert.match(runtimeMilestones, /func \(a \*Adapter\) listDirectMilestones\(ctx context\.Context, query url\.Values\)/)
    assert.match(runtimeMilestones, /JOIN aims_projects p ON p\.id = m\.project_id/)
    assert.match(runtimeMilestones, /projectVisibilityWhere\(query, "p", currentUser\)/)
  })

  test('direct milestone reads and writes are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isDirectMilestoneRuntimePath/)
    assert.ok(content.includes('(context.method === \'GET\''))
    assert.ok(content.includes('|| context.method === \'PATCH\''))
    assert.ok(content.includes('|| context.method === \'PUT\''))
    assert.ok(content.includes('|| context.method === \'DELETE\''))
    assert.ok(content.includes('/^\\/milestones\\/[^/]+$/.test(context.suffix)'))
    assert.ok((content.match(/isDirectMilestoneRuntimePath\(context\)/g) || []).length >= 3)

    for (const handler of [
      'server/api/v1/milestones/[id].get.ts',
      'server/api/v1/milestones/[id].put.ts',
      'server/api/v1/milestones/[id].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /milestoneDeliverables/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /work_items/)
      assert.doesNotMatch(handlerSource, /deliverables/)
      assert.doesNotMatch(handlerSource, /UPDATE\s+milestones/i)
      assert.doesNotMatch(handlerSource, /DELETE FROM milestones/i)
    }
  })

  test('project duplicate check is runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('context.method === \'GET\' && context.suffix === \'/projects/check-duplicate\''))

    const handlerSource = source('server/api/v1/projects/check-duplicate.get.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /aims_projects/)
  })

  test('project list and direct project object routes are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('\'/projects\''))
    assert.ok(content.includes('context.method === \'GET\' && context.suffix === \'/projects\''))
    assert.match(content, /function needsProjectObjectAdminContext/)
    assert.ok(content.includes('if (!/^\\/(?:admin\\/)?projects\\/[^/]+$/.test(context.suffix)) return false'))
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)
    assert.match(content, /async function enforceProjectCreateApiAccess/)
    assert.match(content, /requirePermission\(event, 'projects', 'create'/)
    assertGuardBefore(
      path,
      'await enforceProjectCreateApiAccess(event, pathname)',
      'maybeProxyCurrentApiToTenantRuntime(event'
    )

    for (const handler of [
      'server/api/v1/projects/index.get.ts',
      'server/api/v1/projects/index.post.ts',
      'server/api/v1/projects/[id].get.ts',
      'server/api/v1/projects/[id].put.ts',
      'server/api/v1/projects/[id].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /hasGlobalProjectAdmin/)
      assert.doesNotMatch(handlerSource, /requireProjectMember/)
      assert.doesNotMatch(handlerSource, /requireProjectManager/)
      assert.doesNotMatch(handlerSource, /hardDeleteProject/)
      assert.doesNotMatch(handlerSource, /initializeProjectMilestonesOnActivation/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /aims_projects/)
      assert.doesNotMatch(handlerSource, /aims_project_members/)
    }
  })

  test('project workspace route relies on runtime scoped authorization instead of coarse route guard', () => {
    const config = source('app/config/permissions.ts')
    const projectPage = source('app/pages/projects/index.vue')
    const projectStore = source('app/stores/project.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.equal(matchRouteRule('/projects'), null)
    assert.equal(matchRouteRule('/aims/projects'), null)
    assert.equal(matchRouteRule('/admin')?.resource, 'admin')
    assert.equal(matchRouteRule('/weekly-reports')?.resource, 'reports')
    assert.deepEqual(routeRuleRequirements(matchRouteRule('/admin/projects')!), [
      { resource: 'projects', action: 'admin' },
      { resource: 'admin', action: 'admin' }
    ])
    assert.deepEqual(routeRuleRequirements(matchRouteRule('/admin/project-templates')!), [
      { resource: 'project_templates', action: 'admin' },
      { resource: 'admin', action: 'admin' }
    ])
    assert.deepEqual(routeRuleRequirements(matchRouteRule('/admin/products')!), [
      { resource: 'admin', action: 'admin' }
    ])

    assert.doesNotMatch(config, /pattern:\s*['"]\/projects(?:\/\*\*)?['"]/)
    assert.match(projectPage, /projectStore\.fetchProjects\(buildProjectListQuery\(\)\)/)
    // 同一份 store 供独立应用与企业宿主使用，路径统一经 moduleUrl；
    // 非宿主模式下它原样返回，断言的仍是"走 runtime 列表接口"这一事实。
    assert.match(projectStore, /\$fetch<\{ code: number, data: PaginatedList<RawAimsProject> \}>\(\s*moduleUrl\(`\/api\/v1\/projects/)
    assert.match(projectStore, /const \{ moduleUrl \} = useAimsModule\(\)/)
    assert.ok(middleware.includes('context.method === \'GET\' && context.suffix === \'/projects\''))
    assert.match(middleware, /resolveCurrentUserProjectVisibilityContext\(context\.event, context\.currentUser\)/)
    assert.match(middleware, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)
  })

  test('admin project routes accept precise project administration access and have no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('\'/admin/projects\''))
    assertGuardBefore(
      path,
      'await enforceAimsAdminApiAccess(event, pathname)',
      'maybeProxyCurrentApiToTenantRuntime(event'
    )
    assert.match(content, /async function enforceAimsAdminApiAccess/)
    assert.match(content, /suffix !== '\/admin' && !suffix\.startsWith\('\/admin\/'\)/)
    assert.match(content, /suffix === '\/admin\/projects' \|\| suffix\.startsWith\('\/admin\/projects\/'\)/)
    assert.match(content, /await requireAimsProjectManageAccess\(event\)/)
    assert.match(content, /await requireAimsAdminRoleAccess\(event\)/)
    assert.match(content, /function needsProjectObjectAdminContext/)
    assert.ok(content.includes('if (!/^\\/(?:admin\\/)?projects\\/[^/]+$/.test(context.suffix)) return false'))

    for (const handler of [
      'server/api/v1/admin/projects/index.get.ts',
      'server/api/v1/admin/projects/[id].patch.ts',
      'server/api/v1/admin/projects/[id].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /requireAimsAdminRoleAccess/)
      assert.doesNotMatch(handlerSource, /initializeProjectMilestonesOnActivation/)
      assert.doesNotMatch(handlerSource, /getProjectDeletionImpact/)
      assert.doesNotMatch(handlerSource, /hardDeleteProject/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /getQuery/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /useDbPool/)
      assert.doesNotMatch(handlerSource, /aims_projects/)
      assert.doesNotMatch(handlerSource, /approval_records/)
      assert.doesNotMatch(handlerSource, /work_items/)
    }
  })

  test('project member reads and writes are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/members$/.test(context.suffix)'))
    assert.ok(content.includes('return context.method === \'GET\' || context.method === \'POST\' || context.method === \'DELETE\''))

    for (const handler of [
      'server/api/v1/projects/[id]/members.get.ts',
      'server/api/v1/projects/[id]/members.post.ts',
      'server/api/v1/projects/[id]/members.delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /requireProjectManager/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /aims_projects/)
      assert.doesNotMatch(handlerSource, /aims_project_members/)
      assert.doesNotMatch(handlerSource, /work_items/)
    }
  })

  test('project requirement review reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/requirement-reviews$/'))
    assert.ok(content.includes('if (RUNTIME_NESTED_RESOURCES.some(pattern => pattern.test(context.suffix))) return context.method === \'GET\' || context.method === \'POST\''))

    const handlerSource = source('server/api/v1/projects/[id]/requirement-reviews.get.ts')
    assert.match(handlerSource, /tenant-runtime is required to read project requirement reviews/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /getRouterParam/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /requirement_review_batches/)
    assert.doesNotMatch(handlerSource, /requirement_items/)
    assert.doesNotMatch(handlerSource, /milestones/)
  })

  test('project requirement review create and workflow sync do not fall back to local DB', () => {
    const createSource = source('server/api/v1/projects/[id]/requirement-reviews.post.ts')
    assert.match(createSource, /tenant-runtime is required to create requirement review batches/)
    assert.doesNotMatch(createSource, /server\/utils\/db/)
    assert.doesNotMatch(createSource, /getRequestUid/)
    assert.doesNotMatch(createSource, /readBody/)
    assert.doesNotMatch(createSource, /queryRow/)
    assert.doesNotMatch(createSource, /queryRows/)
    assert.doesNotMatch(createSource, /execute\(/)
    assert.doesNotMatch(createSource, /useDbPool/)
    assert.doesNotMatch(createSource, /requirement_review_batches/)
    assert.doesNotMatch(createSource, /requirement_items/)

    const syncSource = source('server/api/v1/requirement-reviews/[batchId]/sync-workflow.post.ts')
    assert.match(syncSource, /callAimsRuntime/)
    assert.match(syncSource, /requestServiceAccessToken/)
    assert.doesNotMatch(syncSource, /server\/utils\/db/)
    assert.doesNotMatch(syncSource, /queryRow/)
    assert.doesNotMatch(syncSource, /queryRows/)
    assert.doesNotMatch(syncSource, /execute\(/)
    assert.doesNotMatch(syncSource, /useDbPool/)
    assert.doesNotMatch(syncSource, /requirement_review_batches/)
    assert.doesNotMatch(syncSource, /requirement_items/)
    assert.match(syncSource, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(syncSource, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{\s*uid,\s*baseQuery: \{ operator_uid: uid \}\s*\}\)/s)
    assert.doesNotMatch(syncSource, /query: \{ current_user: uid/)
    assert.doesNotMatch(syncSource, /current_user: uid/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const postIndex = runtimeWorkspace.indexOf('if method == http.MethodPost {')
    assert.notEqual(postIndex, -1, 'workspace runtime missing POST branch')
    const postSegment = runtimeWorkspace.slice(postIndex)
    const createIndex = postSegment.indexOf('a.createRequirementReviewBatch(ctx, projectID, query, body)')
    const syncIndex = postSegment.indexOf('a.syncRequirementReviewWorkflow(ctx, batchID, query, body)')
    const genericIndex = postSegment.indexOf('handleProjectScopedGenericRuntime')
    assert.notEqual(createIndex, -1, 'workspace runtime missing requirement review create route')
    assert.notEqual(syncIndex, -1, 'workspace runtime missing requirement review sync route')
    assert.ok(genericIndex === -1 || createIndex < genericIndex, 'requirement review create route must run before generic runtime fallback')
  })

  test('requirement review resolve carries scoped project context before runtime detail read', () => {
    const resolveSource = source('server/api/v1/requirement-reviews/[batchId]/resolve.get.ts')

    assert.match(resolveSource, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(resolveSource, /query: await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
    assert.doesNotMatch(resolveSource, /query: \{ current_user: uid \}/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const routeIndex = runtimeWorkspace.indexOf('directPathParam(path, "/v1/aims/requirement-reviews/")')
    const genericIndex = runtimeWorkspace.indexOf('handleProjectScopedGenericRuntime')
    assert.notEqual(routeIndex, -1, 'workspace runtime missing direct requirement review route')
    assert.notEqual(genericIndex, -1, 'workspace runtime missing generic fallback')
    assert.ok(routeIndex < genericIndex, 'requirement review detail route must run before generic fallback')

    const runtimeReviews = workspaceSource('data-runtime/internal/apps/aims/requirement_reviews.go')
    const detailIndex = runtimeReviews.indexOf('func (a *Adapter) requirementReviewBatchDetail')
    const detailSegment = runtimeReviews.slice(detailIndex)
    const loadIndex = detailSegment.indexOf('a.loadRequirementReviewBatch')
    const guardIndex = detailSegment.indexOf('a.requireProjectMemberOrScopedAdmin(ctx, batch.projectID, uid, query)')
    const responseIndex = detailSegment.indexOf('return map[string]any')
    assert.notEqual(detailIndex, -1, 'runtime missing guarded requirement review detail handler')
    assert.notEqual(loadIndex, -1, 'runtime detail handler must load batch project facts')
    assert.notEqual(guardIndex, -1, 'runtime detail handler must check project member or scoped admin')
    assert.notEqual(responseIndex, -1, 'runtime detail handler must return response')
    assert.ok(loadIndex < guardIndex, 'runtime detail handler must resolve project before guard')
    assert.ok(guardIndex < responseIndex, 'runtime detail handler must guard before response')
  })

  test('project requirement review create receives trusted scoped project admin context from middleware', () => {
    const content = source('server/middleware/tenant-runtime.ts')
    const objectAdminStart = content.indexOf('function needsProjectObjectAdminContext')
    const objectAdminEnd = content.indexOf('function needsProjectScopedAdminListContext')
    const nestedStart = content.indexOf('function projectScopedNestedCollection')
    const nestedEnd = content.indexOf('function projectScopedNestedCollectionSupportsWrite')
    const writableStart = content.indexOf('function projectScopedNestedCollectionSupportsWrite')
    const writableEnd = content.indexOf('function projectProductVersionPath')
    const queryStart = content.indexOf('const needsAdminListScopeContext = needsProjectScopedAdminListContext(context)')
    const queryEnd = content.indexOf('function needsProjectVisibilityContext')

    for (const [name, index] of [
      ['needsProjectObjectAdminContext', objectAdminStart],
      ['projectScopedNestedCollection', nestedStart],
      ['projectScopedNestedCollectionSupportsWrite', writableStart],
      ['needsAdminListScopeContext query block', queryStart]
    ] as const) {
      assert.notEqual(index, -1, `missing ${name}`)
    }

    const objectAdminBlock = content.slice(objectAdminStart, objectAdminEnd)
    const nestedBlock = content.slice(nestedStart, nestedEnd)
    const writableBlock = content.slice(writableStart, writableEnd)
    const queryBlock = content.slice(queryStart, queryEnd)

    assert.match(nestedBlock, /'requirement-reviews'/)
    assert.match(writableBlock, /'requirement-reviews'/)
    assert.match(objectAdminBlock, /context\.method === 'POST' && projectScopedNestedCollectionSupportsWrite\(scopedNested\.collection\)/)
    assert.match(queryBlock, /Object\.assign\(sanitizedQuery, await resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)\)/)
  })

  test('requirement version reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isRequirementVersionRuntimePath/)
    assert.ok(content.includes('if (isRequirementVersionRuntimePath(context)) return true'))
    assert.match(content, /\|\| isRequirementVersionRuntimePath\(context\)/)
    assertGuardBefore(
      path,
      'if (isRequirementVersionRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )

    const handlerSource = source('server/api/v1/requirements/[reqId]/versions.get.ts')
    assert.match(handlerSource, /tenant-runtime is required to read requirement versions/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /getRouterParam/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /requirement_versions/)
    assert.doesNotMatch(handlerSource, /requirement_items/)
  })

  test('requirement change diff reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isRequirementChangeDiffRuntimePath/)
    assert.ok(content.includes('if (isRequirementChangeDiffRuntimePath(context)) return true'))
    assert.match(content, /\|\| isRequirementChangeDiffRuntimePath\(context\)/)
    assertGuardBefore(
      path,
      'if (isRequirementChangeDiffRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )

    const handlerSource = source('server/api/v1/requirements/[reqId]/change-diff.get.ts')
    assert.match(handlerSource, /tenant-runtime is required to read requirement change diff/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /getRouterParam/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /requirement_item_contents/)
    assert.doesNotMatch(handlerSource, /requirement_contents/)
    assert.doesNotMatch(handlerSource, /requirement_items/)
  })

  test('requirement change impact reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isRequirementChangeImpactRuntimePath/)
    assert.ok(content.includes('if (isRequirementChangeImpactRuntimePath(context)) return true'))
    assert.match(content, /\|\| isRequirementChangeImpactRuntimePath\(context\)/)
    assertGuardBefore(
      path,
      'if (isRequirementChangeImpactRuntimePath(context)) return true',
      'if (NUXT_ONLY_MARKERS.some(marker => context.suffix.includes(marker))) return false'
    )

    const handlerSource = source('server/api/v1/requirements/[reqId]/change-impact.get.ts')
    assert.match(handlerSource, /tenant-runtime is required to read requirement change impact/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /getRouterParam/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /useDbPool/)
    assert.doesNotMatch(handlerSource, /work_items/)
    assert.doesNotMatch(handlerSource, /requirement_items/)
  })

  test('project document reads and writes are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('\'/documents\''))
    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/documents$/.test(context.suffix)'))
    assert.ok(content.includes('return context.method === \'GET\''))
    assert.ok(content.includes('|| context.method === \'POST\''))
    assert.ok(content.includes('|| context.method === \'PUT\''))
    assert.ok(content.includes('|| context.method === \'PATCH\''))
    assert.match(content, /DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN = .*documents/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)
    const visibilityBlock = content.slice(
      content.indexOf('function needsProjectVisibilityContext'),
      content.indexOf('function needsProjectObjectAdminContext')
    )
    const scopedAdminListBlock = content.slice(
      content.indexOf('function needsProjectScopedAdminListContext'),
      content.indexOf('function needsProductAdminContext')
    )
    assert.match(visibilityBlock, /context\.suffix === '\/documents'/)
    assert.match(scopedAdminListBlock, /context\.suffix === '\/documents'/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const documentUpdateOperationIndex = runtimeWorkspace.indexOf('operation = "aims.documents.update"')
    const documentUpdateGuardIndex = runtimeWorkspace.lastIndexOf('requireDirectProjectDocumentMemberOrScopedAdmin', documentUpdateOperationIndex)
    assert.notEqual(documentUpdateOperationIndex, -1, 'runtime missing direct document update branch')
    assert.notEqual(documentUpdateGuardIndex, -1, 'runtime document update branch must guard direct document writes')
    assert.ok(documentUpdateGuardIndex < documentUpdateOperationIndex)

    for (const handler of [
      'server/api/v1/documents/index.get.ts',
      'server/api/v1/documents/[id].put.ts',
      'server/api/v1/projects/[id]/documents.get.ts',
      'server/api/v1/projects/[id]/documents.post.ts',
      'server/api/v1/projects/[id]/documents.put.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /projectDocumentBinding/)
      assert.doesNotMatch(handlerSource, /codocsApi/)
      assert.doesNotMatch(handlerSource, /getCodocsDocumentSummary/)
      assert.doesNotMatch(handlerSource, /documentOwners/)
      assert.doesNotMatch(handlerSource, /requireProjectDocumentMember/)
      assert.doesNotMatch(handlerSource, /resolveDocumentOwnerContext/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /project_documents/)
      assert.doesNotMatch(handlerSource, /aims_projects/)
    }
  })

  test('direct document create keeps Codocs orchestration but has no local DB fallback', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    assert.match(middleware, /context\.method === 'POST' && context\.suffix === '\/documents'\) return false/)
    assert.ok(middleware.includes('/^\\/api\\/v1\\/documents$/'))

    const handlerSource = source('server/utils/projectDocumentWrites.ts')
    assert.match(handlerSource, /callAimsRuntime/)
    assert.match(handlerSource, /createCodocsDocument/)
    assert.match(handlerSource, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(handlerSource, /const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery\(event, \{\s*uid,\s*baseQuery: \{ operator_uid: uid \}\s*\}\)/s)
    assert.match(handlerSource, /query: runtimeQuery/)
    assert.doesNotMatch(handlerSource, /current_user: uid/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /documentOwners/)
    assert.doesNotMatch(handlerSource, /resolveDocumentOwnerContext/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /project_documents/)

    const runtimeSource = workspaceSource('data-runtime/internal/apps/aims/project_documents.go')
    assert.match(runtimeSource, /func \(a \*Adapter\) createDirectDocument/)
    assert.match(runtimeSource, /resolveDirectDocumentOwnerContext/)
    assert.match(runtimeSource, /directDocumentParentOwnerContext/)
    assert.match(runtimeSource, /requireProjectMemberOrScopedAdmin/)
  })

  test('project markdown and other document creation writes use scoped query instead of body actor fields', () => {
    for (const path of [
      'server/utils/projectDocumentWrites.ts',
      'server/utils/projectDocumentUpload.ts'
    ]) {
      const content = source(path)
      const handlerSource = path.endsWith('projectDocumentWrites.ts') ? content.slice(content.indexOf('export async function createProjectMarkdownDocument')) : content
      assert.match(handlerSource, /buildAimsProjectRuntimeAccessQuery/)
      assert.match(handlerSource, /baseQuery: \{ operator_uid: uid \}/)

      const writeIndex = handlerSource.indexOf('\'/v1/aims/documents\'')
      assert.notEqual(writeIndex, -1, `${path} missing final document index write`)
      const writeSegment = handlerSource.slice(writeIndex, handlerSource.indexOf('\n  )', writeIndex))
      assert.match(writeSegment, /query: projectAccessQuery/)
      assert.doesNotMatch(writeSegment, /current_user: uid/)
      assert.doesNotMatch(writeSegment, /operator_uid: uid/)
    }
  })

  test('direct document delete uses trusted scoped runtime query for final delete', () => {
    const handlerSource = source('server/utils/projectDocumentWrites.ts')

    assert.match(handlerSource, /requireProjectDocumentDeleteAccess/)
    assert.match(handlerSource, /deleteCodocsProjectCabinetFile/)
    assert.match(handlerSource, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(handlerSource, /query: await buildAimsProjectListRuntimeAccessQuery\(event, \{\s*uid,\s*baseQuery: \{ operator_uid: uid \}\s*\}\)/s)
    assert.doesNotMatch(handlerSource, /query: \{ current_user: uid/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /project_documents/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const documentDeleteOperationIndex = runtimeWorkspace.indexOf('operation = "aims.documents.delete"')
    const documentDeleteGuardIndex = runtimeWorkspace.lastIndexOf('requireDirectProjectDocumentDeleteAccess', documentDeleteOperationIndex)
    assert.notEqual(documentDeleteOperationIndex, -1, 'runtime missing direct document delete branch')
    assert.notEqual(documentDeleteGuardIndex, -1, 'runtime document delete branch must guard direct document delete')
    assert.ok(documentDeleteGuardIndex < documentDeleteOperationIndex)
  })

  test('project document access policy write carries scoped query instead of body actor fields', () => {
    const handlerSource = source('server/utils/projectDocumentAccessPolicy.ts')

    assert.match(handlerSource, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(handlerSource, /query: await buildAimsProjectListRuntimeAccessQuery\(event, \{\s*uid,\s*baseQuery: \{ operator_uid: uid \}\s*\}\)/s)
    assert.doesNotMatch(handlerSource, /body:\s*\{[\s\S]*current_user: uid[\s\S]*\}/)
    assert.doesNotMatch(handlerSource, /body:\s*\{[\s\S]*operator_uid: uid[\s\S]*\}/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const documentUpdateOperationIndex = runtimeWorkspace.indexOf('operation = "aims.documents.update"')
    const documentUpdateGuardIndex = runtimeWorkspace.lastIndexOf('requireDirectProjectDocumentMemberOrScopedAdmin', documentUpdateOperationIndex)
    assert.notEqual(documentUpdateOperationIndex, -1, 'runtime missing direct document update branch')
    assert.notEqual(documentUpdateGuardIndex, -1, 'runtime document update branch must guard direct document update')
    assert.ok(documentUpdateGuardIndex < documentUpdateOperationIndex)
  })

  test('project document access helper uses runtime facts instead of local document owner DB fallback', () => {
    const helperSource = source('server/utils/projectDocumentAccess.ts')

    assert.match(helperSource, /getRuntimeDocument/)
    assert.match(helperSource, /resolveRuntimeDocumentProjectId/)
    assert.match(helperSource, /buildAimsProjectRuntimeAccessQuery/)
    assert.match(helperSource, /async function buildRuntimeFactAccessQuery/)
    assert.match(helperSource, /return await buildAimsProjectListRuntimeAccessQuery\(event, \{\s*uid,\s*baseQuery: \{ operator_uid: uid \}\s*\}\)/s)
    assert.match(helperSource, /query: await buildRuntimeFactAccessQuery\(event, uid\)/)
    assert.match(helperSource, /const isScopedProjectAdmin = projectAccessQuery\.current_user_is_project_admin === '1'/)
    assert.match(helperSource, /const isManager = .* \|\| isScopedProjectAdmin/)
    assert.doesNotMatch(helperSource, /query: \{ current_user: uid, operator_uid: uid \}/)
    assert.doesNotMatch(helperSource, /documentOwners/)
    assert.doesNotMatch(helperSource, /getDocumentOwnerContext/)
    assert.doesNotMatch(helperSource, /resolveDocumentProjectContext/)
    assert.doesNotMatch(helperSource, /requireProjectDocumentMember/)
    assert.doesNotMatch(helperSource, /requireProjectDocumentManager/)
    assert.doesNotMatch(helperSource, /server\/utils\/db/)
    assert.doesNotMatch(helperSource, /queryRow/)
    assert.doesNotMatch(helperSource, /queryRows/)
    assert.doesNotMatch(helperSource, /project_documents/)
  })

  test('project repo reads and writes are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isProjectRepoRuntimePath/)
    assert.ok(content.includes('(context.method === \'GET\' || context.method === \'POST\' || context.method === \'DELETE\')'))
    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/repos$/.test(context.suffix)'))
    assert.ok(content.includes('context.method === \'DELETE\' && scopedNested.collection === \'repos\''))
    assert.ok(content.includes('if (isProjectRepoRuntimePath(context)) return true'))

    for (const handler of [
      'server/api/v1/projects/[id]/repos.get.ts',
      'server/api/v1/projects/[id]/repos.post.ts',
      'server/api/v1/projects/[id]/repos.delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /projectPermission/)
      assert.doesNotMatch(handlerSource, /requireProjectManager/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /aims_projects/)
      assert.doesNotMatch(handlerSource, /aims_project_repos/)
    }
  })

  test('project GitLab commit reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/gitlab-commits$/'))

    const handlerSource = source('server/api/v1/projects/[id]/gitlab-commits.get.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /getQuery/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /gitlab_commits/)
  })

  test('project milestone reads and creates are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/milestones$'))
    assert.ok(content.includes('\'milestones\''))

    for (const handler of [
      'server/api/v1/projects/[id]/milestones/index.get.ts',
      'server/api/v1/projects/[id]/milestones/index.post.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /milestoneDeliverables/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /INSERT INTO milestones/i)
      assert.doesNotMatch(handlerSource, /work_items/)
      assert.doesNotMatch(handlerSource, /deliverables/)
    }
  })

  test('favorite project reads and writes are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('context.suffix === \'/favorites\''))
    assert.ok(content.includes('context.method === \'GET\' || context.method === \'POST\' || context.method === \'DELETE\''))

    for (const handler of [
      'server/api/v1/favorites.get.ts',
      'server/api/v1/favorites.post.ts',
      'server/api/v1/favorites.delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /user_favorite_projects/)
    }
  })

  test('portfolio creation requires system admin while edits require portfolio admin before runtime', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /'\/portfolios'/)
    assert.match(content, /function needsPortfolioManageContext/)
    assert.ok(content.includes('context.method === \'POST\' && context.suffix === \'/portfolios\''))
    assert.ok(content.includes('/^\\/portfolios\\/[^/]+$/.test(context.suffix)'))
    assert.match(content, /delete sanitizedQuery\.current_user_can_manage_portfolios/)
    assert.match(content, /requirePermission\(context\.event, 'admin', 'admin', '仅系统管理员可以创建项目集'/)
    assert.match(content, /requirePermission\(context\.event, 'portfolios', 'admin'/)
    assert.match(content, /sanitizedQuery\.current_user_can_manage_portfolios = '1'/)

    for (const handler of [
      'server/api/v1/portfolios/index.get.ts',
      'server/api/v1/portfolios/index.post.ts',
      'server/api/v1/portfolios/[id].get.ts',
      'server/api/v1/portfolios/[id].put.ts',
      'server/api/v1/portfolios/[id].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /project_portfolios/)
      assert.doesNotMatch(handlerSource, /aims_projects/)
    }
  })

  test('project template version writes require trusted admin context and no local DB fallback', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    assert.match(middleware, /'\/project-template-versions'/)
    assert.match(middleware, /\/\^\\\/project-template-versions\(\\\/\[\^\/\]\+\(\\\/transition\)\?\)\?\$\/\.test\(context\.suffix\)/)
    assert.match(middleware, /delete sanitizedQuery\.current_user_is_project_admin/)
    assert.match(middleware, /sanitizedQuery\.current_user_is_project_admin = await hasAimsSystemManageAccess\(context\.event\) \? '1' : '0'/)

    const helperSource = source('server/utils/projectTemplateRuntimeAccess.ts')
    assert.match(helperSource, /hasAimsSystemManageAccess/)
    assert.match(helperSource, /current_user_is_project_admin: await hasAimsSystemManageAccess\(event\) \? '1' : '0'/)

    for (const handler of [
      'server/api/v1/project-template-versions/index.post.ts',
      'server/api/v1/project-template-versions/[id].put.ts',
      'server/api/v1/project-template-versions/[id]/transition.post.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /buildProjectTemplateAdminRuntimeQuery/)
      assert.match(handlerSource, /query: await buildProjectTemplateAdminRuntimeQuery\(event\)/)
      assert.doesNotMatch(handlerSource, /current_user_is_project_admin:\s*body/)
      assert.doesNotMatch(handlerSource, /currentUserIsProjectAdmin:\s*body/)
    }

    for (const handler of [
      'server/api/v1/project-template-versions/index.get.ts',
      'server/api/v1/project-template-versions/index.post.ts',
      'server/api/v1/project-template-versions/[id].get.ts',
      'server/api/v1/project-template-versions/[id].put.ts',
      'server/api/v1/project-template-versions/[id]/transition.post.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /forwardAimsRuntime/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /server\/utils\/projectTemplates/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /project_template_versions/)
    }

    const runtimeSource = workspaceSource('data-runtime/internal/apps/aims/project_templates.go')
    assert.match(runtimeSource, /handleProjectTemplateVersionRuntime/)
    assert.match(runtimeSource, /requireProjectTemplateAdminActor/)
    assert.match(runtimeSource, /hasProjectAdminFlag\(query\)/)
    assert.match(runtimeSource, /projectTemplateVersionSelectSQL/)
  })

  test('work item child and transition reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('context.method === \'GET\' && /^\\/work-items\\/[^/]+\\/(children|transitions|commits)$/.test(context.suffix)'))

    for (const handler of [
      'server/api/v1/work-items/[id]/children.get.ts',
      'server/api/v1/work-items/[id]/transitions.get.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /work_items/)
      assert.doesNotMatch(handlerSource, /workflow_transitions/)
    }
  })

  test('work item execution context read carries project scoped admin query and runtime guard', () => {
    const handlerSource = source('server/api/v1/work-items/[id]/execution-context.get.ts')
    assert.match(handlerSource, /buildAimsProjectListRuntimeAccessQuery/)
    assert.match(handlerSource, /query: await buildAimsProjectListRuntimeAccessQuery\(event, \{ uid \}\)/)
    assert.doesNotMatch(handlerSource, /query:\s*\{\s*current_user:\s*uid\s*\}/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)

    const runtimeSource = workspaceSource('data-runtime/internal/apps/aims/execution_context.go')
    const itemIndex = runtimeSource.indexOf('item, err := a.executionItem(ctx, workItemID)')
    const guardIndex = runtimeSource.indexOf('a.requireProjectMemberOrScopedAdmin(ctx, item.ProjectID, uid, query)')
    const deliverablesIndex = runtimeSource.indexOf('deliverables, err := a.executionDeliverables(ctx, workItemID)')
    const commitsIndex = runtimeSource.indexOf('commits, err := a.executionCommits(ctx, workItemID)')
    const timeEntriesIndex = runtimeSource.indexOf('timeEntries, err := a.executionTimeEntries(ctx, workItemID)')
    assert.notEqual(itemIndex, -1, 'runtime must read execution work item before guarding')
    assert.notEqual(guardIndex, -1, 'runtime must guard execution context by project member or scoped admin')
    assert.notEqual(deliverablesIndex, -1, 'runtime must still return execution deliverables')
    assert.notEqual(commitsIndex, -1, 'runtime must still return execution commits')
    assert.notEqual(timeEntriesIndex, -1, 'runtime must still return execution time entries')
    assert.ok(itemIndex < guardIndex, 'runtime guard needs resolved work item project context')
    assert.ok(guardIndex < deliverablesIndex, 'runtime guard must run before deliverables read')
    assert.ok(guardIndex < commitsIndex, 'runtime guard must run before commits read')
    assert.ok(guardIndex < timeEntriesIndex, 'runtime guard must run before time entries read')
  })

  test('direct work item reads and writes are runtime forwarded with scoped admin query and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('/work-items'))
    assert.ok(content.includes('context.method === \'GET\' && /^\\/work-items\\/[^/]+$/.test(context.suffix)'))
    assert.match(content, /DIRECT_PROJECT_SCOPED_ADMIN_OBJECT_PATTERN/)
    assert.match(content, /work-items/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const updateOperationIndex = runtimeWorkspace.indexOf('operation = "aims.work_items.update"')
    const deleteOperationIndex = runtimeWorkspace.indexOf('operation = "aims.work_items.delete"')
    const updateGuardIndex = runtimeWorkspace.lastIndexOf('requireWorkItemProjectMemberOrScopedAdmin', updateOperationIndex)
    const deleteGuardIndex = runtimeWorkspace.lastIndexOf('requireWorkItemProjectMemberOrScopedAdmin', deleteOperationIndex)
    assert.notEqual(updateOperationIndex, -1, 'runtime missing direct work item update branch')
    assert.notEqual(deleteOperationIndex, -1, 'runtime missing direct work item delete branch')
    assert.notEqual(updateGuardIndex, -1, 'runtime update branch must guard direct work item writes')
    assert.notEqual(deleteGuardIndex, -1, 'runtime delete branch must guard direct work item deletes')
    assert.ok(updateGuardIndex < updateOperationIndex)
    assert.ok(deleteGuardIndex < deleteOperationIndex)

    const runtimeDetail = workspaceSource('data-runtime/internal/apps/aims/work_item_detail.go')
    const detailGuardIndex = runtimeDetail.indexOf('requireWorkItemProjectMemberOrScopedAdmin')
    const detailReadIndex = runtimeDetail.indexOf('workItemDetailItem(ctx')
    assert.notEqual(detailGuardIndex, -1, 'runtime detail read must guard direct work item reads')
    assert.notEqual(detailReadIndex, -1, 'runtime detail read branch is missing')
    assert.ok(detailGuardIndex < detailReadIndex)

    for (const handler of [
      'server/api/v1/work-items/[id].get.ts',
      'server/api/v1/work-items/[id].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /readBody/)
      assert.doesNotMatch(handlerSource, /useDbPool/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /work_items/)
      assert.doesNotMatch(handlerSource, /work_item_comments/)
      assert.doesNotMatch(handlerSource, /work_item_changelog/)
      assert.doesNotMatch(handlerSource, /DELETE FROM work_items/i)
      assert.doesNotMatch(handlerSource, /UPDATE work_items/i)
    }

    const updateHandler = source('server/api/v1/work-items/[id].put.ts')
    assert.match(updateHandler, /maybeCallTenantRuntime/)
    assert.match(updateHandler, /requirePermission\(event, 'work_items', 'edit'/)
    assert.match(updateHandler, /serviceTicketDelivery/)
    assert.match(updateHandler, /dispatchServiceTicketDeliveryOperation/)
    assert.doesNotMatch(updateHandler, /service-delivery-result:prepare/)
    assert.doesNotMatch(updateHandler, /syncPreparedServiceTicketDelivery/)
    assert.doesNotMatch(updateHandler, /server\/utils\/db/)
    assert.doesNotMatch(updateHandler, /UPDATE work_items/i)
  })

  test('project work item list is runtime forwarded with project visibility and no local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/work-items$/'))
    assert.match(content, /projectScopedNestedCollection\(context\.suffix\)/)
    assert.match(content, /resolveAimsProjectListAdminScopeQuery\(context\.event, context\.currentUser, visibilityContext\)/)

    const handlerSource = source('server/api/v1/projects/[id]/work-items/index.get.ts')
    assert.match(handlerSource, /tenant-runtime is required/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /hasWorkItemStartDateColumn/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /work_items/)
  })

  test('project work item create is runtime forwarded without local DB fallback', () => {
    const handlerSource = source('server/api/v1/projects/[id]/work-items/index.post.ts')
    assert.match(handlerSource, /tenant-runtime is required to create project work items/)
    assert.doesNotMatch(handlerSource, /server\/utils\/db/)
    assert.doesNotMatch(handlerSource, /workItemStartDate/)
    assert.doesNotMatch(handlerSource, /projectLifecycle/)
    assert.doesNotMatch(handlerSource, /getRequestUid/)
    assert.doesNotMatch(handlerSource, /getRouterParam/)
    assert.doesNotMatch(handlerSource, /readBody/)
    assert.doesNotMatch(handlerSource, /queryRow/)
    assert.doesNotMatch(handlerSource, /queryRows/)
    assert.doesNotMatch(handlerSource, /execute\(/)
    assert.doesNotMatch(handlerSource, /work_items/)
    assert.doesNotMatch(handlerSource, /project_counters/)

    const runtimeWorkspace = workspaceSource('data-runtime/internal/apps/aims/workspace.go')
    const postIndex = runtimeWorkspace.indexOf('if method == http.MethodPost {')
    assert.notEqual(postIndex, -1, 'workspace runtime missing POST branch')
    const postSegment = runtimeWorkspace.slice(postIndex)
    const createIndex = postSegment.indexOf('a.createProjectWorkItem(ctx, projectID, query, body)')
    const genericIndex = postSegment.indexOf('handleProjectScopedGenericRuntime')
    assert.notEqual(createIndex, -1, 'workspace runtime missing dedicated work item create route')
    assert.ok(genericIndex === -1 || createIndex < genericIndex, 'work item create route must run before generic runtime fallback')
  })

  test('work item time entry reads and writes are runtime forwarded with scoped admin query', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function isWorkItemTimeEntryRuntimePath/)
    assert.ok(content.includes('(context.method === \'GET\' || context.method === \'POST\')'))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/time-entries$/.test(context.suffix)'))
    assert.ok(content.includes('(context.method === \'PATCH\' || context.method === \'PUT\' || context.method === \'DELETE\')'))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/time-entries\\/[^/]+$/.test(context.suffix)'))
    assert.ok(content.includes('/^\\/work-items\\/[^/]+\\/time-entries\\/[^/]+$/'))
    assert.match(content, /\|\| isWorkItemTimeEntryRuntimePath\(context\)/)

    for (const handler of [
      'server/api/v1/work-items/[id]/time-entries.get.ts',
      'server/api/v1/work-items/[id]/time-entries.post.ts',
      'server/api/v1/work-items/[id]/time-entries/[entryId].patch.ts',
      'server/api/v1/work-items/[id]/time-entries/[entryId].delete.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /time_entries/)
    }
  })

  test('project and user time entry reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/time-entries$/'))
    assert.ok(content.includes('/^\\/users\\/[^/]+\\/time-entries$/'))
    assert.ok(content.includes('/^\\/projects\\/[^/]+\\/time-entries(?:\\/[^/]+)?$/.test(context.suffix)'))
    assert.ok(content.includes('const timeEntriesMatch = context.suffix.match(/^\\/projects\\/([^/]+)\\/time-entries(?:\\/[^/]+)?$/)'))

    for (const handler of [
      'server/api/v1/projects/[id]/time-entries.get.ts',
      'server/api/v1/users/[uid]/time-entries.get.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /time_entries/)
    }
  })

  test('workspace and personal board reads are runtime forwarded without local DB fallback', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    for (const suffix of ['/workspace', '/my-work-items', '/my-board']) {
      assert.match(content, new RegExp(`'${suffix}'`))
    }
    assert.ok(content.includes('if (RUNTIME_READONLY_COLLECTIONS.includes(context.suffix)) return context.method === \'GET\''))

    for (const handler of [
      'server/api/v1/workspace.get.ts',
      'server/api/v1/my-work-items.get.ts',
      'server/api/v1/my-board.get.ts'
    ]) {
      const handlerSource = source(handler)
      assert.match(handlerSource, /tenant-runtime is required/)
      assert.doesNotMatch(handlerSource, /server\/utils\/db/)
      assert.doesNotMatch(handlerSource, /getRequestUid/)
      assert.doesNotMatch(handlerSource, /queryRow/)
      assert.doesNotMatch(handlerSource, /queryRows/)
      assert.doesNotMatch(handlerSource, /execute\(/)
      assert.doesNotMatch(handlerSource, /work_items/)
      assert.doesNotMatch(handlerSource, /aims_project_members/)
    }
  })

  test('direct approval decisions require exact permission before runtime proxy', () => {
    const path = 'server/middleware/tenant-runtime.ts'
    const content = source(path)

    assert.match(content, /function needsApprovalDecisionContext/)
    assert.match(content, /async function applyApprovalDecisionContext/)
    assert.match(content, /delete sanitizedQuery\.current_user_approval_decision_authorized/)
    assert.match(content, /callAimsRuntime<RuntimeApprovalRecord>/)
    assert.match(content, /scope: 'aims\.read'/)
    assert.match(content, /requirePermission\(context\.event, 'work_items', 'confirm'/)
    assert.match(content, /requirePermission\(context\.event, 'projects', 'approve'/)
    assert.match(content, /sanitizedQuery\.current_user_approval_decision_authorized = '1'/)
  })

  test('legacy work item approval status endpoint is retired and cannot mutate records directly', () => {
    const content = source('server/api/v1/work-items/[id]/approval-status.patch.ts')

    assert.match(content, /statusCode:\s*410/)
    assert.match(content, /\/api\/v1\/approvals\/\{id\}/)
    assert.doesNotMatch(content, /readBody/)
    assert.doesNotMatch(content, /queryRow/)
    assert.doesNotMatch(content, /execute\(/)
    assert.doesNotMatch(content, /UPDATE\s+work_items/i)
    assert.doesNotMatch(content, /approvalStatus/)
  })

  test('Codocs content and section proxies require Aims project document context', () => {
    const helper = source('server/utils/projectDocumentAccess.ts')
    assert.match(helper, /export async function assertCodocsProjectDocumentAccess/)
    assert.match(helper, /project_id: projectId/)
    assert.match(helper, /codocs_uuid: uuid/)
    assert.match(helper, /deliverable_type: 'document'/)
    assert.match(helper, /document_uuid: uuid/)
    assert.match(helper, /const projectAccessQuery = await buildAimsProjectRuntimeAccessQuery\(event, \{/)
    assert.match(helper, /const isScopedProjectAdmin = projectAccessQuery\.current_user_is_project_admin === '1'/)
    assert.match(helper, /!isScopedProjectAdmin/)

    const previewHandler = source('server/api/v1/codocs/documents/[uuid]/preview-access.post.ts')
    const previewAccessCheckIndex = previewHandler.indexOf('assertCodocsProjectDocumentAccess(event, projectId, uuid, uid)')
    const previewEnsureIndex = previewHandler.indexOf('const access = await ensureCodocsDocumentPreviewAccess')
    assert.notEqual(previewAccessCheckIndex, -1, 'preview proxy must use shared Aims project document access helper')
    assert.notEqual(previewEnsureIndex, -1, 'preview proxy must still prepare Codocs preview access')
    assert.ok(previewAccessCheckIndex < previewEnsureIndex, 'preview proxy must check Aims access before Codocs preview access')
    assert.doesNotMatch(previewHandler, /callAimsRuntime/)
    assert.doesNotMatch(previewHandler, /current_user: uid/)

    const codocsApi = source('server/utils/codocsApi.ts')
    assert.match(codocsApi, /sourceApp:\s*'aims'/)
    assert.match(codocsApi, /resolveServiceAppBaseUrl\(null, 'codocs'\)/)
    assert.doesNotMatch(codocsApi, /const url = resolveServiceAppBaseUrl\(event, 'codocs'\)/)
    assert.doesNotMatch(codocsApi, /relations\/preview-access/)

    const previewComponent = source('app/components/AimsDocumentPreview.vue')
    assert.match(previewComponent, /\/content`/)
    assert.match(previewComponent, /<MarkdownContent :markdown="codocsContent\.content"/)
    assert.doesNotMatch(previewComponent, /\/preview-access/)
    assert.doesNotMatch(previewComponent, /<CodocsPreview/)

    const contentHandler = source('server/api/v1/codocs/documents/[uuid]/content.get.ts')
    const contentProjectGuardIndex = contentHandler.indexOf('if (!projectId)')
    const contentAccessCheckIndex = contentHandler.indexOf('assertCodocsProjectDocumentAccess(event, projectId, uuid, uid)')
    const contentFetchIndex = contentHandler.indexOf('res = await getCodocsProjectDocumentContent({')

    assert.notEqual(contentProjectGuardIndex, -1, 'content proxy must reject missing projectId')
    assert.notEqual(contentAccessCheckIndex, -1, 'content proxy must check Aims project document access')
    assert.notEqual(contentFetchIndex, -1, 'content proxy must still fetch Codocs content after access check')
    assert.ok(contentProjectGuardIndex < contentAccessCheckIndex, 'content projectId guard must run before project document access check')
    assert.ok(contentAccessCheckIndex < contentFetchIndex, 'content project document access check must run before Codocs content fetch')

    const sectionHandler = source('server/api/v1/codocs/documents/[uuid]/section.get.ts')
    const sectionProjectGuardIndex = sectionHandler.indexOf('if (!projectId)')
    const sectionAccessCheckIndex = sectionHandler.indexOf('assertCodocsProjectDocumentAccess(event, projectId, uuid, uid)')
    const sectionFetchIndex = sectionHandler.indexOf('doc = await getCodocsProjectDocumentContent({')

    assert.notEqual(sectionProjectGuardIndex, -1, 'section proxy must reject missing projectId')
    assert.notEqual(sectionAccessCheckIndex, -1, 'section proxy must check Aims project document access')
    assert.notEqual(sectionFetchIndex, -1, 'section proxy must still fetch Codocs content after access check')
    assert.ok(sectionProjectGuardIndex < sectionAccessCheckIndex, 'section projectId guard must run before project document access check')
    assert.ok(sectionAccessCheckIndex < sectionFetchIndex, 'section project document access check must run before Codocs content fetch')

    const summaryHandler = source('server/api/v1/codocs/documents/[uuid]/summary.get.ts')
    const summaryDeptGuardIndex = summaryHandler.indexOf('if (!requestedDeptCode)')
    const summaryDeptAccessIndex = summaryHandler.indexOf('hasDepartmentAccess(event, uid, requestedDeptCode)')
    const summaryFailClosedIndex = summaryHandler.indexOf('department_project_proposal_classification_required')

    assert.notEqual(summaryDeptGuardIndex, -1, 'summary proxy must reject missing department context')
    assert.notEqual(summaryDeptAccessIndex, -1, 'summary proxy must check requested department access')
    assert.notEqual(summaryFailClosedIndex, -1, 'summary proxy must fail closed until immutable proposal classification exists')
    assert.ok(summaryDeptAccessIndex < summaryFailClosedIndex, 'summary proxy must check requested department before returning the controlled unavailable response')
    assert.doesNotMatch(summaryHandler, /getCodocsDocumentSummary/)
    assert.doesNotMatch(summaryHandler, /maybeCallCodocsRuntime/)
    assert.doesNotMatch(summaryHandler, /res\.data\.ownerUid !== uid && !hasDeptAccess/)

    const sourceSections = source('server/api/v1/work-items/[id]/source-sections.get.ts')
    const sourceRuntimeQueryIndex = sourceSections.indexOf('buildAimsProjectListRuntimeAccessQuery(event, { uid })')
    const sourceProjectContextIndex = sourceSections.indexOf('const projectId = Number(runtimeData.projectId ?? runtimeData.project_id) || 0')
    const sourceAccessCheckIndex = sourceSections.indexOf('await assertCodocsProjectDocumentAccess(event, projectId, documentUuid, uid)')
    const sourceFetchIndex = sourceSections.indexOf('const res = await getCodocsProjectDocumentContent({')

    assert.notEqual(sourceRuntimeQueryIndex, -1, 'source-sections proxy must carry scoped project admin query into runtime')
    assert.notEqual(sourceProjectContextIndex, -1, 'source-sections proxy must use trusted runtime project context')
    assert.notEqual(sourceAccessCheckIndex, -1, 'source-sections proxy must check source document project access')
    assert.notEqual(sourceFetchIndex, -1, 'source-sections proxy must still fetch Codocs content after access check')
    assert.ok(sourceProjectContextIndex < sourceAccessCheckIndex, 'source-sections project context must be resolved before source document access check')
    assert.ok(sourceAccessCheckIndex < sourceFetchIndex, 'source-sections document access check must run before Codocs content fetch')
    assert.match(sourceSections, /const documentUuids = \[\.\.\.new Set\(anchors\.map\(anchor => anchor\.sourceDocumentUuid\)\)\]/)
    assert.match(sourceSections, /const SOURCE_DOCUMENT_CONCURRENCY = 4/)
    assert.match(sourceSections, /Math\.min\(SOURCE_DOCUMENT_CONCURRENCY, documentUuids\.length\)/)

    assert.match(codocsApi, /getCodocsProjectDocumentContent/)
    assert.match(codocsApi, /codocs:project-document:content:read/)
    assert.match(codocsApi, /action:\s*'content:read'/)
    assert.match(codocsApi, /commandSchemaVersion:\s*'aims\.codocs\.project-document\.content\.v1'/)
    assert.match(codocsApi, /sourceClientId:\s*'aims\.runtime'/)
    assert.doesNotMatch(contentHandler, /getCodocsDocumentContent\(/)
    assert.doesNotMatch(sectionHandler, /getCodocsDocumentContent\(/)
    assert.doesNotMatch(sourceSections, /getCodocsDocumentContent\(/)

    const runtime = workspaceSource('data-runtime/internal/apps/aims/source_sections.go')
    assert.match(runtime, /commitTargetWorkItemProject\(ctx, workItemID\)/)
    assert.match(runtime, /requireProjectMemberOrScopedAdmin\(ctx, projectID, uid, query\)/)
    assert.match(runtime, /"projectId": projectID/)

    for (const path of [
      'app/pages/projects/[id]/work-items/[workItemId]/decompose.vue',
      'app/components/requirements/import/Wizard.vue'
    ]) {
      const content = source(path)
      const fetchIndex = content.indexOf('/api/v1/codocs/documents/')
      const queryIndex = content.indexOf('query:', fetchIndex)
      const projectIdIndex = content.indexOf('projectId:', queryIndex)

      assert.notEqual(fetchIndex, -1, `${path} must load Codocs content through the Aims proxy`)
      assert.notEqual(queryIndex, -1, `${path} must pass a query object to the content proxy`)
      assert.notEqual(projectIdIndex, -1, `${path} must pass projectId to the content proxy`)
    }
  })

  test('project cabinet preview, download and access-check do not bypass Codocs policy with project membership', () => {
    const preview = source('server/api/v1/projects/[id]/documents/[documentId]/preview.get.ts')
    const previewAccessIndex = preview.indexOf('const access = await checkCodocsDocumentAccess')
    const previewDeniedIndex = preview.indexOf('if (!access.allowed)')
    const previewUrlIndex = preview.indexOf('const preview = await getCodocsProjectCabinetPreviewUrl')

    assert.notEqual(previewAccessIndex, -1, 'preview must call Codocs document access check')
    assert.notEqual(previewDeniedIndex, -1, 'preview must reject denied Codocs access')
    assert.notEqual(previewUrlIndex, -1, 'preview must still use Codocs project cabinet preview URL')
    assert.ok(previewAccessIndex < previewDeniedIndex, 'preview must check Codocs policy before testing allow')
    assert.ok(previewDeniedIndex < previewUrlIndex, 'preview must reject denied access before signing preview URL')
    assert.doesNotMatch(preview, /projectMemberFallbackAccess/)
    assert.doesNotMatch(preview, /project_member_direct/)
    assert.doesNotMatch(preview, /catch \(error\)/)

    const download = source('server/api/v1/projects/[id]/documents/[documentId]/download.get.ts')
    const downloadAccessIndex = download.indexOf('const access = await checkCodocsDocumentAccess')
    const downloadDeniedIndex = download.indexOf('if (!access.allowed)')
    const downloadUrlIndex = download.indexOf('const download = await getCodocsProjectCabinetDownloadUrl')

    assert.notEqual(downloadAccessIndex, -1, 'download must call Codocs document access check')
    assert.notEqual(downloadDeniedIndex, -1, 'download must reject denied Codocs access')
    assert.notEqual(downloadUrlIndex, -1, 'download must still use Codocs project cabinet download URL')
    assert.match(download, /action:\s*'download'/)
    assert.ok(downloadAccessIndex < downloadDeniedIndex, 'download must check Codocs policy before testing allow')
    assert.ok(downloadDeniedIndex < downloadUrlIndex, 'download must reject denied access before signing download URL')
    assert.doesNotMatch(download, /projectMemberFallbackAccess/)
    assert.doesNotMatch(download, /project_member_direct/)
    assert.doesNotMatch(download, /catch \(error\)/)

    const accessCheck = source('server/utils/projectDocumentAccessPolicy.ts')
    assert.match(accessCheck, /function normalizeDocumentAccessAction/)
    assert.match(accessCheck, /action === 'view' \|\| action === 'download' \|\| action === 'edit'/)
    assert.match(accessCheck, /statusCode:\s*400/)
    assert.match(accessCheck, /const result = await checkCodocsDocumentAccess/)
    assert.match(accessCheck, /data: result/)
    assert.doesNotMatch(accessCheck, /projectMemberFallbackAccess/)
    assert.doesNotMatch(accessCheck, /project_member_direct/)
    assert.doesNotMatch(accessCheck, /catch \(error\)/)
  })

  test('project cabinet service helpers request exact capabilities only after Aims ACL facts exist', () => {
    const api = source('server/utils/codocsApi.ts')
    assert.match(api, /'codocs:project-cabinet:upload'/)
    assert.match(api, /'codocs:project-cabinet:read'/)
    assert.match(api, /'codocs:project-cabinet:delete'/)
    assert.match(api, /uploadCodocsProjectCabinetFile[\s\S]*projectDocumentAuthHeaders\('codocs:project-cabinet:upload', params\.event\)/)
    assert.match(api, /getCodocsProjectCabinetDownloadUrl[\s\S]*projectDocumentAuthHeaders\('codocs:project-cabinet:read', params\.event\)/)
    assert.match(api, /getCodocsProjectCabinetPreviewUrl[\s\S]*projectDocumentAuthHeaders\('codocs:project-cabinet:read', params\.event\)/)
    assert.match(api, /deleteCodocsProjectCabinetFile[\s\S]*projectDocumentAuthHeaders\('codocs:project-cabinet:delete', params\.event\)/)

    const upload = source('server/utils/projectDocumentUpload.ts')
    assert.ok(upload.indexOf('isProjectMember(project, uid, members)') < upload.indexOf('uploadCodocsProjectCabinetFile({'))
    const download = source('server/api/v1/projects/[id]/documents/[documentId]/download.get.ts')
    assert.ok(download.indexOf('if (!access.allowed)') < download.indexOf('getCodocsProjectCabinetDownloadUrl({'))
    const preview = source('server/api/v1/projects/[id]/documents/[documentId]/preview.get.ts')
    assert.ok(preview.indexOf('if (!access.allowed)') < preview.indexOf('getCodocsProjectCabinetPreviewUrl({'))
    const remove = source('server/utils/projectDocumentWrites.ts')
    assert.ok(remove.indexOf('requireProjectDocumentDeleteAccess(event') < remove.indexOf('await deleteProjectCabinetBackingFile(event'))
    assert.match(remove, /return await deleteCodocsProjectCabinetFile\(\{/)
  })

  test('manifest exposes work_items/confirm for project managers', () => {
    const manifest = JSON.parse(source('app.manifest.json')) as {
      resources: Array<{ code: string, actions: string[] }>
      recommendedRoles: Array<{ code: string, suggestedPermissions: string[] }>
    }
    const workItems = manifest.resources.find(resource => resource.code === 'work_items')
    const pm = manifest.recommendedRoles.find(role => role.code === 'aims:pm')

    assert.ok(workItems?.actions.includes('confirm'), 'work_items resource must expose confirm')
    assert.ok(pm?.suggestedPermissions.includes('aims:work_items:confirm'), 'aims:pm must include work_items:confirm')

    const configSource = source('app/config/permissions.ts')
    assert.match(configSource, /code: 'projects'.+supportedActions: \['view', 'create', 'edit', 'approve', 'close', 'admin'\]/s)
    assert.match(configSource, /code: 'work_items'.+supportedActions: \['view', 'create', 'edit', 'delete', 'assign', 'confirm'\]/s)
    assert.match(configSource, /code: 'reports'.+supportedActions: \['view', 'edit', 'admin', 'export'\]/s)
  })

  test('milestone rollover service endpoints are explicitly capability guarded', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    assert.ok(middleware.includes('milestones\\/[^/]+:rollover'))
    assert.match(middleware, /suffix === '\/service\/milestones:rollover-due'/)
    assert.match(middleware, /allowedApps: \['aims'\]/)

    const handler = source('server/api/v1/projects/[id]/milestones/[milestoneId]/rollover.post.ts')
    assert.match(handler, /assertRolloverWriteAccess\(project\)/)
    assert.match(handler, /manualConfirmed: true/)
    assert.match(handler, /\/v1\/aims\/service\/projects\/\$\{encodeURIComponent\(projectCode\)\}\/milestones\/\$\{milestoneId\}:rollover/)
    assert.match(handler, /forwardAimsRuntimePost/)
  })

  test('Aims scheduled rollover has runtime task and Cloudflare cron trigger', () => {
    const task = source('server/tasks/milestones/rollover.ts')
    assert.match(task, /name: 'milestones:rollover'/)
    assert.match(task, /\/v1\/aims\/service\/milestones:rollover-due/)
    assert.match(task, /scope: 'aims.write'/)

    const render = workspaceSource('deploy/cloudflare/render-nuxt-worker-config.mjs')
    assert.match(render, /function cronTriggerConfig/)
    assert.match(render, /triggers:\s*\{\s*crons/s)

    const aimsRender = source('scripts/render-cloudflare-config.mjs')
    assert.match(aimsRender, /'\*\/5 \* \* \* \*'/)
    assert.match(aimsRender, /'15 2 \* \* \*'/)

    const config = source('nuxt.config.ts')
    assert.match(config, /'\*\/5 \* \* \* \*': \['integration-operations:drain'\]/)
    assert.match(config, /'15 2 \* \* \*': \['milestones:rollover'\]/)
  })

  test('service desk page reads service ticket extension fields through runtime list', () => {
    const page = source('app/pages/projects/[id]/service-desk.vue')
    assert.match(page, /serviceDesk: 1/)
    assert.match(page, /customerCode/)
    assert.match(page, /environmentCode/)
    assert.match(page, /slaStatusSnapshot/)
    assert.match(page, /responseDueAt/)
    assert.match(page, /resolutionDueAt/)

    const runtime = workspaceSource('data-runtime/internal/apps/aims/project_work_items.go')
    assert.match(runtime, /LEFT JOIN work_item_service_ext wse ON wse\.work_item_id = wi\.id/)
    assert.match(runtime, /wse\.source_ticket_code IS NOT NULL/)
    assert.match(runtime, /"slaStatusSnapshot":\s+item\.SLAStatusSnapshot/)
  })

  test('service ticket bridge preserves work item type and writes service extension table', () => {
    const bridge = workspaceSource('data-runtime/internal/apps/aims/service_ticket_bridge.go')
    assert.match(bridge, /serviceTicketTemplateKey\(ticketCode\)/)
    assert.match(bridge, /AND template_key = \?/)
    assert.match(bridge, /func insertWorkItemServiceExt/)
    assert.match(bridge, /func updateWorkItemServiceExt/)
    assert.match(bridge, /INSERT INTO work_item_service_ext/)
    assert.match(bridge, /responseDueAt/)
    assert.match(bridge, /resolutionDueAt/)
    assert.match(bridge, /slaStatusSnapshot/)
    assert.doesNotMatch(bridge, /type'\s*,\s*'service_ticket/)
  })
})
