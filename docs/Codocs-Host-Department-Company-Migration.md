# Codocs 部门文档、组织资产与项目组文档迁入 Enterprise Host：盘点与授权合同（准备稿）

日期：2026-09-28。状态：**只读盘点与合同草案，待 Claude 审阅授权合同、待用户裁定 §8**；未改代码、未部署、未改 DB/grant。
依据：用户选择方案 A（10/8 上线前迁入，见 `46927461`）；2026-09-28 追加“项目组文档（`doc_type=project`）迁入，代码仓库生成文档（`git-project`）不迁”，并裁定“项目组文档放在 Host『文档协作』菜单下，不挂在 Aims 项目页或组织资产下”。
上级台账：[统一实施计划 INT-606d](./Unified-Enterprise-Implementation-Plan.md)；范围基线：[Codocs 接入边界](./Codocs-Enterprise-Integration-Scope.md)；首批路由盘点：[Codocs 路由盘点](./Codocs-Enterprise-Route-Inventory.md)。

证据标记：**[核实]** = 有 `文件:行` 或只读生产查询；**[推断]** = 由代码结构推出、未运行验证。生产查询只用 information_schema 与 COUNT/GROUP BY（非正文列），不含标题、正文或个人数据。

## 0. 结论摘要

1. 独立 Codocs 的部门授权完全由 Codocs BFF 用 Console Directory 现查“成员/经理/负责人/上级”关系后决定，Runtime 只认 BFF 注入的受信部门 marker；人员权限却挂在 `documents:*` 上（`documents:view` 的基线范围是 `owned_or_shared`），与 manifest/基线里的 `departments:*`（范围 `member_department`）不一致。Host 迁移必须改为按对象类型使用 `departments:*`，不能照搬（§5.2）。
2. Runtime 的文档写 ACL 只有 owner 或 `document_shares.permission='write'`（`document_lifecycle.go:389-411`），**没有部门经理分支**。独立端“仅部门经理可删除/恢复/设只读”的 BFF 规则在 Runtime 层对非 owner 经理实际会被拒绝 [核实代码，未做环境复现]。Host 需要新的部门专用 Runtime 操作，不能复用 personal 操作（personal recycle/restore 明确只接受个人类型，`personal_document_recycle.go:57-58`）。
3. 组织资产（公司 7 个目录）和部门资产（会议记录/对外发文/部门规章）是 **OSS 目录浏览**，不是 DB 文档列表；独立端 `dept-assets/*` 只查 `departments:view`，**不校验调用者与 `deptCode` 的部门关系** [核实 `dept-assets/list.get.ts:43-51`、`preview.get.ts:9-13`]。Host 不得移植这个缺口。
4. 生产使用集中在部门文档：193 篇有效、4 个部门有实质内容、近 30 天 17 篇有更新；组织资产查看记录 162 条全部发生在近 30 天；项目组文档仅 10 篇有效，近 90 天只有 1 篇更新（§2）。
5. 项目组文档的 `project_code` 分属两套互不重叠的项目注册表（Console Directory 64 个、Aims 142 个、交集 0），10 篇有效文档中 3 篇在 Directory、4 篇在 Aims、3 篇两边都找不到 [核实]。且当前 Runtime 明确不把 `project_code` 当授权输入（`folders.go:30-33`），项目成员今天只能看到自己拥有或被分享的项目文档。按项目成员放开可见性属于**授权扩大**，需用户确认（§5.9、§8 D9）。
6. 建议三批并行：B1 部门（含部门文件柜、部门资产浏览）、B2 组织资产、知识库、模板与部门开放文档、B3 项目组文档（小批）。团队汇报与部门“发布”走 Workflow 的发文申请单列为可选子批，未完成前入口隐藏（§7）。

## 1. 范围

| 纳入 | 说明 |
| --- | --- |
| `codocs/app/pages/departments/index.vue` | 部门协同文档树（目录 + 文档、已发布/未发布两种模式、回收站、待接收移交） |
| `departments/cabinet.vue` | 部门文件柜（目录、上传、预览、下载、转文档、发布 PDF 到组织资产） |
| `departments/records.vue`、`outsides.vue`、`rules.vue` | `DepartmentAssetBrowser` 的三个 OSS 子目录 |
| `departments/document.vue`、`company/document.vue`（及 `s/[token].vue` 短链） | `PublishedAssetDocument` 已发布资产只读查看页；通知与短链依赖它们 |
| `departments/weekly-reports.vue` | 部门周报与成员日志/周报查看，即“团队汇报”；可选子批 B1b，见 §8 D6 |
| `company/culture`、`knowledge`、`legal`、`notice`、`rules`、`tech-specs`、`templates` | `CompanyAssetBrowser` 的 7 个 OSS 子目录 |
| `company/open-department-docs.vue` | 部门开放文档（全公司可见的开放部门目录） |
| `projects/index.vue` 的项目组文档部分（`doc_type=project`） | 用户 09-28 追加；放在 Host“文档 → 文档协作”下 |

| 排除 / 不迁 | 依据 |
| --- | --- |
| `departments/knowledge.vue` | 只有 TODO，返回空数组，没有真实功能 [核实 `departments/knowledge.vue:8-11`]；与范围文档一致，不迁、不计入验收 |
| `company/index.vue` | 重定向到 `/company/publish`，但 `pages/company/` 下没有这个页面，是死链 [核实 `company/index.vue:3`，目录列表]；Host 不注册 |
| `projects/repos.vue` 与 `projects/index.vue` 中的 `git-project` 视图、`/api/project-docs/**`（GitLab 同步、冲突、diff） | 用户决定：代码仓库生成文档不迁移 |
| `company-assets/export-docx.post.ts` | 前端没有调用方 [核实 grep `export-docx` 只命中 `department/AssetBrowser.vue:274`]；不迁 |
| 演示文稿 | INT-606e 后置不变 |

## 2. 生产使用（只读计数，2026-09-28）

`hzy_codocs.documents`（status：1 有效，0 回收站，2 已发布只读）：

| doc_type | 有效 | 回收站 | 已发布(2) | 涉及部门 / 项目 | 近 30 天更新 | 近 90 天更新 | 近 90 天新建 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| department | 193 | 35 | 3 | 6 个部门 | 17 | 91 | 58 |
| private（对照） | 403 | 87 | 0 | — | 2 | 20 | 10 |
| project | 10 | 3 | 0 | 5 个 project_code | 0 | 1 | 0 |
| git-project（不迁） | 94 | 0 | 0 | 7 个项目 | 0 | 0 | 0 |
| company | 0 | 0 | 13 | — | 3 | 3 | 3 |
| knowledge | 0 | 0 | 32 | — | 0 | 0 | 0 |

