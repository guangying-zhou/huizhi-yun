# 汇智云企业侧前端整合：技术路线与分阶段实施建议

日期：2026-09-15。版本：1.0。性质：ADR-019 的配套工程建议，不是代码补丁、已执行测试结果或第二份实施进度台账。

适用决策：[ADR-017](./ADR-017-Console-Tenant-Data-Plane-Separation.md)、[ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md)、[ADR-019](./ADR-019-Enterprise-Business-Frontend-Integration.md)。

基线范围：用户提供的 ADR-018 记载 monorepo、各 Nuxt 业务应用继承 `@hzy/foundation`、Go Runtime 内多个 adapter，以及原稿基线 `801b402e`。本次没有逐文件审计最新仓库，因此下文目录、类型、路由、组件名称和工作包均为建议；实际文件名和脚本需在 FE-0 与现有实现对齐，不得照示例声称已经存在。

## 1. 推荐路线和取舍

### 1.1 主路线

**保留现有 Nuxt/Vue 与 Foundation，新增一个薄 Enterprise Host；从 Aims/Assets 提取可组合 UI；先统一 Shell，再完成产品业务工作台，最后沿商业履约链扩展。**

组合发生在构建时，而不是浏览器运行时加载任意远程应用。前端默认一个部署单元，业务代码按 Layer/package 保持责任；后端按 ADR-017/018 继续是客户侧 Runtime 与必要的独立服务。

| 决策项 | 推荐选择 | 原因与边界 |
| --- | --- | --- |
| 主框架 | 沿用实际受支持且锁定的 Nuxt/Vue 版本 | 不把统一前端变成换框架；本文目录示例采用 Nuxt 4 约定，不推断现有版本 |
| 组合方式 | Nuxt Host + 显式业务 Layers/UI 导出 | 匹配现有 monorepo 与统一发布方向，减少额外运行时装载平台 |
| 基础设计 | 复用 Foundation 现有组件体系与主题 token | 先统一交互，不另引入一套竞争 UI 库 |
| 跨域业务页面 | Host 中的业务 feature/工作台组合，消费领域公开面板 | 一对象一套核心编辑逻辑，不导入其他应用完整 Shell |
| 客户端状态 | 优先复用现有方案，落实请求级/租户级隔离 | 不因“整合”强制换 Pinia 或新增一个全局万能 store |
| 数据访问 | 同源薄 BFF + 明确 Runtime API/查询服务 | 不让浏览器拼业务数据库，不将认证委托交给前端任意填写 |
| 独立服务接入 | 正式 API、必要时独立页面/受控编辑器嵌入 | 统一入口不假装消除了实际信任/进程边界 |
| 发布 | Host 统一构建；业务路由灰度；必要时整包回退 | Layer 不是独立热更新/独立故障隔离单元 |

不在首轮建设运行时微前端平台、低代码导航 DSL、跨模块事件总线、全局业务实体仓库或通用分布式事务协调器。后续确有需求，再以独立决策引入。

### 1.2 将“前端整合”拆成三个可验收结果

**工程整合：**一个构建、一个主 Shell、明确依赖与命名规则。

**体验整合：**一个业务导航、统一上下文、稳定路由和跨对象返回路径。

**业务整合：**产品/合同等工作台引用相同权威事实与主责命令，不需要人为同步或拼接多个应用。

FE-1 主要证明前两项的基础；FE-2 产品试点首次证明第三项。禁止用 FE-1 的合包成功宣布“企业业务整合完成”。

## 2. FE-0：只做必要盘点与合同冻结

第一批工作不动生产写入路径。建议输出以下清单，放入现有实施台账的附件或相应模块契约，而非开新的大型配置系统。

