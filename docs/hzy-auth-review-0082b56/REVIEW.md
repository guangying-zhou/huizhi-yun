# 汇智云本机测试修正复审与文档／产品授权故障分析

审查日期：2026-09-21  
固定提交：`0082b56fe88426395f1ced1e60e8eff2e934d5d1`  
分支：`feat/adr018-enterprise-integration`  
对照：上轮 `d85e3482793e41fe64de9b463cb13bb769c0e65d` 审查、用户上传的 `Pasted text.txt`、本机 Enterprise 实施方案 v1.0。

## 1. 结论与证据边界

结论：**继续修改，暂不认定产品管理与文档读取已通过业务验收。** 上轮首页、端口约束及部分错误协议问题已有实质修正；提交记录报告了 Assets 产品主档编辑、同键重试和审计验证。但是，当前产品管理空间与文档正文的调用依赖没有完整接入本地出口，另外仍有页面／API 未注册、旧应用副作用和缺少显式导入等故障。

不能把全部报错归结为“当前用户角色不足”。最明确的两条阻塞是：

1. Aims 产品对象权限计算依赖 `aims:products:authorization-object`，本地出口在访问远端 Console 之前拒绝它。此时尚未进入正式的产品人员权限计算。
2. Codocs 文档元数据读取与正文读取是两条依赖链。正文读取依赖 `integration_config:view`、`credential_vault:resolve`，本地出口同样拒绝这两项。相关错误又被正文处理转换为 503。

前一条有真实出口函数的隔离 HTTP 复现；后一条的服务能力拒绝也已复现，且调用链由源码核对。用户日志缺少服务端关联 trace 和响应体，因此不能断言所贴文档 UUID 的那次 503 必然仅由该原因造成，也不能据此断定真实 grant、共享 ACL 或对象存储全部正确。

本次没有访问用户本机、真实 Cloudflare 账户、Runtime、数据库、浏览器会话或授权管理后台。没有修改代码仓库、安装 grant、放开白名单、部署或修改业务数据。本报告中的建议不是变更授权。

## 2. 上轮问题复审

| 原问题 | 本轮结论 | 依据和范围 |
| --- | --- | --- |
| R1 全部错误被抹平成通用错误 | 关键机制修复，覆盖仍不足 | 新增 `error-contract.mjs`；按 code/status 固定文案、64 KiB 上限、有限版本字段、有限 Retry-After 与 host-only 清 Cookie。当前 readiness、本地出口拒绝和文档存储失败仍缺稳定可区分的安全码。 |
| R2 首页／品牌指向与 HTTP 路由不一致 | 首页接线已修正 | 根和尾斜杠使用 GET/HEAD 302 到 `/enterprise`，非读取方法 405；页面注册 `/enterprise` alias 并使用授权导航。提交记录也报告品牌入口修正。此处未重新做真实浏览器验收。 |
| R3 内部端口可以配置但插件只认23121 | 已收口为明确固定端口 | profile 现在在校验阶段拒绝非23121。支持范围缩窄但与执行一致，不再要求先放开任意回环端口。 |
| 本地完全不支持写入 | 已增加一个精确例外 | 仅 `audience=data-runtime` 的 `assets:product:edit`；不等于其他写操作可用。 |
| G1/G2/G3阶段状态 | 仍需逐阶段验收 | 新记录报告一次模板 HMR、产品53编辑／恢复、响应丢失重试、唯一回执和唯一审计；G1尚有岗位、撤权、云端非回归与回退等缺口，G2/G3未实现。 |

必须区分：**Assets 产品53的主档编辑通过，不代表 Aims 的 HZ-TY-S-002 管理空间有权可用，更不代表 Codocs 正文／下载／协作可用。** 这些具有不同的资源、对象、前置能力和运行依赖。[S01–S05]

## 3. 上传日志分类

以下行号指用户原始 `Pasted text.txt`，不是仓库文件行号。