- 部门分布（按文档数，部门编码匿名）：117 / 48 / 37 / 26 / 2 / 1；**4 个部门有实质使用**。部门文档共 20 个不同 owner；OSS 路径位于部门周报目录的有 6 篇。
- 部门目录：`folders.folder_type=department` 45 个、4 个部门，其中 3 个已设为开放目录（`is_open`）；`project` 类型目录为 **0**。
- 部门文件柜：`cabinet_files` 部门行有效 12、回收 1（2 个部门），另有 2 行同时带部门与项目编码；个人柜有效 17；部门柜目录 10 个。最近一次新建为 2026-06-29，**使用低**。
- 部门移交：`department_shares` accepted 4、rejected 1。部门文档上的直接分享 30 条（write 22 / read 8）；`document_relations` 在部门文档上 268 条（`can_edit=1` 215 条，但 Runtime 写 ACL 不读 relation，§5.6）。
- 组织资产：`company_asset_access_records` 162 条、6 个资产、52 个查看人，**全部在近 30 天**（首条 2026-09-10）；快速发布操作 4 次，已发布资产短链 2 条，发文申请 3 条。company 类文档 13 篇位于 `codocs/company/{rules 3, tech-specs 5, culture 1, products 1, outsides 1, 非标准目录 2}`；knowledge 32 篇全部位于 `codocs/company/knowledge/`。
- OSS 目录型资产（公司 7 个子目录、部门三个子目录）只有对象存储、没有 DB 行；本次没有访问 OSS，**数量未知**。
- 项目组文档：10 篇有效、5 个 `project_code`、2 个 owner、全部在根目录（无目录）。按项目注册表归属：Console `directory_projects` 1 个编码 / 3 篇；Aims `aims_projects` 2 个编码 / 4 篇；两边都没有 2 个编码 / 3 篇。两套注册表编码交集为 0（Directory 64、Aims 142）。这 10 篇在 Aims `project_documents.codocs_uuid` 与 `deliverables.document_uuid` 中都没有索引（0）。
- 生产授权基线（`hzy_platform.platform_baseline_permissions`，app=codocs）：`company:view`（tenant）、`departments:view|create|edit`（relation=`member_department`）、`documents:view|edit|delete`（relation=`owned_or_shared`）、`documents:create`（subject=self）、`reviews:view`（participant）、`reviews:submit`、`info:view`。**没有** `departments:export|admin`、`company:publish|export|admin`、`documents:export`、`projects:*`。租户角色里只有 1 个角色带 `documents/departments/company/projects:admin`，codocs 角色权限共 7 行。

优先级结论：部门协同文档是真实高频使用，是必须完成的主链；组织资产的查看与查看记录已在使用；部门文件柜、项目组文档使用低，可以在不削减动作的前提下排在后面。

## 3. 页面 × 动作矩阵

列说明：“独立端授权”是今天独立 Codocs 服务端实际执行的检查；“Host 人员权限”是本合同建议的 manifest `resource:action`；“范围规则”是 Runtime 必须重施的对象范围。R=部门关系，由 Runtime 从 Directory 读取，定义见 §5.2：`member`（成员）、`manager`（部门经理 `managerId`）、`leader`（分管负责人 `leaderId`）、`parent`（上级部门经理或负责人）。Host 路由一栏凡是写“同路径分派”，表示沿用独立端相同路径，Host handler 按**服务端读取到的对象类型**分派到部门专用操作，页面源码不分叉（§6.3）。Runtime 一栏：“现有”指 `/v1/codocs/**` 用户域处理函数已存在，“新”指需新增 `/v1/enterprise/codocs/<resource>:<action>` 委托操作。

### 3.1 部门协同文档 `departments/index.vue`

| 动作 | 页面证据 | 独立端 API | 独立端授权 [核实] | Host 人员权限 | 范围规则 | Runtime |
| --- | --- | --- | --- | --- | --- | --- |
| 选择部门 / 取角色 | `:161,:222` | `GET /api/account/department-members`、`/api/account/user-departments` | legacy account 路径 | — | 只返回本人可见部门和本人角色 | 新 `department-access:resolve`；复用 `console.directory-self-departments` |
| 目录树 | `:420` | `GET /api/folders?folder_type=department&dept_code` | `documents:view` + `requireDepartmentReadAccess`（中间件 `tenant-runtime.ts:199-214`） | `departments:view` | R∈{member,manager,leader,parent} | 现有 `foldersList` 的部门 marker 分支（`folders.go:64-74`）；新 `department-folders:list` |
| 文档列表（未发布/已发布） | `:432` | `GET /api/documents?type=department&dept_code&published_mode&exclude_weekly_reports` | 同上（`tenant-runtime.ts:181-197`） | `departments:view` | 同上；`published_mode` 只收窄结果 | 现有列表部门分支（`folders.go:34-58`、`document_queries.go:46,144`）；新 `department-documents:list`，**真实分页** |
| 预览 / 详情 / 进入编辑器 | `:589,:1241-1258` | `GET /api/documents/:uuid?dept_code`（编辑器带 `dept_code`，`documents/[uuid].vue:263,841`） | `requireDepartmentReadAccess` 后注入 `trusted_department_read_dept_code`（`documents/[uuid]/index.get.ts:25-44`） | `departments:view` | 对象 `doc_type=department` 且 `dept_code` 等于 R 成立的部门；owner/share/relation 仍可读 | 现有 `documentAccess` 部门分支（`document_read_authorization.go:40,60-69`）；新 `department-documents:view`（Host 正文读取复用 `withEnterpriseCodocsDocumentContent`） |
| 发布记录 | `:602` | `GET /api/reviews/by-document/:uuid` | `reviews:view` | `reviews:view` | 文档可读 | **复用** `codocs.review-history-by-document` |
| 新建文档 | `:694` | `POST /api/documents {doc_type:department}` | `requireDepartmentWriteAccess`（member/manager；`documents/index.post.ts:18-26`） | `departments:create` | R∈{member,manager}；owner=签名 actor | 现有 `createDocument`；新 `department-documents:create`（带幂等回执，同 personal create 模式） |
| 新建目录 | `:741` | `POST /api/folders {folder_type:department}` | `documents:create` + 经理（`folders/index.post.ts:23,59`） | `departments:edit` | R=manager | 现有 `createFolder` 经理 marker（`folders.go:182-188`）；新 `department-folders:create` |
| 重命名目录 / 删除目录 | `:638,:865` | `PATCH|DELETE /api/folders/:id` | 经理（`folders/[id].patch.ts:37-38`、`[id].delete.ts:31-32`） | `departments:edit` | R=manager；删除非空目录 409 | 现有目录 PATCH/DELETE 部门 manage marker；新 `department-folders:update|delete` |
| 上传 Markdown | `:813` | `POST /api/documents/upload` | member/manager（`documents/upload.post.ts:44`） | `departments:create` | R∈{member,manager} | 新 `department-documents:upload`（复用 personal upload 的逐项 create 编排） |
| 重命名 / 移动文档 | `:646,:1011` | `PATCH /api/documents/:uuid {title|folder_id}` | 独立端 BFF 无部门检查，Runtime 写 ACL = owner/share-write | `departments:edit` | **合同**：owner/share-write，或 R=manager（§5.7）；目标目录必须同一部门 | 现有 `updateDocument` 只有 owner/share-write；新 `department-documents:edit-metadata`（经理分支在 Runtime） |
| 收藏 | `:902` | `PATCH {star_flag}` | 同上 | — | **缺陷**：`star_flag` 是文档级列，不是按人收藏（`document_lifecycle.go:240`）；见 §8 D5 | 暂不迁或只对 owner 开放 |
| 设为 / 取消只读 | `:922` | `PATCH {readonly_flag}` | 经理（`documents/[uuid]/index.patch.ts:71-73`） | `departments:edit` | R=manager | 新 `department-documents:readonly` |
| 开放 / 关闭目录 | `:953` | `PATCH /api/folders/:id/open` | 经理，注入 manage marker（`folders/[id]/open.patch.ts:34,43`） | `departments:edit` | R=manager；目录的 `dept_code` 必须一致 | 现有 `updateFolderOpen`（`folders.go:275-322`）；新 `department-folders:open` |
| 删除文档 | `:869` | `DELETE /api/documents/:uuid` | `documents:delete` + 经理（`documents/[uuid]/index.delete.ts:24-29`） | `departments:edit` | R=manager（owner 自删见 §8 D4） | Runtime 写 ACL 无经理分支；新 `department-documents:recycle` |
| 回收站列表 / 恢复 | `:387-399`、`RestoreDocumentModal` | `GET /api/documents/trash?type=department`、`POST /:uuid/restore` | 恢复需经理（`restore.post.ts:60-61`） | 列表 `departments:view`；恢复 `departments:edit` | 列表 R 可读；恢复 R=manager、原目录仍属该部门 | 新 `department-documents:trash|restore-plan|restore` |
| 复制 | `CopyDocumentModal` | `POST /api/documents/:uuid/copy` | 部门写（`copy.post.ts:58`） | `departments:create` | 源文档可读，目标部门 R∈{member,manager} | 新 `department-documents:copy`（可选，§8 D8） |
| 共享 / 调权 / 撤销 | `ShareDocumentModal` | `/api/documents/:uuid/shares[/:id]` | `documents:edit` + Runtime 分享 ACL | `documents:edit` | 维持 Runtime 现有分享 ACL（owner/share-write） | **复用** `codocs.document-share-*` |
| 发布（提交发文申请） | `:1191`、`SubmitReviewModal.vue:434-439` | `POST /api/reviews/publish-requests` + `/:id/workflow-instance` | `reviews:submit` | `reviews:submit` | 文档可写 | Host **无**；Workflow 发起链待迁（B1c，§8 D7），未完成前隐藏入口 |
| 待接收移交 列表 / 接收 / 拒绝 | `PendingDeptShares.vue:32,48` | `GET /api/dept-shares`、`PATCH /api/dept-shares/:id` | 经理（`dept-shares/index.get.ts:37`、`[id].patch.ts:83`） | `departments:edit` | R=manager；接收语义见 §5.6 | 现有 `departmentSharesList/updateDepartmentShare`；新 `department-shares:list|decide` |
| 下载 Markdown | `useDocumentDownload` | `GET /api/documents/:uuid/download` | `documents:export` | `departments:export` | R 可读 | 新 `department-documents:download` |