| 盘点项 | 应记录什么 | 用途 |
| --- | --- | --- |
| 版本与构建 | Node、包管理器、Nuxt、Vue、Nitro、UI 依赖、lockfile、Worker preset | 冻结兼容基线；不能让示例目录掩盖版本差异 |
| 路由与入口 | 页面、route name、layout、middleware、旧域名/前缀、深链接使用方 | 消除重复 `/`、`/settings`、动态路径及重定向冲突 |
| 自动扫描内容 | components、composables、utils、plugins、server routes、public 资源 | 避免 Layer 隐式覆盖或重复装载 |
| 会话与权限 | 初始化链路、OIDC client/callback、appCode、service scope、数据范围 | 确定一个 Host 如何复用正式身份，而非全局改 appCode |
| 隐性副作用 | cron、Outbox、队列、同步、监听器、WebSocket、SDK 初始化 | 保证移入 Layer 不会在新旧实例执行两遍 |
| 业务依赖 | 产品主档、空间/组件、版本/执行、投影与快照、字段权限 | 确定产品工作台哪些读取能直连 Runtime，哪些先保留 API |
| 运行和回退 | Cloudflare/PM2 的配置、路由治理、发布版本、静态资源地址 | 定义旧 UI 可继续消费当前权威存储的窗口 |
| 基线 | 按岗位的操作脚本、P50/P95、API 次数、构建/上传/内存 | 先测量，再固定预算，不预先捏造提升百分比 |

门槛：没有完成路由、身份和副作用盘点，不允许简单把 `../aims` 与 `../assets` 原应用根目录加入 Host 的 `extends` 后直接上线。

若盘点发现框架版本过期或存在安全维护风险，应单独安排必要升级并重新测试；不要把无关的全依赖升级混在每个业务迁移提交中。

## 3. Host、领域 UI 与工作台的目标目录

以下为推荐的目标组织，可按仓库命名微调；`ui-layer/` 是建议新增入口，避免一开始搬迁整个应用。

```text
enterprise/                         # 新增的企业前端宿主
  nuxt.config.ts                    # 只选择经过清理的 Layers 和宿主配置
  app/
    app.vue                         # 唯一根组件
    layouts/enterprise.vue          # 企业 Shell，业务页面使用 slot
    pages/                          # 业务 canonical 路由的薄包装页
    features/
      product-workspace/            # 跨域产品工作台布局/组合，不放数据库逻辑
      contract-workspace/           # 后续合同工作台
    components/shell/               # 企业导航、上下文、公共容器
  modules/                          # 构建时注册/冲突检查，名称待冻结
  server/
    api/enterprise/                 # 白名单聚合 BFF，非通用转发器
    middleware/                     # 请求上下文、安全入口
  shared/                           # 非敏感类型和目录声明，客户端可用

aims/
  ui-layer/
    nuxt.config.ts                  # 干净的 Layer 配置，不加载旧根 Shell/cron
    app/components/                 # Aims 前缀的可组合面板/表单
    app/composables/                # 显式导出或 Aims 前缀
    runtime/pages/                 # 可选：由注册器显式挂载的兼容页
    frontend-contribution.ts        # 路由/导航/能力引用（建议名）
  ...                               # 保留原入口和后台文件，逐步收敛

assets/
  ui-layer/                         # 同样提取可组合 UI；不复制第二份产品主档
  ...

foundation/                         # 共享基础，保持业务无关
console/                            # 独立协议/基础能力边界，按 ADR-017 收敛
platform/                           # 不纳入 Enterprise Host
```

目录中的组件名称仅作示意：如 `AssetsProductIdentityPanel`、`AimsProductPlanningPanel`、`AimsProductReleasePanel`。工作台组合它们，传入经过验证的对象引用；不得直接读取对方私有 store 或 import 对方 server utils。

两个原则：**先提取可复用业务内容，再让旧入口与新 Host 复用同一实现；不得复制整页后分别修改。** 每个业务写入表单只有一个主责实现，可被兼容页面和业务工作台包装复用。

## 4. Nuxt Layers 的实际整合方式

### 4.1 不直接合并完整应用配置

Host 配置只包含宿主运行必要项；业务 Layer 不再声明 app.vue、企业主 layout、独立登录回调、数据库变量、根 service appCode 或定时器。需要迁移的旧插件拆成纯函数/显式注册，再由 Host 决定是否加载。

Layer 配置的合并与文件优先级是真实行为，不是隔离机制。使用 `~`/`@` 等宿主别名的旧代码、相对 CSS 路径、public 资源名和 auto-import 要逐项适配；优先以 `import.meta.url` 解析本 Layer 资源或定义显式别名。[T1]

