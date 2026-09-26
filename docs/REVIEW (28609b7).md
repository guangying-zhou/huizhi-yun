# ADR-019 修正复审：28609b7

审查日期：2026-09-20  
仓库：guangying-zhou/huizhi-yun  
固定提交：`28609b762839409b55ca8b644650ee9c3733feac`  
对照：上一轮 `0ca042dbe721e7ba72a290a7d90a551d561e4d04` 的五项发现，以及本提交内 ADR-019 与导航规范。

## 结论

本次修正有实质进展：服务端授权目录、稳定导航 ID、项目对象匹配、来源 URL、项目切换器与同一目的地的多入口支持都已加入。不应继续沿用上一轮“没有菜单鉴权”“把 new 当项目”“按 URL 禁止多入口”的原始描述。

仍建议 Request changes。本轮确认四项 P2：项目详情返回按钮未解包嵌套 Ref；旧 Console 的客户端导航未经过新增网关重定向；同身份权限刷新会清空并重新建立对象上下文；项目筛选 URL 同步与全局 fullPath 页面 key 冲突。另有一级业务区不可折叠与现有 ADR 条款不一致的遗留项。

这里的 P2 是本批导航/交互修正项，并非新发现的服务端越权漏洞。不能据此宣称整个平台安全已经完成验收，也无需回滚已建立的业务导航架构。

## 1. 上一轮问题复核

| 上轮项 | 当前结论 | 依据与边界 |
| --- | --- | --- |
| F1 菜单无人员权限过滤 | 核心机制已补齐 | 新增 `enterprise/server/routes/enterprise/api/navigation.get.ts`；验证 Enterprise 用户，从正式 Console 授权快照按资源/动作计算可见 ID。客户端据此过滤分组、叶节点和对象动作。真实账号、撤权及部署可用性全链仍待验收。 |
| F2 创建项目被当作既有项目 | 原问题可关闭 | `numericProjectId()` 检查已匹配对象路由、正整数及路径边界；`/aims/projects/new` 不再进入对象模式。原有单元测试和本轮探针均通过对应判断。 |
| F3 双 Shell | 部分修复 | 物理 Enterprise 被列为原生入口；试点网关支持登记的旧 Shell 链接转换。但旧 Console 内部 SPA 切换仍有遗漏，见 R2。 |
| F4 项目返回与对象导航 | 大部分机制已补，仍需修正 | 有来源白名单、URL 传播、对象名称、项目切换、共享上下文、折叠和移动端模型；详情按钮及刷新生命周期仍有 R1/R3，列表 URL 同步有 R4。 |
| F5 同 URL 多入口被拒绝 | 原限制已移除 | 生成器改为按稳定节点 ID 检查唯一性，别名保持相同正式权限；`selectActiveLeaf()` 支持优先入口且只选一个激活节点。本轮没有执行完整菜单生成器测试。 |

## 2. R1 / P2：详情页返回按钮仍然不读取实际对象模型

**位置**：`aims/layer/pages/enterprise-project-detail.vue:32`；关联 `enterprise/app/composables/useEnterpriseProjectObjectContext.ts`。

当前模板：

```vue
<UButton :to="objectContext.model?.backTo || moduleUrl('/projects')">
  {{ objectContext.model?.backLabel || '返回项目总览' }}
</UButton>
```

`useEnterpriseProjectObjectContext()` 返回普通对象，其 `model` 是 ComputedRef。模板自动解包不递归解包普通对象属性；因此上述表达式读取的是 Ref 自身的 `backTo`，而不是 `.value.backTo`。同一文件的脚本在检查编辑权限时正确使用了 `objectContext.model.value`，模板的返回按钮却遗漏了 `.value`。

### 本轮表达式级验证

从 Git blob SHA 已核对的原始 Vue 文件提取实际 `:to` 表达式，使用与该 composable 返回值相同的普通对象/Ref 外形：

```text
model.value.backTo = /assets/products/42?tab=planning#versions
实际表达式结果     = /aims/projects
```

