# Enterprise 产品页面 API 接线清单

2026-09-13。Host API 前缀 `/aims/api`。本清单不是全部接口已就绪声明。

## 当前主链

已接产品当前目录/空间、接入候选与接入、需求及轻量版本计划主链。授权事实仅由 BFF 获取，再经 Console 人员权限判断；Runtime 继续执行实际对象范围和事务校验。下表按当前 handler 与已取得的专项证据更新，未注册者仍待接；代码验收不等于目标环境已上线。

## Host BFF 就绪表（代码登记，不代表环境已上线）

以 `enterprise/server/middleware/01-business-api.ts` 当前放行清单为证据，`:p` 为产品编码、`:r` 为需求 bizId。

| API / 方法 | 当前状态 | 页面影响 |
|---|---|---|
| GET `/api/v1/products/:p/permissions` | 已接 | 产品空间操作权限 |
| GET `/api/v1/products/:p/requests/permissions` | 已接 | 需求创建/编辑等按钮权限 |
| GET `/api/v1/products/:p/versions/permissions` | 已接 | 版本操作权限 |
| GET / POST `/api/v1/products/:p/requests` | 已接 | 列表/筛选/分页/新建 |
| GET `/api/v1/products/:p/requests/:r` | 已接 | 详情、合并轨迹基础读取 |
| GET `/api/v1/products` | 已接，真实 HTTP/MySQL 验证通过 | 当前目录、顶栏产品切换、名称/产品线 |
| GET `/api/v1/product-candidates`；POST `/api/v1/products` | 已接，真实 HTTP/MySQL 与 H3 验证通过 | 产品/产品线接入、当前候选及水印 |
| GET `/api/v1/products/:p` | 已接，真实 HTTP/MySQL 验证通过 | 空间当前信息；其他概览计数仍见下方 |
| GET `/:p/components` | 已接，真实HTTP/MySQL与H3验证根/子节点、跨产品父节点拒绝和权限 | 需求和计划模块选择器 |
| PATCH `/:p/requests/:r`；POST `/:r/decision` | 已接（外部反馈绑定见下方限制） | 编辑/决策 |
| POST `/:p/requests/:r/merge` | 已接，真实 HTTP/MySQL 与 H3 验证通过；外发验收见下方 | 合并及来源证据保留 |
| GET / POST / DELETE `/:p/requests/:r/sources[/:sourceId]` | 已接 | 来源列表/手工来源增删 |
| GET / POST `/:p/planning-items`、GET/PATCH `/:itemId`、GET `/permissions` | 待接 | 高级规划列表/详情/编辑，需求转规划 |
| POST `/:p/versions` | 已接，真实 HTTP/MySQL 与 H3 验证通过 | 版本创建 |
| GET `/:p/versions`；GET `/:p/versions/:versionId` | 已接，真实 HTTP/MySQL 与 H3 验证通过 | 版本列表/详情 |
| PATCH/DELETE `/:p/versions/:versionId` | 待接 | 版本编辑/删除 |
| POST `/:p/versions/:versionId/{transition,reopen,archive}` | 待接 | 版本生命周期 |
| PATCH `/:p/versions/:versionId/plan`；POST/PATCH/DELETE `/plan/items[/:scopeId]` | 已接，真实 HTTP/MySQL 与 H3 验证通过 | 轻量计划/范围写入 |
| GET `/:p/versions/:versionId/plan`；GET `/plan/items` | 已接，真实 HTTP/MySQL 与 H3 验证通过 | 轻量计划/范围读取 |
| POST `/:p/versions/:versionId/plan/confirm` | 已接，真实 HTTP/MySQL 与 H3 验证通过 | 计划确认 |
| GET `/:p/{features,objectives,roadmaps/adoption}` | 待接 | 概览计数，失败显示未知 |

除第一列完整 `/api` 路径外，其他相对 `/:p` 均在 `/api/v1/products` 下。新增目录接口在 Assets module，不把其响应伪装成 Aims 空间响应。Host 未登记的接口统一明确 503。

## 显式页面

`/aims/products/:productCode`、`requests`、`planning`、`versions`、`versions/:versionId`、`versions/:versionId/plan`。工作台和版本工作流壳采用嵌套路由。现有导航中的其他页面保留原路径并加模块前缀，尚未挂载的页面需后续组合。

## 逐源码调用清单

动态 base 后缀需结合所在源码阅读；以下保留实际调用形态，供 API 接线核对。

### `aims/app/components/products/ComponentPicker.vue`

