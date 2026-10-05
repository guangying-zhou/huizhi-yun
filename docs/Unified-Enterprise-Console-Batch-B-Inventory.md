# Console 批次 B 迁移盘点（只读）

> **2026-10-01 已被 ADR-018a D8 取代**：Console 保持独立管理控制台，本盘点中迁入 Enterprise 的 Console 管理页及其 BFF 已删除；下文仅作历史记录。

日期：2026-09-26；基础修复提交 `3c8ad335`（与盘点分开），盘点时共享工作树另有其他代理提交。范围：目录管理 7 页与工作日历。依据当前源码静态盘点；未查询数据库、未调用环境写接口、未重启。此报告不提交。Step 3 保持暂缓。

## 1. 共用边界、身份与 Host 现状

- `B=console/server/api/v1/console/directory`；`F=foundation/server/utils/consoleTenantRuntimeClient.ts`。表中的页面行号相对于各节的页面文件，B/F 均是完整文件路径的缩写。
- Console 用户 API 由 `console/server/utils/checkPermission.ts:78` 的 requirePermission 解析当前用户、加载 policy snapshot、检查 resource/action；并保留模拟授权模式限制。不是只看前端按钮，也不是统一一个“管理员”权限。
- 这些业务数据走客户侧 Console tenant-runtime：`F:57-83` 的 callConsoleTenantRuntime → maybeCallTenantRuntime；未绑定时 503，禁止回退 Console 本地 DB。Runtime 的目录 SQL 位于 `data-runtime/internal/apps/directory/**`，目录源/Vault 与日历位于 `data-runtime/internal/apps/console/**`。Console 本地 session/policy 控制面不能被误记为这些业务表的数据源。
- 当前 Host 无这 8 页的专用页面或管理 BFF（搜索 `enterprise/app/pages/**`、`enterprise/server/**`）；现有 `/enterprise/notifications/**`、`/enterprise/todos` 只覆盖批次 A 已批准范围。Aims 日历 BFF `enterprise/server/routes/aims/api/work-calendars/[calendarCode]/days.get.ts` 是业务读取合同，不覆盖 Console 日历管理。
- Foundation 已有 `useDirectory`、directory store、UserTreeSelector，以及 `/api/directory/users`、`/departments`、`/projects` 等读路由。`foundation/server/utils/directoryApi.ts:331-398` 在 Host 下把 users/departments 转为 Directory sharing service 查询，把 projects 转为 project-access service 查询。这些是共享投影，不能替代 Console `directory_*:view/edit` 管理权限合同。
- Foundation `fetchConsoleApi`（directoryApi.ts:400）支持 JSON 方法，但不提供独立 headers/Key 参数；现有用户身份转发不能从通知 helper 扩到目录管理而未经决定。`consoleServiceBinding.ts` 是 transport binding，不等于已有目录管理用户授权适配。
- Foundation 共用组件/组合函数可复用：CommonEmptyState、UserTreeSelector、ContentPageHeader、usePageTitle、useDebouncedSearch、useListPage、useApiErrorAlert、usePageActions、useConfirm、usePermissions、useApplicationShell。所有目录页依赖 Console `app/utils/dashboard.ts` 的 dashboardPanelUi；部门另依赖 `app/utils/log.ts` 的 extractErrorMessage。迁移应共享组件并将路由、API 路径、panelUi 作为参数，不能复制整页或暗中带入 Console 私有样式。
- 当前 Console 导航定义 `console/app/config/permissions.ts:56-92,106`，对应 Gateway `/console/directory/...`、`/console/work-calendar`；动态同步详情从 sync.vue:66 链接 `/directory/sync/:jobCode`。Host `enterprise/app/utils/enterprise-navigation.ts:290` 有控制台区域，但当前静态项主要是 Assets 配置；`enterprise/composition/business-areas.mjs:56` 的企业/身份/集成等分组是分类，不代表上述页已经注册。未发现本批次直接 Host 链接，实际登录后菜单可见性 **unverified**。
- `useApplicationShell` 是嵌入/导航协议，不提供新 API 权限。将来 Host 路由宜使用 `/enterprise/directory/...`、`/enterprise/work-calendar`，避免与 Gateway 真实 `/console` 应用前缀冲突，待 Claude 决定。
- 各节形态 **(a，待身份适配决定)** 指保留现有 Console 用户 API，通过窄 Host BFF 和受控 Foundation 用户 binding 调用；业务 Runtime 操作已存在，不因此新增 capability/grant。当前通知以外身份适配是明确依赖，实施触发 brief 停止条件；本报告仅列依赖。不能标成“今天无需 Foundation 改动即可迁入”。若改选 service 路径则是 **(b)**，必须另行定义服务合同、用户 actor、权限以及 grants；本次不建议用服务权限绕过用户权限。

## 2. 用户 `console/app/pages/directory/users.vue`

### 组件与 composables

Foundation：usePageTitle(:6)、useDebouncedSearch(:53)、useListPage(:56)、useApiErrorAlert(:97)、usePageActions(:102)，CommonEmptyState。Nuxt：useFetch/useToast；Vue：ref/reactive/computed/onMounted/onBeforeUnmount、h/resolveComponent。Nuxt UI：UDashboardPanel、UAlert、UButton、UCard、UFormField、UInput、UModal、UPagination、USelect、UTable，以及动态 UAvatar/UBadge/UButton(:133)。分页每页 20，筛选 search/deptCode/status。没有独立 usePermissions 按钮控制；以服务端权限为准。

### API、数据源与授权