该验证没有挂载 Vue。判断同时依据 Vue 官方关于“模板仅解包顶层 ref”的规则；不能把表达式探针写成浏览器通过/失败截图。

### 影响

从产品上下文进入项目后，侧栏的返回链接可以正确使用 `model.backTo`，而详情内容中的返回按钮仍回项目总览；同一屏的两个返回入口语义不一致。带过滤参数的项目列表来源也会在这个按钮上退回无参数路径。

### 建议修改

可以把 `objectContext.model` 提升为模板顶层变量：

```ts
const objectModel = objectContext.model
```

```vue
<UButton :to="objectModel?.backTo || moduleUrl('/projects')">
  {{ objectModel?.backLabel || '返回项目总览' }}
</UButton>
```

也可以在原模板明确读取 `objectContext.model.value`。不要再维护第二份返回目标。

### 回归场景

从产品来源和带筛选的项目列表分别进入项目；断言侧栏与内容区返回按钮的标签、href 一致；刷新/新标签后仍一致。应挂载真实详情组件，并执行 vue-tsc/typecheck，不能只测试 `safeProjectReturn()`。

## 3. R2 / P2：网关重定向没有覆盖旧 Console 内的 SPA 切换

**位置**：`deploy/test-env/enterprise-topology.mjs::resolveLegacyShellPath()`；`console/app/pages/shell/[appCode].vue::applicationOverrides`；`foundation/app/components/AppRail.vue`；`foundation/app/utils/applicationShell.ts`。

新拓扑正确地将已登记的旧 Shell 目标转换为直接业务页面，并保留必要 query/hash；物理 `enterprise` 也不再被通用工具包装成 iframe。这两项修改有效。

但 Console Shell 仍对普通逻辑应用设置：

```ts
{
  homeUrl: shellEntryFor(app),
  basePath: app.basePath,
  external: false
}
```

AppRail 使用 `<NuxtLink :to="appEntryUrl(app)" :external="app.external">`。对于同源内部路径且 `external:false`，Nuxt 使用客户端路由。正常的同标签切换不会向 Gateway 重新请求顶层 `/shell/aims?...` HTML，因而不会执行这次新增的重定向分支。

### 触发前提与链路

在试点开启、用户仍能访问某个未迁移的旧 Shell 应用，且没有部署层额外客户端修正时：

```text
已有 Console /shell/<旧应用> 文档
  → AppRail 普通点击 Aims
  → Console 客户端路由 /shell/aims?target=<已迁移页面>
  → 原 activateRouteFrame() 继续创建 Aims iframe
  → iframe 的业务地址由网关交给 Enterprise Host
  → Console 完整外壳 + Enterprise 完整外壳
```

Console Shell 页面在本提交的 blob 仍为 `aecf708f6a85d85f99333913a55feb705c03c976`；已检查的 Console 全局路由中间件目录也未新增对应转换逻辑。初次 HTTP 打开旧书签可以走新逻辑，并不能证明已加载旧 Shell 内部切换同样正确。

这是源码调用链和 NuxtLink 官方语义支持的缺口；本轮未在真实部署中重演，不宣称所有线上入口必然都发生双 Shell。

### 建议修改

让旧 Shell/应用入口与网关共享或消费受控的迁移目的地判定。已迁移目的地应执行顶层、完整文档导航，或者在创建 iframe 前解析并进入正式 Host 路由；未迁移入口保留原行为。不要把所有逻辑应用加入 native 白名单，也不要删除所有 iframe。

### 回归场景

同时测试：直接 HTTP 旧书签；旧 Shell 内普通点击；浏览器前进后退；新标签打开；同一路径的 query/hash；未迁移应用仍保留独立兼容布局。断言已迁移页面只有一套公共顶部栏、导航与退出入口。

## 4. R3 / P2：普通权限刷新会先销毁有效导航和项目上下文