不要同时通过自动扫描 `layers/` 和多个 `extends` 路径重复引入同一 Layer。Foundation 的多重传递依赖须核对最终注册结果，不能只因框架“通常去重”就省略插件计数测试。

### 4.2 页面路由只选一个注册主路径

建议首轮使用 **Host 的构建时注册器 + 每领域显式页面来源**，以便保留旧路由前缀，并逐个替换为业务路由。页面文件可以留在非自动扫描目录，再由 Nuxt Kit `extendPages` 注册；不同时让同一页被目录扫描和手工注册两遍。[T2]

若某一组页面已完全整理成无冲突的文件路由目录，可使用文件扫描；每个页面仍必须有唯一 owner 和最终路由记录。禁止依靠高优先级 Layer 覆盖另一个同名页面解决冲突。

注册器至少在构建时校验：逻辑 route name、标准化路径、动态路由形状、alias、owner、父子关系、layout、middleware 和页面文件。规范化后的 `/products/:id` 与 `/products/:code` 不能当成两个无关路径。

canonical 页可放在 Host 的 `app/pages/` 作为薄包装，再 import 工作台 feature；兼容旧页由显式注册器挂载。路由契约限定每个逻辑目的地唯一实现，不要求所有业务组件都放到 Host。

### 4.3 BFF 和服务端插件不能随页面一起盲目扫描

当前各应用的 `/api/v1/**` 容易发生路径重叠。建议将迁移 BFF 明确挂入宿主业务命名空间，或为每条旧 API 配置具体兼容适配器；不导入多个未经清理的 `server/api/` 目录。

服务端注册包含 HTTP method、path、handler、逻辑动作、目标服务和认证要求；构建时报重复 method/path、未登记代理目标或越界 secret 配置。迁移时可复用仓库实际的 Nuxt/Nitro 注册机制，不依赖本文没有核验的辅助函数名称。

`/api/enterprise/...` 仅是建议命名。一个候选产品 overview BFF 可以组合产品主档与版本摘要，但具体 URL、请求字段和权限 action 必须引用现有 OpenAPI/manifest，再由合同评审冻结，不能把文档示例当上线接口。

## 5. 最小注册契约：导航不是新的权限系统

### 5.1 需要冻结的五个合同

| 合同编号 | 合同内容 | 事实源/落点建议 |
| --- | --- | --- |
| FE-C01 路由与导航 | 逻辑路由、业务分组、owner、canonical/legacy 路径、参数映射、能力引用 | 领域 contribution + 构建生成物；统一契约文档 |
| FE-C02 Host 上下文 | bootstrap、会话、租户/环境、workload 与用户委托、有效权限版本 | Foundation + Console/Runtime 正式合同 |
| FE-C03 公开 UI | 组件输入、输出、错误、命令责任、依赖白名单 | 各领域 UI 导出及契约测试 |
| FE-C04 工作台数据 | overview DTO、必要/可选区块、授权披露、mutation/Receipt | Runtime API/查询服务；过渡期专用 BFF |
| FE-C05 发布与任务 | Host/Runtime/schema/目录版本、静态资源、迁移路由、任务 owner、回退 | 既有 release manifest 与实施台账 |

这些合同可以是几张表与少量类型文件，不必实现一个通用插件引擎。类型、路径和字段若有既有定义，应扩展现有定义而非平行重建。

### 5.2 建议的 TypeScript 类型草案

以下代码仅给出可编译的静态类型形状，用于冻结合同；不是现有接口实现，也没有绑定实际路由、鉴权库或 Nuxt 插件。正式 capability 联合类型应由现有 manifest 生成，不能长期保留任意字符串并据此授予权限。