```ts
const { data, status, error, refresh } = useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/components`), { /* Host session-scoped key; see source */
```

### `aims/app/components/products/Navbar.vue`

```ts
const response = await $fetch<{ code: number, data: { items: SwitcherProduct[], total: number } }>(moduleUrl('/api/v1/products'), {
```

### `aims/app/components/products/PlanningItemDetail.vue`

```ts
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items/${props.itemId}`), { /* Host session-scoped key; see source */
```

### `aims/app/components/products/PlanningItemEditor.vue`

```ts
const result = await $fetch<{ code: number, data: ProductPlanningDetail }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items/${props.itemId}`), { signal: controller.signal, timeout: 15000 })
const response = await $fetch<{ code: number, data: ProductRequestRecord }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${source.biz_id}`), { signal: controller.signal, timeout: 15000 })
```

### `aims/app/components/products/PlanningItemForm.vue`

```ts
const result = await $fetch<{ code: number }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items${props.item ? `/${props.item.biz_id}` : ''}`), { method: props.item ? 'PATCH' : 'POST', body, headers: { 'Idempotency-Key': retry.key } })
```

### `aims/app/components/products/PlanningRequestPicker.vue`

```ts
const { data, status, error, execute } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests`), { /* Host session-scoped key; see source */
```

### `aims/app/components/products/RequestDecisionForm.vue`

```ts
const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.request.biz_id}/decision`), { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
```

### `aims/app/components/products/RequestForm.vue`

```ts
const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests${props.request ? `/${props.request.biz_id}` : ''}`), {
```

### `aims/app/components/products/RequestMergeForm.vue`

```ts
const { data, status, error } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests`), { /* Host session-scoped key; see source */
const endpoint = moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.request.biz_id}/merge`)
const result = await $fetch<{ code: number }>(endpoint, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
```

### `aims/app/components/products/RequestMergeTrail.vue`

```ts
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.requestId}`), { /* Host session-scoped key; see source */
```

### `aims/app/components/products/RequestMergedSources.vue`

```ts
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests`), { /* Host session-scoped key; see source */
```

### `aims/app/components/products/RequestSourceForm.vue`

```ts
const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.request.biz_id}/sources`), { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
```

### `aims/app/components/products/RequestSourceList.vue`

```ts
const endpoint = moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.requestId}/sources/${target.source.id}`)
const response = await $fetch<{ code: number }>(endpoint, { method: 'DELETE', body, headers: { 'Idempotency-Key': retry.key } })
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.requestId}/sources`), { /* Host session-scoped key; see source */
```

### `aims/app/components/products/VersionDevelopmentAction.vue`

```ts
const response = await $fetch<{ code: number, data: { value: { version_id: number, product_code: string, status: string } } }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${props.version.id}/transition`), { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
```

### `aims/app/components/products/VersionPicker.vue`

```ts
const { data, status, error, refresh } = useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/versions`), { /* Host session-scoped key; see source */
```

### `aims/app/components/products/VersionTools.vue`

```ts
const base = computed(() => moduleUrl(`/products/${encodeURIComponent(props.productCode)}`))
```

### `aims/app/components/products/VersionWorkflowNav.vue`

```ts
const base = computed(() => moduleUrl(`/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}`))
const { data: mode, error: modeError, refresh, status } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}`), {
```

### `aims/app/composables/useProductWorkspace.ts`

```ts
const response = await $fetch<{ code: number, data: ProductWorkspace }, string>(moduleUrl(`/api/v1/products/${encodeURIComponent(product)}`), { timeout: 30000 })
const response = await $fetch<{ code: number, data: ProductWorkspacePermissions }, string>(moduleUrl(`/api/v1/products/${encodeURIComponent(product)}/permissions`), { timeout: 30000 })
```

### `aims/app/pages/products/[productCode].vue`

```ts
const base = productBasePath(code.value)
```

### `aims/app/pages/products/[productCode]/index.vue`

```ts
const base = moduleUrl(`/api/v1/products/${encodeURIComponent(productCode)}`)
const response = await $fetch<{ code: number, data: Record<string, unknown> }>(`${base}${path}`, { query, timeout: 15000 })
```

### `aims/app/pages/products/[productCode]/planning.vue`