| 日志位置 | 表现 | 归类与初步结论 |
| --- | --- | --- |
| 73–83 | `useAssetDictionaries is not defined` | 前端组件依赖未接入；与服务或用户 grant 无关。 |
| 115–121、189–197、1974–1985 | 产品、权限、需求、功能、版本403 | 需要分层；已确认公共授权事实 capability 被本地出口拒绝，可解释多个接口同时失败。真实人员／对象授权仍须后续单独核对。 |
| 994–1000、1113–1119 | objectives、roadmaps/adoption 503 | 当前 Host 没有这两条 API 登记，会由 readiness 层拒绝；不能当作 Runtime宕机或人员无权。 |
| 95–105等 | adoption/objectives/settings 前端路由不存在 | 局部产品导航复用了旧完整目录，Host只迁入子集。 |
| 1–20等 | `/portfolios/{id}` 无路由 | 原组件未加模块导航适配，而且 Host 未注册对应详情；仅补前缀仍不够。 |
| 320–323 | 文档详情503 | 从元数据、正文配置、凭据解析、存储与适用审计逐层定位；日志不能单独证明拒绝层。 |
| 85–94 | `/api/user/applications`404 | 已迁移页面仍调用旧应用目录，当前本地路由未提供。 |
| 1232–1238等 | `/api/rum`404 | 监控采集入口未接通产生的次生噪声，不是另一组用户权限问题。 |

日志中大量行是同一错误的堆栈、重渲染及重试，不能将文件行数当作独立故障数量。仅凭浏览器 HTTP 状态码无法识别每一层的授权决定。

## 4. 发现 A1／P1：本地出口误拦产品对象授权事实能力

### 4.1 完整调用链

```text
GET /aims/api/v1/products/{productCode}
  → enterpriseProductWorkspace
  → requireProductPermission(..., source)
  → source.loadFacts(productCode)
  → callEnterpriseRuntime('aims.product-authorization')
  → 请求 aims:products:authorization-object 的服务令牌
  → 本地 Console egress allowedServiceScope
  → 403；尚未向远端 Console 发起令牌交换
```

`aims/server/utils/productAuthorization.ts` 在取得对象事实后，才调用 Console scoped authorization 并执行人员／对象范围计算。`permissions`、请求等接口也复用这个 source。因此，列表能力 `aims:products:view` 被允许，并不保证详情和权限页可用。[S06–S10]

`console-egress.mjs` 第18–22行仅接受三段式且末尾为 view/read 的 scope，加上产品编辑例外。`authorization-object` 不匹配。第59–61行在远端 fetch之前直接返回403。[S02]

### 4.2 隔离HTTP复现

保持固定 `client_id=enterprise.runtime`、`app_code=enterprise`、`audience=data-runtime`、`source_binding=service-client-policy`，使用真实本地出口与伪远端：

| scope | 本地允许 | HTTP | 伪远端是否收到请求 |
| --- | --- | --- | --- |
| `aims:products:view` | 是 | 200 | 是 |
| `aims:products:authorization-object` | 否 | 403 | 否 |
| `aims:product-versions:read` | 是 | 200 | 是 |

表中200仅代表测试替身被调用，不证明真实Console已签发、真实用户有权。令牌缓存可能暂时遮蔽获取／刷新时的缺口，不应靠保留旧缓存解决。

### 4.3 修复要求

批准产品读取用例所需的完整服务能力依赖，明确精确scope、audience、client/source deployment和目标Runtime。对 `aims:products:authorization-object` 完成正式目录／grant／Runtime入口核对后，按批准范围加入出口允许集合。不要改名成 `read`、取消对象事实校验、使用 `aims:*`，也不要把当前人员提升为管理员来绕过。

增加测试：用户拥有该产品view且服务grant满足时，详情、permissions、功能、版本、需求通过；错误audience、撤销服务grant、不可见产品和其他租户仍拒绝。确认对象事实能力不会向浏览器提供无权对象敏感字段。

## 5. 发现 A2／P1：文档读取只接通元数据，正文依赖被出口截断

### 5.1 读取流程不是一个 read scope

```text
/codocs/api/documents/{uuid}
  → prepareEnterpriseRuntime(codocs.personal-document-view)
  → codocs:personal-documents:read
  → documents:view 人员权限 + Runtime对象／owner规则
  → 返回受权文档元数据
  → withEnterpriseCodocsDocumentContent
  → downloadDocument(元数据中的oss_path, {event})
  → loadCodocsOssRuntimeConfigFromConsole
  → getOssRuntimeConfig
      → integration_config:view
      → credential_vault:resolve
  → 正文读取 / 必要时Yjs恢复
  → 适用公司文档访问审计
```