```ts
export type BusinessArea =
  | 'workbench'
  | 'product-development'
  | 'customers-contracts'
  | 'projects-service'
  | 'operations-resources'
  | 'knowledge'
  | 'administration'

export type EntityRef = Readonly<{
  kind: string
  // 已有稳定 code 优先；无合适 code 的对象使用正式的不透明引用。
  key: string
  keyKind: 'code' | 'opaque-ref'
}>

export type FrontendRouteContribution = Readonly<{
  routeId: string                 // 稳定逻辑名，不随 URL 更换
  ownerDomain: string             // 工程主责，不是运行时权限凭据
  area: BusinessArea
  titleKey: string
  canonicalPath: string
  legacyPaths: readonly string[]
  capabilityRefs: readonly string[] // 构建阶段核对生成的权限目录
  entryMode: 'host' | 'legacy-document' | 'isolated-editor'
  requiredRuntimeCapabilities: readonly string[]
}>

export type UiContextSnapshot = Readonly<{
  tenantCode: string
  environmentCode: string
  principalRef: string
  authorizationRevision: string
  contextEpoch: number
}>
```

`UiContextSnapshot` 只是可公开的界面快照，**不能直接信任后再转发成服务端授权上下文**。Runtime 自行验证 Cookie/Token、workload、委托、路由租户及权限。对象 key 需校验与 URL 编码；类型 `string` 本身不证明有效或可见。

导航展示和物理页面注册使用相同路由事实源，权限代码引用既有 manifest；用户偏好只能重排允许显示的入口，不能为自己增加 route/capability。

## 6. 深链接与旧 URL：先统一目的地，再美化路径

### 6.1 推荐分两次切换

第一次在 Host 内保留 `/aims/...`、`/assets/...`，先统一 Shell/会话与可组合页面，确认真实兼容。

第二次在产品业务试点中引入 canonical 业务路径，将旧路径映射到相同对象和实现。导航显示业务名称可以先于地址改变，不能把旧链接删除当体验整合。

| 逻辑目的地（建议名） | canonical 路径示例 | 兼容要求 |
| --- | --- | --- |
| `product.view` | `/products/:productCode` | 旧主档 ID 经受控解析映射；不虚构产品与空间一对一 |
| `product.planning` | `/products/:productCode/planning` | 按正式关联查找可见规划空间；必要时用户选择 |
| `product-space.view` | `/product-spaces/:workspaceRef` | 保留 Aims 空间独立身份；引用不假定数据库已有特定 code 字段 |
| `contract.view` | `/contracts/:contractCode` | 按事实/执行/管理组织，保持旧查询参数与来源语义 |
| `project.view` | `/projects/:projectCode` | 研发/交付/维护使用同一项目身份，多个发现入口 |

正式旧地址必须由 FE-0 盘点填入，不在本文猜测。

### 6.2 区分四种兼容方式

**相同参数语义：**路由 alias 或指向同一组件的受控记录。

**参数语义变化：**兼容页面先经授权解析旧 ID/对象，再转到 canonical；无权或不存在按正式错误合同返回，不泄露额外名称。

**尚未并入 Host 的应用：**以登记的独立文档入口打开，保留同一业务导航目的地和安全 returnTo；不宣称此时没有完整页面加载。

**协议和 mutation：**OIDC callback、webhook、POST/PUT/PATCH/DELETE 由独立兼容 handler 处理，不走页面导航重定向，不镜像真实写请求。

query 白名单保留列表筛选、排序和分页；hash 在客户端处理。returnTo 只接受同租户/环境下的登记路由或安全 origin，不接受任意 URL。写操作不通过链接参数偷偷提交。

## 7. 产品工作台的首轮实现建议

### 7.1 页面组成，而非整页嵌套

一个 `ProductWorkspace` 组合产品摘要、目录信息、规划空间关联、版本摘要与执行入口。每个领域面板只呈现业务内容，不带另一套导航、登录页和企业选择器。

产品当前名称来自 Assets 权威定义；Aims 的空间、模块、功能、需求和版本保持自己的主责。跨域工作台只引用这些对象，不再新建一个“统一产品”表来承载全部事实。

在 UI 中明确区分两个视角：**产品业务视图**以产品为锚点；**规划空间视图**以实际 Aims 空间为锚点。二者可以互链，但不能把多个产品/组件的规划空间压成单产品外键。

### 7.2 推荐的读取演进

```text
试点早期：
Host 产品页面
  → 专用产品 overview BFF
  → Aims / Assets 既有正式业务 API
  → 各自当前权威数据路径

后台完成相应迁移后：
同一个 Host 产品页面
  → 同一 DTO 合同的 BFF/Runtime client
  → Runtime 产品查询服务
  → 受控权威表/视图 JOIN 与批量读取
```