| METHOD + path（页面行） | Console handler：调用 / 权限 / Key | Runtime 调用及数据 |
| --- | --- | --- |
| GET `/api/v1/console/directory/users`（:93） | `B/users/index.get.ts:6`；directory_users:view（:5）；无写 Key | `F:1252` '/v1/console/directory/users'；`console:directory-user:view`；Runtime directory_users；D/console_management.go:145 |
| GET `/api/v1/console/directory/departments`（:108） | `B/departments/index.get.ts:6`；directory_departments:view（:5）；无写 Key | `F:1333` '/v1/console/directory/departments'；`console:directory-department:view`；Runtime directory_departments；D/console_management.go:225 |
| GET `/api/v1/console/directory/provisioning`（:115） | `B/provisioning.get.ts:6`；directory_users:view（:5）；无写 Key | `F:173` '/v1/console/directory/provisioning'；`console:directory-connector:view`；Runtime 连接器部署状态；D/console_connector_management.go:36 |
| GET `/api/v1/console/directory/operations/:operationId`（:278） | `B/operations/[operationId].get.ts:8`；当前 UID（handler :5）；无写 Key | `F:1027` `/v1/console/directory/operations/${encodeURIComponent(operationId)}` as `/v1/console/${string}`；`console:directory-connector:view`；当前用户；Runtime integration_operation，D/console_connector_management.go:94；绑定 original_actor_uid :111 |
| POST `/api/v1/console/directory/users`（:314） | `B/users/index.post.ts:89`；directory_users:edit（:59）；强制 Key :60 | `F:1263` '/v1/console/directory/users'；`console:directory-user:edit`；Console/manual 用户：D/console_user_mutation.go:85；LDAP 分支另见下文 |
| PATCH `/api/v1/console/directory/users/:uid`（:338） | `B/users/[uid].patch.ts:15`；directory_users:edit（:8）；强制 Key :9 | `F:1274` `/v1/console/directory/users/${encodeURIComponent(uid)}` as `/v1/console/${string}`；`console:directory-user:edit`；D/console_user_mutation.go:165；写后 getDirectoryUserForAdmin 再读 Runtime |


这里 `D=data-runtime/internal/apps/directory`（后续各节沿用）。operations handler 没有 resource/action 检查，但 `operations/[operationId].get.ts:5` 强制当前 UID；Runtime 限定原发起人，不能当成任意 operation 查询。

### 写动作、外部副作用与 batch C

- POST 用户：`directory_users:edit`，handler :59-60 必须 Key，页面 :317 提供。Console/manual 分支写 Runtime directory_users/部门关联及 mutation receipt，无直接 LDAP/WeCom/DingTalk 网络调用。LDAP 分支 handler :66 → `F:1069` queueConsoleDirectoryLDAPUserCreate，Runtime `/v1/console/directory/connector-operations/users`、`console:directory-connector:execute`；D/console_connector_management.go:175 加密密码并持久化连接器操作，之后目录连接器创建外部 LDAP 账号，是异步外部写副作用。
- LDAP 激活分支还可经 `users/index.post.ts:25-43,68-88` sendNotification 投递员工激活链接，token 发给员工并从调用方响应剔除。通知渠道实际启用情况 **unverified**，不能假定是某固定 IM 渠道。
- PATCH 用户：`directory_users:edit`，handler :8-9 必须 Key，页面 :341 提供；修改姓名/邮件/电话/状态/部门等 Runtime 数据。D/console_user_mutation.go:195-196 保留 People/HR 字段归属限制；未见这个通用 PATCH 直接同步外部 LDAP/WeCom/DingTalk。启停状态涉及身份生命周期，不可在迁移时简化授权。
- **batch C**：页面 initialPassword/确认输入；建 LDAP 用户后读取 initialPassword（:322）、一次展示与复制（:263,269,327）。Runtime :240 加密给连接器，:309 一次返回生成密码。即使 activationToken 已剔除，该页仍有明文初始密码路径。用户列表含 PII，与凭据不是同一概念，但必须保留目录权限。

### 迁移形态、Host 复用与顺序

**整页 (c)，凭据建号继续 Console；可单独拆无凭据的列表/普通编辑为 (a，待身份适配决定)**。Host 可复用 Foundation 表格辅助函数和目录选择器，但共享目录 projection 不能充当管理员完整用户列表。先决定拆页还是只读 Host 列表；普通读/编辑 M，含密码/激活建号 L 且不属于 B 实施。建议 B 次序 5。

## 3. 部门 `console/app/pages/directory/departments.vue`

### 组件与 composables

Foundation usePageTitle(:7)、useConfirm(:51)、CommonEmptyState；Nuxt useFetch(:70)、useToast；Vue ref/reactive/computed/watch、h/resolveComponent(:116)。Nuxt UI：UDashboardPanel、UDashboardNavbar、UDashboardSidebarCollapse（注释 header 也保留）、UAlert、UButton、UCard、UFormField、UInput、UModal、USelect、UTable、UTextarea、动态 UBadge。一次读取树并在客户端筛选/展开，不使用分页 debounce。无独立 usePermissions 按钮控制。

### API、数据源与授权

| METHOD + path（页面行） | Console handler：调用 / 权限 / Key | Runtime 调用及数据 |
| --- | --- | --- |
| GET `/api/v1/console/directory/departments`（:70） | `B/departments/index.get.ts:6`；directory_departments:view（:5）；无写 Key | `F:1333` '/v1/console/directory/departments'；`console:directory-department:view`；D/console_management.go:225 directory_departments |
| POST `/api/v1/console/directory/departments`（:295） | `B/departments/index.post.ts:12`；directory_departments:edit（:8）；强制 Key :9 | `F:1344` '/v1/console/directory/departments'；`console:directory-department:edit`；D/console_department_mutation.go:27 |
| PATCH `/api/v1/console/directory/departments/:deptCode`（:301） | `B/departments/[deptCode].patch.ts:15`；directory_departments:edit（:8）；强制 Key :9 | `F:1352` `/v1/console/directory/departments/${encodeURIComponent(deptCode)}` as `/v1/console/${string}`；`console:directory-department:edit`；D/console_department_mutation.go:125 |
| DELETE `/api/v1/console/directory/departments/:deptCode`（:326） | `B/departments/[deptCode].delete.ts:13`；directory_departments:edit（:7）；强制 Key :8 | `F:1364` `/v1/console/directory/departments/${encodeURIComponent(deptCode)}` as `/v1/console/${string}`；`console:directory-department:edit`；D/console_department_mutation.go:284，软删除 |