`tenantRuntimeTokenScope(..., 'console-integration')` 明确保留两个历史精确scope，**不会**将 `integration_config:view` 改成三段式业务scope。因此，它与当前出口正则直接不兼容。[S11–S17]

### 5.2 复现结果与归因边界

| 能力 | 用途 | 本地出口结果 |
| --- | --- | --- |
| `codocs:personal-documents:read` | 元数据读取 | 允许 |
| `integration_config:view` | OSS集成配置 | 403，未调用伪远端 |
| `credential_vault:resolve` | 获准凭据解析 | 403，未调用伪远端 |
| `codocs:personal-documents:export` | 下载 | 403，未调用伪远端 |
| `codocs:document-access-records:record` | 适用的访问审计 | 403，未调用伪远端 |

正文handler把非404存储相关异常转换为503“文档存储暂不可用”。所以“文档列表能看、打开正文503”具有明确的代码解释。该上传日志的文档请求只显示尾部路径，也没有正文响应或服务端trace；需先核对Network里的完整URL。不排除在元数据／对象授权／存储本身更早失败，也不认定该UUID一定属于公司文档。

### 5.3 安全的定位方法

使用同一正式登录会话、同一获准文档，比较既有参数 `skip_content=1` 与普通view（已存在该参数校验，不建议新增绕过入口）：

- 元数据200、正文503：优先追踪集成配置、凭据解析、存储读取和适用审计。
- 元数据也失败：先定位服务令牌、人员授权、owner／共享ACL，不先修改OSS。
- 只在下载失败：另查export能力与对象下载权限。

### 5.4 凭据权限不得因“让页面能打开”无条件增加

`credential_vault:resolve` 是敏感服务能力，不是普通人员查看文档的角色权限。先确认哪一个正式服务是获准的存储消费者，以及该消费者能解析哪个租户的哪项Integration、用途、版本及审计规则。可复用已有独立文档／存储服务；若沿用现有Host请求级存储适配，必须明确批准并验证其最小消费范围。方案选择属于待决定的实施事项，本报告不擅自变更主责或秘密边界。

不能将长期OSS密钥复制到本地.env、不能允许任意Integration解析、不能让浏览器选取存储路径、不能忽略必要审计后返回正文。也不能把“本地停止业务cron”误解为“禁止用户操作必需的同步审计”。

## 6. 发现 A3／P1：资源关联弹窗仍依赖未注册的自动导入

`assets/app/components/assets/ProductResourceLinkModal.vue` 只显式导入 `useAssetsModule` 和类型，setup直接调用 `useAssetDictionaries()`。Host未整体继承旧Assets应用自动导入环境。用户日志已实际出现ReferenceError。[S18–S20]

建议在该域组件中显式导入：

```ts
import { useAssetDictionaries } from '../../composables/useAssetDictionaries'
```

该路径对应当前存在的函数定义；这里是修改建议，不是已应用patch。随后检查弹窗及其传递依赖，并在Host真实挂载验证。组件被导入不等于原应用的composable扫描会跟随迁入，Nuxt自动导入依赖当前应用或已配置目录。[E01]

同时检查按需加载：关闭的弹窗不应无理由预取全部资产／字典，但按需加载不能替代缺失导入修复。不要为了消除错误整体引入Assets原`default.vue`或完整应用配置。

## 7. 发现 A4／P2：产品导航、概览查询与已迁入范围不一致

### 7.1 前端页面

`getProductPerspectives()`仍返回旧完整工作视角，包含adoption、objectives、settings等；Layer包装只加模块前缀，Navbar直接生成链接，没有按Host实际登记范围裁剪。`aims/layer/entry.mjs`未注册这三类页面。[S21–S24]

### 7.2 API

产品概览一进入就并行查询features、versions、requests、objectives和roadmaps/adoption。现有生成清单中没有后两条API，readiness中间件会在handler前返回503 `enterprise_module_runtime_not_ready`。[S25–S27]

存在另一条 `/products/:productCode/adoption` 登记，不代表它与旧 `/roadmaps/adoption` 的返回契约相同，不能未核对DTO就仅替换字符串。

### 7.3 修复

以同一版本的页面登记、API登记和运行能力决定当前可展示区块；原有但未迁入的功能采用批准兼容路径或明确状态，不做假可用。根对象授权失败时，不继续并行调用全部子资源；可选指标必须满足实现就绪和适用权限。返回“—”比伪造0正确，但不能靠catch吞错替代依赖适配。