页面 DTO 的可见字段和语义保持稳定，替换的是内部读路径。原服务只提供分块读取时，先做有限并发的 BFF 聚合；不要生成一个可传任意服务 URL 的万能聚合器。

### 7.3 数据分块与错误语义

| 区块 | 必要性 | 失败时的建议行为 |
| --- | --- | --- |
| 根产品与访问确认 | 必要 | 验证失败则不展示旧对象摘要，也不继续加载关联数据 |
| 产品基本定义 | 试点核心 | 明确加载/错误，不用 Aims 旧名称快照假装当前事实 |
| 规划空间/版本 | 依用户权限 | 无权时不带入 payload；服务错误按可披露合同显示局部不可用 |
| 商业/客户情况 | 后续逐步加入 | 未接入或无能力时不显示虚假“0 客户/0 收入”；不阻塞核心产品信息 |
| 经营敏感字段 | 独立授权 | 仅返回授权字段或汇总，不能靠前端隐藏 |

保存后按主责服务返回的修订号和对象身份失效相关缓存，再重新获取权威摘要。前端局部乐观更新只能用于明确可回退字段，不能代替发布/审批的真实状态。

### 7.4 必须跑通的用户脚本

产品负责人查找产品、查看定义与当前名称、进入其有权使用的规划空间、查看需求/版本与进度，再回到产品；过程不要求知道 Aims/Assets、切角色或重新登录。

另设只读销售账号、仅项目成员账号和无产品权限账号，验证范围和字段差异。改名测试同时检查当前视图与历史发布快照；必须纳入多产品关联空间案例，不能只用一产品一空间的最简单数据。

## 8. 会话、SSR、缓存与切换屏障

### 8.1 最小 bootstrap

由 Host 协调一次当前请求/页面所需的会话初始化，复用 Foundation 现有能力。返回用户最小展示信息、企业/环境、权限版本、导航目录和运行能力；不要一次性拉取全部业务数据或整个 Directory。

SSR 请求之间不得共享当前用户的 promise、Token、租户变量或业务客户端。可以在**同一个 SSR 请求上下文内**去重 bootstrap；在浏览器当前实例中也可去重。为所有请求复用一个“正在登录”的模块级 promise 会制造跨用户污染风险，应禁止。[T3]

客户端 hydration 复用本请求结果，避免每个业务 Layer 再发起会话请求；导航、有效期刷新和显式授权变化采用相同规则。认证失败和 Runtime 不可用需区分，避免 401/503 都触发无限登录循环。

### 8.2 数据缓存分级

| 数据 | 建议范围 | 处理 |
| --- | --- | --- |
| 公共静态资源/主题定义 | 按发布内容 hash | 可公开缓存；不含租户数据 |
| 导航目录/权限快照 | 租户、环境、主体、有效权限版本 | 到期/撤权刷新，不用跨用户共享结果 |
| 对象/列表 DTO | 上述上下文 + 对象、筛选、分页及必要版本 | mutation/关联变化/切换时失效 |
| 密钥、长期令牌、权威 Session | Runtime 安全域 | 不进入前端 store、SSR payload、日志或共享缓存 |
| 草稿 | 当前用户、租户、对象、修订号 | 默认内存；需要持久化须单独定义权限、期限与清理，不能默认为 localStorage |

Nuxt 的共享状态和数据获取依赖 key 语义；相同 URL 不足以区分用户、租户和授权。缓存隔离不构成最终授权，所有读取/写入仍经 Runtime 验证。

### 8.3 切换顺序

处理未保存修改 → 进入不可操作的切换态 → 取消请求与订阅 → 清理受影响 store/async data/KeepAlive → 向服务端验证目标企业/环境 → 生成新的上下文快照与本地代次 → 加载新视图。

即使 AbortController 已取消请求，仍可能有已完成或不可取消的响应回调；提交到 store 前比较请求发起的上下文代次。代次仅用于丢弃 UI 旧响应，不是安全凭证。

请求失败时展示可恢复错误；不要立即把标题换成企业 B 却留下企业 A 的内容。跨 origin/环境切换必要时采用完整页面导航。多标签页只广播“上下文失效/需重新验证”等事件，不广播 Token 或以广播内容直接授权。