### 3.2 部门文件柜 `departments/cabinet.vue`

| 动作 | 页面证据 | 独立端 API | 独立端授权 [核实] | Host 人员权限 | 范围 | Runtime |
| --- | --- | --- | --- | --- | --- | --- |
| 目录列表 | `:285` | `GET /api/dept-cabinet/folders` | `documents:view` + 部门读（`folders.get.ts:17,26`） | `departments:view` | R 可读 | 现有 `dept-cabinet/folders`；新 `department-cabinet:folders` |
| 文件列表 | `:568` | `GET /api/dept-cabinet?dept_code` | `documents:view` + 部门读（`cabinetRuntime.ts:41-49`） | `departments:view` | R 可读；真实分页 | 现有 `dept-cabinet` 列表；新 `department-cabinet:list` |
| 预览 / 转存信息 | `:673,:687,:725` | `GET /:uuid/preview[-html|-pptx]`、`converted-info` | 同上 | `departments:view` | 同上；转存目标文档另走文档 ACL | 新 `department-cabinet:view|converted-info`（复用个人柜 Host 的 OSS、Office 沙箱与 PPTX 实现） |
| 下载 | `:854` | `GET /:uuid/download?dept_code` | `departments:export`（`[id]/download.get.ts:6`） | `departments:export` | R 可读 | 新 `department-cabinet:download` |
| 上传 | `:817` | `POST /api/dept-cabinet/upload` | 经理（`upload.post.ts:39`） | `departments:edit` | R=manager | 新 `department-cabinet:upload-plan|upload`（复用个人柜 plan→条件 PUT→commit） |
| 重命名 / 移动文件 | `:416,:478` | `PATCH /api/dept-cabinet/:uuid` | 经理（`[id].patch.ts:22`） | `departments:edit` | R=manager；目标目录同一部门 | 新 `department-cabinet:update` |
| 删除文件 | `:873` | `DELETE /api/dept-cabinet/:uuid` | 经理（`[id].delete.ts:16`） | `departments:edit` | R=manager；软删除，不删 OSS | 新 `department-cabinet:delete` |
| 目录 建 / 改 / 删 | `:339,:372,:450` | `/api/dept-cabinet/folders[/:id]` | 经理（`folders.post.ts:29`） | `departments:edit` | R=manager | 新 `department-cabinet:folder-create|folder-update|folder-delete` |
| 转为部门文档 | `:937` | `POST /:uuid/to-document` | 经理（`to-document.post.ts:27`） | `departments:edit` + `departments:create` | R=manager；目标为本部门目录 | 新 `department-cabinet:conversion-plan|convert`（复用个人柜转换编排） |
| 发布 PDF 到组织资产 | `:531` | `POST /api/dept-cabinet/publish` | 只查 `company:publish`；用进程全局 `createOSSClient()` 复制，没有记录（`publish.post.ts:18,40-44`） | `company:publish`（是否再要求 `admin:admin` 见 §8 D3） | 源文件 R 可读；目标分类白名单 | Host OSS 复制（请求级配置、不覆盖）+ 新 `department-cabinet:publish-record` 写发布记录 |

### 3.3 部门资产浏览 `records|outsides|rules` 与已发布文档页

| 动作 | 证据 | 独立端 API | 独立端授权 [核实] | Host 人员权限 | 范围 | 实现 |
| --- | --- | --- | --- | --- | --- | --- |
| 目录/文件列表 | `department/AssetBrowser.vue:163` | `GET /api/dept-assets/list?deptCode&subdir&path` | 只查 `departments:view`，**不查部门关系**（`list.get.ts:43-51`） | `departments:view` | **合同新增**：R 可读，或按 §8 D2 决定对全员可见 | Host OSS 列举（请求级 OSS）；部门关系走新 `department-access:resolve` |
| 预览 | `:231` | `GET /api/dept-assets/preview?path` | 同上，只校验路径前缀（`preview.get.ts:9-13`） | `departments:view` | 从路径解析 `dept_code` 后按 R 判定 | Host OSS 读取 |
| 导出 docx（仅对外发文） | `:274` | `POST /api/dept-assets/export-docx` | `departments:export` + 发布记录（`export-docx.post.ts:31-37`） | `departments:export` | 同上 | Host 转换 + **复用** `codocs.review-history-by-oss-path` |
| 发布记录 | `:193` | `GET /api/reviews/by-oss-path` | `reviews:view` | `reviews:view` | — | **复用** |
| 归档 | `:330` | `POST /api/dept-assets/archive` | `departments:admin`（`archive.post.ts:9`） | `departments:admin` | 管理员；不看部门关系 | Host OSS copy + delete |
| 复制短链 | `AssetLinkButton.vue:21` | `POST /api/published-asset-links` | 只要求登录 | `departments:view` | 路径可读才生成 | 现有 `createPublishedAssetLink`；新 `published-asset-links:create` |
| 已发布文档页 / 短链解析 | `published/AssetDocument.vue:33,38`、`s/[token].vue` | `GET /api/published-asset-links/:token` → 部门或公司预览 | 登录；解析本身不授权 | 解析：登录；预览：按 scope 用 `departments:view` 或 `company:view` | 预览重新判权 | 现有 `resolvePublishedAssetLink`；新 `published-asset-links:resolve` |

### 3.4 组织资产 `company/*`（7 个子目录）、知识库、模板