对已知不可用、权限拒绝或未注册入口，不进行无意义自动重试。错误采集与重复请求会放大日志，需先修根因再降噪。[E02]

## 8. 发现 A5／P2：项目集链接及旧应用副作用仍未迁完

### 项目集

项目总览约第765行仍输出 `/portfolios/${id}`，而Host没有注册该页面。修复必须同时确定真实目的地和Host/旧应用兼容，不能只给字符串加 `/aims`。[S28,S21]

### 应用目录

Assets产品详情已经在hosted分支把产品中心目的地改为Host入口，但仍无条件 `loadApps()`。该composable实际请求根路径 `/api/user/applications`，本地网关只允许特定根API，因而404。[S29–S31]

hosted模式不需要的旧应用目录请求应停止；确有需要时复用统一Host能力或批准的正式接口。不要为一条冗余请求放开整个根`/api`。

### RUM

用户日志显示`POST /api/rum`404，本地网关也未登记该入口。这是次生采集故障。要么接入具备脱敏、限额和授权约束的正式collector，要么对本地profile明确关闭未接入采集；不要将每次上报失败再次递归上报或持续弹错。本次未验证插件是否存在无限递归，不作该断言。

## 9. 发现 A6／P2：拒绝层级仍难以分辨

错误白名单是一项正确改进，但本次实际探针仍显示以下三种不同错误归为 `hzy0_upstream_error`：

1. 本地出口403：`Console egress request failed`，无结构化scope拒绝原因。
2. Host能力未就绪503：`enterprise_module_runtime_not_ready` 未纳入安全映射。
3. 文档存储阶段503：只有通用消息，没有稳定诊断code。

本地allowlist日志只记录path/status/stage；对 `/oauth/token` 路径，仅凭这些字段无法分辨哪个依赖scope被拒绝。建议记录经过解析及白名单约束的scope、audience、固定拒绝阶段及服务器生成的关联ID，不记录body、Token、Cookie、密钥或文档内容。[S02–S04]

建议建立以下拒绝层分类，名称仅为新契约建议，不声称已经存在：

| 层 | 管什么 | 常见问题 | 不应采取的“修复” |
| --- | --- | --- | --- |
| 入口与部署 | Access、Gateway、tenant/deployment | 未通过入口保护／来源验证 | 关闭来源验证 |
| 页面/API就绪 | 当前版本是否注册 | 接口未迁入、旧URL错误 | 给用户增加角色 |
| 本地出口 | 该部署获准请求什么服务能力 | authorization-object、integration依赖未纳入 | 正则全放开或grant `*` |
| Console服务授权 | 服务client、audience、grant有效性 | 未安装、失效、版本漂移 | 使用人类admin令牌替代 |
| Runtime调用授权 | 服务入口、actor委托、租户与代次 | 错误对象/租户、委托失效 | 绕过Runtime、直连DB |
| 人员/对象/字段 | 该人员能看何种事实 | 未授权、共享ACL、敏感字段 | 认为企业全量功能=人人全权限 |
| 存储与审计 | 字节读取及必要留痕 | 凭据消费未批准、存储故障、审计失败 | 复制长期Secret、吞审计错误 |

客户端只获得稳定code、固定安全文案和关联ID；人员不可见对象继续按既有404语义保护，不因为诊断方便泄漏对象存在性。服务端才保留受控的详细阶段。不要恢复任意上游错误正文。

## 10. 授权治理的结构性建议

### 10.1 “只读”不能用字符串后缀定义

现有正则既不表达完整读取依赖，也不是正式RBAC。查看产品需要授权事实，查看文档需要存储解析，有时还有访问记录。它们未必以view/read命名。

应复用正式manifest、operation→capability映射与已批准安装模板，形成特定测试阶段的最小服务能力集合。每个业务任务应登记传递依赖，而不是只为可见页面的主接口登记一个scope。

### 10.2 服务可调用与人员可访问分开

物理Host使用`enterprise.runtime`，逻辑产品/文档权限仍分别以aims/assets/codocs资源判断。不要把所有资源改名enterprise，也不要让导航区名“产品”“经营”成为新的授权主体。