### 写动作 / batch C / 迁移

创建、编辑（父部门/负责人/Leader/orgType/category/排序）、删除均 `directory_departments:edit`，handler 强制 Key，页面 :297,303,328 发 Key。写 Runtime 目录表、subject export、审计/receipt；在上述 mutation 和 Runtime dispatch 未见直接外部 IM/LDAP 同步。不能把本地 subject export 更新称为立即推送 Platform；显式重建另在同步页。

必须保留 D/console_department_mutation.go:170-192 钉钉字段权威限制和根公司负责人补充例外；:321-325 禁止删除钉钉管理部门。页面编辑发送差异 payload，迁移不可改成提交全部字段。无本页密码/MFA/令牌/凭据展示；底层登录/session 验证留 Console（batch C）。

形态 **(a，待身份适配决定)**，共用树/表单组件加窄用户 BFF，现有 Runtime 操作足够。Host 可复用 UserTreeSelector 的树读取概念，不可换掉完整管理 API。建议次序 2，M。

## 4. 项目注册表 `console/app/pages/directory/projects.vue`

### 组件与 composables

Foundation usePageTitle(:6)、useDebouncedSearch(:56)、useListPage(:61)、useConfirm(:77)、useApiErrorAlert(:107)、usePageActions(:112)、CommonEmptyState。Nuxt useFetch/useToast；Vue ref/reactive/computed、h/resolveComponent、onMounted/onBeforeUnmount 等页面生命周期。Nuxt UI：UDashboardPanel、UDashboardNavbar/SidebarCollapse（注释 header）、UAlert、UBadge、UButton、UCard、UFormField、UInput、UModal、UPagination、USelect、UTable、UTextarea。成员编辑文本 uid:role，无独立 usePermissions 按钮控制。

### API、数据源与授权

| METHOD + path（页面行） | Console handler：调用 / 权限 / Key | Runtime 调用及数据 |
| --- | --- | --- |
| GET `/api/v1/console/directory/projects`（:103） | `B/projects/index.get.ts:6`；directory_projects:view（:5）；无写 Key | `F:1475` '/v1/console/directory/projects'；`console:directory-project:view`；D/console_management.go:268 directory_projects |
| GET `/api/v1/console/directory/departments`（:118） | `B/departments/index.get.ts:6`；directory_departments:view（:5）；无写 Key | `F:1333` '/v1/console/directory/departments'；`console:directory-department:view`；D/console_management.go:225 |
| GET `/api/v1/console/directory/projects/members?projectCode`（:294） | `B/projects/members.get.ts:11`；directory_projects:view（:5）；无写 Key | `F:1534` `/v1/console/directory/projects/${encodeURIComponent(projectCode)}/members` as `/v1/console/${string}`；`console:directory-project:view`；D/console_management.go:892 directory_project_members |
| POST `/api/v1/console/directory/projects`（:384） | `B/projects/index.post.ts:12`；directory_projects:edit（:8）；强制 Key :9 | `F:1486` '/v1/console/directory/projects'；`console:directory-project:edit`；D/console_project_mutation.go:24 |
| PATCH `/api/v1/console/directory/projects/:projectCode`（:390） | `B/projects/[projectCode].patch.ts:15`；directory_projects:edit（:8）；强制 Key :9 | `F:1494` `/v1/console/directory/projects/${encodeURIComponent(projectCode)}` as `/v1/console/${string}`；`console:directory-project:edit`；D/console_project_mutation.go:106 |
| DELETE `/api/v1/console/directory/projects/:projectCode`（:415） | `B/projects/[projectCode].delete.ts:13`；directory_projects:edit（:7）；强制 Key :8 | `F:1506` `/v1/console/directory/projects/${encodeURIComponent(projectCode)}` as `/v1/console/${string}`；`console:directory-project:edit`；D/console_project_mutation.go:222 |
| POST `/api/v1/console/directory/projects/members`（:447） | `B/projects/members.post.ts:26`；directory_projects:edit（:13）；强制 Key :14 | `F:1514` `/v1/console/directory/projects/${encodeURIComponent(projectCode)}/members` as `/v1/console/${string}`；`console:directory-project:edit`；Runtime PUT /projects/:code/members；D/console_project_mutation.go:272 |


### 写动作 / batch C / 迁移

四种写入均 `directory_projects:edit`，全部 handler 强制 Key；页面 :386,392,417,449 提供。项目创建/编辑/软删除更新 Runtime directory_projects 与 subject export；成员 POST 是**替换整套成员**，由 Runtime PUT 执行，不是单项追加。写后部分 handler 再读 directoryRuntime。上述 mutation 未见直接 GitLab 仓库创建、LDAP/WeCom/DingTalk 调用或 Platform HTTP 推送；repoUrl 是数据字段，不是此页触发外部仓库操作的证据。

无凭据/session/password/MFA/token 表单；登录控制面 batch C 留 Console。形态 **(a，待身份适配决定)**；不能拿 Foundation project-access 项目可见性投影替代管理注册表或成员写。建议次序 3，M。

## 5. 委员会 `console/app/pages/directory/committees.vue`

### 组件与 composables