| 动作 | 证据 | 独立端 API | 独立端授权 [核实] | Host 人员权限 | 实现 |
| --- | --- | --- | --- | --- | --- |
| 列表 | `company/AssetBrowser.vue:46` | `GET /api/company-assets/list?subdir&path` | `company:view`（`list.get.ts:43`） | `company:view` | Host OSS 列举；**真实分页**（现为逐页 500 全量拉取） |
| 预览（含 PDF 画布、水印） | `:89` | `GET /api/company-assets/preview` | `company:view` + 查看记录，记录失败返回 503（`preview.get.ts:15,42,61`） | `company:view` | Host OSS 读取 + 新 `company-assets:record-access`（包装 `writeCompanyAssetAccess`，`company_asset_access.go:81`）；有 UUID 的 company 文档**复用** `codocs.document-access-record` |
| 新建目录 / 删除目录 / 移动 / 归档 | `:116,:153,:174,:200` | `mkdir|directory|move|archive` | `company:admin`（`mkdir.post.ts:9` 等） | `company:admin` | Host OSS；删除用 `useConfirm tone=danger` |
| 查看记录 / 导出 CSV | `AssetAccessRecords.vue:36,84` | `access-records[/export]` | `admin:admin` + `company:admin`，导出另需 `company:export`（`companyAssetAccessRecords.ts:61-63`） | 同左 | 新 `company-assets:access-records|access-records-export`（包装 `listCompanyAssetAccessRecords`） |
| 发布记录 | `:512` | `GET /api/reviews/by-oss-path` | 公司路径另需 `admin:admin`（`by-oss-path.get.ts:21`） | 同左 | **复用** `codocs.review-history-company-by-oss-path` |
| 复制短链 | `:327` | `POST /api/published-asset-links` | 登录 | `company:view` | 新 `published-asset-links:create` |
| 知识库导入（快速发布） | `ImportKnowledgeModal.vue:71,140` | `import-source`、`import-documents` | `admin:admin` + `company:publish`（`import-documents.post.ts:10-11`） | 同左 | 新 `company-assets:quick-publish-source|quick-publish-prepare|quick-publish-complete`（包装 `quickPublishPrepare/Complete`，`company_asset_quick_publish.go:80,166`） |
| 模板“使用” | `company/templates.vue:6` | 同浏览器 | 同上 | `company:view` | 独立端**没有**“用模板新建文档”动作 [核实 grep]；模板 = 浏览与预览。组件声明了 `hideExport`，但没有任何导出按钮 |

### 3.5 部门开放文档 `company/open-department-docs.vue`

| 动作 | 证据 | 独立端 API | 独立端授权 [核实] | Host 人员权限 | 范围 | Runtime |
| --- | --- | --- | --- | --- | --- | --- |
| 列表 | `:64` | `GET /api/open-department-docs` | **只要求登录**（`open-department-docs/index.get.ts:9`） | `company:view`（基线 tenant） | 显式开放的部门目录及其后代、未发布、非周报文档（MODULE_CONTRACTS 部门开放文档合同） | 现有 `openDepartmentDocuments`（`open_department_documents.go:16`）；新 `open-department-documents:list` |
| 详情 | `:152` | `GET /api/open-department-docs/:uuid` | 登录 + 开放集合内（`openDepartmentDocs.ts:145-161`） | `company:view` | UUID 只收窄，不扩大 | 新 `open-department-documents:view` |

### 3.6 团队汇报 `departments/weekly-reports.vue`（可选子批 B1b）

| 动作 | 证据 | 独立端 API | 独立端授权 [核实] | 合同建议 |
| --- | --- | --- | --- | --- |
| 部门周报列表 | `:512` | `GET /api/weekly-reports/list?dept_code&year&viewer` | **身份取自 query `viewer`**（`weekly-reports/list.get.ts:30`），无部门读检查；Runtime 调用不带受信部门 marker | Host 从签名 actor 取身份；`departments:view` + R 可读；经理和负责人看草稿，其他人只看已提交 |
| 新建 / 提交 / 修订部门周报 | `:783,:813,:829` | `weekly-reports/create|submit|revise` | submit/revise 只查 `managerId/leaderId`（`submit.post.ts:53`、`revise.post.ts:46`）；create 无关系检查 | `departments:create|edit` + R=manager（新建是否允许 member 见 §8 D6） |
| 催报 | `:757` | `weekly-reports/remind` | 经理、负责人或上级（`remind.post.ts:51-64`） | `departments:edit` + R∈{manager,leader,parent}；通知走 Foundation |
| 查看成员个人周报 / 日志 | `:577,:614,:632,:956,:1001` | `personal-weekly-reports/list?owner=成员`、`worklogs/list?owner=` | `owner` 只是筛选条件；Runtime 可见性仍是 owner/share/relation，经理默认看不到成员个人文档 [推断，依据 `folders.go:34-58`] | **新授权**：“主管看成员已提交汇报”需要用户确认（INT-606d 已写“主管身份不自动获得全部个人文档”） |
| 钉钉同步 | `:1078` | `POST /api/dingtalk/sync-reports` | 不在本批 | 不迁，入口隐藏 |

### 3.7 项目组文档 `projects/index.vue`（`doc_type=project`，B3）

| 动作 | 证据 | 独立端 API | 独立端授权 [核实] | Host 人员权限 | 范围 | Runtime |
| --- | --- | --- | --- | --- | --- | --- |
| 项目组列表 | `:224-231` | `accountStore.fetchProjects({only_group})` | 前端取 legacy/Console 项目组 | `projects:view` | 本人参与或管理的 Console Directory 项目 | **复用** `console.directory-self-projects`（Runtime `ConsoleUserProjects`，已用于 Host 项目移交，`enterpriseCodocsDocumentTransfer.ts:112-114`） |
| 项目文档树 | `:247-250,:290-306` | `GET /api/folders/list/:code`、`/api/documents/project/:code`、`/api/folders?folder_type=project`、`/api/documents?type=project` | BFF 无项目检查；Runtime 不认 `project_code`，目录谓词没有 project 分支（`folders.go:30-33,64-74`） | `projects:view` | **合同**：项目成员可读（授权扩大，§8 D9）；否则维持 owner/share/relation | 新 `project-documents:list`（生产 0 个项目目录，首版不做目录，§8 D10） |
| 预览 / 编辑器 | `:414,:870-878` | `GET /api/documents/:uuid` | owner/share/relation | `projects:view` | 同上 | 新 `project-documents:view`；编辑器 PUT **复用**现有 update-plan/update（owner/share-write） |
| 新建 / 上传 | `:547,:654` | `POST /api/documents {doc_type:project}`、`upload` | 无项目成员检查 | `projects:create` | 项目 member/leader；owner=actor | 新 `project-documents:create|upload` |
| 重命名 / 只读 / 删除 | `:453,:704,:739,:758` | `PATCH|DELETE /api/documents/:uuid` | Runtime owner/share-write | `projects:edit` | owner/share-write，或项目 leader（§5.9） | 新 `project-documents:edit-metadata|recycle|restore` |
| 共享 | 同文档工作区 | shares | 同 §3.1 | `documents:edit` | Runtime 分享 ACL | **复用** |
| git-project 视图、`project-docs/**` | `projects/repos.vue`、`server/api/project-docs/**` | GitLab 同步、diff、冲突 | — | — | — | **不迁**（Host 列表与详情拒绝 `doc_type=git-project`） |

## 4. 已有能力与缺口

### 4.1 可直接复用（mydocs 批次已接线，代码候选、环境未启用）

