import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Codocs sensitive route permissions', () => {
  test('authorization dependency failures are not converted into user permission denials', () => {
    const content = source('server/utils/checkPermission.ts')
    const checkBlock = content.slice(
      content.indexOf('export async function checkPermission'),
      content.indexOf('export async function requirePermission')
    )

    assert.match(checkBlock, /await loadAuthorizationSnapshotFromConsoleRuntime/)
    assert.doesNotMatch(checkBlock, /catch\s*\(/)
    assert.doesNotMatch(checkBlock, /return false[\s\S]*Console authorization/)
  })

  test('manifest declares department export because API guards require it', () => {
    const manifest = JSON.parse(source('app.manifest.json')) as {
      resources: Array<{ code: string, actions: string[] }>
    }
    const departments = manifest.resources.find(resource => resource.code === 'departments')

    assert.ok(departments, 'departments resource must exist')
    assert.ok(departments.actions.includes('export'), 'departments resource must declare export')
  })

  test('download and export BFF routes require explicit export actions', () => {
    const downloadContent = source('server/api/documents/download-content.post.ts')
    const ossClient = source('app/utils/oss-client.ts')
    const slidesExport = source('server/api/slides/export.post.ts')

    assert.match(
      source('server/api/documents/[uuid]/download.get.ts'),
      /requirePermission\(event,\s*'documents',\s*'export'/
    )
    assert.match(
      downloadContent,
      /requirePermission\(event,\s*'documents',\s*'export'/
    )
    assert.match(downloadContent, /getCodocsDocumentMetadata\(event,\s*uuid,\s*\{\s*actorUid:\s*getRequestUid\(event\)\s*\}\)/)
    assert.match(downloadContent, /requestedOssPath !== doc\.oss_path/)
    assert.match(downloadContent, /requirePermission\(event,\s*'projects',\s*'export'[\s\S]*缺少项目文档导出权限/)
    assert.match(downloadContent, /ossPath\.startsWith\(`\$\{repoPath\}\/`\)/)
    assertBefore(downloadContent, 'requirePermission(event, \'documents\', \'export\'', 'getCodocsDocumentMetadata(event, uuid')
    assertBefore(downloadContent, 'getCodocsDocumentMetadata(event, uuid', 'downloadDocument(resolved.ossPath, resolved.docType)')
    assertBefore(downloadContent, 'requirePermission(event, \'projects\', \'export\'', 'fetchDirectoryResponse<DirectoryProjectList>')
    assertBefore(downloadContent, 'ossPath.startsWith(`${repoPath}/`)', 'downloadDocument(resolved.ossPath, resolved.docType)')
    assert.match(ossClient, /documentUuid\?:\s*string/)
    assert.match(ossClient, /projectCode\?:\s*string/)
    assert.match(ossClient, /documentUuid is required to download document content/)
    assert.match(ossClient, /projectCode is required to download git project document content/)
    assert.match(ossClient, /body\.document_uuid = options\.documentUuid/)
    assert.match(ossClient, /body\.project_code = options\.projectCode/)
    assert.match(
      source('server/api/cabinet/[id]/download.get.ts'),
      /requirePermission\(event,\s*'documents',\s*'export'/
    )
    assert.match(
      source('server/api/dept-cabinet/[id]/download.get.ts'),
      /requirePermission\(event,\s*'departments',\s*'export'/
    )
    assert.match(
      source('server/api/dept-assets/export-docx.post.ts'),
      /requirePermission\(event,\s*'departments',\s*'export'/
    )
    assert.match(
      slidesExport,
      /requirePermission\(event,\s*'documents',\s*'export'/
    )
    assertBefore(slidesExport, 'requirePermission(event, \'documents\', \'export\'', 'readBody(event)')
    assertBefore(slidesExport, 'requirePermission(event, \'documents\', \'export\'', '$fetch<{ success?: boolean')
  })

  test('Slidev read and preview APIs require document view permission before render service access', () => {
    const slideRoutes = [
      'server/api/slides/content.get.ts',
      'server/api/slides/demo.get.ts',
      'server/api/slides/preview.post.ts'
    ]

    for (const path of slideRoutes) {
      const content = source(path)

      assert.match(
        content,
        /requirePermission\(event,\s*'documents',\s*'view'[\s\S]*缺少文档查看权限/,
        path
      )
      assertBefore(content, 'requirePermission(event, \'documents\', \'view\'', '$fetch<{ success?: boolean')
      if (path.endsWith('.post.ts')) {
        assertBefore(content, 'requirePermission(event, \'documents\', \'view\'', 'readBody(event)')
      }
    }
  })

  test('department document detail preview uses server-verified department read context', () => {
    const departmentPage = source('app/pages/departments/index.vue')
    const documentPage = source('app/pages/documents/[uuid].vue')
    const detailRoute = source('server/api/documents/[uuid]/index.get.ts')

    assert.match(departmentPage, /\/api\/documents\/\$\{\(doc as DocRecord\)\.uuid\}/)
    assert.match(departmentPage, /dept_code:\s*deptCode\.value/)
    assert.match(departmentPage, /path:\s*`\/documents\/\$\{uuid\}`/)
    assert.match(departmentPage, /query:\s*deptCode\.value \? \{\s*dept_code:\s*deptCode\.value\s*\}/)

    assert.match(documentPage, /const documentDeptCode = computed\(\(\) => routeQueryText\(route\.query\.dept_code \|\| route\.query\.deptCode\)\)/)
    assert.match(documentPage, /if \(documentDeptCode\.value\) query\.dept_code = documentDeptCode\.value/)

    assert.match(detailRoute, /requireDepartmentReadAccess/)
    assert.match(detailRoute, /const departmentReadDeptCode = queryText\(query\.dept_code \|\| query\.deptCode\)/)
    assert.match(detailRoute, /await requireDepartmentReadAccess\(event, actorUid,\s*departmentReadDeptCode\)/)
    assert.match(detailRoute, /metadataQuery\.trusted_department_read_dept_code = departmentReadDeptCode/)
    assert.match(detailRoute, /metadataQuery\.trustedDepartmentReadDeptCode = departmentReadDeptCode/)
    assertBefore(detailRoute, 'await requireDepartmentReadAccess(event, actorUid, departmentReadDeptCode)', 'getCodocsDocumentMetadata(event, uuid, metadataQuery)')
  })

  test('open department document preview does not re-apply ordinary department document permission', () => {
    const openRoute = source('server/api/open-department-docs/[uuid].get.ts')

    assert.match(openRoute, /requireRequestUid\(event\)/)
    assert.match(openRoute, /const doc = await requireOpenDepartmentDocument\(event,\s*uuid\)/)
    assert.doesNotMatch(openRoute, /getCodocsDocumentMetadata/)
    assertBefore(openRoute, 'requireRequestUid(event)', 'requireOpenDepartmentDocument(event, uuid)')
    assertBefore(openRoute, 'requireOpenDepartmentDocument(event, uuid)', 'downloadDocument(doc.oss_path, doc.doc_type)')
  })

  test('open department document validation uses folder visibility instead of document dept metadata', () => {
    const openHelper = source('server/utils/openDepartmentDocs.ts')

    assert.match(openHelper, /openDepartmentVisibleFolderMap/)
    assert.match(openHelper, /'\/v1\/codocs\/open-department-documents'/)
    assert.match(openHelper, /query:\s*\{ uuid \}/)
    assert.match(openHelper, /doc\.doc_type !== 'department' \|\| !doc\.folder_id/)
    assert.doesNotMatch(openHelper, /getCodocsDocumentMetadata/)
    assert.doesNotMatch(openHelper, /dept_code:\s*doc\.dept_code/)
    assert.doesNotMatch(openHelper, /!doc\.dept_code/)
    assert.match(openHelper, /visibleFolders\.has\(normalizeId\(doc\.folder_id\)\)/)
  })

  test('open department document list resolves department names with the authenticated request context', () => {
    const openHelper = source('server/utils/openDepartmentDocs.ts')
    const directoryCompat = source('server/utils/directoryCompat.ts')

    assert.match(openHelper, /async function departmentNameMap\(event: H3Event\)/)
    assert.match(
      openHelper,
      /fetchDirectoryData<DepartmentResponse>\('\/departments', \{ event, timeout: 5000 \}\)/
    )
    assert.match(openHelper, /const names = await departmentNameMap\(event\)/)
    assert.match(directoryCompat, /event\?: H3Event/)
    assert.match(directoryCompat, /fetchConsoleDirectoryApi<DirectoryApiResponse<T>>\(path, options\)/)
  })

  test('department manager open-folder mutation verifies department before the scoped runtime write', () => {
    const route = source('server/api/folders/[id]/open.patch.ts')
    const page = source('app/pages/departments/index.vue')

    assert.match(route, /requireRequestUid\(event\)/)
    assert.match(route, /const deptCode = String\(body\?\.dept_code \?\? body\?\.deptCode/)
    assert.match(route, /requireDepartmentManagerAccess\(event, actorUid, deptCode, '仅部门负责人可设置开放目录'\)/)
    assert.match(route, /CODOCS_TRUSTED_DEPARTMENT_MANAGE_QUERY_KEY\]: deptCode/)
    assert.match(route, /`\/v1\/codocs\/folders\/\$\{encodeURIComponent\(id\)\}\/open`/)
    assert.equal((route.match(/callCodocsTenantRuntime/g) || []).length, 2, 'route must import and invoke one runtime call')
    assertBefore(route, 'requireDepartmentManagerAccess(event, actorUid, deptCode', 'callCodocsTenantRuntime<{ id: number')
    assert.match(page, /body:\s*\{ is_open: !target\.isOpen, dept_code: target\.deptCode \}/)
  })

  test('collaboration token carries verified department read context', () => {
    const documentPage = source('app/pages/documents/[uuid].vue')
    const collaborationComposable = source('app/composables/useCollaboration.ts')
    const tokenRoute = source('server/api/collaboration/token.get.ts')
    const runtimeHelper = source('server/utils/codocsRuntime.ts')

    assert.match(documentPage, /deptCode:\s*documentDeptCode/)
    assert.match(collaborationComposable, /deptCode\?:\s*MaybeRefOrGetter/)
    assert.match(collaborationComposable, /query\.dept_code = currentDeptCode/)
    assert.match(tokenRoute, /requireDepartmentReadAccess/)
    assert.match(tokenRoute, /const departmentReadDeptCode = String\(query\.dept_code \|\| query\.deptCode \|\| ''\)\.trim\(\)/)
    assertBefore(tokenRoute, 'await requireDepartmentReadAccess(event, actorUid, departmentReadDeptCode)', 'resolveCodocsCollaborationContext(event')
    assert.match(tokenRoute, /deptCode:\s*departmentReadDeptCode/)
    assert.match(runtimeHelper, /query\.trusted_department_read_dept_code = trustedDeptCode/)
    assert.match(runtimeHelper, /query\.trustedDepartmentReadDeptCode = trustedDeptCode/)
  })

  test('project cabinet signed URL service APIs require service token and path binding before OSS access', () => {
    const downloadUrl = source('server/api/v1/project-cabinet/[id]/download-url.get.ts')
    const previewUrl = source('server/api/v1/project-cabinet/[id]/preview-url.get.ts')
    const service = source('server/utils/projectCabinetService.ts')

    for (const content of [downloadUrl, previewUrl]) {
      assert.match(content, /requireAimsProjectCabinetServiceAuth\(event, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH\)/)
      assert.match(content, /expected_oss_path \|\| query\.expectedOssPath/)
      assertBefore(content, 'requireAimsProjectCabinetServiceAuth(event, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH)', 'getProjectCabinetFile(event')
      assertBefore(content, 'getProjectCabinetFile(event', 'getSignedUrl(file.oss_path')
    }
    assertBefore(previewUrl, 'getProjectCabinetFile(event', 'readCabinetTextPreview(event, file.oss_path)')
    assert.match(service, /file\.project_code !== projectCode/)
    assert.match(service, /assertExpectedOssPath\(file, expectedOssPath\)/)
    assert.match(service, /file\.oss_path !== expectedOssPath/)
    assert.match(service, /getCabinetFileMetadata\(event, 'project', id, \{ projectCode \}\)/)
  })

  test('v1 service document APIs verify service token before delegated writes', () => {
    const documentCreate = source('server/api/v1/documents/index.post.ts')
    const previewAccess = source('server/api/v1/documents/[uuid]/preview-access.post.ts')

    assert.match(documentCreate, /verifyInternalApi\(event,\s*\{\s*scopes:\s*\['codocs:documents:write'\]\s*\}\)/)
    assert.match(documentCreate, /if \(!body\.ownerUid\)/)
    assert.match(documentCreate, /ownerUid:\s*body\.ownerUid/)
    assert.match(documentCreate, /operatorUid:\s*body\.ownerUid/)
    assert.doesNotMatch(documentCreate, /requireRequestUid\(event/)
    assertBefore(documentCreate, 'verifyInternalApi(event', 'readBody(event)')
    assertBefore(documentCreate, 'verifyInternalApi(event', 'createCodocsDocumentMetadata(event')
    assertBefore(documentCreate, 'verifyInternalApi(event', 'uploadDocument(doc.oss_path')

    assert.match(previewAccess, /requireCodocsServiceAuth\(auth, AIMS_DOCUMENT_PREVIEW_GRANT_SERVICE_AUTH\)/)
    assert.match(previewAccess, /preview_access_service_command_required/)
    assert.doesNotMatch(previewAccess, /readBody\(/)
    assert.doesNotMatch(previewAccess, /callCodocsTenantRuntime\(/)
    assertBefore(previewAccess, 'requireCodocsServiceAuth(auth, AIMS_DOCUMENT_PREVIEW_GRANT_SERVICE_AUTH)', 'throw createError')
  })

  test('generic v1 document search and batch summary are retired before service input or runtime forwarding', () => {
    const search = source('server/api/v1/documents/search.get.ts')
    const batchSummary = source('server/api/v1/documents/batch-summary.post.ts')
    const alias = source('server/api/v1/codocs/[...path].ts')
    const runtime = source('../data-runtime/internal/apps/codocs/adapter.go')

    for (const route of [search, batchSummary]) {
      assert.match(route, /scoped_document_service_contract_required/)
      assert.doesNotMatch(route, /verifyInternalApi\(/)
      assert.doesNotMatch(route, /callCodocsTenantRuntime\(/)
      assert.doesNotMatch(route, /readBody\(/)
      assert.doesNotMatch(route, /getQuery\(/)
    }
    assert.match(alias, /normalized === 'documents\/search'/)
    assert.match(alias, /normalized === 'documents\/batch-summary'/)
    assert.match(alias, /scoped_document_service_contract_required/)
    assertBefore(alias, 'normalized === \'documents/search\'', 'proxyCurrentAppPath(event')
    assert.match(runtime, /suffix == "documents\/search" \|\| suffix == "documents\/batch-summary"/)
    assert.match(runtime, /codocs\.documents\.service_contract_required/)
    assert.match(runtime, /scoped_document_service_contract_required/)
    assert.doesNotMatch(runtime, /result, err := a\.documentsSearch\(ctx, query\)/)
    assert.doesNotMatch(runtime, /result, err := a\.documentsBatchSummary\(ctx, body\)/)
  })

  test('project cabinet routes enforce the Aims source/capability/project marker contract before OSS access', () => {
    const upload = source('server/api/v1/project-cabinet/upload.post.ts')
    const deleteFile = source('server/api/v1/project-cabinet/[id].delete.ts')

    assert.match(upload, /requireAimsProjectCabinetServiceAuth\(event, AIMS_PROJECT_CABINET_UPLOAD_SERVICE_AUTH\)/)
    assert.match(upload, /multipart\.find\(x => x\.name === 'owner_uid'\)/)
    assert.match(upload, /multipart\.find\(x => x\.name === 'project_code'\)/)
    assert.match(upload, /if \(!ownerUid\)/)
    assert.match(upload, /if \(!projectCode\)/)
    assert.match(upload, /\}, \{ projectCode \}\)/)
    assert.doesNotMatch(upload, /project_code:\s*projectCode/)
    assertBefore(upload, 'requireAimsProjectCabinetServiceAuth(event, AIMS_PROJECT_CABINET_UPLOAD_SERVICE_AUTH)', 'readMultipartFormData(event)')
    assertBefore(upload, 'requireAimsProjectCabinetServiceAuth(event, AIMS_PROJECT_CABINET_UPLOAD_SERVICE_AUTH)', 'createRuntimeOSSClient({ event, timeout: 300000 })')
    assertBefore(upload, 'requireAimsProjectCabinetServiceAuth(event, AIMS_PROJECT_CABINET_UPLOAD_SERVICE_AUTH)', 'createCabinetFileMetadata(event, \'project\'')

    assert.match(deleteFile, /requireAimsProjectCabinetServiceAuth\(event, AIMS_PROJECT_CABINET_DELETE_SERVICE_AUTH\)/)
    assert.match(deleteFile, /project_code 和 expected_oss_path 不能为空/)
    assert.match(deleteFile, /getProjectCabinetFileWithScope\(event, id, projectCode, expectedOssPath\)/)
    assert.match(deleteFile, /expectedOssPath: file\.oss_path/)
    assertBefore(deleteFile, 'requireAimsProjectCabinetServiceAuth(event, AIMS_PROJECT_CABINET_DELETE_SERVICE_AUTH)', 'readBody<Record<string, unknown>>(event)')
    assertBefore(deleteFile, 'getProjectCabinetFileWithScope(event, id, projectCode, expectedOssPath)', 'createRuntimeOSSClient({ event })')
    assertBefore(deleteFile, 'getProjectCabinetFileWithScope(event, id, projectCode, expectedOssPath)', 'deleteCabinetFileMetadata(event, \'project\'')
  })

  test('company and department asset browsing routes require view permission before OSS access', () => {
    const companyList = source('server/api/company-assets/list.get.ts')
    const companyPreview = source('server/api/company-assets/preview.get.ts')
    const companyExportDisabled = source('server/api/company-assets/export-docx.post.ts')
    const deptList = source('server/api/dept-assets/list.get.ts')
    const deptPreview = source('server/api/dept-assets/preview.get.ts')
    const deptExport = source('server/api/dept-assets/export-docx.post.ts')
    const assetPathHelper = source('server/utils/assetOssPath.ts')

    assert.match(companyList, /requirePermission\(event,\s*'company',\s*'view'[\s\S]*缺少组织资产查看权限/)
    assert.match(companyList, /buildCompanyAssetPrefix\(subdir,\s*subPath\)/)
    assertBefore(companyList, 'requirePermission(event, \'company\', \'view\'', 'createRuntimeOSSClient()')
    assertBefore(companyList, 'buildCompanyAssetPrefix(subdir, subPath)', 'createRuntimeOSSClient()')

    assert.match(companyPreview, /requirePermission\(event,\s*'company',\s*'view'[\s\S]*缺少组织资产查看权限/)
    assert.match(companyPreview, /normalizeCompanyAssetOssPath\(ossPath\)/)
    assertBefore(companyPreview, 'requirePermission(event, \'company\', \'view\'', 'createRuntimeOSSClient({ event })')
    assertBefore(companyPreview, 'requirePermission(event, \'company\', \'view\'', 'downloadDocument(normalizedOssPath, \'company\')')
    assertBefore(companyPreview, 'normalizeCompanyAssetOssPath(ossPath)', 'createRuntimeOSSClient({ event })')
    assertBefore(companyPreview, 'requirePermission(event, \'company\', \'view\'', 'getFileMetadata(normalizedOssPath, \'company\')')
    assertBefore(companyPreview, 'normalizeCompanyAssetOssPath(ossPath)', 'getFileMetadata(normalizedOssPath, \'company\')')
    assertBefore(companyPreview, 'normalizeCompanyAssetOssPath(ossPath)', 'downloadDocument(normalizedOssPath, \'company\')')

    assert.match(companyExportDisabled, /requirePermission\(event,\s*'company',\s*'view'[\s\S]*缺少组织资产查看权限/)
    assertBefore(companyExportDisabled, 'requirePermission(event, \'company\', \'view\'', '组织资产仅支持在线查看，不允许导出')

    assert.match(deptList, /requirePermission\(event,\s*'departments',\s*'view'[\s\S]*缺少部门文档查看权限/)
    assert.match(deptList, /buildDepartmentAssetPrefix\(deptCode,\s*subdir,\s*subPath\)/)
    assertBefore(deptList, 'requirePermission(event, \'departments\', \'view\'', 'createRuntimeOSSClient()')
    assertBefore(deptList, 'buildDepartmentAssetPrefix(deptCode, subdir, subPath)', 'createRuntimeOSSClient()')

    assert.match(deptPreview, /requirePermission\(event,\s*'departments',\s*'view'[\s\S]*缺少部门文档查看权限/)
    assert.match(deptPreview, /normalizeDepartmentAssetOssPath\(ossPath\)/)
    assertBefore(deptPreview, 'requirePermission(event, \'departments\', \'view\'', 'downloadDocument(normalizedOssPath, \'department\')')
    assertBefore(deptPreview, 'normalizeDepartmentAssetOssPath(ossPath)', 'downloadDocument(normalizedOssPath, \'department\')')

    assert.match(deptExport, /requirePermission\(event,\s*'departments',\s*'export'[\s\S]*缺少部门文档导出权限/)
    assert.match(deptExport, /normalizeDepartmentOutsideAssetOssPath\(body\?\.path\)/)
    assert.match(deptExport, /query:\s*\{\s*path:\s*ossPath\s*\}/)
    assert.match(deptExport, /downloadDocument\(ossPath\)/)
    assertBefore(deptExport, 'requirePermission(event, \'departments\', \'export\'', 'normalizeDepartmentOutsideAssetOssPath(body?.path)')
    assertBefore(deptExport, 'normalizeDepartmentOutsideAssetOssPath(body?.path)', 'callCodocsTenantRuntime<PublishRecord | null>')
    assertBefore(deptExport, 'normalizeDepartmentOutsideAssetOssPath(body?.path)', 'downloadDocument(ossPath)')

    assert.match(assetPathHelper, /export function normalizeCompanyAssetOssPath/)
    assert.match(assetPathHelper, /path\.startsWith\('codocs\/company\/'\)/)
    assert.match(assetPathHelper, /export function normalizeDepartmentAssetOssPath/)
    assert.match(assetPathHelper, /path\.startsWith\('codocs\/departments\/'\)/)
    assert.match(assetPathHelper, /export function normalizeDepartmentOutsideAssetOssPath/)
    assert.match(assetPathHelper, /segments\[3\] !== 'outsides'/)
    assert.match(assetPathHelper, /segment === '\.\.'/)
    assert.match(assetPathHelper, /rawPath\.includes\('\\\\'\)/)
    assert.match(assetPathHelper, /export function buildCompanyAssetPrefix/)
    assert.match(assetPathHelper, /export function buildDepartmentAssetPrefix/)
  })

  test('company and department asset destructive OSS operations require admin before side effects', () => {
    const companyMkdir = source('server/api/company-assets/mkdir.post.ts')
    const companyMove = source('server/api/company-assets/move.post.ts')
    const companyArchive = source('server/api/company-assets/archive.post.ts')
    const companyDirectoryDelete = source('server/api/company-assets/directory.delete.ts')
    const departmentArchive = source('server/api/dept-assets/archive.post.ts')

    assert.match(companyMkdir, /requirePermission\(event,\s*'company',\s*'admin'[\s\S]*仅管理员可创建目录/)
    assertBefore(companyMkdir, 'requirePermission(event, \'company\', \'admin\'', 'readBody(event)')
    assertBefore(companyMkdir, 'requirePermission(event, \'company\', \'admin\'', 'createRuntimeOSSClient()')
    assertBefore(companyMkdir, 'requirePermission(event, \'company\', \'admin\'', 'client.put(dirPath')

    assert.match(companyMove, /requirePermission\(event,\s*'company',\s*'admin'[\s\S]*仅管理员可移动文件/)
    assertBefore(companyMove, 'requirePermission(event, \'company\', \'admin\'', 'readBody(event)')
    assertBefore(companyMove, 'requirePermission(event, \'company\', \'admin\'', 'createRuntimeOSSClient()')
    assertBefore(companyMove, 'requirePermission(event, \'company\', \'admin\'', 'client.copy(newPath, sourcePath)')

    assert.match(companyArchive, /requirePermission\(event,\s*'company',\s*'admin'[\s\S]*仅管理员可归档文件/)
    assertBefore(companyArchive, 'requirePermission(event, \'company\', \'admin\'', 'readBody(event)')
    assertBefore(companyArchive, 'requirePermission(event, \'company\', \'admin\'', 'createRuntimeOSSClient()')
    assertBefore(companyArchive, 'requirePermission(event, \'company\', \'admin\'', 'client.copy(archivePath, sourcePath)')
    assertBefore(companyArchive, 'requirePermission(event, \'company\', \'admin\'', 'reportOperationAudit({')

    assert.match(companyDirectoryDelete, /requirePermission\(event,\s*'company',\s*'admin'[\s\S]*仅管理员可删除目录/)
    assertBefore(companyDirectoryDelete, 'requirePermission(event, \'company\', \'admin\'', 'readBody(event)')
    assertBefore(companyDirectoryDelete, 'requirePermission(event, \'company\', \'admin\'', 'createRuntimeOSSClient()')
    assertBefore(companyDirectoryDelete, 'requirePermission(event, \'company\', \'admin\'', 'client.listV2({')
    assertBefore(companyDirectoryDelete, 'requirePermission(event, \'company\', \'admin\'', 'client.delete(normalizedDirPath)')

    assert.match(departmentArchive, /requirePermission\(event,\s*'departments',\s*'admin'[\s\S]*仅管理员可归档文件/)
    assertBefore(departmentArchive, 'requirePermission(event, \'departments\', \'admin\'', 'readBody(event)')
    assertBefore(departmentArchive, 'requirePermission(event, \'departments\', \'admin\'', 'createRuntimeOSSClient()')
    assertBefore(departmentArchive, 'requirePermission(event, \'departments\', \'admin\'', 'client.copy(archivePath, sourcePath)')
    assertBefore(departmentArchive, 'requirePermission(event, \'departments\', \'admin\'', 'reportOperationAudit({')
  })

  test('clipboard and shared heartbeat proxies bind actor fields on the server', () => {
    const clipboardGet = source('server/api/account/clipboard.get.ts')
    const clipboardPost = source('server/api/account/clipboard.post.ts')
    const heartbeatPost = workspaceSource('foundation/server/api/heartbeat.post.ts')

    assert.match(clipboardGet, /requireRequestUid\(event\)/)
    assert.doesNotMatch(clipboardGet, /getQuery\(event\)/)

    assert.match(clipboardPost, /const uid = requireRequestUid\(event\)/)
    assert.match(clipboardPost, /body:\s*\{[\s\S]*\.\.\.body,[\s\S]*uid,[\s\S]*sourceApp:\s*'codocs'[\s\S]*\}/)
    assertBefore(clipboardPost, 'const uid = requireRequestUid(event)', 'fetchConsoleRuntimeResponse(\'/api/v1/clipboard\'')

    assert.match(heartbeatPost, /requireFoundationSessionUid\(event\)/)
    assert.match(heartbeatPost, /sourceApp:\s*appCode/)
    assert.doesNotMatch(heartbeatPost, /body\.sourceApp|body\.uid/)
  })

  test('weekly report mutation routes bind actor before body and side effects', () => {
    const departmentCreate = source('server/api/weekly-reports/create.post.ts')
    const personalCreate = source('server/api/personal-weekly-reports/create.post.ts')
    const revise = source('server/api/weekly-reports/revise.post.ts')
    const remind = source('server/api/weekly-reports/remind.post.ts')
    const submit = source('server/api/weekly-reports/submit.post.ts')

    for (const content of [departmentCreate, personalCreate, revise, remind, submit]) {
      assert.match(content, /const operatorUid = requireRequestUid\(event\)/)
      assertBefore(content, 'const operatorUid = requireRequestUid(event)', 'readBody(event)')
      assert.doesNotMatch(content, /operatorUid\s*=\s*body|operatorUid\}\s*=\s*body/)
    }

    for (const content of [departmentCreate, personalCreate]) {
      assertBefore(content, 'const operatorUid = requireRequestUid(event)', 'createCodocsDocumentMetadata(event')
      assert.match(content, /ownerUid:\s*operatorUid/)
      assert.match(content, /operatorUid,\s*\n/)
      assert.doesNotMatch(content, /const \{[^}]*owner_uid/)
      assert.doesNotMatch(content, /ownerUid:\s*owner_uid/)
    }

    assert.match(departmentCreate, /getRequestDisplayName\(event\)/)
    assert.match(personalCreate, /getRequestDisplayName\(event\)/)
    assert.doesNotMatch(personalCreate, /query:\s*\{\s*owner:\s*owner_uid/)
    assert.match(personalCreate, /query:\s*\{\s*owner:\s*operatorUid/)
    assert.match(personalCreate, /codocs\/worklogs\/\$\{operatorUid\}\/weekly/)

    assertBefore(revise, 'const operatorUid = requireRequestUid(event)', 'getCodocsDocumentMetadata(event, uuid')
    assertBefore(revise, 'dept.managerId !== operatorUid && dept.leaderId !== operatorUid', 'createCodocsDocumentMetadata(event')
    assertBefore(revise, 'dept.managerId !== operatorUid && dept.leaderId !== operatorUid', 'updateCodocsDocumentMetadata(event, uuid')

    assertBefore(remind, 'const operatorUid = requireRequestUid(event)', 'fetchDirectoryData<DepartmentResponse>')
    assertBefore(remind, 'if (!isManager && !isLeader && !isParentManager && !isParentLeader)', 'sendNotification(')
    assertBefore(remind, 'if (!isLeader && !isParentManager && !isParentLeader)', 'sendNotification(')

    assertBefore(submit, 'const operatorUid = requireRequestUid(event)', 'getCodocsDocumentMetadata(event, uuid')
    assertBefore(submit, 'dept.managerId !== operatorUid && dept.leaderId !== operatorUid', 'updateCodocsDocumentMetadata(event, uuid')
    assertBefore(submit, 'dept.managerId !== operatorUid && dept.leaderId !== operatorUid', 'sendNotification(')
    assert.match(submit, /actorUid:\s*operatorUid/)
  })

  test('user document, folder and worklog creation bind owner to the session actor', () => {
    const worklogCreate = source('server/api/worklogs/create.post.ts')
    const documentCreate = source('server/api/documents/index.post.ts')
    const documentUpload = source('server/api/documents/upload.post.ts')
    const folderCreate = source('server/api/folders/index.post.ts')

    for (const content of [worklogCreate, documentCreate, folderCreate]) {
      assert.match(content, /const operatorUid = requireRequestUid\(event\)/)
      assertBefore(content, 'const operatorUid = requireRequestUid(event)', 'readBody(event)')
      assert.doesNotMatch(content, /const \{[^}]*owner_uid/)
    }

    assert.match(worklogCreate, /getRequestDisplayName\(event\)/)
    assert.match(worklogCreate, /codocs\/worklogs\/\$\{operatorUid\}\/\$\{title\}\.md/)
    assert.match(worklogCreate, /query:\s*\{\s*owner:\s*operatorUid/)
    assert.match(worklogCreate, /ownerUid:\s*operatorUid/)
    assert.doesNotMatch(worklogCreate, /ownerUid:\s*owner_uid|owner_uid, limit|owner_realname/)

    assert.match(documentCreate, /ownerUid:\s*operatorUid/)
    assertBefore(documentCreate, 'const operatorUid = requireRequestUid(event)', 'createCodocsDocumentMetadata(event')
    assertBefore(documentCreate, 'await requireDepartmentWriteAccess(event, operatorUid', 'createCodocsDocumentMetadata(event')
    assert.doesNotMatch(documentCreate, /ownerUid:\s*owner_uid|owner_uid\s*\|\|\s*operatorUid/)

    assert.match(folderCreate, /owner_uid:\s*operatorUid/)
    assert.match(folderCreate, /requirePermission\(event,\s*'documents',\s*'create',\s*'缺少文档目录创建权限'\)/)
    assert.match(folderCreate, /folderMutationRuntimeQuery/)
    assertBefore(folderCreate, 'const operatorUid = requireRequestUid(event)', 'callCodocsTenantRuntime<{ id: number }>')
    assertBefore(folderCreate, 'requirePermission(event, \'documents\', \'create\'', 'readBody(event)')
    assertBefore(folderCreate, 'await requireDepartmentManagerAccess(event, operatorUid', 'callCodocsTenantRuntime<{ id: number }>')
    assert.doesNotMatch(folderCreate, /owner_uid:\s*owner_uid|owner_uid\s*\|\|\s*operatorUid/)

    assert.match(documentUpload, /const operatorUid = requireRequestUid\(event\)/)
    assertBefore(documentUpload, 'const operatorUid = requireRequestUid(event)', 'readMultipartFormData(event)')
    assertBefore(documentUpload, 'await requireDepartmentWriteAccess(event, operatorUid', 'createCodocsDocumentMetadata(event')
    assert.match(documentUpload, /ownerUid:\s*operatorUid/)
    assert.doesNotMatch(documentUpload, /multipart\.find\(x => x\.name === 'owner_uid'\)/)
    assert.doesNotMatch(documentUpload, /ownerUid:\s*ownerUid|ownerUid\s*\|\|\s*operatorUid/)
  })

  test('document share, notify, update and folder patch bind actor before request bodies', () => {
    const shareCreate = source('server/api/documents/[uuid]/shares.post.ts')
    const sharePatch = source('server/api/documents/[uuid]/shares/[shareId].patch.ts')
    const notify = source('server/api/documents/[uuid]/notify.post.ts')
    const documentUpdate = source('server/api/documents/[uuid]/index.put.ts')
    const folderPatch = source('server/api/folders/[id].patch.ts')

    for (const content of [shareCreate, sharePatch, notify]) {
      assert.match(content, /const actorUid = requireRequestUid\(event/)
      assertBefore(content, 'const actorUid = requireRequestUid(event', 'readBody(event)')
    }

    assertBefore(shareCreate, 'const actorUid = requireRequestUid(event)', 'getCodocsDocumentMetadata(event, documentId')
    assertBefore(shareCreate, 'actorUid !== ownerUid', 'const shareResult = await callCodocsTenantRuntime')
    assertBefore(shareCreate, 'actorUid !== ownerUid', 'sendNotification(')
    assert.doesNotMatch(shareCreate, /ownerName/)

    assertBefore(notify, 'const actorUid = requireRequestUid(event', 'getCodocsDocumentMetadata(event, uuid')
    assertBefore(notify, 'getCodocsDocumentMetadata(event, uuid', 'sendNotification(')

    assert.match(documentUpdate, /const actorUid = requireRequestUid\(event\)/)
    assertBefore(documentUpdate, 'const actorUid = requireRequestUid(event)', 'readBody(event)')
    assertBefore(documentUpdate, 'if (!uuid)', 'readBody(event)')
    assertBefore(documentUpdate, 'getCodocsDocumentMetadata(event, uuid', 'uploadDocument(doc.oss_path')
    assertBefore(documentUpdate, 'getCodocsDocumentMetadata(event, uuid', 'updateCodocsDocumentMetadata(event, uuid')

    assert.match(folderPatch, /const actorUid = requireRequestUid\(event\)/)
    assertBefore(folderPatch, 'const actorUid = requireRequestUid(event)', 'readBody(event)')
    assertBefore(folderPatch, 'const oldFolder = await callCodocsTenantRuntime<FolderRow>', 'readBody(event)')
    assertBefore(folderPatch, 'await requireDepartmentManagerAccess(event, actorUid', 'readBody(event)')
    assertBefore(folderPatch, 'readBody(event)', 'method: \'PATCH\'')
  })

  test('document delete route requires explicit delete permission before side effects', () => {
    const content = source('server/api/documents/[uuid]/index.delete.ts')

    assert.match(
      content,
      /requirePermission\(event,\s*'documents',\s*'delete'[\s\S]*缺少文档删除权限/
    )
    assertBefore(content, 'requirePermission(event, \'documents\', \'delete\'', 'moveToRecycleBin(doc.oss_path, doc.doc_type)')
    assertBefore(content, 'requirePermission(event, \'documents\', \'delete\'', 'callCodocsTenantRuntime<{ uuid: string, deleted: boolean }>')
  })

  test('cabinet file mutations require owner or department manager before metadata and OSS side effects', () => {
    const personalPatch = source('server/api/cabinet/[id].patch.ts')
    const personalDelete = source('server/api/cabinet/[id].delete.ts')
    const departmentPatch = source('server/api/dept-cabinet/[id].patch.ts')
    const departmentDelete = source('server/api/dept-cabinet/[id].delete.ts')

    for (const content of [personalPatch, personalDelete]) {
      assert.match(content, /const actorUid = requireRequestUid\(event\)/)
      assert.match(content, /file\.owner_uid !== actorUid/)
      assertBefore(content, 'const actorUid = requireRequestUid(event)', 'getCabinetFileMetadata(event, \'personal\', id)')
    }
    assertBefore(personalPatch, 'file.owner_uid !== actorUid', 'updateCabinetFileMetadata(event, \'personal\', id')
    assertBefore(personalDelete, 'file.owner_uid !== actorUid', 'deleteCabinetFileMetadata(event, \'personal\', id)')
    assertBefore(personalDelete, 'file.owner_uid !== actorUid', 'createOSSClient()')

    for (const content of [departmentPatch, departmentDelete]) {
      assert.match(content, /const actorUid = requireRequestUid\(event\)/)
      assert.match(content, /requireDepartmentManagerAccess\(event, actorUid,\s*file\.dept_code!,[\s\S]*仅部门经理可/)
      assert.match(content, /const deptCode = String\(query\.dept_code \|\| query\.deptCode/)
      assert.match(content, /getCabinetFileMetadata\(event, 'department', id, \{ departmentCode: deptCode \}\)/)
      assertBefore(content, 'const actorUid = requireRequestUid(event)', 'getCabinetFileMetadata(event, \'department\', id, { departmentCode: deptCode })')
    }
    assertBefore(departmentPatch, 'requireDepartmentManagerAccess(event, actorUid, file.dept_code!', 'updateCabinetFileMetadata(event, \'department\', id')
    assert.match(departmentPatch, /departmentManagerCode:\s*file\.dept_code!/)
    assertBefore(departmentDelete, 'requireDepartmentManagerAccess(event, actorUid, file.dept_code!', 'deleteCabinetFileMetadata(event, \'department\', id')
    assert.match(departmentDelete, /departmentManagerCode:\s*file\.dept_code!/)
    assertBefore(departmentDelete, 'requireDepartmentManagerAccess(event, actorUid, file.dept_code!', 'createOSSClient()')
  })

  test('cabinet upload and document conversion bind actor from session before OSS or document side effects', () => {
    const personalUpload = source('server/api/cabinet/upload.post.ts')
    const departmentUpload = source('server/api/dept-cabinet/upload.post.ts')
    const personalToDocument = source('server/api/cabinet/[id]/to-document.post.ts')
    const departmentToDocument = source('server/api/dept-cabinet/[id]/to-document.post.ts')

    assert.match(personalUpload, /const ownerUid = requireRequestUid\(event\)/)
    assert.doesNotMatch(personalUpload, /multipart\.find\(x => x\.name === 'owner_uid'\)/)
    assert.match(personalUpload, /owner_uid:\s*ownerUid/)
    assertBefore(personalUpload, 'const ownerUid = requireRequestUid(event)', 'createOSSClient({ timeout: 300000 })')
    assertBefore(personalUpload, 'const ownerUid = requireRequestUid(event)', 'createCabinetFileMetadata(event, \'personal\'')

    assert.match(departmentUpload, /const actorUid = requireRequestUid\(event\)/)
    assert.doesNotMatch(departmentUpload, /multipart\.find\(x => x\.name === 'owner_uid'\)/)
    assert.match(departmentUpload, /requireDepartmentManagerAccess\(event, actorUid,\s*deptCode,[\s\S]*仅部门经理可上传部门文件柜文件/)
    assert.match(departmentUpload, /owner_uid:\s*actorUid/)
    assert.match(departmentUpload, /departmentManagerCode:\s*deptCode/)
    assertBefore(departmentUpload, 'requireDepartmentManagerAccess(event, actorUid, deptCode', 'createRuntimeOSSClient({ event, timeout: 300000 })')
    assertBefore(departmentUpload, 'requireDepartmentManagerAccess(event, actorUid, deptCode', 'createCabinetFileMetadata(event, \'department\'')

    assert.match(personalToDocument, /const actorUid = requireRequestUid\(event\)/)
    assert.match(personalToDocument, /file\.owner_uid !== actorUid/)
    assert.match(personalToDocument, /ownerUid:\s*actorUid/)
    assert.match(personalToDocument, /operatorUid:\s*actorUid/)
    assertBefore(personalToDocument, 'file.owner_uid !== actorUid', 'createOSSClient()')
    assertBefore(personalToDocument, 'file.owner_uid !== actorUid', 'createCodocsDocumentMetadata(event')

    assert.match(departmentToDocument, /const actorUid = requireRequestUid\(event\)/)
    assert.match(departmentToDocument, /requireDepartmentManagerAccess\(event, actorUid,\s*file\.dept_code!,[\s\S]*仅部门经理可将部门文件柜文件转为文档/)
    assert.match(departmentToDocument, /operatorUid:\s*actorUid/)
    assertBefore(departmentToDocument, 'requireDepartmentManagerAccess(event, actorUid, file.dept_code!', 'createOSSClient()')
    assertBefore(departmentToDocument, 'requireDepartmentManagerAccess(event, actorUid, file.dept_code!', 'createCodocsDocumentMetadata(event')
  })

  test('department cabinet folders use local session and department scope instead of generic runtime proxy', () => {
    const folderGet = source('server/api/dept-cabinet/folders.get.ts')
    const folderPost = source('server/api/dept-cabinet/folders.post.ts')
    const folderPatch = source('server/api/dept-cabinet/folders/[id].patch.ts')
    const folderDelete = source('server/api/dept-cabinet/folders/[id].delete.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(folderGet, /const actorUid = requireRequestUid\(event\)/)
    assert.match(folderGet, /requirePermission\(event, 'documents', 'view', '缺少文档查看权限'\)/)
    assert.match(folderGet, /requireDepartmentReadAccess\(event, actorUid, deptCode\)/)
    assert.match(folderGet, /CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY/)
    assert.match(folderGet, /Reflect\.deleteProperty\(query, key\)/)
    assertBefore(folderGet, 'const actorUid = requireRequestUid(event)', 'callCodocsTenantRuntime<RuntimePage>')
    assertBefore(folderGet, 'await requireDepartmentReadAccess(event, actorUid, deptCode)', 'callCodocsTenantRuntime<RuntimePage>')

    assert.match(folderPost, /const actorUid = requireRequestUid\(event\)/)
    assert.doesNotMatch(folderPost, /const \{[^}]*owner_uid/)
    assert.match(folderPost, /requireDepartmentManagerAccess\(event, actorUid,\s*dept_code,[\s\S]*仅部门经理可创建部门文件柜目录/)
    assert.match(folderPost, /owner_uid:\s*actorUid/)
    assertBefore(folderPost, 'requireDepartmentManagerAccess(event, actorUid, dept_code', 'callCodocsTenantRuntime<{ items?: FolderRow[] }>')
    assertBefore(folderPost, 'requireDepartmentManagerAccess(event, actorUid, dept_code', 'callCodocsTenantRuntime<FolderRow>')

    assert.match(folderPatch, /requireDepartmentManagerAccess\(event, actorUid,\s*folder\.dept_code,[\s\S]*仅部门经理可修改部门文件柜目录/)
    assertBefore(folderPatch, 'requireDepartmentManagerAccess(event, actorUid, folder.dept_code', 'callCodocsTenantRuntime<{ items?: FolderRow[] }>')
    assertBefore(folderPatch, 'requireDepartmentManagerAccess(event, actorUid, folder.dept_code', 'method: \'PATCH\'')

    assert.match(folderDelete, /requireDepartmentManagerAccess\(event, actorUid,\s*folder\.dept_code!,[\s\S]*仅部门经理可删除部门文件柜目录/)
    assertBefore(folderDelete, 'requireDepartmentManagerAccess(event, actorUid, folder.dept_code!', 'callCodocsTenantRuntime<{ items?: FolderRow[] }>')
    assertBefore(folderDelete, 'requireDepartmentManagerAccess(event, actorUid, folder.dept_code!', 'method: \'DELETE\'')

    assert.match(middleware, /apiPath === '\/api\/dept-cabinet\/folders' \|\| apiPath\.startsWith\('\/api\/dept-cabinet\/folders\/'\)/)
    assert.doesNotMatch(middleware, /runtimePrefix: '\/v1\/codocs\/dept-cabinet\/folders'/)
  })

  test('department shares stay on their local authorization boundary', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')
    const sharesList = source('server/api/dept-shares/index.get.ts')
    const sharePatch = source('server/api/dept-shares/[id].patch.ts')

    assert.match(middleware, /apiPath === '\/api\/dept-shares' \|\| apiPath\.startsWith\('\/api\/dept-shares\/'\)/)
    assert.doesNotMatch(middleware, /runtimePrefix: '\/v1\/codocs\/dept-shares'/)

    assert.match(sharesList, /requireRequestUid\(event\)/)
    assert.match(sharesList, /requireDepartmentManagerAccess\(event, uid, deptCode/)
    assert.match(sharesList, /codocs_trusted_department_share_manager_dept_code/)
    assert.match(sharePatch, /requireRequestUid\(event\)/)
    assert.match(sharePatch, /requireDepartmentManagerAccess\(event, uid, share\.dept_code/)
    assert.match(sharePatch, /query: \{ \[TRUSTED_DEPARTMENT_SHARE_MANAGER_QUERY_KEY\]: share\.dept_code \}/)
  })

  test('parent-scoped resources cannot be reintroduced through a generic runtime mapping', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(middleware, /if \(isScopedNestedResourceGenericPath\(apiPath\)\) return null/)
    for (const path of [
      '/api/document-shares',
      '/api/document-versions',
      '/api/annotations',
      '/api/annotation-replies',
      '/api/issue-comments'
    ]) {
      assert.match(middleware, new RegExp(`'${path.replaceAll('/', '\\/')}'`))
    }
    assert.doesNotMatch(middleware, /runtimePrefix: '\/v1\/codocs\/(?:document-shares|document-versions|annotations|annotation-replies|issue-comments)/)
  })

  test('publish request orchestration requires review submission permission', () => {
    assert.match(
      source('server/api/reviews/publish-requests/index.post.ts'),
      /requirePermission\(event,\s*'reviews',\s*'submit'/
    )
    assert.match(
      source('server/api/reviews/publish-requests/[id]/workflow-instance.post.ts'),
      /requirePermission\(event,\s*'reviews',\s*'submit'/
    )
  })

  test('publish request workflow binding uses the trusted command, exact capability and receipt checkpoint', () => {
    const content = source('server/api/reviews/publish-requests/[id]/workflow-instance.post.ts')

    assert.match(content, /workflow-command/)
    assert.match(content, /workflow:document-publish:create/)
    assert.match(content, /buildServiceCommandEnvelope/)
    assert.match(content, /validateServiceCommandReceipt/)
    assert.match(content, /workflow-checkpoint/)
    assert.doesNotMatch(content, /readBody\(/)
  })

  test('publish submission uses only the trusted Workflow service-command path', () => {
    const modal = source('app/components/review/SubmitReviewModal.vue')
    const menu = source('app/config/permissions.ts')

    assert.match(modal, /publish-requests\/\$\{createRequestRes\.data\.publish_request\.id\}\/workflow-instance/)
    assert.doesNotMatch(modal, /\/api\/reviews\/templates|prepareInstance\(|createInstance\(/)
    assert.doesNotMatch(menu, /\/admin\/publish|\/admin\/templates|发文流程|模板管理/)
  })

  test('my-review reads establish user and review permission boundaries', () => {
    const mine = source('server/api/reviews/my.get.ts')

    assert.match(mine, /requireRequestUid\(event/)
    assert.match(mine, /requirePermission\(event, 'reviews', 'view', '缺少审阅查看权限'\)/)
  })

  test('legacy review action endpoints remain fail-closed until tenant-runtime contracts exist', () => {
    const legacyReviewActionRoutes = [
      'server/api/reviews/[id]/approve.post.ts',
      'server/api/reviews/[id]/reject.post.ts',
      'server/api/reviews/[id]/resubmit.post.ts',
      'server/api/reviews/[id]/remind.post.ts',
      'server/api/reviews/index.post.ts'
    ]

    for (const path of legacyReviewActionRoutes) {
      const content = source(path)
      assert.match(content, /statusCode:\s*503/, path)
      assert.match(content, /Codocs tenant-runtime contract is required/, path)
      assert.doesNotMatch(content, /readBody|queryRow|queryRows|execute|useDbPool|callCodocsTenantRuntime/, path)
      assert.doesNotMatch(content, /requirePermission\(event,\s*'reviews',\s*'(approve|archive|submit)'/, path)
    }
  })

  test('Workflow post-approval execution routes use trusted tenant-runtime contracts', () => {
    const archive = source('server/api/reviews/[id]/archive.post.ts')
    const seal = source('server/api/reviews/[id]/seal.post.ts')
    const send = source('server/api/reviews/[id]/send.post.ts')
    const receive = source('server/api/reviews/[id]/receive.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    for (const content of [archive, seal, send, receive]) {
      assert.match(content, /requireRequestUid\(event,\s*'未登录'\)/)
      assert.match(content, /callCodocsTenantRuntime/)
      assert.doesNotMatch(content, /statusCode:\s*503/)
      assert.doesNotMatch(content, /useDbPool|queryRow|queryRows|execute/)
    }

    assert.match(archive, /requirePermission\(event,\s*'reviews',\s*'archive'/)
    assert.match(archive, /publish-requests\/\$\{encodeURIComponent\(requestId\)\}\/archive-plan/)
    assert.match(archive, /publish-requests\/\$\{encodeURIComponent\(requestId\)\}\/archive`/)
    assertBefore(archive, '/archive-plan`', 'downloadDocument(plan.sourceOssPath')
    assertBefore(archive, 'uploadDocument(plan.archiveOssPath, content)', 'const committed = await callCodocsTenantRuntime')
    assertBefore(archive, 'const committed = await callCodocsTenantRuntime', 'await notifyPublished(')

    assert.match(seal, /requirePermission\(event,\s*'reviews',\s*'admin'/)
    assert.match(seal, /publish-requests\/\$\{encodeURIComponent\(requestId\)\}\/seal/)
    assertBefore(seal, 'const result = await callCodocsTenantRuntime', 'await notifySealConfirmed(')

    assert.match(send, /requirePermission\(event,\s*'reviews',\s*'archive'/)
    assert.match(send, /publish-requests\/\$\{encodeURIComponent\(requestId\)\}\/send/)
    assertBefore(send, 'const result = await callCodocsTenantRuntime', 'await notifySendConfirmed(')

    assert.match(receive, /requirePermission\(event,\s*'reviews',\s*'view'/)
    assert.match(receive, /publish-requests\/\$\{encodeURIComponent\(requestId\)\}\/receive/)
    assertBefore(receive, 'const result = await callCodocsTenantRuntime', 'await notifyReceiveConfirmed(')

    assert.match(middleware, /reviews\\\/\[\^\/\]\+\\\/\(\?:archive\|receive\|seal\|send\).*method === 'POST'/)
    assert.doesNotMatch(middleware, /BLOCKED_LEGACY_ROUTES[\s\S]{0,240}approve\|archive\|receive\|reject\|remind\|resubmit\|seal\|send/)
  })

  test('seal work queue marker is derived from review admin permission', () => {
    const content = source('server/api/collab-docs/index.get.ts')

    assert.match(content, /delete query\.codocs_trusted_review_execution_admin/)
    assert.match(content, /checkPermission\(event,\s*'reviews',\s*'admin'\)/)
    assert.match(content, /codocs_trusted_review_execution_admin:\s*canAdminReviewExecution \? '1' : undefined/)
    assertBefore(content, 'checkPermission(event, \'reviews\', \'admin\')', 'callCodocsTenantRuntime(event')
  })

  test('publish request Workflow callback is service-bound and only projects the fixed terminal state', () => {
    const callback = source('server/api/reviews/workflow-callback.post.ts')
    assert.match(callback, /WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH/)
    assert.match(callback, /requireCodocsServiceTenantDeploymentBinding/)
    assert.match(callback, /getHeader\(event, 'x-hzy-tenant'\)/)
    assert.match(callback, /getHeader\(event, 'x-hzy-deployment'\)/)
    assertBefore(callback, 'requireCodocsServiceTenantDeploymentBinding(', 'readBody<WorkflowCallback>')
    assert.match(callback, /body\.app_code !== 'codocs'/)
    assert.match(callback, /body\.resource_code !== 'documents'/)
    assert.match(callback, /workflow-callback/)
    assert.doesNotMatch(callback, /current_user|requirePermission/)
  })

  test('runtime-forwarded document share, version and folder mutations require document permissions', () => {
    const content = source('server/middleware/tenant-runtime.ts')
    const folderCreate = source('server/api/folders/index.post.ts')

    assertBefore(content, 'await requireRuntimeRoutePermission(event, apiPath, method)', 'maybeCallCodocsTenantRuntime<unknown>')
    assert.match(content, /\/api\\\/documents\\\/\[\^\/\]\+\\\/shares\$[\s\S]{0,120}method === 'POST'[\s\S]{0,180}requirePermission\(event,\s*'documents',\s*'edit'[\s\S]*缺少文档共享权限/)
    assert.match(content, /\/api\\\/documents\\\/\[\^\/\]\+\\\/shares\\\/\[\^\/\]\+\$[\s\S]{0,160}method === 'PATCH' \|\| method === 'DELETE'[\s\S]{0,180}requirePermission\(event,\s*'documents',\s*'edit'[\s\S]*缺少文档共享管理权限/)
    assert.match(content, /\/api\\\/documents\\\/\[\^\/\]\+\\\/versions\\\/\[\^\/\]\+\$[\s\S]{0,120}method === 'DELETE'[\s\S]{0,180}requirePermission\(event,\s*'documents',\s*'edit'[\s\S]*缺少文档版本管理权限/)
    assert.match(folderCreate, /requirePermission\(event,\s*'documents',\s*'create'[\s\S]*缺少文档目录创建权限/)
    assert.match(content, /apiPath === '\/api\/folders' && method === 'POST'\) return true/)
    assert.doesNotMatch(content, /apiPath === '\/api\/folders' && method === 'POST'\) \{\s*return \{ runtimePath:/)
    assert.match(content, /\/api\\\/folders\\\/\[\^\/\]\+\$[\s\S]{0,160}method === 'PATCH' \|\| method === 'DELETE'[\s\S]{0,180}requirePermission\(event,\s*'documents',\s*'edit'[\s\S]*缺少文档目录管理权限/)
  })

  test('generic folder fallback and project OSS document reads stay fail-closed without scoped contracts', () => {
    const runtime = source('../data-runtime/internal/apps/codocs/adapter.go')
    const projectFiles = source('server/api/project-docs/files/[...projectCode].get.ts')
    const projectDiff = source('server/api/project-docs/diff/[...projectCode].get.ts')

    assert.match(runtime, /suffix == "folders" \|\| strings\.HasPrefix\(suffix, "folders\/"\)/)
    assert.match(runtime, /folder_scope_contract_required/)

    for (const route of [projectFiles, projectDiff]) {
      assert.match(route, /requireRequestUid\(event\)/)
      assert.match(route, /requirePermission\(event, 'projects', 'view', '缺少项目查看权限'\)/)
      assert.match(route, /project_document_scope_contract_required/)
    }
    assertBefore(projectFiles, 'project_document_scope_contract_required', 'fetchDirectoryResponse<DirectoryProjectList>')
    assertBefore(projectFiles, 'project_document_scope_contract_required', 'const files = await listGitProjectDocsFromOSS')
    assertBefore(projectDiff, 'project_document_scope_contract_required', 'fetchDirectoryResponse<Project>')
    assertBefore(projectDiff, 'project_document_scope_contract_required', 'const client = createProjectsOSSClient()')
  })

  test('department cabinet publish requires company publish permission before OSS copy', () => {
    const content = source('server/api/dept-cabinet/publish.post.ts')

    assert.match(content, /requirePermission\(event,\s*'company',\s*'publish'[\s\S]*缺少组织资产发布权限/)
    assertBefore(content, 'requirePermission(event, \'company\', \'publish\'', 'client.copy(targetPath, file.oss_path)')
  })

  test('info sync trigger requires info admin permission before fetcher call', () => {
    const content = source('server/api/info/sync.post.ts')

    assert.match(content, /requirePermission\(event,\s*'info',\s*'admin'[\s\S]*仅管理员可触发资讯同步/)
    assertBefore(content, 'requirePermission(event, \'info\', \'admin\'', '$fetch<SyncResponse>')
  })

  test('info management mutations require info admin before runtime, fetcher and OSS side effects', () => {
    const managementList = source('server/api/info/management.get.ts')
    const managementWrite = source('server/api/info/management.put.ts')
    const infoDelete = source('server/api/info/[id].delete.ts')

    assert.match(managementList, /requirePermission\(event,\s*'info',\s*'admin'[\s\S]*仅管理员可管理资讯书签/)
    assertBefore(managementList, 'requirePermission(event, \'info\', \'admin\'', 'callCodocsTenantRuntime<BookmarkListData>')

    assert.match(managementWrite, /requirePermission\(event,\s*'info',\s*'admin'[\s\S]*仅管理员可管理资讯书签/)
    assertBefore(managementWrite, 'requirePermission(event, \'info\', \'admin\'', 'callCodocsTenantRuntime<RuntimeActionResult>')
    assertBefore(managementWrite, 'requirePermission(event, \'info\', \'admin\'', '$fetch(`${fetcherUrl}/process`')

    assert.match(infoDelete, /requirePermission\(event,\s*'info',\s*'admin'[\s\S]*仅管理员可删除资讯/)
    assertBefore(infoDelete, 'requirePermission(event, \'info\', \'admin\'', 'callCodocsTenantRuntime<DeleteInfoResult>')
    assertBefore(infoDelete, 'requirePermission(event, \'info\', \'admin\'', 'deleteDocument(result.oss_path)')
  })

  test('admin image and collaboration cleanup endpoints require app admin before OSS access', () => {
    const imageList = source('server/api/admin/images.get.ts')
    const imageDelete = source('server/api/admin/images.delete.ts')
    const imageDocContent = source('server/api/admin/images/doc-content.get.ts')
    const imagePreview = source('server/api/admin/images/preview.get.ts')
    const cleanupYjs = source('server/api/admin/cleanup-yjs.delete.ts')

    for (const content of [imageList, imageDelete, imageDocContent, imagePreview, cleanupYjs]) {
      assert.match(content, /requirePermission\(event,\s*'admin',\s*'admin'/)
    }

    assertBefore(imageList, 'requirePermission(event, \'admin\', \'admin\'', 'listImages()')
    assertBefore(imageDelete, 'requirePermission(event, \'admin\', \'admin\'', 'readBody<{ paths?: string[] }>')
    assertBefore(imageDocContent, 'requirePermission(event, \'admin\', \'admin\'', 'downloadDocument(doc.oss_path, doc.doc_type)')
    assertBefore(imagePreview, 'requirePermission(event, \'admin\', \'admin\'', 'downloadImageBuffer(path)')
    assertBefore(cleanupYjs, 'requirePermission(event, \'admin\', \'admin\'', 'createOSSClient()')
    assertBefore(cleanupYjs, 'requirePermission(event, \'admin\', \'admin\'', 'createProjectsOSSClient()')
    assertBefore(cleanupYjs, 'requirePermission(event, \'admin\', \'admin\'', 'const files = await listYjsFiles(mainClient, p)')
    assertBefore(cleanupYjs, 'requirePermission(event, \'admin\', \'admin\'', 'const projectFiles = await listYjsFiles(projectsClient')
    assertBefore(cleanupYjs, 'requirePermission(event, \'admin\', \'admin\'', 'await mainClient.deleteMulti(batch)')
    assertBefore(cleanupYjs, 'requirePermission(event, \'admin\', \'admin\'', 'await projectsClient.deleteMulti(batch)')
  })

  test('project issue mutations resolve a trusted project scope before runtime access', () => {
    const createIssue = source('server/api/issues/index.post.ts')
    const updateIssue = source('server/api/issues/[id].patch.ts')
    const deleteIssue = source('server/api/issues/[id].delete.ts')
    const scope = source('server/utils/issueProjectAccess.ts')

    assert.match(scope, /const actorUid = requireRequestUid\(event\)/)
    assert.match(scope, /fetchDirectoryProjectAccessByService\(event, projectCode, actorUid\)/)
    assert.doesNotMatch(scope, /fetchDirectoryResponse/)
    assert.match(scope, /loadScopedAuthorizationFromConsoleRuntime/)
    assert.match(scope, /statusCode: 503/)
    assert.match(scope, /CODOCS_TRUSTED_ISSUE_PROJECT_QUERY_KEY/)

    assert.match(createIssue, /resolveIssueProjectAccess\(event, issueProjectCode\(project_code\), 'edit'\)/)
    assert.doesNotMatch(createIssue, /const \{[\s\S]*created_by[\s\S]*\} = body/)
    assert.match(createIssue, /created_by:\s*creatorUid/)
    assert.match(createIssue, /body:\s*\{ uids: \[creatorUid\] \}/)
    assert.match(createIssue, /query: issueRuntimeQuery\(\{\}, access\.projectCode\)/)
    assertBefore(createIssue, 'resolveIssueProjectAccess(event, issueProjectCode(project_code), \'edit\')', 'callCodocsTenantRuntime<{ id: number }>')

    assert.match(updateIssue, /resolveIssueProjectAccess\(event, issueProjectCode\(body\.project_code \|\| body\.projectCode\), 'edit'\)/)
    assert.match(updateIssue, /query: issueRuntimeQuery\(\{\}, access\.projectCode\)/)
    assertBefore(updateIssue, 'resolveIssueProjectAccess(event, issueProjectCode(body.project_code || body.projectCode), \'edit\')', 'callCodocsTenantRuntime<IssueRow>')
    assertBefore(updateIssue, 'resolveIssueProjectAccess(event, issueProjectCode(body.project_code || body.projectCode), \'edit\')', 'callCodocsTenantRuntime(event, `/v1/codocs/issues/')

    assert.match(deleteIssue, /resolveIssueProjectAccess\(event, issueProjectCode\(query\.project_code \|\| query\.projectCode\), 'edit'\)/)
    assertBefore(deleteIssue, 'resolveIssueProjectAccess(event, issueProjectCode(query.project_code || query.projectCode), \'edit\')', 'callCodocsTenantRuntime(event, `/v1/codocs/issues/')
  })

  test('project issue reads and comments require a scoped project marker before runtime access', () => {
    const listIssue = source('server/api/issues/index.get.ts')
    const detailIssue = source('server/api/issues/[id].get.ts')
    const pendingCount = source('server/api/issues/pending-count.get.ts')
    const comment = source('server/api/issues/[id]/comments.post.ts')
    const imageUpload = source('server/api/issues/upload-image.post.ts')

    for (const route of [listIssue, detailIssue, pendingCount, comment]) {
      assert.match(route, /resolveIssueProjectAccess\(/)
      assert.match(route, /issueRuntimeQuery\(/)
      assert.ok(
        route.indexOf('resolveIssueProjectAccess(') < route.lastIndexOf('callCodocsTenantRuntime'),
        'project scope must precede the runtime call'
      )
    }
    assert.doesNotMatch(comment, /const \{ author, content \} = body/)
    assert.match(comment, /body: \{ content \}/)
    assert.match(imageUpload, /requirePermission\(event,\s*'projects',\s*'edit'/)
    assertBefore(imageUpload, 'requirePermission(event, \'projects\', \'edit\'', 'createImagesOSSClient()')
  })

  test('project document sync and conflict mutations require project edit permission', () => {
    const expectations = [
      {
        path: 'server/api/project-docs/gitlab-sync/[...projectCode].get.ts',
        message: '缺少项目文档同步权限',
        sideEffect: 'syncProjectDocsFromGitLab(projectCode)'
      },
      {
        path: 'server/api/project-docs/resolve-conflicts/[...projectCode].post.ts',
        message: '缺少项目文档冲突处理权限',
        sideEffect: 'createProjectsOSSClient()'
      },
      {
        path: 'server/api/project-docs/use-gitlab-version/[...projectCode].post.ts',
        message: '缺少项目文档冲突处理权限',
        sideEffect: 'createProjectsOSSClient()'
      },
      {
        path: 'server/api/project-docs/ignore-conflict/[...projectCode].post.ts',
        message: '缺少项目文档冲突处理权限',
        sideEffect: 'createProjectsOSSClient()'
      },
      {
        path: 'server/api/project-docs/gitlab-submit/[...projectCode].post.ts',
        message: '缺少项目文档提交权限',
        sideEffect: 'submitProjectDocsToGitLab({'
      }
    ]

    for (const item of expectations) {
      const content = source(item.path)
      assert.match(content, new RegExp(`requirePermission\\(event,\\s*'projects',\\s*'edit'[\\s\\S]*${item.message}`))
      assertBefore(content, 'requirePermission(event, \'projects\', \'edit\'', item.sideEffect)
    }
  })

  test('project document GitLab submit uses verified session uid instead of request body uid', () => {
    const content = source('server/api/project-docs/gitlab-submit/[...projectCode].post.ts')

    assert.match(content, /const uid = requireRequestUid\(event,\s*'未登录或会话已过期'\)/)
    assert.doesNotMatch(content, /uid\?: string/)
    assertBefore(content, 'const uid = requireRequestUid', 'submitProjectDocsToGitLab({')
    assert.match(content, /submitProjectDocsToGitLab\(\{[\s\S]*uid,[\s\S]*authorName: uid,[\s\S]*authorEmail: `\$\{uid\}@wiztek\.cn`/)
  })

  test('runtime-backed publish request mutations are guarded before orchestration', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'await requireRuntimeRoutePermission(event, apiPath, method)', 'maybeCallCodocsTenantRuntime<unknown>')
    assert.match(content, /reviews\\\/publish-requests\\\/\[\^\/\]\+\$/)
    assert.match(content, /requirePermission\(event,\s*'reviews',\s*'submit'[\s\S]*缺少审阅提交权限/)
  })

  test('runtime proxy overwrites client-supplied actor context with session uid', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /function withCurrentUser\(value: Record<string, unknown>, uid: string\)/)
    assert.match(content, /current_user:\s*uid/)
    assert.match(content, /currentUser:\s*uid/)
    assert.match(content, /operator_uid:\s*uid/)
    assert.match(content, /operatorUid:\s*uid/)
    assert.match(content, /actorUid:\s*uid/)
    assert.match(content, /actor_uid:\s*uid/)
    assert.doesNotMatch(content, /current_user:\s*value\.current_user\s*\?\?\s*uid/)
    assert.doesNotMatch(content, /operator_uid:\s*value\.operator_uid\s*\?\?\s*uid/)
    assert.doesNotMatch(content, /actorUid:\s*value\.actorUid\s*\?\?\s*uid/)
  })

  test('ops knowledge service link wires the tested service guard before runtime proxying', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'await requireForwardedServiceCapability(event, apiPath, method)', 'maybeCallCodocsTenantRuntime<unknown>')
    assert.match(content, /apiPath === '\/api\/v1\/service\/ops-knowledge\/link' && method === 'POST'/)
    assert.match(content, /requireCodocsServiceAuth\(auth, ALTOC_OPS_KNOWLEDGE_SERVICE_AUTH\)/)
    assert.match(content, /sourceApp:\s*'altoc',\s*source_app:\s*'altoc'/)
  })

  test('unknown service-only Codocs paths are rejected before local BFF handling', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'if (isCodocsServiceApiPath(apiPath))', 'if (isRuntimeBackedBffPath(apiPath, method)) return')
    assert.match(content, /function isCodocsServiceApiPath\(apiPath: string\)/)
    assert.match(content, /Unsupported Codocs service endpoint capability/)
  })
})