Foundation usePageTitle(:6)、useConfirm(:74)、usePermissions(:75)、useDebouncedSearch(:81,390)、useListPage(:83)、useApiErrorAlert(:106)、usePageActions(:111)、CommonEmptyState、UserTreeSelector(:744)。Nuxt useFetch/useToast；Vue ref/reactive/computed/watch/onMounted/onBeforeUnmount、h/resolveComponent。Nuxt UI：UDashboardPanel、UAlert、UAvatar、UBadge、UButton、UCard、UFormField、UInput、UModal、UPagination、USelect、USlideover、UTable、UTextarea。canEdit 检查 directory_departments:edit，委员会和成员列表分别分页/搜索。

### API、数据源与授权

| METHOD + path（页面行） | Console handler：调用 / 权限 / Key | Runtime 调用及数据 |
| --- | --- | --- |
| GET `/api/v1/console/directory/committees`（:96） | `B/committees/index.get.ts:6`；directory_departments:view（:5）；无写 Key | `F:1392` '/v1/console/directory/committees'；`console:directory-department:view`；D/console_management.go:500；directory_departments org_type=committee |
| GET `/api/v1/console/directory/departments`（:117） | `B/departments/index.get.ts:6`；directory_departments:view（:5）；无写 Key | `F:1333` '/v1/console/directory/departments'；`console:directory-department:view`；D/console_management.go:225 |
| POST `/api/v1/console/directory/committees`（:323） | `B/committees/index.post.ts:17`；directory_departments:edit（:12）；强制 Key :13 | `F:1403` '/v1/console/directory/committees'；`console:directory-department:edit`；D/console_department_mutation.go:27（委员会分支） |
| PATCH `/api/v1/console/directory/committees/:committeeCode`（:329） | `B/committees/[committeeCode].patch.ts:15`；directory_departments:edit（:8）；强制 Key :9 | `F:1411` `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}` as `/v1/console/${string}`；`console:directory-department:edit`；D/console_department_mutation.go:125（委员会分支） |
| DELETE `/api/v1/console/directory/committees/:committeeCode`（:356） | `B/committees/[committeeCode].delete.ts:13`；directory_departments:edit（:7）；强制 Key :8 | `F:1423` `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}` as `/v1/console/${string}`；`console:directory-department:edit`；D/console_department_mutation.go:284（委员会分支） |
| GET `/api/v1/console/directory/committees/:committeeCode/members`（:405） | `B/committees/[committeeCode]/members/index.get.ts:10`；directory_departments:view（:5）；无写 Key | `F:1439` `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}/members` as `/v1/console/${string}`；`console:directory-department:view`；D/console_management.go:576 directory_user_departments |
| POST `/api/v1/console/directory/committees/:committeeCode/members`（:463） | `B/committees/[committeeCode]/members/index.post.ts:27`；directory_departments:edit（:14）；强制 Key :15 | `F:1451` `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}/members` as `/v1/console/${string}`；`console:directory-department:edit`；D/console_department_mutation.go:439；Runtime PUT 同一路径 |
| PATCH `/api/v1/console/directory/committees/:committeeCode/members/:uid`（:495） | `B/committees/[committeeCode]/members/[uid].patch.ts:20`；directory_departments:edit（:11）；强制 Key :12 | `F:1451` `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}/members` as `/v1/console/${string}`；`console:directory-department:edit`；handler 先读成员再构建保存数组；D/console_department_mutation.go:439 |
| DELETE `/api/v1/console/directory/committees/:committeeCode/members/:uid`（:525） | `B/committees/[committeeCode]/members/[uid].delete.ts:15`；directory_departments:edit（:7）；强制 Key :8 | `F:1463` `/v1/console/directory/committees/${encodeURIComponent(committeeCode)}/members/${encodeURIComponent(uid)}` as `/v1/console/${string}`；`console:directory-department:edit`；D/console_department_mutation.go:521 |


### 写动作 / batch C / 迁移

六种写操作（创建、编辑、删除、添加成员、修改角色、移除成员）全部 `directory_departments:edit`、全部强制 Key；页面 :325,331,358,468,500,530 发 Key。不是新 committee 权限。成员角色包括 chairman/secretary/member 等，保存更新 directory_user_departments 并维护负责人及本地 subject export。上述 mutation 未见直接外部 IM/LDAP/Platform HTTP 写。

无本页凭据输入。UserTreeSelector 的间接接口与 permissions 见 §10，不能只盘点页面显式 fetch。形态 **(a，待身份适配决定)**，复用 Foundation selector、表格工具和新的共用委员会组件；保留成员角色、分页及权限。建议次序 4，L（9 个显式业务 API 和选择器间接依赖）。

## 6. 目录源配置 `console/app/pages/directory/sources.vue`

### 组件与 composables

Foundation usePageTitle(:4)、usePermissions(:49)，Nuxt useFetch(:57)/useToast；Vue ref/reactive/computed/watch(:137)。Nuxt UI：UDashboardPanel、UAlert、UBadge、UButton、UCard、UFormField、UIcon、UInput、USelect、USeparator、UTextarea。provider=ldap/wecom/dingtalk；canEdit=directory_sources:edit(:55)。有 integration/credential/storageBackend 配置表单。

### API、数据源与授权

| METHOD + path（页面行） | Console handler：调用 / 权限 / Key | Runtime 调用及数据 |
| --- | --- | --- |
| GET `/api/v1/console/directory/sources`（:57） | `B/sources/index.get.ts:6`；directory_sources:view（:5）；无写 Key | `F:1217` '/v1/console/directory/sources'；`console:directory-source:view`；data-runtime/internal/apps/console/directory_sources.go:226；integrations + integration_credentials + Vault |
| PUT `/api/v1/console/directory/sources/:providerCode`（:181） | `B/sources/[providerCode].put.ts:14`；directory_sources:edit（:7）；强制 Key :8 | `F:1233` `/v1/console/directory/sources/${encodeURIComponent(providerCode)}` as `/v1/console/${string}`；`console:directory-source:edit`；同文件 :256；配置/凭据版本持久化 |
| POST `/api/v1/console/directory/sources/ldap/test`（:254） | `B/sources/ldap/test.post.ts:10`；directory_sources:edit（:7）；强制 Key :9 | `F:1053` '/v1/console/directory/sources/ldap/test'；`console:directory-connector:execute`；D/console_connector_management.go:391；排队连接器测试 |
| GET `/api/v1/console/directory/operations/:operationId`（:231） | `B/operations/[operationId].get.ts:8`；当前 UID（handler :5）；无写 Key | `F:1027` `/v1/console/directory/operations/${encodeURIComponent(operationId)}` as `/v1/console/${string}`；`console:directory-connector:view`；D/console_connector_management.go:94，绑定原发起人 |