- Foundation 操作表 `foundation/server/utils/enterpriseRuntimeClient.ts:15-70`：`document-share-*`、`document-annotations-*`、`review-history-by-document|by-oss-path|company-by-oss-path`、`publish-execution-seal|send|receive`、`collab-document-list[-admin]`、`document-access-record`、`document-transfer-department|project`、`personal-document-update(-plan)`、`personal-document-versions-*`、`console.directory-self-departments|projects`。
- 服务能力已按域收敛：Host 用户委托统一使用 `codocs:enterprise-host:execute`，由路由域推导（`foundation/server/utils/enterpriseRuntimeClient.ts:350`、`data-runtime/internal/server/enterprise_context.go:26`；根 CLAUDE.md 例外条款）。**新增操作不需要新增服务 capability 或 grant**，只加操作表白名单、Runtime 路由和 permit resource/action。
- Host 模式件：个人柜 OSS 读取、Office 沙箱与 PPTX 预览（`enterpriseCodocsCabinetReads.ts`），上传 plan→条件 PUT→commit（`enterpriseCodocsCabinetUpload.ts`），转换（`enterpriseCodocsCabinetConvert.ts`），回收/恢复两段式（`enterpriseCodocsDocumentRecycle.ts`、`enterpriseCodocsDocumentRestore.ts`），正文读取（`enterpriseCodocsDocumentContent.ts`），通知（`enterpriseCodocsNotification.ts`），请求级 OSS client（`createRuntimeOSSClient({event})`）。
- Runtime 用户域处理函数已具备部门 marker 语义：列表/目录读取（`folders.go:34-74`）、目录创建与开放（`folders.go:163-188,275-322`）、详情读取（`document_read_authorization.go:40,60-69`）、部门柜（`adapter.go:338-400`）、部门移交（`adapter.go:402-412`）、开放文档、查看记录、快速发布、短链。
- Runtime Directory 读取：`s.directory.EnterpriseSelfDepartments|ConsoleAccessibleDepartments|ConsoleUserProjects`（`enterprise_directory_self.go:44-56`），可在 Runtime 内派生部门和项目关系，不需要 Host 提供关系事实。

### 4.2 缺口

| 缺口 | 影响 | 位置 |
| --- | --- | --- |
| G1 Host 没有任何部门、组织资产或项目组页面与路由 | 全部 | `codocs/layer/entry.mjs:18-41` 只注册 mydocs 与编辑器 |
| G2 现有 personal 操作拒绝部门类型：list/trash 只接受 private/slide/worklog/weekly-report（`enterprise_codocs_reads.go:99-105`），recycle/restore 同样（`personal_document_recycle.go:57-58`、`personal_document_restore.go:42-43`），view 的 query 白名单不含 `dept_code`（`enterprise_codocs_reads.go:25`） | Host 编辑器打开部门文档时，非 owner 成员会 403 或 400 [推断] | 需要新的 `department-*` 委托规格 |
| G3 Runtime 写 ACL 没有部门经理分支（`document_lifecycle.go:389-411`；详情 `canWrite` 同样，`document_read_authorization.go:48`） | 经理删除、恢复、设只读他人部门文档，今天在 Runtime 层会被拒 | 新部门操作在 Runtime 事务内判定经理关系 |
| G4 部门关系由 Codocs BFF 调 Directory 判定（`departmentAccess.ts:38-85`），Host 没有等价物 | 全部部门动作 | 新 Runtime 内部 helper，从 `s.directory` 读取（§5.2） |
| G5 组织资产与部门资产是 Nitro 直连 OSS，没有 Runtime 合同 | 列表、预览、目录管理 | Host BFF 直接做请求级 OSS；关系判定与记录走 Runtime |
| G6 发文申请（`publish-requests` + Workflow instance）在 Host 缺失 | 部门“发布”按钮 | B1c；未完成前隐藏入口 |
| G7 Host 导航没有“团队管理”分组（`enterprise/composition/business-areas.mjs:6-11`）、没有“组织资产”分组（`:51-55`） | 菜单归位 | §6、§8 D11 |
| G8 Host 部门移交通知已经指向 `/codocs/departments`（`enterpriseCodocsDocumentTransfer.ts:107`），但该页未注册 | 通知点击后 404 | B1 注册后自然消除 |
| G9 页面依赖 legacy `/api/account/department-members|user-departments`（`departments/index.vue:161,222`、`cabinet.vue:156,214`、`department/AssetBrowser.vue:106`、`weekly-reports.vue:239,286`） | 范围边界要求迁入时改走 Console/Foundation | 新 Host `GET /codocs/api/departments/mine|access` |

## 5. 授权合同（请 Claude 审阅）

### 5.1 通用原则（沿用 mydocs 批次）

1. 身份只取 Host 会话 `requireEnterpriseUser`；body/query 中的 `owner`、`viewer`、`actor*`、`dept_code` 角色、`trusted_*` marker 一律拒绝或只作筛选，不作授权依据（对照独立端 `weekly-reports/list.get.ts:30` 的缺陷）。
2. Host 每次动作用 Foundation `loadAuthorizationSnapshotFromConsoleRuntime` + `authorizationResourcesAllow` 判断人员权限，依赖失败返回 503，缺权返回 403；然后 `prepareEnterpriseRuntime` → 签发 ≤15 s permit（actor、tenant、deployment、resource、action），调用固定 `/v1/enterprise/codocs/<resource>:<action>`；写操作在存储之后**重新取权再提交**（与个人柜上传、转换一致）。
3. Runtime 验证 Enterprise 凭据、签名 actor 与 permit，按动作白名单重建 query/payload；**部门、项目关系由 Runtime 自己从 Directory 读取**，Host 不传关系事实，permit 不携带角色。
4. 列表、详情、写、批量、导出分别判权：列表 = 人员权限 + SQL 范围谓词；详情 = 对象级重验；写 = 在 **Directory 自有库事务**以共享行锁计算当前 R，保持该只读事务打开，再开启 **Codocs 自有库 Serializable 写事务**，在回执读取前核对受锁保护的 actor/部门/R，Codocs 提交后才释放 Directory 锁；提交前失败则 Codocs 回滚、Directory 事务释放锁。不能在 Codocs 事务中查询 `directory_*`（两库物理分离）。批量上传 = 逐项取权和 permit；导出/下载 = 独立 `export` 动作。
5. 写操作必须带 `Idempotency-Key`，Runtime 用既有 `service_command_receipt` 同事务回执；同键异意图返回 409；已删除对象不复活。
6. 错误语义：401 未登录；403 缺权或关系不符；404 对象不存在；409 状态冲突；503 依赖故障（Directory、Console、OSS），不把依赖故障伪装成无权。

### 5.2 部门关系与人员权限映射

**关系 R**（Runtime 从 Directory 计算，沿用独立端语义 `departmentAccess.ts:57-84`，按下列顺序取第一个命中）：

| R | 条件 | 读 | 写（新建/上传） | 管理（目录、删除、恢复、只读、开放、柜写、移交接收） |
| --- | --- | --- | --- | --- |
| leader | actor = 该部门 `leaderId` | 是 | 否 | 否 |
| manager | actor = 该部门 `managerId` | 是 | 是 | 是 |
| member | actor 在该部门成员中 | 是 | 是 | 否 |
| parent | actor = 直接上级部门的 manager 或 leader | 是 | 否 | 否 |
| none | 其他 | 否 | 否 | 否 |

- 待审：独立端 `leader` 优先于 `manager`，同时是 leader 和 manager 的人只读；`parent` 只看**直接**上级，不是整条祖先链。本合同建议原样保留（不扩大、不收窄），列为 §8 D1 请用户确认。
- **人员权限用 `codocs:departments:*`，不用 `documents:*`。** 生产基线 `departments:view|create|edit` 的范围是 `relation=member_department`，`documents:*` 的范围是 `owned_or_shared`（§2）。用 `documents:view` 放行部门成员读取，就是把一个授权单元的权限和另一个单元的范围拼接起来，违反根 CLAUDE.md“授权判断必须保留同一授权上下文”。独立端这样做（`tenant-runtime.ts:183,201`）是存量缺陷，不移植。
- 映射：读、列表、详情 → `departments:view`；新建、上传、复制 → `departments:create`；管理类 → `departments:edit` + R=manager；下载、导出 → `departments:export`；部门资产归档 → `departments:admin`。manifest 的 `departments` 没有 `delete` 动作，删除按 `edit` + R=manager 处理（§5.11 M1）。
- 范围求值：Host 用 Foundation 统一 scoped helper 对 `departments:<action>` 求值，对象上下文为 `{deptCode}`；`relation:member_department` 的事实由 Runtime 按上表判定。Host 结果只是快速拒绝，**Runtime 的关系判定是最终门槛**。scoped grant（如 `department:tree`）能否在没有 R 的情况下放行读取（例如档案管理员），见 §8 D1；默认不放行。
- UI 的“可写 / 可管理”提示来自新 `GET /codocs/api/departments/access?dept_code`（Runtime `department-access:resolve`，只返回 `role/canRead/canWrite/canManage`，不返回成员名单和经理身份），不作为安全边界。