## 9. 公共交互与故障体验

Foundation 提供可组合的页面框架，而不是万能业务表单。第一批统一：对象摘要、列表筛选/分页、状态显示、保存/取消、冲突提示、确认、空态/无权/未配置/不可用、附件入口、Toast/Dialog、面包屑与未保存拦截。

页面组最多保持两级对象内导航，再深内容用页内锚点或独立子页。合同遵循“总览、合同事实、合同执行、合同管理”，不把付款条款与实际回款重新混入同一编辑表单。

局部组件错误用局部边界处理；整体路由错误应保留可用 Shell；根插件/初始化失败可能影响整个 Host，依靠稳定发布/整包回退恢复，而不是承诺某个错误边界能隔离所有故障。

公共错误语义至少区分：需要认证、无访问权限、对象不可见/不存在、能力未配置、企业整体资格不可用、后端暂不可用、并发冲突、操作结果待核对。服务端可以因防泄漏合并部分对象错误，前端不自行暴露更多事实。

键盘操作、焦点回到触发点、屏幕阅读标签、窄屏可用、时间/金额一致、列表状态返回及浏览器后退一起验收，不仅统一配色和组件外观。

## 10. Cloudflare、PM2 与加载策略

### 10.1 不把首轮变成“全站 CSR”或“全站 SSR”改造

先保持可支持的现有渲染策略；对重交互编辑器用受控客户端加载，对普通业务页按测量结果调整 SSR。无论选哪种，敏感企业数据都不应进入公开预渲染页面或未按权限隔离的边缘缓存。

懒加载以路由与重组件为边界。Root plugin 只做必要初始化，不 import 全部业务面板、图表库或编辑器。导航注册只包含轻量元数据，不因生成菜单提前加载全部页面组件。[T4]

同一 Host 和客户端路由提供常驻 Shell；切租户/登录恢复/进入保留的独立文档可以完整导航。不要以“任何情况下都不刷新页面”作为架构目标。

### 10.2 部署适配与当前公开上限

截至 2026-09-15 核对，Cloudflare 官方列出 Worker 未压缩代码大小 64 MiB、每 isolate 128 MB 内存与 1 秒启动限制；实际套餐 CPU、网络子请求等还要按部署复核。这些不是项目预算，也不代表统一 Host 已经通过容量测试。[T5]

建议首先减少根依赖与初始化、按需加载和 BFF 扇出；如果仍触及预算，可使用已批准的 Node/PM2 托管 Host 或保留真正独立的重能力，不首先把企业导航拆回多个应用。不同部署模式共用认证、接口和数据边界，不恢复数据库直连。

Cloudflare 特有 binding 和 Node 特有 API 放到部署适配中；浏览器可见配置不包含 DSN、Vault 秘密或 service 私钥。生产 `runtimeConfig.public` 的审核列入构建门槛。

### 10.3 实际预算如何固定

| 指标 | 必须记录 | 预算冻结方式 |
| --- | --- | --- |
| 首次进入/客户端导航 | P50/P95、网络/设备条件、冷暖缓存 | 以同岗位同场景旧基线与目标体验共同确定 |
| 请求扇出 | 会话请求、API/SQL 次数、慢查询 | 试点任务上逐项比较，不把总请求数下降当唯一目标 |
| 浏览器代码 | 首屏 JS、各路由 chunk、重组件加载时点 | 检查是否全局导入；不只看产物目录体积 |
| Worker | upload、启动、CPU、并发 isolate 内存 | 低于实际平台限制并保留预先冻结余量 |
| 工程效率 | 构建/typecheck/测试耗时 | 与团队可接受发布流程共同冻结 |
| 可靠性 | 部分区块失败、Auth 离线、整包失败、hash 资源可用 | 要有演练，不以无错误的一次演示通过 |

具体毫秒、百分比和容量余量目前没有项目测量依据，不在本文伪设成已批准 SLO。FE-0/FE-1 应把数字补入实施台账，后续发布不得无限延后这一步。

## 11. 测试、发布和回退

### 11.1 分层测试