**位置**：`enterprise/shared/navigation-access.mjs::createNavigationAccessLoader()`；`enterprise/app/composables/useEnterpriseNavigationAccess.ts:13–19`；`enterprise/app/composables/useEnterpriseProjectObjectContext.ts`。

`refresh(scope)` 每次首先调用 `clear()`，同步发布空可见 ID，再发布空 loading。调用方不仅在用户/企业/权限版本切换时刷新，也在每次 `route.path` 变化、窗口 focus、可见页面每 60 秒刷新。

`filterWorkspaceAccess()` 在空 ID 时返回空工作区。项目上下文又通过当前工作区判断 active，并在 active 对应 key 改变时调用 `clear()`：取消请求、清空项目摘要和切换器列表、重置搜索和页码。即使身份、项目、权限完全没变，后台导航检查也会使对象上下文短暂消失，然后重新请求项目详情与项目列表。

### 本轮真实函数验证

使用原始 loader 与原始 `filterWorkspaceAccess()`，保持同一 scope，前后返回完全相同的权限：

| 时刻  | 状态  | 项目工作区数量 |
| --- | --- | --- |
| 初次成功 | ready | 1   |
| 同 scope 再次刷新，尚未返回 | idle | 0   |
| 刷新等待中 | loading | 0   |
| 原权限再次返回 | ready | 1   |

这证明不是只有真正撤权时才清空。对 Vue 界面卸载、焦点和额外请求的后续影响，来自组件与 watcher 调用链检查；本轮没有执行真实 Vue 生命周期或浏览器测试。

### 影响

项目侧栏与切换器可能在切换子页、重新聚焦或周期刷新时消失并重建；搜索和页码被重置，项目摘要重复加载。这与“同一对象内导航保留对象上下文”的目标不一致。

### 建议修改

区分硬失效和同上下文后台刷新。退出、切租户/主体/环境、明确撤权及权限快照过期必须立即清理；对于同一已验证上下文、尚在批准有效期内的快照，后台刷新不应把数据短暂替换成空树。失败或过期按正式安全策略清理，业务接口继续逐次授权。

另一项配套修正是将对象身份生命周期与“导航 HTTP 请求是否正在进行”解耦。保留防迟到结果写回的代次校验，不关闭撤权机制，不无限期沿用旧权限。

### 回归场景

有效会话同项目切换子页/等待一分钟/focus，导航和项目切换状态不重置；真正撤权、权限失败/过期、跨租户切换则按约定失效；旧响应不得复活旧菜单或项目。

## 5. R4 / P2：列表筛选写 URL 与 fullPath 页面 key 组合导致整页重建

**位置**：`aims/app/pages/projects/index.vue::syncProjectListUrl()`；`enterprise/app/app.vue:7`。

新增的列表状态恢复方向正确，但 `syncProjectListUrl()` 在筛选、搜索和视图变化后调用 `router.replace({ query })`；Host 根组件仍使用：

```vue
<NuxtPage :page-key="route => `${scope}:${route.fullPath}`" />
```

`fullPath` 包含 query/hash，因此同一路径的列表状态变化会改变页面身份。新增调用与已有全局 key 组合后，普通筛选也会触发页面实例重建，而不只是更新列表数据。

### 本轮 key 函数验证

从已校验 SHA 的原始 `app.vue` 提取实际 key 函数，以下三个同一主体/同一列表的地址得到三个不同 key：

```text
/aims/projects
/aims/projects?view=list
/aims/projects?view=list&search=Alpha
```

探针只执行 key 函数，不冒称记录了浏览器 remount。实例更换语义由 NuxtPage/Vue key 机制支持。列表本身既有筛选 fetch，又有 mounted 初次加载，因此额外挂载也有重复请求和丢失瞬时 UI 状态的风险。

### 建议修改

保留上下文 scope 隔离，在页面身份中只加入实际页面/对象必要的路由信息，不把全部列表过滤 query/hash 当作必须重挂载的依据。确实以 query 决定对象身份的页面单独声明。不要简单改成全局永不变化的 key，也不要删除用户/租户隔离部分。