### 写动作、凭据与外部副作用

- PUT 保存任一 provider：`directory_sources:edit`，handler :7-8 强制 Key；页面 :183 发 Key。Runtime directory_sources.go:369-400 写 Vault secret/version、integration_credentials/current pointer；配置保存本身未见立刻调用 LDAP/WeCom/DingTalk API。
- LDAP 测试：`directory_sources:edit` 加 UID，handler :7-9 强制 Key，页面 :256 发 Key。页面 :253 **先保存 LDAP 配置**，再排队测试并轮询自己的 operation；点击测试包含上述两项写动作。Runtime :391,399-454 排队 directory-connector test_connection，随后连接器发起 LDAP bind，是外部网络/凭据使用副作用。
- **batch C，整页保留 Console**：GET 读取连接器 credential 元数据（secretCode/secretRef/storageBackend），Runtime directory_sources.go:163-185 返回 backendSecretRefMasked，未返回 plaintext 或完整 backendSecretRef；不要误写成 GET 已揭示完整密码。表单 PUT 可以提交 plaintext（db_encrypted）或 backendSecretRef（页面 :195-196），涉及凭据录入/轮换；Vault 审计记录 :490。旧凭据留空时不改，与显示密码不是同一动作。
- 没有页面调用 Vault reveal/resolve endpoint 的证据；实际部署历史 config 是否含未清理秘密 **unverified**。Runtime 对新 config 的秘密字段拒绝逻辑见 directory_sources.go:111-146。

形态 **(c)**，不作为 B 普通页面移入。若未来只展示非敏感 source 健康状态，可另建最小投影；当前页没有这样的独立合同，不能在 B 自行新增。建议次序 C 后置，L。

## 7. 同步列表 `console/app/pages/directory/sync.vue`

### 组件与 composables

Foundation usePageTitle(:6)、usePermissions(:33)、CommonEmptyState；Nuxt useFetch/useToast；Vue ref/computed、h/resolveComponent。Nuxt UI：UDashboardPanel、UAlert、UButton、UCard、UTable、动态 UBadge。GET limit=30；canRunSync=directory_sync:edit(:49)，canRebuild=directory_sync:admin(:50)。详情路由 :66。

### API、数据源与授权

| METHOD + path（页面行） | Console handler：调用 / 权限 / Key | Runtime 调用及数据 |
| --- | --- | --- |
| GET `/api/v1/console/directory/sync-jobs`（:43） | `B/sync-jobs/index.get.ts:7`；directory_sync:view（:6）；无写 Key | `F:1580` '/v1/console/directory/sync-jobs'；`console:directory-sync:view`；D/console_sync_jobs.go:27 directory_sync_jobs |
| POST `/api/v1/console/directory/sync-jobs`（:118） | `B/sync-jobs/index.post.ts:28`；directory_sync:edit（:15）、directory_sync:admin（:26）；强制 Key :27,46 | `F:1611` '/v1/console/directory/sync-jobs'；`console:directory-sync:edit`；D/console_sync_jobs.go:113；重建 subject export 并推送 Platform |
| POST `/api/v1/console/directory/sync-jobs`（:158） | `B/sync-jobs/index.post.ts:47`；directory_sync:edit（:15）、directory_sync:admin（:26）；强制 Key :27,46 | `F:1061` '/v1/console/directory/connector-operations/ldap-sync'；`console:directory-connector:execute`；F:1061 /connector-operations/ldap-sync；D/console_connector_management.go:383 |


上表两行 POST 是同一 URL 的不同 body 分支：页面 :118 为 console/manual/subjects，:158 为 ldap/manual/all。

### 写动作 / 外部副作用 / batch C

- 重建组织主体：handler :15 先 `directory_sync:edit`，:26 再 `directory_sync:admin`（前端仅 admin 判断不能取代双重服务端检查）；:27 强制 Key；页面 :120 发 Key。Runtime 重建 directory_subject_exports/job/events，再 `D/console_sync_jobs.go:198` pushSubjectProjection → `D/projection.go:177` POST Platform `/api/v1/runtime/subjects/sync`，是明确外部写。失败可返回 502 且本地 job 为 partial_success(:203-208)，不能抹为全成功。
- LDAP 同步：`directory_sync:edit`、provisioning.ldapManaged 检查(:43-46)、强制 Key；页面 :160 发 Key。Runtime 排队连接器 sync_now，外部 LDAP 读取及目录刷新，异步网络副作用；页面不读/展示 bind 密码，但服务端执行会用凭据。
- handler dingtalk 分支 :36-40 返回 410，已移 People 人事事实源；其余未迁 provider 返回 503(:60)。页面不能开启新 WeCom/DingTalk/GitLab 同步或回退 Console DB。
- 没有凭据读取/揭示 UI；连接器配置和密码仍 batch C。形态 **(a，待身份适配决定)**；已有 Runtime 操作，不新增 grant/capability，保留两个不同写权限、202/410/503/partial_success。先读后写可分阶段，建议次序 6，M。

## 8. 同步详情 `console/app/pages/directory/sync/[jobCode].vue`

