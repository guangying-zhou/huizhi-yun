# Codocs → Enterprise 路由盘点（mydocs 首批）

盘点范围：`codocs/app/pages/mydocs` 当前 10 页；只记录源码实际调用，不推断 Enterprise capability。项目文档页不在本批；编辑器、Collab、数据 Runtime、OSS 归属保持现状。

## 页面与实际 API

- `/mydocs`（`index.vue`）：GET `/api/folders?folder_type=private&owner_uid=:uid`、GET `/api/documents?type=private&owner=:uid&exclude_worklogs=1`、GET `/api/documents/:uuid`；PATCH `/api/folders/:id`（重命名）、PATCH `/api/documents/:uuid`（标题/收藏/只读/移动）、POST `/api/documents`、POST `/api/folders`、POST `/api/documents/upload`、DELETE `/api/folders/:id`、DELETE `/api/documents/:uuid`、POST `/api/worklogs/create`。导航 `/documents/:uuid`（含创建工作日志后的 query）。见 `index.vue:104-139,244,276-284,367-407,471,518-631,648-682`。
- `/mydocs/cabinet`：GET `/api/cabinet`、GET `/api/cabinet/:uuid/preview`、GET `/api/cabinet/:uuid/converted-info`、GET `/api/documents/:uuid`；POST `/api/cabinet/upload`、POST `/api/cabinet/:uuid/to-document`；DELETE `/api/cabinet/:uuid`；浏览器下载 GET `/api/cabinet/:uuid/download`；另 GET 私人 `/api/folders`。导航 `/documents/:uuid`。见 `cabinet.vue:102-119,189-224,338-375,393-474`。
- `/mydocs/favorites`：GET `/api/documents?owner=:uid&starred=true`；PATCH `/api/documents/:uuid`（取消收藏）。行点击/操作导航 `/documents/:uuid`，下载走 `useDocumentDownload`。见 `favorites.vue:33-50,119-132`。
- `/mydocs/recently`：GET `/api/documents`（最近使用查询参数）；行点击/操作导航 `/documents/:uuid`，下载走 `useDocumentDownload`。见 `recently.vue:13-53,68-103`。
- `/mydocs/recycle`：GET `/api/documents/trash`（由 `useRecycleBin` 调用）、GET `/api/documents/:uuid?include_deleted=1`；恢复由 `useRecycleBin` POST `/api/documents/:uuid/restore`。预览使用只读 `EditorMilkdownEditor`，不自行导航。见 `recycle.vue:28-75,224-240`、`useRecycleBin.ts:99-126`。
- `/mydocs/shared`：GET `/api/collab-docs`（category/scope/tab/search/dept/owner 等筛选）、GET `/api/documents/:uuid`；导航 `/documents/:uuid?fromCollab=1`。直接组件的副作用为 POST `/api/reviews/:reviewId/receive`（收文）、POST `/api/reviews/:reviewId/seal`（盖章）、POST `/api/reviews/:reviewId/send`（发文/发送）；组件分别见 `review/ReceiveConfirmModal.vue:108`、`SealConfirmModal.vue:140`、`SendConfirmModal.vue:297`。见 `shared.vue:60-145,287-344`。
- `/mydocs/journal`：GET `/api/worklogs/list`、GET `/api/documents/:uuid`；POST `/api/worklogs/create`；GET `/api/personal-weekly-reports/list`、GET `/api/documents/:uuid`；POST `/api/personal-weekly-reports/create`；PATCH `/api/documents/:uuid`（`readonly_flag` 提交）。导航 `/documents/:uuid`。见 `journal.vue:308-529`。
- `/mydocs/worklogs`：PATCH `/api/documents/:uuid`（提交只读）、GET `/api/worklogs/list`、GET `/api/documents/:uuid`、POST `/api/worklogs/create`；导航 `/documents/:uuid`（创建时附 query）。见 `worklogs.vue:172-455`。
- `/mydocs/weekly-reports`：PATCH `/api/documents/:uuid`（提交只读）、GET `/api/personal-weekly-reports/list`、GET `/api/documents/:uuid`、POST `/api/personal-weekly-reports/create`；导航 `/documents/:uuid`。见 `weekly-reports.vue:87-369`。
- `/mydocs/slides`：POST `/api/folders`（slide 文件夹）、GET `/api/folders?folder_type=slide&owner_uid=:uid`、GET `/api/documents?type=slide&owner=:uid`；PATCH `/api/folders/:id`、PATCH `/api/documents/:uuid`（标题/移动）、DELETE `/api/folders/:id`、DELETE `/api/documents/:uuid`；GET `/api/documents/:uuid`、GET `/api/slides/demo`、GET `/api/slides/content`；POST `/api/documents`、POST `/api/slides/export`；PUT `/api/documents/:uuid`（覆盖正文）。见 `slides.vue:86-196,290-358,391-523,561`。

## 直接导航、编辑器与依赖

- 统一正文入口为 `/documents/:uuid`（`codocs/app/pages/documents/[uuid].vue`）；该页实际复用 `useCollaboration` 获取 `/api/collaboration/token`，挂载 `EditorMilkdownEditor.client.vue`，并承载批注、分享、已读、版本和删除操作。`mydocs/recycle.vue` 另直接挂载只读 Milkdown；`cabinet.vue` 使用 `DocLazyPreview.client.vue`、`CabinetPptxPreview.client.vue`；`slides.vue` 使用 `SlidePreview.client.vue`。
- 页面直接组件：`index.vue` → `FileTreeItem`、`MoveFolderModal`、`ShareDocumentModal`、`TransferDocumentModal`、`DocLazyPreview`；`cabinet.vue` → `CabinetPptxPreview`、`DocLazyPreview`；`recycle.vue` → `RestoreDocumentModal`、`EditorMilkdownEditor`；`shared.vue` → 三个 review confirm modal、`DocLazyPreview`；`slides.vue` → `FileTreeItem`、`MoveFolderModal`、`SlidePreview`；日志/周报页 → `DocLazyPreview`/日历与 modal 内联组件。`ShareDocumentModal` 还 GET/POST `/api/documents/:uuid/shares`、DELETE `/api/documents/:uuid/shares/:shareId`；`TransferDocumentModal` POST `/api/documents/:uuid/dept-shares`、POST `/api/documents/:uuid/project-transfer`，两者均属于首批既有可达操作，项目移交 API 依赖不可删减。
- 共同 composable：`useAuth`、`useResizablePanel`、`useDocumentPreviewBootstrap`；`useDocumentDownload` 用于下载页；`useRecycleBin` 管回收站；`useLayoutHeaderActions` 被 `/mydocs` 与 `/mydocs/slides` 使用；共享页额外 `usePermissions`、Pinia `useAccountStore`。
- `useQuickCreateDoc` 是跨页面快捷创建入口（Ctrl/⌘+K），会调用 `/api/documents`、`/api/worklogs/create`、`/api/personal-weekly-reports/create`；Enterprise 迁移需保留同一工作日志/个人周报页面，不复制第二套实现。

## 尚未确定项

- `/api/collab-docs` 返回的 review 状态、Workflow 关联和 review 列表侧副作用仍需主接入合同确认；上述三个确认 Modal 的具体 POST 路径已由源码确认。
- `/api/slides/demo`、`/api/slides/content`、`/api/slides/export` 的 Enterprise 路由注册与数据/OSS 归属未在本盘点中假定；需由主接入合同确认。
- `/api/cabinet/:uuid/download` 是浏览器直接 GET 链接，不要只迁移列表/预览而遗漏下载副作用与转文档 POST。