产品workspace当前还要引用Assets受权事实。仅有Assets主档查看权不自然意味着有Aims规划空间、功能、需求、版本权限；反过来同样不能推导。需要检查角色模板及实际用户membership对既有资源的映射，而不是删除其中一个领域的校验。

### 10.3 安装授权要有版本和差异验证

对于发现的缺口，先检查本地出口，再验证正式Console和Runtime的原grant。远端grant可能已存在，也可能需要精确追加；本次没有真实grant快照，不能凭403进行全量初始化。

建议记录源码操作目录hash、已批准服务能力集合、实际安装差异、用户权限版本、Runtime版本和测试对象。最小变更后覆盖错误audience、其他tenant、撤销grant、无权对象的拒绝测试。源码存在scope不等于现场已安装，令牌签发成功也不等于目标对象授权通过。

## 11. 下一批整改与验收

建议批次名：**本机产品与文档读取依赖闭环**，先完成G1，不扩大Node/回环/更多业务迁移。

| 顺序 | 工作 | 完成证据 |
| --- | --- | --- |
| 1 | 固定当前源码、进程版本、脱敏请求关联ID，更新拒绝原因映射 | 一次故障可定位在具体层；无Token/业务正文泄漏 |
| 2 | 产品授权事实能力进入获准依赖集合，验证原服务grant | 产品列表→详情→permissions→功能/版本/需求；正常用户通过，无权对象继续拒绝 |
| 3 | 修显式导入及产品未注册链接/查询 | 主档与资源弹窗真实挂载；无相同ReferenceError；无虚假可用入口 |
| 4 | 文档metadata与content分开验证，冻结存储消费者和敏感scope边界 | 同一文档skip_content=1与普通读取；无权文档/错误integration/下载/适用审计分别验证 |
| 5 | 项目集与旧应用目录、RUM接线 | 正常点击、刷新、新标签均可达或真实不可用；无无用重复请求 |
| 6 | 完成真实角色、失败、撤权和云端非回归 | 更新G1矩阵与固定组合版本，不以管理员截图替代 |

建议最少覆盖：

- 产品：正常可见空间、不可见空间、错误audience、撤销对象事实service grant、已登录但无人事/财务等无关权限的普通产品角色。
- 文档：本人私人文档、他人未共享文档、允许共享文档、共享撤销、缺存储配置、错误存储对象、正文不存在、适用访问审计失败；下载另验export。
- 交互：同一页面后退/刷新、项目集导航、产品视角切换、弹窗打开、修改代码HMR及普通刷新。
- 运行：同时核验云端Workers仍能访问既有Runtime；不变更DB连接、issuer、JWKS或生产grant。

## 12. 本次测试、限制和复现

本包包含4个与固定提交Git blob SHA一致的原始文件：出口实现、错误协议实现及其两个原始测试。实际运行原仓库两个测试文件，共 **7 passed、0 failed、0 skipped**，见 `results/original-tests.tap`。

另外在临时loopback端口运行真实 `createConsoleEgress()`，远端fetch是确定性测试替身，不访问公网。10项服务scope分别检验本地函数、实际HTTP状态和伪远端是否被调用；结果见 `results/authorization-probes.json`。未知出口/未就绪/存储错误映射同样使用真实 `safeError()`。

当前容器Node为 **v22.16.0**，不是项目要求的Node24。本次未执行完整Nuxt构建、typecheck、Go全量、真实MySQL、真实Console令牌交换、浏览器、PM2/Caddy/Tunnel或回退演练。原记录中的27项回归、HMR与产品写链证据属于提交者记录，不计入本次独立测试数量。

复现命令在本包根目录执行：

```sh
node --test source/deploy/test-env/local-enterprise/test/console-egress.test.mjs \
  source/deploy/test-env/local-enterprise/test/error-contract.test.mjs
node tests/authorization-probes.mjs
```

这些命令只使用包内代码、fixture和临时回环端口，没有真实凭据。仓库当前branch后续变化不影响本包固定版本证据。

## 13. 源码和输入索引

以下[S]均固定到本报告SHA；链接方便实施者追溯，不表示已经部署到本机。上传日志只在本次会话中引用，不在复现包中重新复制完整业务日志。