```ts
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/planning-items`), { /* Host session-scoped key; see source */
const { data: permissions, status: permissionStatus, error: permissionError, refresh: refreshPermissions } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/planning-items/permissions`), { /* Host session-scoped key; see source */
```

### `aims/app/pages/products/[productCode]/requests.vue`

```ts
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/requests`), { /* Host session-scoped key; see source */
const { data: permissions, status: permissionStatus, error: permissionError, refresh: refreshPermissions } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/requests/permissions`), { /* Host session-scoped key; see source */
const { data: planningPermissions, status: planningPermissionStatus, error: planningPermissionError, refresh: refreshPlanningPermissions } = await useFetch<{ code: number, data: { product_code: string, status: string, edit: boolean } }>(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/planning-items/permissions`), { /* Host session-scoped key; see source */
```

### `aims/app/pages/products/[productCode]/versions/[versionId]/index.vue`

```ts
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/versions`))
const { data, status, error, refresh } = await useFetch(endpoint, { /* Host session-scoped key; see source */
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, edit: boolean, reopen: boolean, archive: boolean, delete: boolean } }>(() => `${base.value}/permissions`, { /* Host session-scoped key; see source */
const response = await $fetch<{ code: number, data: { value: { version_id: number, release_record_id: number, status: string } } }>(`${endpoint.value}/reopen`, { method: 'POST', body, headers: { 'Idempotency-Key': reopenRetry.key } })
const response = await $fetch<{ code: number, data: { value: { version_id: number, product_code: string, status: string } } }>(`${endpoint.value}/archive`, { method: 'POST', body, headers: { 'Idempotency-Key': archiveRetry.key } })
const response = await $fetch<{ code: number, data: { value: { version_id: number, product_code: string, deleted: boolean } } }>(endpoint.value, { method: 'DELETE', body, headers: { 'Idempotency-Key': deletionRetry.key } })
const response = await $fetch<{ code: number }>(endpoint.value, { method: 'PATCH', body, headers: { 'Idempotency-Key': retry.key } })
```

### `aims/app/pages/products/[productCode]/versions/[versionId]/plan.vue`

```ts
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(versionId.value)}`))
const { data: version } = await useFetch(() => base.value, { /* Host session-scoped key; see source */
const { data: plan, status: planStatus, error: planError, refresh: refreshPlan } = await useFetch(planQuery, { /* Host session-scoped key; see source */
const { data: scopes, status: scopesStatus, error: scopesError, refresh: refreshScopes } = await useFetch(() => `${base.value}/plan/items`, { /* Host session-scoped key; see source */
const { data: candidates, status: candidatesStatus, error: candidatesError, refresh: refreshCandidates } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/requests`), { /* Host session-scoped key; see source */
const response = await $fetch<{ code: number }>(`${base.value}/plan`, { method: 'PATCH', body, headers: { 'Idempotency-Key': mutationKey(body) } })
const response = await $fetch<{ code: number }>(`${base.value}/plan/items`, { method: 'POST', body, headers: { 'Idempotency-Key': mutationKey(body) } })
const response = await $fetch<{ code: number }>(`${base.value}/plan/items/${selectedScope.value.id}`, { method: 'PATCH', body, headers: { 'Idempotency-Key': mutationKey(body) } })
const response = await $fetch<{ code: number }>(`${base.value}/plan/items/${item.id}`, { method: 'DELETE', body, headers: { 'Idempotency-Key': mutationKey(body) } })
const response = await $fetch<{ code: number }>(`${base.value}/plan/confirm`, { method: 'POST', body, headers: { 'Idempotency-Key': mutationKey(body) } })
const response = await $fetch<{ code: number, data: ProductRequestRecord }>(moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/requests/${encodeURIComponent(requestBizId)}`))
```

### `aims/app/pages/products/[productCode]/versions/index.vue`

```ts
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/versions`))
const { data, status, error, refresh } = await useFetch(base, { /* Host session-scoped key; see source */
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, edit: boolean, revision: number } }>(() => `${base.value}/permissions`, { /* Host session-scoped key; see source */
const response = await $fetch<{ code: number, data?: { value?: { id?: number, version_id?: number } } }>(base.value, { method: 'POST', body: { ...body, planningMode: 'simple' }, headers: { 'Idempotency-Key': retry.key } })
```

## 缓存与验收边界

Host fetch key 使用真实会话范围、逻辑模块、调用点和 URL；standalone 保留默认 key。手工 async-data key 同样隔离。

登录业务验收依赖 Enterprise OIDC、Runtime binding 和实际 Console 人员权限。构建与未登录页面验证不能替代业务链完成证据。

2026-09-13 本地 Chrome 实测 `/aims/products/P-A/requests` 被真实会话中间件送往 Console 登录页（target_app=enterprise，并保留完整 redirect）。当前无可用 Enterprise 登录会话，未绕过鉴权，因此尚不能报告业务页面视觉/操作验收通过。

版本/计划读取使用固定 `aims:product-versions:read` capability，版本 `view` permit 上限15秒；plan及items额外要求需求 `view` permit。Runtime持久generation guard与请求事务负责拒绝旧代次。浏览器未获得直接授权事实接口。

## 需求动作补充验收

编辑、决策、来源读取及手工来源增删复用原领域命令。Runtime真实HTTP/MySQL验证四个写动作重放、来源audit晚失败回滚及列表不写入；H3验证原字段校验、人员权限、固定capability及幂等键。浏览器不能提交source_app伪造正式外部来源。

决策沿用原Altoc反馈outbox逻辑。统一域尚需绑定实际Aims outbox owner/deployment与受管表；缺少可信上下文时，有外部反馈绑定的需求应拒绝并回滚，不能把普通需求成功扩大解释为全部反馈联动已就绪。合并需求尚未注册Host/Runtime接口。

## 产品接入 HTTP/BFF 增量（2026-09-13）

Host 已挂载 `GET /aims/api/v1/product-candidates` 与 `POST /aims/api/v1/products`，覆盖单产品和产品线接入。复用 Aims 原输入解析、明确的全租户 `products:onboard` 权限、Directory 负责人有效状态检查及幂等键。独立 Aims 入口仍走原目录与 Runtime；Host 通过服务器注入的桥接调用固定 Enterprise operation。

Runtime 固定五个 POST：`product-onboard:candidates`、`product-onboard:candidate`、`product-line-onboard:candidates`、`product-onboard`、`product-line-onboard`（均位于 `/v1/enterprise/aims/`）。所有入口要求真实 Host 服务 JWT、实时服务凭据/精确 `aims:products:onboard` capability、签名 actor，以及 15 秒以内、绑定主体和租户/部署的 onboarding 与 Assets 查看授权。产品来源不接受 HTTP 提供，事务内读取当前 Assets。候选分页水印为 `current-assets-page:v1:<hash>`，整线确认使用 `current-assets:v1:<hash>`；只有 Host 的显式桥接接受新整线水印，原独立入口格式保持不变。

验证：真实 H3 请求执行原解析/权限/目录校验与固定 transport；Foundation 30 项精确 transport 测试通过；Aims 与 Host typecheck 通过。`node data-runtime/scripts/test-enterprise-onboarding-http-mysql.mjs` 使用隔离 MySQL、实际签名 JWT/actor、Console 凭据及受管视图，覆盖候选可见范围、单产品及整线接入/重放、异 payload 409、伪造/超时 permit、late audit 全事务回滚、服务授权撤销和 generation 变化。此证据不等于已部署后的 OIDC 浏览器验收；未发布。

## 产品模块维护增量（2026-09-13）

Host 显式挂载原 `/aims/products/:productCode/structure` 页面及模块树、模块管理、移动表单，保留原布局和操作。API/站内链接经过 `useAimsModule`，模块树每层缓存键包含真实会话范围、模块、产品与父节点，避免不同层级复用同一缓存。功能目录列表/详情尚未完成的接口仍返回明确未就绪错误，不影响独立的“管理模块”入口；本次不宣称整个功能目录已可用。

| 原页面动作 | Host API | Runtime /v1/enterprise/aims/ 下的固定 POST | 人员权限 / 服务 capability |
| --- | --- | --- | --- |
| 创建模块 | POST products/:p/components | components:create | product_components:edit / aims:product-components:create |
| 编辑模块 | POST products/:p/components/:id/edit | components:edit | product_components:edit / aims:product-components:edit |
| 移动模块 | POST products/:p/components/:id/move | components:move | product_components:edit / aims:product-components:move |
| 删除模块 | DELETE products/:p/components/:id | components:delete | product_components:delete / aims:product-components:delete |
| 查看操作权限 | GET products/:p/components/permissions | 复用已验签 actor 的 product-authorization 与真实 Console 权限 | product_components:view；独立判定 edit/delete |

四命令沿用 Aims `handleProductComponent` 的路径/字段/幂等校验及产品对象授权，Runtime 复用 ComponentService 与原拥有方状态机。构造时验证 8 张受管视图：product_workspaces、product_members、product_command_receipts、product_activity_logs、product_components、product_component_sources、product_features、product_requests。测试覆盖真实签名 HTTP、当前服务权限、创建/编辑/移动/删除、同键重放、异 payload 冲突、树环拒绝、late audit 回滚、actor/permit/generation 拒绝；脚本为 `node data-runtime/scripts/test-enterprise-components-http-mysql.mjs`。H3 原校验/权限/Host transport 与 Foundation 34 项精确 transport 测试通过。两个 readiness JSON 只更新计划 capability 目录，不授予实际权限；preflight 5 项测试通过。


## 功能目录完整依赖增量（2026-09-13）

Host 显式组合功能详情及现有需求关联、生命周期、只读路线图页面。页面与模块归类表单复用 Aims 源码；API 和站内链接使用受控 moduleUrl，fetch/async-data 缓存包含实际企业会话范围、产品、功能和调用点。结构页继续通过需求整理新想法，没有新增高级规划流程；路线图中的高级规划事项详情在 Host 显示为普通标题，standalone 原链接保留。

新增固定 Runtime `features:list/view/create/edit/delete/component-assign/lifecycle/request-list/request-link/roadmap/unscheduled/cycles`，Host 保留原 URL 和参数格式。cycles 仅提供现有路线图选择器所需读取。FeatureService 验证 20 张受管视图，通过 Registry generation guard 和 owning-domain InTransaction 执行，独立 Aims 入口仍复用同一状态机。功能生命周期保留负责人及真实发布证据或明确历史能力证据要求；关联需求独立检查需求 edit 和功能 view，反馈沿用受信 OutboundSource，不接受浏览器 source。

验证入口：`node data-runtime/scripts/test-enterprise-features-http-mysql.mjs`、`node --test enterprise/test/feature-bridge.test.mjs`、`pnpm --dir foundation exec tsx --test test/enterpriseRuntimeClient.test.ts`。真实 MySQL 与 HTTP 覆盖创建/编辑/归类/删除、生命周期、需求关联、列表/详情/周期/路线图、幂等重放及异 payload 409、无资格/过期/错主体许可拒绝、实时服务 grant 撤销、generation 失效及 late audit 503 全事务回滚。H3 执行真实原参数解析和双权限校验；Foundation 46 项 transport、注册/路径及 H3 共 8 项、preflight 5 项通过，Aims/Host typecheck 通过。两份 readiness 计划目录同步到 30 个唯一 exact capability，实际环境授权与 OIDC 浏览器验收另由部署流程完成。本包未部署。

## 版本验收与发布 Runtime 回归（2026-09-13）

`node data-runtime/scripts/test-enterprise-version-release-http-mysql.mjs` 实际执行签名服务 JWT、Console 当前凭据/grant、签名 actor、Registry 受管视图与拥有方领域事务。完整 canonical Aims DDL 的隔离 MySQL fixture 通过 preview → accept → publish；缺少 execution_review_hash 为 400，过期哈希及工作项内容变更为 409，非当前业务负责人验收和验收人自己发布均拒绝。验收与发布的审计晚失败均为脱敏 503，验收记录、发布记录、回执及反馈事件没有部分提交；同键重放不新增记录。

测试主动删除四张旧名 Outbox view，正式发布仍只写 Registry 映射的物理 integration_operation，且保留 tenant-a / aims-test / aims 来源。执行项目事实读取仅允许版本目标真实关联项目，关联项目读取成功，无关项目为 404；预览不产生业务回执或审计。实时 grant 撤销为 403，持久 generation 改变为 503。最终测试通过并清理临时 MySQL；这是 Runtime 领域与 HTTP 证据，不替代 Host 人员项目范围检查或真实 OIDC 浏览器验收。

## 验收与发布历史只读增量（2026-09-13）

Host 挂载原 `versions/:versionId/acceptances`、`acceptances/:acceptanceId`、`releases`、`releases/:recordId` 页面，复用原解析、人员版本 view 权限和响应格式。API/链接最终生成时应用逻辑模块前缀，缓存由真实会话范围、页面和路由标识隔离。Runtime 固定 `product-version:acceptance-list/acceptance-view/release-list/release-view` 四路由，统一要求 `aims:product-versions:read`、15 秒 view permit、真实 actor 与持久 generation guard。

原四个查询提取 InTransaction，版本/工作空间归档后仍可读取。验收详情只返回原人工核验与例外，发布详情从原不可变快照及 hash 投影，不能用当前范围替换历史，也不额外返回执行项目明细。跨版本记录 ID 保留旧 mapper 的 400 和明确 not_found 错误，不返回其他版本内容。

`test-enterprise-version-release-http-mysql.mjs` 现同时验证四类历史读取：真实发布生成历史、分页 count 与第二页空结果、当前范围修改不影响历史内容、归档后读取、跨版本 ID 拒绝、错 actor 拒绝、读不写 audit/receipt，以及 generation 失效。最终 race 测试通过，临时 MySQL 清理。新增 `enterprise/test/version-history-bridge.test.mjs` 执行真实 H3 解析/产品范围/固定读 transport，连同注册测试 6 项通过；Foundation transport 50 项、Aims/Host typecheck 及目标 UI lint 通过。未部署，实际 OIDC 页面验收另行记录。

## 轻量版本项目承接与执行汇总（2026-09-13）

版本计划现有承接入口挂载 `/aims/products/:productCode/planning-items/:itemId/handoff?versionId=…&scopeId=…`。复用原创建草稿/关联已有项目需求表单、幂等输入、规划详情与权限接口，Host 返回链接指向已组合的 `plan#version-scope`。项目选择与已有需求选择使用专用 `handoff/projects`、`handoff/requirements` 读取，不开放通用项目或需求目录。Runtime 只扫描当前产品关联、启用中的产品研发项目；Host 用 Console 当前项目 view 或 requirements view 判断后分页并计算可见总数，内部授权事实不会返回浏览器。

Runtime 固定 `handoff:detail/projects/requirements/project-authorization/create`。所有读取要求产品 priorities:view，候选和项目事实使用 exact `aims:product-priorities:project-authorization`；最终承接使用 exact `aims:product-priorities:handoff`，并独立保留产品 priorities:handoff、来源 requests:handoff、versions:view、目标 requirements:edit。15秒许可、actor/tenant/deployment、当前产品根与项目成员事实在服务端核验；数据库事务复用已有 LightweightHandoffService 与 owning callbacks，只接受已确认的 simple 版本范围。创建真实 requirement_items/contents、来源交付链接、回执和审计同事务；没有引入高级周期写入或新的外部反馈状态机，后续发布仍沿用原来源关系和反馈 Outbox。

`execution-coordination` 页面与只读 Runtime `product-version:execution-coordination` 已组合。执行事实复用原版本预览和汇总逻辑，读取受持久 generation guard 保护；Host 对每个项目分别判断 projects:view 与 work_items:view，再按原规则过滤项目明细。Host 当前不组合项目工作项完整页面，汇总中的项目显示为普通文本，standalone 原链接保留。

验证：`test-enterprise-handoff-http-mysql.mjs` 使用完整 canonical MySQL DDL、真实 JWT/actor/Console grant，覆盖实际草稿创建、已有需求关联、重复关系409、重放不重复、无绑定项目拒绝、产品/项目/来源/版本许可拒绝、审计晚失败503全回滚和generation拒绝；项目事实预检也重新校验当前产品revision。`test-enterprise-version-release-http-mysql.mjs` 补充实际执行汇总读取。`enterprise/test/handoff-bridge.test.mjs` 覆盖原输入校验、四个独立写权限、候选过滤后分页计数、隐藏需求拒绝及projects/work_items明细过滤。Foundation 56项、注册及preflight 10项通过，Aims/Host typecheck通过。

计划 capability 目录为34项，本包新增 priorities:handoff 和 priorities:project-authorization；先前32项实际OAuth证据不覆盖这两项，环境登记和探测由后续发布流程记录。本地HTTP与MySQL证据不代表已发布或完成实际OIDC页面操作验收。

## INT-503 主档起点审计（2026-09-13，本地链已接，环境验收待完成）

接线前的阻断是不能把“产品目录可读”等同“主档维护可用”：当时 `assets/layer/entry.mjs` 仅注册产品列表；`ProductAssetsListPage.vue` 实际调用 `/assets/api/v1/products` 与并列技术底座列表，但 Host 原先只实现 `/assets/api/v1/product-directory`。新增弹窗的 POST products、详情页及 PATCH products 都缺组合入口。这是“主档维护→接入”之前最先阻断完整链的位置。

产品线权威分类来自 Assets `asset_category_groups` 中 `category_scope='product'`：`runtime_catalog.go` 在主档查询 JOIN 该表，`useAssetDictionaries` 从受管分类覆盖 `product_line` 选项；`adapter.go` 拒绝通过通用 dictionary 更新受管类别。不能另建产品线表，也不能把 Console 通用字典误认为这条主档产品线的事实源。分类新增/改名须复用原分类管理权限与领域命令。

最小主档组合应覆盖列表筛选与分页、详情、创建、编辑、字典/分类实际读取，保留创建后以及修改前后对象范围检查。产品详情关联底座/资源/文档/交付实例沿用原真实只读投影；这些关联写与技术底座独立工作流不属于此次试点起点，不应以跳转旧 Worker 代替完成。技术底座列表是原列表并列标签，不是产品新增表单的必要依赖，Host 应只暴露已接通标签。

主档统一写采用 Assets 自域 `service_command_receipt` 受管物理映射，未使用 Aims 回执表。升级前须在 Assets 源库应用 `assets/docs/migrations/20260913_assets_owned_product_receipts.sql`，随后重新生成 source plan/hash 和 final copy；不能复制此前仍拒绝同域命令的旧 CHECK。该迁移为单条 ALTER，重复执行重新建立相同约束；跨域分支保持，额外只允许固定产品 create/edit、产品线 save 的同域 Assets 命令、相同逻辑部署、非空原操作人及对应 exact capability/schema。新运行时检测旧约束会返回明确 503，不把 schema 未就绪报为成功。

不可在已有同域回执时直接恢复旧 CHECK：旧约束会拒绝已有合法同域记录。回滚应先冻结写入、保留回执与业务数据，使用兼容新约束的先前读取制品；不得删除回执来让 DDL 回滚通过。实际数据迁移、升级及回滚执行由发布流程单独记录，本地代码不代表这些步骤已经执行。

### 主档与分类当前源码边界

Host 已注册 `/assets/products`、`/assets/products/:id`、`/assets/admin/asset-categories`。产品主档 list/detail/create/edit、真实字典、产品线读取/新增/编辑均复用原 Assets 领域；分类仍要求原 `admin:admin`，普通 `products:edit` 不能替代。页面实际错误会展示，不能把权限拒绝或依赖失败呈现成空目录。产品线管理保存后刷新同会话字典缓存。

原页面差异明确保留：Host 技术底座标签和新增底座显示“尚未组合”并禁用；详情的底座/资源/文档关联写现已按下节接入；底座/资源候选及关联投影独立过滤当前目标 scope，文档由 Codocs 校验当前 ACL。原独立 Assets 页面保留这些操作。Host 详情不请求旧跨 Worker 版本摘要，提示在产品中心查看，并提供已组合的产品中心入口；完整原 Assets 功能未因此宣告完成。

`node deploy/test-env/generate-enterprise-candidates.mjs <actual-source-plan.json> <output-directory>` 是唯一可复用的组合视图候选生成命令。它不连接数据库或执行 SQL；校验实际 plan 的 ReviewHash，从 plan.Tables 读取列、来源与物理映射，直接复用各服务构造器的导出 view 集合，禁止为 system_parameters/service_command_receipt 建裸名 view。输出显式 installed=false、targetVerified=false、businessMigrationApplied=false，并记录源文件 SHA-256；缺失受管表或不合法映射失败，不按源码猜列。Assets owned CHECK 迁移和实际源 plan 均需先齐备；主档收件回执仅依赖真实 service_command_receipt 物理映射，不为未调用的外发调度表制造依赖，才能生成可审查候选；候选本身不构成环境验收。


本包验证：真实 HTTP + 临时 MySQL 的新→旧/旧→新主档重放、编辑重放、产品线新→旧重放、不同 payload 冲突、晚审计失败与业务/回执同回滚、实时凭据撤销、tenant/scope/generation 拒绝均通过；`NOT ENFORCED` CHECK 必须503且无写，恢复 ENFORCED 后正常。移除未使用的三张 Assets 外发映射后同一完整回归仍通过（2.493s），证明主档只依赖自己的 receipt。H3 复用生产 BFF/Foundation/Assets scope-core，主档和 admin 分类权限/幂等键及依赖503通过；Foundation固定 transport 64项、Assets/Host typecheck、目标UI lint通过。

候选生成使用更新后的真实源 plan `5e1319163c3fca7111d93784dec3efb934b1f1394cd4eec51d6a447fefe99afa`，得到 Aims 44 + Assets 11 = 55个视图，零静态缺项；source metadata、disabled Runtime candidate 与10文件 preparation inventory 已同步，后者仍 `businessMigrationApplied:false`。这是文件级证据，不等于视图已安装、业务已迁移或实际浏览器完成试点验收。


## 产品关联写与独立目标授权（2026-09-13，本地就绪）

原产品详情三个弹窗已恢复 Host 可达：`POST /assets/api/v1/products/:id/bases|assets|documents`。底座及资源候选分别使用限定用途的 `GET /assets/api/v1/products/link-candidates/bases|assets`，只返回已授权的 ID/名称/类型/状态，不把独立技术底座全模块页视为已组合。三弹窗保持原字段，使用受控模块 URL；相同输入重试保留 Idempotency-Key，输入改变生成新键。原 Assets 页面保留原 URL。

Runtime 固定 `products:link-base|link-asset|link-document|base-candidates|asset-candidates`，写使用现有 `assets:product:edit`，候选使用 `assets:product:read`。服务 capability 不替代人员许可：产品 edit 与目标 technology_bases:view / asset_items:view 分别由 Console 全有效授权编译，再以 15 秒 actor/tenant/deployment/resource 绑定许可传递。原 owning SQL 提取 `LinkProduct*InTransaction`，在同一事务锁定并重查产品、目标范围，复用原关系插入与 asset_events；不存在另一套 SQL 状态机。重放也重新检查当前目标许可。

Host 产品 list/detail 同时传递目标读取 scope，缺目标权限返回零目标投影；独立 owner/department/project 约束保留。关联 JOIN、asset_count/base_count 与候选过滤均不因产品可见而扩大目标范围。文档列表在返回浏览器前逐条通过 Codocs 当前 ACL，403/404 隐藏该引用，依赖失败不伪装为空结果。交付实例与技术底座完整独立页面仍按既有未组合范围管理，此包不宣告所有 Assets 工作流完成。

文档写先在统一 Runtime 读取当前产品编码，再调用真实 Codocs metadata 服务检查 actor ACL，最后带短效 product ID/code/UUID/actor 证明提交。Host 物理身份为 enterprise/enterprise.runtime；旧 Assets 是 assets/assets.runtime。两者保留原 `assets.codocs.product-document.read.v1` operation、`codocs:product-document:read` capability 和独立 `aud=codocs`，不伪称旧 Worker 来源，也不将 Codocs capability 塞进 data-runtime 的 36 项 service allowlist。接收方精确来源、签名及 ACL 合同见 MODULE_CONTRACTS。

幂等仍使用 Assets 唯一 owning receipt 物理映射及稳定逻辑 Assets deployment，实际 caller 保留在审计身份。短效授权、签名和证明不进入业务 hash。增量 DDL 为 `assets/docs/migrations/20260914_assets_owned_product_link_receipts.sql`，旧已应用 `20260913_assets_owned_product_receipts.sql` 字节未改。新 DDL 只额外允许三个固定 link operation 与 product:edit，保留原跨域及原三个 owning command 规则；未应用时关联写503，原主档命令仍可用。已有 link receipt 后不能直接恢复旧 CHECK。正式源迁移、重新采集 source plan/hash、候选冻结及环境部署由发布流程执行，本包未操作环境。

验证：扩展 `test-enterprise-assets-products-mysql.mjs` 真实 JWT/current grant/actor/Registry/物理表 MySQL 回归通过（race 2.688s），覆盖新→旧及旧→新 link replay、异 target 同 key409、独立 owner 候选及关联/计数过滤、权限变更后 replay403、错 resource、文档缺失/过期证明、晚 audit 与关系/receipt 原子回滚、generation503。H3 使用实际路由/BFF/Foundation/scope core，覆盖双权限、可信身份与键、Codocs ACL 拒绝不提交、浏览器伪造证明拒绝；外部 Codocs transport 为该 H3 测试边界，由独立 sender/receiver 签名测试覆盖。Foundation 固定映射69项、Assets owning Go race、Assets/Host typecheck、目标 lint通过；实际 OIDC 页面及独立 Codocs 部署/grant 验收尚待发布阶段。

### 关联回执迁移工具接线（准备完成，未执行新 DDL）

统一 source migration 顺序为先 `20260913_assets_owned_product_receipts.sql`，再 `20260914_assets_owned_product_link_receipts.sql`。`enterprise-assets-receipt-contract.mjs` 维护该顺序和元数据观察规则；source-readiness 分开输出 `migrationMarkerPresentAndEnforced`、`linkCommandsPresentAndEnforced`、`pendingMigrations`。preflight 独立要求 `assetsProductLinkReceiptSchema` 证据，原 `assetsOwnedReceiptSchema` 不替代新增关联命令的验收。

最小执行入口仍是现有受限工具：`node deploy/test-env/enterprise-assets-receipt-migration.mjs --plan --links` 只读生成当前源 DDL 与新迁移 SHA-256 绑定的 reviewHash；后续实际应用使用 `--apply <reviewHash> --links`。工具继续验证精确 C000001 本机实例/库/部署且 enterprise disabled，应用前取互斥锁、5秒锁等待并独占备份原 DDL。关联升级要求已应用完整且 ENFORCED 的主档规则，应用后复核全部三个 link operation 与原身份/能力标记。已有 link 标记时选择旧 master 迁移明确拒绝降级，不依赖“DDL 可能失败”保护历史回执。参数未知、缺 hash、额外参数都拒绝。

本轮只运行无 I/O 合同测试、语法检查、候选生成单测和基于已存在 plan 的 `/tmp` 候选生成；未运行迁移工具的真实 `--apply`，未改实际 source-readiness 观察报告或正式 artifact inventory。旧迁移字节与先前实际迁移 receipt 的 migrationSha256 有自动测试核对。已有实际 MySQL 关联链回归另已执行新 DDL 两次，验证初始旧规则503、升级后写入及回执原子行为。正式应用新 DDL 后，必须重新运行真实 source plan/readiness，再生成候选与更新 preparation inventory；旧 plan 的 owned marker 不代表关联写已就绪，候选工具新增 `assets-owned-product-link-receipt-source-migration-required` blocker。

### C000001 新关联约束实际应用后的源证据（2026-09-13 21:04:56.985Z）

发布主代理已通过受限工具实际应用 link 增量迁移，reviewHash `a74cd1a080c99e10603d5e391a5c20658c7d78ea09d617de57031822bdb704d0`，after DDL SHA-256 `8800928d026102a7704eeecf024790a3c61884dce156f122ff3890f727c3fe10`。从受保护 schema-backups 的原 receipt 按白名单复制公开证据至 `deploy/test-env/artifacts/C000001.assets-owned-product-link-receipt-migration.json`，核对迁移文件 SHA、ENFORCED=true、businessRowsMutated=false；没有复制凭据或原始受保护配置。

随后本代理以只读工具重新采集源 plan/readiness：当时为147表、478行，新 ReviewHash `0f22db98816bbba00b33af5cfc99ff27f43934d5739728654a64a2f879eb3053`。实际 CHECK 元数据中 master/link 均完整且 ENFORCED，pendingMigrations为空。正式候选文件重生为55视图、零静态 blocker；Runtime candidate 仍 disabled、installed=false、targetVerified=false。preparation inventory 由原10项增加该新迁移证据为11项，全部 bytes/SHA-256逐项通过，businessMigrationApplied仍false。此段是补入 Assets 三张 outbox 表之前的历史记录；当前 150 表基线见[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)。

C000001 readiness 已指向新 link receipt，并保留独立 Codocs 外部 policy及 `enterprise-oauth-codocs-evidence.json` 服务授权证据。预检/迁移合同11项通过。Codocs目标代码发布、真实浏览器关联操作、目标迁移与切换仍按发布主流程验收；上述文件和源库观察不会将这些后续步骤自动标为完成。