构建契约测试检查贡献目录、route name/动态形状、capability 引用、重复全局插件/BFF、禁止依赖和敏感配置。组件/页面测试验证面板公开 props/事件和一致错误语义。API/Runtime 契约验证字段权限、部分失败、修订号、操作幂等。

端到端必须使用多个岗位和两个租户；关键场景包括相同对象 ID、并发 SSR、两次快速切租户、旧响应迟到、撤权后已缓存页、多标签退出、登录后 returnTo、旧 query/hash、未保存草稿、无权限直接访问 API、Root plugin 失败及旧 HTML 加载新发布资源。

测试框架优先复用仓库已有框架；本文不假定某个 `pnpm test:enterprise` 已存在。新增脚本在工作包中登记后再写入流水线，避免给开发者一串不存在的“可运行命令”。

### 11.2 一次发布应绑定的版本

建议在既有 release manifest 扩展而非另建发布平台：Host release、Runtime API/capabilities、schema revision、权限目录版本、导航/路由映射版本、各 UI Layer 源码版本、静态资源内容 hash 和迁移路由策略。

当前页面使用的发布版本与后端兼容能力应可诊断。灰度按租户/会话保持版本亲和；不能同一页面 HTML 从新版本来，动态 JS/API 随机落到不兼容旧版本。

### 11.3 需要三种回退

**页面/业务链路回退：**把受控路由指向已验证的旧 UI 实现，但继续使用当前唯一权威业务存储与正式 API。

**Host 整包回退：**处理全局依赖、SSR 或 Root plugin 故障；旧 Host 必须在 API/权限目录兼容窗口内可用。

**后台/数据恢复：**按 ADR-017/018 专项执行，不由前端迁移开关恢复 DB fallback 或覆写旧数据库。

兼容窗口内保留旧 HTML 依赖的 hash 资源、API、重定向和回调地址；对过期客户端给出受控更新/重新加载，不突然删除 JS 文件。写操作遇到响应未知先核对 Receipt，不因 UI 回退自动再次执行。

## 12. 工作包建议：可直接登记到现有实施台账

以下编号是待实施的工作拆分，不是已完成记录；不覆盖既有 INT 编号，登记时建立映射即可。

| 工作包 | 主要交付 | 依赖 | 放行门槛 |
| --- | --- | --- | --- |
| FE-0.1 现状盘点 | §2 清单、真实旧 URL、版本与插件/任务清单 | 原稿及仓库现状 | 不再存在未知根入口/权限/任务责任 |
| FE-0.2 五项合同 | FE-C01～05、试点用户脚本、预算测量方案 | FE-0.1 | owner、权限、租户绑定、回退可审阅 |
| FE-1.1 Host 骨架 | 单一 app.vue/layout、Foundation 接入、现有会话复用 | FE-0.2 | 无第二 Shell/认证循环，不放宽 scope |
| FE-1.2 UI 提取 | Aims/Assets 干净 ui-layer、公开面板、旧入口复用 | FE-1.1 | 无完整根配置合并和重复实现 |
| FE-1.3 注册与兼容 | 页面/BFF 注册、冲突检测、旧 URL 与资源映射 | FE-1.2 | build/typecheck、深链接/协议兼容通过 |
| FE-1.4 上下文治理 | 请求级 bootstrap、缓存/撤权/切换屏障、多标签处理 | FE-1.1 | 跨租户/SSR/迟到响应/退出场景通过 |
| FE-2.1 产品 DTO | 主档、空间关系、版本摘要、权限/部分失败合同 | FE-0.2，可先用旧 API | 主档与空间不混同，无敏感字段泄漏 |
| FE-2.2 产品工作台 | 业务导航、产品摘要与跨域面板、canonical/legacy 目的地 | FE-1、FE-2.1 | 岗位任务不换应用/角色即可完成 |
| FE-2.3 数据与回退验证 | 当前名称、历史发布、接纳关系、业务回退和资源窗口 | FE-2.2 | ADR-018 产品试点与 ADR-019 FE-A01～10 适用项通过 |
| FE-3.1 客户/合同工作台 | 客户与合同导航，事实/执行/管理分组 | 产品试点通过 | 保持条款、计划与账务语义 |
| FE-3.2 交付/服务链 | 合同→项目→客户资产→维护的上下文与动作 | 对应正式领域 API | 每条链独立验收，跨域 mutation 在 Runtime |
| FE-3.3 成本/经营视图 | 工时、成本与合同经营查询；字段/汇总权限 | Finance/People 对应合同 | 无工资明细泄漏，无重复成本/收入归集 |
| FE-4.1 旧路径收口 | 旧 UI/同步/身份消费方归零、停止任务、移除权限 | 兼容/恢复证据 | 删除在最后，不用预定日期强删 |
| FE-4.2 效率与体验 | 搜索/收藏/待办深链接、性能和辅助能力 | 主链稳定 | 不引入第二事实源或过度泛化平台 |