- [S01] [`docs/Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/docs/Local-Enterprise-Test-Acceptance-Record.md`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/docs/Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/docs/Local-Enterprise-Test-Acceptance-Record.md).
- [S02] [`deploy/test-env/local-enterprise/console-egress.mjs`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/deploy/test-env/local-enterprise/console-egress.mjs).
- [S03] [`deploy/test-env/local-enterprise/error-contract.mjs`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/deploy/test-env/local-enterprise/error-contract.mjs).
- [S04] [`deploy/test-env/local-enterprise/gateway-transport.mjs`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/deploy/test-env/local-enterprise/gateway-transport.mjs).
- [S05] [`deploy/test-env/local-enterprise/config.mjs`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/deploy/test-env/local-enterprise/config.mjs).
- [S06] [`enterprise/server/routes/aims/api/v1/products/[productCode].get.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/server/routes/aims/api/v1/products/[productCode].get.ts).
- [S07] [`enterprise/server/utils/enterpriseProductWorkspace.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/server/utils/enterpriseProductWorkspace.ts).
- [S08] [`enterprise/server/utils/enterpriseProductAuthorization.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/server/utils/enterpriseProductAuthorization.ts).
- [S09] [`aims/server/utils/productAuthorization.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/aims/server/utils/productAuthorization.ts).
- [S10] [`foundation/server/utils/enterpriseRuntimeClient.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/foundation/server/utils/enterpriseRuntimeClient.ts).
- [S11] [`enterprise/server/routes/codocs/api/documents/[uuid].get.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/server/routes/codocs/api/documents/[uuid].get.ts).
- [S12] [`enterprise/server/utils/enterpriseCodocsDocumentReads.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/server/utils/enterpriseCodocsDocumentReads.ts).
- [S13] [`enterprise/server/utils/enterpriseCodocsDocumentContent.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/server/utils/enterpriseCodocsDocumentContent.ts).
- [S14] [`codocs/server/utils/oss.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/codocs/server/utils/oss.ts).
- [S15] [`codocs/server/utils/ossRuntime.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/codocs/server/utils/ossRuntime.ts).
- [S16] [`foundation/server/utils/integrationConfig.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/foundation/server/utils/integrationConfig.ts).
- [S17] [`foundation/server/utils/tenantRuntimeClient.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/foundation/server/utils/tenantRuntimeClient.ts).
- [S18] [`assets/app/components/assets/ProductResourceLinkModal.vue`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/assets/app/components/assets/ProductResourceLinkModal.vue).
- [S19] [`assets/app/composables/useAssetDictionaries.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/assets/app/composables/useAssetDictionaries.ts).
- [S20] [`enterprise/nuxt.config.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/nuxt.config.ts).
- [S21] [`aims/layer/entry.mjs`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/aims/layer/entry.mjs).
- [S22] [`aims/app/components/products/Navbar.vue`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/aims/app/components/products/Navbar.vue).
- [S23] [`aims/layer/productNavigation.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/aims/layer/productNavigation.ts).
- [S24] [`aims/app/config/productNavigation.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/aims/app/config/productNavigation.ts).
- [S25] [`aims/app/pages/products/[productCode]/index.vue`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/aims/app/pages/products/[productCode]/index.vue).
- [S26] [`enterprise/composition/business-api-routes.generated.mjs`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/composition/business-api-routes.generated.mjs).
- [S27] [`enterprise/server/middleware/01-business-api.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/server/middleware/01-business-api.ts).
- [S28] [`aims/app/pages/projects/index.vue`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/aims/app/pages/projects/index.vue).
- [S29] [`assets/app/pages/products/[id].vue`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/assets/app/pages/products/[id].vue).
- [S30] [`foundation/app/composables/useUserApplications.ts`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/foundation/app/composables/useUserApplications.ts).
- [S31] [`enterprise/app/pages/index.vue`](https://github.com/guangying-zhou/huizhi-yun/blob/0082b56fe88426395f1ced1e60e8eff2e934d5d1/enterprise/app/pages/index.vue).

外部工具机制仅用于解释，不替代项目源码：
- [E01] Nuxt 4 Auto-imports：https://nuxt.com/docs/4.x/guide/concepts/auto-imports （2026-09-21核对）。
- [E02] ofetch官方Auto Retry说明：https://github.com/unjs/ofetch （2026-09-21核对）；是否使用默认值还应看实际调用选项，不能从文档推导日志准确重试次数。