### 5.3 各类操作的服务端检查（部门）

| 类 | Host | Runtime |
| --- | --- | --- |
| 列表（目录、文档、回收站、柜、移交） | 人员权限 + `dept_code` 格式；分页参数白名单（默认 20、最大 200） | 按 R 计算后，用现有部门 marker 谓词查询；R=none 返回 403，不返回空列表 |
| 详情、预览 | 同上 | 锁定对象的 `doc_type=department` 与 `dept_code`，按对象自己的部门判 R，**不信任请求中的 `dept_code`**；owner/share/relation 仍可读 |
| 新建、上传 | 人员权限；上传逐项重新取权 | R∈{member,manager}；owner=actor；目标目录须为同部门 `department` 目录 |
| 管理写 | 人员权限；存储前后各取权一次 | 事务内锁对象与目录，重算 R=manager；目录移动检查同部门与防环 |
| 批量（上传） | 每项独立 permit 与幂等键 | 每项独立回执 |
| 下载、导出 | `departments:export`（基线不含，普通成员今天也不能下载部门柜，§8 D2） | 对象级 R 可读 |

### 5.4 组织资产

- 读（列表、预览、短链解析后预览）：`company:view`（基线 tenant，全员）。预览必须先成功写查看记录才返回内容，记录失败返回 503（保持现有语义）。
- 管理（新建目录、删除目录、移动、归档）：`company:admin`。
- 发布进组织资产：知识库快速发布保持 `admin:admin` + `company:publish`；部门柜“发布 PDF”今天只要求 `company:publish`，建议统一为同一门槛并补发布记录（§8 D3）。
- 查看记录：`admin:admin` + `company:admin`；导出另需 `company:export`（保持）。
- `company:create|edit` 在独立端没有使用，本批不赋予新语义。

### 5.5 部门开放文档

- 读取：`company:view` + Runtime 开放集合谓词（显式开放目录及其后代、未发布、非周报）。这比独立端“只要登录”多一道人员权限检查，由于 `company:view` 是全员基线，不影响现有用户。
- 开放/关闭目录：`departments:edit` + R=manager（§3.1）。

### 5.6 分享、跨部门访问与移交

- 直接分享：复用现有 `document-share-*`，Runtime 分享 ACL 不变。部门身份本身**不**授予分享他人部门文档的权力（经理是否可以分享本部门他人文档，§8 D4）。
- 跨部门：只通过显式分享、开放目录或移交获得访问；`parent` 只读直接下级部门。不因“同属上级部门树”自动可读。
- 移交：个人→部门由 Host 现有 `document-transfer:department` 发起（源 owner + `documents:edit`，目标须是本人关联的部门，`enterpriseCodocsDocumentTransfer.ts:97-101`）。接收语义按 §8 D12 已定为转成部门文档：同一 Serializable SQL 事务内复核经理与源文档，把 `doc_type` 改为 `department`、`dept_code` 取移交记录的目标部门、`folder_id` 设为部门根目录，owner 保留原作者，并提交关系/审计/幂等回执；拒绝只记录移交状态。有效源文档沿用原 OSS key，不做对象复制或覆盖；Runtime 没有按个人目录清理文件的路径。接收后原个人文档列表不再返回该文档。旧独立端只改 `department_shares.status` 的路径保持原合同，不视为 Host 接收结果。
- relation `can_edit` 不参与 Runtime 写 ACL（`document_lifecycle.go:389-411` 只读 `document_shares`）；本批不改变这一点。

### 5.7 移动与恢复的归属规则

- 部门文档只能在**同一部门**的 `department` 目录之间移动；不能通过 PATCH 改 `doc_type`、`dept_code`、`project_code`、`owner`（Host 与 Runtime 双层白名单，沿用 personal edit-metadata）。
- 移动他人部门文档：R=manager；owner 移动自己的文档：owner 且 R∈{member,manager}（离开部门的原 owner 不能再移动，§8 D4）。
- 恢复：恢复到原目录；原目录已删除时恢复到部门根目录；原目录属于其他部门时拒绝。沿用 personal restore 的两段式（plan 绑定状态摘要 → 条件复制回收对象 → 重新取权 → Serializable 事务 + 回执），`restore-plan` 按对象的 `dept_code` 判 R=manager。
- 部门柜转文档：目标目录必须是同部门目录；转存关联与个人柜相同，不覆盖后续编辑。

### 5.8 知识库与模板

- 公司知识库 = 组织资产 `knowledge` 子目录（OSS）+ 32 篇 `doc_type=knowledge` 已发布只读文档，读取权限 `company:view`；导入 = 快速发布（§5.4）。
- 部门知识库不迁（TODO）。
- 模板 = 组织资产 `templates` 子目录，只有浏览和预览，不存在“用模板新建”。Host 放在“模板与复用”分组；不新增 `templates` 资源。

### 5.9 项目组文档

- 项目范围与成员事实来源：**Console Directory 项目组**（`directory_projects`、`directory_project_members`），因为独立端的“项目组文档”页列的正是 Directory 项目组（`projects/index.vue:224-231`），Host 项目移交也用它（`console.directory-self-projects`）。Runtime 用已有 `s.directory.ConsoleUserProjects(actor)` 取 managed/joined，**不另建成员表**。项目负责人 = Directory 项目的 `leader_uid`/`owner_uid`，即 `managed` 集合。
- Aims 项目的成员关系（`aims_project_members`，Host Aims 项目文档读取在用）属于另一套注册表，两套编码交集为 0。4 篇挂在 Aims 编码上的文档如何处理：建议**不按 Aims 成员放开**，只保留 owner/share/relation 访问，在“项目组文档”列表中归入“其他”并只对有 ACL 的人可见；如用户希望 Aims 项目成员也能看到，改用 Aims Runtime 成员事实（与 `aims.project-document-accessible-list` 同源），列为 §8 D9b。
- 编码在两套注册表中都找不到的 3 篇：只保留 owner/share/relation。
- 人员权限：manifest `codocs:projects:{view,create,edit,export}`（资源描述即“项目组文档”）。**生产基线没有 `projects:*`**，普通用户今天没有这个权限 → 需要用户决定是否在 Platform 基线加 `codocs:projects:view|create|edit` 范围 `relation=project_member`（与部门的 `member_department` 对称），见 §8 D9。不得改用 `documents:view` 充当项目成员读取权（原因同 §5.2）。
- 可见性：若 D9 批准，同一 Directory 项目（含子项目，按 D10 决定是否向下继承）的成员可读、可新建；owner/share-write 可编辑正文；项目负责人可管理（重命名、只读、删除、恢复）。若不批准：页面只列出本人 owner/share/relation 可见的项目文档，与今天 Runtime 的实际行为一致。

### 5.10 签名 actor 与 permit 模式