### 回归场景

输入搜索、改变分类与视图时，查询参数能分享和恢复，页面实例与输入焦点不因这些变化重建；必要请求次数在预算内。切换租户/主体或真正对象身份仍必须清理或重建。

## 6. C1：一级区域折叠规则仍与 ADR 不一致

`HostNavSections.vue` 仍把各业务区输出为不可折叠的 `<p>` 标题；本次 `HostNavTree.vue` 已增加稳定 ID 和分组偏好恢复，但并没有实现一级业务区收起。

本提交 ADR-019 §4.4 仍要求“当前业务区展开、其他业务区默认收起”。这是上轮已指出的契约差异，不算新发现的安全问题。先经确认修改 ADR/规范；不能仅用代码注释替代已确认规则。本轮不要求为尚未接入的人力/销售区域制造空菜单。

## 7. 已执行验证

### 7.1 原仓库单元测试

在隔离临时目录中重建源文件；全部执行文件都按 GitHub 返回的 Git blob SHA 校验。执行：

```sh
cd source
node --test enterprise/test/navigation-access.test.mjs enterprise/test/object-navigation.test.mjs
```

结果：**11 通过，0 失败，0 跳过**。日志见 `evidence/original-tests.tap`。共 9 个保留的原始源码/测试文件的字节校验见 `evidence/blob-checks.json`。

这些测试用替身验证授权输入与纯函数行为，不调用真实 Console/Runtime 或租户业务数据，不能替代真实用户授权 E2E。

### 7.2 审查者诊断探针

```sh
node tests/behavior-probes.mjs
```

结果见 `evidence/behavior-probes.json`，覆盖嵌套 Ref 返回表达式、相同 scope 刷新时工作区清空、query 导致 key 改变，以及此前对象匹配、安全来源、多入口高亮的正向验证。这是观测当前行为的探针，不是全通过的业务验收。

### 7.3 未执行事项

未执行整个仓库构建、Nuxt/Vue typecheck、真实浏览器、MySQL、生产部署、回退或全部新增 Codocs 功能测试。当前运行环境无法直接联网克隆/安装完整依赖，因此复现使用经过 SHA 校验的局部源码，不是完整 checkout。

提交中的 `enterprise/test/browser-navigation.acceptance.mjs` 自己标注为未完成的本地 scaffold，且指出无合法签名的 fixture 会被服务端 OIDC 拒绝；本报告不将它当作通过证据，也不建议关闭鉴权来执行。

## 8. 建议修复顺序

先修 R1 的模板解包和 R2 的旧 Shell 客户端导航，再处理 R3 的刷新生命周期与 R4 的列表 page-key。同步解决 C1 文档/实现差异。

完成后补真实浏览器脚本：产品进入项目，侧栏和详情返回一致；项目内切换、周期刷新、focus、折叠和窄屏保持上下文；从未迁移旧 Shell 普通点击进入已迁移 Host；项目筛选 URL 变化不丢焦点；真实撤权/退出立即清理且拒绝迟到结果。

不需要另建导航平台、重写权限引擎，或把所有业务扩展作为本轮修复前置条件。当前主要问题是已经加入的安全与导航机制在组件、路由和异步生命周期之间还未衔接完整。

## 9. 来源与审查边界

本次主要通过 GitHub 连接读取固定提交源码，不以旧上传 ADR-019 v1.0 替代分支现有 v1.2 约束。公开镜像提交以 main 快照为父提交，未把整个镜像相对 main 的差异描述成本轮增量。

外部资料仅用于核验两项 Nuxt 语义和 Vue 模板解包规则，不用于扩展产品需求：

- Vue 官方《Reactivity Fundamentals》→ Caveat when Unwrapping in Templates。
- Nuxt 官方 `<NuxtLink>` → Handling Static File and Cross-App Links。
- Nuxt 官方 `<NuxtPage>` → `pageKey`。

代码引用均为上述固定提交；报告未修改远端仓库、权限、数据库或部署。