### 组件与 composables

Foundation usePageTitle(:8)、CommonEmptyState；Nuxt useRoute(:6)、useFetch；Vue computed、h/resolveComponent(:9)。Nuxt UI：UDashboardPanel、UDashboardNavbar、UDashboardSidebarCollapse、UAlert、UBadge、UButton、UCard、UTable。jobCode 变化重新读，refreshAll(:132) 只刷新两项 GET。

### API、数据源与授权

| METHOD + path（页面行） | Console handler：调用 / 权限 / Key | Runtime 调用及数据 |
| --- | --- | --- |
| GET `/api/v1/console/directory/sync-jobs/:jobCode`（:52） | `B/sync-jobs/[jobCode].get.ts:11`；directory_sync:view（:6）；无写 Key | `F:1591` `/v1/console/directory/sync-jobs/${encodeURIComponent(jobCode)}` as `/v1/console/${string}`；`console:directory-sync:view`；D/console_sync_jobs.go:52 directory_sync_jobs |
| GET `/api/v1/console/directory/sync-jobs/:jobCode/events?limit=200`（:57） | `B/sync-jobs/[jobCode]/events/index.get.ts:12`；directory_sync:view（:6）；无写 Key | `F:1599` `/v1/console/directory/sync-jobs/${encodeURIComponent(jobCode)}/events` as `/v1/console/${string}`；`console:directory-sync:view`；D/console_sync_jobs.go:71 directory_sync_events |


无业务写，无 Key 要求；错误/事件包含 message、externalRef、beforeHash/afterHash，不是凭据读取 API。已核 Runtime Platform 失败文本做 safeText 截断(:202)，**这不能证明全部历史事件都有秘密脱敏**，展示数据的完整脱敏覆盖 **unverified**，实施前需审查。不要将 hash 当 token。

形态 **(a，待身份适配决定)**，可抽为共用只读详情组件，detail/list paths 作为参数；Host 无现成该 job 管理查询。建议次序 1，S；可与列表读部分一起先迁，再决定同步写入口。

## 9. 工作日历 `console/app/pages/work-calendar.vue`



本页标题是“节假日管理”，不是普通用户自己的日程。`console/app/pages/work-calendar.vue:59,81` 使用 Foundation usePermissions，canEdit=system_settings:edit；同时用 usePageTitle、Nuxt useToast、Vue ref/computed/watch。依赖 Console dashboardPanelUi。Nuxt UI：UDashboardPanel、UBadge、UButton、UButtonGroup、UCard、UInput、UModal、USelect、USkeleton、USwitch、UTextarea。

设 `B=console/server/api/v1/console/work-calendars/`、`F=foundation/server/utils/consoleTenantRuntimeClient.ts`：

| METHOD + path / 页面调用 | Console handler / Runtime call site | Runtime METHOD + path、capability | 人员授权 / Key |
| --- | --- | --- | --- |
| GET /api/v1/console/work-calendars / :207 | B index.get.ts:6 / F:1846 | GET /v1/console/work-calendars；console:work-calendar:view | system_settings:view |
| GET /api/v1/console/work-calendars/:calendarCode/months?year / :220 | B [calendarCode]/months.get.ts:7 / F:1858 | GET /v1/console/work-calendars/:code/months；console:work-calendar:view | system_settings:view |
| GET /api/v1/console/work-calendars/:calendarCode/days?yearMonth / :228 | B [calendarCode]/days.get.ts:7 / F:1870 | GET /v1/console/work-calendars/:code/days；console:work-calendar:view | system_settings:view |
| POST /api/v1/console/work-calendars/import-year / :267 | B import-year.post.ts:10 / F:1892 | POST /v1/console/work-calendars/import-year；console:work-calendar:import | system_settings:edit；handler :8 强制 Key；页面 :270 发 Key |
| PATCH /api/v1/console/work-calendars/:calendarCode/days/:workDate / :301 | B [calendarCode]/days/[workDate].patch.ts:10 / F:1905 | PATCH /v1/console/work-calendars/:code/days/:date；console:work-calendar:edit | system_settings:edit；handler :8 强制 Key；页面 :306 发 Key |
| GET /api/auth/permissions / :78 loadPermissions | §10 共用权限接口 | 已验签 policy bundle，不是日历表 | 当前用户 |

所有日历业务数据来自 Console Runtime 的 work_calendars/work_calendar_months/work_calendar_days/import jobs（`data-runtime/internal/apps/console/work_calendar.go:92,125,183,226,295`）。自动导入另读取外部 holiday-calendar JSON（`data-runtime/internal/apps/console/work_calendar.go:692-693` unpkg/jsdelivr）；手工导入传入 JSON dataset。写动作：自动获取全年、手工导入全年、逐日修改 dayType/isWorkday/holidayName/remark；分别带 expectedRevision。不是只有读取。没有本页新 credential/MFA/token 输入；现有身份解析 **batch C**。

`console/server/utils/systemSettingsAccess.ts:8-23` 对 view 有 service actor fallback，scope=system_settings:view；edit 没有该 fallback。故授权不能简写“管理员”，也不能因为服务读取可用就让普通用户免 system_settings:view。



### 写动作补充、Host 与迁移

自动/手工导入全年和逐日 PATCH 都 `system_settings:edit`，handler 必须 Key、页面提供 Key，并保留 expectedRevision/冲突语义。自动导入会从外部 unpkg/jsdelivr 读取 holiday-calendar JSON，属于外部读取而非向 IM/LDAP 发写；手工导入和逐日编辑写 Runtime 日历表/receipt，未见直接外部写。服务读取 fallback 不能放宽人工编辑权限。