- 复用 `enterpriseDelegatedSpec`（`data-runtime/internal/server/enterprise_codocs_reads.go:19-29` 的写法）：每个新 resource 一个 spec，动作显式列 Method、PermitAction、QueryKeys/AllowPayload、CodePattern、Target。
- Runtime 在 `routeEnterpriseCodocsOperation` 通过认证与 permit 校验后，设置 `hzy_runtime_actor_delegated=1`；**部门、项目 marker 只能由 Runtime 在按 Directory 算出 R 之后自行设置**，不能从 Host 输入透传（今天的 marker 由 Codocs BFF 设置；Host 路径必须收回到 Runtime）。
- permit resource 命名（Runtime API 合同资源，不写入 manifest 人员资源）：`department-access`、`department-documents`、`department-folders`、`department-shares`、`department-cabinet`、`department-assets`、`company-assets`、`open-department-documents`、`published-asset-links`、`project-documents`、以及 B1b 的 `department-reports`。
- 写操作沿用 `PersonalFolderCreationIdentity{Tenant, Deployment(codocs), Actor, Client, RequestID, Key}` 与 `service_command_receipt`；回执命名空间含 resource，避免与 personal 回执串用。

### 5.11 Manifest 缺口与标记（未添加，只列出）

| 编号 | 缺口 | 建议 |
| --- | --- | --- |
| M1 | `departments` 没有 `delete` 动作 | 删除走 `edit` + R=manager；若要独立删除权，需要改 manifest 并补契约测试 |
| M2 | 基线没有 `codocs:projects:*` | §8 D9：是否加 Platform 基线 `relation=project_member` |
| M3 | 基线没有 `departments:export`、`documents:export` | 普通成员不能下载部门文档或部门柜文件是现状；是否纳入基线见 §8 D2 |
| M4 | manifest `supportedScopes` 有 `department:tree`、`project:member`，但没有 `relation:member_department`、`relation:project_member` 的正式声明；基线直接使用 relation 谓词 | 与 Platform 核对 relation 谓词登记方式；不影响 Runtime 最终判定 |
| M5 | 新 permit resource 属于 Runtime API 合同 | 按能力收敛方案，不写入 manifest、不新增 grant |

### 5.12 发现的独立端缺陷（不移植到 Host；是否修独立端另议）

1. `dept-assets/list|preview` 不校验部门关系（§3.3）。
2. `weekly-reports/list` 以 query `viewer` 充当身份（§3.6）。
3. `open-department-docs` 服务端不检查人员权限（§3.5）。
4. `dept-cabinet/publish` 只查 `company:publish`，用进程全局 OSS client，没有发布记录（§3.2）。
5. 部门经理规则只在 BFF 执行，Runtime 写 ACL 没有经理分支，两层不一致（G3）。
6. `star_flag` 是文档级列，部门“收藏”会影响所有人（§3.1）。

## 6. 信息架构、菜单与路由

### 6.1 菜单（`codocs/layer/entry.mjs` navigation；分组来自 `enterprise/composition/business-areas.mjs:50-56`）

| 入口 | 区域 → 分组 | 路由 | 导航权限 | 备注 |
| --- | --- | --- | --- | --- |
| 部门文档 | 文档 → 文档空间 | `/codocs/departments` | `departments:view` | 页内切换部门、已发布、回收站 |
| 部门文件柜 | 文档 → 文档空间 | `/codocs/departments/cabinet` | `departments:view` | |
| 部门资产（会议记录/对外发文/部门规章） | 文档 → 文档空间 | `/codocs/departments/records|outsides|rules` | `departments:view` | 三个入口，或一个入口加页内页签（§8 D11） |
| **项目组文档** | **文档 → 文档协作** | `/codocs/projects` | `projects:view`（D9 未批准时见 §5.9） | **按用户 09-28 裁定**：不挂在 Aims 项目页或组织资产下；列表只含用户可见项目；详情与编辑复用 `/codocs/documents/:uuid` 文档工作区 |
| 部门开放文档 | 文档 → 文档协作 | `/codocs/company/open-department-docs` | `company:view` | 跨部门浏览，放在协作分组 |
| 组织资产（公司制度、通知公告、法务合规、企业文化、技术规范、公司知识库） | 建议新增 文档 → **组织资产** 分组；备选：文档空间 | `/codocs/company/<subdir>` | `company:view` | 新增分组需要改 `business-areas.mjs`（ADR-019 导航规范），§8 D11 |
| 文档模板 | 文档 → 模板与复用 | `/codocs/company/templates` | `company:view` | 现有分组 |
| 团队汇报（B1b） | 工作台 → 团队管理（分组不存在）或 工作台 → 日常协作 | `/codocs/departments/weekly-reports` | `departments:view` | §8 D6、D11 |
| 已发布文档查看页、短链 | 不进菜单 | `/codocs/departments/document`、`/codocs/company/document`、`/codocs/s/:token` | 路由级登录；预览再判权 | 通知与短链兼容，旧 URL 按 Gateway 迁移规则映射 |

`产品资料 /products` 属于 Codocs 产品页，不在本批。

### 6.2 页面注册

在 `codocs/layer/entry.mjs` 的 `pages` 中显式 `appPage(...)` 注册上表路由，不注册 `company/index`、`departments/knowledge`；`hostReadiness.deferredPages` 保持仅演示页。页面归属 `authorizationApp=codocs` 由注册表写入。改导航后运行 `pnpm --dir enterprise generate:navigation`。

### 6.3 API 路由形态

- 沿用独立端路径（`/codocs/api/folders`、`/documents`、`/dept-cabinet/**`、`/dept-shares/**`、`/dept-assets/**`、`/company-assets/**`、`/open-department-docs/**`、`/published-asset-links/**`、`/weekly-reports/**`），页面通过现有 `moduleUrl()` 适配前缀，页面源码与独立端共用。
- 已存在的 Host 通用路由（`/codocs/api/documents` GET/POST、`/documents/:uuid` GET/PATCH/DELETE、`/restore`、`/upload`、`/folders[/:id]`）增加按类型分派：列表按请求 `type`/`folder_type` 选择 personal、department 或 project 操作（请求值只决定走哪个操作，由 Runtime 各自强制范围）；单对象动作先用最小元数据读取确定对象类型，再分派，**不信任请求声明的类型**。
- 新增 `GET /codocs/api/departments/mine`（`console.directory-self-departments` 的部门选择器投影）与 `GET /codocs/api/departments/access`，替代 legacy `/api/account/*`。
- 每次新增或删除路由后运行 `pnpm --dir enterprise generate:api-readiness`。

## 7. 实施计划

三批可以并行：只在 `enterpriseRuntimeClient.ts` 操作表、`codocs/layer/entry.mjs` 和 readiness 生成物上有共享文件，按“每批只追加自己的行、最后由协调者合并生成物”规避冲突。Runtime 每批使用独立文件 `enterprise_codocs_<batch>.go`，共享的“按 Directory 计算部门/项目关系” helper 先作为 B1 第一步合入（B3 依赖其项目部分，可以同时写）。

### B1 部门（INT-606d 主体）