FE-0/1 不等待物理合库；FE-2 可以先通过正式 API 验证业务工作台，再替换内部查询。Auth 权威迁移独立执行，不将“Console 的全部迁移完成”作为所有 UI 原型的先决条件，也不让 UI 试点豁免已适用的安全边界。

## 13. 建议的首批提交顺序

建议每个提交或 PR 只承载可独立验证的变化，避免“目录搬迁 + 登录改造 + UI 重做 + 合库”混成一个大补丁。

| 顺序 | 提交主题 | 刻意不做 |
| --- | --- | --- |
| 1 | 文档修订、合同/盘点结构、基线与测试脚本定义 | 不改变生产路径 |
| 2 | Host 最小外壳与请求上下文，受控测试入口 | 不接入全部业务，不引入新权限模型 |
| 3 | Aims/Assets UI 公开导出与兼容包装 | 不复制页面，不搬全部后端目录 |
| 4 | 路由/BFF 注册、旧链接和 scope 映射、冲突检测 | 不改业务主键，不镜像写请求 |
| 5 | 产品工作台与既有 API DTO，跨域读取合同 | 不先删投影，不误建统一产品主档 |
| 6 | 接入经 ADR-018 验证的 Runtime 聚合查询 | 不与 Auth 密钥/会话迁移同批上线 |
| 7 | 租户灰度、岗位验收、性能/回退演练 | 不以演示代替验收 |
| 8 | 消费方归零后的旧入口/任务/权限清理 | 不提前删除旧 hash 资源或数据证据 |

若某步与当前仓库已完成工作重合，应复用其实现并核验，不重复搭建。当前进度只以现有实施台账和真实代码/测试为准。

## 14. 需要冻结但本次材料尚不能确定的参数

Host 最终目录/包名、实际 Nuxt/Nitro 版本、旧路由完整清单、OIDC client/issuer 兼容细节、产品空间正式引用、已有能力/action code、迁移开关存储位置、部署预算、兼容窗口和上线批次，均需现有仓库和部署盘点后确定。

这些未知项不影响选择“单一 Host + 构建时 Layers + 业务对象工作台”的路线；但在冻结前不能将示例路径、类型或时间窗口直接当成生产合同。也不需要为此暂停所有工作：先在测试环境完成已知边界下的 FE-0/FE-1 验证。

## 15. 外部技术依据

核对日期：2026-09-15。外部资料只支撑工具机制，不证明汇智云当前配置或性能。

- [T1] Nuxt 官方：[Authoring Nuxt Layers](https://nuxt.com/docs/4.x/guide/going-further/layers)、[Layers](https://nuxt.com/docs/4.x/getting-started/layers)：组合、自动扫描、优先级及路径解析。
- [T2] Nuxt 官方：[Pages / extendPages](https://nuxt.com/docs/4.x/api/kit/pages)：显式路由扩展；[文件路由](https://nuxt.com/docs/4.x/directory-structure/app/pages)。
- [T3] Vue 官方：[Server-Side Rendering](https://vuejs.org/guide/scaling-up/ssr)；Nuxt 官方：[State Management](https://nuxt.com/docs/getting-started/state-management/)：SSR 状态的请求隔离。
- [T4] Vue Router 官方：[Lazy Loading Routes](https://router.vuejs.org/guide/advanced/lazy-loading.html)。
- [T5] Cloudflare 官方：[2026-09-04 Worker 大小公告](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/)、[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。