Host 已有 Aims 消費日历 GET，但不是管理 UI。形态 **(a，待身份适配决定)**，五个明确用户 BFF、共用日历管理组件，保留 Console `system_settings:view/edit` 与 Key，PATCH 支持需列入 Foundation 窄适配决定。无新 Runtime 操作。已按 Claude 决定从 A 移到 B；建议次序 7，M。

## 10. 间接接口、batch C 与共同停止条件

- sources/sync/committees/work-calendar 的 usePermissions → usePlatformPermission → Foundation useAuthorization（:79-80）/ 当前权限加载，Console 默认 GET `/api/auth/permissions`；handler `console/server/api/auth/permissions.get.ts:35-41` 会话/policy，Bearer 用户合同在 `console/server/api/v1/console/user/permissions.get.ts`。Host 权限展示需复用 Host 当前用户授权能力，不能将 Console app 资源误映射到 enterprise app。具体 Host 权限资源加载覆盖 **unverified**，列为实施前核对。
- 委员会 UserTreeSelector 间接调用 `foundation/app/components/UserTreeSelector.vue:156,179-186`：GET `/api/directory/departments/:deptCode/members`、GET `/api/directory/departments`、GET `/api/directory/users?pageSize=1000`、条件 GET `/api/directory/user-departments`（非 hosted 分支）。Foundation handlers 在 `foundation/server/api/directory/**`，用 directoryApi。
- 在 Console，directoryApi.ts:340-345 本地派发 `/api/v1/directory/**`。对应 `console/server/api/v1/directory/users/index.get.ts:5-6` 检查 directory_users:view，departments/index.get.ts:5-6 和 departments/[deptCode]/members.get.ts:5-8 检查 directory_departments:view，user-departments.get.ts:5-7 检查 directory_users:view；数据经 directoryRuntime → F → Runtime users/departments/关联表。委员会选择员工因此另有 directory_users:view 依赖。
- 在 Host，目录用户/部门查询使用受控 service sharing 投影，项目读取使用 project-access 投影，成员 fallback 要逐项确认现有 service 合同和完整性；不能因组件可渲染就假定管理身份链可用。选择器允许内部 GET 失败 fallback；不得将这种 UI fallback 扩成管理 API 权限失败 fallback。
- useConfirm 是本地确认 UI；usePageActions 是刷新注册；搜索/分页 helper 无隐含业务写。本报告未执行任何权限或身份探针。
- Console 的凭据/session/password/token/MFA 管理属于 **batch C**。本 B 范围没有独立 MFA 页面；明确相关的是 users 初始密码/激活和 sources 凭据。所有基础登录与 token 解析仍属于既有控制面，不能迁移时重实现。
- 将来若触及 `foundation/server/utils/notifications.ts` 或 `consoleServiceBinding.ts` 的 header/identity 逻辑、需要新 capability/grant、或需改 Console handler（除 imports），先停止并报告 Claude。B 盘点没有实现这些变更，也没有在 data-runtime/deploy/workflow 写文件。

## 11. 汇总、建议顺序与待 Claude 决定

| 建议顺序 | 页面 | 形态 | 规模 | 关键条件 |
| --- | --- | --- | --- | --- |
| 1 | sync/[jobCode] | (a，待身份适配) | S | 只读、目录同步 view；事件脱敏审查 |
| 2 | departments | (a，待身份适配) | M | 部门 edit/Key、钉钉字段归属与根公司例外 |
| 3 | projects | (a，待身份适配) | M | 成员整体替换、project edit/Key |
| 4 | committees | (a，待身份适配) | L | 9 API、成员角色、selector 的额外 users view |
| 5 | users 无凭据列表/编辑 | 拆分后 (a)；整页 (c) | M/L | 初始密码/激活/LDAP 建号留 C；People 字段归属 |
| 6 | sync | (a，待身份适配) | M | edit+admin 双检查、Platform 写、LDAP 异步操作 |
| 7 | work-calendar | (a，待身份适配) | M | system_settings 权限、PATCH/Key、外部 JSON 读取 |
| C | sources | (c) | L | 凭据元数据/轮换/LDAP bind；保留 Console |

1. **非通知用户身份转发由谁负责、合同是什么？** Step 3 正因这个停止条件暂缓；B 普通页也依赖它。需要保留验证过的 user、Console app 权限、租户 binding、明确 METHOD/path/query/body 与 Idempotency-Key，不能把 incoming raw headers 或 service token 当用户。当前不是新增业务 Runtime 操作的问题。
2. **users 是否批准拆分？** 建议 Host 先列表/普通资料编辑，Console 保留整个凭据建号流程；是否连 status 修改也继续放 Console，需确认身份生命周期边界。不要迁一个密码 modal 后再说没有凭据功能。
3. **sources 整页归 C 是否确认？** 现有 GET 有 credential 元数据，PUT 轮换秘密，测试先保存再 bind。若要 B 展示健康状态，需另评估最小投影合同，当前不存在无凭据独立页面。
4. **B 是否迁管理写入，还是先只读？** sync 的 Platform 主体重建、LDAP 同步，以及日历导入都不是普通浏览。若暂只读，写按钮应明确链接 Console，保留其权限控制与反馈。
5. **Host 菜单/路由和权限加载覆盖怎么定？** 建议 Host 自有 /enterprise 前缀，并按 directory_users/departments/projects/sources/sync 与 system_settings 分别授权。真实登录态可见性及 Host appCode 对 Console 资源加载需验证，静态层不能证明生产 grants 已具备。
6. **事件/错误的秘密脱敏需谁审查？** 未发现同步详情主动 reveal，但 message/lastErrorMessage 的历史数据完整脱敏未验证。不能靠截断代替脱敏。
7. **如选择 (b)，需单独批准新的服务合同和 grant。** 现有用户管理 Runtime operations 已足够；共享 users/departments/project-access service 查询用途不同。没有证据支持再造“通用目录管理 service API”，本次不建议。