- Runtime：`internal/apps/codocs/department_access.go`（R 计算，只读 `s.directory`），`department_documents.go`（list/view/trash/create/upload/edit-metadata/readonly/recycle/restore-plan/restore/download/copy），`department_folders.go`（list/view/create/update/delete/open），`department_shares.go`（list/decide），`department_cabinet_*.go`（复用个人柜实现，参数化 scope）；`internal/server/enterprise_codocs_department.go` 规格与路由。
- Foundation：操作表追加约 30 条 `codocs.department-*`。
- Host：`enterprise/server/utils/enterpriseCodocsDepartment*.ts`；`server/routes/codocs/api/{dept-cabinet,dept-shares,dept-assets,departments}/**`；通用文档/目录路由的类型分派。
- 页面：`departments/index.vue`、`cabinet.vue`、`DepartmentAssetBrowser`、`PendingDeptShares` 改用 `moduleUrl()`、`useConfirm()`、`useDebouncedSearch()`、真实分页与 `CommonEmptyState`；去掉 `/api/account/*`；“发布”“收藏”按 §8 D5、D7 隐藏或改造。
- 测试：Go `department_access_test.go`（五种 R、leader 优先、parent 仅直接上级、Directory 失败 503）、部门文档/目录/柜/移交的隔离 MySQL 事务与回执测试（经理删除他人文档成功、成员失败、跨部门目录移动失败、恢复到他部门目录失败、同键异意图 409、撤销关系后旧键重放失败）；Enterprise `codocs-department-*.test.mjs`（伪造 `dept_code`、`owner`、`viewer`、marker 被拒，读写权限分开，依赖故障 503）；readiness、导航与注册测试；复用 `cabinetReadAuthorization`、`departmentDocumentsServiceContract`、`open_folders_test.go`、`folder_operations_test.go`。
- 工作量：**7–9 人日**（其中部门柜 2–3 人日，可再拆）。
- B1b 团队汇报（需 D6）：部门周报 create/submit/revise/list/remind + 主管查看成员已提交汇报的新授权。**3–4 人日**。
- B1c 部门发文申请（需 D7）：`publish-requests` 创建与 Workflow instance 的 Host 接线，复用 `serviceAppFetch`/Workflow binding。**2–3 人日**。

### B2 组织资产、知识库、模板、部门开放文档

- Runtime：`enterprise_codocs_company_assets.go`（record-access、access-records list/export、quick-publish source/prepare/complete）、`open-department-documents:list|view`、`published-asset-links:create|resolve`。
- Host：`enterpriseCodocsCompanyAssets.ts`（请求级 OSS 列举、预览、目录管理；列表真实分页），查看记录与 CSV、知识库导入、短链与已发布查看页；PDF.js 静态资源随 Host 发布（codocs/CLAUDE.md 已有要求）。
- 页面：7 个 `company/*` 包装页、`open-department-docs.vue`、`company|departments/document.vue`、`s/[token].vue`；`CompanyAssetBrowser` 的删除改用 `useConfirm`。
- 测试：查看记录失败返回 503 且不交付内容；`admin:admin` 与 `company:*` 的组合（缺任一均 403）；路径穿越与前缀越界；短链不授予权限；开放文档 UUID 只收窄；复用 `companyAssetAccessRecords`、`companyAssetQuickPublish*`、`publishedAssetShortLinks`、`openDepartmentTree` 及对应 Go 测试。
- 工作量：**4–5 人日**。

### B3 项目组文档（小批，单列）

- 建议**单列第三批**而不是并入 B1：授权模型（项目注册表、`projects:*` 基线）与部门完全不同，且依赖 §8 D9/D10 的用户裁定；数据量小（10 篇），可以并行而不阻塞 B1。
- Runtime：`project_team_documents.go`（list/view/create/upload/edit-metadata/recycle/restore，按 Directory 项目 managed/joined 计算关系；首版不做目录，生产为 0）；spec 与路由。
- Host：`enterpriseCodocsProjectTeamDocuments.ts`；`/codocs/api/documents/project/:code`、`/folders/list/:code` 兼容读取；类型分派。
- 页面：`projects/index.vue` 删去 git-project、仓库、GitLab 同步部分（或抽出纯项目组子组件），导航挂“文档 → 文档协作”。
- 测试：非成员 403；成员可读可建；负责人可管理；Aims 编码与孤立编码文档只按 ACL；`git-project` 类型被拒；子项目继承按 D10。
- 工作量：**2–3 人日**（D9 若不批准，降为约 1.5 人日：只做 ACL 可见列表）。

### 7.1 统一验收（各批分别记录）

非页面：`pnpm --dir enterprise typecheck|test`、`pnpm --dir codocs typecheck|test`、`go test ./internal/apps/codocs ./internal/server`（-race），readiness 与导航生成无漂移。页面：1440/390 两个视口，逐页逐动作，区分空列表、无权限、未配置、依赖故障；使用 C000001 负向账号验证越权。环境：Runtime 与 Host 成对部署，确认 `codocs:enterprise-host:execute` grant 与签发；不得用 SQL 行存在代替签发探测。

## 8. 需要用户裁定的事项

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| D1 | 部门关系语义：leader 只读且优先于 manager、parent 仅直接上级、scoped grant（如档案管理员 `department:tree`）是否可以不依赖 R 读取 | 原样保留；scoped grant 默认不放行 |
| D2 | 部门资产（会议记录/对外发文/部门规章）：仅本部门 R 可读，还是全员可读（今天服务端实际对所有持 `departments:view` 的人开放）；是否把 `departments:export` 加入基线 | 仅 R 可读；导出不改基线 |
| D3 | 部门柜“发布 PDF 到组织资产”的门槛：`company:publish`，还是与知识库导入一致为 `admin:admin` + `company:publish` | 统一为后者，并补发布记录 |
| D4 | 部门文档 owner 离开部门后能否继续编辑、移动、删除自己的文档；经理能否分享他人部门文档 | owner 保留正文编辑（ACL 不变），移动和删除需 R=manager；经理不可代分享 |
| D5 | 部门“收藏”是文档级标志，影响所有人 | 部门页隐藏收藏，个人收藏另议 |
| D6 | 团队汇报是否纳入 10/8：主管看成员已提交的个人汇报属于新授权；成员能否新建部门周报 | 列为 B1b；若 10/8 前无法完成，入口隐藏 |
| D7 | 部门“发布”（Workflow 发文申请）是否纳入 10/8 | 列为 B1c；未完成前隐藏按钮并显示明确状态 |
| D8 | “复制文档”是否迁 | 迁（低成本），但放在 B1 末尾 |
| D9 | 项目组文档：是否按 Directory 项目成员放开可读、可建（授权扩大）；是否在 Platform 基线加 `codocs:projects:view|create|edit relation=project_member`。D9b：Aims 编码的 4 篇是否按 Aims 成员放开 | 批准 D9，按 Directory 成员；D9b 不放开 |
| D10 | 项目组文档：子项目成员能否看父项目文档，是否支持目录（生产 0 个） | 不向上继承；首版不做目录 |
| D11 | 菜单：是否新增“文档 → 组织资产”分组、部门资产用三个入口还是页签、团队汇报放“日常协作”还是新增“团队管理”分组 | 新增“组织资产”分组；部门资产三入口；团队汇报先放“日常协作” |
| D12 | 部门移交“接收”的语义：转为部门文档，还是只记录确认 | 转为部门文档，保留原 owner |

### 8a. 用户裁定（2026-09-28）

- D1–D8、D11、D12：**按上表建议执行**。D6（团队汇报 B1b）与 D7（部门发文 B1c）在 10/8 前未完成时隐藏入口并给出明确状态。
- D9、D9b、D10（项目组文档）：**暂缓**。用户指出本文对“项目组文档”的理解可能不对，待 B1（部门）与 B2（组织资产）完成后再讨论确定；B3 在此之前不实施，§5.9 与 §7 B3 仅作盘点记录，不作为合同。

## 9. 证据边界

- 已核实：上文 `文件:行`、生产只读计数（information_schema 与 COUNT/GROUP BY）。盘点时有一次按路径段分组的查询把两个路径段文件名输出到了本地终端；本文未记录这两个名称，后续计数只用前缀匹配。
- 推断：Host 编辑器打开非 owner 部门文档会失败（G2）、经理代管操作在 Runtime 被拒（G3，仅代码层核实，未做环境复现）、经理默认看不到成员个人汇报（§3.6）。
- 未做：OSS 对象计数、浏览器验证、任何写操作、grant 或环境变更。本文不代表任何批次已实现或已验收，INT-606d 不勾选。