本次交付只读盘点；无代码变更、无 inventory 提交、无数据库查询、无环境写入/重启。小修的独立提交为 `3c8ad335`，不包含本文件。

## 12. Claude 决定（2026-09-26）

1. **非通知用户身份转发**由 Claude 在 Foundation 实现：已登记路由表形式的 Console 用户 API 适配（精确 METHOD + 路径模板 + query 白名单，复用通知 helper 的已验证用户凭据规则，写操作要求并透传 Idempotency-Key，401/403/503 原样返回）。不做任意路径代理；不新增 capability/grant。本机 hzy0 的 Console 出口白名单同步登记。完成后批次 A Step 3 与批次 B 页面使用该适配。
2. **users 批准拆分**：Host 迁列表与普通资料编辑；状态变更（身份生命周期）、初始密码/激活/LDAP 建号全部留 Console，并在 Host 页给出明确入口。
3. **sources 整页归 batch C**，确认。
4. **先只读、后写入**：B1 六个目录页（users、departments、projects、committees、sync、sync/[jobCode]）先迁读取视图，写按钮链接回 Console；B2 再逐页迁 departments/projects/committees 写入。sync 的触发与 Platform 写入、工作日历导入与编辑暂留 Console。
5. **路由**：`/enterprise/directory/{users,departments,projects,committees,sync,sync/:jobCode}`、`/enterprise/work-calendar`。服务端授权以 Console handler 为准，Host 页面对 403 显示无权限空状态；导航可见性在 Console manifest 组合入 Host 后再接，不在 Host 手写权限表。
6. **同步事件脱敏**：实施 sync 详情时由 Claude 审查 message/lastErrorMessage 的来源与脱敏，未审查前不迁该页。
7. 不选 (b)：不新建目录管理 service API。

## 13. 目录同步脱敏审查结论（Claude，2026-09-26）

- 来源：`directory_sync_jobs.error_message` 与 `directory_sync_events.message` 由 Runtime 写入原始 Go 错误文本（`safeText` 仅去换行并截断到 1000 字），可能包含 Platform 响应正文（`data-runtime/internal/apps/directory/projection.go:199`）、Go 网络错误中的完整 URL、连接器/LDAP 诊断。未见凭据，但有内部地址与诊断细节。
- Host 规则：同步列表与详情的 Host BFF **不透传** `errorMessage`、事件 `message` 原文；只返回状态、计数、时间、对象类型/编码与固定的失败类别（例如「Platform 同步失败」「连接器同步失败」「同步失败」），并给出「在控制台查看详情」链接（Console 原页面保持现状，仍受 directory_sync 权限约束）。类别由 BFF 按已知前缀映射，未知一律归「同步失败」，不做正则删改原文。
- 后续（Runtime，另排）：写入时对 URL/主机名做脱敏，之后可再评估 Host 是否显示经脱敏的摘要。
- 同步触发、Platform 主体重建与 LDAP 异步操作仍留 Console。

## 14. B2 部门写入实施与已知限制（2026-09-26）

Claude 已批准 B2 三组依序实施。首组部门迁移创建 POST、差量修改 PATCH、删除 DELETE，权限仍由 Console directory_departments:edit 判定；已有 Host 页/路径不变，列表 BFF 复用 Console 授权快照投影 canEdit，写入仍逐请求判权。共享 DirectoryDepartmentEditor 用于 Console 与 Host；稳定幂等意图、结果未确认的原请求重试、删除确认、写成功与刷新失败分离。

MVP 接受无 CAS：没有 revision/expectedRevision/If-Match，事务锁不防止陈旧表单覆盖；只发变化字段降低无关覆盖，同字段后写仍覆盖。未修改 Runtime 实现、handler、grants、身份 helper 或目录同步触发；项目/委员会写入仍待后续各组。

## 15. B2 项目写入实施与已知限制（2026-09-26）

第二组迁入项目创建、差量 PATCH、删除及成员全量替换，精确四条 write:true 登记；Console directory_projects:edit 始终是写授权边界。Host 列表只投影 gated Console canEdit，缺权/错误关闭写入口，Console/Host 共用 DirectoryProjectEditor。成员完整独立 GET（最多100）成功才允许 warning 确认替换，空列表也明确确认；删除 danger 含项目名称与不可恢复后果。

MVP 接受无 CAS：字段与成员整套均可能被后写覆盖；差量提交减少无关字段覆盖，稳定幂等键防重复执行，不提供陈旧表单保护。无乐观写入，失败保留草稿/原成员，未知结果同请求同键重试；成功后 GET 刷新失败只提示“已保存，刷新失败”。项目 mutation 使用 directory_projects/directory_project_members、operation_logs 与既有回执事务，本轮未改 Runtime、Console handlers、grants、身份 helper、目录同步或导航。委员会写入等待下一组。

## 16. B2 委员会写入实施与已知限制（2026-09-26）

第三组精确六项创建/差量修改/删除委员会与增量添加、单成员角色upsert、移除。Console/Host共享DirectoryCommitteeEditor，沿用directory_departments:edit；Host列表canEdit仅来自gated Console快照，写后台每次由Console判权。主任/秘书不通过组织表单写入；增员1..100、不重复、单次最多一主任一秘书。删除danger含名称与先移除成员/不可恢复后果；移除warning含成员/委员会名称。

失败保留草稿、添加候选、原角色与原成员，不做乐观更新；成功读回成员及列表、刷新主任/秘书和计数、空末页回退。稳定同意图键与未知结果原请求重试，写成功后刷新失败只重试GET。MVP无CAS与成员PATCH现有upsert语义为已知限制，不检测陈旧表单；未改Console handlers、Runtime实现、grants、身份helper、目录同步/日历写流程或导航。B2三个组织组的13项写路由均已实施，真实登录/view/edit/窄屏与原Console写流程验收由Claude/Codex-sol安排。
