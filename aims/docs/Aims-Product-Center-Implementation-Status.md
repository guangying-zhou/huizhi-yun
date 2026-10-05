# 产品中心实施记录

> 目标：[产品中心完整落地计划](Aims-Product-Center-Implementation-Plan.md)及[优先级专项](Aims-Product-Prioritization-Design.md)。
> 当前状态：实施中。不能将以下基础代码进展视为产品中心已可用或整个方案完成。
> 2026-09-12：轻量版本规划第一阶段代码已完成，领域／接口及隔离浏览器验收通过；续修 Nitro 请求类型后全量类型检查通过；已部署 CF 测试 Aims、Runtime 并执行 v5.38，登录态读取／表单冒烟通过，完整真实租户写入链路未实跑，生产未部署。具体结果以[第一阶段方案与验收记录](Aims-Lightweight-Product-Planning-Phase1.md)为准，以下历史检查结果不代表当前工作树检查结果。

## 2026-09-07：领域规则与增量存储

### 当前工作树事实

| 任务 | 状态 | 本轮证据 | 仍需完成 |
| --- | --- | --- | --- |
| PC-00 基线核验 | 进行中 | 迁移基线为 v5.18；已核对版本双入口、项目需求事务、现有宽 service scope、本地与 manifest 需求权限差异；新增只读 preflight SQL | 对目标环境执行 preflight、产品主档 API 解析和精确 grant 核验；登记试点产品与实际责任人 |
| PC-01 数据模型 | 进行中 | v5.19 增量 SQL、同步后的 aims_schema.sql、保留 v5.18 版本表夹具；隔离 MySQL 重放迁移保留原版本／特性 ID | 与应用命令接通后的完整关系／回填／verify 工具、真实存量演练；第二批模型在相应任务实施 |
| PC-06A 优先级 | 进行中 | Go 精确评分、版本指纹、完整队列移动、分类容量／依赖／例外检查，以及本应用事务回执 | 产品对象授权、持久化评估／排序 API、页面、周期操作、评论与结果回看、浏览器和角色验收 |
| PC-02 产品授权 | 进行中 | Manifest、Foundation 产品谓词、真实成员事实与 BFF → Console 适配；产品空间事务重验 | 列表范围、企业角色 scope 装配／精确 grant、时间到期授权链与发布职责冲突完整验收 |
| PC-04 产品空间 | 进行中 | 定位读取／编辑、归档／恢复、成员分页／创建／调整／撤销 BFF 与内部命令、revision／回执／审计事务 | Assets 校验后初始化、目录 generation／授权列表、导航和页面 |
| PC-03、05～18（除 PC-06A） | 待实施 | 沿用计划原范围，未以基础存储替代可用业务链路 | 按依赖继续推进，包含旧版本入口统一与后续规划／经营闭环 |

### 设计落地记录

- `data-runtime/internal/apps/aims/productcenter/` 是 AIMS 内部领域包，不是新应用或共享运行时。当前尚未挂接公开路由，不增加未授权的业务入口。
- 评分使用定点输入（两位小数），保存八位小数的推荐分，UI 后续显示两位；未填写的参数保持 NULL，不能用 0 代替未知。
- 调序命令按单项及锚点作用于完整队列，拒绝过期 revision，不用当前页数组覆盖全量顺序。
- 依赖图验证、分类预算和选择结果检查返回明确问题；显式例外不能抹去原问题，也不能借 P0 标签绕过过期评估。
- 本地命令没有跨应用 `TrustedContext`，不伪造 service-command 身份复用 outbox。采用 AIMS 本地 `product_command_receipts`；`ExecuteCommand` 接受必需的事务授权回调，先授权后读取回执，业务 mutation 与成功回执同事务。产品对象的真实授权适配仍由 PC-02 完成。
- v5.19 新表使用区分大小写的产品 code。产品子对象的组合外键阻止跨产品关系；版本的新链接可空，保留旧记录未映射状态。
- 评估、验收、发布、发布事件、结果观测和活动日志有数据库 append-only 保护；更正需追加记录。API 侧同样要限制更新，数据库保护不能代替完整业务鉴权。
- 不将新表加入无条件的 runtime requiredTables，也不立即打开菜单；产品中心的 schema 能力检查与受信启用配置在路由接入时落地，避免使未迁移租户的现有项目业务失效。

### 验证方式与证据边界

使用本机 MySQL 8.0.34 新建的临时 datadir，仅开放 Unix socket，禁用 TCP 与 mysqlx；测试为每个用例创建并删除独立数据库，不读取现有业务数据库和凭据。

已执行：

```bash
go -C data-runtime test ./internal/apps/aims/...
go -C data-runtime test -race ./internal/apps/aims/productcenter
```

运行数据库用例时为同一命令显式提供 `HZY_PRODUCT_CENTER_TEST_SOCKET`，值必须位于 `/tmp/hzy-product-center.*` 隔离目录；未提供时仅数据库集成用例 skip，不能报告其通过。

测试覆盖：方案的 7.80／12.80 示例、独立有理数精度对照、缺失／非法输入、过期指纹、跨页移动、依赖环／跨产品引用、未知容量和超配、同产品唯一开放周期、旧版本 ID 保留、迁移重放、发布证据不可改删、失败回滚、同键异 payload 拒绝、撤权后回执不可读、8 路并发同命令只执行一次。

新建库的产品中心 Schema 与 v5.18 增量迁移结果同时通过 MySQL 元数据对照：列类型／默认值／排序规则、索引、关系约束、CHECK 与不可变触发器。

尚未验证：目标租户数据库、实际服务令牌、真实角色、产品中心 API／UI、1440px／390px 交互、发布切换与回退。AC-01～28 均不能仅凭本轮基础测试标记全部通过。

### 下一步

1. 完成 PC-02 产品对象范围与 manifest 事实源，沿 Foundation → Console 的统一授权链路解析动作和对象关系。
2. 将工作空间／成员、需求、规划周期／事项的读写接入 AIMS adapter，在事务中复用本轮规则和回执。
3. 接 Assets 真分页／目录投影与正式产品校验，再实现产品页和优先级页面。
4. 继续转交项目、版本三入口统一、发布历史、试点与后续批次，保持完整目标不变。

## 2026-09-07：产品范围授权基础

- Foundation 统一 evaluator 新增 product:code/member/manager，与 Console 现有 scoped authorization 调用链共用；成员和经理必须命中独立产品关系事实，不能用项目成员或 Assets／通用 owner 代替。
- 产品 code 按大小写精确匹配；关系判断缺产品、缺 actor、缺关系或未知谓词均拒绝。默认角色范围与具体产品授权保持交集，不能跨 grant 拼接。
- 新增产品范围用例，并运行既有范围／Policy Bundle 回归：`pnpm --dir foundation exec tsx --test test/productScopeAuthorization.test.ts test/scopeEvaluator.test.ts test/applicationAuthorization.test.ts`，38 项通过、无跳过。覆盖自定义角色合并、模拟隔离、admin 不蕴含 prioritize、产品范围交集及 expired 状态授权拒绝；该测试不代表按时间戳到期的授权链已经验证。
- PC-02 仍在实施：真实产品关系加载、manifest、服务端列表范围、事务内授权与 API 接入尚未完成，不开放新菜单或宣称端到端授权已完成。

## 2026-09-07：Manifest 与真实成员关系读取

- Manifest 新增六个产品资源、四个角色模板和产品 code/member/manager scopes，并补齐项目 requirements 资源；本地新增产品资源／需求资源与角色模板直接投影 Manifest。既有非产品 legacy 资源别名暂不迁移。
- 产品经理模板含验收、不含发布；发布者含 publish/reopen、不含 accept。onboard 不默认授予任何角色，需明确 tenant-global 授权。角色描述不等于已安装产品范围，Platform 企业角色范围装配及 verify 仍待实施。
- Runtime 新增内部产品 authorization-object，精确能力与可信 Aims 来源在数据库读取前检查。成员事实读取支持 DB／Tx，按数据库 UTC 时间判定 active 关系，返回当前 actor 的布尔关系，不泄露全体成员名单。
- BFF `checkProductPermission` 仅接受 Manifest 内产品动作，验证返回的产品／actor／类型后走 Foundation → Console；无本地 Policy Bundle／数据库回退。尚未供业务 CRUD 路由消费，写命令仍需在锁定产品根记录后重验，不能把本次读取当成长期有效令牌。
- 验证：Aims Manifest、事实映射和既有敏感路由共 105 项测试通过；新增 TypeScript 文件 ESLint 通过。隔离 MySQL 执行 `go -C data-runtime test ./internal/apps/aims/... -count=1` 通过，包含真实到期／未来生效／撤员／大小写／跨产品及事务内撤员读取；本次测试未跳过数据库用例。
- PC-02 保持进行中；PC-03～18 范围保持不变。内部 capability 精确 grant、业务端点与事务权限、完整页面、发布职责冲突和真实角色验收尚未完成。

本轮额外验证：`pnpm --dir aims typecheck` 通过；Runtime 既有签名 actor、伪造 query 清理和 JWT scopes 注入相关测试通过。隔离 MySQL 已通过指定 socket 关闭。

## 2026-09-07：产品空间业务链路

- 新增产品空间 GET／PATCH、archive／restore 浏览器端点，使用独立 BFF handler；产品路径未加入通用透传，业务字段白名单拒绝客户端的身份、状态和授权注入。定位三字段要求显式输入，可用 null 清空。
- BFF 先取得真实事实和 Console 动作决定，再构造短时内部上下文；产品命令在根记录锁下重读关系／revision。过期、错 actor／产品／动作、撤员和事实变动不能继续执行或读取旧回执。此上下文是本次请求中 Aims BFF 的授权结果，不是新的角色解析器或公开访问令牌。
- 修正产品内部服务身份边界：必须实际带经过 Runtime 验证的用户 actor delegation；不能回退到服务账号，不能使用通知或 service-command actor purpose。既有 query 注入清理测试及真实 JWT→adapter 拒绝用例覆盖该边界。
- 定位变更、归档、恢复、revision 递增、活动 before/after 和幂等回执同事务；失败整体回滚。归档保留产品和关联历史；归档期间禁止定位编辑，恢复需要明确原因。read 不写日志／回执，也不刷新主档投影。
- 首次执行检查业务 expectedRevision；网络重试经 BFF 重新授权后可读取同键成功回执，不因首次变更已递增 revision 而拒绝合理重放。不同 payload 拒绝，审计写失败回滚空间与回执。

本轮验证：

- `pnpm --dir aims typecheck`、相关 ESLint 通过。
- Aims 输入／关系／Manifest／既有敏感路由 108 项测试通过、无跳过。
- 在新建、只开放 Unix socket 的隔离 MySQL 中执行 `go -C data-runtime test ./internal/apps/aims/... -count=1` 和 `go -C data-runtime test -race ./internal/apps/aims/productcenter -count=1` 通过。新增覆盖完整定位→归档→恢复、显式清空、回执重放、旧 revision、撤员后重放拒绝、授权期限／对象／动作不匹配、两个并发变更只能成功一个、审计失败整体回滚。
- Runtime 路由测试验证 workspace:view 的只读传输 scope、伪造 query 无法形成签名 actor、正确签名才能进入参数校验；使用捕获／空 DB adapter 验证认证边界，不代表真实租户 Console 链已经验收。

仍未完成：空间初始化、列表与授权分页、成员维护、真实 service grant、Assets 主档分页／投影、用户页面以及后续需求／规划／发布链路。PC-04 尚不可标记完成，本轮未操作业务数据库或发布服务。

本轮隔离 MySQL 已通过指定 socket 正常关闭，临时 datadir 已删除。

## 2026-09-07：成员管理与目录有效性

- 新增成员分页、创建、调整和软撤销浏览器 API，以及对应 Runtime 领域命令。读取和写入均要求 products:admin；沿用签名用户、精确服务能力、Console 产品范围和产品根锁内重验。
- 新建任意关系或将关系设为 active 前验证 Directory 用户。Console 共享目录新增有界 active-status 投影，复用已存在的共享读取能力，返回完整请求 UID 集合的 uid/active，missing／disabled／unknown 为 false；Foundation 严格拒绝旧版身份展示响应、漏项、错 UID、重复 UID 和非布尔值。
- 每次写入指定一个当前有效的继续负责经理；BFF 校验其 Directory 状态，Runtime 在变更后检查同产品的有效 manager 关系。撤销／降级最后经理、跨产品经理或未来生效经理不能作为交接目标。无需读取全部人员或对 Directory 建跨库连接。
- 原成员 UID 不可被修改为其他人；成员自身及空间都有并发 revision。任何失败回滚成员、空间 revision、审计和回执；相同请求重放不重复写入。归档空间成员只读。
- 列表按固定稳定顺序分页，保留 inactive 关系以便追溯；effective 字段只描述本地关系有效期，不伪装 Directory 状态或完整权限。

验证：Aims 相关 112 项测试、Console 共享读取和状态投影 11 项测试、Foundation 响应契约测试通过。隔离 MySQL 通过成员交接／最后经理保护／跨产品／目录状态缺失与过期／未来接管／第 101 条分页／重复关系与回执／并发 revision 用例；两个并发撤销只允许一个成功，仍留一位经理；产品中心 `-race` 通过。Runtime 读取 scope 与签名 actor 回归通过，相关 ESLint 通过。

仍需推进：产品主档正式分页、初始化及目录刷新、授权产品列表、成员界面与全局接管入口，及后续规划／需求／版本完整链路。当前变更未部署，真实 Console service grant 与浏览器联合验收尚未完成。

本轮 Aims／Console 类型检查均通过。复核补充：新建 inactive 关系同样须校验目标 Directory 用户，不能用停用状态创建不存在的 UID；该数据库回归通过。
本轮隔离 MySQL 已正常关闭并清理临时 datadir，未访问业务数据库。

## 2026-09-07：产品目录读取与接入授权前置

- 新目录服务以独立精简契约读取真实 SQL 分页，单页最大 100；主档与产品线的水位、总数和条目在同一只读快照返回，后续页必须匹配水位。新水位表／触发器迁移仍待真实 MySQL 验证，未执行业务库迁移。
- Assets manifest 登记精确 `assets:product:read`，新服务资格依赖 Console grant，不复制调用方白名单；存量明确白名单接口保留原限制。Aims 候选入口仅允许显式 tenant-global onboard，不能用产品 manager 或不同 grant 拼接出全局权限。
- 修复 Aims 对未直接依赖的 authz-core 类型引用，改用 Foundation 导出的授权输入类型；候选分页在 BFF 拒绝缺水位的后续页。目录响应严格验证水位、页数、条目数、主档类型和重复编码，避免接受存量全量响应。
- 验证：新增 Aims 目录／全局接入授权 4 项测试通过；Assets 服务鉴权 4 项测试通过；Go Assets 包通过，新增 SQL mock 验证 LIMIT/OFFSET、总数、失效水位与迁移中拒绝、精确 scope。Aims 与 Assets 类型检查及相关 ESLint 通过。SQL mock 不证明触发器、事务隔离或真实 Token 链已验证。
- 仍未完成：水位迁移实测、Console grant seed/verify、旧产品服务分页、目录代际刷新／授权列表、产品空间初始化及用户页面。产品中心整体目标和后续批次保持不变。

扩大验证后修复两类集成缺口：产品角色模板按 Manifest 投影补入 Platform Aims 安装 seed（未执行），默认 Node 测试入口补 JSON import attribute 与显式 TypeScript 扩展名，Nuxt／Nitro 无输出类型检查允许该扩展名。修复后 `pnpm --dir aims test` 全套 331 项通过，相关 ESLint 通过。此角色 seed 不包含租户角色分配或 service grant，不据此声明真实租户权限已启用。

## 2026-09-07：产品接入事务与主档水位实测

- 新增 POST /products 浏览器入口及内部 onboard 领域命令：显式全租户 onboard 授权、Assets 单条主档可接入校验、指定 active Directory 经理。浏览器不能构造授权／目录证据，初始经理不默认取主档 owner 或当前用户。
- 产品空间、经理关系、活动审计和幂等回执同事务；以唯一产品根串行化并发接入，候选 UUID 识别首次创建，不依赖 MySQL affectedRows 模式。同键重放重新验证授权与来源，异内容／其他键重复接入拒绝，归档空间不被重新初始化。定位仅保存在 Aims，不复制产品名称，不创建虚拟项目。
- 新增 Runtime 完整 handler 回执封装测试，验证 BFF 需要的 code/data 外层；服务精确能力、签名 actor 与伪造 query 拒绝测试通过。主档与 Directory 是有期限的受信读取快照，不声称跨应用原子提交。
- 隔离 MySQL 通过：创建及初始经理、重复／异内容、并发同键只创建一次、无效／过期证据无残留、归档不覆盖、审计失败全部回滚。产品中心 -race 通过；Aims 全套 332 项测试通过，类型检查、相关 ESLint 通过。
- Assets 新增真实 MySQL 迁移／目录测试：101 条真实分页、精确大小写、产品变更及删除、产品线新增／改名／删除导致旧水位失效，回滚保持水位，迁移重复执行使旧水位失效，缺迁移／ready=0 拒绝。该测试使用专门最小主档 fixture 与实际水位迁移；不代表 Assets 整库迁移或真实租户链已验收。
- 仍需完成 Console 精确 service grant seed/verify、真实签发链、目录代际刷新与授权产品列表、旧产品服务分页及页面；后续需求／功能／规划／版本批次继续保留，PC-04 尚未完成。未部署或访问业务数据库。

本轮隔离 MySQL 已通过指定 socket 正常关闭，临时 datadir 已清理。

## 2026-09-07：精确服务授权安装产物

- 提供 manifest 校验的授权生成器及 Console Seed／Verify。当前能力覆盖 Aims 空间／成员／接入、Assets 主档读取及 Directory active-status 读取；双 runtime audience 各自精确授权。产品 authorization-object 内部读取动作补入 manifest，不进入默认用户角色。
- Seed 为显式选定且应用绑定正确的两个客户端安装 18 条业务 grant；当前凭证须 active、未到期且属于该客户端。不会给同 app_code 的其他客户端自动授权，不创建用户角色或秘密。既有 6 条传输权限只作为前提核验，不在新 Seed 中扩大。
- Verify 返回完整 24 行预期组合；缺客户端仍输出失败，检查当前凭证、精确 grant 与 active 状态，不用全局计数替代逐项判断。另提供真实签发组合及验收步骤，见[服务授权文档](Aims-Product-Center-Service-Grants.md)。
- 隔离 MySQL 实际执行生成的 SQL，验证重复安装、缺客户端、同应用无关客户端隔离、缺传输权限、精确 grant 停用、凭证过期和 mysql --force 下失败 guard 不产生授权。测试仅使用相关 Console 表的最小 fixture，未加载秘密或访问业务库。
- Aims 全套 333 项测试与相关 ESLint 通过；生成器 --check 通过。目标租户安装、实际客户端签发和接口联合验收仍未执行，不标记生产可用。下一步继续目录刷新／授权列表及页面，完整产品中心各批次仍为目标范围。

本轮服务授权测试的隔离 MySQL 已正常关闭并清理。

## 2026-09-07：目录分批刷新与原子生效

- 新增 POST /products/catalog-refresh 的 start／continue／status／cancel 动作，以及受精确 onboard 能力和签名用户保护的内部 Runtime 入口。浏览器只能提交批次 ID／revision，源页码、水位和行内容由 BFF 从实际批次与 Assets 响应构造。start 仅建批次，continue 每次读取最多 100 条。
- 增加目录单例提交锁与页级回执表，同步迁移、canonical schema 和 preflight。未生效批次只暂存；源页、游标、计数、回执及最终 active 切换同事务。新批次生效后拒绝旧批次覆盖，不创建伪产品来复用回执。
- 重复 start 返回同一 actor／键的批次；同页同内容重放不重复累计，异内容、水位／总数变化、跨页错序、过期 revision 拒绝。每次重放重验授权。批次仅创建 actor 可操作；失效来源或取消保留既有 active，临时依赖失败可以续传。
- 隔离 MySQL 通过 101 行两页激活、空目录激活、部分批次不生效、同页重放与内容冲突、来源变化后旧目录保留、较早批次不能覆盖新批次、页回执失败整体回滚、两个并发提交只写一次及过期授权拒绝。Aims 全包真实 MySQL 测试通过，产品中心 -race 通过，迁移／canonical 回归随同运行。
- Aims 全套 334 项测试、类型检查、相关 ESLint 与 Runtime 签名 actor／精确 capability 用例通过。源服务 400／401／403 保留对应错误分类，依赖不可用仍为 503。尚未执行真实租户 BFF 联合调用或浏览器验收。
- 当前可以在代码层执行刷新命令，但授权产品列表、最后刷新展示和用户页面仍待接入；旧产品服务分页与后续规划／版本批次尚未完成。未部署或迁移业务数据库。

本轮目录刷新测试的隔离 MySQL 已正常关闭并清理临时 datadir。

## 2026-09-07：授权产品列表

- 新增 GET /products 及签名用户保护的内部 product-list 读取。Foundation 将当前 products:view 授权在产品编码及非成员／成员／经理三种事实状态上求值，Runtime 只应用匹配结果，不复制角色或 Policy Bundle 算法。相关显式产品编码超过 512 时明确失败，不截断；无关动作不消耗上限。
- 产品详情同步使用同一 Foundation 产品授权适配，不允许用不存在的部门／项目上下文放行产品。已知产品关系、动作蕴含与同 grant 的 scope 交集仍由统一 evaluator 处理。
- SQL 在同一只读快照及固定成员有效期时间点内做权限、名称／编码／产品线／状态过滤，再计数、排序和分页；最大 100 条。字段使用唯一生效目录 generation；无主档投影时保持 code 和历史空间可读，目录字段为 null，无 GET 写库或跨应用逐行查询。
- 真实 MySQL 测试通过：105 空间中 103 个授权对象的第二页／总数、关键词筛选、单产品覆盖、撤员即时影响、无权限空集、经理关系到期／未来生效、跨 actor 与过期授权拒绝、未刷新目录的空字段语义。Aims Go 全包（含迁移／canonical 回归）通过。
- Aims 全套 338 项测试、Foundation 产品范围／多角色／模拟回归、Runtime 签名 actor 测试、类型检查及相关 ESLint 通过。列表／详情授权一致性和范围上限已有专门测试。仍未执行真实租户 BFF 联合调用或浏览器验收。
- 下一步为产品中心页面、成员／刷新交互和旧产品服务分页，之后继续产品需求、规划、功能、版本等完整批次。尚未部署、未修改业务数据库，整体目标继续进行。

本轮授权列表测试的隔离 MySQL 已正常关闭并清理临时 datadir。

## 2026-09-07：产品中心读取页面与浏览器验证

- 增加产品中心导航、products:view 路由入口，以及真实 GET /products 和 /products/{code} 的列表／空间详情页面。列表显示服务端总数、筛选、分页、目录更新时间、缺主档回退和共享错误提示；详情展示定位、目标用户与核心价值。写操作入口仍待接入，不将只读页面计为 PC-04 完成。
- 列表进入详情携带当前页码和筛选，返回固定 /products 路由仅保留四个列表参数，避免丢失工作上下文或接受任意跳转地址。加载期间清空旧行，并显示加载文案；错误时不把旧总数或目录时间当作当前结果。
- Chrome 隔离预览使用实际页面源文件、Nuxt UI 和 Foundation composable，加只读合成接口；验证 1440px／390px、长产品名、缺目录名称、第二页进入详情与键盘返回、搜索自动回第一页、空结果、503 错误和重置恢复。窄屏检查发现状态列挤出，已调整列最小宽度与单元格留白并复核。修复预览内混用 Vue 版本后上述交互未新增控制台错误。
- 此预览未使用真实租户身份、Aims 完整布局或真实 BFF 链；临时依赖别名只用于隔离预览，未改生产依赖配置。加载文案已实现，但慢响应下的完整视觉验收与真实租户联调仍待完成。
- 已核对此前完整 Aims 338 项测试通过。本轮页面修改的相关 ESLint 和类型检查通过；产品接入、空间编辑／归档、成员管理、目录刷新交互，以及需求／功能／优先级／版本等完整后续批次继续实施。

## 2026-09-07：产品空间编辑入口

- 产品空间详情增加定位／目标用户／核心价值及修改说明表单，调用已实现的 PATCH 领域命令。开始编辑时固定 expectedRevision；失败保留输入，相同内容重试复用 Idempotency-Key，成功后刷新空间。归档空间不展示编辑入口。
- 增加 no-store 的产品 permissions 读取，仅返回按当前产品范围核验后的 edit 提示；先要求 view，再复用 Foundation 产品授权检查 edit。权限加载失败单独提示并隐藏操作；页面刷新同时更新权限与空间。命令端授权／并发规则保持独立执行，不能用 UI 提示替代写入验证。
- 相关 ESLint、Aims 类型检查通过。此编辑表单的浏览器交互（保存、取消、版本冲突、网络失败重试）仍待验证；上一轮只读页面的隔离验证不覆盖新增编辑行为。完整产品中心仍在实施，产品接入／成员／目录刷新 UI 和后续规划版本批次未完成。

## 2026-09-07：编辑表单重试与冲突交互验证

- 编辑时保留当前读取内容，增加“读取最新内容”操作。刷新更新对照记录但不覆盖草稿或自动替换编辑 revision；用户核对后显式取消并重新编辑，避免无提示覆盖并发修改。
- Chrome 使用实际页面与隔离合成命令接口，验证首次提交已写入但返回 503 时输入保留、同内容再次提交使用原回执成功；409 保留草稿与错误；读取最新内容后草稿仍在；键盘取消后已保存值未改变。1440px／390px 表单检查通过，控制台未出现错误或警告。
- 本测试证明页面交互，合成服务并不替代真实 BFF／Runtime 幂等和并发测试或真实租户联合验收。既有真实 MySQL 领域测试证据仍按前文记录；未操作业务数据库。后续接入、成员、目录刷新、需求与规划版本完整范围继续实施。

## 2026-09-07：归档与恢复页面操作

- 增加 WorkspaceLifecycle 组件，在产品空间读取页接入归档／恢复；两个动作分别读取服务端范围权限提示。归档仅在 active、恢复仅在 archived 显示，不复用 edit 权限推断敏感动作。
- 原因必填，提交前使用 Foundation useConfirm 展示产品、原因与状态影响；确认后才调用既有命令。固定发起 revision，相同 payload 重试复用幂等键，失败保留原因，成功刷新读取结果。Assets 主档生命周期不随空间状态改写。
- 相关 ESLint 和 Aims 类型检查通过。新增生命周期表单及共享确认弹窗的浏览器联合交互仍待验证，不能沿用上一轮编辑表单的验收结论。完整方案中的接入、成员、目录刷新和后续需求规划版本仍在实施。

## 2026-09-07：生命周期浏览器验证与共享弹窗修复

- 实际页面＋WorkspaceLifecycle＋Foundation useConfirm 在隔离合成服务中验证：空原因不能继续、弹窗取消保留原因且状态不变、确认归档后隐藏编辑并显示恢复、键盘确认恢复后重新显示编辑／归档。1440px／390px 确认弹窗可用。
- 浏览器发现 ConfirmDialog 缺 DialogDescription 警告，已将 message（为空时 title）绑定 UModal description，以 sr-only 保留原正文布局。读取实际 DOM 验证 aria-describedby 指向含产品／原因的描述节点，再打开弹窗未新增警告；修复属于共享组件，所有 useConfirm 使用方会受益。
- 该验证不包含真实租户身份链，也不替代生命周期领域事务／权限回归。完整目标继续，成员管理、产品接入、目录刷新及需求规划版本仍待接通。

## 2026-09-07：产品成员读取面板

- 产品空间详情增加 MemberList，调用既有 members GET；按产品关系／记录状态筛选，服务端 20 条分页，条件变化回第一页。显示 UID、关系、记录状态、当前有效性和起止时间，明确有效关系不是 Directory 在职状态或操作授权。
- permissions 提示增加独立 admin 判断，成员面板仅在对应提示成功且允许时挂载；实际 members API 仍独立检查产品 admin 范围。查询失败和加载中不显示旧行或旧总数。
- 本轮仅接通读取面板；新增／修改／撤销成员表单及列表的浏览器验证仍待完成，不能将成员管理计为完整交付。完整产品中心其他批次继续实施。

## 2026-09-07：成员新增、修改与撤销表单

- MemberList 增加新增／修改／撤销入口，MemberForm 复用 Foundation UserTreeSelector 选择目标用户和继续负责的经理；编辑／撤销 UID 固定，不允许把旧关系改绑其他人。关系类型、记录状态、起止时间和原因显式提交。
- 起止时间使用本地 datetime-local，保留毫秒精度并转为 UTC；结束必须晚于开始，留空表示长期。保留经理必选，说明选择本身不创建经理关系；真正的 Directory active 与变更后有效经理校验仍由现有 BFF／Runtime 执行。
- 表单固定空间 revision 和成员 revision，同内容重试保留幂等键；错误保留输入，撤销通过共享确认，成功刷新成员列表。相关 ESLint、类型检查及 Aims 全套 338 测试通过。
- 人员选择、列表筛选和成员写入的浏览器联合验证仍待完成，不能据静态检查声称成员功能已端到端验收。完整产品中心目标仍包括接入、目录刷新、需求／功能／优先级／路线图／版本等后续批次。

## 2026-09-07：目录刷新操作面板

- 产品列表页接入 CatalogRefresh：启动、每次最多 100 条继续、读取最新状态、确认取消、准备新批次，以及输入自己创建的批次编号恢复处理。不会在挂载或读取状态时自动推进目录，完整 active 返回后刷新产品列表。
- 新增 no-store 全局 product-permissions 读取，复用接入命令的同一全租户 onboard 判断；页面仅在成功且允许时挂载操作面板，权限依赖错误可见。每个刷新命令仍独立鉴权。
- 启动重试保留同一幂等键；continue 提交批次 revision，cancel／status 不附带服务端禁止的字段。失败保留批次信息，可以先读取最新状态后重试。旧目录原子保留语义仍由既有 Runtime 决定。
- 相关 ESLint 和 Aims 全套 338 测试通过；新增面板浏览器验证仍待进行。真实租户联调、成员表单联合验证、产品接入及后续需求规划版本等全部范围继续实施。

## 2026-09-07：目录刷新面板浏览器验证

- Chrome 隔离预览使用实际 CatalogRefresh／列表页面与实际 catalogRefreshInput 校验器，合成 101 条批次。启动保持 0 条未生效；首次继续 100/101 未生效，键盘继续到 101/101 后才显示已生效并切换操作。按可见编号重新读取该批次成功。
- 第二批次经共享确认取消后显示已终止，继续按钮移除；列表仍可读。1440px／390px 布局已查看，控制台无警告或错误。准备新批次时清除上一次错误提示，避免把旧错误呈现为新批次状态。
- 以上仅证明页面状态呈现和请求参数合同，未证明真实 Assets 数据切换或租户授权；实际目录原子激活与回滚证据仍见前述 MySQL 测试。成员交互联合验证、产品接入及后续完整需求规划版本批次继续实施。

## 2026-09-07：产品接入表单

- 产品列表页增加 OnboardForm，在全租户 onboard 提示成功后显示。Assets 候选通过已授权 product-candidates 接口搜索，20 条分页；一次搜索的翻页沿用 watermark，新搜索明确重置，不把用户尚未提交的搜索文本混入翻页。
- 显示产品名称／编码／产品线及不可接入状态，选择后使用 Foundation 目录选择器指定初始经理，原因必填。提交不接收主档字段、用户 actor 或来源证据，后端仍重新核验主档和 Directory；定位等可选信息在已有空间编辑入口维护。
- 失败保留输入，相同内容重试复用幂等键；成功清空表单并刷新列表，不假定创建者自动拥有新产品读取权限。相关 ESLint、类型检查和 Aims 全套 338 项测试通过。
- 候选／选人／接入浏览器联合验证仍待完成；仅 onboard 而没有 products:view 的独立操作入口也需补齐。成员联合验证与后续需求、功能、优先级、路线和版本完整范围继续实施。

## 2026-09-07：仅接入权限的独立入口

- 增加 /product-setup 页面，复用接入和目录刷新组件，独立要求 products:onboard；没有 products:view 但具有 onboard 动作的用户从产品中心菜单进入该页面，避免列表 view 门槛挡住授权的接入工作。
- 页面继续调用全局权限端点校验显式全租户范围；仅有局部 onboard 不会加载操作组件。普通产品列表和详情仍要求 view，不因新增管理入口扩大产品记录读取权限。
- 新增路由权限分离回归；Aims 全套 339 项测试通过。此入口完整导航／会话浏览器联调仍待验证，接入／成员联合测试及全部后续需求规划版本保持未完成状态。

## 2026-09-07：接入选人联合验证与字段关联修复

- 实际 OnboardForm＋Foundation UserTreeSelector 在隔离 Directory／Assets 样本下完成搜索、候选选择、经理选择、原因填写与提交。合成 POST 使用实际 productOnboardInput 校验器检查参数和幂等键；成功后表单收起。1440px／390px 表单查看通过，控制台无警告或错误。
- 发现选择器嵌套 UFormField 时搜索框与复选框复用外层 input ID，导致重复 ID／标签错绑。共享组件改为通过消费应用 #ui 的 useFormField 绑定选择按钮，并隔离后代 inputId 上下文。浏览器在弹层打开时确认重复 ID 为零，经理字段 label 指向 BUTTON，复选框名称为对应人员。
- 最初使用包名导入 helper 在隔离预览中落到 Foundation 的另一份 Nuxt UI 实例，注入不匹配；已改为消费应用 #ui 别名并实测。该共享修复也用于成员表单；成员写入联合流程、真实租户接入链、独立入口会话及后续需求规划版本仍待验证／实施。

## 2026-09-07：成员有效期转换边界

- 修复 datetime-local 在夏令时回拨区间重解析可能将原到期时刻提前一小时的问题。已有本地显示值未变时保留原 UTC instant，浏览器省略零秒也不改变原值；新输入按浏览器较早重复时刻语义解析并在表单显示实际 UTC 预览。
- 新增纯转换 helper，拒绝跳时期间不存在的本地时刻、自动滚动的无效日期、超范围时间和带时区的非本地输入；截止仍需晚于开始。服务端 UTC 校验保持不变。
- America/New_York 明确时区回归覆盖两次 01:30、毫秒保留、浏览器省略秒、春季缺失时刻及无效日期。相关 ESLint、Aims 全套 342 测试通过。成员 UI 联合验证及完整产品中心其他批次仍待完成。

## 2026-09-07：成员变更后空间与权限同步

- 核对 Runtime 成员命令会递增 product_workspaces.revision，发现原 MemberList 成功回调只刷新成员数据，详情仍保留旧空间 revision。MemberList 现向父页发出 changed，父页重新读取空间及 permissions。
- 后续空间编辑／归档因此使用重新读取的 revision；变更操作者自己的经理关系后，页面重新核验 admin 等提示，而非持续使用变更前权限。服务端每条命令独立鉴权与 revision 防护仍保持不变。
- 该调整的完整成员浏览器联合流程仍待验证；不将事件接线当作端到端验收。完整产品中心其余范围继续实施。

## 2026-09-07：成员管理浏览器联合验证

- 实际 MemberList／MemberForm／Directory 选择器在隔离合成服务中完成新增 member1 贡献者、修改为查看者、填写继续负责经理及原因、共享确认撤销。撤销后列表保留记录并显示停用／当前无效，撤销按钮禁用。
- 合成成员服务调用实际 memberChangeInput／memberPageInput，检查请求形状、两个 revision、幂等键和明确经理；成员变更递增空间版本。随后从同页编辑空间保存成功，验证父页刷新确实提供最新 expectedRevision。
- 查看了 1440px／390px 表单，人员选择与时间输入可用；窄屏成员表格保留横向滚动，完整列与操作需横向查看。键盘确认撤销通过，控制台无警告或错误。
- 以上不替代真实 Directory 状态、范围授权、数据库事务、幂等重放与并发校验；这些仍以已有领域回归及待执行真实租户链验收区分。分页／筛选边界、拒绝路径与独立 setup 会话仍需进一步联合验证。后续产品需求、功能、优先级、路线图、版本完整范围继续实施。

## 2026-09-07：产品需求创建领域命令

- 新增 productcenter.RequestDraft 与 CreateProductRequest，初始 decision_status 固定 submitted，revision=1；标题与问题说明必填，来源限定 customer/internal/engineering/other，P0～P3 在录入阶段仅作为建议紧急程度，不直接形成规划决定或版本承诺。
- 创建复用 ExecuteCommand：先按 product_requests:create permit 锁产品根并复核授权事实，再检查 active／空间 revision；需求、空间 revision、创建审计和回执同事务。输入类型不包含决定人、合并目标或交付关联，后续必须由独立命令处理。
- Go productcenter 包测试通过，新增校验覆盖中文长度边界、缺失字段、非法枚举、NUL／无效 UTF-8。该次未启用隔离 MySQL，不能把纯校验与编译通过当作新增 SQL 事务实测。
- 需求 BFF／Runtime 入口、列表详情、修改、证据、决策、合并与转交仍待接通；没有把本命令标为需求池完整交付。后续优先级／路线／功能／版本全部范围继续实施。

## 2026-09-07：产品需求浏览器输入边界

- 增加 productRequestCreateInput，浏览器 camelCase 输入只映射到 RequestDraft 的录入字段；拒绝 decisionStatus、decidedBy、actorUid、productCode、mergedIntoId、authorization 和评分等多余字段。来源／紧急程度只有省略时使用 internal／P2，显式 null 拒绝。
- 校验安全整数空间 revision、中文字符长度、非空标题／问题说明、NUL 和未配对 UTF-16 代理字符。与 Go UTF-8 领域校验对齐，避免无效文本在 JSON 传输时被替换后静默写入。
- Aims 全套 344 测试、相关 ESLint 和类型检查通过；补充 null 用例后专项再次通过。此处仍为输入适配器，需求 HTTP 入口、精确 service grant 扩展及新增 SQL 事务实测尚未接通，不声称创建接口已上线。

## 2026-09-07：需求创建 BFF 与 Runtime 入口

- 增加需求创建 POST 及 Runtime requests:create 调度，严格字段适配、当前产品范围 create 授权、签名 actor 与精确服务能力；不经过通用数据库代理放宽校验。
- Manifest 增加独立服务资源 product-requests:create，Console 生成器补两个 Runtime audience，业务 grant 共 20 条、包含传输前提共 26 条；更新隔离授权测试预期数量。尚未运行新版 SQL 真实数据库测试或目标租户签发。
- Aims 344 测试、类型检查通过，Go Aims 包通过；新增缺签名委托／source／tenant／deployment／client／精确 capability 的前置拒绝测试。创建事务的隔离 MySQL 测试、列表详情及需求完整流程仍待实施，不能标为已上线。

## 2026-09-07：需求创建真实事务与授权 SQL 验证

- 在独立 Unix socket、禁用网络的临时 MySQL 8.0.34 实例执行实际 v5.19 迁移和需求创建命令。新增两项测试以 `go test -race ./internal/apps/aims/productcenter -run TestMySQLRequest -count=1 -v` 通过。
- 验证 submitted 初始状态、空间 revision 递增、刷新授权后的幂等重放、同键异载荷拒绝；强制审计 INSERT 失败后需求／审计／回执和根 revision 全部回滚；归档空间拒绝创建。
- 并发提交同一根 revision 时仅一项成功，另一项在锁内发现授权事实变化而拒绝；成功命令的旧 permit 也不能通过回执重放绕过重新授权。数据库 JSON 回执按解析后内容比较，避免 JSON 列格式化造成测试误报。
- 实际生成的 Console seed／verify 通过隔离 SQL 测试：20 条业务 grant、26 条完整要求，覆盖重复 seed、缺客户端、无关客户端、传输前提、停用 grant 和过期凭证。修正新增能力后的过期凭证断言：Aims 的 22 项失败，Assets 的 4 项仍通过。
- 这是本地数据库证据，未执行目标租户迁移或实际令牌签发。需求列表／详情／修改／证据／决策／合并／转交，以及完整优先级、路线与版本交付仍继续实施。


## 2026-09-07：需求分页与详情读取链路

- 增加产品范围内需求列表／详情 GET、BFF 严格查询适配、Runtime 只读 POST 与 `aims:product-requests:read` 精确能力；使用既有 Foundation 授权 helper，不增加第二套角色算法。
- 列表支持状态／来源／紧急程度及字面关键词、稳定倒序和有界分页。详情用产品编码与 biz_id 双重定位，保留可空决策字段。两者锁产品根复核当前事实，无审计／回执或业务写入。
- 真实 MySQL 加 race 检查通过需求读取与创建共 3 项测试：两页顺序、总数、字面 `%_`、组合筛选、空数组、详情空值、跨产品 404 对应 ErrNoRows、错误动作拒绝及读取无写入。创建回归同时通过。
- Aims 查询输入／grant 生成器 4 项测试与类型检查通过；Console 实际 SQL 更新为 22 条业务 grant／28 项要求并通过隔离验证。未执行目标业务数据库迁移。
- 需求 UI、修改、证据、评审、合并、转交仍未完整交付；优先级／路线／版本等后续范围保持不变。

## 2026-09-07：需求修改领域事务

- 增加 RequestEdit／EditProductRequest，要求产品空间和需求双 revision、规范 biz_id、非空修改原因，以及独立 product_requests:edit 授权。仅修改录入字段，不接受或覆盖评审状态／决定人／决定时间。已合并需求拒绝修改，归档空间沿用拒绝规则。
- 修改递增关联规划事项的 evidence_revision 与 revision，使冻结旧证据版本的评估需要复评；不改决定队列、历史评估或版本承诺。需求前后值与原因写入审计，并与根 revision／证据 revision／命令回执同事务。
- 独立 MySQL 8.0.34 的 4 项需求事务测试加 race 检查通过，新增覆盖采纳决定保留、双版本冲突、重放不重复递增、审计失败连同证据变更回滚、已合并记录只读。Go Aims 全包通过，修改输入边界测试通过。
- 此处完成领域命令；修改 BFF／Runtime 入口、服务能力与页面仍待接通，不能视为在线需求编辑已交付。需求证据／评审／合并／转交与完整优先级、路线和版本范围继续实施。

## 2026-09-07：需求修改入口与精确服务授权

- 接通 PATCH 需求接口与内部 requests:edit Runtime 调度。浏览器输入要求双 revision 和原因，来源／紧急程度必须显式提交，不沿用创建默认值覆盖已有信息；业务决定字段和伪造 actor／授权字段拒绝。
- 使用 product_requests:edit 产品范围授权及 aims:product-requests:edit 精确服务能力。Manifest／生成器／Console seed／verify 同步增加两个 audience 的 edit grant，共 24 条业务 grant／30 项完整要求。
- 输入／生成器 5 项测试、Go Aims 包、相关 ESLint 通过；实际新版 SQL 在隔离 MySQL 通过缺客户端、幂等安装、无关客户端、传输前提、停用 grant 和过期凭证检查。新增 Runtime 缺签名委托／来源／租户／部署／客户端／capability 的前置拒绝测试通过。
- 在线页面及真实租户签发链仍未验收；需求完整流程和后续产品规划／优先级／路线／版本范围继续实施。

## 2026-09-07：需求评审决策领域命令

- 增加 RequestDecision／DecideProductRequest，独立要求 product_requests:decide、需求和产品双 revision，复用根锁授权、审计和幂等回执事务。普通修改不能代替评审决定。
- 状态矩阵按主方案实现：submitted→evaluating；evaluating→accepted/deferred/rejected；deferred→evaluating；accepted→evaluating/rejected。merged 与 rejected 不提供本命令恢复入口；合并走后续独立命令。
- 首次进入评估可无原因，其余转换必须有原因；撤回采纳必须附 impact_note，并保存在决定前后值审计中。操作者与时间由受信 actor／数据库产生。决定不创建版本范围、不撤销项目执行，仅递增关联事项证据 revision 供复评。
- 真实 MySQL 与 race 检查通过 5 项需求事务回归及 1 项完整状态矩阵测试，覆盖采纳记录、决定人／时间、重放、影响说明必填、强制审计失败回滚和影响说明持久化。接口错误映射增加状态冲突 409。
- 本次为领域命令；decision 的 BFF／Runtime 服务入口、服务授权和页面仍待接通，合并／证据／转交及全部规划、优先级、路线与版本范围继续实施。

## 2026-09-07：需求评审接口与独立权限

- 接通 decision POST、严格浏览器字段适配与 requests:decide Runtime 调度，复用已实现 DecideProductRequest。用户资源 product_requests:decide 与服务能力 aims:product-requests:decide 分别检查，签名 actor／短期授权事实沿既有链路传递。
- Manifest 与生成器增加两个 Runtime audience 的 decide grant，实际 SQL 现为 26 条业务 grant／32 项要求，隔离 MySQL 验证通过。未对目标租户数据库执行安装或签发探测。
- 查询／创建／修改／决定输入及生成器共 6 项测试、Aims Go 包、类型检查、相关 ESLint 通过。新增缺 actor 委托／来源／租户／部署／客户端／capability 前置拒绝，以及 edit capability 不能调用 decide 的测试。
- 页面、需求来源证据、合并、删除约束、交付转交和完整规划／优先级／路线／版本功能仍待后续完成，不以接口编译或本地 SQL 通过标为完整产品中心交付。

## 2026-09-07：需求池读取页面

- 新增 `/products/:productCode/requests`，产品概览增加需求池入口。为避免 Nuxt 父页拦住子页渲染，将原 `[productCode].vue` 移到 `[productCode]/index.vue`，产品概览 URL 不变。
- 需求列表使用实际 GET 接口，支持关键词／决定／来源／紧急程度与 URL 同步分页；加载／失败时清空可见旧行，总数只在成功后显示。需求详情从当前列表记录展开到 UModal，展示问题、决定原因、决定人和时间。
- 浏览器在本地隔离 Nuxt + 合成服务验证了实际页面：43 条记录的末页 3 条、详情弹窗、Escape 关闭、关键词搜索、503 错误无旧行和空结果。合成查询调用实际 productRequestPageInput。桌面截图已检查；移动端和完整 Aims shell／真实会话链仍待验证。
- 页面相关 ESLint 通过。新增／编辑／评审表单尚未挂接；该页面目前为读取阶段，不代表需求池完整交付。产品规划／优先级／路线／版本及其余原计划仍保持完整范围。

## 2026-09-07：需求创建与编辑表单接入

- RequestForm 复用 Nuxt UI 表单控件，挂到需求池创建弹窗与详情编辑入口。创建默认 internal／P2，编辑完整保留原标题／问题／来源／紧急程度且必须填写原因；已合并项没有编辑入口。
- 新增需求权限提示 GET，按 product_requests:view 和各独立动作计算提示；只有权限成功且产品 active 时显示创建／编辑入口。页面刷新同时重读列表与权限，每次写入仍由 BFF／Runtime 重新授权。
- 打开表单固定根与需求 revision，相同载荷重试复用幂等键；保存期间禁止关闭，失败保留输入，成功关闭并刷新列表／权限、显示成功提示。当前冲突恢复为保留输入供复制，取消后刷新重开，不自动覆盖最新版。
- 隔离 Nuxt 服务调用实际创建／编辑输入解析器，在浏览器完成新增“跨应用通知归集”、列表出现、编辑为“跨应用通知归集与去重”及填写原因、列表更新；桌面弹窗截图检查通过。临时服务原有 code／productCode 参数冲突已统一，仅调整验证目录。
- 类型检查和相关 ESLint 已在首次接入后通过；移动端、超时后重试／并发冲突浏览器场景、真实 Directory／Console／Runtime 链路仍须继续验收。评审表单、证据、合并、删除、转交和完整规划／优先级／路线／版本范围继续实施。

## 2026-09-07：需求评审表单接入

- 新增 RequestDecisionForm，按当前 submitted／evaluating／accepted／deferred 状态展示允许决定；rejected／merged 不显示入口。入口须独立 decide 提示成功且产品 active，每次提交仍由后端重新授权与验证状态。
- 首次进入评估原因可选，其余必填；撤回采纳要求影响说明。通过 Foundation useConfirm 展示需求、目标决定、原因和影响后确认，载荷相同重试复用幂等键，表单打开时固定双 revision，保存期间锁定关闭。
- 浏览器隔离服务调用实际 productRequestDecisionInput，完成已采纳需求重新进入评估、填写原因／影响、共享确认框 Enter 确认、列表变为评估中；桌面确认截图检查通过。合成服务仅验证 UI 与输入合同，领域状态矩阵以既有 MySQL／Go 测试为证据。
- 初轮类型检查发现 confirm tone 不支持 primary，已修为 default；相关 ESLint 已通过。移动端、取消确认、失败重试、真实会话端到端尚待进一步验证。来源证据／合并／删除／转交与完整产品规划、优先级、路线、版本范围保持进行中。
- 补充验证：评估中需求选择采纳、填原因并打开确认框后，Escape 取消确认返回原表单，原因完整保留且按钮恢复可用。修正 tone 后类型检查通过。

## 2026-09-07：人工来源证据领域命令

- 新增 ManualRequestSource／AddManualRequestSource，要求 product_requests:edit、产品／需求双 revision；支持说明、可空证据日期、事实／假设和支持／反对／中立方向。无日期时保留未知，非法日历日期拒绝。
- 人工录入固定 source_type=manual、verification_status=unverified，source_app/source_biz_id 为空。选择 fact 只说明证据类别，不授予外部引用已验证状态，正式应用引用继续依赖后续集成契约。
- 来源写入、需求 revision、关联事项 evidence_revision、根 revision、审计和回执同事务；归档空间与已合并需求拒绝添加，重放不重复写入证据或递增版本。
- 真实隔离 MySQL + race 检查通过来源字段可信度、反对事实、日期保存、关联证据版本递增、幂等重放和强制审计失败回滚；输入边界测试通过。
- 本次为领域事务，来源列表／HTTP 入口／删除与 UI 仍待接通。需求合并、转交与原计划全部规划／优先级／路线／版本工作继续实施。

## 2026-09-07：来源证据分页读取链路

- 新增 ListRequestSources 与用户 sources GET、内部 request-sources:list POST。使用 product_requests:view／精确读取服务能力，解析产品内需求后有界分页，并返回双 revision。人工／外部引用字段及验证状态明确分离。
- 真实 MySQL 来源测试增加第一页内容、总数、第二页空数组、双 revision、跨产品 ErrNoRows 和错误动作 permit 拒绝，race 检查通过；新增 Runtime 缺读取 capability 拒绝与读取传输 scope 断言通过。
- 相关 ESLint 通过。证据添加领域命令已有数据库证据，但添加 HTTP、来源列表 UI、删除规则及其余产品中心全范围仍继续实施。

## 2026-09-07：人工证据添加 HTTP 与服务授权

- 接通 sources POST、严格输入适配与 request-sources:create Runtime 调度；用户 edit 授权与独立 source-create 服务能力分别检查，复用已验证人工证据事务。
- 输入拒绝外部引用／verified／操作者伪造，未知日期保持 null；事实和验证状态不混淆。Manifest 与授权生成器新增两个 audience 的 capability，Console seed 28 条业务 grant、verify 共 34 项。
- 新输入与生成器测试通过、Go Aims 包与类型检查通过，Runtime 缺签名委托／来源／租户／部署／客户端／精确能力的前置拒绝通过。实际新 SQL 在隔离 MySQL 通过所有授权安装／验证场景；未执行业务数据库安装或真实签发探测。
- 来源 UI 与删除、需求合并／转交、产品功能／优先级／路线／版本及其余原计划范围继续实施。

## 2026-09-07：需求详情来源证据列表

- 新增 RequestSourceList 并挂到需求详情，调用真实 sources GET、每页 10 条。加载／失败不保留旧证据卡片，提供独立刷新、总数、分页及空页说明；切换需求重建组件与页码。
- 分别显示事实／假设、支持／反对／中立、验证状态，人工来源显示“人工说明”，未知日期显示“未知”；来源引用仅展示文本，不将未经核验的业务键变成可操作外部链接。
- 实际组件在隔离 Nuxt 服务完成 12 条证据浏览、末页 2 条、未知日期、反对事实与未验证标签检查；桌面详情截图可读且在弹窗内滚动。类型检查与相关 ESLint 通过。
- 添加证据表单、删除、错误与移动端浏览器场景仍待完善；真实租户链与原计划其余产品中心功能继续实施，未缩小交付范围。

## 2026-09-07：人工来源证据表单

- 新增 RequestSourceForm，需求详情在 edit 提示成功、产品 active、需求未合并时提供添加入口。表单默认 assumption／neutral，证据日期留空传 null，显示固定未验证说明；不提供外部应用或 verified 字段。
- 打开时固定需求／空间 revision，同载荷失败重试保留幂等键，保存期间不可关闭，失败保留输入，成功刷新需求与权限。后端仍执行当前授权与事务规则。
- 在隔离 Nuxt 合成服务中，实际表单调用实际 productRequestSourceInput，完成说明录入、选择支持、日期留空、保存并重新查看；新增证据显示假设／支持／未验证／日期未知。桌面截图检查通过，相关 ESLint 与类型检查通过。
- 移动端、失败重试、并发冲突 UI、真实租户链仍待验证；来源删除、需求合并／删除／转交及全部产品规划、优先级、路线与版本范围继续实施。

## 2026-09-07：人工来源证据删除领域事务

- 新增 RequestSourceDelete／DeleteManualRequestSource，使用独立 product_requests:delete，要求产品／需求／证据三组 revision 与原因；证据 ID 必须属于当前产品内指定需求。
- 首批只删除 manual、无正式外部引用且 unverified 的来源说明；verified／外部引用返回契约维护要求，已合并需求和归档产品拒绝。删除前值与原因进入不可变审计，来源行删除与需求／关联证据／根 revision、回执同事务。
- 真实 MySQL + race 验证通过 edit permit 不足以删除、已验证引用拒绝、审计故障删除回滚及根版本不变、正式删除、幂等重放、原说明与原因在审计保留；来源创建／读取回归同时通过。
- HTTP、精确服务 capability、删除确认表单仍待接通。需求合并、无引用草稿删除、转交及完整产品规划／优先级／路线／版本范围继续实施。

## 2026-09-07：来源删除 Runtime 入口

- 新增内部 POST `/v1/aims/internal/products/{code}/request-sources:delete`，接入既有 `DeleteManualRequestSource` 事务；严格解码输入与授权凭据，绑定当前用户和幂等键。
- 在访问数据库前验证委托身份、来源应用、租户、部署、服务客户端及精确 `aims:product-requests:source-delete` 能力。编辑、添加来源、读取及通配能力均不能代替删除能力。
- 验证：`go -C data-runtime test ./internal/apps/aims/...` 通过；新增权限负例后运行 `go -C data-runtime test ./internal/apps/aims -run 'TestRequestSourceDelete' -count=1` 通过。本轮未重跑隔离 MySQL 事务测试，未进行真实租户调用。
- 尚需接通 BFF、服务授权清单和页面删除确认；本记录不代表来源删除端到端完成，也不代表产品中心整体完成。

## 2026-09-07：来源删除 BFF 与服务授权合同

- 新增 DELETE `/api/v1/products/{productCode}/requests/{requestId}/sources/{sourceId}`，要求 `product_requests:delete`、幂等键、三层 expected revision 和删除原因；通过现有租户 Runtime 客户端绑定当前身份，不增加本地数据库路径。
- 严格拒绝非规范／不安全数值来源 ID、无效 UUID、缺失版本、非法文本及额外身份／授权字段。
- Manifest 与授权生成器增加精确 `aims:product-requests:source-delete`；生成的 Seed 为 30 条业务授权，Verify 为 36 个组合（含 6 个传输前提）。对应说明和隔离 SQL 测试同步更新。
- 验证：来源输入、manifest、生成器测试共 6 项通过；Aims typecheck 及修改 TS 文件 ESLint 通过；隔离 Unix socket MySQL 执行实际生成 SQL 通过 36 项精确要求及幂等、缺失客户端、伪同名客户端、失效授权、过期凭据用例。未向业务环境安装授权。
- 页面删除入口与确认交互尚待完成；真实租户端到端调用未验收。

## 2026-09-07：来源证据删除页面接入

- 需求动作权限响应新增独立 delete 提示；需求详情只在产品可写、非合并需求且有删除权限时提供证据删除入口。证据列表进一步限定未验证、无外部引用的人工记录，后端仍重新授权。
- 删除原因表单使用 Foundation `useConfirm()` 展示原文、原因及复评影响。请求冻结列表返回的产品／需求版本和证据版本；同一输入重试复用幂等键，失败保留原因，不自动用新版本覆盖冲突。
- 删除成功触发需求列表与权限刷新；提交期间禁用证据刷新、翻页、取消及详情弹窗关闭。
- 验证：修改 Vue／权限接口 ESLint、Aims typecheck、diff 空白检查通过。桌面与移动浏览器交互尚未验收，不能据静态检查宣称端到端完成；下一步补充删除、取消、冲突及无权限场景的真实浏览器验证。

## 2026-09-07：来源删除桌面交互验证与提交保护

- 修复删除提交期间仍可通过添加证据／评审／编辑需求切走详情的问题：动作按钮和处理函数同时保护，统一页面刷新也遵守提交状态；确认前固定请求地址，避免异步确认期间上下文变化影响目标。
- 冲突说明明确要求复制原因、取消、刷新并核对新证据后重新发起；不默默替换冻结的版本号。
- Aims typecheck 与相关 ESLint 通过。Chrome 本地虚构数据完成打开详情、填写原因、查看原文及原因确认、确认删除、重开详情验证总数从 12 变为 11；确认期间证据按钮和分页禁用。测试 fixture 使用正式 BFF 输入校验器，但采用内存响应，不替代实际 Runtime／Console 授权验证。
- 本地预览进程已停止。移动端、取消／冲突交互与真实租户验证仍待完成。

## 2026-09-07：需求合并领域事务

- 新增 `RequestMerge`／`MergeProductRequest`，绑定 product_requests:merge 命令、decide 用户动作、产品根锁和幂等审计事务；要求同产品的源／目标 UUID、产品及两条需求 revision、原因；已采纳源需求还须影响说明。
- 拒绝自合并、已有合并出口的源／目标记录，避免形成环；源需求转 merged 并保留原始来源证据，目标 revision 递增，关联两端的规划事项 evidence revision 失效。合并不自动改变既有项目工作或版本范围。
- 验证：Aims Go 包测试通过；隔离 MySQL `-race` 实测编辑权限拒绝、自合并拒绝、审计失败回滚、成功合并及幂等重放、源证据保留、反向合并成环拒绝。测试数据库仅使用既有专用临时 Unix socket，测试后关闭。
- 尚需补齐 HTTP／BFF／授权清单、目标选择与确认页面、合并来源展示和去重计数，并进一步验证跨产品／并发／多级合并。PC-05 和整体方案均未完成。

## 2026-09-07：需求合并 HTTP 与精确服务权限

- 新增 `POST /api/v1/products/{productCode}/requests/{requestId}/merge`，经现有统一产品授权的 decide 动作后委托 Runtime `/v1/aims/internal/products/{code}/requests:merge`。固定绑定当前用户、15 秒凭据和幂等键，严格拒绝身份覆盖、额外字段、自合并、非法 UUID／版本／原因。
- Runtime 在数据库访问前校验完整服务身份及精确 `aims:product-requests:merge`；普通 edit／decide／read／source-create 和通配能力不能替代。内部 command identity 为 product_requests:merge。
- Manifest、生成器及 Seed／Verify 同步：32 条业务授权，38 个验证组合（包含 6 个传输前提）；未向业务环境安装。
- 验证：输入与 manifest／生成器 5 项测试、Aims Go 包、相关 ESLint、Aims typecheck 通过；隔离 MySQL 实际运行生成 SQL，38 个组合及缺失、停用、过期、幂等与伪同名客户端用例通过，测试服务已关闭。
- 尚需合并目标选择／确认页面、合并来源链路展示与去重计数，以及真实租户端到端验证。

## 2026-09-07：需求合并页面接入

- 新增 `ProductsRequestMergeForm`，由需求详情在 decide 权限、产品可写、源需求未合并时打开；选择同产品目标、显示源／目标问题说明，支持分页与关键词搜索。页面明确匹配总数包含自身／已合并记录，当前页不允许选择这些记录。
- 原因必填；已采纳需求影响说明必填。使用 Foundation `useConfirm()` 展示合并方向、理由、影响以及原记录／证据保留规则，提交冻结的产品、源及目标 revision；失败保留输入，同 payload 重试复用幂等键。
- 提交中禁止修改目标与文本、翻页或取消；成功刷新需求与权限，源需求按既有 merged 状态只读。
- 验证：Aims typecheck 通过；发现并修复一处多语句行 lint 错误，相关 Vue ESLint 复查通过，diff 空白检查通过。尚未执行该合并表单桌面／移动浏览器验收，不视为端到端完成；来源链路展示与去重仍待实现。

## 2026-09-07：合并记录与独立需求计数

- 需求分页返回新增 `unmerged_total`，与 total 使用同一授权、筛选和产品锁下的聚合查询；total 保留全部记录供分页，unmerged_total 排除 merged。筛选只命中已合并来源时未合并计数为 0，不冒充未命中的目标需求数。
- 需求池分别展示记录总数与未合并需求数，严格检查新响应字段；同步读取合同和本地 UI fixture。合同中的过期授权数量改为引用统一服务授权说明，避免多处数字漂移。
- 隔离 MySQL -race 验证两条需求合并后 total=2、unmerged_total=1；只看 merged 时 total=1、unmerged_total=0，分页及原读取无写入回归通过。Aims typecheck、相关 ESLint 和 diff 检查通过。
- 此计数不等同于完整规划事项去重：合并来源链路展示、多级来源解析和规划评分去重仍需继续完成。

## 2026-09-07：合并路径读取与详情展示

- 需求详情在同一授权根锁事务内读取 merge_trail，保留 A→B→C 历史方向；每跳限定当前产品，检测已访问 ID，最多 64 层并显式标记截断。列表不逐行展开，避免分页查询放大。
- 已合并需求详情新增路径组件，通过既有受保护的详情接口读取。显示各级标题与最终目标；截断时明确尚未定位最终目标，错误不显示旧链路，可重试。
- 隔离 MySQL -race 实测二次合并路径顺序、原证据保留、循环损坏数据拒绝及原需求读取回归通过；Aims Go 包、Vue ESLint、Aims typecheck、diff 空白检查通过。64 层截断和跨产品损坏引用仍需专项用例；页面桌面／移动浏览器未验收。
- 合并目标的入向来源汇总、规划评分去重及完整端到端验收尚待继续。

## 2026-09-07：目标需求的直接合并来源查询

- 现有需求列表 BFF 增加可选 mergedInto 规范 UUID，内部映射 merged_into_biz_id；Runtime 在授权根锁内按当前产品解析目标 ID，再对分页／计数统一添加 merged_into_id 条件。不接受前端传内部数字 ID。
- 查询保留直接合并关系：A→B→C 时 B 的直接来源为 A，C 的直接来源为 B；不把递归祖先混成未经去重的来源条数。后续页面可逐层查看，递归证据汇总仍待实现。
- 验证：BFF 输入测试 6 项通过；隔离 MySQL -race 验证多级关系两端的正确来源、分页及未合并计数，并通过原合并／读取回归；Aims typecheck、相关 ESLint、diff 检查通过。该来源筛选的跨产品目标专项负例尚待补充。
- 本轮完成查询合同与实现，尚未接目标侧来源列表 UI；完整产品中心仍在实施中。

## 2026-09-07：目标侧来源列表与逐层查看

- 新增 `ProductsRequestMergedSources`，需求详情加载分页直接来源，显示原标题、合并原因和总数；无数据、加载、错误与重试分别处理，不把陈旧响应当当前结果。请求复用已有授权列表接口的 mergedInto 筛选。
- 来源标题可打开原需求详情，沿用来源证据和合并路径组件；维护当前详情内的上级历史并提供返回按钮，关闭详情后清空历史。删除提交期间禁止切换来源与返回。
- 抽取共享 ProductRequestRecord 类型，页面与来源列表使用同一结构；来源响应校验产品归属及 merged 状态。
- 相关 Vue／类型 ESLint 与 diff 检查通过；Aims typecheck 结果见本轮验证输出。桌面／移动端逐层浏览尚未实际验收，递归证据自动汇总与评分去重仍待完成。

## 2026-09-07：合并链路长度与跨产品边界实测

- 新增隔离 MySQL 测试，以 66 条虚构需求构造长链：65 条边读取返回 64 层且 truncated=true；恰好 64 条边则完整返回且 truncated=false，末项为真实终点。
- 直接合并来源查询传入另一产品的有效目标 UUID 返回 sql.ErrNoRows。数据库联合外键 fk_pc_request_merge 阻止跨产品目标引用（MySQL 1452），原链不被改变。
- 首次测试尝试构造损坏跨产品边被该外键拒绝，随后将此行为修订为明确验证断言，未关闭外键或削弱生产约束。测试不宣称覆盖关闭约束后的损坏库。
- `go test -race` 的边界测试与原合并事务回归通过；diff 检查通过，隔离 MySQL 已关闭。此前缺失的 64 层边界和来源筛选跨产品负例已补齐；页面交互及规划业务其余范围仍未完成。

## 2026-09-07：规划事项创建领域事务

- 新增 PlanningItemDraft／CreatePlanningItem：标题、本次范围、投资类别、紧急程度建议及最多 100 条带版本的来源需求；拒绝重复关联／非法标识，同产品查询来源并拒绝已合并源记录。工程治理事项允许无客户需求来源。
- 使用 product_priorities:edit 用户权限、product_priorities:create 内部命令身份与既有根锁／审计／幂等框架。事项初始 proposed，scope/evidence/revision 均为 1，不自动评分、选入周期或写版本。
- 隔离 MySQL -race 验证错误资源授权拒绝、审计失败全回滚、成功关联来源、幂等不重复、无来源治理事项创建、无自动队列写入通过；Aims Go 包与 diff 检查通过，测试服务已关闭。
- 此为 PC-06 基础领域创建增量；长期功能／期限字段、事项读写接口、页面、周期评估与决策流程仍需继续接通，不能据此宣称规划功能完成。

## 2026-09-07：规划事项列表领域读取

- 新增 PlanningItemRecord／PlanningPageQuery／ListPlanningItems，支持有界分页、字面关键词、生命周期与投资类别过滤；同一产品根锁内完成 product_priorities:view 授权、计数和分页，返回 workspace revision。未知功能和截止日期保持 NULL。
- 读取不生成评分、队列或回执，空结果 items=[]；不接受需求查看权限替代规划查看权限。
- Aims Go 包通过；隔离 MySQL -race 实测创建后的分页顺序／总数、分类与状态组合筛选、字面 %_ 空结果、nullable 日期及资源权限隔离通过，创建事务回归同时通过；diff 检查通过，测试 MySQL 已关闭。
- 规划 HTTP／BFF、详情与编辑、页面及周期评估仍待实现，本轮仅完成领域列表读取。

## 2026-09-07：规划创建与列表 Runtime 入口

- 新增内部 POST planning-items:create／planning-items:list，分别委托规划创建事务和领域列表，严格解码 input／authorization。创建要求精确 aims:product-priorities:create，读取要求 aims:product-priorities:read；需求服务能力和通配符不能替代。
- 列表纳入只读 POST 传输范围 aims.read，创建仍走写入传输；嵌套伪路径不能利用只读识别。
- Aims／productcenter／server Go 测试通过，覆盖身份字段缺失、错误能力和传输路由。测试最初对缺少 current_user 的状态码预期错误，核对 requireCurrentUser 后按既有 401 修正；未更改授权实现来迁就测试。
- 仍需 BFF、manifest／服务授权清单、页面与真实租户调用；本轮不表示规划接口端到端可用。

## 2026-09-07：规划创建与列表 BFF

- 新增 GET／POST planning-items，复用统一产品权限（view／edit）、租户 Runtime 客户端及精确 product-priorities read／create 能力。创建绑定幂等键及当前用户；不恢复应用本地数据库。
- 新增 productPlanningInput 严格校验器：有界文本、分类、分页、来源 UUID／revision／唯一性；拒绝评分、生命周期决定、身份和未知字段。无来源时明确传空数组。
- 输入测试 2 项通过；相关 ESLint 通过。新增路由触发 Nitro 对既有动态跨应用 $fetch 的类型推导深度问题，已为 codocsApi 的动态 URL 调用及需求评审 workflow 查询显式提供 string 请求类型，保留原响应类型和运行时行为。文档服务合同回归 7 项通过，最终 Aims typecheck 通过。
- Manifest／服务 grant 尚未加入 product-priorities read／create，规划页面亦未完成，因此不能宣称接口已在真实租户可用。

## 2026-09-07：规划服务授权清单验证

- Manifest 新增内部 product-priorities create／read 资源能力；Console Seed／Verify 生成器分别为 data-runtime 与 tenant-runtime audience 安装精确能力，不授予用户角色服务权限，不扩展传输前提。
- 当前 36 条业务 grant、42 个验证组合；统一授权说明与隔离 SQL 测试同步，规划跨模块合同已补齐。
- Manifest／生成器测试 4 项通过；隔离 MySQL 执行实际生成 SQL，验证 42 项、缺失与伪同名客户端、传输前提、停用授权、过期凭据及幂等 Seed 均通过；diff 检查通过。未对真实租户安装 grant。
- 规划列表／创建页面、详情编辑、周期与评分决策仍待继续完成。

## 2026-09-07：规划事项列表页面

- 新增 `/products/:productCode/planning`，从产品空间进入，接真实 planning-items BFF；复用 useListPage／useDebouncedSearch，支持关键词、生命周期、投资类别、URL 同步分页及重置。
- 列表展示范围标题、类别、状态、紧急程度建议与未知期限，点击打开本次范围详情。加载失败清空表格且不显示成功计数；搜索或刷新关闭旧详情，不将候选排序当已决定优先级。
- Aims typecheck 通过；修复两处多语句行 lint 后，相关页面 ESLint 与 diff 检查通过。尚未完成该页面桌面／移动浏览器验收。
- 当前页面为规划列表与范围阅读，事项创建表单、编辑／来源维护、周期／评分／决策仍待接入，不表示规划流程完成。

## 2026-09-07：规划事项创建表单与页面权限

- 新增 planning-items/permissions 只读提示，使用统一 product_priorities:view／edit；页面在有效授权、产品 active 且列表读取成功时显示创建入口，写命令仍重新授权。
- 新增 PlanningItemForm 与非随意关闭的创建弹窗，录入标题、范围、类别、紧急程度建议；冻结打开时产品 revision，同 payload 重试保持幂等键，失败保留输入，成功刷新事项与权限。
- 当前表单以空来源数组创建事项，需求来源选择尚待接入，不能据此宣称完整创建流程完成。创建仍不自动评分／选入周期／承诺版本。
- 相关 Vue／BFF ESLint、Aims typecheck 与 diff 检查通过；桌面／移动浏览器创建交互尚未验收。

## 2026-09-07：规划创建的来源需求选择

- 新增 PlanningRequestPicker，按需调用受保护需求列表，支持字面关键词、10 条分页、多选／移除、100 条上限和 UUID 去重；结果展示标题／问题，已合并需求禁选，选中来源在翻页后保留。
- PlanningItemForm 提交选中时的 bizId／revision；保存期间禁止选择修改，来源查询失败不清空已选输入，也不妨碍无来源工程事项的创建。无需求 view 权限时查询仍由原 BFF 拒绝。
- 修复 success 模板分支内冗余 pending 比较导致的 TS2367 后，相关 Vue ESLint、Aims typecheck 通过。桌面／移动端创建及来源多选尚待浏览器验收。
- 来源选择已替换上一轮固定空数组；长期功能与期限字段、事项编辑、周期／评分／决策和真实租户验证仍未完成。

## 2026-09-07：规划来源约束及部分写入回滚验证

- 扩充规划创建隔离 MySQL 测试：过期来源 revision 拒绝；重复 UUID 拒绝；真实存在于另一产品的需求不能关联。
- 跨产品用例先关联合法来源，再遇到非法来源，验证事务失败后规划事项及关系表均无残留；同一幂等键在这些失败后仍可完成后续合法创建，原创建／列表回归保持通过。
- `go test -race ... -run TestMySQLPlanningItem -count=1 -v` 通过，diff 检查通过；测试服务已关闭，未接触真实业务库。
- 本轮补强来源事务证据，页面浏览器验收、事项编辑与周期评分仍需继续完成。

## 2026-09-07：规划事项详情领域读取

- 新增 ReadPlanningItem／PlanningItemDetail，在同一产品根锁与 product_priorities:view 授权下读取事项、产品 revision 及来源需求 UUID／当前 revision；逐项范围限定当前 product_code。
- 来源关联为空返回 []，以 101 条探测超过 100 的完整编辑上限，超限明确拒绝，不返回截断列表供覆写。详情不展开需求正文，需求正文仍走原需求授权入口。
- 隔离 MySQL -race 验证创建后版本及来源、授权另一产品仍不能读取当前事项（ErrNoRows），既有创建／列表回归通过；diff 检查通过，测试服务已关闭。
- 此为详情领域能力；HTTP／BFF、页面详情替换及编辑命令仍待接通。超限来源专项测试与真实租户验证未完成。

## 2026-09-07：规划详情 HTTP 与 Runtime

- 接通 GET planning-items/{itemId} → 内部 POST planning-items:view，严格校验 UUID 与额外查询参数；使用 product_priorities:view 和现有精确 read capability，无新增 grant。
- Runtime 在读库前执行既有签名用户／服务身份及能力校验，路径纳入只读传输识别；数据由已验证的 ReadPlanningItem 领域函数读取。
- Aims／productcenter／server Go 测试、相关 BFF ESLint、Aims typecheck、diff 检查通过。详情路径纳入缺失身份、错误能力及嵌套伪路径测试。
- 页面尚需从列表快照切换到详情读取，编辑流程未接通；真实租户端到端未验收。

## 2026-09-07：规划详情页面改为实时读取

- 新增 PlanningItemDetail，规划列表弹窗按产品与事项 ID 读取详情接口，替代仅展示列表 scope 快照；显示最新范围、状态、类别、紧急程度建议、nullable 期限和关联来源数量。
- 响应校验事项及产品身份；加载／错误时不显示旧内容，支持刷新重试。来源正文不由规划详情越权展开，提供需求池入口；逐条关联来源查看仍待增强。
- 相关 Vue ESLint、Aims typecheck、diff 检查通过；桌面／移动浏览器详情交互仍未验收。
- 事项编辑、来源维护、周期／评分决策及整体产品中心仍在实施中。

## 2026-09-07：规划编辑输入与事务读取基础

- 新增 PlanningItemEdit 校验：复用创建范围／来源规则，要求事项 UUID、expectedItemRevision、修改原因，约束原因与影响说明的 Unicode／长度。
- 将规划详情的 SQL 加载抽成 loadPlanningItemDetail，读取入口仍先执行 view 授权并持有产品根锁；后续编辑可在 edit 授权事务中复用，不另开事务读取旧状态。
- Aims Go 包及新增输入负例通过，diff 检查通过；本轮未重跑隔离 MySQL。尚未实现编辑写事务，范围变化的评估失效与已承诺版本合同必须继续接入，不能把输入类型视为编辑功能完成。

## 2026-09-07：规划事项编辑事务

- 新增 EditPlanningItem，使用 product_priorities:edit 命令和 edit 用户授权，产品／事项 revision 双重检查；归档产品及终态事项拒绝修改，已选入或交付中事项要求影响说明。
- 更新范围、类别、紧急建议与有界来源集合，递增 scope／evidence／item／workspace revision；前后快照、原因、影响、来源替换和回执同事务。保留历史评估与决定，不直接改变队列或版本范围。
- 隔离 MySQL -race 验证审计失败回滚原来源和事项、成功替换来源及版本递增、重复提交回执复用；既有创建／读取回归通过。Aims Go 包及 diff 检查通过，测试服务已关闭。
- 尚需精化仅实际变化才递增相应 revision、来源关系保留审计时间、已选／闭期／版本承诺联动用例，以及 HTTP／页面接入。此事务为实施中增量，未完成完整编辑与版本变更合同。

## 2026-09-07：规划编辑差异更新

- 来源关系由全删重建改为按 UUID 差异增删，未变化关系保留原创建者／时间；来源集合变动才增加 evidence revision。
- 范围、类别或紧急程度变动增加 scope revision，标题修改仍记录事项／根 revision 和审计；完全相同的事实保存返回当前状态，不增加业务版本或制造评估失效，仍由命令回执保证幂等。
- 隔离 MySQL -race 回归通过，新增相同事实使用新幂等键提交后事项／scope／evidence／workspace revision 不变断言；原审计回滚及来源替换用例继续通过。diff 检查通过，测试库已关闭。
- 来源保留时间的独立断言、已承诺版本流程和编辑 HTTP／页面仍需完成。

## 2026-09-07：规划编辑 Runtime／BFF 接入

- 新增内部 planning-items:edit 与 PATCH planning-items/{itemId}，绑定 product_priorities:edit 用户动作、同名领域命令及精确 aims:product-priorities:edit 服务能力。创建服务能力不能用于编辑，缺身份／错误资源／通配能力仍在读库前拒绝。
- BFF 编辑要求显式完整来源数组、紧急程度、事项及产品版本、原因，不能套用创建默认值误清来源。参数测试发现 undefined 来源会被创建校验默认空数组，已修复；Go 编辑领域也拒绝 nil 来源集合。
- Aims Go 包、BFF 输入测试 3 项、相关 ESLint、Aims typecheck 通过；本轮未重跑 MySQL 事务。Manifest／服务 grant 尚需加入 edit，页面尚未接编辑；不宣称真实租户编辑可用。

## 2026-09-07：规划编辑服务授权验证

- Manifest／生成器加入精确 product-priorities:edit，两个 Runtime audience 各一条；统一说明更新为 38 条业务 grant、44 个验证组合。
- Manifest／生成器测试 4 项通过；隔离 MySQL 实际执行 Seed／Verify，44 项及幂等、缺失客户端、伪同名客户端、停用授权、过期凭据用例通过。规划创建／读取／编辑事务 -race 回归通过（包含近期完整来源数组约束）。diff 检查通过。
- 未向真实租户安装授权；编辑页面与版本联动尚未完成。测试服务验证后关闭。

## 2026-09-07：规划编辑页面接入与冲突响应

- 规划详情增加编辑入口，复用创建表单并提交产品、事项和完整来源版本；要求修改原因，保存前展示原因与影响确认，同一输入重试保留幂等键。
- 编辑前读取当前事项并每批最多 4 条加载来源，校验产品归属、来源身份和 revision；读取失败不会当作空来源提交。请求有超时，取消只读加载会中止请求，保存时禁用表单操作。
- 已确认上一轮 Aims typecheck 进程正常结束（exit 0），相关 Vue ESLint 已通过。修复 Runtime 将规划事项版本冲突与终态只读错误映射为 409；缺少版本、来源无效和缺影响说明仍为 400，新增分类回归通过。Aims 与 productcenter Go 包、diff 检查通过，本轮未启动 MySQL 集成测试。
- 桌面／移动浏览器创建与编辑验收仍待完成。已选事项的影响提示、闭期及版本承诺变更规则、完整优先级页面与周期闭环仍在实施中；不宣称产品中心完成。

## 2026-09-07：规划编辑影响说明提示

- 规划详情返回 requires_impact_note，由当前交付状态与周期选择关系计算；编辑命令复用同一读取结果校验，不再维护另一份查询。前端详情加载要求明确布尔值，表单据此显示必填并在确认前校验，覆盖 proposed 但已选入的事项。提示字段不是授权凭据，写事务仍重新读取当前事实。
- 隔离 MySQL -race 覆盖候选不要求、已选入要求且缺说明拒绝编辑、暂缓恢复可选、交付中要求；规划创建／编辑原有事务回归通过。测试服务已关闭。Aims Go 包、相关 ESLint、Aims typecheck 与 diff 检查通过。
- 此次沿用既有“任一周期已选入”规则，闭期历史是否仍约束当前修改及已承诺版本变更合同仍需按完整设计继续落实。浏览器交互验收尚未完成。

## 2026-09-07：规划周期草案创建领域命令

- 新增 CreatePlanningCycle 与输入校验，使用 product_priorities:cycle-create 命令身份、product_priorities:edit 用户授权及产品根 revision；周期草案、产品 revision、审计和幂等回执同事务提交。
- 创建录入标题、期间、目标摘要、复评间隔和可选预算。预算未提供时保留 NULL；提供时总量、预留和三类预算必须完整，复用定点人日与容量校验。模型及权重快照由服务端固定，创建不开放周期、不生成选择结果或虚构下次复评日期。
- 隔离 MySQL -race 通过错误资源拒绝、审计失败全事务回滚、未知预算保留、精确小数存储、重放同回执、同键不同内容冲突及无自动选入验证；输入负例通过，测试服务已关闭。
- 这是领域层增量，周期指标定义／基线／目标值、读取／编辑、开放／关闭、Runtime／BFF／服务授权与页面仍需接入；尚未形成可用的周期管理闭环。

## 2026-09-07：规划周期列表／详情与内部读取接口

- 新增周期列表分页、状态／关键词过滤及详情查询；产品根锁下重新授权，列表与 total 使用同一过滤，详情按产品与 UUID 双重定位。空列表保持 []，未知预算、指标与目标值保持 null；已知预算以定点小数还原，返回模型快照及事项之外独立的周期／队列 revision。
- 接入内部 planning-cycles:list／view，复用精确 product-priorities:read 与只读传输能力。身份或服务能力错误在数据库访问前拒绝；更新模块契约。
- 隔离 MySQL -race 验证两页稳定顺序、筛选总数、字面 %_ 搜索、空页、可空字段、预算精度、跨产品拒绝及读取无新增活动；创建事务回归继续通过。Aims／productcenter／server Go 包通过，含缺身份、错误资源、通配能力和嵌套路由拒绝用例。测试数据库服务已关闭，diff 检查通过。
- 用户 BFF、周期页面、指标编辑、周期状态流转与评估决策仍待接入，整体目标继续进行。

## 2026-09-07：周期用户读取 BFF

- 新增 planning-cycles 列表及 UUID 详情 GET 路由，要求产品范围 product_priorities:view，使用 no-store、Foundation Runtime helper、精确只读 scope 与 15 秒授权事实。
- 新增周期分页输入校验：只允许 page/pageSize/keyword/status；默认 1／20、每页不超过 100，拒绝数组、未知状态、伪造 actor／productCode、超界分页和非法 Unicode，字面 %_ 保留。
- 参数测试、相关 ESLint、Aims typecheck 与 diff 检查通过。此轮未修改领域事务、未重复启动 MySQL。周期创建入口、指标录入、开放／关闭及页面仍需完成，未进行浏览器验收。

## 2026-09-07：周期草案创建 Runtime／BFF

- 新增用户 POST planning-cycles 与内部 planning-cycles:create，绑定 edit 用户授权、product-priorities:create 精确服务能力和 cycle-create 独立命令身份。现有 create capability 覆盖同资源的事项及周期草案创建，开放／关闭不在此权限内；契约与 grant 说明同步，授权数量不变。
- BFF 严格校验日期、标题、目标摘要、产品版本、复评间隔及完整预算；预算通过整数百分之一人日比较再传十进制字符串，未知预算保留 null，零预算必须明确。非法日期、指数／超精度数值、缺字段、超配和伪造状态／模型拒绝。
- 发现事项创建 BFF 的服务 scope 与 Manifest／Runtime 不一致（product-planning-items:create），修复为统一 product-priorities:create。
- 参数测试 2 项、相关 ESLint、Aims typecheck、Aims／productcenter／server Go 包和 diff 检查通过，新增 Runtime 前置身份／错误能力回归覆盖周期创建。本轮未改领域事务，未重复 MySQL 测试。
- 周期指标录入、草案编辑、开放／关闭及 UI 仍待实现；当前仅接通 API，不宣称浏览器或真实租户验收完成。

## 2026-09-07：周期草案编辑领域事务

- 新增 EditPlanningCycle，绑定 cycle-edit 命令身份和当前产品 edit 授权，核验产品／周期双 revision，仅 draft 可编辑；开放或闭期不能通过草案修改接口改变目标和容量。
- 更新标题、期间、目标摘要、复评间隔和预算，budget_mode 必须为 keep／set／clear，拒绝混合或缺失意图；避免漏传预算造成清空。相同事实不增业务版本，变化与审计、根版本和命令回执原子提交，保留模型、指标及队列版本。新增周期版本冲突／只读规则映射 409。
- 隔离 MySQL -race 通过审计失败回滚、保留／清除／设置预算、幂等重放、双版本冲突中的周期冲突、相同事实不变版本、开放／闭期编辑拒绝；原周期创建读取回归通过。输入负例及 Aims／productcenter Go 包通过，diff 检查通过，测试服务已关闭。
- 周期编辑 Runtime／BFF、指标定义／基线／目标值维护、开放／关闭和 UI 仍待继续接入；此次为领域层增量。

## 2026-09-07：周期草案编辑 Runtime／BFF

- 接入 PATCH planning-cycles/{cycleId} 与内部 planning-cycles:edit，使用当前产品 edit 授权、精确 product-priorities:edit 服务能力和 cycle-edit 命令。BFF 要求原因、双版本、显式 budgetMode 以及复评间隔；不会用创建默认值覆盖漏传字段。
- 修复事项编辑 BFF 的未声明 product-planning-items:edit 能力名为统一 product-priorities:edit，并新增所有产品 BFF 字面服务 scope 对照 Manifest 声明检查；该检查通过，避免仅输入测试通过而真实令牌无法签发。
- 周期输入测试 3 项、服务授权生成／声明检查 2 项、相关 ESLint、Aims typecheck、Aims／productcenter／server Go 包及 diff 检查通过。Runtime 前置身份／错误能力测试覆盖周期编辑，HTTP 分类覆盖周期版本冲突及只读。领域事务未修改，本轮未重跑 MySQL。
- 周期指标维护、开放／关闭、评估与决策、前端页面和浏览器验收仍需继续完成，未将 API 接通视为完整产品中心交付。

## 2026-09-07：规划周期列表与详情页面

- 产品空间增加规划周期入口，周期页接真实 BFF 列表、URL 分页与状态／关键词筛选，复用列表分页、搜索、刷新及标准空状态。详情按周期 UUID 重新查询，展示目标、期间、分类容量、复评间隔和可空目标值；错误／加载时不显示旧数据。
- 相关 Vue ESLint、Aims typecheck 与 diff 检查通过。使用本地预览（实际页面／组件，23 条合成周期数据）验证第二页 3 条、关闭周期筛选 7 条并回到第一页、预算 10.75 与未知值详情、模拟 503 清除旧行／总数及重置恢复。
- 浏览器截图检查当前 1537×783 视口下详情无明显文字重叠；指定 1440／390 视口与控制台验收尚未完成，不能称完整视觉验收通过。预览服务已停止；此预览不替代真实租户端到端验收。
- 页面暂为读取，周期创建／编辑表单、指标维护和开放／关闭、评分决策仍待接入。

## 2026-09-07：周期创建独立页面

- 周期列表迁到 cycles/index.vue，新增 cycles/new.vue，保持原列表 URL；新增权限提示读取入口，创建页面先读取产品 revision／edit 权限及 active 状态，权限错误不展示表单。列表按当前成功权限结果显示创建入口。
- 新增独立周期表单：标题、目标、日期、复评间隔、未知／完整预算两种录入方式，保存期间冻结控制并阻止页面内路由离开；同一内容重试复用幂等键，服务端失败保留输入。预算不默认填零，完整预算要求五项数值。
- 相关 ESLint、Aims typecheck、周期输入与服务声明检查 5 项、diff 检查通过。浏览器使用实际页面与合成 API 预览，验证填写期间／目标／10.75 人日完整分类预算，保存后回列表显示新草案及正确预算；当前桌面截图未见字段重叠。预览已停止。
- 创建失败／冲突保留、取消、未知预算保存、指定 1440／390 视口和控制台检查尚未完成。周期编辑表单、目标指标、开放／关闭及决策闭环仍在实施中，不视为完整验收。

## 2026-09-07：周期草案编辑独立页面

- 新增 cycles/{cycleId}/edit，先读当前产品权限，再读取周期详情；仅 active 产品且 draft 周期加载表单，使用详情返回的产品／周期 revision，错误或非草案不继续编辑。详情弹窗按权限与草案状态提供编辑链接。
- 复用周期表单，预填当前目标／期间／间隔，预算默认 keep，set 预填当前分类数值，clear 明确提示清空后果；修改原因必填，保存前使用共享确认，期间冻结表单并保留相同输入重试键。
- ESLint、Aims typecheck、diff 检查通过。本地浏览器（实际页面／合成 API）验证修改标题并保留 10.75 预算、从详情链接重新读新版本、确认清空后预算显示未确定、确认期间控件禁用。预览服务已停止。
- 取消确认、409／服务失败保留、重设预算、非草案直达拒绝和指定 1440／390 视口验收尚待补齐；周期指标、开放／关闭、评估与决策继续实施中。

## 2026-09-07：周期成功指标领域存储

- 周期创建／草案编辑新增可选 metric 输入：名称、单位、改善方向（increase/decrease/maintain）、测量口径及可空基线／目标值。沿用现有 metric_definition、baseline_value、target_value 列，测量定义与观测结果分离，不使用任务完成率自动赋值。
- 数值只接受最多 14 位整数／6 位小数的十进制字符串，保存前规范为六位小数，不经过浮点；负零规范为零，NULL 与真实零区分。编辑省略 metric 保留原指标，提交 metric 则替换完整定义和基线／目标值；同一语义指标不增加业务 revision，变更仍遵守草案状态、双 revision 和审计事务。
- 隔离 MySQL -race 验证创建指标、未知基线、75.500000 目标、大数 99999999999999.123456 精度、相同指标 no-op、普通修改保留指标及原周期创建／编辑回归通过；数值／方向负例和 Aims／productcenter Go 包通过。测试服务已关闭，diff 检查通过。
- metric 尚未加入 BFF 白名单和页面录入；用户端仍不能维护这些字段。指标 UI、开放／关闭、评估与决策闭环仍需继续完成。

## 2026-09-07：周期指标用户接口与表单

- BFF 周期创建／编辑接入严格 metric 白名单，名称、单位、方向及测量口径必须完整；基线／目标键要求显式字符串或 null，拒绝数字、超精度、指数与未知字段，保留未知值语义。用户输入使用驼峰字段映射已有 Runtime 指标结构。
- 周期共用表单增加保留／设置指标模式，预填现有定义与值；设置时空白值显式保存 null，输入不转换浮点。编辑确认说明指标替换及基线／目标值；详情显示指标名称、单位、方向、测量口径与未知定义状态。
- 周期输入测试 4 项、服务授权声明检查 2 项、相关 ESLint、Aims typecheck 与 diff 检查通过。领域事务未改变，本轮未重复 MySQL。新增指标表单尚未进行浏览器交互／指定视口验收，既有预算表单浏览器结果不代替本次验收。
- 周期开放／关闭、指标观测、事项评估与决策闭环仍待继续完成。

## 2026-09-07：周期开放领域命令

- 新增 OpenPlanningCycle，独立 cycle-open 命令与 prioritize 用户授权；产品根锁下检查产品／周期 revision、draft 状态、完整有效预算、成功指标及明确目标值、服务端固定模型快照和有效期间。允许未知基线，不允许以缺失目标值开放。
- 每产品至多一个开放周期，根锁内检查并由现有唯一键兜底；开放与周期／产品 revision、审计及回执同事务。下次复评从当前 UTC 或未来开始日中较晚者加复评间隔计算，不超过结束日末。开放不自动选入事项、修改队列或承诺版本。
- 隔离 MySQL -race 通过 edit 不能替代 prioritize、缺预算／目标拒绝、审计失败回滚状态／复评时间／版本、成功开放、未来期间复评日期、幂等重放、第二周期开放拒绝及无自动选入验证；Aims／productcenter Go 包和 diff 检查通过，测试服务已关闭。
- 并发双开放、过期期间和模型篡改专项用例仍需补齐；尚未接开放 Runtime／BFF／服务授权和按钮，关闭快照及完整决策继续实施。

## 2026-09-07：周期开放并发及前置条件验证

- 扩展隔离 MySQL 开放测试，增加已结束期间拒绝和服务端模型快照不一致拒绝，恢复有效事实后原开放／回滚／重放用例继续通过。
- 新增两个 goroutine 经共同起始屏障同时开放同产品不同周期，使用同一当前产品授权快照；断言仅一个成功、另一个为授权事实／版本／已有周期冲突，数据库只有一个 open 周期、一次根版本递增、一条 open 审计和一份开放命令回执。
- 两项专项 MySQL -race 测试通过，diff 检查通过。隔离测试库由测试清理，MySQL 服务已关闭；本轮没有修改业务路径，不重复执行无关 UI 检查。
- 开放 Runtime／BFF、精确服务授权、页面动作及关闭周期快照仍需接入，目标保持未完成。

## 2026-09-07：周期开放 API 与精确服务授权

- 接入用户 POST planning-cycles/{cycleId}/open 与内部 planning-cycles:open，用户要求 prioritize，内部新增精确 product-priorities:cycle-open，参数仅允许双版本及理由。Manifest、授权生成器、Seed／Verify、模块契约与统一授权说明同步，当前 40 条业务 grant／46 项验证。
- 周期输入／Manifest／服务声明测试 10 项通过，相关 ESLint、Aims typecheck、Aims／productcenter／server Go 包通过；新增专项验证普通读、宽写、创建与编辑能力均不能开放周期。
- 隔离 MySQL 实际执行生成 SQL，46 项及缺客户端、伪客户端、幂等安装、传输权限不扩权、停用 grant／过期凭据回归通过。测试服务已关闭，diff 检查通过。未向真实租户安装授权或执行开放命令。
- 页面开放按钮与预检、关闭周期快照、评估决策与全范围验收仍待继续完成。

## 2026-09-07：周期开放独立页面

- 周期权限提示增加 prioritize，列表详情按当前成功权限结果和 draft 状态提供开放入口；新增 cycles/{cycleId}/open，先核对 active 产品／决策权限，再读取当前周期双版本。
- 开放表单展示目标、指标／基线／目标值与完整分类预算；缺预算、指标或目标值时明确列出缺项并禁用提交。开放理由必填，确认说明草案编辑限制与不自动选入事项；请求冻结身份／双版本，忙碌时禁止重复操作及页面内离开，同内容重试保留幂等键。服务端仍执行全部开放条件和产品范围授权。
- 相关 ESLint、Aims typecheck 与 diff 检查通过。本地浏览器实际页面＋合成 API 验证缺少预算及指标的草案列出全部缺项，开放按钮禁用；预览服务已停止。
- 成功开放、取消确认、冲突／失败保留以及 1440／390 视口验收尚未完成；关闭快照、评分决策及产品中心完整功能仍待继续。

## 2026-09-07：规划周期候选添加领域命令

- 新增 candidate-add 命令，要求当前产品 product_priorities:edit，核验产品／周期／事项三个 revision；仅 draft/open 周期允许，事项必须为同产品 proposed/in_delivery。
- 新关联以 candidate、later 和队尾位置加入，更新周期／队列／产品 revision，与审计和回执同事务；不创建评估、不选择交付、不改版本范围。重复添加返回已有选择状态与位置，不把 selected 重置成 candidate，也不增业务版本。
- 隔离 MySQL -race 验证错误资源、过期事项版本、跨产品事项拒绝、审计失败全事务回滚、成功添加未自动评分、幂等重放、重复添加保留 selected 和闭期拒绝通过。Aims／productcenter Go 包及 diff 检查通过，测试服务已关闭。
- 候选列表、Runtime／BFF／服务授权和页面入口尚待接入；评分快照、最终排序／容量决定和关闭周期继续实施中。

## 2026-09-07：周期候选列表与内部查询

- 新增 ListPlanningCycleCandidates，产品根锁内核验 view 授权并按产品定位周期；同一选择状态／字面关键词过滤用于计数与分页，按周期顺序返回事项范围、生命周期、版本、选择状态、路线列和可空评估引用。空页 []，返回周期／队列／产品 revision。
- 接入内部 planning-candidates:list，复用 product-priorities:read 与只读传输 scope，身份和错误服务能力在读库前拒绝，嵌套路由不能借用只读例外；模块契约同步。
- 隔离 MySQL -race 验证分页总数／空页、选择状态过滤、字面 %_、无评估引用、产品／周期版本、错误资源与跨产品周期拒绝，原候选添加回归通过。Aims／productcenter／server Go 包和 diff 检查通过，测试服务已关闭。
- 候选用户 BFF／添加服务能力／页面与实际评分快照仍需继续接入，完整目标未完成。

## 2026-09-07：候选用户查询与添加输入合同

- 用户 GET planning-cycles/:cycleId/items 已接入内部候选查询，校验路径周期、独立 selectionStatus、字面关键词和分页；沿用产品 view 范围、签名用户委托、精确 read capability 与 no-store。
- 增加候选添加的 BFF 输入解析：路径绑定周期，只接收事项标识与产品／周期／事项三个安全整数 revision，拒绝客户端选择状态、分数及 actor。添加写路由和服务 capability 仍待接入，尚不能从页面添加候选。
- 查询／周期输入及服务 grant 测试 8 项通过，新增添加输入后周期输入 7 项通过；查询路由相关 ESLint 和 Aims typecheck 通过。完整优先级 UI、评估与决策闭环继续实施。

## 2026-09-07：候选添加 Runtime 与用户写接口

- 接入内部 planning-candidates:add 和用户 POST planning-cycles/:cycleId/items，复用既有 candidate-add 原子事务命令；产品范围 edit 与服务 product-priorities:edit 分别校验，签名 actor、幂等键及三个 revision 贯通。候选集合编辑使用现有精确 edit 能力，不新增 grant，不借用 cycle-open。
- 扩展 Runtime 身份／能力前置测试，覆盖缺少委托上下文、错资源、通配符，以及宽写、create、read、cycle-open 无法添加候选。Aims／productcenter／server Go 包通过；新增能力拒绝用例单独通过。周期输入与 grant 测试共 9 项、写路由 ESLint、Aims typecheck、diff 检查通过。
- 本轮未重跑隔离 MySQL；事务领域规则沿用前轮已验证实现，未修改。候选页面尚未接入，用户完整链路与浏览器验收待完成；评分、排序／容量决定、闭期和后续功能仍属完整目标中的未完成部分。

## 2026-09-07：周期候选列表页面

- 增加 cycles/:cycleId/items 页面及周期详情中的入口，使用实际候选 GET API；独立选择结果筛选、字面关键词搜索、20 条分页与总数，按服务端决定顺序展示范围／紧急程度／选择结果。
- 加载失败隐藏旧列表与总数，校验返回产品和周期归属；可空评估引用仅显示记录存在与否，不展示为有效分数或交付承诺。使用 Foundation 页面刷新、搜索、列表状态和空态模式。
- 页面 ESLint 自动整理后通过；浏览器环境可访问，但现有隔离预览缺少候选 fixture，尚未完成本页真实浏览器 1440/390 验收。候选添加 UI、评估详情和排序决策仍待继续完成。

## 2026-09-07：候选添加页面与隔离浏览器首轮验证

- 增加 add-item 页面和 PlanningCandidateAddForm：读取当前权限及可写周期后展示分页事项选择，支持 proposed/in_delivery 与关键词；保存产品／周期／事项版本和同 payload 幂等键，失败保留选择。显式刷新所选范围及周期版本后再提交；保存中禁用操作并阻止离开／同路由更新。
- 候选列表仅在 active 产品、可写周期与 edit 提示通过时展示添加入口；最终授权仍由写接口和 Runtime 执行。新增操作不代表选入交付。
- ESLint 修复格式后通过，Aims typecheck 与 diff 检查通过。隔离预览补充虚构事项和候选接口，通过 Chrome 验证：候选空态、无效周期错误、22 条可选事项及分页控件、未选时禁止提交、选中并添加后返回列表显示一条 candidate／尚无评估。测试不证明真实租户授权或 MySQL 事务。
- 浏览器 1440/390 视觉验收、失败重试／并发冲突交互、更多分页筛选用例仍待完成；完整评估、排序容量决策和后续产品能力继续实施。

## 2026-09-07：评估快照事务与输入规则

- 增加 CreatePlanningAssessment：product_priorities:assess 独立动作，当前产品根锁内校验产品／周期／事项／范围／证据版本，仅开放周期及已关联的同产品 proposed/in_delivery 事项可追加；固定模型须匹配周期快照。
- 已填写维度要求理由与附日期的人工事实／假设、正反立场说明。投入非空必须由本次已授权 actor 显式确认，estimated_by 不接收任意客户端 UID；当前实现记录本次确认者，跨人异步研发确认流程尚未实现。全部未知保留空分，不以零替代。
- 服务端定点计算，冻结模型、范围、分类、来源需求版本、人工说明及依据；追加不可变 assessment 并更新当前引用，与周期／产品 revision、审计和回执同事务，不改队列 revision、选择结果、决定快照或版本范围。
- 隔离 MySQL -race 测试通过：edit 不能 assess、草案拒绝、过期证据拒绝、审计失败回滚、成功样例 7.80000000、幂等重放、历史禁止 UPDATE、重新评估追加第二条并保留未知投入／估算确认者为空、队列不变。输入测试覆盖缺依据／版本／确认、非法日期和假冒外部验证分类。测试环境固定开期数据仅用于评估命令，不替代开期命令验收。
- 尚未接入 Runtime/BFF/assess 服务能力及评分页面；证据逐维度引用与研发分人确认、评估历史读接口和决定有效性检查仍需继续完善，完整目标未完成。

## 2026-09-07：逐维度证据引用

- 评估证据增加快照内唯一 key，评分／置信度／投入依据按 evidence_references 显式引用；每个已填维度或有说明的维度必须有引用，拒绝不存在、重复、非法 key 和未知维度。
- rationale 快照同时保存 reasons 与 evidence_references，证据正文含相同 key；可同时引用支持和反对证据，不因正反数量自动改变分数。无评分、无依据的未知评估仍允许显式空证据。
- 隔离 MySQL -race 与输入用例通过，确认实际 JSON 持久化引用指向冻结正文，原审计回滚／幂等／不可变历史／未知分数回归通过；diff 检查通过。评估接口、页面、分人研发确认及其余完整方案继续实施。

## 2026-09-07：评估内部接口与服务授权

- 接入 planning-assessments:create 到现有评估事务；精确 assess 服务能力和用户 assess 动作分离校验，actor 委托检查先于数据库。增加缺 claim、错资源／通配符、宽写及 edit/create/read/cycle-open 不可评估的接口测试。
- Manifest／生成器增加 data-runtime、tenant-runtime 双 audience 的 assess，生成 42 条业务 grant／48 个核验组合；隔离 MySQL 实际执行生成 SQL，缺客户端、干扰客户端、已有传输前提、失效 grant／过期凭证、重复执行和失败保护通过。未安装到业务租户。
- Aims／productcenter／server Go 包、grant 生成器一致性测试和 diff 检查通过。用户 BFF 输入适配、评估页面／历史读取及分人研发确认继续实施。

## 2026-09-07：用户评估提交接口

- 接入 POST planning-cycles/:cycleId/items/:itemId/assessments，路径绑定周期／事项，要求 Idempotency-Key 和当前产品 assess 授权；使用签名 actor 与精确 assess capability 转发 Runtime，无本地数据库回退。
- 新输入适配严格校验五个版本、固定模型／单位、显式可空评分、定点十进制字符串、估算确认、人工证据日期／唯一键、逐维度引用；拒绝客户端最终分数、评估／估算人冒用、路径身份覆盖和额外字段。
- 输入与服务授权契约测试 5 项通过；进一步补充证据枚举数组拒绝用例，输入 3 项通过；相关 ESLint（修复测试文件空行后）、Aims typecheck 与 diff 检查通过。尚无评估提交页面和真实租户端到端验收，历史读取／分人研发确认继续实施。

## 2026-09-07：评估历史领域查询

- 增加 ListPlanningAssessments：产品根锁内核验 view，按同产品周期与已关联事项读取真实分页历史，最新快照在前，计数与分页范围一致。返回冻结模型／分数／依据／证据／确认者与 UTC 时间，十进制值保持字符串、未知保持 null。
- 分别返回 is_current（当前引用）与 stale（范围、证据或模型版本变化），当前引用不等于当前有效；读取历史不重新计算或覆盖评分。
- 隔离 MySQL -race 验证当前未知评分、上一页精确历史分数、末页空数组但总数不丢失、错误资源拒绝、证据变更后当前引用仍在但 stale=true；原评估写事务回归通过。diff 检查通过。
- 历史 Runtime/BFF 与页面仍待接入，领域查询结果不能代替完整决定有效性、期限复评或真实用户端验收。

## 2026-09-07：评估历史 Runtime 与用户接口

- 接通 planning-assessments:list 和用户 assessments GET，绑定路径周期／事项，仅接收有界 page/pageSize；复用 view 与精确 read 服务能力、签名用户委托及 no-store，不新增授权。
- Runtime 只读 POST 精确例外和嵌套拒绝测试包含评估历史，缺 actor／委托 claim／scope、错资源和通配符在数据库前拒绝。Aims／productcenter／server Go 包通过。
- 输入及服务 grant 契约测试 6 项、相关 ESLint、Aims typecheck 和 diff 检查通过。历史展示／评估填写页面以及完整分人确认和后续决策流程继续实施，尚不宣称用户端闭环完成。

## 2026-09-07：评估历史页面

- 增加事项评估历史页及候选行入口；候选 items.vue 移至 items/index.vue，保证历史子路由可独立渲染。分页展示冻结分数、六维依据／证据键、确认者、模型及版本，支持展开人工证据；当前引用、过期和未知分数分别标示。
- 相关 ESLint、Aims typecheck 与 diff 检查通过。隔离 Chrome 读取实际页面配合 12 条虚构历史，确认当前且过期且未知可同时展示、历史精确分数和依据、第二页 2 条及总数 12。模拟确认者用于展示，不证明跨人确认已实现。
- 1440/390 视觉／控制台完整验收、错误空态及证据展开交互仍待完成；评估填写、分人研发确认、容量排序和其余产品中心范围继续实施。

## 2026-09-07：评估填写页面

- 新增 assess 页面及历史页新增入口，权限提示增加独立 assess；读取权限、开放周期、事项与周期关联历史，核对五个版本及读取一致性后再展示表单。
- 表单支持四个价值分、置信度、总投入显式未知；人工证据日期／性质／立场及各维度多证据引用；移除证据统一确认并清除关联。总投入确认者绑定当前操作人，仍未冒充跨人研发确认。
- 保存前展示冻结摘要并锁定控件；同 payload 重试复用幂等键，失败保留内容，版本冲突要求核对范围后重新评估。服务端计算最终分数，前端不提交最终分数。
- 相关 ESLint 修复格式后通过，Aims typecheck、diff 检查通过。Chrome 隔离预览使用真实输入解析器验证未知默认值、保存确认摘要／控件禁用、未知提交成功后返回历史及新增入口；fixture 不落库，不证明真实事务或评分记录回显。
- 完整有分数／多证据填写、冲突恢复、1440/390 与控制台验收仍需继续；分人研发确认、矩阵、最终排序容量及后续方案尚未完成。

## 2026-09-07：候选列表显示当前评估

- 候选查询按当前 assessment ID、周期和事项联合关联快照，返回可空 assessment 摘要：价值分、推荐分、置信度、投入、模型及 stale。空引用保持 null，引用损坏拒绝；十进制保持字符串，查询不重新评分、不改变决定顺序。
- 候选页面增加投资类别与评分摘要，未知显式显示、过期单独警示，提醒只在同类别内比较；原决定顺序、选择结果和历史入口保留。
- 隔离 MySQL -race 验证有效当前 7.80000000／8.00、未知投入、过期评估和候选添加／分页回归通过。相关 ESLint、Aims typecheck 和 diff 检查通过。新增列尚待浏览器宽屏／移动端验收，推荐排序、矩阵与容量决定继续实施。

## 2026-09-07：只读推荐排序与类别筛选

- 候选查询新增固定 sort 和投资类别过滤；推荐在同类别内部优先排列有效完整且未进入交付的评分，精确 DECIMAL 排序、稳定 biz_id 同分规则，过期／未知／已交付中事项后置。默认仍为持久化队列；不写业务版本。
- 页面增加原顺序／推荐视图与类别筛选，随筛选重置分页，明确只读和不可比较条件；BFF 拒绝任意排序表达式和非法类别。
- 隔离 MySQL -race 验证 15.60000000 在 7.80000000 前、过期项后置、切回原队列不变、类别空结果及原候选回归通过；输入测试 8 项和相关 ESLint 通过。新增筛选交互尚待浏览器验收，矩阵和正式定序／容量命令继续实施。

## 2026-09-07：相邻锚点调序领域事务

- 增加 MovePlanningQueue，要求 prioritize、开放周期和产品／周期／队列版本；完整周期集合上调用既有 MoveQueue，不接受页面数组覆盖。每次移动要求唯一 before/after 锚点及理由，范围上限明确拒绝而非截断。
- 用临时无冲突 rank 区间再压缩最终序号，保持唯一约束；顺序、产品／周期／队列版本、旧新队列审计和回执同事务；无变化保留业务版本，已有选择／评分与版本承诺不被改写。已选事项的前置顺序检查已加入，具体依赖失败／例外用例仍需补测完善。
- 隔离 MySQL -race 覆盖 edit 拒绝、过期 queue revision、审计失败回滚、跨原位置移动、幂等重放和 no-op 不增版本，通过；productcenter 单元测试与 diff 检查通过。
- 调序 Runtime/BFF/服务能力及页面未接入；正式选择、容量变更、依赖例外和关闭周期等完整决策能力继续实施。

## 2026-09-07：调序依赖冲突回归

- 隔离 MySQL -race 增加已选前置／后继调序情境：后继移到未交付前置之前被拒绝，验证临时 rank 更新也完整回滚、队列／产品版本不变；前置已交付后相同移动可成功。原评估与调序事务回归通过。
- 将 priority_queue_conflict、planning_dependency_order_invalid 映射为 HTTP 409，加入错误分类测试并通过，便于接口提示刷新或解决依赖；diff 检查通过。
- 依赖例外处理、调序用户接口和页面等继续实施，未宣称完整决定流程完成。

## 2026-09-07：调序 Runtime、用户接口与精确授权

- 接入 planning-queue:move 与用户 cycle/:id/move，复用已验证事务；用户 prioritize 和精确服务 move 分离检查，三个版本／唯一相邻锚点／理由／幂等贯通。
- Manifest／生成器增加 move 双 audience，生成 44 条业务 grant／50 个核验组合。隔离 MySQL 执行实际 SQL，缺失／干扰客户端、传输前提、重复安装、失效授权与过期凭证等通过，未更改业务租户。
- Go Aims／productcenter／server 包通过；前置身份与错服务能力测试覆盖 move，普通 read/create/edit/assess/cycle-open 均拒绝。输入和 grant 测试 3 项、相关 ESLint 与 diff 检查通过。调序页面、容量选择、依赖例外及其余完整方案继续实施。

## 2026-09-07：调序页面与候选入口

- 增加 move 页面和相邻锚点选择表单，仅 active 产品、开放周期及 prioritize 提示通过时在原队列视图显示入口；读取当前周期、事项与关联历史确认同一版本后展示。
- 目标事项按当前周期搜索／分页，禁止以自身为锚点，可选前／后位置并填写理由；发现目标列表 queue revision 已变则禁止提交。确认展示对象、相对位置及顺延影响，写入仍只提交单个锚点及三个版本，不传页面数组。
- 提交锁定控件和路由，失败保留目标与理由，同 payload 重试复用幂等键。相关 ESLint（修复格式后）、Aims typecheck 与 diff 检查通过；本页尚未浏览器验收，完整影响事项／版本预览及冲突交互仍需继续完善。
- 正式选入／暂缓、容量变更、矩阵、依赖例外和其余产品中心能力继续实施。

## 2026-09-07：调序影响预览领域查询

- 新增 PreviewPlanningQueueMove，在当前产品 view 授权和根锁内核验产品／周期／队列版本，读取完整周期集合并返回受影响事项、选择状态、旧新位置和总数；预览不写版本、审计或回执。
- 正式调序与预览共用 loadPlanningQueue，保留完整集合上限检查及稳定顺序，避免预览和提交分别按不同分页数据计算。
- 隔离 MySQL -race 验证第 3 项前移影响三项、位置准确、错误资源拒绝，原正式调序／幂等／回滚／依赖测试回归通过，diff 检查通过。
- 预览目前只解释位置变化，不宣称依赖／容量可执行或版本承诺已核准；关联版本影响、预览接口和 UI 接入仍需继续完成。

## 2026-09-07：调序预览接口与两步确认

- 接入 move-preview 用户 POST 和 planning-queue:preview 内部只读 POST，复用 view／精确 read，身份与 capability 先于数据库，精确只读路由测试覆盖嵌套拒绝；无新 grant，无预览幂等回执。
- 调序表单先读取服务端预览，展示受影响事项旧新位置与选择状态（20 条本地分页、显示完整计数），再次点击才确认正式写入；更换目标／位置／理由清除预览。响应须匹配三个版本，不把位置预览冒充依赖可行性。
- Go Aims／productcenter／server 包、输入和 grant 测试 3 项、相关 ESLint 修复格式后、Aims typecheck 与 diff 检查通过。两步预览尚待真实浏览器验收；关联版本影响、容量选择及其余完整方案继续实施。

## 2026-09-07：有界价值／投入矩阵领域查询

- 新增 ReadPlanningMatrix，与候选列表共用根锁内数据读取和完整筛选计数；固定最多返回 200 项，total／returned／limit／truncated 明确区分，不借用当前页面冒充全量。
- 有效完整评估进入 points，缺失／过期评估进入 unplotted，不赋零坐标。周期中持久化的价值／投入分区阈值随结果返回，默认值不在页面重新编造。
- 隔离 MySQL -race 验证两点加一过期项、类别空结果空数组、阈值 50.00／5.00、202 项返回 200 并标截断；候选／评估／调序原回归通过，diff 检查通过。
- Runtime/BFF 和矩阵页面尚待接入；当前新增为领域读取，不代表完整优先级矩阵交付完成。

## 2026-09-07：矩阵 Runtime 与用户查询接口

- 接入 planning-matrix:view 和用户 cycle/:id/matrix，使用 view、签名当前用户和精确 read；矩阵内部 POST 加入严格只读匹配及嵌套拒绝测试，未增加授权。
- 用户仅可按关键词／选择结果／投资类别过滤，拒绝分页、数量上限、排序与身份覆盖；固定 200 上限由领域查询控制。
- Go Aims／productcenter／server 包、输入及服务授权测试 11 项、相关 ESLint、Aims typecheck 和 diff 检查通过。矩阵页面及其可访问性／响应式验收继续实施，完整产品中心目标仍未完成。

## 2026-09-07：价值／投入矩阵页面

- 新增周期 matrix 页及候选入口，SVG 横轴人日／纵轴价值，读取周期分区阈值、类别语义色和置信度透明度；事项列表提供完整数值及评估链接，过期／未知项不落原点，重叠点可通过列表区分。
- 支持关键词、类别、选择状态过滤与重置，返回数／总数／未绘制数明确，截断警示要求缩小范围。移动端默认列表并可展开矩阵；返回事项列表本地 20 条分页，不冒充服务器全量。
- 相关 ESLint（修复格式后）、Aims typecheck 和 diff 检查通过。隔离 Chrome 使用虚构两点一未评估项验证数量、坐标数据／图例／列表，截图检查当前桌面布局；503 后旧图、列表、总数隐藏。指定 1440/390、控制台、截断和筛选完整验收仍待完成。
- 容量选择、依赖例外、版本影响、跨人估算确认及其余完整产品中心范围继续实施。

## 2026-09-07：容量基线与最新估算对照领域计算

- 核对并验证本期已选且已交付事项仍保留周期预算消耗；仅作为历史前置、未选入本期的事项不重复计算。
- 新增 CompareDecisionCapacity，分别返回冻结决定容量、最新估算容量及逐项投入差额；完成事项两侧保持冻结占用。未交付已选项的最新估算必须完整提供，显式未知保留 NULL，拒绝缺项及不相关事项，避免分页／漏读造成虚假空闲容量。
- 增加回归覆盖 18 人日可用容量、9 人日已完成＋10 人日待交付的占用 19／差额 -1；最新投入变为 12 后测算占用 21／差额 -3，原确认值保持不变。覆盖未知估算、非法值、输入别名隔离和集合完整性。
- `go test ./internal/apps/aims/productcenter` 通过。此为领域计算，尚未接入完整周期容量读取及选择命令；未运行本轮 MySQL 集成或页面验收。中止已开工事项的实际消耗保留、选择快照、变更确认及其余完整方案继续实施。

## 2026-09-07：完整周期容量领域读取

- 新增 ReadPlanningCapacity，在当前产品 view 授权及根锁事务内读取周期、完整产品事项与依赖图，按周期决定顺序核算，不接受分页或筛选。超过 10000 事项／100000 依赖时明确拒绝，不返回部分汇总。
- 已选项从 decision_snapshot.capacity 读取版本 1 的事项标识、投资类别和投入；缺失、错事项或非法快照失败关闭，不使用当前评估伪造历史决定。最新测算读取关联的当前评估；不完整评分、范围／证据／模型或类别变化标记需评估。本期已交付事项保留冻结占用。
- 隔离 MySQL 的 TestMySQLPlanningAssessmentAtomicity 扩展并通过 -race：空选择汇总、缺冻结快照拒绝、冻结 6 人日与最新估算区分、错误资源授权拒绝、已交付占用不释放；原评估、推荐、调序及矩阵回归同时通过。容量比较与完成事项单测同次通过。隔离 MySQL 已关闭，未操作业务数据库。
- 此次交付为带真实数据库验证的领域读取，尚未接 Runtime/BFF/页面，也未实现正式选择命令写入快照。最新类别变更的分类测算、跨人估算确认、例外及实际消耗等剩余要求继续实施，不代表容量决策闭环完成。

## 2026-09-07：容量 Runtime 与用户接口

- 接入 planning-capacity:view 与用户 planning-cycles/:id/capacity；沿用 Foundation 产品 view、签名委托当前用户、精确 service read 和 no-store，未新增服务授权。
- 用户接口拒绝全部查询参数，不能通过分页、关键词、分类、选择状态或身份覆盖缩小汇总范围；内部 POST 只读例外精确匹配，扩展现有嵌套路径拒绝回归。
- Go Aims／productcenter／server 三包测试通过；Aims 输入与服务授权测试 12 项通过；相关 ESLint 和 Aims typecheck 通过。类型检查环境为 Node 25.2.1，工具提示仓库要求 Node 24.18～24.x，因此本结果不代替规定 Node 版本的发布检查。
- 模块契约、专项接口说明同步。容量页面、正式选择快照写入、预算与范围变更等完整闭环仍待继续实现；此次没有部署或业务数据写入。

## 2026-09-07：类别变更后的容量测算

- 修正最新容量仍使用冻结投资类别的问题：CompareDecisionCapacity 接受当前类别及投入，confirmed 保持冻结类别，latest 按当前类别汇总；changes 新增 confirmed_category／latest_category，投入相同的类别变化仍显示。已交付事项继续保持冻结消耗。
- 单测验证类别转移、零投入差额仍显示变化、冻结输入不变和非法类别拒绝；隔离 MySQL 验证已确认增长 4 人日、最新可靠性 4 人日，可靠性预算 3 人日时明确提示超类预算。原评估／排序／矩阵集成同次通过。
- productcenter 单测及相关隔离 MySQL -race 回归通过；模块契约同步。该变化完善现有读取结果，容量页面和正式决策写入等剩余范围继续实施。

## 2026-09-07：候选选入的事务领域命令

- 新增 SelectPlanningCandidate：对现有 proposed 候选执行 prioritize 授权，校验产品／周期／队列／事项版本和指定当前评估，冻结容量、评估 ID、范围／证据版本、模型及例外，设置 selected／now；选择、完整容量依赖检查、revision、审计和幂等回执在同一事务内完成。
- 不允许通过重新选入覆盖已选快照；已有已选项的投入或类别发生变化时拒绝新增选择，要求先走变更决定。当前命令包含正常选择及容量／依赖问题的逐项例外合同，不能用 P 等级或通用布尔值绕过评估。
- 新建独立隔离 MySQL 用例验证无 prioritize 拒绝（含重放）、队列冲突、类别超容量失败且无选择残留、未解除前置拒绝、过期证据拒绝、审计失败回滚、显式类别容量例外后成功冻结 8 人日、revision 递增及同键回执重放。与既有评估／调序／矩阵／容量测试一起 -race 通过。测试库已关闭，未操作业务环境。
- 当前是未开放用户入口的领域命令。决策预览、Runtime/BFF/页面、期限可行性确认、复评时间规则、跨人研发估算确认、已开工／已选范围变更与移出、历史例外展示和整体交付链路仍需继续完成，不能视为正式选择闭环交付。

## 2026-09-07：选入预览与提交共用只读准备

- 提取 preparePlanningSelection，在已授权产品根锁事务中读取当前事实并在内存投影单项选择。正式提交改为校验投影后才写入，避免预览依赖临时 SQL 更新／回滚。
- 新增 PreviewPlanningSelection，返回选择前后容量、版本和 blocker；未处理类别超额可查看完整变化，提供明确例外后 can_confirm 表示领域条件可满足（不是提交权限，也不代表交付承诺）。预览使用 view，正式命令仍单独要求 prioritize 并重新核验版本及事实。
- productcenter 单测通过；隔离 MySQL -race 验证安装拒绝 cycle_items UPDATE 的触发器时仍可成功预览、超额 blocker、前后 0／8 人日、明确例外后的可确认状态、错误资源拒绝、预览后仍为 candidate。原正式选入、审计回滚、幂等以及评估／调序／矩阵集成回归同时通过；测试库已关闭。
- 预览与命令仍未开放 Runtime/BFF/页面。受影响事项／版本展示、期限与跨人估算确认、复评／变更等剩余合同继续实施，完整目标未完成。

## 2026-09-07：选入预览 Runtime/BFF 与严格输入

- 接入 planning-selection:preview 与用户周期／事项 selection-preview；复用当前用户签名委托、产品 view 范围、精确 service read 和 no-store。内部 POST 只读匹配与嵌套拒绝测试扩展，未增加服务 grant。
- 新增 productSelectionInput：绑定两个路径 ID，要求五项正安全整数版本／评估标识、理由和明确例外数组；限制例外类型及其标识结构，拒绝重复、无依据、评估豁免、客户端分数／快照／身份覆盖。正文映射至领域 snake_case，不接受客户端替换服务端结果。
- Go Aims／productcenter／server 三包测试通过，输入与服务授权测试 4 项、相关 ESLint 及 Aims typecheck 通过；Node 25.2.1 的 engine 提示仍存在，不代替要求 Node 24 的发布检查。契约与 diff 检查同步。
- 当前正式选入写接口和交互页面尚未开放。容量页面、影响预览细节、期限、跨人估算确认、变更与其余完整方案继续实施；未部署、未写业务数据库。

## 2026-09-07：正式选入 Runtime/BFF 与独立服务授权

- 接通 planning-selection:select 与周期事项 select 用户接口，共用预览输入；要求 prioritize、签名委托用户、幂等键和独立 product-priorities:select capability。已选、已变更决定及评估失效映射 409；不是只读 POST。
- Manifest、授权生成器、Console Seed／Verify 和安装说明同步：46 条业务 grant／52 个验证组合。隔离 MySQL SQL 检查覆盖幂等安装、缺失或错误客户端、传输前提、停用 grant 和过期凭证，全部通过；未安装业务租户授权。
- Go Aims／productcenter／server、输入与授权 4 项、相关 ESLint、Aims typecheck 通过；追加 select 不借用 read/edit/move/assess/cycle-open/宽写 capability 的回归通过。Node engine 限制仍按前述记录，部署验收未执行。
- 页面、期限／研发确认、复评与变更等完整要求继续实施；本次完成接口接通，不表示产品中心已可发布。

## 2026-09-07：周期容量页面

- 新增周期 capacity 页面和候选页入口，展示全周期总预算／预留、已确认占用、最新测算、负差额、未知估算提示、分类预算及变化／问题明细。明细按已返回完整集合本地 20 项分页，不改变服务器汇总范围。
- 容量读取新增 budget 字段，直接返回同一事务内读取的完整周期预算；前端校验金额、版本和结构，错误／加载状态隐藏旧汇总。已交付消耗与非人员排班口径有明确说明；当前明细用事项标识关联评估，友好名称仍需完善。
- productcenter 测试、相关 ESLint（修复格式后）及 Aims typecheck 通过。隔离 Chrome 使用虚构样本验证 19／21 人日、-1／-3 差额及未知提示，503 刷新后旧数字／明细全部隐藏；截图检查真实 iframe 390px／1440px 页面视口的首屏单列与多列布局，当前未见横向溢出。原生 Chrome 窗口控制返回 cgWindowNotFound，改用固定 iframe 视口验证。
- 尚未完成全页响应式、控制台、长列表分页、空结果和正式租户端到端验收，不宣称完整视觉验收通过。正式选入交互、期限／研发确认、复评／变更等完整方案继续实施。本地预览样本不代表业务数据。

## 2026-09-07：选入周期交互页

- 新增事项 select 页与 PlanningSelectionForm；加载当前产品 prioritize、开放周期、待规划事项及当前有效评估，匹配产品／周期／事项版本后才能进入表单，候选页按当前评估和权限展示入口。
- 两步预览／确认，共用 API 输入：展示范围、投入、推荐分、前后容量及问题；例外逐项填写原因、影响并用 Foundation UserTreeSelector 选择责任人。修改正文或例外使旧预览失效，确认前要求重新预览；提交过程冻结控件和路由切换，按相同 payload 复用幂等键，失败保留输入。
- 本地 Chrome 虚构样本验证初始确认禁用、0→8 人日预览、修改理由使确认再次禁用、Foundation 确认弹窗包含事项／周期／差额／例外数量，以及携带幂等键经真实输入 parser 的模拟成功响应后返回候选页。此 fixture 不写真实决定，不代替数据库端到端验证。
- ESLint 和类型检查修复后通过（修复 Candidate 缺 lifecycle 类型、格式及响应金额校验）。例外选择、失败重试、冲突恢复、完整 1440／390 与控制台检查仍待完成；期限／跨人研发确认、已选变更及其余产品中心方案继续实施，尚不可宣称试点完成。

## 2026-09-07：Runtime 例外结构校验补齐

- 选入与预览的共享领域输入校验现在直接限制可豁免问题类型，校验类别、规范事项／前置 ID 及对象组合，拒绝重复问题、自依赖和携带不相关对象的例外；责任人限制 64 字且禁止首尾空白。
- 不再只依赖 BFF 提前拦截这些无效输入，Runtime 在访问事务前也执行相同结构边界；随后仍由完整周期问题清单校验例外是否真正适用。
- 新增有效类别／依赖例外与无效结构、评估豁免、重复、责任人长度／空白、非法 UTF-8 回归，productcenter 测试通过。未改变数据库结构或部署状态；完整方案继续实施。

## 2026-09-07：规划前置依赖事务维护

- 新增 EditPlanningDependencies，按 product_priorities:edit 与当前产品根锁维护指定事项完整前置集合（最多 100），规范 UUID、去重、自依赖、同产品及前置生命周期校验。读取完整同产品图执行循环检测，10000 事项／100000 边上限失败关闭，不截断校验。
- 仅 proposed／in_delivery 可修改；已选或交付中事项要求影响说明。增删保留未变关联，变更时递增 item revision／scope revision 和产品版本，使历史评估需复评；相同集合 no-op 不变版本。旧新集合、原因、影响说明、审计和回执与修改同事务，保留既有决定快照。
- 独立隔离 MySQL -race 验证缺编辑权限／跨产品拒绝、审计失败时依赖与 revision 回滚、成功后范围版本递增、回执重放、反向循环拒绝、no-op、不填影响说明拒绝、明确空集合删除；同次选入事务回归通过。纯输入验证覆盖未知集合、重复、自依赖、非法 ID 与数量上限。测试库已关闭。
- 当前为领域写命令，依赖读取、Runtime/BFF 与页面继续接入；版本承诺变更、期限／研发确认及完整产品中心剩余要求仍在实施。

## 2026-09-07：完整前置集合读取

- 新增 ReadPlanningDependencies，在产品 view 授权根锁事务中返回完整前置集合、名称、生命周期、前置 revision 及当前产品／事项／范围版本和影响说明要求。
- 空集合返回 []；超过 100 条明确拒绝，不返回可能被编辑器误当完整集合的第一页。历史已取消／合并前置仍可读取，新增限制不隐藏历史问题。
- 隔离 MySQL -race 扩展验证实际关联读取、名称／状态及版本、错误资源拒绝、跨产品事项拒绝、删除后的空数组和交付中影响说明要求；原依赖事务回归同时通过，测试库已关闭。
- 当前领域读写已具备，Runtime/BFF／页面与其余完整产品中心需求继续实施，未进行业务环境迁移或部署。

## 2026-09-07：依赖 Runtime 与用户读写接口

- 接通 planning-dependencies:view／edit 以及用户 planning-items/:id/dependencies 的 GET／PUT；产品范围 view／edit、签名当前用户及精确 service read／edit。只读内部 POST 严格匹配，写接口携带幂等键，未新增 grant。
- 输入 helper 拒绝读取子集、身份／范围版本覆盖、缺失或非法前置集合、自依赖和重复；明确空集合可清空。服务端继续执行完整图、版本和影响校验。
- Go Aims／productcenter／server 三包、输入与授权 4 项、相关 ESLint（修复测试 import 空行后）及 Aims typecheck 通过。类型检查 Node 25 与仓库要求 Node 24 的限制仍如前述，不作为发布验收。模块契约同步。
- 依赖编辑页面、完整响应式和正式租户验收继续实施，产品中心完整目标未完成；未部署或修改业务数据。

## 2026-09-07：依赖编辑页面与跨页选择

- 新增 planning-items/:itemId/dependencies 独立页、PlanningDependenciesForm 和规划事项详情入口。页面核对 edit、产品／事项范围与完整依赖版本；已有关系独立保留，服务器候选每页 10 条，已选集合独立本地分页，不用当前搜索页覆盖完整集合。
- 支持添加／移除、已结束候选禁用、100 项上限、完整增删名单、原因与条件必填影响说明；使用 Foundation 确认和幂等保存，提交时冻结控件／路由，失败保留编辑内容。
- ESLint（修复格式后）及 Aims typecheck 通过；本地 Chrome 虚构 23 项候选验证初始既有前置、禁用自身／已选、第一页增加事项 3、第二页增加事项 11 后仍保留事项 2，确认 2 新增／0 移除／共 3 项，实际 parser 与幂等键校验的模拟 PUT 成功后返回规划列表。模拟接口特意拒绝漏掉事项 2，验证跨页完整集合。
- 尚待失败／冲突恢复、清空确认、已选影响说明、100 项边界及 1440／390／控制台完整浏览器验收；模拟数据不代替正式租户或数据库链路。产品中心其余完整范围继续实施。

### 依赖编辑并发草稿恢复补充（2026-09-07）

- 新增“重新读取并保留草稿”：以原始集合、本地草稿和最新集合做三方合并，保留本地增删意图及其他人新增关系，不恢复他人删除而本地未修改的关系。重新读取成功后更新事项/产品版本与影响说明要求，保留原因和影响说明，再展示相对最新集合的增删名单。不会自动保存。
- 合并超过 100 项、重复标识、读取失败或两次读取版本不一致时保留原草稿，不部分更新表单状态。
- 验证：草稿合并单测 3 项通过，针对文件 ESLint 修复后通过，Aims typecheck 通过（运行环境 Node 25 与项目声明版本不一致的警告仍存在）。
- Chrome 隔离界面验证：原前置 2，本地移除 2 并添加 3，模拟他人新增 4 且版本升为 2；重新读取得到完整集合 3、4，原因保留，增删名单为新增 3 / 移除 2。确认后，复用实际输入解析器的模拟 PUT 校验完整集合及两个版本均为 2，通过并返回规划列表。未写入业务数据库。
- 验收边界：本次为浏览器交互和模拟接口验证；该表单 390/1440 完整视觉、控制台及真实租户端到端验收仍待完成。产品中心整体方案仍在实施中。

### 容量决定快照完整性补充（2026-09-07）

- 容量基线读取区分缺失 effort_person_days 与显式 null：前者返回 planning_decision_snapshot_invalid，后者仍按未知投入进入既有决策约束。避免不完整持久化快照被误当成可显式豁免的未知估算。选择命令既有序列化已写入该字段，不涉及 schema 或数据迁移。
- 新增缺失字段、显式未知、有效数值、空容量及非法投入测试，并验证有效快照序列化往返。`go test ./internal/apps/aims/productcenter ./internal/apps/aims` 通过；本次未运行隔离 MySQL 集成用例，不代表真实租户验收完成。

### 周期关闭领域命令（2026-09-07，接口与 UI 待接）

- 新增 ClosePlanningCycle，复用周期流转输入、产品根锁、当前授权和幂等事务。只允许 active 产品的 open 周期关闭，要求 product_priorities:prioritize、产品与周期版本及原因；不支持重开。
- 关闭仅更新周期状态/版本和产品版本，追加带前后快照及原因的审计；不改规划事项生命周期、评估、决定顺序和容量快照，保留 next_review_at 的历史值。关闭不等同于项目交付完成。
- 隔离 MySQL 实测 `go test -race ./internal/apps/aims/productcenter -run TestMySQLPlanningCycleCloseAtomicity -count=1` 通过：edit 不能关闭、草案不能关闭、版本冲突、审计失败回滚、成功后的状态/版本/模型/队列保持、幂等重放与重放前重新授权、重复关闭和重开拒绝。测试数据库自动清理，未修改业务库。
- 此为领域层增量，尚未接 runtime handler、BFF、cycle-close 精确 service capability/grant 和页面确认入口，不宣称用户可用或 PC-06A 已完成。后续继续接通并覆盖关闭后各写路径及观测追加。

### 周期关闭接口与服务授权（2026-09-07）

- 接通 runtime dispatcher/handler 与 BFF close POST；复用周期输入校验、Foundation prioritize 对象授权、actor 委托及幂等键。新增独立 cycle-close capability，生成双 audience 授权 SQL。业务 grant 现为 48 条，连同 6 条传输前置共核验 54 个组合。
- 输入及授权生成契约 12 项通过；Go Aims/server 测试通过；隔离 MySQL 实测 54 组合、幂等 Seed、缺客户端、非目标客户端、缺传输授权、失效 grant 与过期凭证通过。目标租户未执行 Seed/Verify 或令牌签发探测。
- 页面关闭确认入口仍待接入，整体 PC-06A 未完成。

### 周期关闭页面接入（2026-09-07）

- 周期详情新增关闭入口，仅 active 产品具 prioritize 权限且周期 open 时显示。独立 close 页面重新读取对象权限与版本，复用周期流转表单的关闭模式，保留目标与预算上下文。
- 关闭不要求补填开放前指标；确认包含周期名、理由、不可重开、历史决定保留及未完成事项不自动转期等后果。提交绑定产品/周期版本与幂等键，15 秒超时，忙碌时阻止路由切换，失败保留理由。开放模式同步增加超时和路由更新保护。
- 针对文件 ESLint 通过。Chrome 隔离页面已检查开放周期进入关闭表单、确认内容和失败后理由保留；模拟环境尚未配置成功关闭响应，因此不声称前后端成功闭环验证。390/1440 完整视觉、控制台及真实租户验收待完成。

### 周期关闭后续期边界实测（2026-09-07）

- 扩展真实 ClosePlanningCycle 事务集成用例：关闭后向旧周期加入候选返回 planning_cycle_readonly；创建并开放下一周期成功，新周期初始候选为空；显式加入事项后 selection_status=candidate、current_assessment_id=NULL、decision_snapshot=NULL。后续操作不改变旧周期 closed 状态、周期版本及队列版本。
- 隔离 MySQL `go test -race ./internal/apps/aims/productcenter -run TestMySQLPlanningCycleCloseAtomicity -count=1` 通过。该测试证明上述续期边界，不覆盖所有闭期后写路径，也不替代已有决定/评估完整历史保留及 UI 成功流转验收。
- 补记上一轮关闭页面：Aims typecheck 已通过，存在 Node 25 与项目要求 Node 24 的环境版本警告。

### 周期结果观测领域命令（2026-09-07，读取/API/UI 待接）

- 新增 CreatePlanningObservation，使用 product_priorities:observe 的当前对象授权、根锁、双版本与幂等事务。允许 active 产品 open/closed 周期登记正式观测，拒绝草案；保存指标/基线/目标快照、精确 DECIMAL(20,6) 字符串或明确未知、含时区且毫秒精度以内的观测时间、人工证据摘要/来源、结论、原因和实际 actor。拒绝未来观测时间。
- 更正必须关联同周期原记录，沿最新更正继续追加，拒绝分叉；沿用被更正记录的指标口径，原文不可修改/删除。不改写周期基线、目标、队列或评分；只递增产品与周期版本并追加审计。证据为人工引用，不表示外部数据自动验证。
- 隔离 MySQL race 测试通过：edit 不蕴含 observe、草案拒绝、闭期追加、审计失败回滚、幂等重放及重放前授权、6 位小数精度、未知更正、分叉拒绝、数据库不可变触发器、基线/目标/队列保持。输入测试覆盖未知意图、数值越界/指数、时间缺时区/精度损失、证据空值、更正标识和 NUL；Aims/productcenter Go 测试通过。
- 尚未接观测分页读取、BFF/runtime service capability、页面与真实租户验收；不宣称结果回看已可用。

### 结果观测分页读取领域层（2026-09-07）

- 新增 ListPlanningObservations，先做当前 product_priorities:view 产品对象授权，再绑定该产品周期；产品根锁内读取总数和真实分页，按记录 ID 倒序。返回周期/产品版本、状态、指标快照、原始观测值/时间、证据/结论、记录 actor 与时间、更正来源与后续更正 ID。更正关系在整个周期内计算，不依赖当前页。未知保持 NULL，空页为 []，不从任务完成率推导结果。
- 隔离 MySQL race 实测原文/更正分处不同页面仍正确关联、未知值、精确历史值、空页保留总数、错资源拒绝和跨产品周期读取拒绝。分页参数输入测试通过。
- 目前为领域读写能力，尚待 runtime/BFF、精确观测 service scope、分页与更正 UI 接入；不代表用户可用或真实租户验收完成。

### 周期观测 Runtime 与服务授权（2026-09-07）

- 接通观测 list/create dispatcher 和 handler，分别精确 read/observe；只读 POST 仅加入 list，并扩展路由边界与授权矩阵测试。更正分叉错误映射 409。
- Manifest 新增独立 service observe，更新生成器及 Seed/Verify：50 条业务 grant，含 6 条传输前置共 56 个核验组合。Go Aims/server、授权生成契约测试通过；隔离 MySQL 56 组合实测通过（包含缺客户端、幂等、失效 grant、过期凭证）。未对目标租户执行授权安装或签发探测。
- BFF 输入/路由及前端观测页面仍待接入，产品中心整体仍未完成。

### 观测 BFF 输入与接口（2026-09-07）

- 接通观测 GET/POST，严格 camelCase 输入转 runtime 合同，查询仅允许真实分页，写入绑定路径周期、版本、原因、已知/未知值、带时区时间、证据和更正标识。客户端身份/指标覆盖拒绝。
- 输入及服务授权契约 4 项通过，覆盖精确小数、明确未知、数值类型、非法日期、精度、证据、额外字段和分页。页面及真实租户闭环仍待接入。

### 周期结果回看读取页面（2026-09-07）

- 周期详情新增结果回看入口，observations 页面使用真实 page/pageSize=20 与总数、空态、加载和错误态；按登记顺序展示指标口径、基线/目标、观测值、人工证据、结论、登记原因、actor/时间与双向更正编号。大数值字符串直接格式化，不经过浮点数。加载失败不展示旧历史。
- 针对页面 ESLint、Aims typecheck 通过（Node 25 版本警告仍存在）。Chrome 隔离模拟页面 DOM 与普通窗口截图验证未知基线/值、原记录和更正标记、99999999999999.123456 完整显示。此验证不覆盖 390/1440 完整响应式、控制台、真实多页或真实租户。
- 新增/更正表单、目录姓名呈现、友好时间格式与上述完整验收仍待完成，不宣称结果回看端到端交付。

### 结果观测登记页面初版（2026-09-07）

- 周期权限端点追加独立 observe 检查，结果回看仅 active 产品及 open/closed 周期具 observe 权限显示登记入口。observe 独立页重新读取权限与周期版本/指标，表单显示指标口径、基线/目标，提供已知/未知、十进制字符串、本地观测时间转 UTC、人工证据摘要/来源、结论与原因。
- Foundation 确认展示周期、指标、值、UTC 时间与只追加更正后果；POST 绑定双版本与幂等键、15 秒超时，忙碌时禁用输入/导航，失败保留内容。未开放更正入口，correctionOfId 固定 null。
- 针对文件 ESLint、Aims typecheck 通过（Node 25 与项目要求版本警告仍存在）。本轮未完成该表单浏览器提交和 390/1440 视觉验收；需继续验证，不宣称登记页面交付完成。更正表单及真实租户验收仍待完成。

### 观测登记浏览器验证（2026-09-07）

- Chrome 隔离环境使用实际页面/表单，模拟 POST 复用实际 productObservationCreateInput，检查 Idempotency-Key、两个版本均为 1、value_mode=unknown 与 observed_value=null。先输入 123.456789 再取消已知勾选，补齐证据/结论/原因，确认显示未知与本地 10:00 对应 UTC 13:00，模拟提交成功后返回结果回看。证明隐藏旧数值未误提交；模拟未持久化新增记录，不等同于真实数据库/租户端到端。
- 实际 390/1440 宽 iframe 内截图检查表单首屏，已见区域未出现溢出或重叠；尚未覆盖页面下半部、确认框响应式、控制台及完整异常路径，因此不声称完整视觉验收。临时权限/指标 fixture 已恢复，隔离服务已停止。
- 更正入口、草稿冲突恢复与真实租户验收仍待完成。

### 观测更正准备：单条读取链路（2026-09-07）

- 接通领域 ReadPlanningObservation、Runtime view 与 BFF 单条 GET，复用列表选择列，按产品/周期/记录 ID 精确读取，不依赖列表页。返回原文及更正关联、产品/周期版本，拒绝额外查询与非安全 ID。
- 隔离 MySQL race 实测精确原值与更正关联、错资源授权、跨产品和缺失记录；Go Aims/server、5 项 BFF 输入/授权生成契约及针对文件 ESLint 通过。更正 UI 尚未接入。

### 观测更正页面接入初版（2026-09-07）

- 结果回看对具 observe 权限且无后续更正的记录显示追加更正入口。独立 correct 页面读取产品权限、周期和单条原记录，要求版本一致、同周期且未被更正；以原记录指标口径/基线/目标展示，原值/证据/结论保留在表单上方。
- 复用登记表单更正模式，填写完整新结果、证据、结论和更正原因；确认显示原记录 ID 与原值，提交 correctionOfId，其余字段继续由服务端校验和生成。原记录不覆写；并发更正由服务端拒绝。
- 类型提取为 ProductObservation；针对文件 ESLint 与 Aims typecheck 通过（Node 25 环境版本警告仍存在）。更正页面浏览器成功/冲突验证与 390/1440 完整视觉验收仍待完成，不宣称已完成端到端更正验收。

### 更正浏览器验证与路由修复（2026-09-07）

- 浏览器发现 observations.vue 与 observations 子目录形成父子路由，父页面没有 NuxtPage 导致 correct 地址仍显示列表。将历史页移至 observations/index.vue，保留原 URL 并让 correct 独立匹配。修复后实际页面显示更正原文和输入表单。
- Chrome 隔离模拟更正流程通过：原记录 #2/未知值、证据/结论显示，填写 12.123456 及完整更正依据，Foundation 确认包含原记录、原值、新值和 UTC 时间；模拟 POST 复用实际输入解析器并检查 correction_of_id=2、两个版本=1、幂等键和精确字符串，成功返回历史页。未持久化模拟新记录，不等同于真实租户验收。
- 仍待更正并发失败/草稿恢复、完整响应式及控制台验收；原始 fixture 已恢复。

### 观测草稿并发恢复初版（2026-09-07）

- 登记/更正共用表单增加重新读取并保留草稿；不重建表单，不改观测值、时间、证据、结论和原因。重新核查 observe 权限、active 产品、open/closed 周期及有效版本后，原子更新提交版本，仍须确认提交。
- 更正时额外读取原记录并核对同周期与版本；已存在后续更正则保留草稿、提示记录编号并禁用提交，不自动重定向更正对象。新登记发现指标口径/基线/目标变更也禁用提交；网络或读取不一致不部分替换版本。权限恢复后可重新读取再提交。
- 针对文件 ESLint 与 Aims typecheck 通过；本轮浏览器并发恢复验收尚未完成，仍需实测版本更新与草稿保持、已更正阻断及响应式。整体目标未完成。

### 更正草稿并发阻断浏览器实测（2026-09-07）

- Chrome 隔离页面加载原记录 #2，在表单填写数值 12.123456、观测时间、证据摘要/来源、结论和更正原因。模拟产品/周期版本升为 2 且原记录 corrected_by_id=3，点击重新读取并保留草稿。
- 实测显示原记录已由 #3 更正、追加更正按钮禁用，全部六项填写内容与已知勾选保持，原记录仍为 #2，未自动替换更正对象。验证的是浏览器模拟读取，不是实际租户并发事务；服务端分叉拒绝另有隔离 MySQL 证据。
- 仍待可恢复版本冲突的成功重提交流程、完整视觉和真实租户验收。临时 fixture 恢复，隔离服务停止。

### 观测版本冲突恢复重提交实测（2026-09-07）

- Chrome 隔离页面用原记录 #2 与版本 1 填写完整更正草稿，模拟 POST 要求版本 2，首次确认提交返回 409 并保留全部输入。
- 将模拟周期/原记录的产品与周期版本均更新为 2，保持原记录未被更正。重新读取显示最新版本已读取，数值、时间、证据、结论、原因及原更正对象保持。再次确认后模拟 POST 校验两个版本=2、correction_of_id=2、observed_value=12.123456 和幂等键通过，返回历史页。
- 此为真实页面加实际输入解析器的模拟接口测试，不涉及持久化新记录，不替代真实租户联调。临时 fixture 已恢复，隔离服务停止。完整视觉/控制台和剩余产品中心功能继续实施。

### 开放周期预算决定领域层（2026-09-07）

- 新增 PlanningBudgetChange、PreviewPlanningBudget 与 ChangePlanningBudget，完整预算/理由/影响说明/明确例外清单，产品、周期、队列三版本；只允许 active 产品 open 周期，写需 prioritize，预览需 view。抽取既有 ValidateDecisionExceptions 共用于选入与预算决定。
- 全周期测算调整前后 confirmed/latest 容量，不覆写事项冻结基线；已有估算/类别变化拒绝静默重新确认，提交对调整后容量/依赖/复评问题执行既有 ConfirmDecision。更新预算、产品/周期/队列版本及审计/回执在同一事务。预览只读实现，不自动修改顺序或选入状态。
- 隔离 MySQL race 用例通过：edit 无权调整、完成事项 8 人日保持占用、预算 10→12 的前后测算、审计失败回滚、幂等重放、三版本递增和冻结投入保持。需继续补超配例外/并发/闭期完整测试以及 Runtime/BFF/页面；本领域增量不代表预算调整已用户可用。

### 预算决定边界与 Runtime 接入（2026-09-07）

- 隔离 MySQL race 扩展通过：旧产品/队列版本拒绝；周期 UPDATE 触发器禁止写时预览仍成功；8 人日已消耗预算降为 6 时无例外拒绝，显式总容量/类别例外后成功但仍显示 -2 与原问题；闭期调整拒绝。
- 接通预算 preview/change Runtime，独立 budget-change service scope，preview/read 只读路由，更新 dispatcher 与授权矩阵。Manifest/生成器现为 52 条业务 grant、58 组合核验；隔离 MySQL 实际 SQL 核验、授权生成契约与 Go Aims/server 通过。目标租户未安装核验。
- BFF 与预算调整页面仍待接，不能宣称用户可用。

### 预算决定 BFF 接入（2026-09-07）

- 接通 budget-preview 与 budget POST，统一 productBudgetInput；抽取周期完整预算解析与既有决定例外解析供周期/选入/预算共用，不使用伪造事项或评估字段复用整条命令。预览 view/read，提交 prioritize/budget-change 与幂等键。
- 既有周期、选入与服务 grant 契约 14 项和预算专用 2 项通过，覆盖完整金额、精度/分类总和、三版本、显式例外、额外字段、责任人、重复例外及不可豁免复评。针对实现文件 ESLint 通过。预算 UI 及真实租户验收仍待完成。

### 预算决定页面初版（2026-09-07）

- 开放周期详情新增预算调整入口，独立页面复核 prioritize 权限/产品状态及周期版本。表单显示五项原预算与新预算、原因与影响说明，预览全周期 confirmed/latest 占用与余额，负余额保留，未知投入明确。问题列表分页，例外需原因、目录责任人、影响；范围过期不可豁免。
- 预算预览新增 can_confirm/blocker，沿用提交的复评变化/ConfirmDecision 检查。页面仅允许与当前输入一致且可确认的预览提交，修改金额/原因/例外后须重预览。Foundation 确认、三版本/幂等提交，失败保留输入。
- 针对文件 ESLint、Aims typecheck、Go Aims/productcenter 通过；预算隔离 MySQL race 用例补充正常预览可确认、超配预览阻断。页面浏览器与响应式验收仍待完成，不宣称预算调整已完整交付。

### 预算页面浏览器模拟提交（2026-09-07）

- Chrome 隔离页面验证原总容量 10.75→12.50，预览已确认占用保持 8、余额 1.75→3.50；金额改成 13 后旧预览失效且提交禁用。重新预览最终金额后才能确认。
- 验证中补齐最终确认框的五项预算前后值，保留理由、影响、例外数量和占用差额。模拟 POST 复用实际 productBudgetInput，检查幂等键和 total=12.50，成功返回周期列表。测试未持久化预算，不代表真实租户完整闭环。
- 例外责任人交互、并发恢复、完整响应式和控制台验收仍待完成。隔离服务已停止。

### 预算草稿并发恢复初版（2026-09-07）

- 预算表单新增重新读取并保留草稿：重新检查 prioritize 权限、active 产品、open 周期及三版本；未修改字段采用最新预算，已修改字段保留本地输入，原值对照整体更新为最新预算。原因、影响说明与例外填写不丢弃。
- 读取前清除旧预览，恢复后须重新预览和确认；关闭/归档/失权时保留草稿并禁用预览和提交，不自动调整预算以满足分类总和。最终服务端仍校验三版本、完整预算及例外。
- 针对文件 ESLint 与 Aims typecheck 通过（Node 25 版本警告仍存在）。本轮浏览器并发恢复实测尚未完成，完整视觉及真实租户验收继续待办。

### 预算草稿合并浏览器实测（2026-09-07）

- Chrome 隔离页面初始总量 10.75/预留 1.00，本地仅改总量 12.50 并填写原因/影响，生成一次预览。模拟他人更新总量 11.75/预留 2.00 及三版本=2，再点击重新读取。
- 实测本地总量仍为 12.50、原值对照更新 11.75，未修改预留采用 2.00，其他类别保持 3.25；原因/影响保留、旧预览清除、确认按钮禁用，并明确要求重新预览。
- 本次为实际页面与模拟读取验证，不涉及持久化预算；临时周期 fixture 已恢复，隔离服务停止。例外责任人完整流程、响应式和真实租户验收仍待完成。

### 预算例外责任人浏览器验证（2026-09-07）

- Chrome 隔离实际预算页面，模拟类别超配问题，勾选明确例外并填写原因、影响；Foundation UserTreeSelector 加载隔离目录，选择产品经理甲后单选值与姓名显示正确。
- 携带例外重新预览，实际 productBudgetInput 解析通过，模拟可确认返回后按钮启用，例外输入/责任人保留，类别超配问题仍显示。未执行本例外最终持久化，目录数据和预览为模拟，不能替代目标租户责任人有效性与授权验收。
- 临时预览 fixture 已恢复，隔离服务停止。完整响应式/控制台及真实租户验收仍待完成。

### 未开工已选事项撤回领域层（2026-09-07）

- 新增 WithdrawPlanningCandidate，产品/周期/事项/队列四版本、prioritize 对象权限、理由/影响和明确例外；仅 open 周期的 selected+proposed 事项可直接撤回。已开工/结束事项拒绝释放预算，后续必须补已发生投入确认路径。
- 撤回前后完整周期容量与依赖重算，目标自身过期范围可撤回，其他已选变化不被隐式重确认；剩余依赖/容量问题使用既有例外合同。转 deferred/later，原决定快照嵌入撤回快照并写审计；不删除事项、评估或依赖，不自动改版本承诺。
- 隔离 MySQL race 通过：edit 无权、已完成事项直接释放拒绝、审计失败回滚、成功撤回后占用释放/三版本递增、幂等重放、原八人日决定保留。尚待下游依赖场景、纯读预览、Runtime/BFF/页面及已开工消耗确认；不代表完整移出流程交付。

### 未开工撤回只读预览（2026-09-07）

- 新增 PreviewPlanningWithdrawal，view 对象授权后在产品根锁内读取相同四版本与完整周期，返回前后容量、原决定、can_confirm 与 blocker；不生成临时撤回或写回执。提交仍重新计算并要求 prioritize。
- 隔离 MySQL race 扩展通过：禁止周期事项 UPDATE 的触发器存在时预览仍成功、已确认占用 8→0、正常预览可确认、错资源读取拒绝；既有撤回事务测试继续通过。下游依赖影响、多事项变更、Runtime/BFF/UI 与已开工投入确认仍待完成。

### 未开工撤回 Runtime/BFF 接入（2026-09-07）

- 接通 preview/withdraw Runtime、dispatcher、只读边界和授权矩阵；BFF 路径绑定周期/事项并严格解析四版本、理由、影响和明确例外。实际写使用独立 withdraw capability。
- 54 条业务 grant、60 核验组合的实际 SQL 隔离 MySQL 测试通过；Go Aims/server、3 项 BFF 输入/授权生成契约及针对文件 ESLint 通过。目标租户未执行授权安装。
- 下游依赖完整测试与撤回页面、已开工投入确认仍待完成，整体产品中心尚未完成。

### 未开工撤回页面接入（2026-09-07）

- 周期候选列表为 selected + proposed 事项增加撤回入口，独立页面检查产品决策权限、周期开放状态及产品/周期/事项读取版本一致性。复用评估历史读取确认周期事项归属，不要求最新评估有效，允许撤回自身已经过期的范围；实际 selected 状态由预览与提交领域层再次检查。
- 表单展示事项范围，要求撤回理由和影响说明，预览撤回后的容量与依赖问题。明确例外逐项登记原因、目录责任人和影响；输入变化使旧预览失效，只有当前输入对应的可确认预览才能提交。
- Foundation 确认框说明转暂缓/以后及保留原决定，提交绑定四版本和幂等键，失败保留输入。本轮修正复制表单遗留的“为什么本周期做”和“撤回周期”歧义文案。
- 三个相关页面/组件 ESLint 与 Aims typecheck 通过；环境仍有 Node 25 不匹配项目要求的警告。撤回页面浏览器、390/1440 视觉、下游依赖完整场景及已开工投入确认仍待验证或实施，整体产品中心未完成。

### 撤回前置事项的下游依赖回归（2026-09-07）

- 增加真实隔离 MySQL 场景：周期已选前置事项 8 人日、下游事项 1 人日，下游具有当前评估且明确依赖前置事项。撤回前置事项无例外时，预览 can_confirm=false、提交 decision_issues_unresolved，前置事项保持 selected。
- 显式登记对应下游/前置元组的依赖例外后，预览及提交成功，占用从 9 降至 1 人日；依赖边和 dependency_unresolved 告警继续保留，例外不伪装成依赖解除。相同场景同时经过只读触发器检查、审计失败回滚、幂等重放及原决定快照保留验证。
- `go test -race ./internal/apps/aims/productcenter -run TestMySQLPlanningWithdrawal -count=1` 使用隔离 MySQL 实际执行通过。此证据仅覆盖未开工撤回领域层；页面浏览器验收、已开工投入确认和整体产品中心剩余功能仍待完成。

### 撤回页面浏览器流程与容量口径（2026-09-07）

- Chrome 隔离实际页面验证：填写理由/影响后预览 8→0 人日；修改理由使旧预览失效且确认禁用，重新预览后 Foundation 确认展示对象、周期、理由、影响和转暂缓后果。模拟提交复用实际 productWithdrawalInput 并要求幂等键，通过后返回候选列表。模拟接口不写数据库，不能替代租户联调。
- 页面检查后补齐 confirmed/latest 两套容量，预览和最终确认分别展示已确认投入/差额与最新估算投入/差额，四份容量报告均验证格式；避免仅展示最新估算而掩盖冻结基线释放。修正后浏览器 DOM 再次核实两套口径正常显示。
- 组件 ESLint 与 Aims typecheck 通过，仍有 Node 25 engine 警告。完整 390/1440 视觉、控制台、并发草稿恢复及已开工投入确认仍待完成。

### 撤回草稿并发恢复（2026-09-08）

- 新增重新读取并保留草稿：重新检查决策权限、产品状态、周期开放状态、事项生命周期及周期归属读取版本一致性；成功后原子更新四版本和页面范围/标题，保留理由、影响及例外输入，清除旧预览并要求重新预览。读取失败时禁用预览/提交，保留草稿，可再次读取恢复。
- Chrome 隔离实际页面验证：原版本 1 且已预览，模拟周期/队列/产品/事项版本 2 和新范围后重新读取，显示最新范围、保留理由/影响、旧预览清除且确认禁用。再次模拟事项 in_delivery，重新读取明确拒绝直接撤回，输入仍保留，预览与提交均禁用。
- Aims 目录下组件 ESLint 与 typecheck 通过；初次误在仓库根执行的检查未运行，已在正确模块目录重跑并取得终态成功。Node 25 engine 警告仍存在。浏览器使用模拟 API，不代表持久化或目标租户验收；临时读取 fixture 已恢复。完整响应式、已开工投入确认及整体剩余功能继续待办。

### 已开工撤回的保留消耗计算基础（2026-09-08）

- DecisionItem 增加仅用于未选事项的 RetainedEffort；CapacityReport 分开返回 selected_person_days、retained_person_days 与 occupied_person_days，余额及类别超配按两类投入之和计算。已选与保留投入同时存在拒绝，防止重复计数；已确认零投入和不足 0.5 人日的实际消耗合法，未知仍以缺少确认记录区别。
- confirmed/latest 比较保留同一已发生投入，不用新估算覆盖；保留消耗不视作事项交付，下游依赖继续阻断。回归覆盖 15+4 人日占用 19、最新 16+4 占用 20、负余额、类别占用、依赖未解除、零/小额/越界和双计数拒绝。
- Go productcenter 与 Aims 包测试通过。本轮仅建立纯领域计算能力，尚未接入持久化研发确认、完整周期加载、已开工撤回命令和页面；当前线上入口仍拒绝直接撤回已开工事项，不宣称此流程已可用。

### 保留消耗快照与周期读取（2026-09-08）

- 增加 PlanningRetainedConsumption 持久化快照格式，绑定周期、事项、历史范围版本、原投资类别、明确已发生投入、确认人/时间和理由。读取严格校验，只允许 deferred 项携带保留消耗；不存在该字段的历史决定保持兼容，字段为 null/残缺/对象不匹配时拒绝而非按零处理。
- 完整周期容量加载已识别该快照，按历史类别计入 confirmed/latest 的保留投入；后续事项类别/范围变更不抹去已发生消耗。仍未接入生成该快照的研发确认命令，不能视作已开工撤回上线。
- Go productcenter/Aims 测试通过；隔离 MySQL race 撤回测试追加持久化快照：3.25 人日同时进入两种容量口径，与剩余已选投入相加；篡改快照事项标识后读取拒绝。测试通过，未写业务数据库。

### 已发生投入独立确认命令（2026-09-08）

- 新增 ConfirmPlanningConsumption 领域命令，要求 product_priorities:assess 对象授权及产品/周期/队列/事项/范围版本；仅 active 产品、open 周期、selected + in_delivery 事项允许核验。输入须明确已发生人日（允许核实后的零）及依据，不接受浏览器指定确认人。
- 当前受信 actor、服务端时间、唯一确认标识、历史范围版本、冻结类别与原决定写入 pending_consumption；替换待用确认时不递归嵌套旧确认。确认记录、产品/周期/队列版本、审计与回执原子提交，不改变选入状态、不释放预算。后续撤回须显式消费有效确认，此接线尚待完成。
- 隔离 MySQL race 测试通过：prioritize 不能代替 assess，旧范围版本拒绝，审计失败无确认泄漏，成功/幂等重放，零消耗确认仍保持原 8 人日已选容量，原决定和受信 actor 保留。本轮尚未接 Runtime/BFF/页面及精确 service grant，不宣称用户可用。

### 已开工撤回接线与 Orca 协作验证（2026-09-08）

- 撤回领域命令新增可选 consumption_confirmation_id，in_delivery 分支校验待用确认标识、事项/范围版本、周期归属及去除 pending_consumption 后的原决定结构一致性；预览保留已发生投入，提交将确认转存 retained_consumption。已结束事项仍不允许释放本期消耗。Go productcenter/Aims 包通过，新增已开工撤回集成用例尚待完成，API/UI 未接。
- 按用户要求实测 Orca 原生编排：Run run_65af5a9c965b，Task task_2188eaaf7663，Dispatch ctx_3220835dbfc6。worker-start 回执 effective model=gpt-5.3-codex-spark、effort=low，已收到 succeeded worker_done，只读审查指出已开工撤回主链路、原决定变化、确认标识/范围过期三组缺测。此审查不构成完整正确性证明。
- 使用应用内 CLI /Applications/Orca.app/Contents/Resources/bin/orca；PATH 启动器目前无法解析应用路径。独立 Claude CLI 尝试因 OAuth 过期失败，未产生审查结果。后续优先 Orca 小范围 worker，主代理整合，减少全历史复制与碎片化检查。

### Spark 测试协作与已开工撤回集成验证（2026-09-08）

- Orca Task task_e3156afbd206 / Dispatch ctx_2173d05650ca 使用 gpt-5.3-codex-spark low 新增单独 MySQL 测试文件，主代理审阅后修正错误确认标识用例缺少显式 exceptions 清单的问题，并统一运行实际数据库验证。worker 已完成并释放。
- 隔离 MySQL race 确认/撤回用例通过：已选 8 人日确认已发生 3.25 后，预览与提交均保留 3.25、余额 6.75（原总容量 10），错确认标识、范围漂移、原决定变化拒绝且三版本不前移；审计失败回滚、幂等重放、持久化 retained_consumption 和清除顶层 pending 确认通过。
- BFF 接通可选规范 consumptionConfirmationId 引用，继续拒绝客户端自填投入/确认人/快照；两项输入测试和 ESLint 通过，Runtime 已增加状态冲突映射。确认命令 API、读取、页面及授权配置仍待接入，整体产品中心未完成。

### 投入确认 Runtime/BFF 与精确授权（2026-09-08）

- Runtime dispatcher 接通 planning-consumption:confirm，独立 aims:product-priorities:consumption-confirm 服务能力和 assess 对象授权；新增能力前置拒绝矩阵及非只读传输测试。Manifest/生成器现为 56 条业务 grant、62 项核验组合。
- Orca Spark Task task_d34c36bf539c / Dispatch ctx_8cc0e4c48ea2 完成 BFF、输入解析和测试，主代理审阅、补零/小额/未知边界后整合；worker 已完成释放。路径绑定周期/事项，输入四版本加范围版本、核验依据、明确金额字符串，使用既有 actor/授权/幂等转发。
- Go Aims/server、BFF 输入与服务授权契约 5 项、Aims typecheck 通过；Spark 报告指定文件 ESLint 通过。隔离 MySQL 实际 62 项 grant SQL 核验通过，目标租户仍未安装/探测。Node 25 engine 警告保留。确认记录读取、页面及整体产品中心剩余功能未完成。

### 投入确认读取闭环与 Spark 接线失败恢复（2026-09-08）

- ReadPlanningConsumption 在授权根锁下返回当前版本/状态、pending、retained、current/blocker。确认匹配范围和原决定才能 current=true；范围过期保留原确认但标记不可使用；闭期历史仍可读，撤回后显示 retained。读取不更新版本。
- 隔离 MySQL race 覆盖有效读取、错资源授权、错事项、范围过期、闭期历史和撤回后 3.25 人日保留记录，全部通过。
- Orca Spark Task task_5013368436d4 / Dispatch ctx_d26d64511759 仅写入 Runtime handler 后上下文耗尽；终端明确报告 context window full，后续 worker-show 证实 failed/process_exited。主代理保留该 handler 并补齐 dispatcher、BFF、只读路由及测试。worker-release 返回 identity_unproven/retained，未继续操作无可证身份的终端，不把此次 worker 标为成功。
- Go Aims/server、BFF ESLint、Aims typecheck 通过。初次 server 测试发现新只读路径漏接，补齐后重跑通过。确认页面/已开工撤回页面和整体产品中心剩余功能尚待完成。后续 Spark 优先单文件测试/解析器任务，避免读取大型 server 入口耗尽上下文。

### 投入确认页面与 Claude 恢复（2026-09-08）

- 已选且 in_delivery 候选增加 assess 权限下核验入口，独立 consumption 页面读取对象/范围与确认记录并核对版本；已发生人日默认留空，核验依据必填，旧确认仅展示不自动代填。重新读取保留填写内容，失败禁用提交；最终确认含对象、范围、金额、依据及不释放预算说明，提交复用幂等键。
- 页面 typecheck 通过；初次 ESLint 报多语句同列，格式修复后两个相关文件 ESLint 通过。Chrome 实际页面+模拟 API 验证填写 3.25 人日、重新读取保留、确认对话框和提交返回候选，POST 使用实际 productConsumptionInput；不代表真实租户持久化。完整 390/1440 视觉和控制台验收待办。
- 用户重新登录 Claude 后，Orca Task task_41772dd5d652 / Dispatch ctx_29445934ef9d 使用 Claude Haiku 完成只读页面审查，登录链路确认恢复。Haiku 不支持 low effort，移除该参数后启动成功；初次生命周期回执缺 capability 被拒，按注入 preamble 重发后 accepted succeeded。审查建议未当作已证实缺陷：当前 catch 保留 Error、Foundation 处理错误展示，版本由服务端强制校验。没有据此削弱检查。已开工撤回页面仍需消费该确认记录，整体方案未完成。

### 已开工撤回页面与容量展示口径（2026-09-08）

- 已开工事项撤回页面读取投入确认，校验产品根、周期、队列、事项、范围版本及当前确认身份；仅传确认 ID，金额与确认人继续由服务端记录决定。重新读取保留撤回理由与影响说明，失效确认禁止提交。未开工撤回仍无需投入确认。
- 容量总览、选入预览、预算调整和撤回预览统一展示 occupied_person_days，并单列 retained_person_days；不再以 selected_person_days 冒充周期总占用。三类决策确认对话框同步使用总占用，容量总览保留已选投入分项。响应缺失或负数保留投入/总占用时拒绝展示有效预览。
- 四个容量展示文件 ESLint 与 Aims typecheck 通过；撤回确认绑定及 BFF 输入测试共 3 项通过。此前撤回页面格式修复检查进程已确认退出码 0。
- 上轮模拟浏览器已观察撤回预览 8 → 3.25 人日并打开确认对话框；最终提交观察被截断，本轮原标签已不存在，故不声称此次提交成功。已恢复四个临时 API fixture 并停止临时开发服务。当前新增容量展示仍待 390/1440 浏览器验收、真实租户授权和持久化联调；整体产品中心方案继续未完成。

### PC-06 长期功能候选创建领域命令（2026-09-08）

- 新增 FeatureDraft / CreateProductFeature，复用 ExecuteCommand 的根锁、重新授权、事务回执与审计；使用 product_features:edit 对象授权，创建候选功能及推进空间版本同事务执行。标题限制 500 字，说明可空、上限 10000 字，拒绝非法 UTF-8 与 NUL。创建输入不接受生命周期、项目或版本，active 证据流仍待实现。
- productcenter Go 包测试通过（未配置隔离数据库时 SQL 用例跳过）；新增字段边界及错误命令身份在访问数据库前拒绝测试。此次不作为 SQL 原子性验证证据。
- 此为内部领域命令，尚未接通 Runtime/BFF/页面或增加对应服务 grant；PC-06 功能目录 CRUD、需求关联、激活证据及路线汇总均继续待办，不宣称功能目录已可用。

### PC-06 功能目录读取与隔离 SQL 验证（2026-09-08）

- 新增 ListProductFeatures / ReadProductFeature：产品范围 view 授权、根锁下总数与分页一致读取、生命周期筛选、LOCATE 字面关键词搜索；返回生命周期证据，不推导研发进度或维护第二套路线状态。列表最多 100 条，详情使用规范 biz_id 且查询绑定产品。
- 实际隔离 MySQL race 测试通过：创建两个候选功能、分页顺序、字面 %_ 搜索、空结果、空生命周期证据读取、跨产品详情拒绝、错误动作拒绝，读取后业务行/审计/回执数量不变。初次测试发现 NULL 无法直接扫描到 json.RawMessage，改为先扫描 []byte 后重跑通过。候选输入和命令身份单测同时通过。
- 仍需创建失败回滚/并发专项测试、Runtime/BFF/页面、编辑删除、需求关联及生命周期证据命令；本次未执行业务环境迁移或写入，PC-06 尚未完成。

### PC-06 功能目录 Runtime/BFF 贯通（2026-09-08）

- Runtime features:create/list/view 与 dispatcher 接通；create 精确 service capability 独立于 read，用户创建权限使用既定 product_features:edit。列表/详情只读传输显式登记，create 不可使用只读传输；复用签名 actor 和授权票据。
- BFF 新增 products/:productCode/features GET/POST 与 features/:featureId GET；严格字段白名单、规范 ID、分页限制、生命周期过滤，创建不接受 active/项目/版本字段。用户权限、no-store、15 秒授权票据及创建幂等键均沿现有 Foundation 路径。
- Manifest 增加 product-features create/read，生成器产生 60 条业务 grant、66 项含传输核验组合。隔离 MySQL 实际 SQL 核验通过，包括幂等、缺客户端、诱饵客户端、传输前置、inactive 与过期凭证；未安装到目标租户。
- Go Aims/server 测试、新增 BFF ESLint、输入与 manifest/生成器契约 4 项测试、Aims typecheck 全部通过。功能页面、维护命令和需求关联继续待实现；完整方案仍未完成。

### PC-06 功能目录首批页面（2026-09-08）

- 产品空间增加功能目录入口；features/index 提供服务端分页、关键词防抖、生命周期筛选、候选创建表单和详情链接，features/:featureId 显示长期功能说明和生命周期。没有将能力生命周期显示为研发百分比。
- 新增 features/permissions BFF，复用 product_features view/edit；只有 active 产品且 edit 授权允许创建。表单绑定空间版本，失败保留内容、相同请求复用幂等键，重新读取后采用当前版本，提交中阻止路由切换。
- 相关页面和权限 BFF ESLint、Aims typecheck 通过。初次类型检查发现动态权限 URL 无法推导响应类型，增加明确响应契约后重跑通过。
- 尚未完成本批页面 390/1440 浏览器验收、真实授权与持久化联调；编辑/删除、需求关联、生命周期证据操作和其余产品中心能力仍待实现。

### PC-06 功能说明修改命令与 API（2026-09-08）

- EditProductFeature 以产品空间/功能双版本保护标题和说明修改，原因必填，前后快照与回执同事务；保留 lifecycle/evidence，不更新规划范围或已有决策。新增 Runtime features:edit、BFF PATCH features/:featureId 和独立 product-features:edit 服务能力，版本冲突映射 409。
- 隔离 MySQL race 通过功能编辑/读取与候选输入测试：编辑幂等重放、保留 active 证据、旧功能版本拒绝、错误 view 权限拒绝、注入审计失败后内容/根版本/回执回滚。此处 active 数据为测试直接构造，不代表激活命令已实现。
- Go Aims/server、BFF ESLint、5 项输入/授权契约测试和 Aims typecheck 通过。授权生成器现为 62 条业务 grant、68 个核验组合，实际隔离 SQL 全部通过；未安装真实租户授权。隔离 MySQL 已停止。
- 页面编辑入口尚未实现；删除、需求关联、生命周期证据操作及整体方案仍待完成。

### PC-06 功能详情修改页面与浏览器验证（2026-09-08）

- 功能详情增加 active 产品且 edit 授权下编辑入口；修改名称、说明、原因，绑定空间/功能双版本，相同内容复用幂等键，最终确认展示将保存的内容。重新读取保留草稿，读取失败或权限失效禁用提交；保存/刷新期间阻止路由切换。
- 该页面 ESLint 与 Aims typecheck 通过。Chrome 实际页面配合隔离模拟 API 验证：空原因禁用、填入说明与原因、重新读取保留、最终确认、PATCH 经实际 productFeatureEditInput 与幂等键检查后关闭表单。模拟读取为固定数据，不把表单关闭当作真实持久化成功证据。
- 临时三条 API fixture 已删除，临时开发服务已停止。390/1440 完整视觉验收、真实租户授权联调及其余产品中心需求仍待完成。

### PC-06 无引用候选功能删除领域规则（2026-09-08）

- DeleteProductFeature 使用专用 product_features:delete 对象授权、产品根/功能双版本及删除原因；只接受 candidate 且无生命周期证据的功能，查询需求关联、规划事项及版本特性引用后才可删除。删除前完整功能快照、原因、审计、根版本推进和幂等回执同事务保留。
- 隔离 MySQL race 实测通过：edit 权限拒绝、active/deprecated 拒绝、规划引用拒绝、审计失败回滚、成功删除后详情不存在、幂等重放及根版本/审计/回执无重复。需求及版本引用分支尚未单独构造 SQL 回归，不把规划引用用例视为三类引用全覆盖。
- 领域包测试通过；隔离数据库已停止。Runtime/BFF/页面删除入口与专用服务授权尚待接通，不宣称删除功能已交付；整体方案继续未完成。

### PC-06 删除接口与页面入口（2026-09-08）

- Runtime features:delete、dispatcher 与 BFF DELETE features/:featureId 接通，使用 product-features:delete 精确服务能力与 product_features:delete 对象授权。客户端只能传双版本和原因，拒绝 force/引用数量/生命周期/快照等额外字段；引用与状态冲突映射 409。
- 功能详情根据候选状态和独立 delete 授权显示删除表单，原因必填，Foundation danger 确认包含对象及不可撤销说明；调用实际 DELETE，失败保留原因，相同内容复用幂等键，成功返回目录。提交期间沿用页面路由保护。
- Go Aims/server、BFF 输入及生成器/manifest 契约 6 项、相关 ESLint、页面更新后 Aims typecheck 通过。生成器现为 64 条业务 grant、70 项核验组合；实际隔离 SQL 核验通过，测试数据库已停止。目标租户未安装授权。
- 本批删除交互浏览器验收、需求/版本引用专项 SQL 回归仍待补齐；功能关联与生命周期操作等整体方案剩余范围不变。

### PC-06 删除引用保护专项补验（2026-09-08）

- 扩展实际 MySQL 删除测试，分别构造 product_request_features 需求关系和 product_version_features 版本特性关系；两条独立引用路径均返回 product_feature_referenced，不依赖规划引用用例替代。
- 增加 candidate 但仍有 lifecycle_evidence 的历史能力场景，确认状态回退不能绕过历史能力保护。清理各测试引用后，继续验证原有审计失败回滚、删除成功与幂等重放。
- 隔离 MySQL race 测试通过，数据库已停止。需求/规划/版本三类引用删除保护现有实际 SQL 证据；浏览器删除验收、需求关联管理、生命周期操作以及整体方案其余需求仍未完成。

### PC-06 需求功能关联领域命令（2026-09-08）

- ChangeFeatureRequest 提供明确 link/unlink，产品根/需求/功能三版本检查；同产品查询并同时验证 product_requests:edit 与 product_features:view 授权。已合并需求只读，已弃用功能不允许新关联。关系变化推进双方及空间版本，关联规划事项的 evidence_revision 同事务增加，不改写冻结决定或自动选入交付范围。
- 审计保存需求/功能 biz_id、关联前后状态和原因，与关系写入、版本及回执同事务；重复关联状态拒绝，原幂等键重放返回回执。
- 隔离 MySQL race 通过：双方错误权限拒绝、关联成功、幂等重放、重复状态冲突、审计失败关系回滚、解除成功和三个版本的精确推进。跨产品、合并/弃用、关联规划证据失效分支仍需专项 SQL 测试。数据库已停止。
- 本次仅领域能力，读取关联列表、Runtime/BFF/页面及 service grants 尚待接通；整体方案继续未完成。

### PC-06 功能关联需求读取与证据版本验证（2026-09-08）

- 新增 ListFeatureRequests，产品根锁下同时检查需求/功能 view 授权，按规范功能 biz_id 与同产品关系分页查询，返回需求记录、总数和空间版本；不通过功能权限泄露缺少需求查看权限的内容。
- 扩展隔离 MySQL race 测试并通过：关联后一条需求、越页为空且总数一致、错资源授权拒绝、解除后为空；关联规划事项在 link/unlink 各推进一次 evidence_revision/revision，审计失败回滚和原键重放无额外推进，最终均为 3。
- 该测试证明证据版本推进，不替代完整评分页面复评验收。数据库已停止；关联 Runtime/BFF/页面、跨产品/合并/弃用专项测试以及其余产品中心功能仍待完成。

### PC-06 关联 Runtime 接线（2026-09-08）

- 新增 feature-requests:list/change Runtime 路径并接入 dispatcher；读取使用 product-features:read，变更使用独立 product-features:request-link。分别解码需求和功能授权票据，由领域事务重新核验双方权限。关联状态冲突映射 409。
- 只读传输仅登记 feature-requests:list，change 不可使用只读传输。Go Aims/server 测试通过，新增宽权限、通配符、需求编辑及功能编辑能力均不能替代精确接口 capability 的拒绝矩阵。
- Manifest 已声明 request-link；BFF、页面和对应 grant 生成尚待接通，本次不改变现有 64 条业务 grant/70 项核验组合。整体方案继续未完成。

### PC-06 需求关联 BFF 与授权生成（2026-09-08）

- GET/POST products/:productCode/features/:featureId/requests 接入 Runtime list/change。读取同时需要需求和功能 view；关联变更要求需求 edit 与功能 view，分别产生服务器授权票据。路径绑定功能，变更输入只允许需求 ID、三版本、明确 link/unlink 和原因，幂等键必填。
- request-link 加入授权生成器：现为 66 条业务 grant、72 项含传输核验组合。实际隔离 SQL 验证通过，临时数据库已停止；真实租户未安装。
- 新增输入/生成器契约 4 项通过、相关 ESLint 和 Aims typecheck 通过。首次 lint 发现 import 后缺空行，修复后重跑通过。
- 页面关联选择/解除与浏览器验收、跨产品和生命周期分支专项测试仍待完成；整体方案保持原范围。

### PC-06 功能需求关联页面（2026-09-08）

- 功能详情增加关联需求入口；详情迁为 features/:featureId/index，关联页位于 requests 子路径，避免无 NuxtPage 的详情父页遮挡子路由。关联页包含独立服务端分页的已关联需求和可搜索需求池，操作填写原因后明确 link/unlink。
- 变更前读取当前功能/需求/权限、绑定三版本并确认双方名称与原因；已合并需求不可操作，已弃用功能只允许解除旧关联。相同变更失败重试保留原版本与幂等键，显式重新读取后允许按新版本重试；服务端仍最终校验引用状态与双方权限。
- 新关联页及迁移后的详情页 ESLint、Aims typecheck 通过。初次 lint 单行 try/finally 超出语句限制，调整后通过。本批页面尚未浏览器验收，不将类型检查等同路由/交互实测；整体方案剩余范围不变。

### PC-06 关联对象与状态边界补验（2026-09-08）

- 扩展隔离 MySQL race 关联测试：有效本产品授权下传入另一产品的功能或需求均返回不存在；另一产品功能的关联列表也无法读取。
- 三个版本分别不匹配、已合并需求、已弃用功能新关联均拒绝；全部拒绝后关联表仍为空。随后原有成功关联、读取、幂等、解除、审计失败回滚及规划证据推进继续通过。
- 实际 SQL 测试通过，测试数据库已停止。关联页面浏览器验收、功能生命周期命令及完整产品中心剩余功能继续待办。

### PC-06 功能生命周期输入与转换规则（2026-09-08）

- 新增生命周期输入及转换校验：仅 candidate→active、active→deprecated、deprecated→active，要求产品负责人；激活/恢复必须给出明确存量能力说明或规范发布记录引用，弃用不得覆盖原能力证据，所有操作原因必填并绑定双版本。
- Go 领域包测试通过，覆盖转换矩阵、非负责人拒绝、证据缺失/混用、发布 ID 格式及弃用证据保护。发布 ID 格式通过不等于发布有效，函数注释明确要求后续事务内核验。
- 尚未实现生命周期持久化命令、当前发布/撤回证据查询、Runtime/BFF/页面；本次不宣称生命周期操作可用，不增加服务授权。整体方案原范围继续待完成。

### PC-06 生命周期事务与能力证据（2026-09-08）

- ChangeFeatureLifecycle 复用事务/授权/回执，edit 授权之外要求当前 IsManager，激活证据写入服务器确认人和时间；弃用保留旧证据，恢复重新确认证据，完整前后快照入审计。
- 发布证据核验器要求本产品、当前 release 指针、released 状态、verified 记录且有发布人/时间、无撤回/替代事件。冻结范围证据投影约定 version=1、features 数组内 product_feature_biz_id/status，目标功能必须唯一且 delivered；未知历史形状拒绝。后续发布写入命令必须产出该投影并补齐发布证据集成测试，当前尚未有发布写入端。
- 隔离 MySQL race 通过非负责人拒绝、存量证据激活、幂等、弃用失败回滚/成功保留证据、无效发布引用拒绝、存量证据恢复；初次测试因 fixture 未含负责人而拒绝，保留该负例并补实际 manager 关系后通过。真实有效/撤回/替代/错范围发布样例尚待测试。
- 数据库已停止；生命周期 Runtime/BFF/页面及整体剩余需求仍待完成。

### PC-06 发布证据有效性 SQL 矩阵（2026-09-08）

- 新增隔离 MySQL race 发布证据核验矩阵 12 个子场景：当前有效 verified 发布接受；withdrawn、superseded、其他产品、developing、archived、legacy_import、非当前指针、其他功能、仅 planned、重复目标功能、未知范围形状均拒绝。
- 全部测试通过，使用冻结记录和事件表直接构造 fixture，仅验证核验器，不等同发布命令/验收签署/内容哈希生成已实现或完整发布闭环已通过。数据库已停止。
- 生命周期接口与页面、关联页面浏览器验收、正式发布写入和整体产品中心剩余需求仍待完成。

### PC-06 生命周期 Runtime/BFF（2026-09-08）

- Runtime features:lifecycle 和 BFF POST features/:featureId/lifecycle 接通，使用独立 product-features:lifecycle 服务能力；BFF 和事务均要求当前产品负责人，普通说明 PATCH 仍不能修改生命周期。
- 输入严格分离存量说明与发布记录引用，原因和双版本必填；不接受客户端确认人、负责人标记，弃用不允许覆盖旧证据。状态/发布证据冲突映射 409。
- Go Aims/server、相关 ESLint、3 项输入/授权契约及 Aims typecheck 通过；授权生成器现为 68 条业务 grant、74 项含传输核验，实际隔离 SQL 通过。临时数据库已停止，真实租户未安装授权。
- 生命周期页面、关联/删除浏览器验收、正式发布与其余产品中心能力仍待完成。

### PC-06 功能生命周期页面（2026-09-08）

- 权限 BFF 返回 lifecycle=edit且当前负责人，详情增加相应入口；独立生命周期页按当前状态提供激活/弃用/恢复，显示当前能力证据，存量说明与发布引用互斥，原因必填并最终确认。提交采用双版本/幂等，失败保留输入，重新读取后使用最新状态，提交中保护路由。
- 页面/权限 BFF ESLint 和 Aims typecheck 通过；初次类型检查指出确认状态索引类型过宽，限定 active/deprecated 后重跑通过。
- 发布证据暂以规范记录标识输入，待版本发布界面补可选择入口；当前确认人展示 UID/原始时间尚待目录名称/本地时间优化。本批页面尚未浏览器验收，完整产品中心仍未完成。

### PC-06 规划事项与长期功能绑定领域能力（2026-09-08）

- 现有 PlanningItemDraft/Edit 未使用 feature_id，新增独立 ChangePlanningFeature：规划 edit 与功能 view 双授权，产品/事项/功能版本校验，明确 link/unlink；已有功能不能静默替换，已结束事项只读，弃用功能禁止新关联，已选入/交付中事项要求影响说明。
- 关联变化更新 item.scope_revision/revision 与根版本，审计保存功能 biz_id、操作、原因、影响及范围版本变化；不直接修改队列或冻结决定。
- 隔离 MySQL race 通过无编辑权限拒绝、关联/幂等重放、重复绑定冲突、解除审计失败回滚、解除成功后的空绑定及范围版本精确推进。已选入影响说明、跨产品、终态与弃用分支仍待专项测试。数据库已停止。
- 新命令的 Runtime/BFF/页面、功能规划读取和路线汇总尚待接通；本次不增加未接通能力的 service grant，整体方案继续未完成。

### PC-06 规划功能绑定边界补验（2026-09-08）

- 扩展实际 MySQL race 测试：merged/delivered/cancelled 事项禁止绑定，in_delivery 缺影响说明拒绝；填写影响说明后仍禁止关联 deprecated 功能；根/事项/功能三个版本分别失配均拒绝。
- 在上述拒绝后继续执行关联成功、重放、重复绑定、审计回滚与解除，最终范围/事项版本保持预期，测试通过。此次仅覆盖 in_delivery 的影响说明，不替代 selected 候选场景或跨产品绑定专项验证。
- 隔离数据库已停止。接口、规划绑定页面、功能路线汇总及整体产品中心其余范围仍待完成。

### PC-06 规划功能关联读取（2026-09-08）

- 新增 ReadPlanningFeature，在产品根锁下同时核验规划与功能 view 权限，返回事项标题/生命周期、当前功能或 null、产品/事项/范围版本及影响说明要求。功能记录按同产品查询，解绑状态不会返回旧功能。
- 隔离 MySQL race 通过关联后的完整读取、缺少功能查看授权拒绝、解除后 null 与精确版本；与原有状态/版本保护、回滚和幂等测试一并通过。数据库已停止。
- 读取/变更 Runtime、BFF、页面和功能路线汇总仍待接通，整体产品中心范围保持未完成。

### PC-06 规划功能关联 Runtime/BFF（2026-09-08）

- Runtime planning-feature:view/change 接通 dispatcher；view 使用 product-priorities:read，change 使用独立 feature-link 能力，分别读取规划和功能授权票据。只读传输仅放行 view，状态冲突映射 409。
- BFF GET/POST planning-items/:itemId/feature 绑定事项路径，变更仅接受目标功能、三版本、明确操作、原因与影响说明；规划 view/edit 与功能 view 分别由 Foundation 校验，复用签名 actor 与创建幂等转发。
- Go Aims/server、相关 ESLint、3 项输入/manifest 契约与 Aims typecheck 通过。授权生成器现 70 条业务 grant、76 项含传输核验，实际隔离 SQL 通过；测试数据库已停止，真实租户未安装。
- 规划关联页面、功能路线汇总与其余完整方案需求仍待实现和验收。

### PC-06 规划功能关联页面（2026-09-08）

- 规划详情操作区增加长期功能关联入口，独立页面展示当前功能、事项范围版本与影响要求；无绑定时可搜索分页选择功能，有绑定时先显式解除。弃用功能不可选，终态事项只读，权限或版本读取不一致时禁用操作。
- 原因必填，交付/已选入要求影响说明；最终确认列出事项、功能、原因和影响。提交复用三版本及幂等键，重新读取保留文本并清空旧选择，避免误用过期目标；忙时保护路由。
- 相关页面 ESLint、Aims typecheck 通过。本批页面尚未浏览器验收，跨产品/selected 场景的绑定专项验证和功能路线汇总等仍待完成。

### PC-06 功能周期路线读取（2026-09-08）

- ReadFeatureRoadmap 明确绑定产品/功能/周期，双 view 授权及产品根锁；从关联事项和周期决定派生 roadmap_bucket/decision_rank，不写功能路线状态。分页返回事项范围、生命周期、选择状态及决定位置，全量 by_bucket/total 独立于分页，附根/周期/队列版本。
- 隔离 MySQL race 构造同功能两个周期事项，验证 now/next 全量计数、以决定顺序而非创建顺序分页、第二页位置正确，并继续通过已有绑定/解除/回滚测试。数据库已停止。
- 当前为领域读取，接口和页面尚待接通；无周期事项如何展示、已关闭周期历史筛选、跨产品路线查询专项及整体剩余功能仍待验收。

### PC-06 功能路线 Runtime/BFF（2026-09-08）

- Runtime feature-roadmap:view、dispatcher 和 BFF GET features/:featureId/roadmap 接通；cycleId 必填、分页有界，功能由路径绑定。双 view 授权、签名 actor、15 秒票据及 no-store 沿现有 Foundation 路径，复用 product-priorities:read，不增加 grant。
- Go Aims/server 测试通过，包括精确能力拒绝与只读传输登记；输入及 manifest/生成器 3 项测试、ESLint、Aims typecheck 通过。
- 功能路线页面、无周期事项展示、历史周期与跨产品专项以及整体剩余方案仍待完成。

### PC-06 功能周期路线页面（2026-09-08）

- 功能详情增加路线入口；路线页支持服务端分页搜索周期、明确选择周期、全量 now/next/later 汇总和按决定顺序的分页事项列表，展示选择状态/事项生命周期并链接回规划功能关系。空结果明确不包含未进入所选周期的事项。
- 路线响应验证功能/周期标识、版本、状态及汇总总数一致，切换对象清空旧选择；只有当前选择周期的结果可展示，读取失败保留错误提示。
- 相关页面 ESLint 和 Aims typecheck 通过；当前尚未浏览器验收。跨产品/历史周期专项、无周期关联事项展示及完整产品中心其余工作仍待完成。

### PC-06 功能路线与未排期事项（2026-09-08）

- 功能路线页面接通周期选择、三类路线总数和事项分页；新增独立“尚未排入周期”列表，从服务端读取关联此功能且没有任何周期关联的事项，包含原有生命周期，不将它们计入所选周期。
- GET `/api/v1/products/:productCode/features/:featureId/unscheduled` 接入 Runtime `feature-unscheduled:view`；双 `product_priorities:view` / `product_features:view`、精确服务 read、产品根锁、功能归属及有界分页。沿用现有授权，不新增 grant。
- Go Aims / productcenter / server 测试、页面和 BFF ESLint、Aims typecheck 通过。隔离 MySQL race 回归验证进入周期前可见、进入任意周期后排除、空页总数稳定、错误功能权限拒绝。
- 本地隔离 mock 浏览器实际操作确认：21 条未排期事项的第二页仅显示第 21 条，选择周期后仍保持独立总数及路线统计。该检查不等同真实服务端端到端验收；1440/390 视觉验收、历史周期语义、项目转交与完整版本交付链仍未完成。

### PC-07 项目需求创建事务复用准备（2026-09-08）

- 提取 `createProjectRequirementTx`，由调用方持有事务；旧 `createProjectRequirementAttempt` 继续负责 begin/commit，原入口授权、active 项目校验、重试和返回格式保持。章节锁检查、编号、草稿创建、内容关联及文档 dirty 更新仍使用同一个 tx。
- 定向 Go 测试通过：原创建需求及关联章节行为不变；新增 sqlmock 用例验证草稿函数不自行提交，调用方能继续写来源关系并在该步骤失败后 rollback。这是事务所有权测试，尚不证明完整转交数据库原子性。
- Orca Claude Haiku 独立核查了事务边界，确认需保留 scope_note 截断、章节层级和文档 dirty 分支。转交输入将需明确拒绝超长范围以避免静默截断。PC-07 的双方新授权、选择决定门禁、稳定切片关联、审计回执、Runtime/BFF/UI 和真实 MySQL 故障注入仍待接通。

### PC-07 / PC-08 共用交付决定校验（2026-09-08）

- 新增 `ValidatePlanningDeliveryTx`，供已取得来源动作权限和产品根锁的转交/版本范围命令同事务调用；本函数不授予产品或项目权限。绑定产品、事项、周期及四类期望版本，要求 active 产品、open 周期、selected 且未结束事项、完整决定快照，比较当前范围/证据/模型/投资类别/投入与已确认依据，返回可冻结的决定基准。
- 定向真实 MySQL race 测试通过：正式选择后可读取交付依据，候选/闭期/范围变化/证据变化/已交付/队列版本冲突拒绝；通过正式命令追加 9 人日评估后，原 8 人日决定不能用于新交付。原评估保持 append-only，未为测试绕过不可变证据触发器。
- Aims/productcenter Go 测试通过。本函数尚未接入在线转交或版本范围入口；未选事项的独立紧急例外路径、范围重新确认、双方权限和完整原子转交仍待实现，不能据此宣称 AC-28 已完成。

### PC-07 转交输入与需求来源约束（2026-09-08）

- 新增 PlanningHandoffInput：共用四类决定版本、目标项目、明确 slice_key、create/link 两种操作、本次范围和原因、可选版本意图。创建草稿不得混入已有 requirement_id；关联已有需求必须指定 ID 且不得覆盖标题；范围超过 2000 字直接拒绝，避免项目 scope_note 静默截断。版本特性不能脱离版本提交。
- ResolvePlanningHandoffSourceTx 在调用方已授权的产品根事务内核对事项存在及同产品 request 关联、来源 revision 和 merged 状态；有来源的事项不得省略需求，有且只有无来源工程事项可返回空来源。该函数不替代调用方的 product_requests:handoff 权限验证。
- Go Aims/productcenter 测试及真实 MySQL race 测试通过：无来源工程事项、合法来源、无关系需求拒绝、来源版本冲突、省略来源拒绝、合并后只读；同时复验正式选择决定门禁。在线转交命令、目标项目权限/状态/绑定、版本意图校验、切片幂等及同事务持久化仍待完成。

### PC-07 转交领域事务与切片防重（2026-09-08）

- 新增 HandoffPlanningItem：执行来源 handoff 授权、项目授权回调（在回执前）、共用决定门禁与需求来源校验；项目侧需求处理、delivery_link、包含决定与来源的范围快照、事项/根 revision、审计及回执同事务。保留 proposed 生命周期，不将项目需求草稿误作已开始执行。
- 同幂等键按原回执重放；同事项/项目/切片换键时，只在冻结业务意图一致时复用已有关系，不再调用项目创建；范围不一致返回切片冲突，要求显式新切片。
- Go Aims/productcenter 测试及真实 MySQL race 回归通过：审计故障后项目侧测试草稿、来源关系、回执全部回滚；成功后键重放和同切片换键均不重复创建；项目权限撤销后旧回执重放拒绝。
- 项目侧使用同事务 fixture hook 验证组合原子性，尚未接入生产 adapter。该 adapter 必须实现 Foundation 项目需求编辑授权、active product_dev 与产品绑定校验、版本意图校验，以及 createProjectRequirementTx/已有项目需求归属校验；当前没有开放新在线入口，完整端到端转交尚未完成。

### PC-07 项目侧同事务需求处理（2026-09-08）

- 新增 resolveProductHandoffRequirementTx：校验已经授权的 project ID 与稳定 project_code 一致，锁定项目并确认 active/product_dev，锁定本产品绑定；尊重绑定限定的 version_id，可选版本须同产品且 planning/developing，版本特性须 planned 且关联同一规划事项。
- link 路径锁定同项目 requirement，只允许 draft/in_review/baselined/change_pending，拒绝 deprecated，不更新标题、正文或基线。create 路径实际复用 createProjectRequirementTx，创建 draft 需求及仅含本次范围的二级章节，项目优先级保持默认 P2，不把产品推荐顺序覆盖为项目优先级；提交权仍归转交外层事务。
- 定向 Go/sqlmock 回归通过：错授权项目、非产品研发、非 active、缺绑定、跨项目需求、废弃需求与版本限定冲突拒绝；已基线需求可只关联且无内容写入；创建路径写入 draft/范围章节，并保持调用方 rollback 能力。
- 尚未接入在线 handler，项目 Foundation 授权票据与新 capability、真实项目 schema 联合 MySQL 测试、版本/特性专项及 BFF/UI 仍待完成。以上 SQLmock 不等同完整转交端到端验收。

### PC-07 目标项目授权事实与事务复验（2026-09-08）

- 新增项目事实加载与 productHandoffProjectPermit：只接受 requirements:edit、相同 actor/project ID/code 和短期有效票据；锁定项目、当前 actor 成员行后重读部门、负责人、创建人、成员关系，任何事实漂移均在回执前拒绝。不在 Runtime 重新实现角色/Scope 算法。
- 新增 productHandoffProjectObject，按现有 Aims 项目上下文构造 Foundation object，保留 owner、projectOwner、department 与成员/负责人关系；无效 ID、错项目/actor 和缺失字段返回 null，不做路由 ID 或空对象回退。
- 定向 Go/sqlmock 覆盖成员撤销、部门迁移、负责人/创建人变化、项目替换、过期/超长有效期、错误资源/actor；TypeScript 对象映射测试、ESLint 和 Aims typecheck 通过。
- 此为新在线转交入口的内部授权基础，尚未增加事实读取 endpoint、调用 Foundation 的 BFF permit 签发或 Runtime handoff dispatcher；真实并发授权撤销与全链路验证仍待完成。

### PC-07 转交 Runtime/BFF 与响应协议修复（2026-09-08）

- 两个 handoffs POST 入口已接同一领域事务，接通项目事实读取、Foundation requirements:edit 和相关产品动作检查、短期票据、签名 actor、实际项目草稿创建或已有需求关联；新增 project-authorization/handoff 精确服务能力及生成授权清单。
- 发现并修复 product dispatcher 中 37 个处理分支遗漏 `{code,data}` 响应包装：这些接口此前领域测试通过但真实 BFF 会判为失败。已统一在总入口包装，新增通过 HandleRuntime 的项目事实响应回归。原 mock 浏览器验证不能证明真实协议接通，后续必须补真实全链路验收。
- Go Aims/productcenter/server 测试、严格 BFF 输入与生成 grant 测试、ESLint、Aims typecheck 通过；隔离 MySQL grant seed/verify 实测 74 条业务授权、80 个检查组合，含幂等、缺客户端/传输权限、失效授权与过期凭证。未对目标租户安装授权。
- 转交 UI、真实项目 schema 下完整端到端交互、并发撤销、版本特性专项、既有规划/功能真实响应回归仍待完成；不宣称 PC-07 或整体方案验收完成。

### PC-07 转交页面与项目选择（2026-09-08）

- 规划详情增加转交入口；独立页面接通当前开放周期、来源需求、产品 handoff 权限、项目分页选择、创建草稿/关联已有需求、本次范围/切片/原因及 Foundation 确认。失败保留草稿和同 payload 幂等键；提交期间阻止离页，切换事项清理选择与草稿。
- 项目列表新增 product_code 参数，以 EXISTS 产品绑定条件参与同一服务端 count/list，保留既有项目可见范围、category/lifecycle_status/search；选择器只请求 active product_dev。项目与已有需求列表页码独立，修复共用 useListPage 路由参数造成的互相重置。
- Go 项目筛选回归、相关 ESLint 与 Aims typecheck 通过；隔离 mock 浏览器完成第二页项目选择、原因填写、确认与 POST（复用实际 productHandoffInput 校验并检查幂等键），成功提示可见。修复后再验：选中第 21 个项目仍停留第二页。
- 当前仅证明 mock UI 创建路径；实际目标环境转交、关联已有需求/多来源交互、版本意图选择、1440/390 视觉检查、项目绑定筛选真实 SQL 联合验证仍待完成，未宣称整体完成。

### PC-07 实际项目 Schema 的 Runtime 联合 MySQL 验证（2026-09-08）

- 新增 TestMySQLProductHandoffRuntimeCreatesActualProjectDraft。仅允许专属 /tmp/hzy-product-center.* Unix socket，随机创建/删除测试数据库；产品表从旧 schema 执行 v5.19 迁移，项目/需求/章节及查询依赖采用 aims_schema.sql 的实际 CREATE TABLE 定义。装载期间关闭外键检查以解决未装载模块/循环依赖，执行命令前重新开启。
- 通过实际产品周期、候选、评估、选择领域命令准备决定，经过 Aims HandleRuntime 总入口、真实项目授权事实复验与 createProjectRequirementTx 完成转交；验证成功响应 envelope、draft 状态、标题/范围章节、回执重放不重复创建。
- 在审计 INSERT 注入失败，实际 requirement_items、requirement_contents、requirement_item_contents、product_request_delivery_links 全部回滚；移除故障后同键可成功提交。
- link 路径经实际 Runtime 关联另一个已基线需求，验证原标题、current_version、正文和 baselined 状态不变，关联不会增加需求/章节；项目列表实际 SQL 在两个绑定项目与一个未绑定项目场景下，两页各返回一个不同绑定项目、总数均为 2。
- 定向真实 MySQL -race 与 Go Aims/productcenter/server 测试通过。这是 Runtime/数据库联合验证，未经过真实 Console JWT 签发或浏览器 BFF；真实目标租户部署授权及完整 UI/版本意图验收仍待完成。

### PC-08 按产品规划版本的领域能力（2026-09-08）

- 新增 CreateProductCenterVersion：产品范围 edit 授权、根 revision/active 检查、固定 planning 初态、无 owner_project_id 也可创建；不写发布/验收/牵头项目事实。版本、根 revision、审计及回执同事务。新增版本号/名称/说明/日期边界校验。
- 新增 ListProductCenterVersions：产品范围 view、根锁、有界分页、状态/字面关键词筛选、完整 total，保留旧版本的项目归属与发布引用字段；归档产品仍可读历史。
- 真实 MySQL race 验证创建无项目版本、同键重放、页码/日期/初态、审计失败回滚、归档后禁止创建、字面搜索及大小写不同产品的读取隔离通过；Go Aims/productcenter 回归通过。
- 发现旧 product_versions/aims_project_products 编码列使用大小写不敏感排序；新版本读取和转交绑定/项目筛选已用 BINARY 精确比较。实际项目 Schema 联合测试增加不同大小写产品绑定，验证不能误作当前产品绑定，分页不混入该项目。旧表唯一索引的产品编码排序规则仍需在版本兼容迁移中核对。
- 本批尚未接入版本 Runtime/BFF/UI；旧项目版本写入口的产品权限切换、版本范围/验收/发布/更正及历史兼容仍待完成，PC-08 未完成。

### PC-08 版本 Runtime/BFF 与清单页面（2026-09-08）

- 接通 GET/POST products/{productCode}/versions 与权限读取；Runtime 使用 product-versions:read/create 精确 capability，创建只接受版本基本信息与根 revision。Manifest 生成 78 条业务 grant、84 项含传输前提检查；实际隔离 MySQL seed/verify 的幂等、缺失/失效授权和过期凭证验证通过。
- 实际项目 Schema 联合测试经 HandleRuntime 创建无牵头项目版本并读取列表，验证成功响应协议、产品版本号与 owner_project_id 为空；定向真实 MySQL race 通过。
- 产品空间增加版本入口；列表支持服务端分页、防抖搜索、状态筛选，四字段创建使用 UModal，权限/归档状态控制入口，提交失败保留表单与相同 payload 幂等键，可刷新根 revision 后重试。提交期间禁止关闭弹窗与切换路由。
- Aims typecheck 与本次页面/接口 ESLint 通过；本地 mock 浏览器验证 21 条数据的第二页仅显示第 21 条、弹窗字段及创建提交后关闭。Mock POST 复用真实输入校验并要求幂等键，未证明真实 BFF/Console 全链路或实际新增记录的列表回显。
- 1440/390 视觉验收、版本详情/范围/验收/发布/更正、旧项目写入口权限切换、目标租户安装与令牌签发探测仍未完成，不宣称 PC-08 或产品中心整体完成。
- Go Aims/productcenter/server 回归通过。Orca Claude Haiku 完成定向只读审查，未报告明显可复现问题；该审查未覆盖并发与真实接口，不能替代联调验收。临时 UI mock 与服务已清理，隔离 MySQL 已停止。

### PC-08 版本详情与基本信息编辑（2026-09-08）

- 新增产品范围版本详情与 PATCH 编辑链路，贯通列表入口、详情页面、五字段编辑弹窗、Foundation 确认、BFF 和 Runtime 领域命令。产品编码精确匹配；产品 active 且版本 planning/developing 才可编辑，产品与版本 revision 双重检查。发布/归档版本拒绝基本信息覆盖；scope_revision、实施项目与发布事实不由此接口修改。
- 编辑保存修改原因及前后快照，版本/产品 revision、审计和幂等回执同事务；失败保留输入与原 payload 重试键，刷新后显式确认保存，提交期间禁用关闭和路由切换。详情目前只提供基本信息，正式发布快照视图仍待实现。
- 真实 MySQL race 验证详情、权限拒绝、审计故障全回滚、同键重放、双 revision 冲突、发布/归档只读、不同大小写产品详情/编辑隔离；实际 HandleRuntime 联合测试覆盖 view/edit 与成功 envelope。Go Aims/productcenter/server、5 项 BFF 输入/授权生成测试、ESLint 与 Aims typecheck 通过。
- Manifest 增加 product-versions:edit 精确服务动作；双 audience 生成 80 条业务 grant、86 项含传输检查，隔离 MySQL 授权脚本实测通过。目标租户未安装/签发探测。
- 本地 mock 浏览器完成详情预填、修改名称/原因、双层确认与 PATCH（真实输入校验及幂等键检查），成功提示与弹窗关闭可见。mock 未持久化，不证明实际更新后的详情回显、真实 Console/BFF 或 1440/390 视觉验收。临时 mock/服务和隔离 MySQL 已清理停止。
- 剩余版本范围、验收/发布/更正、旧项目入口切换与完整验收继续推进，本批不代表 PC-08 或整体完成。

### PC-08 规划事项排入版本的领域与 API（2026-09-08）

- 新增 CreateProductVersionScope 与分页 ListProductVersionScope，复用当前 selected 决定校验，要求产品版本 edit 与规划 prioritize。绑定五项 revision，当前事项关联长期功能由服务端读取，拒绝弃用功能、重复事项安排、同版本重复长期功能及发布/归档版本。范围初态 planned，默认不对外公开。
- 版本范围、版本 revision/scope_revision、事项 revision、产品 revision、完整输入/决定依据审计与幂等回执同事务。范围变化递增 scope_revision；没有伪造交付、验收或发布结果。新增范围含必填验收标准、变更类型与原因。
- GET/POST versions/{versionId}/features 已贯通 BFF/Runtime，严格路径绑定和字段白名单、签名 actor、短期双授权、no-store、成功 envelope。scope-list 属只读；scope-create 精确 capability 已进 Manifest 及双 audience 生成 grant，现为 82 条业务授权/88 项检查。
- 真实 MySQL race 在实际周期候选、评估、选择与转交之后运行版本范围命令，验证缺任一权限、未选入拒绝、审计故障回滚、重放、重复冲突、发布/归档只读、revision 推进、分页及字面搜索。实际项目 Schema 的 HandleRuntime 联合测试验证 scope-create/list 与响应协议。Go Aims/productcenter/server、Aims typecheck、ESLint、4 项输入/授权生成测试及隔离 MySQL 88 项授权检查通过。
- 范围 UI、范围修改/合并/顺延、长期功能重复与外产品专项并发验证、紧急例外、旧入口切换、验收发布及完整目标环境验证仍未完成；本批不代表 PC-08/整体验收完成。

### PC-08 版本范围清单与排入页面（2026-09-08）

- 版本详情增加范围入口；独立清单支持真实分页、防抖搜索、范围说明/验收标准/变更类型/交付状态、历史未关联评估提示，提供长期功能与规划事项链接。复用 PlanningItemDetail 新增只读事项详情路由，避免来源链接只跳回未定位的列表。
- 规划列表与事项详情增加排入版本入口；独立页面读取当前开放周期与事项，分页选择目标版本，填范围/验收标准/变更类型/原因，Foundation 确认后以五项 revision 和幂等键提交。版本选择可查看历史但不能选择发布/归档状态。提交期间阻止离页及表单变动；失败保留输入，刷新当前版本后可重试，成功跳转该版本范围列表。
- 版本权限读取补 scope_create = 产品版本 edit 与规划 prioritize 的交集；后端继续独立双权限检查，不信任前端布尔值。
- Aims typecheck、相关 ESLint 通过；本地 mock 浏览器完成 21 条版本的第二页选择、范围/验收/原因填写、确认、真实输入 parser/幂等键约束的 POST 与跳转范围列表；验收标准与来源链接可见。mock 列表是预设响应，不能证明真实数据库更新后的回显。
- 1440/390 视觉、真实 BFF/Console 全链路、范围修改/合并/顺延、验收发布和旧入口切换仍待完成，整体目标保持未完成。

### PC-08 范围编辑领域与 API（2026-09-08）

- 新增 EditProductVersionScope 与 PATCH 范围入口，绑定产品/版本/事项/范围四方身份、五项 revision、当前 selected 决定，双产品动作授权及精确 scope-edit 服务 capability。仅 planned 范围可修改基本范围内容与验收标准；功能绑定漂移、已交付/顺延、发布/归档拒绝，状态/项目/关联身份不能由 payload 改写。
- 范围内容、版本 revision/scope_revision、事项/产品 revision、前后内容及决定依据审计、回执原子提交。新 scope revision 不再匹配旧验收，发布命令需继续落实核验。
- 实际周期选择后的 MySQL race 测试覆盖权限拒绝、错误范围、交付/顺延拒绝、审计失败回滚、重放、内容及 revision 推进、旧 version revision 冲突。实际项目 Schema 的 HandleRuntime 联合测试补 scope-edit 成功协议。
- Orca Claude Haiku 定向核查旧项目特性入口；主代理复核 requireVersionOwnerManager 与 create/update/deleteVersionFeature，确认仍是牵头项目模型且缺产品中心 scope revision/决定门禁。Worker 建议中的“版本 selected 状态”和“manage capability”并非本方案模型，未采用；后续必须按事项 selected 与实际 manifest 动作完成切换，不能只加不存在的角色字段。
- 范围编辑 UI、旧入口切换、范围合并/顺延、验收发布以及完整浏览器/目标环境验收仍待实现；整体目标未完成。
- 本批 Go Aims/productcenter/server 回归、真实 MySQL race、Runtime 联合测试、Aims typecheck、ESLint 与 4 项输入/授权生成测试通过；生成 84 条业务 grant/90 项含传输检查，隔离 MySQL 授权核验通过。隔离数据库已停止，Claude worker 已释放，未安装目标租户授权。

### PC-08 版本范围编辑页面（2026-09-08）

- 范围清单增加编辑入口，依据当前产品范围权限与版本状态控制，仅 planned 且关联规划事项的新范围可编辑；历史未关联事项、已交付/顺延与发布/归档范围不显示编辑按钮。后端继续独立检查。
- 新增 VersionScopeEditor 五字段弹窗与共享范围类型。编辑冻结所见版本 revision，读取当前事项与开放周期，修改范围说明/验收标准/变更类型并记录原因；Foundation 确认后提交现有 PATCH。提交期间禁用关闭和路由变化；失败保留输入与相同 payload 重试键，冲突提示关闭后重新读取并对照草稿，避免自动覆盖新内容。
- 本地可变状态 mock 浏览器完成预填、修改验收标准/原因、双层确认、PATCH（复用真实输入校验/幂等键与版本冲突约束）、弹窗关闭、刷新后显示新验收标准。该 mock 验证了实际页面回显，未接真实 Console/BFF/数据库链路。无开放周期时显示具体原因。
- 首轮页面与组件 ESLint、Aims typecheck 通过；1440/390 视觉、真实端到端、范围顺延/合并、验收发布、旧项目入口切换仍待完成，整体目标未完成。

### PC-10 范围交付确认（2026-09-08）

- 新增 ConfirmProductVersionScopeDelivery、BFF/Runtime POST 范围 deliver 与确认弹窗。独立 accept 权限、精确 scope-deliver capability，核对产品/版本/范围 revision，要求当前 planned 范围有验收标准且提供证据/原因。确认后 delivered，与版本/范围/产品 revision、范围原文/验收标准/证据审计与回执同事务。
- 交付确认不依赖重新评分或开放周期，允许已有明确标准的 legacy 未评分范围记录本次验收；不伪造历史决定、版本整体验收、发布、项目完成或长期功能生效。旧无标准范围拒绝确认，兼容补齐入口仍待完成。
- 真实 MySQL race 覆盖 edit 不能替代 accept、缺标准拒绝、scope revision 冲突、审计故障回滚、证据留存、重复请求重放、当前授权撤销拒绝、再次确认拒绝，确认未生成整体验收或发布记录。实际 HandleRuntime 联合测试覆盖 scope-deliver 成功响应。
- Go Aims/productcenter/server、5 项 BFF 输入/授权生成测试、相关 ESLint 通过；授权清单现为 86 条业务 grant/92 项含传输检查，隔离 MySQL 实测通过。
- 本地可变 mock 浏览器完成验收标准展示、填写证据/原因、确认和刷新为已交付，重复确认按钮消失。使用真实输入 parser 与幂等键约束，尚未经过真实 Console/BFF/数据库或 1440/390 视觉验收。版本整体验收、发布/更正、顺延及旧入口切换仍待完成。

### PC-10 版本整体验收不可变记录（2026-09-08）

- 新增 AcceptProductVersion 领域命令：独立 accept 权限，产品/版本/scope revision 冲突检查；仅 active 产品、planning/developing 版本，全部范围为 delivered/deferred 才可记录验收。锁定并冻结范围标题/说明/标准、状态、功能/事项身份、变更类型、分类、公开标志、排序和延期来源；无效跨产品绑定拒绝。
- 三项显式人工核验（执行计划、阻塞缺陷、发布准备）均须证据；例外清单必须明确提交空数组或完整编号/责任人/影响/原因。checklist 标记 review_mode=manual，不能声称系统已自动查完执行项和全部缺陷。责任人字段是记录的责任引用，不用于授权。
- 验收表只追加，保存 scope revision 与受信验收 actor/数据库时间；版本 revision、产品 revision、审计与回执同事务，scope revision 不因记录验收而改变。后续范围修改使原验收不再对应当前 scope revision。
- 真实 MySQL race 验证缺权限、planned 范围阻止、审计失败回滚、同键重放、核验与范围快照保存、数据库禁止 UPDATE/DELETE、范围变化后旧验收失效，确认未自动生成发布记录。Go productcenter/Aims 回归通过。
- 当前仅为验收存储领域能力，未接 Runtime/BFF/UI；执行项和阻塞缺陷自动汇总/例外对应、验收预检与预览、独立发布主体、发布记录/更正、旧入口并发锁定仍待完成。不把本批人工核验记录视为完整发布门禁。

### PC-10 版本验收执行事实与例外（2026-09-08）

- 新增 loadVersionExecution：在产品/版本根锁下读取实际 work_items，以版本或版本特性绑定确定 target，递归读取同项目后代；到明确绑定另一版本的 target 停止。UNION DISTINCT 去重，版本和特性双关联、嵌套 target 不重复累计权重；版本/特性归属矛盾拒绝。
- 快照记录 target、已关联未关闭缺陷、权重完成分子/分母；总权重为 0 标 no_execution_plan，不伪造完成百分比。缺陷覆盖明确为 linked-descendants-only，其他缺陷仍依赖人工核验。当前保守规则要求所有已关联未关闭缺陷逐项处理或例外，不把严重程度阈值假装成既有平台规则。
- 每个未完成 target 对应 incomplete-target:{id}，每个未关闭缺陷对应 open-defect:{id}，验收必须提供相应有原因/责任人/影响的例外；指向已不再存在问题的自动例外编号拒绝。通用人工风险仍可独立记录。
- 验收记录冻结执行快照及其 hash，包含状态/权重、版本/特性/父子关联和正文摘要。状态、关联或正文变化会改变 hash，后续发布命令需重新读取核对；未因此宣称发布门禁已经接通。
- 新增只读 PreviewProductVersionAcceptance 领域读取，返回产品/版本 revision、范围分类计数及当前执行事实；预览不写产品或验收记录，正式验收仍重读事实。
- 隔离 MySQL 使用 aims_schema.sql 的真实 work_items CREATE TABLE；仅装载/造测试数据期间关闭该专属连接外键检查，命令执行前恢复。真实 race 验证 target 去重、嵌套权重、另一版本/项目缺陷排除、未关闭缺陷、归属矛盾、例外遗漏/过时拒绝、只读预览不改 revision、关联/状态 hash 变化。验收实际写入测试验证缺例外拒绝、明确例外后保存执行快照。Go productcenter/Aims 回归通过。
- 验收 Runtime/BFF/UI、发布时重新核验、全部旧执行项/版本入口锁定、目标环境与完整视觉验收仍待完成，整体目标未完成。

### PC-10 验收预览与提交 API（2026-09-08）

- 预览 GET 与验收 POST 已贯通 BFF/Runtime，独立 view/accept、严格输入白名单、路径绑定、受信 actor、短期票据、幂等及 no-store；accept 精确 service capability 纳入 Manifest/生成授权。
- 发现“仅重新读取事实”仍可能接受用户未审阅的新内容：legacy 工作项修改未必推进产品/版本 revision。新增 preview review_hash 与必填 expectedReviewHash，完整绑定版本、范围和执行事实；正式提交重算比对，不匹配返回 409，避免把新事实直接当作已核验事实。
- 真实 MySQL race 增加正文变更但 revision 未变时旧预览拒绝；原不可变验收/执行事实测试继续通过。实际项目 Schema 的 HandleRuntime 联合测试执行 scope 交付后预览/整体验收，验证 hash、范围计数与成功 envelope。该场景无绑定执行目标，人工核验明确说明，并未声称自动完成项目任务。
- Go Aims/productcenter/server、3 项 BFF 输入/授权生成测试、Aims typecheck、ESLint 通过；隔离 MySQL 授权核验 88 条业务 grant/94 项检查通过，目标租户未安装/签发探测。
- 验收 UI/历史读取、独立发布主体与发布重验、不可变发布记录/更正、旧写入口切换及完整目标环境/视觉验收仍待完成。

### PC-10 版本整体验收页面（2026-09-08）

- 新增版本详情的整体验收入口及 acceptance 页面；展示范围计数、执行完成度、未完成目标和关联开放缺陷，三项人工依据、自动例外及手工风险、Foundation 目录责任人选择。
- 绑定预览 review_hash 与工作空间／版本／范围修订号；刷新取消核验勾选，同请求保留幂等键，成功显示验收记录编号，不发布版本。执行快照增加工作项编号与标题。
- 隔离 MySQL 的执行快照／验收测试（race）和 Runtime 转交至版本验收联合测试通过；页面 eslint 和 Aims typecheck 通过。真实浏览器模拟接口完成核验、确认、保存回执及确认状态重置，并检查未完成目标自动例外与目录选择器。
- 尚未完成真实 BFF／Console 会话链路、390px／1440px 视觉验收、例外全流程及并发失败浏览器验收。验收历史、正式发布与旧入口权限切换等仍在总体待办范围，不代表产品中心全部完成。

### PC-10 验收历史 API（2026-09-08）

已增加验收记录真实分页列表与详情的 Runtime/BFF 路径，复用精确 read capability 与 Foundation 产品查看范围；记录依据／例外来自不可变保存内容，不返回完整项目执行快照。分页与详情页面仍待接入。

验证：`TestMySQLProductVersionAcceptanceImmutable`（race）覆盖真实保存后的分页／详情／错误动作及版本；`TestMySQLProductHandoffRuntimeCreatesActualProjectDraft` 覆盖 Runtime history list/view 回包与保存依据一致。精确 capability 拒绝和 read transport 分类测试通过；Aims eslint/typecheck 通过。没有真实租户授权或浏览器历史页验收结论。

### PC-10 验收历史页面（2026-09-08）

- 新增版本验收历史分页页及单条记录详情页，从版本详情／整体验收页进入；展示保存时间、验收人标识、三项依据、例外原因／影响／责任人标识。当前先保留明确的人员标识，目录姓名解析仍待补齐。
- 使用实际 API page/pageSize，显示总数和翻页；按范围修订比较提示变化，明确一致也不等同于发布就绪。
- eslint/typecheck 通过；真实 Chrome 配合隔离模拟接口验证翻页（第二页返回不同记录）、详情跳转、依据／例外与变化提示。模拟文件已恢复，服务已停止。真实授权链路、390px／1440px 视觉检查尚未完成。

### PC-10 正式发布领域命令（2026-09-08，尚未开放入口）

- `PublishProductVersion` 复用命令事务与 product_versions:publish 许可，验收人与发布人不同；校验产品／版本／范围修订、验收记录归属，以及验收保存后完整版本／范围／执行事实未变。当前仅首次发布，已有发布历史必须等待专用重开／更正命令。
- 发布快照冻结完整范围、执行、验收依据与例外，兼容长期功能发布证据的 features 投影；发布记录、版本 released 状态和当前记录引用、产品修订、审计／幂等回执原子提交。没有自动部署／Assets 回写。
- 内容哈希递归规范 JSON 对象键顺序并保留大整数精度，可从 MySQL 保存后的 JSON 复算。
- 真实隔离 MySQL race 测试覆盖错误动作、同人拒绝、范围变更但 revision 未变时拒绝、审计失败全回滚、成功发布、同键重放、记录不可改删与重复发布拒绝；保存后哈希复算一致。
- Runtime/BFF/授权清单／页面尚未接入此命令；旧项目／管理员写入入口、工作项分配并发仍需统一切换后才能证明 AC-12/13。版本负责人、重开更正、发布快照展示和真实环境验收仍待实现。

### PC-10 正式发布 API 与 service capability（2026-09-08）

已接入发布 BFF／Runtime、严格输入解析、版本 publish 权限布尔值、Manifest 精确 capability 及双 audience grant 生成物；修正 Service-Grants 文档中日期漂移造成的 seed/verify 链接。当前授权基线 90 条业务 grant／96 条条件。

验证：4 项 BFF 输入／grant 合同测试、Aims lint/typecheck、Runtime 精确 scope 拒绝测试通过；隔离 MySQL Runtime 联合链路已从验收记录以另一主体正式发布，状态查询 released；Console grant 隔离测试 96 项通过。未在真实目标租户安装授权或签发探测。发布页面、已发布快照展示、重开更正及旧写入口／工作项并发协议仍待完成。

### PC-10 发布快照读取 API（2026-09-08）

新增只读 release-view Runtime/BFF，校验产品／版本／记录归属和保存内容 hash；返回冻结范围、版本、验收依据／例外，区分当前引用、撤回、更正及存量证据。后续页面不得用当前可变信息拼出历史发布内容。

真实 MySQL race 测试验证当前范围修改后发布记录仍返回原始标题／hash；撤回事件使 current=false 且保留原内容。Runtime 联合发布后读取快照、精确 capability 与只读传输分类测试通过，Aims lint/typecheck 通过。发布页面／记录展示、正式撤回重开命令、旧写入口并发切换与真实环境验收仍待完成。

### PC-10 发布快照页面（2026-09-08）

新增 releases/{recordId} 冻结内容页与版本详情入口。展示发布元数据、撤回／更正／当前引用、证据等级、发布时范围／验收标准／依据／例外；存量证据不以当前内容补写。版本详情明确当前信息与正式发布快照的区别。

Aims eslint/typecheck 通过；真实 Chrome 模拟接口核对撤回状态、冻结范围及例外。Orca 内嵌浏览器固定 iframe 页面实测 390px→scrollWidth 375、1440px→1425，无横向溢出；截图在切换标签并激活 Orca 后仍 CDP 超时，因此未完成截图视觉核验和控制台全量检查。模拟路由已恢复并停止本地服务。真实授权及姓名解析、发布操作页面、重开更正与旧写路径切换仍待完成。

### PC-10 正式发布交互（2026-09-08）

验收记录详情已接入 VersionPublisher：加载当前检查与 publish 权限、同一验收人提示、冻结提交修订号、原因／核验勾选／Foundation 二次确认；错误保留原因和同 payload 幂等键，重新核验撤销勾选，成功显示发布记录与快照入口。父页刷新与路由切换在提交时受保护。

Aims eslint/typecheck 通过；真实 Chrome 配合隔离模拟 API 检查正确验收 ID 与三项修订号／幂等键、确认流程、成功快照链接、409 草稿保留、刷新后勾选取消以及同人发布入口移除。模拟文件已恢复，开发服务已停止。真实 BFF/Console 发布链路、390px/1440px 弹窗视觉核验与旧写入口切换仍待完成。

### PC-10 撤回重开与更正发布领域命令（2026-09-08）

新增 ReopenProductVersion：独立 reopen 权限、原记录引用和原因，锁定当前发布版本，追加 withdrawn 事件、清除当前引用和实际发布时间、恢复 developing、递增版本与范围修订；旧验收不再满足发布门禁。当前范围交付事实保留，不修改原发布快照。

发布命令现在支持重开后重新验收的更正：选择最新已撤回且未被更正记录，追加下一 release_seq 和 supersedes_record_id，并同事务追加 superseded 事件。首次发布行为保持不变。

隔离 MySQL race 测试通过完整发布／重开／重新验收／更正链路、edit 不能重开、重开同键重放、旧验收拒绝、重开和更正审计失败全回滚、原发布范围／hash 不变及序号关联；领域包普通测试通过。重开 Runtime/BFF/capability/UI、发布历史分页以及旧入口统一切换仍待接通。

### PC-10 重开 API（2026-09-08）

重开 Runtime/BFF、严格输入解析、Manifest capability 和双 audience grant 生成物已接入；尚未增加 UI。输入测试、精确 scope 拒绝测试和 grant 生成契约通过。目标租户授权、重开接口的真实会话联调、页面及旧入口切换仍待完成。

补充验证：Aims eslint/typecheck 通过；隔离 Console MySQL 授权检查 98 项通过，未向真实租户安装授权。

### PC-10 重开 Runtime 联合验证（2026-09-08）

现有真实隔离 MySQL 的转交／范围／验收／发布测试已继续覆盖 Runtime reopen：错误 release reference 拒绝、成功 developing 状态、当前授权下的同键原回执重放、原记录 withdrawn=true/current=false 且 content_hash 不变。测试通过；仍是 Runtime 受信测试上下文，不等于 Console JWT／BFF／浏览器真实会话验收。版本权限 GET 增加独立 reopen 布尔值，eslint 通过。重开 UI 和旧写入口切换继续待办。

### PC-10 撤回重开页面（2026-09-08）

版本详情新增独立 reopen 入口、原因 Modal 和 Foundation 二次确认，冻结原发布 ID／产品与版本修订，失败保留原因／同 payload 幂等键；成功刷新 developing 并保留原快照链接，提示重新验收及不回滚部署。提交期间复用现有忙状态与路由保护。

Aims eslint/typecheck 通过；真实 Chrome 模拟 API 校验 releaseRecordId=31、expectedRevision=8、expectedVersionRevision=4、幂等键，提交后动态 GET 返回 developing/current_release_record_id=null，页面状态、入口消失与旧快照链接验证通过。模拟文件已恢复，服务已停止。真实会话与390px/1440px弹窗视觉、发布历史列表、旧写入口切换仍待完成。

### PC-10 发布历史列表（2026-09-08）

Runtime/BFF 真实分页与发布历史页面已接入，版本详情／快照页提供持久入口，更正记录提供原记录链接。记录按发布序号倒序显示当前、撤回、更正、证据等级与发布人标识。

隔离 MySQL race 测试覆盖完整更正后新旧记录分页、总数、空页、来源引用及错误动作拒绝；精确 scope／只读传输分类测试通过。Aims eslint/typecheck 通过，真实 Chrome 模拟接口验证翻页后记录与状态变化和正确快照链接。模拟恢复且本地服务停止。真实会话、人员姓名、390px／1440px视觉和旧写路径切换仍待完成。

### PC-10 旧状态写入旁路关闭（2026-09-08）

已删除管理员／项目旧 transition 的裸状态更新，保留明确 410 退役响应；两处 UI 改为产品中心版本链接。管理员旧创建限制 planning，不允许直接制造 released 状态。其他旧编辑／特性／分配写入仍待迁移；普通进入开发、归档等中心命令待补齐，当前不是全部入口切换完成。

Go Aims 包测试通过，新增测试覆盖两条旧 transition 所有状态在 DB 前退役，以及旧管理员创建非规划状态拒绝。Aims eslint/typecheck 通过。旧页面实际导航、390px／1440px及真实会话尚未验证，未宣称生产可用。

### 2026-09-08：产品中心普通版本状态命令

- 新增 `POST /api/v1/products/{productCode}/versions/{versionId}/transition`，仅允许规划中进入开发中；复用产品范围 `product_versions:edit` 与精确服务 capability `aims:product-versions:edit`。发布、撤回重开仍使用各自专用命令。
- 必须提交产品与版本修订、目标状态和原因，版本 ID 取路径；状态、版本修订、产品修订、活动审计与幂等回执在同一事务提交，范围修订保持不变。
- 本轮真实隔离 MySQL `TestMySQLProductVersionTransition` 已通过：错误权限、过期版本修订、审计故障回滚、成功转换、同键重放、重复进入开发拒绝。Runtime 错 capability 前置拒绝及 BFF 输入边界测试通过。
- 此记录仅证明后端命令与上述测试；版本详情的进入开发按钮及浏览器端验收尚待接入。旧普通编辑／范围写入的迁移、项目详情授权和完整产品中心验收仍未完成。

### 2026-09-08：版本详情进入开发操作

- 版本详情新增规划中且具备产品编辑权限时的「进入开发」入口；原因必填，弹窗冻结产品／版本修订，Foundation 二次确认后携带稳定幂等键提交。提交期间阻止路由离开，失败保留原因；成功重新读取版本和权限。
- ESLint 与 Aims Nuxt 类型检查通过。本地浏览器＋模拟接口验证：空原因禁用、二次确认显示版本及原因、请求修订与幂等头校验、成功通知、刷新显示开发中并移除进入开发按钮。模拟 GET 手动切换为提交后的事实，不代表真实数据库端到端状态联动。
- 390px／1440px 截图和真实 Console 身份链路仍待验收；本轮未证明完整视觉或生产可用性。

### 2026-09-08：旧版基本信息编辑的一致性过渡

- 管理员与项目版本基本编辑共用 `updateLegacyVersionFields`：按产品工作空间、版本顺序加锁；仅 planning/developing 且无当前发布记录可编辑，已归档产品拒绝。修改递增版本与已有工作空间修订，旧日志写入失败回滚整次修改。
- Aims Go 包测试通过；隔离 MySQL `TestMySQLLegacyVersionEditConsistency` 通过，覆盖修订递增、日志故障回滚及 released 拒绝。尚未用并发事务测试证明所有锁竞争行为。
- 这是旧路径切换期间的一致性保护，未宣称完成产品范围授权、预期修订／幂等命令迁移。旧范围 CRUD、认领、项目绑定与工作项变更仍需继续迁移；新旧接口最终复用产品领域命令的要求不变。

### 2026-09-08：旧编辑与发布锁竞争验证

- 扩展 `TestMySQLLegacyVersionEditConsistency`，在隔离 MySQL 中用一个事务持有产品工作空间锁并修改版本为 released，另一个连接运行实际旧编辑 helper。通过 `performance_schema.data_lock_waits` 观察该数据库工作空间行的真实等待，而非仅依赖延时推断。
- 持锁事务提交后，编辑重新读取已提交的版本状态并拒绝写入；名称保持原值、状态为 released、修订只包含持锁事务的递增。测试已执行通过。
- 此测试证明旧基本编辑 helper 的该锁竞争场景；持锁事务模拟发布的状态写入，未调用完整发布领域命令，不替代发布／验收集成测试，也不覆盖仍未迁移的范围及工作项写入。

### 2026-09-08：范围延期领域实现起步

- 范围创建领域输入增加可选 `deferred_from`（原版本、原范围、版本／范围修订）。后续范围仍必须来自新的有效已选入规划事项；原规划事项绑定保留，符合现有唯一约束。
- 同产品事务内检查原版本可编辑、原范围 planned、无已有后续范围；保留原行并标 deferred，递增原版本及范围修订。新行写入 deferred_from_feature_id，两端活动日志与创建回执同事务。失败回滚，不搬走旧范围。
- 产品中心 Go 包检查通过；隔离 MySQL 延期来源 helper 的回滚和状态／修订测试，以及 TestMySQLProductVersion 系列已通过。完整创建后续范围＋延期的联合事务故障／重放测试仍待补齐。
- BFF 严格输入和页面暂未暴露此能力，不能宣称延期功能已可用；下一步补完整命令测试及接口／页面。

### 2026-09-08：延期创建事务与 BFF 输入

- 创建版本范围接口支持可选 `deferredFrom: { versionId, scopeId, expectedVersionRevision, expectedScopeRevision }`，仅 create 接受；edit 在 BFF 和领域层拒绝延期来源，防止静默忽略或改写关系。仍复用 scope-create capability、产品 edit 与规划 prioritize 双权限。
- 真实 MySQL `TestMySQLPlanningSelectionAtomicity` 中的范围创建链路现覆盖延期来源：原版本审计触发器故障发生于后续插入之后，验证新条目回滚且原范围仍 planned、原修订不变；成功及幂等重放后原范围 deferred、修订仅增加一次、后续关联精确。
- BFF 输入测试覆盖仅创建接受、同版本拒绝、缺修订、非法 ID、注入字段。页面选择来源、范围列表的延期关系展示和真实身份联调仍待实现。

### 2026-09-08：延期来源读取与展示

- 范围列表增加可空 deferred_from_scope_id、deferred_from_version_id、deferred_from_version_code。关联原版本时重新限定同产品；不改变列表分页和计数。历史跨产品外键关系返回空来源字段。
- 版本范围页显示顺延来源版本号、范围 ID，并链接原版本范围列表（不是定位到具体分页条目的深链接）。
- 真实 MySQL 规划选择／范围链路测试验证来源字段和跨产品屏蔽通过，相关 ESLint 通过。页面浏览器和响应式视觉检查尚未执行；延期来源选择表单及正向后续关系展示仍待完成。

### 2026-09-08：规划排入版本的延期来源表单

- 排入版本页面增加可选「承接其他版本的延期范围」，复用版本选择器并增加分页／防抖搜索的原范围选择器。只允许选择 planned 范围，源与目标版本必须不同；源版本／范围修订冻结在所选来源中，提交 deferredFrom 精确字段。
- 确认窗口展示来源版本和范围，说明原范围保留、顺延及原版本验收失效。切换产品／事项／目标版本时清除来源，错误后保留输入；后端继续校验真实规划决定和来源修订。
- 页面及组件 ESLint 通过，Aims Nuxt 类型检查通过（随后只调整版本搜索标签属性）。本轮未完成浏览器交互、390px／1440px 视觉验收和真实身份链路，不宣称完整延期流程验收完成。

### 2026-09-08：延期来源刷新与浏览器检查

- 切换来源版本清空旧请求结果；选择时再次校验条目属于当前版本及当前列表。新响应修订变化时清除已选来源，排入页面主动重新读取也清除来源，要求重新确认。
- ESLint 通过。真实浏览器＋临时模拟接口验证来源选择、真实请求分页、翻页保留冻结来源，以及新响应修订变化后清空旧选择。临时页面／接口已清理。
- 此次为独立来源组件行为检查；完整表单提交、390px／1440px 视觉、真实 Console 链路仍待验证。

### 2026-09-08：延期后续关系读取

- 范围列表返回 successors 数组（scope_id、version_id、version_code），仅对本页范围批量查询同产品承接版本，避免联表扩行影响分页。最多读取 1001 条用于检测上限，超出 1000 明确报错而非静默截断。
- 原范围页面新增「后续承接范围」链接，与此前来源链接组成双向追溯；链接进入对应版本的范围列表，尚无精确分页定位。
- 隔离 MySQL TestMySQLPlanningSelectionAtomicity 验证正常后续关系、跨产品关联屏蔽且总数不变，通过。相关 ESLint 通过。浏览器视觉验证仍待完成。

### 2026-09-08：延期增量后的完整仓库回归

- 在专用 `/tmp/hzy-product-center.*` MySQL socket 下执行 `go test ./internal/apps/aims/productcenter ./internal/apps/aims -count=1`，两个包均通过（约 18.8 秒、0.9 秒）。未连接业务数据库。该结果覆盖使用此 socket 开启的测试，不代表其他依赖外部环境的测试均执行。
- Aims 执行 `pnpm exec tsx --test test/product*.test.ts`：93 个测试，93 通过，0 失败、0 跳过。包含 BFF 输入、范围授权映射、角色／manifest／grant 契约、版本验收发布及延期输入。
- 当前仓库回归未发现此次延期增量引入的失败；真实 Console JWT／grant 探测、完整浏览器提交、视觉、旧路径授权迁移及方案其他未完成项仍不因这些测试通过而视为完成。

### 2026-09-08：版本业务负责人字段与验收归属

- 版本创建／编辑支持可选 businessOwnerUid，明确提供时须为当前有效产品成员；省略时编辑保留原负责人，不允许空值清除。领域写入与已有版本修改、根修订和审计保持同事务。版本读取及验收快照带负责人；空负责人 JSON 省略，保持旧快照序列化兼容。
- 已指定负责人时，整体验收必须由该 UID 提交，仍必须通过 product_versions:accept，负责人归属不授予权限。独立发布权限与不可自发布规则保持。
- BFF 四项版本输入测试、ESLint 通过。Go 两包完整回归最初只有负责人测试缺少有效成员失败；补齐该夹具后针对验收／发布／更正／历史链路重跑通过，其他测试在前一次完整运行通过。
- 未指定负责人仍保留过渡兼容（包括当前页面未传该字段的新建请求），因此尚未满足全部版本必须由明确负责人验收的最终要求。负责人选择 UI、历史补齐及强制切换尚待实施；未宣称完整职责分离已验收。

### 2026-09-08：版本负责人页面接入

- 创建和编辑版本表单复用 Foundation UserTreeSelector 单选并要求填写业务负责人；编辑回填已有 UID，详情显示 UID 或未指定。界面提示必须为有效产品成员、仍需验收权限；目录候选尚未按产品成员预过滤，服务端拒绝无效成员。
- 验收页结合受信权限响应 actor_uid 与版本负责人禁用非负责人提交，显示负责人提示；服务端仍独立判断。未指定负责人继续沿当前兼容策略。
- 相关页面 ESLint 通过，创建／编辑页面初次类型检查通过，验收页更新后重新类型检查。浏览器成员选择、错误反馈和 390px／1440px 视觉仍待验收；后端缺负责人新建及历史负责人强制切换仍待实施。

### 2026-09-08：负责人验收与发布强制门槛

- 整体验收不再允许缺业务负责人的版本；仅当前负责人且通过 accept 授权者可提交。发布额外校验验收人为当前负责人，拒绝缺负责人或负责人不匹配的旧验收；不可自发布规则继续执行。
- 验收页面同步禁用缺负责人提交并提示到版本详情补齐。历史记录不回填、不改写；现有规划版本可经编辑指定有效成员，随后重新验收。
- 真实 MySQL 验收／发布／更正、执行快照、Runtime 项目转交联合链路通过；新增缺负责人验收、缺负责人／负责人变化后发布拒绝测试通过。页面 ESLint 通过。
- 后端创建仍可保存未指定负责人的规划草稿，但已无法推进验收发布；页面创建目前要求填写。负责人目录筛选与浏览器验收、旧接口迁移及方案其他未完成项继续保留。

### 2026-09-08：发布页面负责人门槛

- 发布组件要求当前负责人等于验收记录提交人；不匹配或未指定时隐藏发布按钮，说明需要指定负责人及重新验收。重新检查入口不再只在请求错误时显示。服务端仍独立校验。
- ESLint 通过；真实浏览器配合临时模拟接口验证负责人不匹配时提示且无发布按钮，匹配后重新检查恢复入口。未提交发布命令。临时页面与接口已清理。
- 不以该组件检查替代完整表单／权限联调及响应式视觉验收。

### 2026-09-08：负责人指定和交接事务回归

- 新增隔离 MySQL `TestMySQLVersionOwnerAssignment` 并通过：实际创建命令拒绝不存在、过期、未来生效及 inactive 成员，失败不留下版本；有效成员创建成功且响应带负责人。
- 实际编辑命令遇审计插入故障时负责人及修订回滚；成功交接后同键重放返回原回执，修订仅递增一次。
- 本轮验证负责人指定／交接事务，不代替 Console Directory 活跃主体联调、人员选择浏览器流程或产品中心完整验收。

### 2026-09-08：负责人错误响应契约

- 负责人缺失／不匹配返回 409 product_version_owner_required；成员不存在或当前无效返回 409 product_version_owner_unavailable；UID 格式非法保留 400 product_version_owner_invalid，缺授权保留 403。避免把可重新选择的状态冲突与格式错误混淆。
- 新增 HTTP 映射契约测试，校验状态、业务错误码和可操作消息均保留；Aims 与 productcenter Go 包测试通过，本轮未启用 MySQL socket（已有成员有效期数据库测试仅同步错误码）。

### 2026-09-08：版本归档领域命令

- 新增 ArchiveProductVersion，仅 released→archived，产品须 active；要求 product_versions:archive 独立授权、产品／版本／范围修订及原因。状态、版本和产品修订、审计、回执同事务；范围修订、发布引用及不可变记录保持。
- 在真实 MySQL 的验收→发布→重开→更正发布链路末尾执行归档，验证 edit 不可代替 archive、范围修订冲突、审计故障回滚、成功和幂等重放、归档后发布快照 hash 与事件状态不变，测试通过。
- Runtime／BFF 路由、精确 service capability／grant 与页面尚待接入；当前只是领域能力，不宣称归档入口可用。

### 2026-09-08：归档接口与精确服务授权

- 归档 Runtime、BFF 严格输入和 POST 路由接通，使用独立 archive 用户权限及 service capability。manifest 与双 audience seed／verify 同步到 94 条业务 grant、100 项组合要求。
- 输入／grant 产物测试、Runtime 缺 capability 前置拒绝测试、ESLint 和 Nuxt 类型检查通过。隔离 MySQL grant 集成测试通过 100 项要求，涵盖重复安装、缺客户端、传输前提、inactive 和过期凭证。
- 归档页面及真实路由联合调用仍待接入／验证；未在业务租户安装授权或执行实际 JWT 签发探测。

### 2026-09-08：版本归档详情页入口

- 版本权限接口返回独立 archive 判定，详情页仅对已发布且有归档权限者显示归档操作。原因必填，冻结产品／版本／范围修订，Foundation warning 二次确认，稳定幂等键提交；错误保留原因，成功重新读取。
- 归档不移除发布历史入口；当前领域不支持归档版本直接重开。相关 ESLint 通过，Nuxt 类型检查已执行。
- 浏览器提交与 390px／1440px 视觉检查尚待完成，真实 Console 授权链路和其他方案未完成项仍保留。

### 2026-09-08：归档页面浏览器交互检查

- 真实浏览器＋临时模拟接口验证归档权限入口、空原因禁用、版本名／原因／影响二次确认、三个修订号与幂等头提交、成功后刷新显示 archived 且操作入口消失，原发布快照／历史链接保留。
- 模拟 GET 由测试手动切换为归档结果，未证明真实 HTTP→数据库的全链路联动；此前实际领域归档数据库测试另有记录。临时接口和服务器已清理。390px／1440px 截图、真实 Console 身份联调仍待完成。

### 2026-09-08：验收预览项目明细过滤

- BFF acceptance-preview 复用 resolveAimsProjectAuthorizationObject 与 Foundation checkAimsScopedPermission，按项目同时检查 projects:view 和 work_items:view，仅返回允许项目的 targets/open_defects。产品汇总与原 review_hash 保持，另返回 restricted_item_count；不会以占位行保留被拒绝项目的目标 ID／标题。
- 验收／发布页面对存在受限明细的预览提示缺查看权限并禁用提交。该页面门禁不替代现有服务端版本 accept/publish 授权；写命令是否需要绑定全部项目查看授权、历史例外中的项目引用可见性仍需继续核对。
- 过滤单元测试、ESLint、Nuxt 类型检查通过。测试验证同项目只判断一次、拒绝项目行完全移除、汇总／哈希不变、授权服务错误传播。真实 Console 项目权限联调和 AC-11 全面验收尚未完成。

### 2026-09-08：验收发布服务端项目查看预检

- BFF 写路径已执行全部关联执行项目查看预检，缺权不派发验收／发布；Runtime 要求受信 execution_review_hash，新事务核对检查时与写入时快照一致。哈希不改变业务幂等 payload，成功回执重放仍可使用新的预检结果。
- 预检拒绝／异常传播、service grant 契约、ESLint、Nuxt 类型检查通过；隔离 MySQL 验收发布链路验证错误预检 hash 拒绝及不同预检 hash 的成功回执重放，Runtime 转交→验收→发布联合链路及缺 capability 拒绝通过。
- 项目授权仍复用现有 Aims 项目对象解析链路；真实 Console 多角色／多项目联调、历史例外引用展示以及 AC-11 全体验收尚待完成，不以此测试代替环境验收。

### 2026-09-08：执行核验信任边界回归

- Runtime 新增无数据库适配器契约测试，accept／publish 在正确 capability 下仍拒绝缺失、空、错长度、非规范大小写、非 hex、数字和数组类型 execution_review_hash，返回 400 product_execution_review_required。缺 capability 仍先拒绝。
- 浏览器验收／发布输入测试新增 execution_review_hash 与 executionReviewHash 注入用例，均拒绝，避免覆盖 BFF 自行产生的预检结果。相关 Go 与 Node 测试通过。
- 这些测试只证明输入与路由门禁；有效格式的 hash 是否匹配由写事务测试覆盖，真实 Console 令牌和项目权限端到端测试仍待完成。

### 2026-09-08：受限明细下的执行统计文案

- BFF 过滤前记录 target_count、open_defect_count 产品级总量；过滤后仍只返回授权明细。验收页分别显示总量与可见明细数量，全部缺陷不可见时也保留总缺陷提示，避免把过滤后的空数组解释为零缺陷。
- 过滤测试增加总量断言并通过，相关 ESLint 通过；真实受限角色浏览器验证仍待完成。

### 2026-09-08：验收/发布项目授权事实严格读取

- 产品版本验收预览和 accept/publish 预检启用 `requireCompleteFacts`，仅接受项目 authorization-object 专用接口返回的完整事实；不再退回项目详情或空对象。校验项目 ID、规范 project_code、创建人字段、可空部门/负责人字段和完整成员数组。有效空成员数组仍可参与 Foundation 授权判断。
- runtime 未接管或响应缺失时返回 503；上游错误保留既有错误映射，网络/授权异常继续传播，不伪装成用户缺权。其他共享解析器调用保持原行为，尚未全量迁移。
- 验证：新增 3 项测试覆盖事实形状、项目错配、空成员、上游 403/503 及专用接口唯一调用；执行明细过滤/写预检、service grant 契约测试通过；Nuxt typecheck 通过。未验证实际 Console JWT 链路，AC11 仍不能标记完整验收。
- Claude Haiku 已通过 Orca 完成只读审查及 worker_done 回报；其“总数与可见明细不一致”意见属于已有设计（保留总数并标明可见数），未采纳为缺陷。故障状态码与权限有效期的泛化结论证据不足；本次依据实际代码修复的是授权事实兼容回退问题。

### 2026-09-08：验收/发布重新核验版本负责人产品成员有效性

- accept/publish 新命令在事务内调用 `validateVersionOwnerTx`，避免只在创建/改派时检查成员资格。当前负责人停用、关系过期或尚未生效时返回既有 409 `product_version_owner_unavailable`；验收人与负责人一致、发布人与验收人不同等约束保留。
- 在真实验收与发布链路分别增加三种失效成员场景；恢复有效成员后同一命令仍能正常完成，原验收/发布/更正/归档和审计回滚用例继续通过。执行快照及 Runtime 项目交接测试夹具补上有效负责人关系，并在关系变化后重新获取授权事实；旧快照被拒绝的测试失败说明刷新不可省略。
- 隔离 MySQL socket 下 `go test ./internal/apps/aims/productcenter ./internal/apps/aims -count=1` 首轮暴露夹具日期和成员缺失；修正后 productcenter 包通过，最后一次修正授权夹具后 aims 包单独重跑通过。未接触业务数据库。
- 本次校验的是 Aims 产品成员关系，尚不能证明 Console Directory 人员 active；候选人过滤、实际 JWT 全链路及方案其他待办仍未完整验收。

### 2026-09-08：PC-06A 评论讨论领域命令

- 新增 `ChangePlanningComment` 支持 create/edit/delete，复用 `product_priorities:comment` 产品范围许可与 ExecuteCommand。正文最多 10000 字，编辑/删除要求本人及评论 revision；删除使用 deleted_at，原文保留。评论修改只推进产品根 revision，不推进事项/范围/证据 revision，也不改评估、顺序和决定。
- 每次修改把旧正文和评论版本保存在 product_activity_logs，同事务写入正文、日志、根版本及 receipt。已归档产品、已合并/取消事项拒绝写入；已关联闭期周期的事项讨论冻结。闭期与跨周期重用的前端说明仍需接线时核对。
- 真实隔离 MySQL 的 `TestMySQLPlanningCommentOwnershipHistoryAndAtomicity` 通过：新增与幂等重放、非本人拒绝、审计故障整体回滚、编辑冲突、软删除、三条历史及事项 revision 保持不变。闭期/跨产品等分支尚需专项用例。
- 当前仅领域命令，尚未增加 runtime 路由、BFF、精确 service scope、评论分页/历史读取及前端讨论区。PC-06A / AC-27 仍未完成，不将表或命令存在视为评论功能可用。

### 2026-09-08：评论分页领域读取

- 新增 `ListPlanningComments`：先核验产品 product_priorities:view，再按同产品事项定位评论，分页上限复用规划查询规则。产品根锁保护 count 与分页读取的一致性，按 ID 倒序，返回作者、评论版本、时间和工作空间版本。
- 已删除评论保留占位，正文在 SQL 投影中变为空串；普通讨论列表不返回历史正文。编辑历史仍在 activity log，尚未接独立读取接口。
- 扩展 `TestMySQLPlanningCommentOwnershipHistoryAndAtomicity`，真实隔离 MySQL 通过：删除正文不泄漏、第二页为空且总数稳定、comment 许可不能代替 view、另一产品许可不能读取原事项讨论。
- 仍待 runtime/BFF/精确服务授权及前端接线，未宣称 AC-27 完成。

### 2026-09-08：评论 Runtime 与精确服务授权

- 评论 list/create/edit/delete 已接入 Runtime dispatch；列表要求 read、三种写入要求 comment 精确 capability，受信 actor 与产品范围授权保持独立。补充 403/404/409 错误映射，list 加入只读 POST 白名单。
- Manifest、grant 生成器及 Seed/Verify 同步到 96/102 条；真实隔离 MySQL grant 测试通过，涵盖幂等 seed、缺客户端、无关客户端、传输前提、停用授权、过期凭证。
- `TestPlanningRuntimeRequiresExactCapabilitiesBeforeDatabase` 扩充四个评论动作并通过；`TestProductRequestReadTransportScope` 通过；生成器与 Manifest Node 契约测试通过。领域读写 MySQL 用例已在前一轮通过，本轮尚未进行评论 Runtime 成功调用全链路测试。
- BFF、前端讨论区、历史读取、闭期分支验证及目标环境 JWT 仍待接通/验收。

### 2026-09-08：评论 BFF 路由与输入校验

- 新增 comments GET/POST 和 commentId PATCH/DELETE 四个浏览器路由，复用 handleProductPlanningComments；使用受信产品 actor、view/comment 许可、15 秒 authorization envelope 与精确 Runtime service scope，写入要求幂等键。
- 请求体白名单拒绝作者/授权/对象 ID 注入；分页、正文 Unicode/长度、评论数字 ID、根与评论 revision 独立校验。删除不接受正文。
- 输入与 service grant 契约共 3 项 Node 测试通过，Nuxt typecheck 通过；相关 ESLint 通过（测试 import 空行问题已修复）。
- 讨论页面、历史读取、闭期与成功 Runtime/BFF 全链路验证仍待完成，未将 API 文件存在视为 AC-27 完成。

### 2026-09-08：评论 BFF 编排契约验证

- 新增执行真实 handleProductPlanningComments 源码的受控依赖测试，验证中文产品编码 URL 编码、view/comment 动作、精确读写 scope、服务端 actor、事项路由绑定、幂等键以及 no-store。
- 缺幂等键、写入 query、作者注入在授权和 Runtime 前拒绝；权限拒绝不调用 Runtime；未接管保留 503，上游错误沿用映射。2 项测试通过，ESLint 通过。
- 这是 BFF 编排测试，依赖使用替身，不等同于实际 JWT 或浏览器验收；编辑/删除完整 HTTP 及页面仍待验证。

### 2026-09-08：规划事项详情讨论区初步接入

- 新增 PlanningComments 并接入规划事项详情，支持分页、删除占位、发表评论、本人编辑及 Foundation 删除确认。权限端点返回受信 actor_uid/comment；按钮只向本人展示，服务端关系校验仍为边界。
- 请求携带根版本和评论版本；同 payload 失败重试保留幂等键、草稿；提交期间禁用操作和路由离开。删除其他评论不会清空正在编写的草稿。列表纯文本呈现正文，不渲染 HTML。
- Nuxt typecheck 和相关 ESLint 通过。尚未完成真实浏览器交互、390/1440 视觉及实际 JWT 验证，闭期禁用提示与历史入口仍待完善，讨论 UI 不标完整验收。

### 2026-09-08：讨论区本地浏览器交互验证

- Chrome 本地临时测试页实际运行仓库 PlanningComments，使用独立 QA-COMMENT 模拟 API，验证空正文禁用、新增成功后列表出现、本人编辑后正文和版本更新、Foundation 删除确认及删除后占位；他人评论未展示编辑/删除按钮。模拟 API 校验根版本、评论版本、本人身份及幂等键存在。
- 补充权限请求失败的可见错误提示，避免失败时只有操作入口消失。临时页面/API 已清理。
- 本次是实际浏览器 + 模拟 API 的行为验证，不是 Console JWT/BFF/Runtime/MySQL 全链路；未完成 390/1440 截图视觉验收，失败重试与分页交互仍需补测。

### 2026-09-08：讨论只读状态接线

- 提取 planningCommentReadonly，读写共享已合并/取消事项及已关联闭期周期规则；评论列表新增 readonly/readonly_reason。前端只有 readonly 明确为 false 且产品权限允许时才显示写入口，只读原因以提示显示。
- 实际隔离 MySQL 评论链路新增取消事项读取只读状态及新评论拒绝测试并通过；闭期分支仍待专项测试。相关 ESLint 通过；前端本轮状态提示未做浏览器复测，不能标记视觉完成。

### 2026-09-08：闭期讨论写入拒绝测试

- 在评论真实 MySQL 用例中加入 closed 周期、事项关联及未删除评论夹具，逐一验证 create/edit/delete 返回 planning_cycle_closed。
- 读取继续返回原正文和只读原因；评论 revision、产品根 revision 不变。扩展后的 TestMySQLPlanningCommentOwnershipHistoryAndAtomicity 通过。
- 本测试直接构造闭期存量事实，不证明 close 命令至浏览器完整链路；跨周期复用语义、历史入口及目标环境验证仍待完成。

### 2026-09-08：评论历史领域读取与跨周期缺口

- 新增 ReadPlanningCommentHistory，产品 view 授权后校验事项与评论归属，再按评论 ID 读取分页审计历史。保留删除前及编辑前正文，可在未来独立历史入口显示；不改变普通列表删除正文隐藏规则。
- 真实 MySQL 评论测试通过：历史总数 3、分页返回删除/编辑、编辑前原文保留、未知评论拒绝。当前仅领域读取，Runtime/BFF/UI 历史入口尚未接线。
- 明确发现跨周期缺口：方案允许未完成事项在新周期保留同一 ID；现有任一 closed 周期即冻结事项讨论的规则会永久限制后续讨论。需增加评论周期归属（及存量归属处理），旧周期评论保持冻结，新周期可追加讨论；不能仅取消全局闭期判断使旧评论可改。此项尚未修复，AC-27 不完成。

### 2026-09-08：评论周期归属增量迁移

- 新增 migration_v5.20_product_comment_cycles.sql，增加可空 cycle_id，复合外键绑定 cycle_id/planning_item_id 到实际周期候选关系，规范 schema 同步。历史评论保留 NULL，不根据当前周期猜测历史。
- 隔离 MySQL 测试连续执行迁移两次通过，确认两条既有评论仍未分配、无效周期关系拒绝、合法关系接受。未执行业务数据库迁移。
- 当前评论领域命令仍未使用周期字段，下一步须完成新评论周期绑定、旧周期评论冻结、新周期新增及读模型/UI 状态区分；本次仅迁移基础，不宣称跨周期问题已修复。

### 2026-09-08：评论跨周期归属接入

- 新评论在事务内绑定事项当前 open 周期（不存在时保留 NULL）；编辑/删除依据评论自身 cycle_id 冻结，不再用新周期解冻旧评论。未分配历史评论仍执行保守闭期冻结。
- 列表区分新增只读状态与每条评论 readonly/readonly_reason/cycle_id，页面只为未冻结的本人评论显示修改入口。依赖 v5.20 迁移；测试库初始化已追加该增量，目标环境尚未执行。
- 真实 MySQL 测试通过新周期创建、cycle_id 精确绑定、旧周期编辑拒绝、列表新旧只读状态分离；ESLint 通过。本轮未验证浏览器新旧周期显示。

### 2026-09-08：评论周期归属后的回归验证

- `pnpm exec tsx --test test/product*.test.ts`：100 通过、0 失败、0 跳过；覆盖仓库现有产品输入、BFF 编排、授权映射及 grant 产物等用例。
- 隔离 MySQL socket 下 `go test ./internal/apps/aims/productcenter ./internal/apps/aims -count=1` 两包均通过（productcenter 22.116s，aims 0.919s），包括 v5.20 评论周期增量和现有规划、验收、发布等测试。
- 无业务环境写入，测试 MySQL 已关闭。此为限定包的回归证据，不替代 Console JWT、目标租户迁移、浏览器视觉或全方案逐项验收；目标保持实施中。

### 2026-09-08：评论历史 API

- 新增 Runtime planning-comments:history 与 BFF comments/{commentId}/history GET，限定分页和路径 ID，使用既有 read/view 权限，已加入只读 POST 白名单。历史领域查询已在前轮真实 MySQL 测试验证。
- Go 精确 capability 前置检查及只读路由测试通过；新增历史输入测试覆盖无效 ID、分页上限、对象覆盖拒绝。
- 历史页面尚未接入，本轮没有真实 JWT 全链路验证，AC-27 仍未完整完成。

### 2026-09-08：评论历史面板

- 每条评论新增查看/收起历史入口，独立组件分页展示操作、作者、时间、版本、修改前后正文及删除前正文。读取返回的 comment_id 必须匹配当前评论；正文按纯文本渲染。
- Nuxt typecheck、ESLint 通过；Chrome 临时独立组件页搭配模拟 API，实际核对编辑前后正文、版本及作者显示。测试页面与 API 已清理，未修改业务数据。
- 展开入口、跨页交互、删除历史和 390/1440 视觉仍未完整验证；此次不等同于真实 JWT 全链路验收。

### 2026-09-08：评论历史归属回归

- 历史领域读取补充规范 UUID 校验，避免只依赖 BFF 输入检查。
- 真实隔离 MySQL 测试新增跨产品、同产品错事项、comment 代替 view 三类拒绝场景并通过；既有历史原文、周期归属与评论事务测试同时通过。
- 这证明领域层的归属和动作边界，不替代实际 JWT、历史入口浏览器交互或移动端验收。

### 2026-09-08：到期复评周期筛选

- 周期列表新增 BFF reviewDue=true/false 白名单参数，映射 Runtime review_due。只匹配 open 且 next_review_at 非空并已到期；count/分页共用数据库 UTC 截止时间，保留原产品范围/状态/关键词筛选。
- 11 项周期输入测试通过；真实 MySQL TestMySQLPlanningCycleCreateAtomicity 扩展未安排、未来、到期、闭期场景并通过。
- 当前仅列表 API 筛选，尚未加入页面过滤器，也未完成复评确认/下次日期推进闭环；PC-06A 仍待实现其余复评流程。

### 2026-09-08：周期页到期复评筛选

- 周期列表增加复评安排筛选（全部/已到期），接 reviewDue API 参数，复用列表分页重置机制；增加下次复评时间列及服务器时间口径说明。
- ESLint、Nuxt typecheck 通过；Chrome 本地模拟空列表核对下拉选项、筛选后说明和重置操作。临时 API 已移除，未验证实际 JWT 或 390/1440 视觉。
- 复评确认与下次日期推进仍未实现，不能将到期查询视为完整复评闭环。

### 2026-09-08：周期复评记录领域命令

- 新增 ReviewPlanningCycle：只允许 active 产品/open 周期，要求 prioritize 许可、根与周期版本、非空结论（复用 transition reason）。按数据库 UTC 当前时间和周期 review_interval_days 设置下次复评，保存 before/after/结论审计及幂等 receipt。
- 不修改 queue_revision、事项、评分、stale 判定和正式决定；需要变更评分/顺序时仍须执行相应评估/决策命令，复评记录不能充当自动清除过期评分。
- TestMySQLPlanningCycleReviewAtomicity 在隔离 MySQL 通过：assess 不代替 prioritize、审计失败回滚日期/版本、成功重放、周期仍 open/队列不变、按 14 天默认间隔推进。
- 当前仅领域命令，Runtime/BFF/精确 capability/前端确认及历史查看仍待接线；未标复评闭环完成。

### 2026-09-08：复评 Runtime/BFF/服务授权

- 复评领域命令接入 Runtime dispatch 与 BFF review POST，严格输入复用 transition 解析，禁止 query；精确 cycle-review capability 独立于周期 edit/close，产品动作仍需 prioritize。
- Go 精确权限前置测试、13 项 Node 输入/grant 契约及 ESLint 通过；隔离 MySQL grant 测试 104 组合通过。未安装目标租户授权。
- 复评确认页面、结论历史展示及成功 BFF→Runtime 全链路仍待验证。

### 2026-09-08：周期复评确认页面

- 新增 cycles/{cycleId}/review 页面和 PlanningCycleReviewForm，在周期列表详情弹窗向具有 prioritize 权限的开放周期显示入口。读取时核对产品、周期开放状态和版本。
- 必填结论，Foundation 二次确认显示间隔和不自动改评分/顺序的语义；冻结根/周期版本，失败保留正文与同 payload 幂等键，提交时禁止路由切换。成功响应须匹配产品/周期、open 状态及 next_review_at，再返回列表。
- ESLint 通过。本轮尚未完成浏览器提交/失败重试及移动端验证，复评历史入口仍待实现。

### 2026-09-08：复评表单浏览器提交验证

- Chrome 临时组件页实际验证空结论禁用、填写后 Foundation 确认摘要（结论/14 天间隔/评分及排序保留）、提交期间控件禁用、成功事件触发。模拟 API 校验根版本 3、周期版本 2、非空结论及幂等键存在。
- 临时页面/API 已清理，未写业务数据库。本次为实际浏览器搭配模拟 API，不证明真实 JWT 全链路；失败重试、列表入口返回及移动端视觉仍待验证。

### 2026-09-08：复评历史领域查询

- 新增 ListPlanningCycleReviews，复用产品 view 授权和有界分页，从 review 审计中读取操作者、时间、结论及 before/after 周期快照；校验两个快照的产品/周期归属，不返回混入其他对象的历史。
- 真实隔离 MySQL TestMySQLPlanningCycleReviewAtomicity 扩展通过：历史结论/前后版本一致、prioritize 不能替代 view、跨产品查询拒绝。
- 当前仅领域查询，Runtime/BFF 和历史页面仍待接入，复评完整验收尚未完成。

### 2026-09-08：复评历史 API 与详情面板

- 接入 Runtime planning-reviews:list、BFF reviews GET 及周期详情弹窗内 PlanningCycleReviews，显示结论、操作者、时间、前后版本及下次复评时间，支持分页和错误重试。
- Go 精确权限与只读路由测试通过；5 项 Node 分页/grant 契约通过；ESLint 通过。页面浏览器交互和 390/1440 视觉本轮未验证，真实 JWT 全链路仍未完成。

### 2026-09-08：复评 Runtime 成功链路

- 扩展 TestMySQLProductHandoffRuntimeCreatesActualProjectDraft，在既有项目/版本链路后调用实际 Adapter.HandleRuntime 的 planning-cycles:review、同键重放和 planning-reviews:list。
- 真实隔离 MySQL 测试通过：复评 receipt 原样重放、历史只有 1 条、结论匹配、队列 revision 不变。确认 Runtime dispatch/解码/领域命令/历史读取已连通。
- 受信 current_user 和 scope 由测试注入，不属于实际 Console JWT 签发/验证链路；BFF HTTP 与浏览器到数据库整链仍未完整验收。

### 2026-09-08：复评待办到关闭的领域流程验证

- TestMySQLPlanningCycleReviewAtomicity 增加实际 ListPlanningCycles(review_due=true) 的复评前 1 条/复评后 0 条断言。
- 接实际 ClosePlanningCycle 命令关闭周期，使用当前根/周期版本再次复评返回 planning_cycle_state_conflict，既有复评历史仍仅 1 条且快照版本不变。隔离 MySQL 测试通过。
- 该证据覆盖领域命令组合；浏览器到数据库、实际 JWT、移动端及全方案其他模块仍未完成。

### 2026-09-08：产品版本删除领域命令

- 新增 DeleteProductCenterVersion：delete 许可、active 产品、planning 且无当前发布记录、根/版本/范围 revision 一致；事务内检查执行工作项、范围、项目绑定、验收和发布记录引用，无引用才删除。保留 before 版本快照及原因审计，根版本和 receipt 同事务。
- 真实隔离 MySQL TestMySQLProductVersionDeleteAtomicity 通过：edit 许可拒绝、工作项引用拒绝、审计失败回滚、成功及删除后同键重放。其他引用类别与并发旧入口仍待专项验证。
- 尚未接入 Runtime/BFF/前端/服务 grant，旧 admin/project 删除仍未切换；发现其事务外检查后直接删除的旧实现，不能视为已解决。PC-08 仍未完成。

### 2026-09-08：版本删除 Runtime/BFF 接入验证

- 已核实 versions:delete Runtime dispatch、浏览器 DELETE 路由、精确 delete capability 和 grant 生成清单接入。
- 新增 productVersionDeleteRuntime.test.ts，实际执行 BFF 源码验证 delete 许可、受信操作者、路径、幂等键、no-store、非法输入/缺权提前拦截及服务错误映射；pnpm exec tsx --test 运行 2 项通过。Runtime 精确权限数据库前拒绝测试通过。
- Node 直接 strip-types 调用因仓库无扩展名导入解析失败，改用已有 tsx 执行通过。尚未验证目标环境 grant、真实 JWT 全链路；前端删除入口和旧删除命令切换仍待完成。

### 2026-09-08：版本删除前端及旧入口切换

- 产品中心版本详情新增规划版本删除表单：独立 delete 权限、冻结根/版本/范围 revision、必填原因、Foundation 破坏性确认、同请求幂等重试、提交时阻止离页，成功后返回版本列表。权限 API 增加 Foundation delete 判断。
- 系统管理删除按钮改为进入对应产品中心版本详情；旧 admin/project Runtime 删除返回 410 legacy_product_version_delete_retired，不再执行事务外引用检查和直接 DELETE。
- Nuxt typecheck、相关页面 ESLint、旧入口数据库前退役测试与 Runtime 精确 scope 测试通过。本轮尚未完成删除表单浏览器交互及 390/1440 视觉验证；真实 JWT 全链路和其余 PC-08 旧写入口仍待完成。

### 2026-09-08：删除引用保护与最新服务授权 SQL 验证

- 扩展真实隔离 MySQL TestMySQLProductVersionDeleteAtomicity，分别验证范围、项目绑定、验收、发布记录引用阻止删除，并断言版本仍存在、产品根 revision 未变；新增三个 revision 冲突及 developing 状态拒绝。连同既有工作项、审计回滚和幂等重放测试通过。
- 验收/发布证据受 append-only 触发器保护，测试使用独立数据库隔离各引用场景，不关闭或修改保护规则。
- 最新生成的服务授权 SQL 在隔离 MySQL 验证通过：106 项精确要求，覆盖幂等 seed、缺失客户端、无关客户端、传输前提、失效授权及过期凭证。此证据不是目标租户安装或实际 JWT 签发证明。

### 2026-09-08：版本删除浏览器失败重试验证

- Chrome 在实际版本详情页面验证：删除原因空白时提交禁用；Foundation 确认摘要包含版本、原因、引用限制及不可恢复说明；首次模拟 API 503 后显示错误并保留原因；再次确认成功返回空版本列表。
- 临时 API 校验根/版本/范围 revision 为 4/2/3、原因及非空幂等键，要求第二次请求使用相同幂等键才成功。临时 QA-DELETE API 已清理，未接触业务数据库。
- 这是实际浏览器与模拟 API 的交互验证，不证明真实 JWT/BFF/Runtime 数据库全链路；390/1440 视觉验收仍未完成。

### 2026-09-08：项目页新建版本转向产品中心

- 项目版本页的“新建版本”改为选择已关联产品并前往产品中心版本列表；去掉项目侧重复的版本号/名称/日期创建表单和旧 POST 调用。目标页面执行产品权限判断，创建版本不再隐式归属于发起项目。
- 旧 createProductVersion Runtime 返回 410 legacy_product_version_create_retired，不能再由项目管理员直接 INSERT 绕过产品中心命令。
- 页面 ESLint、Nuxt typecheck、Go 旧创建与删除入口数据库前退役测试及相关 diff 空白检查通过。此导航调整尚未做实际项目页面浏览器验证；管理端旧创建/编辑、范围与项目关联等仍待统一，PC-08 未完成。

### 2026-09-08：管理页创建与编辑版本统一入口

- 管理页面的新建版本跳转产品中心版本列表，编辑版本跳转对应详情。移除旧版本表单、重复 V+一位小数格式校验、直接 owner_project_id 输入及旧 POST/PUT 请求；版本规则由产品中心统一执行。
- adminCreateProductVersion/adminUpdateProductVersion 分别返回 410 create/edit retired，不再通过管理员旧身份执行直接创建或兼容编辑。
- 页面 ESLint、Nuxt typecheck、Go TestLegacy 范围回归及相关 diff 空白检查通过；新增/更新测试明确检查 nil DB 前返回对应 410。此次未启用 MySQL，涉及 MySQL 的其他测试不计为实际数据库验证。
- 管理页导航浏览器验证、项目旧编辑、范围和关联写入仍待完成，PC-08/PC-11 尚未全部验收。

### 2026-09-08：项目版本编辑与旧基本信息路由收敛

- 项目 updateProductVersion 改为 410 legacy_product_version_edit_retired；页面已有对应产品中心管理深链，未发现仍提交旧基本信息编辑请求的页面。
- 移除已无业务调用方的临时 updateLegacyVersionFields helper 及其仅针对该 helper 的测试，避免继续保留独立旧编辑规则。
- 新增实际 handleProductVersionRuntime 路由矩阵，覆盖管理/项目创建 POST、编辑 PUT/PATCH、删除 DELETE 共 8 组请求；带旧管理员字段仍在 nil DB 前返回精确 410。Go TestLegacy 回归通过，相关 diff 空白检查通过。
- 该证据只证明旧基本信息写路由收敛；新产品中心命令的实际 JWT、旧范围及执行关联链路仍需完成，PC-08 保持未完成。

### 2026-09-08：项目新增范围入口迁移

- 项目“添加特性”入口转为产品中心版本范围深链，移除标题直填旧新增表单和旧 POST 调用；规划事项选择与范围创建使用产品中心已有命令。
- 项目 createVersionFeature 返回 410 legacy_product_version_scope_create_retired，阻止旧项目身份绕过新范围的规划决策合同。
- 实际路由数据库前退役测试、页面 ESLint 和 Nuxt typecheck 通过。项目页面导航浏览器验证仍待完成；管理端新增和两端范围编辑/删除尚未迁移，不据此宣称 AC-28 或 PC-08 完成。

### 2026-09-08：管理端新增范围入口迁移

- 管理页面新增功能特性转到产品中心版本范围页，删除旧新增 POST 分支与 create/edit 模式状态；旧弹窗暂时仅承担仍待迁移的编辑。
- adminCreateVersionFeature 返回与项目端相同的 410 legacy_product_version_scope_create_retired；新增路由测试同时覆盖管理和项目入口，在 nil DB 前拒绝标题直填及旧管理员字段。
- 两端路由测试、管理页 ESLint 和 Nuxt typecheck 通过。旧范围编辑/删除、执行关联及真实授权整链仍未完成；本次导航未作浏览器验收。

### 2026-09-08：撤回范围交付确认领域命令

- 新增 ReopenProductVersionScope：要求 product_versions accept 许可、active 产品、planning/developing 且无当前发布记录、根/版本/范围 revision 和撤回原因；仅 delivered 范围可退回 planned。原 scope-deliver 审计不变，新增 scope-reopen before/after/reason，根/版本/范围 revision 与 receipt 同事务。
- 扩展真实隔离 MySQL TestMySQLProductVersionScopeDelivery 通过：edit 不能替代 accept，审计失败状态/revision 回滚，成功撤回及同键重放，原交付证据保留，范围 revision 2→3。
- 当前仅领域命令，Runtime/BFF/精确服务授权及页面尚未接入；实际整体验收失效组合、发布状态拒绝和并发仍需补充验证。旧范围编辑/删除不能因此直接视为已迁移。

### 2026-09-08：范围交付撤回 Runtime/API/服务权限接入

- Runtime versions:scope-reopen 调用 ReopenProductVersionScope；浏览器 POST versions/{versionId}/features/{scopeId}/reopen，严格校验三 revision/原因、路由范围 ID、幂等键及空查询，Foundation 要求 product_versions:accept。精确 capability 为 aims:product-versions:scope-reopen。
- manifest 与 grant 生成器同步并重新生成 seed/verify：102 条业务 grant、108 项核验组合；此次尚未执行更新后的真实 MySQL grant 验证或目标安装。
- Go Runtime 精确权限数据库前拒绝测试、2 项实际 BFF 源码测试（actor/产品/范围/权限/幂等/非法请求和错误映射）、Nuxt typecheck 通过。页面和 Runtime 成功调用数据库链路仍待接入/验证。

### 2026-09-08：范围交付撤回页面与授权 SQL 验证

- 版本范围页增加 delivered 范围的撤回入口，要求现有 accept 权限、可修改版本且无当前发布记录。复用确认弹窗，撤回只提交原因和冻结的三个 revision；Foundation 摘要说明退回计划中、原证据保留及整体验收重核。
- 请求重试标识加入动作与范围 ID，同请求重试保留幂等键；提交期间锁定输入、弹窗关闭及路由离开，成功后刷新范围与权限。原确认交付模式仍要求验收依据。
- 页面 ESLint、Nuxt typecheck 通过；新增 scope-reopen 后的授权 SQL 在隔离 MySQL 实测 108 项通过。目标环境授权安装、实际 JWT 与页面浏览器交互/390/1440 视觉仍未验收。

### 2026-09-08：范围交付撤回与重新确认组合验证

- 真实隔离 MySQL TestMySQLProductVersionScopeDelivery 扩展通过：planned 状态不能再次撤回；重新调用实际交付确认命令后范围回到 delivered，版本/范围 revision 3→4；两次交付审计分别保留，最新证据为新的核验记录。
- released/archived 状态 fixture 下调用撤回命令均拒绝，撤回审计仍仅一条。这里验证状态门禁，未使用实际发布命令生成发布记录，不能代替发布→更正全链路证据。
- 页面浏览器、Runtime 成功调用、真实 JWT 及 PC-08 其他范围/执行关联迁移仍待完成。

### 2026-09-08：范围交付撤回浏览器验证

- Chrome 实际范围页面验证 delivered 入口、原因必填、Foundation 影响摘要、提交期间禁用及成功刷新 planned，并显示重新确认交付入口。
- 模拟 API 验证根/版本/范围 revision 4/2/3、指定撤回原因、非空幂等键及禁止 evidence 字段；临时 QA-SCOPE API 已清理，未写业务数据。
- 本次为浏览器与模拟 API 验证，未证明真实 JWT/Runtime 整链、失败重试或 390/1440 视觉验收；这些仍待完成。

### 2026-09-08：实际 Runtime 发布撤回后重开范围

- 扩展 TestMySQLProductHandoffRuntimeCreatesActualProjectDraft，在既有实际创建/范围/交付/验收/发布/撤回发布链路之后调用 Adapter.HandleRuntime versions:scope-reopen，再以刷新许可和原幂等键重放。
- 真实隔离 MySQL 测试通过：Runtime 解码到领域事务连通，重放 receipt 不变，范围回到 planned 且 scope_revision 加一，原 release record 仍存在。
- 测试使用受信 query 注入 actor 与 capability，不包含实际 Console JWT 签发或 BFF HTTP；发布记录存在性检查不单独证明全部内容哈希未变。全方案其他需求仍待完成。

### 2026-09-08：范围交付与撤回历史领域查询

- 新增 ListProductVersionScopeHistory，要求产品版本 view 许可并校验版本/范围归属，分页限制 1–100；只读取 scope-deliver/scope-reopen 的动作、操作者、时间、版本、原因和证据，不返回完整审计 payload。
- 真实隔离 MySQL TestMySQLProductVersionScopeDelivery 验证两次交付与一次撤回的倒序分页、原证据保留、撤回不伪造新证据、accept 不能替代 view、未知范围拒绝，测试通过。
- 当前仅领域读取，Runtime/BFF/页面历史入口尚待接入；跨产品历史与实际 JWT 全链路需继续验证。

### 2026-09-08：范围历史 Runtime 与 BFF 接入

- 新增 versions:scope-history Runtime 分发及 GET features/{scopeId}/history；view 许可、read 精确 capability，page/pageSize 白名单与有界分页，路由绑定版本/范围 ID。Runtime POST 已加入只读白名单。
- 3 项 BFF 源码测试、Runtime 精确权限数据库前拒绝、只读传输测试、Nuxt typecheck 和相关 ESLint 通过。
- 页面历史组件、实际 Runtime 查询数据库整链及真实 JWT 仍待完成；现有领域查询的隔离 MySQL 证据见上一记录。

### 2026-09-08：范围交付历史页面接入

- 新增 VersionScopeHistory 组件，在每项范围上展开/收起，显示确认交付/撤回、操作者、时间、版本修订、原因与证据；纯文本渲染，分页 10 条，支持错误提示及刷新重试。
- 页面按产品/版本/范围/范围 revision 为历史组件设置 key，范围变更成功后重新读取；响应校验版本及范围归属、动作枚举、总数和条目字段。
- 相关 ESLint 与页面 diff 空白检查通过；历史展开/分页浏览器交互和移动端视觉仍待验证。

### 2026-09-08：范围历史 Runtime 与对象隔离验证

- 实际 Adapter.HandleRuntime versions:scope-history 在发布撤回及范围撤回后查询成功，返回一次交付与一次撤回，动作、原因及原交付证据匹配。
- 领域查询补充有效其他产品许可访问原版本/范围拒绝；同版本内另一个真实范围返回空历史，不混入前一范围记录。
- 两个实际隔离 MySQL 测试通过（Runtime handoff 完整测试及范围交付测试）。受信 query 注入仍非 Console JWT 证明；历史组件浏览器及方案其他功能继续待验收。

### 2026-09-08：范围历史组件浏览器分页验证

- Chrome 独立页面实际验证历史组件首屏 10 条动作/原因/证据、撤回条目不显示空证据、下一页显示首次交付原始证据及原操作者、末页禁用下一页、刷新保留第二页和记录。
- 测试使用实际组件和模拟 API，共 11 条 fixture；临时页面与 API 已清理。该证据不包含主范围页展开集成、失败重试、真实 JWT 或 390/1440 视觉验收。

### 2026-09-08：历史范围验收标准补录领域命令

- 新增 UpdateLegacyProductVersionScopeCriteria：产品 edit 许可、active 产品、未发布且无当前发布记录、三 revision 及原因校验；仅 planned 且 planning_item_id IS NULL 的历史范围可修改验收标准，不写入规划决定/评分或改变范围归属。
- 标准变更与根/版本/范围 revision、before/after 审计和 receipt 同事务。真实隔离 MySQL 测试通过：view 拒绝、审计失败回滚、同键重放、历史标记保留、补录后实际交付确认成功、delivered 状态再编辑拒绝。
- 当前仅领域命令，Runtime/BFF/服务授权/页面补录入口待接入；非历史范围拒绝、跨产品和并发仍需补测。PC-08 仍未完成。

### 2026-09-08：历史范围标准补录 Runtime/API 接入

- 新增 legacy-criteria POST 路由与 Runtime scope-legacy-criteria 分发，Foundation edit 许可，精确 capability 单独登记；严格 parser 只接受验收标准、原因及三个 revision，拒绝规划事项、历史标记和状态注入。
- 4 项范围 BFF 源码测试（含补录输入与权限）、Runtime 精确权限数据库前拒绝、Nuxt typecheck 与 ESLint 通过。
- manifest/grant 已重新生成，104 条业务 grant、110 项核验组合；更新后的 SQL 本轮尚未真实 MySQL 验证或目标安装。页面、Runtime 成功链路和非历史范围拒绝专项仍待完成。

### 2026-09-08：历史范围标准补录页面

- 新增 LegacyScopeCriteriaForm 与范围页补录入口：仅产品 edit 许可、可修改且无当前发布记录的 planned 历史范围显示。弹窗冻结根/版本/范围 revision，填写标准及原因，Foundation 确认显示原/新标准和保留历史属性的影响。
- 保存结果校验产品/版本/范围及标准一致；失败保留输入与同请求幂等键，提交中禁用关闭及离页，成功刷新范围和权限。
- Nuxt typecheck 与相关 ESLint 通过。实际浏览器提交、非历史范围专项、目标权限与全链路仍待验证；未据此完成 PC-08。

### 2026-09-08：历史补录适用范围与服务授权验证

- 真实隔离 MySQL 历史标准测试新增正式规划事项关联的 planned 范围：补录返回 scope_locked，原 planning_item_id 和空标准保持；有效其他产品 edit 许可不能修改原产品范围。
- TestMySQLLegacyScopeCriteriaAtomicity 通过；最新 grant seed/verify 在隔离 MySQL 实测 110 项通过，涵盖 104 条业务 grant 与传输前提、过期/失效授权等。
- 以上不是目标环境安装或实际 JWT 签发证明；补录页面浏览器及 Runtime 成功链路仍待完成。

### 2026-09-08：历史标准补录组件浏览器提交验证

- Chrome 实际 LegacyScopeCriteriaForm 验证空输入禁用、填写标准与原因、Foundation 原/新标准及历史属性保留摘要、确认时禁用输入、成功 saved 事件。
- 模拟 API 校验根/版本/范围 revision 4/2/3、标准、原因和非空幂等键；临时页面与 API 已清理。该证据不包含主范围页权限入口集成、失败重试、真实 JWT 或移动端视觉。

### 2026-09-08：历史标准补录 Runtime 成功链路

- 在实际 Runtime handoff 集成测试中创建独立历史范围 fixture，调用 versions:scope-legacy-criteria 并刷新许可后同键重放。
- 真实隔离 MySQL 测试通过：标准落库、planning_item_id 保持 NULL、版本/范围 revision 各加一、重放 receipt 不变。
- 历史范围 fixture 由测试直接插入，不证明迁移脚本来源识别；actor/capability 仍由受信 query 注入，不代表真实 JWT/BFF HTTP 整链。整体 PC-08 和后续批次仍未完成。

### 2026-09-08：历史验收标准修改追溯

- 范围历史查询纳入 scope-legacy-criteria，返回 before_criteria/after_criteria；SQL 区分 JSON 字符串与 null，首次补录的空标准保留为 null。仍只输出明确字段，不暴露完整审计内容。
- VersionScopeHistory 增加“补录历史验收标准”动作及原/新标准显示，纯文本保留换行。
- 历史补录与范围交付的真实隔离 MySQL 测试通过；组件 ESLint、Nuxt typecheck 通过。新增标准历史显示尚未做浏览器验证，整体目标继续进行。

### 2026-09-08：正式规划范围创建与编辑历史

- 范围历史纳入 scope-create/scope-edit，按各动作既有审计格式提取范围 ID、原因及新验收标准，兼容已有 after/input/result 字段，不改写历史审计。
- 页面增加创建/修改动作标签，显示原/新标准；仍不暴露完整规划决定或执行快照。
- 真实隔离 MySQL 的规划选择/范围创建编辑、历史补录、交付撤回及实际 Runtime handoff 测试通过；Nuxt typecheck 与组件 ESLint 通过。新增动作的浏览器显示尚未验收。

### 2026-09-08：范围写操作使用成功加载的权限状态

- 范围页统一 canMutateScope，要求范围/权限/版本三请求均 success、产品 active、版本可修改及 current_release_record_id 明确为 null；编辑、历史补录和交付确认分别追加精确产品动作判断。权限刷新失败不会沿用缓存中的允许状态。
- Chrome 实际页面配模拟 API 验证首次允许确认/补录，重新读取权限返回 503 后错误可见且两个写入口消失，历史入口保留。临时 API 已清理。
- 页面 ESLint 与 Nuxt typecheck 通过。该浏览器证据不等于真实 JWT 或服务端授权验收。

### 2026-09-08：标准历史响应完整性与 Claude 辅助审查

- 标准历史条目要求 before_criteria/after_criteria 为 null 或字符串；创建、编辑、历史补录动作必须有非空新标准。缺失字段不再降级成正常的“未提供”记录。组件 ESLint 与 Nuxt typecheck 通过。
- 通过 Orca 新终端运行 Claude Code Haiku，只读审查历史组件及查询。其三项建议经核实未采纳：object_id 实际 VARCHAR(191)，versionId prop 本为字符串且后端为数字，ref query 分页已有浏览器成功证据。审查终端已关闭，未让子代理修改仓库。
- 本轮字段异常分支尚未做浏览器专项；整体产品中心仍未完成全部实施与验收。

### 2026-09-08：范围迁移阶段整体回归

- `pnpm exec tsx --test test/product*.test.ts`：108 项通过、0 失败、0 跳过，约 2.76 秒。
- 显式指定隔离 MySQL socket 后运行 `go test ./internal/apps/aims/productcenter ./internal/apps/aims -count=1`：两包通过（21.838 秒 / 1.270 秒）。覆盖本阶段新增范围撤回、历史补录、历史查询及已有规划/验收/发布组合，未写业务数据库。
- 该结果是当前代码回归证据，不是目标授权安装、真实 JWT/BFF HTTP、移动端视觉或全部 PC-00～PC-18 验收证明；旧范围编辑/删除、执行关联和后续产品规划能力仍待实施。

### 2026-09-08：PC-13 功能模块树数据基础

- 新增 v5.21_product_components 迁移及 canonical schema：模块稳定 biz_id、父子关系、排序、revision 与审计主体；长期功能新增 nullable component_id，既有功能保持未分组，不从标题推断层级。
- 父子及功能归属使用 product_code 复合外键，限制跨产品关系，带子模块或功能引用的模块不可直接删除。完整防环、深度限制和业务权限仍须由后续领域命令实现，当前 schema 不宣称树无环。
- 真实隔离 MySQL 测试通过：重复迁移、原功能/修订无损、跨产品父子和功能关系拒绝、同产品子模块与功能归属成立、引用删除阻止。
- 未应用目标数据库；模块树命令/API/UI、功能迁移交互与正式产品目标仍未实现，PC-13 未完成。首批剩余项仍保留原范围，不因开始第二批而取消。

### 2026-09-08：模块树层级与移动校验

- 新增 ValidateProductComponentMove，校验移动后的完整树，拒绝自身/后代成环、缺失父节点、重复 ID；最大 16 层，移动子树时同时检查全部后代深度，不修改输入快照。
- 定向 Go 测试通过：正常移动/移到根、自环/后代环、其他产品或不存在的父 ID、后代越深度边界与原树不变。
- 当前为纯领域校验；创建/移动命令仍须在产品根锁内读取当前树并调用它，尚未接入前不能宣称运行时已经防环。PC-13 继续进行。

### 2026-09-08：模块移动事务命令及数据库验证

- MoveProductComponent 在统一授权和产品根锁内读取整棵当前产品模块树，验证防环/后代深度后移动；要求产品与模块双修订号以及非空原因。模块更新、产品修订递增、移动前后审计和幂等回执在同一事务提交。当前树规模上限 10000 节点，超限拒绝而非截断验证。
- 真实隔离 MySQL 验证通过：view 权限不能写或读取已有写回执；跨产品父节点、后代循环、模块/产品修订冲突拒绝；审计失败整体回滚且不残留回执；成功重放不重复移动；审计原因/目标父节点正确；移回根保持后代关系。模块迁移与纯树校验定向测试同样通过。
- 当前仅完成领域命令，尚无运行时路由、BFF、服务授权声明或用户页面；模块创建、编辑、功能归类及目标管理仍待实现，PC-13 未完成。未修改目标业务数据库。

### 2026-09-08：模块树层级限制回归原方案

- 核对实施方案第二批数据设计，模块树明确最大 3 层。将先前错误采用的 16 层修正为 3 层；此前状态记录中的 16 层不再代表当前实现。
- 纯校验及真实隔离 MySQL 移动命令测试通过：两层子树移到一级模块下允许；移到二级模块下会使后代进入第四层，拒绝且不改变模块、产品修订和回执。
- 模块创建、运行时/BFF/UI 接入仍待实现，未据此标记 PC-13 完成。

### 2026-09-08：模块创建领域命令

- 新增 CreateProductComponent：统一 product_components:edit 授权、产品根锁与预期修订，服务端生成稳定 biz_id；名称/描述校验、父节点产品归属、完整树三层限制在写入前检查。模块、产品修订、创建快照审计和幂等回执事务提交。创建与移动共用树快照读取，最多 10000 节点。
- 隔离 MySQL 定向测试通过（含创建、移动、迁移和纯树校验）：审计失败不残留模块/回执，成功重放不重复创建，前三层合法、第四层拒绝，不存在的父节点及过期产品修订拒绝；最终模块、审计、回执数量及产品修订一致。
- 尚未接入运行时/BFF/UI，模块编辑、删除、功能归类与正式产品目标仍待完成。本记录不代表 PC-13 或整体产品中心完成。

### 2026-09-08：模块按层分页读取

- 新增 ListProductComponents：统一 product_components:view 授权，产品根锁内返回当前产品修订、模块修订及直接子模块数量；parent_id=null 只列根模块，指定父节点先验证归属，再按 sort_order/id 稳定分页（每页最多 100）。不将截断的全产品列表冒充完整树。
- 真实隔离 MySQL 创建/读取组合测试通过：真实创建三级模块后读取根与子层，两个根模块的顺序和跨页身份正确，跨产品父节点/授权凭据及非法分页拒绝。
- 此次为领域读取能力；运行时路由、BFF、页面和其他 PC-13 要求仍未完成。

### 2026-09-08：模块 Runtime 入口与精确授权

- 接入 components:list/create/move，标准信封与产品权限事实；精确 read/create/move 服务 capability；list 纳入只读传输分类，模块修订冲突映射 409。Manifest 新增业务资源和服务资源，产品角色按已有功能查看/编辑职责补充模块权限。
- Runtime 边界测试通过：宽 scope/其他资源/wildcard 拒绝，方法与错误授权结构拒绝，缺 actor 委托拒绝。只读传输分类定向通过。实际 Runtime 成功调用、真实 JWT 与 BFF/UI 尚未验证。
- 两个 audience 增加 6 条业务 grant，累计 110 条业务/116 项核验要求。隔离 MySQL grant 测试通过（重复 seed、缺客户端、decoy、传输前置、失效 grant、凭据过期）；无目标租户授权修改。API 与模块契约已同步。

### 2026-09-08：模块 Runtime 实际成功链路

- 新增独立隔离 MySQL Adapter.HandleRuntime 集成测试，实际创建两个模块、将其建立父子关系、按根/子层读取。断言标准响应信封、operation、产品/模块修订及子节点数量。创建与移动均以原请求重放，回执不重复；新键过期修订拒绝且总回执数不增加。
- 显式隔离 socket 下 TestMySQLProductComponentsThroughRuntime 通过。测试调用真实 Adapter 与数据库，但注入已验证的服务上下文及权限事实，未覆盖 Console JWT 签发/校验、HTTP/BFF 或浏览器。
- BFF、页面、模块编辑/删除/功能归类及产品目标仍待实施，PC-13 未完成。

### 2026-09-08：模块 BFF 创建/移动/分页入口

- 新增 components GET/POST 与 componentId/move POST；复用 Foundation Runtime helper、统一产品授权、可信 actor、精确 capability 和幂等头。严格输入白名单，写入父节点要求显式 null/正整数，拒绝从 body 注入模块 ID、actor 或权限。
- 4 项定向输入/BFF 测试通过：根/子分页与边界、字段长度/整数范围、可信 actor 和路由绑定、权限拒绝、Runtime 不可用 503 和上游错误。两个 BFF/input 工具文件 ESLint 通过；路由通配路径因方括号匹配失败，未据此宣称路由 lint 通过。尚未进行 Nuxt 全量类型检查、HTTP 或浏览器验收；列表和创建的 BFF 调用专项仍待补充。
- 模块管理页面、编辑/删除/归类及产品目标仍待完成。

### 2026-09-08：模块 BFF 补充验证

- 补充列表与创建的实际 BFF 源码执行测试：列表仅传指定父节点/分页，使用 view/read 且无写入幂等键；创建保留显式根节点，不导入无关路由组件 ID，拒绝注入模块 ID/authorization。
- 模块输入及三项 BFF 合计 6 项测试通过。使用 ESLint lintText/filePath 检查两个工具与三个实际路由文件，5 文件 0 错误，解决先前方括号 glob 无匹配问题。
- Aims `pnpm exec nuxt typecheck` 完成，退出码 0。HTTP/真实 JWT 与浏览器验收仍未完成；下一步模块管理页面。

### 2026-09-08：模块浏览页面

- 新增产品模块页面及产品空间入口：逐层进入/面包屑返回、每层真实分页、加载/错误/空状态，显示直接子模块数量；核验响应产品/父节点、页码、修订和重复 ID，失败不显示旧列表。页面最多浏览三级。
- Aims Nuxt typecheck 与两个修改页面的 ESLint 通过。Chrome 在隔离 Nuxt 模拟接口验证：21 个根模块第一页 20 条、第二页仅第 21 条，进入空子层显示位置与空态，返回根层重置第一页。临时接口已移除，开发服务已停止。
- 本次为浏览能力，创建/移动交互尚未实现；1440/390 视口视觉与真实 BFF/JWT E2E 尚未验证，不能称模块管理或 PC-13 完成。

### 2026-09-08：模块创建页面交互

- 新增模块权限读取 BFF，创建按钮要求有效 list/permission 状态、产品 active/edit 与相同根修订。当前层级创建 modal 冻结 parent/revision，名称必填；保存使用稳定 payload 对应幂等键，失败保留输入，保存中禁止路由离开与关闭，成功刷新列表/权限。
- Aims Nuxt typecheck、页面与权限路由 ESLint 通过。Chrome 隔离 mock 验证入口、根位置、空名称禁用、填写提交后关闭表单；mock 校验 parent=null、expectedRevision=1 和幂等头。未模拟持久化列表结果、失败重试及权限变化，未覆盖 1440/390 视觉。临时 mock 和 dev 服务已清理。
- 移动交互、模块编辑/删除/功能归类及正式目标仍待完成，PC-13 与总体目标未完成。

### 2026-09-08：模块移动目标选择与表单

- 模块列表接入移动表单，冻结对象/产品修订。目标通过真实层级分页读取，只展示允许作为父节点的前两层；当前模块不可选且不可进入，因此不提供后代选择路径，当前父节点不可重复选择，支持移到根。服务端仍执行完整防环/后代深度检查。
- Foundation useConfirm 展示模块、目标、原因及子树影响；非空原因必填，保存中禁用目标浏览与关闭，原 payload 重试键保留；成功校验返回对象/目标/新修订后刷新主列表。目标列表必须匹配冻结产品修订，否则提示关闭刷新。
- 表单与主页面 ESLint 通过；最终集成后 Aims Nuxt typecheck 退出 0。移动的浏览器专项、失败重试、1440/390 视觉仍待完成；此轮不宣称交互验收通过。模块编辑/删除、功能归类与正式目标等原计划项仍保留。

### 2026-09-08：模块移动表单失败重试浏览器验证

- Chrome 挂载实际 ComponentMoveForm，在隔离 mock API 下验证：当前模块无选择/进入操作；未选目标/空原因禁止提交；选目标并填写原因后 Foundation 确认框显示模块、目标、原因与子树/三级限制影响，确认期间表单控件禁用。
- mock 第一次移动返回 503，页面显示错误并保留目标和原因；第二次仅当幂等键与整个 body 和第一次完全一致才成功，浏览器显示 saved 结果。mock 同时校验目标父 ID、产品/模块修订号。临时页面/接口已移除，dev 服务已停止。
- 此证据针对实际表单的成功与重试行为，不是主页面权限刷新、真实 BFF/JWT、目标跨页导航或 1440/390 视觉验收；原计划未完成项继续保留。

### 2026-09-08：既有功能归入模块领域命令

- 新增 AssignProductFeatureComponent，使用 product_features:edit 和统一事务命令；功能 biz_id、产品/功能双修订、有效原因必填，目标模块只允许同产品，null 表示移回未分组。仅修改 component_id、功能修订及更新主体/时间，产品修订、审计和回执同时提交，不重建功能或改写规划/版本范围。
- 真实隔离 MySQL 定向测试通过：view 不能写，跨产品目标拒绝，审计失败模块归属/双修订/回执整体回滚，成功重放不重复写；移回未分组保留 biz_id/标题/描述，双修订冲突分别拒绝。
- 当前为领域命令，尚未接入功能读取字段、运行时/BFF 或归类交互。不能据此宣称功能迁移验收或 PC-13 完成。

### 2026-09-08：功能读取返回模块归属

- FeatureRecord/共享扫描增加 nullable component_id，功能列表、详情以及规划关联和功能编辑/生命周期审计快照随之携带归属。读取代码要求 v5.21 已应用；测试共享迁移升级到当前 schema，同时模块迁移无损测试仍显式从 v5.20 旧功能开始，未取消旧数据验证。
- 真实隔离 MySQL 两包完整回归通过：productcenter 25.545 秒、aims 1.252 秒。另补充归类后列表返回目标、取消归类后详情返回 null/原 biz_id/新修订的断言，定向测试通过。
- 未应用目标业务数据库；归类 Runtime/BFF、功能目录筛选与归类 UI 尚待实现，不能宣称 PC-13 完成。

### 2026-09-08：功能模块与未分组筛选

- FeaturePageQuery 增加 component_id/ungrouped，严格互斥，指定模块先核验同产品；功能 count/list 共用条件，默认仍为全部功能。BFF parser 接受 componentId/ungrouped=true，拒绝歧义/数组/不安全 ID，不改变原筛选默认返回。
- 隔离 MySQL 功能归类/读取定向测试通过，覆盖指定模块、未分组、跨产品和互斥拒绝；5 项 FeatureInput 测试与 parser ESLint 通过。接口说明同步。
- 页面筛选控件和归类写入口尚待实现，整体计划仍未完成。

### 2026-09-08：功能目录模块筛选页面

- 模块列表增加查看功能链接，使用功能目录 module URL 状态；功能目录增加全部/未分组/当前模块选项及返回模块选择入口。复用 useListPage 同步 URL、筛选切换重置分页，向 BFF 映射 componentId/ungrouped。响应校验模块归属，未分组与指定模块不得混入其他项。
- 两个页面 ESLint、Aims Nuxt typecheck 通过。Chrome 隔离 mock 验证指定 module=2 只显示认证功能，切换未分组后只显示未分组功能；临时 mock/dev 已清理。尚未核验多页筛选重置、真实 BFF/JWT 或 1440/390 视觉。
- 功能归类写入口与原计划其他项仍待实现，整体目标未完成。

### 2026-09-08：功能归类写入 Runtime/BFF

- 接入 features:component-assign 及 features/{bizId}/component BFF；独立精确 capability、edit 用户权限、路由功能 ID、显式 nullable 目标、双修订与原因、幂等键；拒绝未知字段和写入 query。
- Runtime 缺失服务上下文边界测试、6 项功能输入测试及 parser ESLint 通过；生成授权累计 112 业务 grant/118 要求，隔离 MySQL seed/verify 全场景通过。
- 实际成功 Runtime 调用、BFF 源码执行专项、归类页面及真实 JWT 未验证；不据此标记 PC-13 完成。

### 2026-09-08：功能归类完整 Adapter 链路与 BFF 边界

- 扩展隔离 MySQL Adapter.HandleRuntime 集成：创建/移动模块后，将现有功能归入子模块，重放同请求得到相同回执，通过实际 features:list + component_id 读取到原功能和新产品修订，再调用归类接口移回未分组，功能修订递增。定向测试通过。
- 新增 BFF 实际路由源码执行测试，两项通过：路由 biz_id、显式 null、可信 actor/facts、edit 权限、精确 scope、幂等头绑定；非法 body/query/key 不调用 Runtime，权限拒绝不调用 Runtime，未处理保留 503，上游错误保留错误映射。
- Adapter 测试注入受信服务上下文，BFF 测试 mock Foundation/Runtime；仍未覆盖实际 Console JWT 或 HTTP 全链路。功能归类 UI 与其他原计划任务继续进行。

### 2026-09-08：功能详情模块归类交互

- 功能详情读取校验 nullable component_id，并提供调整模块归属入口。新增 FeatureComponentForm：目标按层分页可选至第三级，当前归属禁重复选择但允许进入下级；支持移回未分组、原因必填、Foundation 影响确认。冻结功能/产品修订，幂等重试保留，保存期间关闭/路由受主页面 busy 控制；返回结果核对 biz_id/product/target/revision 后刷新详情与权限。
- 表单与详情页 ESLint、Aims Nuxt typecheck 通过。此次尚未进行归类表单浏览器专项或 1440/390 视觉，不能称功能归类 UI 已验收。模块编辑/删除、正式产品目标等原范围仍待完成。

### 2026-09-08：功能归入第三级模块浏览器验证

- Chrome 挂载实际 FeatureComponentForm，通过隔离 mock 逐级浏览基础平台→身份认证→登录模块；第三级仍可选择且无继续下钻入口。未选目标/无原因不能保存，当前已未分组时取消归类按钮禁用。
- 选第三级并填写原因，Foundation 确认显示功能/目标/原因与历史范围说明，确认期间控件禁用；mock 校验 componentId=30、产品修订4/功能修订2及幂等头，返回目标与新修订后触发 saved，浏览器显示归类完成。临时页面/接口和 dev 服务已清理。
- 仍未完成主详情页联动、实际 JWT/BFF、取消归类浏览器、跨页目标选择与1440/390视觉验收。PC-13 其他要求与完整方案继续进行。

### 2026-09-08：模块编辑领域命令

- 新增 EditProductComponent：名称/说明/排序编辑，独立双修订与原因校验，复用产品 edit 授权和根锁；更新字段、模块/产品修订、审计及幂等回执事务提交，不提供父节点变更字段。审计使用显式快照，不将未查询 child_count 伪装为 0。
- 真实隔离 MySQL 在实际模块移动之后验证编辑：view 拒绝，审计失败回滚名称/修订/回执，成功保存所有字段并幂等重放，子模块关系保持，产品及模块修订冲突分别拒绝。定向测试通过。
- 模块编辑 Runtime/BFF/UI 尚未接入；删除与正式产品目标等仍待完成。

### 2026-09-08：模块编辑 Runtime/BFF

- 接入 components:edit 与 componentId/edit POST；路由 ID、双修订、名称/说明/排序/原因严格校验，拒绝 parentId。使用独立服务 edit capability、统一产品 edit 权限与幂等键。API/模块契约/manifest/授权生成同步。
- Runtime 边界、7 项模块 input/BFF 测试及两个工具 ESLint 通过；授权清单现在 114 业务 grant/120 核验项，隔离 MySQL 全场景测试通过。
- 编辑 UI、成功 Runtime HTTP/JWT 验收及原方案其他项仍待完成，未标记整体完成。

### 2026-09-08：模块创建/编辑共享表单

- 列表增加编辑模块入口，创建/编辑复用弹窗与名称/说明/排序输入；编辑冻结模块及产品修订，额外要求修改原因，不传 parentId。创建也支持排序；列表响应校验 sort_order 整数范围。
- 保存区分 create/edit 响应，核对对象/父节点/名称/说明/排序与编辑新修订，成功后刷新列表和权限；失败保留内容及请求幂等键。页面 ESLint 和 Aims Nuxt typecheck 通过。
- 编辑浏览器专项、共享创建路径回归及1440/390视觉仍待完成；模块删除、目标与原计划其他项继续推进。

### 2026-09-08：模块编辑实际 Adapter 成功链路

- 在已有创建→移动→功能归类/取消归类实际链路后，通过 Adapter.HandleRuntime 调用 components:edit，验证编辑回执结构、原模块身份、根 parent=null、模块/产品新修订。重放不再写，列表返回新名称/说明/排序且 child_count 保持 1，过期新请求拒绝，最终回执计数正确。
- 隔离 MySQL TestMySQLProductComponentsThroughRuntime 通过。仍为注入受信服务上下文的 Adapter+DB 集成，不是实际 JWT/HTTP；页面编辑/创建回归与视觉验收继续待做。

### 2026-09-08：模块编辑浏览器表单验证

- Chrome 实际模块页加载隔离 mock，验证编辑入口、原名称/说明/排序回填和修改原因必填禁用；修改名称及排序 -2 后提交，mock 校验名称/数值排序/双修订/原因/幂等头，并拒绝 parentId，返回 component 快照后弹窗关闭。
- 修正编辑 modal 仍使用创建提示语的问题，明确所属位置经移动操作调整。mock 列表为静态，未据此证明保存后列表持久化刷新；实际 Adapter 数据更新已有独立证据。临时 mock/dev 已清理。创建共享路径回归、失败重试与1440/390视觉仍待做。

### 2026-09-08：空模块删除领域命令

- 新增 DeleteProductComponent：要求独立 product_components:delete、双修订与有效原因；产品根锁内检查直接子模块与功能引用，任一存在则拒绝，不自动级联或取消功能归属。空模块删除、根修订、完整对象审计快照及回执事务提交。
- 真实隔离 MySQL 定向通过：edit 不能删除或重放 delete 回执；子模块/功能引用分别阻止；审计失败恢复模块且根修订/回执不变；删除后原请求重放仍返回原回执。测试中直接 SQL 只用于设置/清理引用夹具。
- 删除权限 manifest、Runtime/BFF/UI 与其他原计划项尚待接入，当前领域命令不代表删除功能已可用。

### 2026-09-08：模块删除 Runtime 权限链路

- 接入 components:delete，manifest 声明独立业务 delete 与服务 delete，产品经理建议权限同步；存在子模块/功能引用映射409。API/模块契约同步。
- Runtime 边界测试通过；生成 grant 共116业务/122要求，隔离 MySQL seed/verify 场景测试通过。未执行目标授权安装。
- 删除 BFF/UI、实际成功 Adapter/JWT验证及整体计划剩余项仍待完成。

### 2026-09-08：模块删除 BFF

- 接入 componentId DELETE，独立 delete 权限与精确 capability、可信 actor/双修订/原因/幂等，模块权限接口返回 delete。输入白名单拒绝级联、客户端引用计数和对象 ID 覆盖。
- 模块 input/BFF 共8项通过，包含删除权限拒绝与非法字段不进入 Runtime；两个工具和两个路由 ESLint 通过。删除 UI、实际成功 Adapter及JWT/HTTP/视觉验收仍待完成。

### 2026-09-08：模块删除实际 Adapter 链路

- 模块完整 Adapter+MySQL 集成新增删除：父模块因子引用返回精确409/product_component_referenced；删除已取消功能归属的子模块成功，回执返回删除身份与产品新修订，原请求重放回执不变。真实按父节点列表归零，产品修订及回执数量正确。
- 隔离 MySQL TestMySQLProductComponentsThroughRuntime 通过。受信服务上下文为测试注入，未代表实际 JWT/HTTP。删除 UI 与原计划其他剩余项仍继续进行。

### 2026-09-08：模块删除页面

- 模块列表新增独立 delete 权限入口，已知子模块存在时禁用；弹窗冻结对象/双修订并要求原因，Foundation danger 确认说明不可撤销与引用阻止。保存中关闭/路由受 busy 控制，失败保留草稿和原 payload 幂等键，成功校验删除标识后刷新列表/权限，页末唯一项删除后回退一页。
- 页面 ESLint 与 Aims Nuxt typecheck 通过；浏览器删除专项、失败重试/引用错误、1440/390视觉仍待完成，不能宣称交互验收已通过。完整产品中心目标继续进行。

### 2026-09-08：模块删除页面浏览器验证

- Chrome 实际模块页配隔离有状态 mock：edit=false/delete=true 时显示删除而无创建/编辑/移动入口；打开删除弹窗，空原因禁用提交，填写后 Foundation danger 确认显示模块、不可撤销和引用阻止说明，确认期间原因/关闭禁用。
- mock 核验双修订/原因/幂等头，成功后更新其内存状态；页面刷新显示0条和空状态，两个弹窗关闭。临时 mock/dev 已清理。此为UI行为验证，不是实际JWT/BFF或生产数据验证；多页回退、失败重试、1440/390视觉及原计划剩余项仍未完成。
### 2026-09-08：正式产品目标迁移与指标计算基础

- v5.22 增加正式目标、目标与规划事项关联、不可变观测记录；保留指标口径快照与目标修订。隔离 MySQL 迁移测试通过，覆盖重复执行保留观测、跨产品关联拒绝、期间/方向约束以及观测修改/删除拒绝。
- 新增 ProductObjectiveMetric 校验与达成率计算，复用周期指标的十进制及文字边界校验，使用有理数计算 `(观测值-基线)/(目标值-基线)*100`，输出六位小数字符串。未知观测返回 null，退步可为负值，超额达成可超过100%；不读取任务完成率。提高/降低目标须有不同且方向一致的基线和目标，维持型目标暂未支持。
- 定向单元测试覆盖提高/降低、负值与超额、负数基线、接近 DECIMAL(20,6) 上限的微小差值、未知观测与非法输入。当前仅为领域基础；创建/更新/关联/观测命令、权限链路、页面和目标完整验收仍待完成，不能称目标管理已可用。

### 2026-09-08：正式产品目标创建领域命令

- 新增 CreateProductObjective，校验完整标题、期间、负责人、指标口径及基线/目标；负责人须为当前有效产品成员。使用产品根锁、统一 product_objectives:edit 授权、预期修订、审计和幂等回执事务，初始状态为 draft。十进制指标持久化及回执统一为六位小数字符串。
- 真实隔离 MySQL 目标迁移与创建测试、指标/输入单元测试通过：view 拒绝、审计失败回滚、成功创建和重放、过期修订拒绝、缺失/停用负责人拒绝，保存字段和根修订正确。期间非法日期/倒置、空标题、无效 UID 和修订校验覆盖。
- 当前校验产品成员有效性，尚未接入 Directory 活跃用户事实；Runtime/BFF/manifest/grant、目标读取/编辑/观测与页面尚待实现，未声称目标管理已完成。

### 2026-09-08：正式产品目标分页与详情领域读取

- 新增 ListProductObjectives/GetProductObjective，统一 product_objectives:view 授权与产品根锁，列表支持真实分页和 draft/active/closed/archived 筛选，按开始日期和 ID 降序稳定排序；返回产品修订及完整目标指标定义。日期使用 YYYY-MM-DD，DECIMAL 保留字符串，未知观测不在读取层伪造为0。
- 真实隔离 MySQL 目标专项测试通过，包括新读取、既有创建/迁移及指标校验：两页无重复或遗漏、状态筛选/空列表、跨产品详情不存在、错产品/资源 permit 拒绝、非法页码/大小/状态拒绝、日期与指标精度返回正确。
- 仍未接 Runtime/BFF/UI，观测录入与历史、目标修改/状态流转、规划事项关联及周期摘要映射待实现。

### 2026-09-08：产品目标 Runtime 与精确授权

- 接入 objectives:create/list/view Adapter，manifest 增加产品目标业务 view/edit 及服务 read/create，角色建议随已有模块权限补齐。列表/详情归入只读传输，创建保留写传输路径；Console 生成清单现为120业务 grant/126核验项。
- Runtime 边界测试通过（宽 scope、通配、错资源、错方法、非法授权、缺可信 actor 拒绝），读取传输测试通过；隔离 MySQL grant seed/verify 全场景通过。领域成功链路已有单独测试，未据此宣称 Adapter/JWT成功链路已验收。
- API/跨模块契约同步；BFF/UI、实际 Adapter/JWT、目标观测及完整生命周期仍待完成。未安装目标环境 grant。

### 2026-09-08：产品目标创建/读取 BFF

- 新增产品目标列表、详情、创建路由；输入白名单、真实日期、期间、必填口径与精确 BigInt 目标方向校验，可信 actor、产品 view/edit、专用服务 scope、15秒 permit 与写幂等复用既有 Foundation 链路。无本地 DB 回退，不可用返回503。
- 4项实际 BFF source/input 测试通过，覆盖写权限/可信身份/幂等、分页/路由身份、非法和越权请求不转发、服务不可用与上游冲突、超大精确小数。Aims Nuxt typecheck 通过；工具及三路由 ESLint 通过。
- API/模块合同同步；页面、实际 Adapter/JWT成功链路、观测及生命周期仍待完成。

### 2026-09-08：产品目标实际 Adapter 成功链路

- 新增 TestMySQLProductObjectivesThroughRuntime，通过真实 Adapter.HandleRuntime 创建目标、重放创建回执、状态筛选列表及详情读取；验证稳定身份、完整字段与精确指标、产品修订、回执计数。过期修订创建返回409，不存在目标返回404。
- 隔离 MySQL 定向测试通过。服务上下文由测试注入，不能替代实际 JWT/HTTP 授权验收；目标页面、观测录入、生命周期及关联仍待实现。

### 2026-09-08：目标指标观测领域命令

- 新增 CreateProductObjectiveObservation，要求独立 product_objectives:observe；产品根锁与产品/目标双修订，active/closed 目标允许观测，日期须在目标期间且不晚于当前 UTC 日期。保存实测十进制、证据、备注、目标修订与服务端指标快照，回执返回按快照计算的达成率。观测、产品修订、审计与回执事务提交，不修改目标定义修订。
- 隔离 MySQL 测试通过：edit不能观测、审计失败整体回滚、成功及幂等重放、双修订冲突、未来/期间外日期、draft状态拒绝，修改目标后旧观测快照保持原目标值。Manifest声明独立observe及产品经理建议授权。
- 仍为领域命令，Runtime/BFF/页面尚未接入；观测更正链、历史读取、目标状态流转及其他完整方案项待完成。

### 2026-09-08：目标状态流转领域命令

- 新增 TransitionProductObjective：draft→active、active→closed、closed→active、draft/closed→archived；不允许进行中直接归档或已归档重新开启。每个动作要求独立 activate/close/reopen/archive 权限，manifest与产品经理建议授权同步；产品/目标双修订、原因必填，启用/重开核对当前产品成员负责人及指标定义。
- 状态与目标/产品修订、前后快照审计、回执同事务提交。真实隔离 MySQL 验证编辑权限不能启用、审计失败回滚、启用→结束→重开→结束→归档全链路与各步幂等，完整状态矩阵单元测试通过。
- Runtime/BFF/UI状态入口待接入；目前目标状态命令和观测命令仅领域可调用，未宣称用户可用。

### 2026-09-08：目标观测及状态 Runtime 闭环

- 接入 observe/activate/close/reopen/archive，精确服务能力、独立对象动作权限，状态输入动作须匹配路由；目标修订/状态冲突映射409。manifest/grant/API/契约同步，总130业务grant/136核验项。
- Runtime边界测试及隔离grant全场景通过。实际 Adapter+MySQL 创建→启用→录入观测→结束测试通过，包含幂等重放、快照达成率、最终状态/修订、错误修订409、路由动作不符400及回执计数。
- 浏览器状态/观测BFF、页面、更正/历史读取仍待实现；服务上下文为测试注入，真实JWT/HTTP与目标授权安装未完成。

### 2026-09-08：目标状态与观测 BFF

- 五个动作路由接入，路由目标ID/动作、双修订与原因/观测字段白名单，独立observe/activate/close/reopen/archive权限、精确服务能力与幂等键。客户端不能覆盖目标身份、动作、指标快照或达成率；读路径继续不生成写幂等请求。
- 6项目标 BFF/input 测试、工具及五路由 ESLint、Aims Nuxt typecheck 通过。API及模块合同同步。目标页面、更正/历史读取和真实JWT/HTTP仍待实现或验收。

### 2026-09-08：目标观测历史领域读取与 Runtime

- 新增真实分页历史读取及 objectives:observations，复用目标view/read权限，返回证据、录入人/时间、原指标快照及按原口径计算的达成率。
- 隔离MySQL通过：先录入原目标观测，再修改目标并录入新观测，两页分别保持原16.666667%和新50.000000%，总数及产品修订正确；非法分页/资源权限拒绝。Runtime边界和只读传输测试通过。
- 仍待浏览器历史路由、页面、更正链及其他完整方案项；未据此宣称真实JWT或用户页面已验收。

### 2026-09-08：目标观测历史 BFF

- 接入观测历史GET路由、页码/大小白名单，目标ID来自路由，统一view/read授权，无写幂等。7项目标 BFF/input 测试及相关 ESLint 通过。
- 扩展路由后 Nuxt typecheck 在已有文档选择器触发TS2589/TS2345，已为部门文档请求显式提供固定路径泛型，保持原请求行为；复验结果见后续记录。页面、更正链及完整方案仍待完成。

类型复验补充：文档选择器四个请求、AimsDocumentPreview及useAimsInstanceConflictExplanation已显式指定路径泛型，相关ESLint通过。Nuxt typecheck仍未通过，最新终态错误为CompanyWeeklySummaryPanel.vue:156 TS2589及:163响应data推导失败；仍需继续收敛路由泛型，不得报告全应用类型检查通过。所有启动检查进程已取得终态。

### 2026-09-08：目标路由集合收敛，恢复类型检查

- 逐页显式fetch泛型并不能解决新增路由导致的默认Nitro路由联合类型深度问题。最终将目标详情及观测/状态子路由收敛为 `[...objectivePath].ts` 分发器，保留原URL和方法合同；创建/列表保留明确index路由。分发器严格验证目标ID、路径段、动作及方法，再传入可信路由ID，非法路径404/错方法405，未知动作不进入Runtime。
- 已撤回文档选择器、文档预览、职责冲突解释、公司周报、PIVR及portfolio的临时类型补丁，相关文件无本轮净改动。Nuxt全应用typecheck现已通过，目标工具/分发器ESLint通过。9项BFF/input/分发器源码测试通过，包括ID传递和错误请求不调用Runtime。
- 目标页面、更正链和完整方案其余项仍待完成；本条覆盖前述类型检查未通过状态，不代表用户功能已全部验收。

### 2026-09-08：目标页面权限快照

- 既有catch-all分发器接入GET permissions，拒绝查询字段，统一目标view后并行查询六个独立动作权限；各份产品/用户/状态/修订/成员事实须一致，否则409。不复制Foundation评估器，不回传actor，也不把编辑权限当作结束/观测权限。
- 12项目标 BFF/输入/分发器/权限快照测试、工具ESLint、Nuxt全应用typecheck通过。覆盖独立允许/拒绝、不可见、授权不可用、混合事实拒绝、无新增路由集合条目。
- 下一步目标页面创建/详情/观测历史和状态交互；页面与实际JWT尚未验收，完整方案目标继续。

### 2026-09-08：产品目标列表页面

- 产品空间增加目标入口，目标页按状态筛选、真实分页与刷新，显示标题、期间、说明、指标名称/单位、基线/目标值及测量口径。响应校验产品、分页、状态、修订与指标字段；加载/错误时不展示旧结果，不伪造达成率。
- 页面ESLint和Nuxt全应用typecheck通过。Chrome实际页面配隔离mock验证21条分两页、第二页仅第21条、从第二页筛选已结束后返回第1页和总数1，指标显示正确。临时mock/dev已清理。
- 这是列表浏览器行为证据，尚未完成1440/390截图视觉验收、真实JWT/HTTP、创建/详情/观测及状态页面交互，不代表完整目标管理可用。

### 2026-09-08：产品目标独立创建页

- 新增objectives/new独立页面，按目标信息/指标口径分组，使用共享UserTreeSelector选负责人，日期/数值/改善方向校验；数值保持字符串并用BigInt比较，未填全或无权限禁用提交。成功验证目标回执后返回列表，失败保留草稿及相同payload幂等键，保存期间锁定关闭/路由。
- 列表新增独立编辑权限创建入口，要求权限与列表产品修订一致，刷新同时更新列表和权限。两个页面ESLint、Nuxt全应用typecheck通过。
- 创建页面浏览器专项、失败重试与1440/390视觉仍待完成；负责人目录选择器可见范围较产品成员广，服务端成员校验仍为约束，尚未接Directory活跃用户事实。目标详情/观测交互及完整方案继续。

### 2026-09-08：目标创建浏览器专项与失败重试

- Chrome实际创建页配隔离mock：空表单禁用，选择共享UserTreeSelector产品经理甲，填写期间/口径与基线5/目标2，提高方向仍禁用，改降低后可提交。
- 首次POST模拟503，浏览器保留全部输入/负责人并显示错误；第二次POST mock严格比对原幂等键和请求体，成功回执通过页面校验后返回目标列表。返回列表mock为静态空数据，未据此宣称持久化刷新通过；领域/Adapter持久化已有独立测试。临时mock/dev已清理。
- 仍未完成1440/390截图视觉、真实JWT/HTTP、目标详情/状态/观测页面交互及完整方案其余项。

### 2026-09-08：目标详情及分页观测历史页面

- 新增objectives/{id}详情页与列表详情入口，展示目标期间/说明/指标定义及观测历史。每条记录展示实测、原基线/目标、原口径、达成率、证据与备注；无观测明确未知，支持负进展和超额达成。真实分页每页10条，错误/加载时隐藏旧结果，响应核对产品/目标/分页/字段。
- 列表与详情复用目标类型/响应校验utility，ESLint和Nuxt全应用typecheck通过。详情浏览器联动/历史分页及1440/390视觉仍待验收；负责人姓名/录入人时间显示、状态与观测录入页面动作、更正及完整方案其余项待补齐。

### 2026-09-08：目标详情状态操作

- 新增ObjectiveTransitions组件，目标状态与独立权限共同控制启用/结束/重开/归档按钮，权限产品修订须与详情一致。弹窗冻结目标/产品修订并要求原因，统一Foundation确认说明状态后果（归档danger），写请求幂等保留，验证目标身份/状态/双新修订后通知详情刷新。
- 保存期间父详情路由受busy保护；同页面目标变化按产品/目标key重建组件。组件及详情ESLint、Nuxt全应用typecheck通过。
- 状态操作浏览器专项、失败重试与1440/390视觉待验证；观测录入页面、更正链、目标编辑/规划关联及完整方案其余项继续。

### 2026-09-08：目标详情观测录入交互

- 目标操作组件重命名ObjectiveActions并加入独立observe动作；active/closed且有观测权限才显示。四字段弹窗录入日期、实测、证据、备注，显示冻结目标指标基线/目标；不提交达成率或指标快照。日期/数值格式/证据必填校验，统一确认展示观测与影响，复用双修订/幂等/保存中保护。
- 返回校验观测ID/biz_id、产品/目标、目标修订/日期与产品新修订后刷新详情和历史；状态操作仍保持原规则。组件及详情ESLint、Nuxt全应用typecheck通过。
- 状态/观测操作浏览器专项、失败重试、1440/390视觉仍待完成；更正链、目标编辑/规划关联及原方案剩余范围继续。

### 2026-09-08：目标启用与观测浏览器联动

- Chrome实际详情配有状态隔离mock，草稿仅显示启用/归档，无观测；启用原因空时禁用继续，填写后Foundation确认显示对象、影响及原因，确认期间表单/刷新禁用。成功后详情显示进行中，动作更新为录入观测/结束。
- 观测空表单禁用，填写日期2026-09-01、实测4.5及证据后确认显示冻结口径/实测/证据。mock核对双修订/幂等与业务字段，保存后详情历史显示1条、实测4.500000%、原基线5/目标2、达成率16.666667%及证据。临时mock/dev已清理。
- 该证据为UI联动，非真实JWT/BFF/生产数据；结束/重开/归档浏览器、失败重试、历史跨页与1440/390视觉仍待验收，更正链及整体剩余项继续。

### 2026-09-08：目标观测更正链迁移

- 新增v5.23与canonical schema同步：nullable correction_of_id/correction_reason、自引用同目标/产品FK、每条原记录最多一个直接更正的唯一键，以及更正原因配对约束。已有观测保持不变，现有不可变trigger继续保护原记录与更正记录。
- 真实隔离MySQL测试通过：重复迁移保留三条记录、跨目标更正拒绝、缺失/孤立原因拒绝、并行更正分支拒绝、串行再次更正可写、原始记录删除及更正覆盖拒绝。
- 当前仅schema基础，领域命令仍需核对被更正记录、冻结原口径、校验历史叶节点并在历史读取标注被更正；Runtime/BFF/UI更正入口未接入，不代表更正功能已完成。

### 2026-09-08：目标观测更正领域命令

- 观测命令增加可选更正ID/原因，验证同目标原记录与链尾，冻结原指标口径/目标修订/日期；新实测值按原口径计算，当前产品/目标双修订仍校验，复用observe权限和事务/审计/幂等。更正分支冲突映射409。
- 真实隔离MySQL通过：当前目标值改变后更正仍返回原目标2、原修订1及33.333333%；审计失败无残留更正，成功重放、分支拒绝、改日期拒绝、再次更正成功，原实测4.500000保持不变。
- Runtime结构解码可接收字段，浏览器BFF/UI更正字段与历史标注尚待实现，完整方案未完成。

### 2026-09-08：观测更正链读取与页面标识

- 历史读取增加correction_of_id/correction_reason/superseded_by_id，要求v5.23；同产品/目标相关查询返回直接后继，全部不可变记录仍保留真实分页。详情校验新增字段，显示已被更正/未被更正、更正记录和原因，避免把历史替代记录当作有效结果。
- 真实MySQL验证三节点链的前后关联和叶节点原指标快照；实际Adapter新增观测历史成功返回测试通过。详情ESLint、Nuxt全应用typecheck通过。
- 更正标识浏览器与更正表单尚待实现/验证，观测更正BFF输入仍待接入，完整方案目标继续。

### 2026-09-08：观测更正 BFF 与 Adapter 验证

- 观测BFF支持配对可选correctionOfId/correctionReason，拒绝缺失原因、null/非正/字符串ID及客户端口径/历史修订覆盖。复用observe独立权限、精确capability和幂等。
- 13项BFF/权限/分发器测试、输入工具ESLint通过。实际Adapter+MySQL验证目标结束后更正原观测，回执保持原修订2并返回33.333333%，重复请求重放，分支冲突409，分页历史更正前后关联正确，回执计数5。
- 更正表单/浏览器、1440/390视觉、真实JWT及完整方案其他项仍待完成。

### 2026-09-08：历史观测更正入口与表单

- 详情未被更正记录增加更正入口，由目标操作组件独立observe权限控制；按当前目标身份/状态和链尾再次检查。表单冻结原记录，回填实测/证据/备注，原日期只读，原指标口径展示，更正原因必填。
- 提交配对correctionOfId/correctionReason，仍使用当前产品/目标双修订；确认明确保留原口径与历史，回执校验原观测修订与更正目标ID后刷新历史。共享观测view类型替代页面内重复类型。组件暴露方法移至await之前以满足Vue约束。
- 相关ESLint、Nuxt全应用typecheck通过。更正浏览器/失败重试/1440与390视觉仍待验证；目标编辑、事项关联与完整方案其余范围继续。

### 2026-09-08：观测更正浏览器闭环

- Chrome实际详情配有状态mock，当前目标值1/修订3，原观测目标值2/修订2。更正入口打开后回填原日期、实测4.5、证据和原目标2，原因空禁用继续；修改实测4并填写原因，Foundation确认明确保留原口径/原记录。
- mock核对当前双修订7/3、原记录ID10/日期、更正原因及幂等头；回执返回原指标修订2，页面正常接受并刷新。历史显示新增更正4/33.333333%与原记录4.5/16.666667%，原记录标为已被更正且无更正入口，新链尾保留入口。保存成功提示改为观测更正已保存。临时mock/dev已清理。
- 仍为隔离UI证据，未替代真实JWT/BFF、失败重试、历史跨页、1440/390视觉或完整方案其他项。

### 2026-09-08：目标编辑领域命令与 Runtime

- 目标编辑支持标题、说明、期间、负责人和指标定义，要求当前产品与目标双修订、有效产品成员负责人及变更原因；仅草稿/进行中可编辑。事务内递增修订并保存变更前后审计快照，历史观测不参与更新。
- Runtime 新增 objectives:edit，要求独立 aims:product-objectives:edit 服务能力与 product_objectives/edit 业务授权。manifest、生成器及 Console seed/verify 同步，当前132条业务grant、138项验证要求。
- 真实隔离MySQL目标编辑原子性测试通过，包含审计失败回滚、成功重放、双修订冲突、无效负责人及关闭状态拒绝；Runtime边界测试和真实MySQL生成授权脚本验证通过。
- 编辑BFF、页面及实际Adapter成功链路仍待补齐，本项未作为完整可用编辑功能验收。全方案其余范围仍继续。

### 2026-09-08：目标编辑 BFF

- 现有目标 catch-all 分发新增 POST {id}/edit，复用创建字段校验，增加目标修订与必填原因；目标 ID 只取路由，拒绝 body 身份/状态覆盖。沿用精确 edit 服务能力、业务授权、幂等与当前可信操作者。
- 14项目标BFF/权限测试、输入工具ESLint及Nuxt全应用typecheck通过。直接Node执行因扩展名解析失败，改用现有tsx执行器获得上述测试结果。
- Orca已启动Claude Haiku只读审查目标编辑领域命令与测试，输出 /tmp/hzy-objective-edit-claude-review.txt；结果尚待复核。编辑表单、实际Adapter成功链路和全方案剩余项继续。

### 2026-09-08：Claude 审查复核与编辑历史不变验证

- Orca Claude Haiku只读审查正常退出，终端已关闭。采纳其“已有观测后编辑指标缺少专项测试”的发现；其他两项不成立：objective和objective_observation审计对象不同，各自修订独立，幂等重放读取command_receipts而非审计revision；产品/目标冲突已有不同错误码。
- 实际Adapter+隔离MySQL测试新增：已有原观测与更正后重开目标，通过objectives:edit修改标题和目标值2→1，校验身份不变、目标/产品修订5/8、成功幂等重放、旧修订409。再次读取全部历史，与编辑前逐字段相等，原口径和达成率未改变。7条成功回执计数正确，专项测试通过。
- 此测试使用注入的服务上下文，不替代真实JWT验收；编辑表单及完整方案剩余项继续。

### 2026-09-08：目标编辑弹窗与共用字段

- 创建页字段提取为ObjectiveFields，创建/编辑共用目标信息与指标口径；创建草稿改用ref以支持组件双向绑定。
- 详情ObjectiveActions按独立edit权限、同产品修订和draft/active状态显示编辑入口；ObjectiveEdit打开时冻结目标及产品修订，回填全部字段，要求原因，统一Foundation确认提示历史口径保留。精确编辑BFF提交双修订及幂等头，失败保留草稿，成功校验身份/状态/修订并刷新详情。保存期间禁用关闭并向父页面传播busy。
- 相关四个Vue文件ESLint与Nuxt全应用typecheck通过；首次类型检查发现ConfirmOptions属性名错误，已改为现有tone并重跑通过。浏览器编辑/失败重试及抽取后的创建页面回归尚待验证，未作为UI验收完成。

### 2026-09-08：目标编辑浏览器失败重试闭环

- Chrome实际详情页使用QA-EDIT隔离状态mock：active目标、仅edit权限，显示编辑入口；全部字段回填，原因空时保存禁用。修改标题与目标2→1、填写原因后，Foundation确认显示指标/原因及历史口径保留，确认期间表单/关闭/刷新禁用。
- 首次POST模拟503，页面显示实际错误且标题/目标/原因/负责人等草稿保留。第二次POST由mock严格校验同幂等键、同payload及原双修订7/3，通过后详情刷新为新标题/目标1，历史仍目标2/16.666667%，成功提示显示。
- 验证为真实Vue页面+隔离mock，不代表真实JWT/BFF联调或1440/390视觉验收。临时mock已删除，dev已停止。共享字段抽取后的创建完整提交回归、其它原方案剩余项继续。

### 2026-09-08：目标与规划事项关联领域命令

- 新增LinkProductObjectiveItem，使用目标edit授权、产品/目标/事项三方修订，支持新增关联、更新贡献说明、解除关联；贡献说明与变更原因独立记录。仅draft/active目标可操作，取消/合并事项不能新增关联，解除仍可清理已有关系。同产品锁定查询及既有复合FK保护边界。
- 目标与产品修订递增，规划评分/状态/修订及观测不修改；审计记录关联前后状态，命令回执与关联变更保持事务原子性。
- 真实隔离MySQL专项验证审计失败无残留、成功重放、三方修订冲突、贡献说明更新、解除、跨产品事项拒绝和取消事项拒绝；Runtime/BFF、关联读取及页面尚待接入。

### 2026-09-08：目标关联事项分页读取

- 新增ListProductObjectiveItems，目标view授权和同产品目标存在性校验后，真实分页返回关联事项ID/biz_id、标题、生命周期、当前事项修订、贡献说明、关联创建者/时间，以及当前目标/产品修订。关联按创建时间及事项ID倒序。
- Runtime新增objectives:items，要求精确product-objectives:read，传输层登记为只读动作。真实隔离MySQL测试覆盖关联记录读取、第二页空集且总数保留、无效页、错误资源permit及跨产品目标拒绝；Runtime边界和服务只读分类测试通过。
- 关联写入Runtime、BFF和页面仍待接入，创建页面回归、正式目标与周期映射及完整方案其余项继续。

### 2026-09-08：目标关联读写接口与权限

- Runtime新增objectives:item-link，精确服务动作在manifest、授权生成器及Console seed/verify中同步；当前134条业务grant与140项验证要求。业务沿用目标edit，独立于服务能力。
- BFF catch-all新增GET {id}/items与POST {id}/item-link；读分页复用目标分页输入，写白名单校验三方修订、事项ID、remove布尔值及配对贡献说明/原因，目标ID由路由绑定。
- Runtime边界、15项BFF/权限测试、相关ESLint、全应用Nuxt typecheck及真实隔离MySQL授权脚本验证通过。关联实际Adapter成功链路、详情关联UI与全方案剩余项继续。

### 2026-09-08：关联实际Adapter闭环与详情列表

- 实际Adapter+隔离MySQL新增关联命令和读取全流程，校验目标/产品修订、规划ID与贡献说明；重复请求同回执、事项旧修订409、更新贡献说明、解除后空列表及最终10条成功回执均通过，事项本身revision保持1。
- 目标详情新增ObjectiveItems组件，独立真实分页、加载/失败/空状态、响应同产品/目标及修订校验；展示事项标题/生命周期/贡献说明，按稳定biz_id跳转已有规划事项详情，保存中禁用刷新/分页/跳转。说明事项交付状态不等同于目标达成率。
- 两个Vue文件ESLint通过；浏览器关联展示、多页及UI新增/编辑/解除入口尚待完成，实际JWT和完整方案其他范围继续。

### 2026-09-08：关联贡献说明编辑与解除UI

- ObjectiveItems按目标edit权限、active产品、draft/active目标以及列表/权限/详情同产品修订显示操作；取消/合并事项只允许解除。列表增加修改贡献说明、解除关联按钮，弹窗冻结事项/目标/产品三方修订，原因必填，解除不提交贡献说明。
- Foundation确认明确作用事项、贡献说明或解除影响及原因，解除使用danger；保存期间禁止关闭并传播busy保护详情路由/刷新，失败保留输入及幂等键，回执逐项验证后刷新父详情和关联列表。
- 相关ESLint和Nuxt全应用typecheck通过。新增关联事项选择器、浏览器贡献说明/解除交互及完整方案其他项继续。

### 2026-09-08：新增关联事项选择器

- 新增ObjectiveItemPicker，调用既有同产品planning-items API（复用其独立规划读取授权），关键词防抖搜索、状态筛选proposed/in_delivery/delivered、每页10条真实分页，校验ID/biz_id/产品/修订/状态与返回总数，提供加载/错误/空状态。
- 目标关联列表增加关联入口，选择事项后复用贡献说明/原因表单和三方修订命令；已关联当前页事项回填说明，其余选择明确提示若已有关系将更新贡献说明。取消/合并事项不列为新关联候选。
- 两个组件ESLint与全应用Nuxt typecheck通过；浏览器新增/修改/解除、搜索分页及权限失败交互仍待验证，完整方案范围保持不变。

### 2026-09-08：关联新增/贡献说明/解除浏览器闭环

- Chrome真实详情以QA-LINK隔离mock运行：初始无关联，选择器展示同产品待规划事项；选择后贡献说明/原因空禁用继续，填写并Foundation确认后列表显示事项稳定biz_id链接、状态及说明。
- 编辑说明后列表刷新为新内容；解除弹窗仅原因必填，确认明确保留事项和观测历史，确认期间表单/关闭/关联分页/刷新禁用。解除后关联总数0且空状态恢复，目标指标与观测未知状态未变化。
- 三次mock写入校验目标、事项ID和三方当前修订及幂等头，跨组件刷新后后续动作正常。临时mock与dev已清理。该证据不替代真实JWT/BFF；搜索/筛选/跨页、失败重试、1440/390视觉及全方案其他项仍待完成。

### 2026-09-08：正式目标与规划周期映射schema

- 新增v5.24并同步canonical schema：product_objective_cycles保存同产品目标/周期ID、双方修订及完整JSON快照、映射说明和创建信息。每目标/周期最多一条有效映射；解除记录撤销人/时间/原因，允许后续新增映射，旧快照永久保留。
- 复合FK保护同产品，触发器禁止改写映射原字段、已撤销记录及删除历史；撤销字段必须完整配对。
- 真实隔离MySQL专项通过：跨产品映射拒绝、有效重复拒绝、快照修改拒绝、无原因撤销拒绝、成功撤销/不可反转、重新关联、不可删除及重复迁移保留2条原摘要快照。
- 仅schema与迁移验证完成；领域命令负责填充真实周期/目标定义、授权与事务，Runtime/BFF/UI和全方案其他项仍待完成。未应用目标业务库。

### 2026-09-08：周期映射领域命令

- 新增MapProductObjectiveCycle，目标edit授权、active产品及draft/active目标，检查产品/目标/周期三方修订；从同产品数据库行生成目标完整记录与周期记录快照，保留摘要、指标定义、基线/目标、预算与评分模型快照。映射原因必填，重复有效映射返回领域冲突。
- 映射插入、目标及产品修订递增、映射审计和命令回执同事务；周期事实本身不更新，允许已有closed周期映射以追溯原摘要。映射快照记录创建前定义修订，命令回执另外提供更新后的目标/产品修订。
- 真实隔离MySQL测试通过：view拒绝、审计失败回滚、成功重放、三方修订冲突、有效重复拒绝、目标快照等于原记录、后续周期摘要修改不影响原映射摘要。撤销命令、读取与Runtime/BFF/UI仍待接入，全方案未完成。

### 2026-09-08：周期映射撤销领域命令

- 新增RevokeProductObjectiveCycle，目标edit授权及当前目标/产品双修订，映射ID须属于当前同产品目标；仅draft/active目标可操作，已撤销映射拒绝再次撤销。写入撤销人/时间/原因，原目标及周期快照不改写，映射审计/目标与产品修订/幂等回执同事务。
- 真实隔离MySQL映射全流程扩展撤销：view拒绝、审计失败回滚、成功重放、双修订冲突、再次撤销冲突、撤销原因/操作者与原摘要保留、重新映射后2条历史。首次发现NullTime依赖驱动日期解析，改为SELECT revoked_at IS NOT NULL后重跑。
- 撤销及映射读取Runtime/BFF/UI尚待接入，完整方案继续。

### 2026-09-08：周期映射历史分页读取

- 新增ListProductObjectiveCycles，目标view授权、同产品目标存在性校验，按映射ID倒序真实分页返回有效/已撤销记录。每条包含双方保存修订、类型化快照、映射说明/创建人时间及撤销人时间原因；页面另含当前目标/产品修订。
- 读取核对快照ID/产品/修订与映射字段一致，无法解码或身份不一致返回错误，不替换为当前定义。
- 真实隔离MySQL全流程测试增加两页历史：第一页新映射保存新摘要与周期修订2；第二页原映射保留原摘要、原目标快照及撤销原因；总数与当前修订正确，无效页和错误资源permit拒绝。接口与页面仍待接入，完整方案继续。

### 2026-09-08：周期映射Runtime及精确服务权限

- Runtime接入objectives:cycle-map/cycle-revoke/cycles，写分别要求同名精确服务能力，历史读取使用product-objectives:read并登记为只读传输。有效映射重复或已撤销冲突映射409。
- manifest、授权生成器及Console seed/verify同步，当前138条业务grant、144项验证要求。真实隔离MySQL授权脚本测试、Runtime动作边界与服务只读分类测试通过。
- BFF、实际Adapter映射成功链路及页面仍待接入，完整方案其他范围继续；未安装到目标业务环境。

### 2026-09-08：周期映射BFF与实际Adapter联调

- BFF catch-all新增cycles/cycle-map/cycle-revoke，绑定路由目标ID，写白名单校验相应修订/周期或映射ID/原因，拒绝客户端快照，使用目标edit及精确同名服务能力；历史分页使用view/read。
- 16项BFF/权限测试、相关ESLint、Nuxt全应用typecheck通过。实际Adapter+隔离MySQL新增映射/撤销/读取成功链路及幂等、有效重复409、原摘要读取和撤销原因/当前修订核对，12条成功回执计数正确。
- API文档与跨模块契约已补充。仍为注入服务上下文的Adapter测试，非真实JWT验收；页面映射入口和完整方案其他范围继续。

### 2026-09-08：周期映射详情与选择器集成

- ObjectiveCycles接入目标详情，真实分页显示有效/已撤销映射、周期原摘要、原目标指标和原因；校验快照身份/修订与记录一致，当前权限及列表/详情同产品修订控制操作。建立/撤销弹窗冻结修订、原因必填、Foundation确认、幂等重试和保存期间路由保护，成功刷新父详情。
- Orca Claude Haiku完成ObjectiveCyclePicker独立文件，实现周期搜索/状态/分页与选择事件；其执行lint未获工具许可，由主代理接手，无需用户追加批准。主代理修正USelect全部筛选的空字符串值、unknown响应收窄/重复ID及状态/日期校验、状态中文显示；已关闭完成终端。
- 三个Vue文件ESLint通过；浏览器搜索分页、建立/撤销/历史、失败重试和1440/390视觉仍待验证，完整方案继续。

### 2026-09-08：周期映射浏览器建立与撤销

- Chrome真实详情配QA-CYCLE-MAP隔离mock：空映射→打开周期选择器，全部筛选正常展示周期标题/期间/中文状态/原摘要；选择后填写原因，Foundation确认提交，mock核对产品/目标/周期修订与周期ID/幂等头。
- 建立后详情显示有效映射、原摘要、原目标指标及映射说明；再次操作撤销时当前修订已更新，mock校验通过。撤销后记录保留，标记已撤销、显示原快照及撤销原因，无再次撤销按钮，总数仍1。
- 临时mock/dev已清理。该证据为UI主流程，非真实JWT/BFF；搜索/筛选/多页、失败重试、1440/390视觉、创建页共享字段回归及完整方案其它范围仍待完成。

### 2026-09-08：目标阶段后端整体回归与迁移链修复

- 执行productcenter及aims两组完整Go测试（真实隔离MySQL）。首次canonical/incremental schema一致性失败：对照测试的增量链停在v5.21，canonical已包含v5.22–v5.24。
- 仅修复该一致性测试的完整增量链，加入目标/观测更正/周期映射迁移，保留老版本专项测试的共享fixture起点。专项schema签名验证通过（字段、索引、FK、CHECK与trigger均比较）。
- 两组完整测试重跑均通过：productcenter 31.063s、aims 2.169s，日志 /tmp/hzy-product-center-regression-20260908.log。此证据不替代真实JWT、UI视觉、两个产品试点等验收门禁。
- 核对PC-14范围：季度时间窗口、探索/承诺基线、跨产品依赖、模型版本配置与受众保存视图，继续扩展既有planning_items并保留首批决定队列及模型历史；尚未开始宣称此批次实现完成。

### 2026-09-08：PC-14规划事项探索时间窗口schema

- 新增v5.25并同步canonical schema，在既有product_planning_items增加nullable roadmap_starts_on/roadmap_ends_on和同产品日期索引。CHECK要求两端同时为空或同时填写且结束不早于开始；季度按日期派生，不维护第二套季度/排序字段。
- 窗口表达探索安排，不等同正式承诺；保留既有deadline、决策队列、评分模型及版本范围。正式commit与不可变基线后续独立实现。
- 真实隔离MySQL专项验证旧行默认空、单端/倒序拒绝、跨年窗口保存、重复迁移保留窗口/原期限/修订、窗口清空；完整canonical/incremental字段/索引/约束/trigger对照通过。未应用业务数据库，编辑命令/API/UI仍待完成。

### 2026-09-08：探索时间窗口编辑领域命令

- 新增PlanningRoadmapWindow/EditPlanningRoadmapWindow，规范事项biz_id、日期成对/日历合法/跨年、双修订和原因校验，授权product_roadmaps/edit。仅active产品及proposed/in_delivery事项可修改；写入或清空窗口，并更新事项/产品修订、审计和幂等回执。
- 不修改deadline、scope/evidence修订、决定队列或评分历史；正式承诺基线尚待实现，当前命令仅操作探索窗口。
- 真实隔离MySQL与输入测试通过：view拒绝、审计失败回滚、成功重放、产品/事项修订冲突、窗口清空、范围/证据修订保留、已交付只读及无效日期/半窗口拒绝。Runtime/BFF、季度展示与正式承诺等完整范围继续。

### 2026-09-08：探索窗口读取

- 新增ReadPlanningRoadmapWindow，规范事项biz_id，product_roadmaps/view授权及同产品读取；返回窗口两端、事项身份/标题/生命周期、当前事项和产品修订。空窗口保持null，不按deadline或季度伪造安排。
- 真实隔离MySQL窗口全流程增加读取验证：编辑后跨年日期/双修订正确，错误资源permit拒绝，跨产品事项返回不存在，清空后两端null及修订3；专项通过。Runtime/BFF及季度视图等后续继续。

### 2026-09-08：探索窗口Runtime及服务授权

- Runtime新增roadmaps:window-view/window-edit，独立product-roadmaps/read与window-edit服务能力；读取登记为只读传输，写按product_roadmaps:window-edit命令调用既有窗口领域。产品经理建议权限补roadmaps/edit，业务授权仍由Foundation和产品范围计算。
- manifest、生成器及Console seed/verify同步，当前142条业务grant、148项验证要求；真实隔离MySQL授权脚本验证通过。新增Runtime动作边界和只读传输测试通过，接入时返回envelope签名错误已修复并重跑。
- 实际Adapter窗口成功链路、BFF/UI和季度/正式承诺等原方案范围继续，未写入业务环境。

### 2026-09-08：探索窗口BFF

- 新增单一路线catch-all，GET/PATCH roadmaps/windows/{itemBizId}严格分发；规范UUID路由、禁止query/未知字段，写要求原因、幂等头及双修订，日期须成对有效或明确双null清空。Foundation路线view/edit及精确Runtime能力转发可信操作者。
- BFF行为测试覆盖读写scope/身份、跨年窗口、清空、半窗口/日历/修订/客户端身份或承诺字段拒绝、404/405/403/503；相关ESLint、Nuxt全应用typecheck通过。接口文档Aims-Product-Roadmaps-API.md已建立。
- 实际Adapter窗口成功链路、页面/季度路线与正式承诺基线等完整范围继续。

### 2026-09-08：探索窗口实际Adapter及页面权限

- 新增窗口实际Adapter+隔离MySQL全流程测试：空窗口读取、跨年设置、同回执幂等重放、产品/事项旧修订409、明确清空与双修订3、两条成功回执计数；测试通过，服务上下文为注入，非JWT。
- BFF同一catch-all增加GET roadmaps/permissions，view准入并独立评估edit，核对产品/操作者/状态/修订/成员事实一致，不返回actor。3项BFF路由行为测试与2项实际权限helper测试通过，相关ESLint、Nuxt全应用typecheck通过。
- 页面编辑、季度路线图、正式承诺基线等原方案范围继续。

### 2026-09-08：探索窗口编辑页面与状态校验

- 规划事项详情增加探索时间窗口入口，新页面支持日期设置、修改及双空清除、变更原因、Foundation 确认、双修订提交和相同请求幂等重试；按路线编辑权限及产品/事项状态控制可编辑性。回执核对身份、日期和递增修订，成功刷新窗口及权限。
- 修复缓存读取时日期草稿未初始化，watch 使用 immediate；重新加载确认及请求期间锁定编辑、保存和路由切换，避免刷新与写入并发覆盖草稿。
- 两个页面 ESLint 及 Nuxt 全应用 typecheck 通过。跨模块路线窗口契约已补充。尚未完成本页面浏览器交互及视觉验证；季度视图、正式承诺基线和完整方案其余范围仍继续，未部署业务环境。

### 2026-09-08：探索窗口浏览器保存与清空验证

- Chrome 打开真实探索窗口页面，使用独立 QA-WINDOW mock；初始跨年日期正确填入，原因为空时禁止保存。修改开始日期并填写原因，确认弹窗呈现事项、双日期及原因，操作期间控件禁用。
- 首次 PATCH 模拟 503，页面显示错误且保留日期/原因；再次确认使用相同幂等键与完整请求（mock 严格核对）成功，刷新后保留新日期、清空原因。随后双日期清空提交成功，mock 检查当前双修订，页面为空并显示成功通知。
- 临时 mock 已移除，开发进程已停止。本次为真实页面+mock 的 DOM 交互验证，不替代真实 JWT/BFF、移动端视觉及全方案验收。

### 2026-09-08：季度路线图领域读取

- 新增 ReadQuarterRoadmap：指定同产品规划周期、年份和季度，按探索窗口与季度闭区间重叠筛选，或读取周期内未安排窗口的事项；结果沿用 decision_rank/id 顺序，不生成新优先级。返回日期、决定状态/分栏、当前事项及周期/队列/产品修订和真实分页计数。
- 同时要求 product_priorities/view 和 product_roadmaps/view；年份/季度、规范周期 UUID 和分页校验，周期按产品隔离查询。真实隔离 MySQL 专项通过：季度边界包含、跨年重叠、队列顺序、两页数据、未安排双空、错误资源权限及无效季度拒绝。
- 目前完成领域读取；Runtime/BFF、季度页面、正式承诺基线及完整方案其余范围仍待继续。

### 2026-09-08：季度路线 Runtime 接入与实际 Adapter 验证

- 新增 roadmaps:quarter-view，复用精确 product-roadmaps:read 服务能力，登记为只读传输；解码路线 view 与优先级 view 双 permit，交由领域校验同产品/操作者当前事实。未新增 grant。
- Runtime 边界及只读传输测试通过；实际 Adapter+隔离 MySQL 扩展跨年季度命中、非重叠季度为空、原窗口日期及产品修订验证，测试通过。使用注入可信服务上下文，非真实 JWT。
- API 合同已补充。浏览器 BFF、季度页面、正式承诺基线及完整方案其余范围继续。

### 2026-09-08：季度路线图浏览器 BFF

- 路线 catch-all 新增 GET quarter，严格校验周期 UUID、年份/季度、未安排标志及分页，未知 query/数组/非规范整数拒绝；仅 GET，不要求幂等键。
- Foundation 分别取得路线及优先级 view，核对两次产品/操作者/状态/修订/成员事实一致，向 quarter-view 传递两份 permit 及可信 actor；响应 no-store，服务不可用明确 503。
- 7 项路线 BFF/权限测试通过，涵盖双权限转发、第二权限拒绝、事实变化 409、筛选白名单和错误处理；相关 ESLint 与 Nuxt 全应用 typecheck 通过。API 合同已更新。季度页面、正式承诺基线和全方案其余范围继续。

### 2026-09-08：季度路线页面

- 周期事项页新增季度路线入口，页面支持年份/季度、未安排窗口筛选、真实分页、加载/错误/空状态，逐项显示原队列顺序、决定状态、近期分栏、范围及完整探索窗口，链接窗口查看/编辑页。
- 响应核对周期身份、筛选、分页、修订、记录唯一性、状态和日期；筛选变化回到第一页，非法年份显示提示。Nuxt 全应用 typecheck 通过。
- 页面浏览器交互与视觉尚未验证，正式承诺基线及全方案其余范围继续。

### 2026-09-08：季度路线浏览器筛选与分页

- Chrome 使用真实季度页面和独立 QA-QUARTER mock：21 项第一页显示 1–20，第二页仅第 21 项且下一页禁用；第二页切换未安排窗口后重置第一页，显示唯一未安排事项及双空日期描述，分页消失。
- 取消未安排后选择第四季度，显示该季度总数 0 和空状态；年份改为 999 时显示范围提示并隐藏旧季度结果。页面状态/分栏中文与窗口链接正确。
- 临时 mock 已清理，开发进程终止。两页面 ESLint 已通过（补充上一条记录）。本轮为 DOM 交互证据，非真实 JWT/BFF 联调及桌面/移动端视觉验收；正式承诺基线及完整方案其余范围继续。

### 2026-09-08：正式承诺基线 schema

- 新增 v5.26 product_roadmap_commitments，同步 canonical：保存同产品事项/周期、事项/范围/证据/周期/队列修订、日期、事项/决定/模型 JSON 对象快照以及确认人/时间/原因。历史 UPDATE/DELETE 由触发器拒绝，后续变更追加记录。
- 隔离 MySQL 专项验证快照插入、禁止改写/删除、倒序日期/非对象快照/跨产品引用拒绝、重复迁移保留快照；canonical 与完整增量链一致性测试一同执行。
- 仅数据结构；正式 commit 命令、多修订校验、历史读取/复评标志、API/UI 尚待实现，未应用业务环境，完整方案继续。

### 2026-09-08：承诺命令初步实现（未接入接口）

- 新增 CommitRoadmap，独立 product_roadmaps/commit 授权、产品/事项/周期/队列修订检查，仅 active 产品、open 周期及可编辑事项；要求已设置窗口、当前 selected 决定与范围/证据/模型/评估引用一致。服务端读取快照，承诺记录、根修订、审计和幂等回执同事务。
- 编译及命令身份/周期/修订输入边界测试通过。此为初步实现，尚未进行实际 MySQL 命令成功/回滚/重放验证，依赖与交付门禁复用、后继基线规则、历史复评读取仍需完善；未接入 Runtime/BFF/UI，不宣称正式承诺可用。完整方案继续。

### 2026-09-08：承诺命令复用交付门禁与事务验证

- CommitRoadmap 在写入前复用 ValidatePlanningDeliveryTx，补足当前评估有效性、决定范围/证据/模型、分类及最新投入与冻结投入一致性；保留独立 commit 授权及当前评估引用核对。
- 从真实创建周期、评估、预算例外和正式选入构造 MySQL 场景。专项测试通过：edit 不能代替 commit，审计失败回滚承诺行与根修订，成功幂等回执重放，新请求旧根修订拒绝，证据变化阻止新承诺且原基线保留。
- 依赖变化的承诺专用校验、后继/重复基线规则、历史复评读取及 Runtime/BFF/UI 仍需实现，完整方案继续。

### 2026-09-08：承诺后继与重复确认规则

- CommitRoadmap 增加 expected_previous_id，首次为 0，后续必须等于同产品事项最新基线 ID；根锁内检查，防止绕过未查看的新基线。当前事项/周期/队列修订均未变化时拒绝重复确认。
- 后继追加新行，在不可变事项快照及回执中保存 previous_commitment_id，原基线保持。实际 MySQL 命令测试新增遗漏最新基线拒绝、无变化拒绝、修改窗口后后继成功、前驱链接正确、证据变化时两条原历史均保留；专项通过。
- 依赖专用校验、历史/复评读取与 Runtime/BFF/UI 仍待实现，完整方案继续。

### 2026-09-08：承诺前置依赖校验

- 确认承诺时读取当前同产品直接前置事项，已交付视为满足，否则要求当前周期已选入且顺序在本事项之前；取消/合并或未选入/排后形成 dependency_unresolved。仅复用原决定中匹配该具体依赖且原因/责任人/影响完整的例外，不接受客户端新豁免。
- 承诺事项快照保存前置身份、修订、生命周期、选入状态与原顺序，供后续历史/复评比对。实际 MySQL 命令测试新增未解决依赖拒绝、前置交付后成功、依赖快照保存；专项通过。
- 跨产品依赖属于后续范围；历史复评读取、接口/页面继续，完整方案尚未完成。

### 2026-09-08：承诺历史分页领域读取

- 新增 ListRoadmapCommitments，路线/优先级 view 双权限、同产品事项身份校验，真实倒序分页返回原日期、各修订、事项/决定/模型快照及确认原因/人/时间。所有页均返回全量最新基线 ID 和当前产品/事项修订。
- 读取核对保存事项身份及修订与基线字段一致，不用当前定义替换历史。实际 MySQL 命令测试扩展两页历史：新窗口 4 月底、原窗口 3 月底、最新 ID 跨页一致、旧证据修订保持以及第二权限错误拒绝。
- 复评原因计算与 Runtime/BFF/UI 尚待接入，完整方案继续。

### 2026-09-08：承诺历史复评原因

- 历史读取增加 requires_review/review_reasons，逐条比较当前范围、证据、探索窗口、模型快照、选入决定/评估引用、队列及生命周期；仅派生提示，不撤销或改写承诺。
- 实际 MySQL 测试验证最新基线仅证据变化、不误报窗口/决定变化，旧基线同时提示窗口及证据变化，原始快照保持；专项通过。
- 依赖快照差异尚需加入复评计算，Runtime/BFF/UI 与完整方案其余范围继续。

### 2026-09-08：依赖快照复评差异

- 提取依赖事实读取供承诺校验与历史复评共用；历史读取只比较事实，不执行新的承诺门禁，因此依赖失效时仍能查看原承诺。
- 比较前置身份/修订/生命周期/选入状态/顺序，差异返回 dependencies_changed；缺少原依赖快照返回 dependency_snapshot_missing，不视作无依赖。
- 实际 MySQL 专项通过：未变化不误报、前置生命周期/修订变化及删除前置关系均提示复评。Runtime/BFF/UI 和完整方案其余范围继续。

### 2026-09-08：承诺历史 Runtime

- 新增 roadmaps:commitments，使用既有精确 product-roadmaps:read 能力和只读传输；input 为 biz_id/page/page_size，要求路线及优先级 view 双 permit，调用原历史分页领域读取。
- Runtime 边界与只读分类测试通过；实际 Adapter+隔离 MySQL 验证无承诺事项返回空数组、total/latest_id 为 0 及正确事项身份。已有两页历史/复评验证仍在领域测试，尚非端到端历史验收。
- 承诺写 Runtime、BFF/UI 及完整方案其余范围继续。

### 2026-09-08：承诺写入 Runtime 与服务授权

- 新增 roadmaps:commit，要求独立 aims:product-roadmaps:commit 服务能力，业务 permit 使用 product_roadmaps/commit，传递完整输入及幂等键至承诺命令；后继基线冲突/无变化映射 409。
- manifest、授权生成器及 Console seed/verify 同步；当前 144 条业务 grant、150 项验证要求。Runtime 边界测试及真实隔离 MySQL 授权脚本验证通过。
- 未安装目标环境授权，实际 Adapter 承诺成功链路与 BFF/UI 尚待接入验证，完整方案继续。

### 2026-09-08：承诺写 BFF

- 路线 catch-all 增加 POST commit/{itemBizId}，路由绑定事项，白名单校验四项修订、周期 UUID、必填非负上一基线 ID 和原因，必须幂等键；query、客户端快照/操作者等额外字段拒绝。
- 使用独立 product_roadmaps/commit Foundation 授权和精确 Runtime commit capability，保留可信 actor 与 no-store。6 项路线 Runtime BFF 测试、相关 ESLint 和 Nuxt 全应用 typecheck 通过。
- API 合同已更新；历史 BFF、页面及实际承诺 Adapter 成功链路仍待验证，全方案继续。

### 2026-09-08：承诺历史 BFF

- 新增 GET commitments/{itemBizId}，与季度读取复用双 view 权限及一致事实检查，规范路由 UUID 和分页白名单，转发 Runtime commitments，返回 no-store。
- 7 项路线 BFF 测试、相关 ESLint 和 Nuxt 全应用 typecheck 通过；新增测试核对路由身份、分页、无写幂等键、异常参数、第二权限拒绝及事实变化 409。
- API 合同已更新。承诺确认/历史页面、实际 Adapter 承诺写成功链路及完整方案其余范围继续。

### 2026-09-08：承诺页面权限快照

- 路线 permissions 增加独立 commit 能力，与 edit 分别核验；两动作的产品事实均须与 view 一致。页面可据此控制确认入口，实际写入仍重新授权。
- 权限测试增加 edit 有而 commit 无、commit 有而 edit 无及 commit 事实变化拒绝，结合路线 BFF 回归共 10 项通过，相关 ESLint 通过。承诺确认/历史页面与全方案其余范围继续。

### 2026-09-08：承诺历史页面

- 新增规划事项 commitments 页面及探索窗口页入口，真实分页展示最新/历史基线、原窗口/范围、确认原因/人/时间、中文复评原因及加载/错误/空状态；不自动撤销或改写历史。
- 响应核对事项/产品身份、分页、最新 ID、修订及复评标志与原因一致性。两页面 ESLint 通过，浏览器交互与视觉尚待验证；确认承诺页面和完整方案其余范围继续。

### 2026-09-08：承诺历史浏览器主流程

- Chrome 真实历史页面配 QA-HISTORY mock，21 条记录第一页显示最新窗口至 4 月底及证据复评，旧记录保留 3 月底和原原因，并显示窗口/依赖中文复评提示。
- 第二页仅第 1 条旧基线，仍标记历史基线，原日期/原因保留，下一页禁用。前后页未将最新日期覆盖历史。
- 临时 mock 清理、开发进程停止。补充上一条：全应用 typecheck 通过。本轮为 DOM 交互证据，非真实 JWT/BFF 或视觉验收；承诺确认页面及完整方案其余范围继续。

### 2026-09-08：承诺确认页面

- 新增周期事项 commit 页，季度路线已选入且有窗口事项提供入口。并行加载独立 commit 权限、周期、窗口及最新基线，核对产品/事项/周期身份与读取修订一致，显示当前安排和上一基线，链接完整历史。
- 原因必填、Foundation 确认、冻结四项修订和上一基线 ID、相同请求保留幂等键，回执核对身份/前驱/新根修订；失败保留原因，成功刷新。保存期间保护路由及刷新。两页 ESLint 通过。
- 浏览器成功/失败重试与视觉尚待验证，实际承诺写 Adapter 链路及完整方案其余范围继续。

### 2026-09-08：确认承诺浏览器提交与重试

- Chrome 真实确认页配 QA-COMMIT mock，首次基线/跨年窗口正确显示；原因空时不可提交，Foundation 弹窗显示事项、窗口、首次基线说明及原因，确认期间路由/刷新/输入禁用。
- mock 严格核对四项修订、周期、上一基线 0 与幂等键。首次模拟 503 后原因保留，再次提交使用完全相同请求和键成功；刷新后展示已保存的上一基线及原因，输入清空、成功通知出现。
- 临时 mock 清理、开发进程停止。补充上一条全应用 typecheck 通过。本轮为 DOM 主流程，非真实 JWT/BFF/Adapter 或视觉验收，完整方案继续。

### 2026-09-08：实际 Adapter 承诺写入链路

- 扩展真实 Adapter+隔离 MySQL：合法开放周期/容量、完整评估及已选入决定 fixture，通过 Runtime commit 保存、同请求幂等重放、commitments 读取新基线且无误报复评、旧前驱 ID 返回 409，成功回执共 3 条。
- 首次 fixture 未补开放周期容量触发数据库约束，补齐合法容量后专项通过。领域选入/审计回滚等另有命令测试；本次服务上下文仍为注入，非真实 JWT/目标环境验收。完整方案继续。

### 2026-09-08：路线与承诺阶段整体后端回归

- 使用隔离 MySQL 执行完整 productcenter 与 aims 两组 Go 测试（非仅专项），全部通过：32.527s / 2.479s。覆盖当前迁移链、领域及 Adapter 测试，不能替代真实 JWT、视觉和两个产品试点验收。
- MODULE_CONTRACTS 更新探索窗口权限说明，补充季度/历史双权限与正式 commit 合同、不可变后继基线及事务边界。
- PC-14 尚有跨产品依赖、模型版本配置、受众与保存视图；PC-15～18 及先前未验收范围仍保留，未将路线/承诺主流程通过视作整套方案完成。

### 2026-09-08：跨产品依赖数据结构

- 新增 v5.27 product_cross_dependencies，源/前置分别记录产品与事项并有组合外键，禁止同产品/自身及重复边，保存原因、修订和操作者。保留既有同产品依赖表与规划事项实体。
- 增加依赖图单行锁表，供后续跨产品和同产品写命令共同串行化环路检查；目前尚未接入命令，不宣称已解决并发环路。
- 隔离 MySQL 专项验证合法跨产品边、重复/自身/伪造产品归属拒绝、单锁约束、重复迁移保留边与锁修订；canonical/增量完整链一致性一同验证。领域授权/环路/命令/读取及 UI 仍待实现，未应用业务环境，全方案继续。

### 2026-09-08：统一依赖图读取与环路基础

- 新增统一图读取，同产品与跨产品边合并，以租户库全局事项 ID 标识节点；限制节点/边数量，超限或悬挂端点明确拒绝，不按截断图判断。新增全局图锁读取 helper，约定先图锁后产品锁。
- 隔离 MySQL 专项验证单向跨产品图通过，以及包含同产品边的 A→B→A 事项链闭环被既有 DFS 校验拒绝；图锁修订读取正确。
- 当前为内部基础函数，尚未接入所有依赖写入口，不能宣称并发环路防护完成；跨产品领域命令/双方权限与接口页面继续，全方案保持。

### 2026-09-08：跨产品依赖授权与锁顺序入口

- 核对 ExecuteCommand：授权回调早于回执锁，可在回调中先取得图锁，再按产品编码固定顺序取得双方产品锁。新增内部授权入口，源产品 priorities/edit、前置产品 priorities/view，均绑定同一可信操作者，禁止同产品使用此入口。
- 隔离 MySQL 验证双方授权通过、前置错误资源 permit 拒绝，与统一图专项一同通过。当前仅内部入口，跨产品命令及既有同产品写入口仍需接入，未宣称并发防护完成。全方案继续。

### 2026-09-08：跨产品依赖创建领域命令

- 新增 CreateCrossDependency，源 edit/前置 view 双授权、先图锁后固定产品锁、双方产品/事项修订及生命周期检查；已有选入/执行事项须影响说明，统一图校验重复及环路。
- 新边、源事项范围/事项修订、源产品修订、图修订、审计和幂等回执同事务；不修改前置产品事实。实际 MySQL 专项验证审计失败回滚边、成功幂等重放、旧修订拒绝、重复边拒绝及前置事项未变化。
- 同产品依赖写入口尚未接入图锁，因此跨产品命令尚不对外开放；并发/反向环路专项、读取/移除、Runtime/BFF/UI 与全方案其余范围继续。

### 2026-09-08：同产品依赖写入口统一图锁

- EditPlanningDependencies 在授权回调中先取得图锁再取得产品锁；修改后以同一事务完整统一图校验，失败回滚，成功递增图修订。既有同产品约束和范围/审计语义保留；此写入口现在要求 v5.27 迁移。
- 同产品专项 fixture 显式补 v5.27，不扩大旧版本共享 fixture。MySQL 同产品及跨产品创建专项通过，新增 A→B→C 跨产品链后同产品 C→A 命令被拒绝且插入边回滚。
- 仍需并发对向创建专项、跨产品读取/删除及 Runtime/BFF/UI，完整方案继续。

### 2026-09-08：并发对向跨产品依赖验证

- 新增真实 MySQL 并发专项：两端各持初始权限/修订，同时启动 A→B 与 B→A 命令，10 秒上下文期限内完成；仅一条成功，另一条因产品授权事实变化拒绝，数据库仅一条边。
- 对失败方重新读取双方权限与当前修订再提交，明确返回 planning_dependency_cycle。专项通过，未发生死锁或双向边落库。
- 跨产品读取/移除、交付与承诺跨产品依赖整合、Runtime/BFF/UI 及完整方案其余范围继续。

### 2026-09-08：跨产品依赖移除命令

- 新增 RemoveCrossDependency，沿用双方权限和图锁顺序，校验双方产品/事项修订及依赖 UUID/修订；源须可编辑，允许前置事项已结束，保留影响说明要求。删除边与源范围/事项/产品、图修订及审计/回执同事务，审计保存前置身份、原原因与修订。
- 实际 MySQL 创建专项扩展移除：审计失败边保留，成功后边不存在，同请求回执重放；测试通过。跨产品读取、交付门禁整合及接口页面继续，全方案未完成。

### 2026-09-08：跨产品依赖详情读取

- 新增 ReadCrossDependency，规范依赖 ID，图锁后按固定顺序验证两端 priorities/view；查询严格绑定双方产品归属，返回两端事项标题/身份/修订、前置状态、依赖原因/修订与创建信息及双方当前产品修订。
- 实际 MySQL 创建专项扩展详情身份/修订/原因正确及前置产品错误权限拒绝，测试通过。当前需明确两端产品，列表发现与权限过滤、交付门禁整合和 Runtime/BFF/UI 继续，全方案未完成。

### 2026-09-08：跨产品依赖可见范围分页

- 新增 ListCrossDependencies，源产品 view 及最多 100 个前置产品 view permit 均重新核验，按固定顺序锁定产品事实；只在已授权前置范围内计数和分页，空可见范围返回空集合，不泄露隐藏总数。
- 实际 MySQL 专项验证授权范围内一条记录、空范围不泄露已有依赖、第二页为空但授权 total 保持；测试通过。目标产品发现/权限收集、交付门禁及 Runtime/BFF/UI 仍需接入，全方案继续。

### 2026-09-08：跨产品依赖读取 Runtime

- 新增 cross-dependencies:list/view，复用精确 aims:product-priorities:read，登记只读传输；列表解码源及可见前置产品 permit 集合，详情解码双方 permit，可信 actor 由服务上下文取得。领域仍逐项核验权限与归属。
- Runtime 能力/方法/身份边界与只读传输分类测试通过，未新增 grant。实际 Adapter 读取链路、创建/移除 Runtime、BFF/UI 和交付整合仍待继续，全方案未完成。

### 2026-09-08：跨产品依赖写 Runtime 与授权

- 新增 cross-dependencies:create/remove，分别要求 aims:product-priorities:cross-dependency-create/remove 精确能力，解码双方 permit、输入及幂等键调用领域命令；依赖修订冲突映射 409。
- manifest、生成器及 Console seed/verify 同步，当前 148 条业务 grant / 154 项验证要求。Runtime 边界及实际隔离 MySQL 授权脚本验证通过，未安装目标环境。
- 实际 Adapter 成功链路、BFF/UI、跨产品交付依赖整合及完整方案其余范围继续。

### 2026-09-08：跨产品浏览器写入参数校验

- 新增共享 create/remove 输入解析，源事项和移除边由路由绑定，前置产品规范校验、双方四项正整数修订、移除边修订、原因/影响说明白名单；拒绝身份/授权覆盖、同产品、自依赖和无效字符。
- 两项输入专项测试及 ESLint 通过。当前解析器尚待 BFF 调用，不代表浏览器写链路已接通；实际 Adapter 链路、权限收集、页面及全方案其余范围继续。

### 2026-09-08：跨产品创建/移除 BFF

- 新增跨产品 catch-all，POST items/{item}/及 items/{item}/{edge}/remove，复用严格输入校验与幂等键；源 edit/前置 view 分别核验，同一可信 actor，经精确服务能力转发双方 permit。
- 4 项输入/BFF 测试、相关 ESLint 和全应用 typecheck 通过，涵盖双方授权、能力/路由绑定、前置拒绝、身份变化及服务不可用。新增跨产品 API 合同文档。
- 浏览器读取/权限发现/页面、实际 Adapter 成功链路及跨产品交付门禁继续，全方案未完成。

### 2026-09-08：跨产品依赖详情 BFF

- 新增 GET edges/{dependencyBizId}，仅接收 predecessorProductCode；路由规范 UUID，双方 priorities/view 独立核验和 actor 一致，转发精确 read 能力及双方 permit，实际归属由领域再次验证。
- 3 项 BFF 测试、相关 ESLint 及全应用 typecheck 通过，涵盖详情路由/能力、query 白名单、第二权限拒绝。API 文档已补充。列表发现、页面、实际 Adapter 联调和跨产品交付整合继续，全方案未完成。

### 2026-09-08：跨产品依赖筛选列表 BFF

- GET items/{item} 支持指定 1–100 个前置产品及分页，重复/同产品/非法参数拒绝，源及每个目标独立 view 授权后生成 permit 集合调用 list；输入只作筛选，不作授权。
- 4 项 BFF 测试、ESLint 和全应用 typecheck 通过。原 GET 方法拒绝测试因新增读取语义改为 PUT 不支持测试，保留无筛选 GET 参数拒绝用例。
- 自动发现所有可见依赖、页面、实际 Adapter 联调和跨产品交付整合尚未完成，原全方案继续。

### 2026-09-08：依赖目标内部发现

- 新增 DiscoverCrossDependencyTargets，源 priorities/view 与事项归属核验后返回关联前置产品去重集合及源产品/事项修订；最多 100 个，超过明确拒绝，不截断后冒充全量。
- 该函数仅供后续服务端权限收集，不应向浏览器直接返回产品集合。实际 MySQL 创建专项验证关联产品与修订正确，测试通过。Runtime 内部发现、BFF 自动权限筛选、页面及全方案其余范围继续。

### 2026-09-08：内部目标发现 Runtime

- 接入 cross-dependencies:targets，源 priorities/view permit 与精确 product-priorities:read 能力，按只读传输分类，绑定可信 actor 与事项 input，返回内部目标发现结果供后续 BFF 逐产品授权。
- Runtime 能力/身份/方法边界和只读分类测试通过；没有添加浏览器 targets 透传入口。自动列表权限收集、页面及完整方案其余范围继续。

### 2026-09-08：自动可见跨产品依赖列表 BFF

- GET items/{item} 无前置产品筛选时，在服务端发现目标并逐个核验 view，只向 Runtime 列表提交已获准产品；不向浏览器暴露内部目标集合或隐藏总数。显式筛选仍逐项要求授权。
- 校验发现结果的源产品、事项及产品修订；权限服务故障保留 503，身份或修订变化拒绝。目标权限收集完成后生成短期 permit，避免串行收集消耗转发有效期，领域仍重新核验事实。
- 8 项输入/BFF 测试、相关 ESLint 和全应用 typecheck 通过，包括隐藏目标排除、过期发现、actor 变化和授权故障。API 文档已同步。
- 页面、实际 Adapter 全链路和跨产品交付/承诺约束仍未完成，完整方案保持进行中。

### 2026-09-08：交付入口补齐当前依赖复核

- 检查跨产品交付扩展点时发现，共享 ValidatePlanningDeliveryTx 原先只验证评估/决定有效性，缺少当前同产品依赖状态复核。现复用承诺依赖规则，使项目转交、版本范围新增/修改和承诺入口均重新验证前置交付状态或同周期选入顺序；仅接受冻结决定中精确对应的有效例外。
- 实际 MySQL 选择专项新增：评估未变化但前置未解决时拒绝，前置交付后放行，再变为取消后拒绝。完整 productcenter 与 aims Go 包测试通过（33.987s / 2.280s），使用隔离 MySQL。
- 该变更修复现有同产品交付门禁，不代表跨产品依赖门禁已接通；跨产品页面、承诺/交付规则及其余完整方案仍在进行。

### 2026-09-08：跨产品依赖浏览页面

- 事项详情新增跨产品依赖入口，列表展示已授权前置事项标题、产品、生命周期、依赖原因和详情链接，支持分页/刷新/错误/空状态。响应核验源身份、分页与记录身份，数据由自动权限筛选 BFF 提供。
- 相关 ESLint 与全应用 typecheck 通过。实际 Chrome 加载本仓页面、隔离模拟 API 验证 21 条记录第一页 20 条、第二页 1 条且末页按钮禁用、零记录空状态和前置详情 URL 正确。此验证不代表真实 JWT/Runtime 端到端验收或移动端视觉验收。临时模拟接口已移除，预览进程已停止。
- 创建/移除操作页面、跨产品交付/承诺约束及完整方案其余范围继续。

### 2026-09-08：跨产品依赖移除表单及权限接口

- 新增 GET cross-dependencies/permissions，要求源 priorities/view，并检查 edit 与 view 的 actor/状态/修订/成员事实一致。页面仅在可编辑且与列表产品修订一致时提供移除操作；服务端写入继续独立核验两端权限。
- 列表新增移除原因/影响说明表单及 Foundation 确认，冻结双方产品/事项和边修订；同 payload 失败重试复用幂等键，验证移除回执的身份及修订增量后刷新。请求中阻止路由切换，编辑时禁用刷新/分页及其他移除选择。
- 9 项输入/BFF 测试、相关 ESLint 和全应用 typecheck 通过。移除浏览器成功/失败重试专项尚未完成，不能视为操作验收通过。新增列表响应修订校验，后续浏览器 mock 需要同步完整修订字段。
- 创建操作页面、跨产品交付/承诺约束及全方案其余范围仍在进行。

### 2026-09-08：跨产品依赖移除浏览器专项

- Chrome 加载实际依赖页面，隔离模拟服务提供完整双方/依赖修订及编辑权限。验证空原因不可提交、选中后刷新及其他移除操作禁用，Foundation 确认展示目标/原因/影响。
- 第一次 POST 返回 503，页面保留原因和影响；第二次提交由模拟服务核对同一 Idempotency-Key、完全相同 body 及双方产品/事项/边修订后返回成功回执，页面清空表单并刷新至零条依赖。
- 此为真实浏览器与模拟 API 的交互验证，不替代实际 JWT/Runtime 联调或移动端视觉验收。模拟接口已移除，预览进程已停止。创建入口、跨产品交付/承诺约束及全方案其余部分继续。

### 2026-09-08：跨产品依赖创建入口

- 新增 CrossDependencyCreate 组件并接入依赖列表。复用产品可见列表与目标规划事项查询，支持关键词/分页、选择产品后选择事项，禁选本产品及已取消/合并前置，不要求用户填写内部 UUID。
- 捕获双方产品/事项修订，原因/影响说明经 Foundation 确认，稳定 payload 重试复用幂等键；成功回执核对双方身份和修订增量后刷新。查询失败不展示旧结果；创建期间隔离列表刷新、分页和移除操作。
- 相关 ESLint 与全应用 typecheck 通过。首轮类型检查发现可选 workspace_revision 未收窄，已补显式数字检查后通过。创建浏览器成功/失败/搜索分页验证尚未完成，真实 JWT/Runtime 联调也未完成。
- 跨产品交付/承诺约束及完整方案其余范围继续。

### 2026-09-08：创建依赖浏览器专项

- Chrome 运行实际依赖页面和创建组件，复用隔离产品目录 mock，验证活动产品第一页/第二页、末页按钮、关键词搜索回到第一页；选择产品后加载前置事项，未选择或原因空白不可提交。
- Foundation 确认展示前置标题/产品、原因与影响。模拟服务核验选中产品/事项以及双方产品/事项四项修订，首次返回 503；页面保留选择及输入，再次提交通过相同幂等键及完全一致 body 检查，成功后关闭表单并刷新至新增依赖。
- 本次为真实浏览器＋模拟服务，未替代真实 JWT/Runtime 端到端和移动端视觉验收；前置事项多页/异常返回专项仍待补。临时 QA-CREATE 与 P-002 事项接口已移除，预览进程已停止。跨产品交付/承诺约束和完整方案其他范围继续。

### 2026-09-08：跨产品依赖真实 Adapter / MySQL 链路

- 新增 TestMySQLCrossDependenciesThroughRuntime，在隔离 MySQL 安装 v5.27 并建立双方产品/成员/事项，调用实际 Adapter.HandleRuntime 分发创建、详情、列表、目标发现、移除。
- 创建和移除分别验证同幂等键重放同回执；详情/列表校验双方身份和产品修订，发现返回实际关联产品；移除后列表为零、源修订为 3，数据库仅 2 条命令回执且无依赖边。
- 专项实际执行通过（0.709s）。测试注入可信服务上下文并动态加载授权事实，覆盖 Runtime 解码/分发与真实领域事务，不覆盖真实 JWT 签发/网关/BFF 网络链路；该端到端环境验收仍未完成。
- 跨产品交付/承诺约束及完整方案其他范围继续。

### 2026-09-08：跨产品幂等重放重新授权验证

- 实际 Adapter / MySQL 专项增加授权事实收集后、Runtime 分发前撤销前置产品成员关系的场景。携带旧 permit 重放已成功创建的同幂等请求，必须返回 409 授权事实变化；数据库仍只有原 1 条回执和 1 条边，不能通过回执绕过重新授权。
- 恢复测试关系后继续原详情/列表/发现/移除链路。专项及 Runtime 能力边界测试通过（0.724s）。此验证针对旧 permit 与关系变化，不代替 Console policy grant 撤销及真实 JWT 网络验收。
- 跨产品交付/承诺约束及完整方案其余工作仍未完成。

### 2026-09-08：跨产品依赖进入容量决定及交付门禁

- 容量加载通过 EXISTS 读取是否存在未交付跨产品前置，DecisionItem 增加内部协调标志；选中且未交付事项产生 cross_dependency_unresolved，仅包含本事项身份，不暴露前置身份/数量。不同产品的周期顺序不自动解除依赖。
- 复用现有具名例外，需填写原因、责任人、影响，确认后报告仍保留问题。交付共用门禁同步检查当前跨产品前置，仅接受冻结决定中匹配例外；其他容量例外不能代替。四处容量/选择/预算/撤回界面补充中文问题标签。
- 当前容量及交付路径要求 v5.27；两个常用集成 fixture 显式安装该迁移，迁移前专项 fixture 保持独立。完整 productcenter/aims Go 包通过（35.006s / 2.626s），相关页面 ESLint 通过；随后补充的真实 MySQL 门禁专项与例外纯规则专项通过（0.748s）。验证跨产品提示无前置泄漏、未交付拒绝、交付后放行、例外不抹去问题。
- 尚待跨产品前置快照/承诺复评追踪、并发事实变化专项、真实 JWT/网关及页面协调提示验收；完整方案仍在进行。

### 2026-09-08：跨产品依赖承诺变化摘要

- 承诺 item_snapshot 新增版本化 SHA-256 摘要，按边 UUID 排序读取边身份/修订、前置身份/修订/生命周期，最多 10000 条，超限拒绝。对外仅保存摘要，不增加前置标题、产品编码或数量披露。
- 历史比较摘要变化后提示 cross_dependencies_changed；老基线缺摘要提示缺少状态依据，不伪装为未变化。无变化拒绝规则也比较原摘要，允许本事项未改但前置事实变化后重新确认。历史页面补中文提示。
- 完整 Go 包通过（34.093s / 2.611s）；随后新增摘要与承诺真实 MySQL 专项通过（1.434s），验证稳定摘要、前置修订/状态/边变化、空集合以及历史复评提示；相关 ESLint 通过。
- 这是变化检测依据，不是可还原的完整前置快照。完整跨产品历史快照、跨产品事实并发一致性与重新确认专项仍需补齐；全方案保持进行中。

### 2026-09-08：承诺前置事实读取的一致快照

- 命令执行器保留默认 READ COMMITTED，新增内部 executeSnapshotCommand，仅承诺命令显式使用 REPEATABLE READ；承诺历史复评同样使用一致快照。源产品根锁及授权/回执原子性继续保留，不在根锁之后再交叉锁定前置产品。
- 同一次承诺的依赖校验、状态摘要和其他非锁定读取共享已提交快照，避免前置变化造成校验和摘要来自不同时间点。快照之后的前置修改在后续历史读取中触发复评，不声称冻结或阻止其他产品演进。
- 完整 productcenter/aims 包测试通过（34.546s / 2.645s）。补充实际双连接 MySQL 专项：命令第一次读取后另一连接提交前置修订变化，命令第二次摘要保持一致，事务后新读取发现变化；专项通过（0.653s）。
- 完整前置历史快照、承诺再次确认专项及其余完整方案仍需继续。

### 2026-09-08：前置变化后的承诺再次确认专项

- 扩展实际 MySQL 承诺专项：先为已交付跨产品前置确认基线，只增加前置修订（本事项/周期/队列不变），再次确认必须成功并可幂等重放。
- 核验新基线 previous_commitment_id 关联原基线，状态摘要变化；原 item_snapshot 完全不变。重新读取历史，新基线没有跨产品变化提示，旧基线仍提示变化。
- 专项通过（0.808s）；首次命令在仓库根执行因无 go.mod 失败，已切至 data-runtime 正确执行，未变更模块配置。完整前置历史快照及全方案其他范围继续。

### 2026-09-08：独立跨产品前置历史快照表

- 新增 v5.28 product_roadmap_cross_dependency_snapshots，按承诺/依赖唯一，保存前置产品/事项身份与修订及 JSON 快照。承诺和产品外键校验，正修订及 JSON 对象约束；不外键引用可移除依赖边，以便保留历史。UPDATE/DELETE 触发器保护不可变。
- canonical schema 和增量一致性链同步。实际 MySQL 验证无效父级/产品/修订/快照类型拒绝、唯一性、不可变与重复迁移保留原内容；迁移及 canonical 对照专项通过（1.583s）。
- 当前仅完成存储结构，尚未接入承诺事务写入或带双方权限的历史读取，不应向通用承诺历史直接透传原始表。目标环境未安装该迁移，完整方案继续。

### 2026-09-08：承诺事务写入完整前置快照

- 新增 saveRoadmapCrossSnapshots，在承诺一致快照内先普通 SELECT 读取前置范围/标题、产品状态/修订、事项状态/范围/证据修订、时间窗口/期限/类别及依赖原因，再逐行 INSERT 独立历史表，避免 INSERT SELECT 的 current/locking read 破坏一致性。最大 10000 条，超限失败。
- 承诺生成后、产品修订和审计前调用，任何失败由同事务回滚；回执不附带原始前置快照。两个承诺集成 fixture 安装 v5.28。
- 全包运行发现产品中心 fixture 将 v5.28 错放循环内、先于 v5.26，已改为有序迁移列表。aims 包通过（2.643s）；修复后的承诺专项通过（0.716s），验证快照写入失败回滚基线/产品修订、幂等重放不重复快照、旧前置状态及修订保持不变。未把首次全包失败记作全包通过。
- 前置历史的双方权限读取/API/页面仍需实现，完整方案继续。

### 2026-09-08：承诺前置快照的领域权限分页

- 新增 ListRoadmapCrossSnapshots，源产品 roadmaps/view 与 priorities/view 均核验，前置产品逐个 priorities/view，沿用图锁后按编码排序的多产品锁顺序。承诺严格绑定源产品，快照身份与列身份再次比对。
- 只在已授权前置产品集合内计数与分页；空范围返回零记录/零总数。查询独立历史表，不依赖当前依赖边存在，不向通用承诺读取接口自动附加快照。
- 实际 MySQL 承诺专项通过（0.797s），覆盖原修订读取、隐藏总数为零、第二页边界、前置错误权限拒绝、删除当前边后历史内容保持相同。
- Runtime/BFF 目标发现与权限收集、历史前置页面仍待接入，完整方案继续。

### 2026-09-08：承诺前置历史 Runtime

- 接入 roadmaps:cross-snapshots，精确 roadmaps:read，绑定可信 actor，解码源 roadmap/planning 两项 permit 及前置产品 permit map，调用权限分页领域函数；登记只读传输，不新增服务 grant。
- Runtime 方法/能力/身份边界测试通过；精确只读传输测试通过（0.367s）。实际 Adapter/MySQL 路线图专项通过（0.747s），验证承诺 UUID 分发、空授权范围零记录及正确事项身份，原基线写入/重放继续通过。
- BFF 自动发现与权限收集、历史页面和完整方案其余部分仍待继续。

### 2026-09-08：历史前置目标发现

- 新增 DiscoverRoadmapCrossSnapshotTargets，从指定承诺的不可变历史表发现去重前置产品，校验源 roadmap/view 与 priorities/view，返回承诺/事项身份、源修订及内部目标集合；最多 100 个，超限明确拒绝。
- 接入内部 roadmaps:cross-snapshot-targets，复用精确 roadmap read 能力并登记只读传输；没有新增浏览器原始目标集合入口。Runtime 边界与只读测试通过（0.406s / 0.749s）。
- BFF 需在发现后逐产品授权，仅输出获准范围分页；浏览器历史页面尚未接入，完整方案继续。

### 2026-09-08：承诺前置历史浏览器 BFF

- GET roadmaps/cross-snapshots/{commitmentUUID} 绑定承诺及分页，要求源 roadmap/planning 两项一致 view 事实；内部发现历史目标，逐项核验前置 view，忽略明确拒绝的目标但保留授权服务故障。仅向最终列表传递获准 permit，不输出内部产品集合。
- 发现身份/源修订、目标 actor/产品身份验证后转发；所有目标权限收集完成后生成短期 permit。查询白名单拒绝客户端 actor 等字段。
- 8 项路线 BFF 测试、相关 ESLint 和全应用 typecheck 通过；测试覆盖隐藏目标排除、发现过期、授权故障和输入覆盖拒绝。API 文档已同步。历史前置页面及完整方案其余工作继续。

### 2026-09-08：承诺前置历史页面接入

- 新增 RoadmapCrossHistory 组件，承诺历史每条基线可按需展开。显示当时标题/范围/状态/事项修订、原因、窗口及期限，当前事项使用独立明确链接；仅展示权限过滤后的记录与计数，分页/刷新/错误/空状态齐备。
- 响应核验源产品/事项/承诺 UUID、分页、快照与外层身份/修订一致及日期有效性，状态仅使用已知生命周期；错误不作为空历史。按基线 key 隔离组件状态。
- 相关 ESLint 与全应用 typecheck 通过。浏览器实际交互、分页/历史对照与权限错误专项尚未执行；完整方案其余工作继续。

### 2026-09-08：历史前置浏览器分页验证

- Chrome 运行实际承诺历史页及 RoadmapCrossHistory，隔离模拟 API 提供 21 条历史记录。验证按需展开、第一页面 20 条、第二页 1 条且末页按钮禁用、收起后重新展开回到第一页。
- 页面正确显示“当时范围/状态/事项修订/时间窗口”和未确定期限，当前前置另有明确链接；无加载错误。此为模拟数据交互验证，不替代实际 JWT/Runtime 或移动端视觉验收。临时 QA-SNAPSHOT 接口已删除，预览进程已停止。
- 完整方案仍在进行，后续需继续模型配置/受众视图、多项目协调及真实环境验收等范围。

### 2026-09-08：可配置加权模型计算内核

- 新增 WeightedAssessmentModel 与校验，版本标识有界，四项非负权重以 5% 为步长、合计 100%；保留现有整数 0–100 价值分。内置 weighted-value-effort-v1 禁止更改权重，同名不得冒充不同规则。
- CalculateAssessment 委托默认模型，新增可信模型参数的 CalculateAssessmentWithModel；置信度、人日、八位精度和缺失证据规则保持。默认周期快照也从统一默认模型取权重，减少计算与快照漂移。
- 固定/自定义已知计算值、版本隔离、非法权重和缺失输入专项通过；真实 MySQL 评估/周期相关回归通过（2.701s）。
- 当前尚未接入模型业务版本存储、周期选用和配置 UI，RICE 仍待按数据条件实现；完整方案继续。

### 2026-09-08：评分模型版本存储与创建命令

- 新增 v5.29 product_priority_model_versions，产品内版本唯一、独立 biz UUID、完整规则 JSON、原因与创建人，不可 UPDATE/DELETE；canonical 及迁移对照链同步。method 预留 rice 不代表已启用 RICE。
- CreateWeightedModelVersion 要求 priorities/admin，校验活动产品/修订、版本与权重，禁止重建内置版本；冻结权重、置信度、人日、量表、精度和舍入规则，与产品修订/审计/回执原子提交。创建新模型不会修改周期、评估或排序。
- 实际 MySQL 迁移/命令及 canonical 对照专项通过（1.564s），覆盖产品隔离、唯一性/不可变/无效配置类型、重复迁移、审计失败回滚、重试同回执、版本冲突拒绝。
- 模型读取、Runtime/BFF、周期显式选用与配置页面仍需接入；目标环境未迁移，完整方案继续。

### 2026-09-08：模型版本权限分页读取

- 新增 ListPriorityModels，要求源 priorities/view，按产品严格计数和分页，返回不可变版本规则、原因、创建人与时间及当前产品修订。内置模型作为独立 builtin 默认选项，不伪造版本行或混入持久版本总数。
- 实际 MySQL 专项通过（0.687s），验证新旧模型页序、末页空结果与稳定总数、内置默认、当前修订及跨产品 permit 拒绝，原创建/审计回滚/幂等验证继续通过。
- Runtime/BFF、周期显式选用、配置页面和 RICE 仍需接入，完整方案继续。

### 2026-09-08：周期冻结模型解析与评分接入

- 新增 loadFrozenWeightedModel，内置版本对照原默认快照，自定义版本仅从同产品不可变模型表读取；要求周期 JSON 与原版本语义一致，并验证权重、量表、置信度、人日、精度和舍入。不同产品同名版本不可交叉引用，RICE 不经加权入口误算。
- 周期开放复用该校验；评估命令在事务内按可信冻结模型重新校验并计算。事务前仅以默认量表验证输入/证据格式，结果不保存；最终分数来自周期实际模型。公开既有固定模型验证函数保持原行为。
- 既有评估/周期 MySQL 回归通过（2.756s）。扩展模型专项核验读取已创建 v3 权重、篡改快照拒绝及跨产品版本拒绝；周期显式绑定、自定义完整评估命令专项和 API/UI 仍待继续。

### 2026-09-08：草稿周期显式选择模型

- 新增 SelectPlanningCycleModel，要求 priorities/admin，校验产品/周期修订、活动产品、草稿状态且没有评估历史。模型只能取同产品不可变版本或内置默认，复制完整冻结配置，记录前后模型及原因；周期与产品修订递增，队列顺序/修订不动。
- 实际 MySQL 模型专项通过（0.712s），使用真实周期创建后选择 v3，验证审计失败回滚、幂等重放同回执、权重 60% 落入周期快照、队列不变、重复选择拒绝及闭期选择拒绝。
- 模型绑定领域命令已具备；自定义模型实际评估端到端、Runtime/BFF/界面及完整方案其他范围继续。

### 2026-09-08：自定义模型实际周期评分链路

- 新增真实 MySQL 集成专项，依次调用模型创建、周期创建、模型选用、候选加入、周期开放、评估写入及候选读取，未用直接 SQL 改周期状态替代开放命令。
- 验证 10/60/20/10 权重下价值分 36、优先分 3.60000000，评估快照冻结模型标识及 60% 用户价值权重；重放同回执，候选读取显示当前有效分数。
- 新建下一模型版本后原评估快照完全不变，开放周期切换模型拒绝。专项通过（0.826s）。模型 Runtime/BFF/UI、RICE 及全方案其余范围继续。

### 2026-09-08：模型版本列表 Runtime

- 新增 priority-models:list，调用真实模型权限分页，要求精确 priorities:read、可信 actor 和源 priorities/view permit；接入统一分发，登记只读传输，没有新增 grant。
- Runtime 方法/能力/授权解码/actor 边界和只读传输测试通过（0.381s / 0.734s）。模型 API 文档已建立。
- 真实 Adapter 模型读取、写能力及 grants、BFF/UI 和 RICE 等范围仍待继续，完整方案未完成。

### 2026-09-08：模型 Runtime 写接口与授权

- 接入 priority-models:create/cycle-select，分别要求 model-create/cycle-model-select 精确 priorities capability，绑定可信 actor，解码输入/admin permit/幂等键调用领域命令。版本冲突与模型未变化映射 409。
- Manifest、grant 生成器和 Console seed/verify 同步；当前 152 条业务 grant / 158 项验证要求。Runtime 边界测试通过（0.387s），隔离 MySQL 授权脚本通过全部 158 项要求及异常场景，未安装目标环境。
- 真实模型 Adapter 成功链路、浏览器 BFF/页面及 RICE 等完整方案范围继续。

### 2026-09-08：模型浏览器接口与权限快照

- 接入模型列表、创建、周期选用及权限快照 BFF，读取要求 priorities/view，写入要求 admin 和幂等键，周期身份绑定路由；管理员按钮权限返回一致事实快照，明确拒绝保留 false。
- 严格验证分页、版本、权重、双修订和字段白名单，拒绝客户端授权/规则快照/评分结果覆盖；可信 actor、短期 permit 和精确 Runtime 能力由服务端生成。
- 输入与真实 BFF helper VM 专项 8 项通过，覆盖分页、权限拒绝/事实变化、路径、写入幂等键、非法输入及 Runtime 故障；相关 ESLint 和全应用 typecheck 通过。API 文档同步。
- 尚未完成模型配置/周期选用页面和真实浏览器到 Runtime 的联调；RICE 及完整方案其他范围继续。

### 2026-09-08：模型列表与发布页面

- 产品空间新增评分模型入口，模型列表使用真实 20 条分页，展示内置默认规则、版本、发布原因/时间及权重详情；权限错误独立显示，创建入口受管理员权限控制。
- 新增独立发布页，四项权重实时合计、5% 步长、原因与版本输入，说明不可变发布和历史评分保留；请求绑定产品修订及幂等键，同一载荷失败重试复用键，验证发布回执身份/版本/修订，保存中禁止路由切换。
- 页面 ESLint 与全应用 typecheck 通过。尚未执行浏览器交互与视觉验收，周期模型选用页面和评估页面自定义版本适配仍待继续。

### 2026-09-08：自定义模型评估前端适配

- 移除评估 BFF 和页面仅允许默认版本的限制。BFF 只接受合法版本标识和既有维度输入，继续拒绝客户端权重、快照和评分结果；实际规则由 Runtime 按产品内不可变版本及周期快照确认。
- 新增加权表单兼容校验，检查周期冻结权重、版本、置信度、人日、量表、精度及舍入；默认版本仍要求原权重，不完整/RICE 配置不可误入加权表单。表单展示实际版本和权重。
- 输入及冻结模型兼容性 7 项专项通过，相关 ESLint 和全应用 typecheck 通过。尚待浏览器交互验收、草稿周期选用模型页面与完整方案剩余范围。

### 2026-09-08：草稿周期评分模型选用页面

- 新增 cycles/{cycleId}/model 页面和周期详情入口，读取管理员权限及一致产品修订，只允许草稿周期操作；内置模型与自定义模型分页显示，不支持的规则禁选，所选版本跨页保留并展示权重。
- Foundation 确认包含周期、原/新模型和后续评估影响；提交双修订、原因及稳定幂等键，失败保留输入。回执校验模型/周期/产品身份、修订增量、冻结规则和队列修订未变化，保存中阻止导航、刷新及编辑。
- 页面 ESLint 与全应用 typecheck 通过。模型页面的浏览器交互与视觉验收尚待执行，实际 JWT 联调及完整方案剩余工作仍未完成。

### 2026-09-08：模型 Runtime 真实集成验证

- 新增 TestMySQLPriorityModelsThroughRuntime，在隔离 MySQL 应用实际迁移，通过 Adapter.HandleRuntime 总入口执行模型创建/列表/周期选用，核验统一响应和 operation；权限使用数据库实时事实和精确服务能力。
- 验证创建/选用重放返回同一回执，列表真实第二页为空但保留总数，默认模型独立返回；实际周期冻结用户价值 60%、周期修订 2、产品修订 4、队列修订仍为 1，最终一个版本及三条命令回执。
- 真实集成及模型 Runtime 边界测试通过（0.839s），测试数据位于专用本机 socket 下的临时数据库，未操作目标部署或业务数据库。浏览器交互、实际服务 JWT 联调与全方案其余范围仍待继续。

### 2026-09-08：模型列表与发布浏览器交互验证

- Chrome 运行实际模型列表和发布页面，专用 QA-MODEL 模拟 API 提供 21 个版本。第一页面 20 条，第二页仅版本 21，末页翻页按钮禁用；版本详情正确显示 10/60/20/10 权重、原因及 UTC 时间。
- 发布表单填写名称/版本/原因，权重合计 130% 时提交禁用；调整至 100% 后提交。模拟第一次返回 503，页面保留全部输入并显示实际错误；第二次仅允许相同 body 和 Idempotency-Key，通过后返回列表第一页。
- 这是模拟 API 下的实际浏览器 DOM/交互验证，不替代真实服务 JWT 联调或视觉/窄屏验收。周期选用交互尚未执行。临时 QA-MODEL 接口已移除，预览进程退出 130；完整方案继续。

### 2026-09-08：模型版本标识前端校验补齐

- 发布表单及冻结模型兼容检查统一使用前端版本标识校验，拦截控制字符、非法 Unicode、首尾空格、斜杠及超过 64 个 Unicode 字符的标识；表单补充格式说明。
- 新增前端/API 版本校验对照专项，覆盖中文、补充平面字符、长度边界及控制字符。模型输入/兼容性共 6 项通过，更新后的对照专项通过，相关 ESLint 通过。
- 此项不替代尚待完成的周期选用浏览器验收、视觉验收及完整方案其他范围。

### 2026-09-08：RICE 人日模型计算内核

- 根据第二批按条件启用 RICE 的要求，新增独立模型和输入类型，强制 Reach 去重单位、时间窗口、定义及来源定义，不复用加权维度输入或 0～100 价值分。
- 计算统一人日口径，影响系数/置信度使用明确枚举，未知 Reach 不等于零；大数中间乘积使用精确整数，保留八位小数及 half-up 舍入。
- TestRICE 专项通过（0.352s），覆盖已知值、循环小数舍入、有效上界、零/未知及不可比较口径拒绝。来源与单位差异已记录 API 文档。
- 尚未启用 RICE：版本存储命令、可信 Reach 证据条件、周期/评估 Runtime/BFF/UI 仍需接入。完整方案继续。

### 2026-09-08：RICE 不可变模型版本发布命令

- 新增 CreateRICEModelVersion，将 Reach 单位/期间/去重定义/来源定义以及人日、影响系数、置信度、精度和舍入完整冻结到现有不可变模型版本表。
- 加权与 RICE 复用私有模型持久化命令，保留各自公开输入及原载荷幂等指纹；管理员授权、活动产品、修订、产品内跨方法版本唯一、审计及回执仍在同一事务。
- 实际 MySQL RICE 发布、原自定义加权周期评估回归及 RICE 计算专项通过（0.982s），覆盖审计失败回滚、重试同回执、读取配置、跨模型同名冲突及不可变更新拒绝。
- 发布定义不代表 Reach 数据已可信或允许启用；RICE Runtime/BFF、周期冻结模型加载、Reach 证据门槛、评估持久化及 UI 尚待接入。

### 2026-09-08：RICE Runtime 模型发布

- 新增 priority-models:rice-create，通过统一 Runtime 总入口调用 RICE 发布领域命令；复用 model-create 精确服务能力、管理员 permit 和可信操作者，无新增授权项。
- 实际 MySQL 集成验证 RICE 创建/重放/列表与现有周期不受影响，模型 Runtime 边界验证读写方法、宽泛能力拒绝、可信操作者和跨模型输入解码拒绝。
- 集成及原模型边界测试通过（0.702s），补充跨方法输入边界专项通过。API 文档同步；RICE 浏览器创建、周期选用及可信证据评估链路尚待继续。

### 2026-09-08：RICE 浏览器创建接口

- 接入 priority-models/rice-create，严格校验去重对象、真实日期、窗口上限、去重定义与来源定义；拒绝客户端已验证声明、Reach 数值、加权规则和授权覆盖。
- 复用管理员权限、幂等键、可信 actor 和 model-create 精确 Runtime 能力；加权/RICE 创建输入互不混用。
- 输入与实际 BFF helper 专项共 10 项通过，相关 ESLint 通过。API 文档同步；RICE 发布页面、周期选用/证据评估与完整方案其余范围继续。

### 2026-09-08：RICE 模型定义详情展示

- 模型详情按方法展示 RICE 的去重用户/企业单位、统计窗口、去重与对象范围定义、来源定义和投入单位；缺失字段明确显示未提供，不套用加权权重详情。
- 明确区分已发布定义与可信观测证据，保持当前 RICE 周期选用尚未启用的真实状态。API 文档清理旧的“尚未开放创建接口”描述。
- 页面 ESLint 与全应用 typecheck 通过。RICE 详情浏览器专项、发布表单与周期/证据评估仍待继续。

### 2026-09-08：RICE 模型定义发布表单

- 新增 models/rice-new 独立页面和模型列表管理员入口，包含名称/版本、去重对象、统计起止日期、去重及对象范围定义、数据来源定义与发布原因。
- 校验真实日期、窗口顺序/上限和必填定义；复用权限事实、产品修订、稳定幂等键及发布回执身份/方法/修订校验。保存中禁止导航，失败保留输入。
- 明示人日版计算口径及“发布定义不代表证据已验证”，不开放尚未实现的 RICE 周期选用。相关 ESLint 与全应用 typecheck 通过；浏览器专项及 RICE 证据/周期/评估链路仍待继续。

### 2026-09-08：RICE 冻结规则解析

- 新增 loadFrozenRICEModel，从同产品不可变版本读取 method/configuration，要求周期快照与原配置语义一致，并核对人日、影响系数、置信度、精度、舍入和完整 Reach 定义。
- 实际 MySQL 发布/读取专项通过（0.693s），验证读取原定义、修改去重单位/窗口/来源/舍入拒绝、跨产品引用拒绝以及 RICE 不可经加权解析入口读取。
- 此解析器只确认模型定义一致，尚未接入周期选用或评估写入，也不替代 Reach 证据可信性校验。完整方案继续。

### 2026-09-08：Reach 观测绑定校验

- 新增 RICEReachObservation 与校验，绑定产品、事项、范围/证据修订、模型版本及模型中的去重单位、统计窗口、去重与来源定义；要求观测身份、可追溯来源、取数方法、记录人和有效时间。
- 校验对象设计为服务端读取的持久观测，不能将客户端声明直接视为可信观测。零计数保留为已知零，跨产品/事项/版本/窗口/口径与过期修订均拒绝。
- RICE 专项通过，覆盖计算及观测绑定变更拒绝。观测存储、授权写入与评估引用尚未实现，不能据此标记 Reach 证据链路已完成。

### 2026-09-08：Reach 观测不可变存储迁移

- 新增 v5.30 product_rice_reach_observations，记录产品/规划事项、模型版本、范围/证据修订、Reach 数量、完整 JSON 快照和记录人/时间。
- 产品事项复合外键与产品模型版本外键约束引用范围，正修订、数量上限、JSON 对象及记录人约束防止无效存储；UPDATE/DELETE 触发器保留历史。canonical schema 与迁移对照链同步。
- 实际 MySQL 迁移及 canonical/增量对照通过（1.544s），覆盖跨产品/缺失版本/零修订/超界/数组拒绝、不可变和重复迁移保留零值证据。目标部署未迁移。
- 授权观测写入、证据读取和 RICE 评估引用仍待实现，完整方案继续。

### 2026-09-08：Reach 授权观测写入命令

- 新增 CreateRICEReachObservation，要求 priorities/assess、活动产品及产品/事项/范围/证据完整修订，绑定可信记录人、服务端时间及同产品不可变 RICE 口径。
- 写入不可变观测后递增事项和证据修订及产品修订，使原评估通过既有修订比较失效；源说明与取数方法必填，观测/修订/审计/回执原子提交，重放不重复递增。
- RICE 纯规则专项及实际 MySQL 写入专项通过，覆盖审计失败回滚、重放同回执、证据修订仅增加一次和记录人绑定。
- Runtime/BFF、来源真实性核验、观测读取及 RICE 评估引用仍待接入；当前是有责任归属的手工观测记录，不宣称外部数据已自动验证。

### 2026-09-08：Reach 观测授权详情读取

- 新增 ReadRICEReachObservation，要求 priorities/view，绑定产品、事项和观测 UUID；核对快照与存储列的模型/修订/数量/记录人一致，并重新解析不可变 RICE 模型口径。
- 返回历史原观测及独立 stale 标识，按当前事项范围/证据修订判断是否过期，不改写历史。内部加载器供后续评估事务复用。
- 实际 MySQL 专项通过（0.710s），覆盖授权读取、新观测有效、错误事项拒绝、范围变化后标记过期且历史范围保持原值。Runtime/BFF、分页及评估引用仍待继续。

### 2026-09-08：Reach 观测分页读取

- 新增 ListRICEReachObservations，要求产品 priorities/view，按指定事项真实计数/分页、倒序返回，单页最多 100 条；每条复用快照身份和模型口径校验并返回 stale。
- 实际 MySQL 专项通过（0.685s），验证最新记录页、总数、超末页空结果、过期标识、超界分页拒绝及损坏历史快照明确报错。未将无效历史伪装成空列表。
- 后续继续 Runtime/BFF 与观测页面、RICE 周期及评估引用；完整方案未完成。

### 2026-09-08：Reach 观测 Runtime 读取

- 接入 reach-observations:list/view，绑定可信 actor、精确 priorities:read、产品 view permit 和事项/观测身份，复用真实分页/详情领域读取；登记只读传输。
- Runtime 方法/宽泛或错误能力/授权解码/操作者边界测试通过（0.380s），服务端只读传输专项通过（0.460s）。API 文档同步。
- 尚待实际 Adapter 读取成功链路、观测写 Runtime/BFF 及浏览器页面和 RICE 评估引用。

### 2026-09-08：Reach Runtime 真实读取链路

- 扩展模型 Runtime 集成测试，实际迁移 Reach 表、发布 RICE 定义并通过授权领域命令记录 450 个去重用户，再经 Adapter.HandleRuntime 总入口读取列表/详情。
- 验证统一响应/operation、记录人 pm、证据修订 2、事项修订 2、产品修订 6、当前有效标识，以及第二页为空但总数保持 1。
- 专用隔离 MySQL 集成通过（0.723s），未使用业务数据库或将直接 helper 调用冒充 Runtime 读取。Reach 写 Runtime/BFF/页面与 RICE 评估链路仍待接入。

### 2026-09-08：Reach 写 Runtime 与服务授权

- 接入 reach-observations:record，要求 reach-record 精确能力、可信 actor、assess permit 与幂等键，解码受限输入调用观测领域命令；没有将写入登记为只读。
- Manifest、grant 生成器及 Console seed/verify 同步，当前 154 条业务 grant /160 项要求；隔离 MySQL 脚本验证全部要求及缺失/过期/幂等等异常场景通过。
- Reach Runtime 方法/能力/授权/actor 边界专项通过（0.358s）。API 文档同步，目标环境未安装授权；写 Adapter 成功链路及 BFF/页面、RICE 评估仍待继续。

### 2026-09-08：Reach Runtime 实际写读链路

- 将集成测试的 Reach 创建改为 Adapter.HandleRuntime 的 record 入口，使用 reach-record 精确能力和 assess permit；随后通过 list/view 读取，不以领域创建调用代替 Runtime 写入验证。
- 实际隔离 MySQL 集成通过（0.746s），验证重试同回执、列表一条观测、事项/证据/产品修订仅增加一次、记录人绑定和详情/分页一致。
- 浏览器 BFF 与观测页面、RICE 周期/评估链路仍待完成。

### 2026-09-08：Reach 浏览器读写接口

- 新增 Reach 输入校验、BFF helper 及 catch-all 路由，支持事项下列表/详情/记录；绑定路由身份和完整修订，保留已知零，拒绝客户端操作者、时间、口径快照与已验证声明。
- 读取要求 view、写入要求 assess 和幂等键，可信 actor/短期 permit/精确能力由服务端生成；查询白名单和服务错误处理齐备。
- 输入与实际 BFF helper VM 共 6 项专项通过，相关 ESLint 和全应用 typecheck 通过。API 文档同步；观测页面及 RICE 周期/评估仍待接入。

### 2026-09-08：Reach 观测历史页面

- 新增事项 reach 历史页与详情入口，真实每页 20 条分页，展示数量/去重单位、模型、窗口、记录时间及过期状态；详情包含冻结口径、来源定义/引用、方法、记录人和修订。
- 校验响应产品/事项身份、分页、数量边界与内外修订一致；加载失败不显示为正常空记录，分页或路由变化关闭详情。状态明确为“与当前修订一致”，不冒充外部来源验证。
- 相关 ESLint 与全应用 typecheck 通过。浏览器交互及视觉验收、观测创建页面、RICE 周期/评估引用仍待完成。

### 2026-09-08：Reach 记录权限快照

- 新增浏览器 permissions 入口，返回当前产品状态/修订与 assess 权限；view 与 assess 使用一致事实核对，不借管理员角色推断敏感动作。
- Reach 输入/BFF 共 7 项专项通过，补充权限动作断言后的 BFF 4 项复验通过，相关 ESLint 通过；验证明确拒绝、事实混用、未知查询及错误方法。
- 接下来继续观测创建页面与 RICE 周期/评估，完整方案仍在进行。

### 2026-09-08：Reach 观测创建页面

- 新增事项 reach-new 页面与历史页 assess 权限入口，核对权限及事项修订，模型使用真实分页，仅 RICE 可选，选择跨页保留并展示窗口、对象及来源定义。
- 数量初始为空，已知零可记录；来源引用/方法必填。Foundation 确认说明证据修订及旧评估影响，写入绑定完整修订与稳定幂等键，核对回执身份、数量及修订增量；保存中禁止导航/编辑。
- 相关 ESLint 和全应用 typecheck 通过。创建/历史浏览器专项及视觉验收、RICE 周期/评估引用尚待完成。

### 2026-09-08：RICE 评分引用持久 Reach 观测

- 新增 RICEObservedAssessmentInput，仅包含观测 UUID 和影响/置信度/投入，不接受 Reach 数值或“已验证”声明。
- 授权事务内的评分 helper 按产品/事项读取不可变观测，校验当前范围/证据修订与周期冻结模型口径后采用保存的 Reach 数量；缺少引用保持未知分数，过期引用拒绝。
- 实际 MySQL 专项通过（0.709s）：持久 Reach 450、影响 2、置信度 80%、投入 8 人日得到 90.00000000；空引用不算分，事项范围变化后旧观测不可用于评分。
- 当前尚未接入评估持久化命令和周期选用，完整 RICE 评估链路继续。

### 2026-09-08：RICE 评估存储结构

- 新增 v5.31，在现有评估表增加 model_method、rice_impact、reach_observation_id，原记录默认加权方法；RICE 不允许填入加权维度/value_score，加权方法不允许 RICE 字段。
- 分数完整性约束按方法区分，RICE 有分数必须有影响系数、置信度、投入及观测引用，复合外键将观测绑定同一事项；不完整评估可保留空分数。
- canonical 与增量迁移对照、原自定义加权评估链路通过（1.804s）；补充缺观测有分数拒绝、非法影响拒绝、空分数及重复迁移保留专项通过（0.796s）。
- 目标部署未迁移，RICE 评估写入命令/读取适配与周期选用仍待继续。

### 2026-09-08：RICE 评估输入与证据规则

- 新增 PlanningRICEAssessmentCreate，独立输入观测引用、影响系数、置信度、投入及完整修订，不包含客户端 Reach 数量。
- 提取加权/RICE 共用证据引用校验，保留原加权行为；RICE 已填写维度必须有依据及具体证据引用，投入须由操作者确认，未知可显式保留，不接受 reach 依据字段替代持久观测。
- 评估纯规则回归通过（0.362s）；RICE 新专项与真实 MySQL 自定义加权评估回归通过（0.703s）。RICE 评估事务保存和周期选用仍待接入。

### 2026-09-08：RICE 评估事务保存

- 新增 CreatePlanningRICEAssessment，要求独立 rice-assess 命令身份及 priorities/assess，核对产品/开放周期/事项修订、候选关系、冻结模型、证据依据及当前 Reach 观测。
- 保存 method=rice、影响系数、不可变观测引用、分数和完整模型/证据快照；不填加权维度/value_score，更新候选当前评估、周期/产品修订及审计回执，队列不变。
- 实际 MySQL 专项通过（0.816s），验证 Reach 450、影响 2、置信度 80%、投入 8 人日保存 90.00000000，value_score 为空且重试同回执。测试周期配置补齐容量约束。
- 此专项仍使用明确标注的 SQL fixture 设置 RICE 周期开放状态，不能证明周期选用/开放完整链路；真实命令接入、读取适配和 Runtime/BFF/UI 仍待继续。

### 2026-09-08：RICE 周期选用与开放领域链路

- 周期模型选用/开放改用统一就绪校验，内置及自定义加权保持原解析；RICE 验证冻结定义后要求至少一条当前有效、口径一致、可归责的 Reach 观测，无数据或只有过期记录拒绝。
- RICE 集成移除直接 SQL 切换周期状态，改为实际 SelectPlanningCycleModel、OpenPlanningCycle 后调用评估保存，核验持久分数与重放；原加权完整评估继续通过。
- 实际 MySQL 双链路专项通过（1.226s），范围变化使唯一观测过期后就绪检查拒绝。此为手工观测就绪条件，不声称外部来源已自动验证。
- RICE 浏览器选用、评估读取/Runtime/BFF/UI 与完整方案其他范围继续。

### 2026-09-08：评估历史 RICE 读取与整体回归

- 历史记录增加 model_method、rice_impact 和不可变观测 UUID，保留原权限、分页、current/stale 语义；RICE value_score 保持空，不伪装为未填写的加权结果。
- 共享测试迁移链补齐 v5.29–v5.31，运行时代码明确依赖已迁移字段。RICE 实际历史专项核验影响 2.00、观测引用、当前有效状态和空价值分；专项通过（1.725s）。
- 隔离 MySQL 全量 productcenter 与 aims Runtime 包回归通过（45.461s /3.512s），覆盖此次共享迁移和读取变更。RICE 前端历史展示、评估 Runtime/BFF/UI 等剩余范围继续。

### 2026-09-08：RICE 评估历史前端展示

- 历史页按 model_method 展示 RICE 影响系数/置信度/投入和 RICE 人日分，不再把空 value_score 显示为待评估的加权价值分。
- 展示本次冻结 Reach 数量/去重单位、窗口、来源、方法和观测 UUID，并提供事项 Reach 历史入口；无引用保持未知，不读取当前观测覆盖历史。
- 校验方法、影响枚举、观测与产品/事项/模型/引用身份及有分数时证据完整性。相关 ESLint 与全应用 typecheck 通过；浏览器专项以及 RICE 评估 Runtime/BFF/表单继续。

### 2026-09-08：RICE 评估 Runtime 提交与精确授权

- 接入 planning-assessments:rice-create，委托 actor、rice-assess 精确服务能力与产品 assess permit 调用 RICE 评估领域事务；与普通加权提交输入分开。
- 清除边界测试复制残留，补充普通 assess、reach-record 能力不能替代 rice-assess 的断言；方法、输入解码和委托身份专项通过（0.368s）。
- 当前 Console 生成授权为 156 条业务 grant /162 项要求，隔离 MySQL 脚本验证幂等初始化、缺失客户端、无关客户端、传输前提、禁用授权及过期凭证通过。未安装目标环境授权。
- API 文档统一更新 RICE 当前状态，避免旧描述误称领域周期/持久评估尚未实现。Runtime 实际成功重放、浏览器提交 BFF/表单与完整方案其余范围仍待继续。

### 2026-09-08：RICE 浏览器评估提交接口

- 新增独立 rice-assessments POST 路由，绑定周期/事项路径、五项预期修订、可信 actor、产品 assess 授权及 rice-assess 服务能力；保留幂等键和服务错误状态，拒绝查询覆盖。
- 提取加权/RICE 共用输入及证据校验，RICE 仅接受观测 UUID 和影响/置信度/人日投入；未知使用显式 null，禁止客户端 Reach、加权维度及计算分数。
- 输入回归 6 项与实际路由 handler VM 专项 2 项通过，输入及路由 ESLint、全应用 typecheck 通过。浏览器评估表单、实际 Runtime 成功重放及完整方案剩余功能继续。

### 2026-09-08：RICE 候选读取与列表语义

- 候选 assessment 返回 model_method、rice_impact，读取校验方法有效性，RICE 保留空加权 value_score 与实际推荐分；候选页面按方法展示影响系数，避免误报未知加权价值。
- 扩展实际 MySQL RICE 链路验证推荐查询返回 method=rice、影响 2.00、分数 90.00000000、当前有效且价值分为空（0.872s）；原候选事务回归通过（0.726s）。页面 ESLint 修复后通过，全应用 typecheck 通过。
- 现有价值—投入矩阵继续按原加权坐标规则返回未绘制 RICE 项，尚未完成 RICE 矩阵展示。此次未进行浏览器视觉验收；评估表单与完整方案其余范围继续。

### 2026-09-08：RICE 前端冻结模型兼容校验

- 新增共享 productRICEModel，核对冻结版本、有效日期/窗口、去重对象/来源定义、人日单位、影响/置信度枚举及计算精度；不将前端兼容检查冒充持久模型或数据来源验证。
- Reach 创建页禁用不完整或不支持的 RICE 版本，并在提交前复核，避免未知对象单位被默认展示为客户企业数后仍可提交。
- RICE/加权兼容规则 5 项通过；修复测试动态 delete 的 ESLint 问题后相关 ESLint 及 RICE 2 项复验通过，全应用 typecheck 通过。RICE 评估表单及浏览器验收仍待完成。

### 2026-09-08：评估表单按模型方法提交

- assess 页面识别受支持的 RICE 冻结快照，共用表单按方法显示维度：RICE 影响/置信度/投入，加权保留原六维度；载荷按当前维度过滤，影响值保留十进制字符串。
- RICE 调用 rice-assessments，复用证据引用、投入确认、稳定载荷幂等重试与保存中导航保护；确认摘要包含 Reach 引用。
- 当前 Reach 为手工复制历史 UUID 的暂时交互，提供新标签页历史入口；分页选择和观测详情预览待继续。相关 ESLint 与全应用 typecheck 通过，浏览器与视觉验收尚未完成，不能视为 RICE UI 已最终验收。

### 2026-09-08：RICE 评估 Reach 分页选择

- 新增 RICEObservationPicker，评估表单替换手填 UUID，每页 20 条真实分页并显示总数；仅同模型、当前范围/证据修订且未过期观测可选，跨页保留已选详情，可清空为未知。
- 详情展示 Reach、窗口、去重定义、来源定义/引用、取数方法、记录人/时间；校验响应身份、产品/事项修订及观测基本字段，读取错误清除选择并提示重新读取评估。
- 组件接入后全应用 typecheck 通过，相关 ESLint 通过。浏览器实际交互、1440/390 视觉验收、RICE 周期选择页面及完整方案其他范围仍待继续。

### 2026-09-08：周期模型选择页支持 RICE

- 周期模型选择按发布方法调用冻结规则兼容检查，允许 RICE 选用并展示统计窗口、去重对象/定义、来源定义及有效 Reach 前提；加权版本继续显示权重。
- 选用回执按所选方法验证模型快照，保留草稿状态、修订、原因、稳定幂等重试及导航保护。实际数据就绪由后端原有事务校验，前端不以发布定义推断数据已就绪。
- 模型规则/输入 9 项通过，页面 ESLint 和全应用 typecheck 通过。RICE 全流程浏览器、1440/390 视觉验收和完整方案其余范围继续。

### 2026-09-08：RICE Reach 选择器真实浏览器交互

- 在隔离 Nuxt 环境运行仓库实际评估页/组件，以 QA-RICE mock API 提供 21 条观测，不连接业务数据库。
- Chrome 实际操作验证首屏 20 条、第二页 1 条与总数 21；不同模型及过期记录按钮禁用；第二页 450 用户可选，窗口/去重定义/来源引用/取数方法/记录人详情正确。
- 返回第一页后所选 450 用户详情保持，点击清除后消失；页面仅展示 RICE 三维度。此为 DOM 交互证据，不代表实际 JWT、真实保存链路或 1440/390 视觉检查通过。
- 隔离 fixture 位于 /tmp/hzy-product-ui.86N8zY/server/middleware/qa-rice.ts，后续继续保存、异常与视觉验收。完整方案未完成。

### 2026-09-08：RICE 评估审计失败原子性

- 扩展实际 MySQL RICE 完整领域链路，在保存评估前以隔离数据库触发器强制审计 INSERT 失败。
- 明确核验失败后无 RICE 评估行、无当前候选评估引用、无 rice-assess 命令回执；产品和周期修订保持请求前值。
- 移除故障后使用同一身份/幂等键继续保存及重放，原有 90.00000000 分、历史与候选读取断言全部通过（0.818s）。证明失败未污染重试状态，不代表浏览器到 Runtime 的全链路已验收。
- 后续继续 Runtime 总入口实际评估保存、浏览器提交/异常/视觉检查及完整方案其余范围。

### 2026-09-08：RICE 评估 Runtime 总入口实际写入与重放

- 扩展 PriorityModelsThroughRuntime，使用实际隔离 MySQL 创建完整预算/指标周期、添加候选，经 Runtime 选择 RICE，再以领域开放命令进入评估状态，没有 SQL 伪造开放状态。
- 通过 Adapter.HandleRuntime 的 planning-assessments:rice-create 实际提交和重放，验证精确 rice-assess 能力路径、operation/统一信封、同回执及当前历史一条；保存 RICE 分数 90.00000000、评估人 pm、加权价值为空。
- 核验产品修订最终 11、周期修订 5、队列修订 2，评估重放不重复递增且不改队列。实际 MySQL 专项通过（0.808s）。
- 此为受信 Adapter 上下文与真实数据库集成，不等同 Console JWT 签发、浏览器到真实部署的端到端验收；浏览器保存/异常/视觉与完整方案其余范围继续。

### 2026-09-08：评估保存回执完整性

- 修正共用评估表单只检查 code=0 即提示成功的问题；现在核验 receipt_id/replayed、assessment_id、事项/周期身份、产品/周期修订增量、队列修订保持及评分完整性。
- RICE 要求加权价值为空；加权有推荐分必须有 0–100 整数价值分，未知分数与 missing 列表保持一致。无效回执保留载荷/幂等键供重试，不跳转成功页。
- 3 项回执专项通过，相关 ESLint 与全应用 typecheck 通过。此前浏览器 QA-RICE 的空成功 mock 需升级为完整回执后再继续保存验收；不降低校验适配旧 mock。

### 2026-09-08：RICE 浏览器未知评估失败重试

- 升级隔离 QA-RICE 保存 fixture：首次 POST 503，后续仅当载荷与 Idempotency-Key 均与首次完全一致才返回完整命令回执；拒绝加权字段和缺幂等键。
- Chrome 实际操作未知评估保存，确认摘要正确显示 Reach/影响/置信度/投入未知；确认中输入/选择/分页及返回按钮禁用。首次失败后展示具体错误并留在表单，未知值不变。
- 再次确认保存通过 fixture 严格相同载荷/键检查，完整回执通过前端校验后跳转历史页。历史仍为空的隔离 mock，不将该跳转声明为真实数据持久化。
- 已填写维度/证据提交、浏览器真实服务与 1440/390 视觉验收仍待完成，完整方案继续。

### 2026-09-08：完整 RICE 评分浏览器提交与重试

- Chrome 实际填写 Reach 450、影响 2.00、置信度 0.80、投入 8.00，新增一条有日期证据，填写三个维度依据并分别引用，确认投入后提交。
- 隔离 mock 严格检查实际 POST 的三项十进制字符串、观测引用、投入确认和证据引用；首次模拟 503 后字段/证据/勾选保留，再次提交要求相同载荷及幂等键，返回完整 90.00000000 回执后前端跳转历史。
- 验收发现证据复选框名称重复，已给可见标签和 aria-label 加入维度名；浏览器确认三个引用可分别定位与勾选，相关 ESLint 通过。
- 此为实际仓库页面与隔离 mock 交互，历史 mock 仍为空，不声称实际部署持久化或 Console JWT 验收。1440/390 视觉、RICE 周期选择浏览器及完整方案剩余范围继续。

### 2026-09-08：RICE 集成后整体数据库回归与矩阵状态修正

- 当前 worktree 的 productcenter 与 aims Runtime 全包在专用隔离 MySQL 运行通过（47.658s /3.816s），覆盖新增候选模型字段、RICE 审计失败回滚、Runtime 保存/重放及已有规划/版本流程。
- 修正矩阵列表将 RICE 一律误报为评估缺失的文案：未绘制原因明确为不使用加权价值坐标，显示 RICE 影响及实际推荐分；未将 RICE 强行放到 0–100 加权价值轴。
- 页面 ESLint 与全应用 typecheck 通过，API 文档增加当前实现状态。RICE 专用矩阵、桌面/移动视觉、真实部署验收及完整方案其他范围仍未完成。

### 2026-09-08：RICE 推荐分／投入矩阵

- 矩阵 API 增加周期 model_method，完整当前 RICE 评估进入 points，不要求或伪造加权 value_score；方法不匹配/过期/未知保持未绘制。
- 前端按方法切换纵轴：加权保持 0–100 价值，RICE 使用实际人日推荐分并按当前有界点集缩放；RICE 隐藏加权价值水平阈值，保留人日投入参考线、类别和截断提示。
- 实际 RICE 矩阵专项通过（0.959s），原加权评估/矩阵完整事务回归通过（0.893s）；页面 ESLint 与全应用 typecheck 通过。浏览器坐标、零分/大值与视觉验收仍待完成，完整方案继续。

### 2026-09-08：矩阵零值与精度边界

- 提取共用矩阵点校验和纵轴投影，要求完整模型方法、八位推荐分、有效人日投入及固定置信度，未知/空值不转为零，过期或方法混用拒绝。
- 边界测试发现浮点转换吞掉 RICE 上限 +0.00000001，改以 BigInt 八位整数比较边界，绘图时再转 Number。验证已知零、90、最大 6000000000、非法超界/空分/人日/置信度及加权模型。
- 两项边界专项、相关 ESLint 和全应用 typecheck 通过；实际浏览器矩阵与桌面/移动视觉验收仍待完成，完整方案继续。

### 2026-09-08：RICE 矩阵浏览器边界展示

- 隔离 QA-RICE mock 提供零分、90 分、最大 6000000000 分和一条过期评估，Chrome 打开仓库实际矩阵页。
- DOM 验证返回 4/可绘制 3/未绘制 1，SVG 辅助标题与纵轴均为 RICE 人日分，纵轴最大值 6000000000，点标题包括零/正常/最大值；说明仅显示投入 5 人日参考线。
- 列表保留八位分数，零分显示为已绘制，过期评估明确未绘制。此为 DOM/语义展示检查，不证明像素坐标或 1440/390 视觉验收通过。
- 完整方案剩余功能、视觉与实际部署联调继续。

### 2026-09-08：受众保存视图定义与查询规则

- 开始 PC-14 剩余受众/保存视图，定义 planning/delivery/stakeholder 展示方式与 personal/product 可见性，仅保存名称和周期/季度筛选，不携带 actor、permit、正文或分页大小。
- 从季度路线读取提取 ValidateQuarterRoadmapQuery，保存定义复用相同 UUID/年份/季度/分页约束，避免生成绕过既有边界的查询。
- 纯规则与实际 MySQL 季度读取回归通过（0.744s）；新增 API 设计文档明确授权/投影边界。当前尚无持久化命令或 UI，不宣称保存视图已可使用。完整方案继续。

### 2026-09-08：保存视图存储迁移

- 新增 v5.32 product_roadmap_saved_views，绑定产品/周期复合外键与创建者，保存受众、可见性、季度筛选、修订及审计字段，不保存授权或业务正文；同步 canonical 和测试迁移链。
- 实际 MySQL 验证合法个人视图、跨产品拒绝、空创建者/名称、非法受众/公开可见性/季度拒绝，重复迁移保留一条记录；canonical 与增量 schema 对照通过（双专项 1.833s）。
- 目标环境未迁移；授权领域命令、读取/应用视图、Runtime/BFF 和页面仍待继续，完整方案未完成。

### 2026-09-08：保存视图创建领域命令

- 新增 CreateRoadmapSavedView，个人视图需要规划/路线图双 view，共享视图需要规划 view 与路线图 edit；owner 绑定可信 actor，核对活动产品、修订和周期归属。
- 定义、产品修订、审计与幂等回执同事务保存，不改周期决定队列；重放重新授权。
- 实际 MySQL 验证审计失败无新增视图、恢复后同键成功与重放，共享视图仅 view 拒绝、edit 成功，最终三条记录归属 pm；专项通过（0.705s）。读取、修改/删除、Runtime/BFF/UI 继续。

### 2026-09-08：保存视图权限过滤分页

- 新增 ListRoadmapSavedViews，要求规划/路线图双 view；SQL 计数与列表均限本人个人或产品共享视图，按 ID 倒序、单页最多 100，返回当前产品修订。
- 个人视图审计改为仅记录标识/可见性/owner/修订，避免产品日志泄露个人名称及筛选定义。
- 实际 MySQL 专项验证他人个人不可见且不计数、他人共享可见、两页/超末页、分页上限和缺路线图授权拒绝；后续继续详情/应用、修改删除和 Runtime/BFF/UI。

### 2026-09-08：保存视图详情与授权事务内应用

- 新增详情读取，按产品/UUID/本人个人或共享过滤，不可见和不存在返回同一无记录结果；保留规划/路线图双授权。
- 新增 ApplyRoadmapSavedView，在同一授权事务内读取定义和季度路线数据；提取 loadQuarterRoadmap 复用原查询，不复制创建者授权，不允许视图覆盖分页边界。
- 实际 MySQL 保存视图与原季度路线回归通过，覆盖详情一致、应用周期/季度/分页/修订以及个人/缺授权拒绝。当前应用返回现有可访问路线数据，受众展示投影及接口/页面继续。

### 2026-09-08：保存视图修改与可见性边界

- 新增 UpdateRoadmapSavedView，要求产品/视图双修订，保持 owner 不变；个人视图限本人，旧/新任一共享要求路线图 edit，可见性切换限创建者。
- 复用当前双授权、周期归属、审计隐私与幂等事务；成功只增加一次视图/产品修订，不改季度队列。
- 实际 MySQL 验证查看权限不能修改共享、编辑成功与重放、双修订结果、旧视图修订拒绝、非 owner 不能将共享转个人、他人个人视图不可修改。删除/Runtime/BFF/页面及完整方案其余范围继续。

### 2026-09-08：保存视图删除状态与读取过滤

- 新增幂等 v5.33 deleted_at 迁移，同步 canonical 与测试迁移链；保留身份/owner/可见性用于后续删除重放授权。
- 列表及总数、详情、应用统一排除已删除记录；更新亦经正常详情读取而不能重新修改已删除定义。
- 实际 MySQL 以明确 SQL fixture 标记删除，验证三个读取入口隐藏、原记录仍存在；与 canonical/增量 schema 对照双专项通过（1.962s）。删除事务命令、Runtime/BFF/UI 仍待完成。

### 2026-09-08：保存视图删除事务与重放

- 新增 DeleteRoadmapSavedView，以产品/视图双修订删除标记；个人本人双 view，共享 edit，授权读取包含已删除记录以重放时重新检查当前权限。
- 替换原 SQL 删除 fixture 为实际领域命令，验证同回执重放、缺当前 edit 拒绝、正常列表/详情/应用隐藏且身份保留。
- 注入审计失败验证删除标记/视图修订回滚，恢复后同键成功，最终产品修订 5/视图 3 仅递增一次。实际 MySQL 专项通过；Runtime/BFF/UI 与完整方案剩余范围继续。

### 2026-09-08：保存视图 Runtime 读取入口

- 接入 roadmap-views:list/view/apply，精确 roadmaps:read、可信委托 actor、路线图/规划双 permit；各动作独立输入解码，复用领域分页/可见性/同事务应用。
- 总入口分发和只读传输登记同步，读取 grant 数量不变。Runtime 方法/能力/解码/委托边界专项通过（0.402s）；只读传输专项覆盖新增三个路径。
- 实际 Adapter 成功集成、写接口和浏览器 BFF/UI 尚待继续，完整方案未完成。

### 2026-09-08：保存视图 Runtime 写接口与精确 grant

- 接入 roadmap-views:create/update/delete，独立受限输入、可信 actor、双 permit、幂等键与 view-create/view-update/view-delete 精确服务能力。
- Manifest、生成器、Console seed/verify 及服务授权文档同步为 162 条业务 grant /168 项要求；隔离 MySQL 验证初始化幂等、缺失客户端、无关客户端、传输依赖、失效授权和过期凭证通过。
- Runtime 六动作方法/能力/解码/委托边界通过，补测 roadmaps:read 不能写入。目标环境未安装授权，实际成功链路/BFF/UI 与完整方案其他范围继续。

### 2026-09-08：保存视图 Runtime 六动作实际数据库集成

- 扩展模型/规划 Runtime 集成，在现有实际候选周期上创建 personal delivery 视图，所有保存视图操作通过 Adapter.HandleRuntime 总入口。
- 验证 create/list/view/apply/update/delete operation/信封；应用未排期视图返回实际一条候选且队列修订 2；三个写动作同键重放复用原回执。
- 最终删除后列表零条，产品修订从 11 到 14 仅按三次写入递增。专项实际隔离 MySQL 通过（0.926s）。BFF、受众投影和页面仍待接入，完整方案继续。

### 2026-09-08：保存视图浏览器请求校验

- 新增定义/写入/读取输入 helper，绑定路径 UUID 和完整修订，映射季度筛选；受众/可见性枚举和 explicit unscheduled 与领域规则一致。
- 创建者/授权/产品覆盖及未知字段拒绝，delete 不能夹带新定义；list/apply 仅受限分页，view 无查询覆盖。
- 两项输入专项和相关 ESLint 通过。路由授权代理、权限快照、受众页面与完整方案其余范围继续。

### 2026-09-08：保存视图浏览器代理与权限快照

- 通过现有 roadmaps catch-all 的 views/ 子路径接入列表/详情/应用/创建/修改/删除及 permissions，保持旧路线图分发；双 view 与可选 edit 的产品/actor/修订/成员事实必须一致。
- 写入绑定路径、可信 actor、稳定幂等键与精确 view-* 能力；共享创建缺 edit 立即拒绝，更新/删除最终按持久定义授权，个人删除可使用显式 edit permit。
- 输入两项、代理与实际路由分发五项专项通过；相关 helper/路由 ESLint、全应用 typecheck 通过，领域 MySQL 回归通过（0.978s）。
- 曾新增并列 roadmap-views catch-all 导致 Nitro 全局路由类型推导过深，已移除并复用 roadmaps/views/，对文档调用尝试的类型改动全部撤回。页面/受众投影及完整方案其余范围继续。

### 2026-09-08：保存视图列表与初步受众展示

- 新增产品 views 页面，列表与应用事项独立真实分页；核对产品、视图/周期身份、分页/总数和受众枚举，失败明确展示，不把未加载当空结果。
- 规划显示范围/决定顺序，交付突出时间窗口，干系人概览简化内容；保持相同授权数据和队列，明确当前规划不构成承诺。季度路线页新增入口。
- 修复模板成功分支内无意义 pending 比较后，相关 ESLint 和全应用 typecheck 通过。创建/编辑/删除管理入口、目标/承诺展示增强、浏览器及视觉验收继续。

### 2026-09-08：季度路线保存视图弹窗

- 新增 SaveRoadmapView 并接入季度路线页，沿用当前周期/季度/未排期筛选；名称/受众/可见性三字段弹窗，读取当前权限和产品修订，共享限 edit 且需 Foundation 确认。
- 保存绑定可信接口、稳定幂等键和完整定义，核对回执身份/owner/修订/定义；保存中禁止关闭/导航，失败保留文字并提供显式权限刷新。
- 修复权限类型被 null 控制流窄化为 never 后，相关 ESLint 和全应用 typecheck 通过。浏览器创建/视觉、修改删除管理入口及完整方案其余范围继续。

### 2026-09-08：保存视图删除管理入口

- 列表按当前权限显示删除按钮，个人限本人，共享要求 edit；提交前读取产品/视图双修订并使用 Foundation 确认，成功核对完整删除回执。
- 每个视图分别保留失败请求的载荷与幂等键，取消首次确认不冻结修订；删除期间禁用列表刷新、应用和分页，产品切换清理旧重试状态。
- 管理权限加载失败提供提示与重试，确认删除成功后将列表刷新失败单独报告，避免误报删除失败。
- 页面 ESLint、全应用 typecheck 和保存视图输入/BFF 七项专项通过。删除交互尚未完成浏览器/视觉验收，编辑入口及完整方案其他范围继续。

### 2026-09-08：保存视图编辑弹窗

- 新增 EditRoadmapView 并接入保存视图列表；读取当前权限与定义，核对产品/视图身份、owner 和一致的产品修订，六字段编辑保留原规划周期。
- 个人限本人，共享需 edit；可见性切换仅创建者且需 edit。共享影响经 Foundation 确认，PATCH 带产品/视图双修订，相同载荷重试复用幂等键，成功核对完整回执后刷新列表与已应用视图。
- 保存期间阻止路由切换并禁用列表操作，失败保留草稿，显式重读支持保留输入。新增组件及列表 ESLint、全应用 typecheck 通过；实际浏览器与视觉验收尚未执行，完整方案继续。

### 2026-09-08：保存视图编辑/应用/删除浏览器验证

- 复用隔离 Nuxt 界面环境加载实际仓库组件和页面，新增 QA-SAVED 内存接口 fixture；使用 Chrome 实际点击与 DOM 快照验证，不连接目标业务数据库。
- 编辑弹窗载入共享视图现值，改名后 Foundation 确认；首次 PATCH 模拟 503，草稿与错误可见，重试接口严格核对同一载荷及幂等键，成功后列表显示新名称。
- 应用后显示新名称及空事项说明；删除确认说明共享影响，期间刷新/应用/分页禁用。首次 DELETE 模拟 503 后仍保留列表和应用结果，同键同载荷重试成功，列表归零且已应用区清除。
- 本轮证据覆盖浏览器编辑/应用/删除及失败重试，不包含创建流程、完整权限组合、真实 Console JWT、桌面/移动视觉验收；这些验收与完整方案其余范围继续。

### 2026-09-08：保存视图交付状态与承诺摘要

- 保存视图增加事项生命周期和选入状态，交付/干系人受众可按需查看最新承诺窗口及需复评状态，并进入现有承诺历史查看依据。
- 新组件复用既有双授权承诺历史 API，仅请求第一页一条，校验最新 ID、事项/产品归属、时间和复评字段一致性；未请求、失败和暂无承诺分别展示，不将探索窗口推断为承诺。
- 相关 ESLint、全应用 typecheck 和路线图代理八项专项通过；新增摘要浏览器/视觉验收与目标信息接入仍待继续，完整方案未完成。

### 2026-09-08：保存视图周期目标上下文

- 新增 RoadmapCycleGoal，保存视图应用后读取当前周期目标摘要、状态、指标名称/方向/测量口径、基线与目标值；十进制字符串原样展示，零值与未知分开。
- 复用既有授权周期详情 API，核对产品/周期身份和响应字段，失败显示错误与重试，未配置指标有明确说明；链接指向实际存在的周期规划事项页。
- 周期目标是整条路线的上下文，页面明确不把它当作每个事项已关联产品战略目标。产品目标的反向关联查询及浏览器/视觉验收仍待继续。相关 ESLint 和全应用 typecheck 通过。

### 2026-09-08：周期目标与承诺摘要浏览器验证

- 隔离 QA-SAVED fixture 使用实际保存视图页面和新增组件，经 Chrome 应用干系人视图，验证周期名称、目标摘要、指标方向及测量口径展示。
- 基线 0.000000 保留为零，目标 null 显示未记录；事项显示交付中/已选入。点击前仅显示承诺查询入口，点击后显示最新窗口与需要复评且原承诺保留，历史链接绑定正确事项。
- 本轮为真实浏览器操作与 DOM 证据、模拟接口数据，不是 Console JWT/目标环境端到端或 1440/390 视觉验收。创建流程、产品战略目标反向关联和完整方案其他范围仍待继续。

### 2026-09-08：重新应用保留承诺展开状态

- 核对发现重新应用时成功状态条件会卸载整个展示区，已展开承诺随之收起。改为加载时暂时隐藏已有展示区，成功结果更新后显式刷新周期目标及已展开承诺，未展开摘要仍按需读取。
- 应用失败仍移除展示区并显示原有错误，避免将失败当成功。相关类型检查通过；刷新交互的浏览器回归待继续。

### 2026-09-08：重新应用摘要刷新浏览器回归

- 隔离 fixture 为目标读取增加计数、第二次承诺读取返回不同结束日期；Chrome 实际应用并展开承诺后点击重新应用。
- 目标计数从 1 变 2，承诺结束日期从 2026-09-30 变 2026-10-15，承诺保持展开且历史入口可见，证明关联摘要重新请求且状态保留。
- 证据为实际仓库页面在隔离模拟接口上的浏览器 DOM 回归，不包含真实登录与视觉验收。完整方案其他范围继续。

### 2026-09-08：规划事项反向目标领域查询

- 新增 ListPlanningItemObjectives，按事项 UUID 读取真实 product_objective_items 关联，要求 product_objectives/view 与 product_priorities/view 双授权。核对产品归属，返回目标身份/状态/修订、贡献说明、关联人时间和事项/产品修订，真实 SQL 分页；不由周期映射推断事项关联。
- 扩展既有实际 MySQL 目标事项关联专项，验证反向目标与贡献一致、第二页为空但总数保持、缺规划权限拒绝、非法 UUID 拒绝。专项通过（0.847s）。Runtime、BFF、页面尚待接入，完整方案继续。

### 2026-09-08：事项反向目标 Runtime 入口

- 新增 objectives:item-objectives 分发、精确 product-objectives:read 能力、可信委托 actor、独立 planning_authorization 与受限事项分页输入；接入双授权领域查询并登记只读传输，授权 grant 数量不变。
- Runtime 边界专项覆盖方法、错误能力、委托缺失、第二份 permit 格式和输入 actor 覆盖拒绝；只读传输专项通过。此前领域实际数据库查询已有验证，本轮尚未验证 Runtime 成功数据库链路，BFF/UI 继续。

### 2026-09-08：事项关联目标浏览器代理

- 复用 objectives catch-all 新增 for-item/{UUID} GET 读取，严格产品/事项身份与分页，拒绝授权参数覆盖；目标与规划双 view 事实一致后使用可信 actor 和精确只读能力转发。
- 两项代理专项覆盖双权限、路径/分页、actor 绑定，以及方法/非法 UUID/分页上限/权限拒绝/事实混合/运行服务错误。相关 ESLint、全应用 typecheck 通过；Runtime 成功数据库链路与页面接入继续。

### 2026-09-08：路线图事项关联产品目标展示

- 新增 PlanningItemObjectives 并接入保存视图所有受众的事项卡片，按需读取真实目标关联；显示目标名称、状态、贡献说明及目标详情入口，不从周期目标推断关联。
- 每页 10 条真实分页，校验事项/产品身份、修订、总数和目标字段；失败明确提示并可重试，零记录与未读取区分。重新应用时刷新已展开的关联目标，未展开仍不请求。
- 相关 ESLint 与全应用 typecheck 通过；新组件浏览器/视觉、Runtime 成功数据库链路和完整方案其他范围继续。

### 2026-09-08：事项关联目标 Runtime 实际数据库集成

- 扩展现有目标 Runtime 实际 MySQL 集成，通过 Adapter.HandleRuntime 总入口执行 item-objectives 查询，按当前事实提供目标与规划双 permit，核对 operation 和标准信封。
- 验证建立关联后目标身份/贡献/事项与产品修订正确；第二页为空且总数保持；更新贡献后读取新内容与产品修订 10；解除关联后总数与列表归零、产品修订 11。
- 完整目标 Runtime 专项通过（0.924s）。页面浏览器/视觉验收和目标环境真实授权链路仍待继续，完整方案未完成。

### 2026-09-08：关联产品目标分页浏览器验证

- 隔离接口提供 11 个真实分页 fixture，Chrome 操作实际保存视图页面：应用后点击查看关联产品目标，第一页显示 1–10，状态/贡献说明/目标详情链接均正确；点击第二页只显示第 11 个目标，总数仍为 11，下一页禁用。
- 本轮是实际浏览器操作与 DOM 验证，数据来源为模拟接口，不包含真实授权链路或桌面/移动视觉验收。完整方案其他范围继续。

### 2026-09-08：保存视图与目标关联后的整组数据库回归

- 在既有隔离 MySQL socket 执行 `HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.5lV20A/mysql.sock go test ./internal/apps/aims/productcenter ./internal/apps/aims -count=1`，两包通过：领域 46.632s，Aims Runtime 3.888s。
- 此次覆盖新增 v5.32/v5.33 保存视图、季度读取复用、RICE 和事项反向目标查询与既有规划/版本/交付测试的组合回归；不等同于目标环境迁移、真实 JWT 或视觉验收。
- 已核对 PC-15 发布范围对比可复用现有 ReadProductVersionRelease 不可变 scope/acceptance 快照和内容 hash 校验；legacy_import 无快照时必须明确不可比较，不能补用当前版本范围。PC-15 实现仍待继续。

### 2026-09-08：PC-15 发布范围差异计算

- 新增 CompareReleaseScopes 纯差异计算，消费已校验的不可变发布详情；缺快照、非 verified 或跨产品拒绝，不使用当前范围补历史。
- 按范围记录 ID 匹配，按 ID 确定性排序，统计新增/移除/变更/未变；变更保存完整前后快照，包含类别、公开性、验收标准、规划/功能引用与顺延来源。不将同名或相同功能的不同范围合并；跨版本顺延仍为独立范围增减，保留来源用于后续 UI 追溯。
- 纯规则测试通过（0.338s），覆盖三类差异、未变、顺序、同名顺延不误合并、输入不变、重复标识/缺快照/跨产品拒绝。此函数不自行授予权限，授权读取与对比分页 API、页面和完整 PC-15 范围继续。

### 2026-09-08：发布范围对比授权读取与分页

- 提取现有发布详情事务内 loader，原单条读取仍保留授权与提交；新增 ReadReleaseScopeDiff，在单一授权事务中读取两份同产品发布记录并复用 hash/归属校验。
- 返回内容哈希、产品修订、差异总数及分页；四类计数基于完整差异，分页仅截取 changes，不以当前范围替代快照。
- 扩展实际发布集成验证同快照比较为零差异/一项未变且 hash 一致、错误权限拒绝及错误版本归属拒绝；发布/验收/归档相关专项通过（1.681s）。不同发布之间的实际分页对比、Runtime/BFF/UI 继续。

### 2026-09-08：跨发布记录对比回归与 Runtime 入口

- 实际 MySQL 以原发布和修正发布对比，验证一项变更、前后标题与不同内容 hash；第二页为空但完整统计保持。再次修改当前范围后，对比仍返回原冻结标题。实际验收/发布专项通过（0.856s）。
- Runtime 新增 versions:release-diff，精确 product-versions:read、可信 actor、受限输入和既有版本 view permit；登记为只读传输。版本 Runtime 边界及只读传输专项通过。BFF、页面和 Runtime 成功数据库链路继续。

### 2026-09-08：发布对比浏览器输入与代理

- 新增 productReleaseDiffInput 与代理，GET /api/v1/products/{code}/roadmaps/release-diff，参数 beforeVersionId/beforeRecordId/afterVersionId/afterRecordId/page/pageSize；仅接受正整数身份和受限分页，拒绝未知参数。
- 当前版本 view 权限、可信 actor、精确 product-versions:read 转发，no-store，运行服务错误保留。独立 versions 路由曾触发 Nitro 类型推导过深，已删除并复用既有 roadmaps catch-all；全应用 typecheck、相关 ESLint、输入与路由回归通过。
- 发布对比代理授权专项、页面和 Runtime 成功链路仍待继续。

### 2026-09-08：发布对比 BFF 授权专项与契约

- 新增代理专项，验证前后发布标识/分页方向、版本 view 权限、可信 actor、精确只读能力、no-store；方法/客户端覆盖/权限拒绝/错误产品在传输前拒绝，服务不可用与错误信封保留。与输入专项合计三项通过。
- 新增 Aims-Release-Scope-Comparison-API.md，明确不可变快照、完整统计与分页、范围标识和顺延追溯规则及剩余交付。Runtime 成功数据库链路与对比页面继续。

### 2026-09-08：发布对比 Runtime 成功数据库链路

- 扩展既有项目交付到产品发布的实际 MySQL Runtime 集成，在已发布记录上经 Adapter.HandleRuntime 调用 versions:release-diff。
- 验证标准信封/operation、产品/前后记录身份、双内容 hash、产品修订与分页，以及同记录对比一项未变/零差异；错误版本归属拒绝。整条交付发布专项通过（0.996s）。
- 不同发布的差异及分页已由领域实际数据库专项覆盖；Runtime 本轮成功例为同发布对比。页面、浏览器与视觉验收继续。

### 2026-09-08：发布对比选择组件

- 新增 ReleasePicker，按所选版本读取每页 10 条发布记录，校验身份/分页/证据级别和状态；显示发布序号、时间及当前/撤回/更正标记，legacy_import 不可选择并解释缺快照原因。版本切换清空旧发布选择，提供失败重试和跨页已选摘要。
- 现有 VersionPicker 新增 includePublished 可选开关，允许对比流程选择已发布/归档版本；默认仍限制规划中/开发中，保持既有交付选择行为。
- 两组件 ESLint、全应用 typecheck 通过；组合到对比页面及浏览器/视觉验收继续。

### 2026-09-08：发布对比页面初版

- 新增 release-comparison 页面并从产品版本列表提供入口，双侧复用版本/发布选择，切换选择清空旧结果；调用只读对比接口并校验身份、hash、完整计数及差异形态。
- 显示新增/移除/变更/未变统计，前后名称、描述、验收标准、状态、类别、公开性、顺序、变更类型、顺延来源及功能/规划链接；每页 20 项真实差异分页。加载期间禁用选择、阻止路由离开；失败显示错误。
- 页面 ESLint 和全应用 typecheck 通过，浏览器选择/分页/失败恢复、完整响应校验增强与视觉验收待继续，完整方案未完成。

### 2026-09-08：发布对比完整响应校验

- 提取 productReleaseDiff 展示类型与校验，检查分页实际应返回数量、完整统计、前后身份/hash、变化类型、范围 ID 严格递增/不重复及前后快照形态。
- 补齐冻结字段校验，包括状态、可空描述/验收/类别、布尔字段、顺序、变更类型、顺延来源；关联功能/规划链接只接受规范 UUID。
- 专项验证合法结果、缺页内容、重复范围、不完整字段、非法状态/链接及超末页；测试、相关 ESLint 和全应用 typecheck 通过。浏览器与视觉验收继续。

### 2026-09-08：发布对比选择与结果浏览器验证

- 隔离 QA-DIFF 接口加载实际页面，Chrome 选择前侧 v1/首次发布、后侧 v2/首次发布，验证选择完整前比较按钮禁用，比较后显示变更 1、前后描述、验收标准与冻结属性。
- 随后切换前侧版本，旧发布选择和差异结果清除，比较按钮再次禁用，后侧选择保留。
- 本轮为模拟接口上的实际浏览器 DOM 验证；多页差异、错误恢复、视觉及真实授权端到端仍待完成，完整方案继续。

### 2026-09-08：发布对比分类计数一致性

- 响应校验增加当前页 added/removed/changed 与全量统计的约束；当前页分类不能超过完整数量，全部差异在同页时分类计数必须完全一致。
- 测试验证错误分类汇总拒绝，以及真实多页中当前页分类小于全量统计仍合法，防止把当页当作完整范围。两项展示校验测试和 helper ESLint 通过。浏览器多页/失败恢复与完整方案其余范围继续。

### 2026-09-08：发布对比多页与错误恢复浏览器验证

- 隔离模拟 21 项差异，Chrome 实际选择两份发布，第一页显示 1–20、全量变更和总数 21；第二页仅显示第 21 项，完整统计保持。
- 单次 GET 503 被请求库自动重试恢复；改为连续两次 503 后确认页面明确显示发布对比失败、保留两侧版本/发布选择、不显示旧差异。再次点击比较恢复第二页第 21 项，统计仍为 21。
- 本轮为模拟接口上的实际浏览器回归，不代替真实授权或桌面/移动视觉验收。完整方案继续。

### 2026-09-08：PC-15 功能版本矩阵领域查询初版

- 新增 ReadFeatureVersionMatrix，功能真实分页、1–10 个显式版本列，双 feature/version view 授权与版本产品归属检查；单次聚合当前范围状态，每范围行只计一次，返回计划中/已交付/已顺延数量，未关联为零。
- 保留用户版本列顺序；禁止重复/非法版本和超界分页。状态为当前范围事实，不把 delivered 数量当作已发布或已部署。
- 查询校验专项与编译通过；实际 MySQL 查询、顺延/发布证据增强、Runtime/BFF/UI 尚待继续，完整 PC-15 未完成。

### 2026-09-08：功能版本矩阵实际数据库验证

- 实际 MySQL 初次测试揭示既有 uk_pc_version_feature 唯一约束：同一功能在同一版本只有一条范围；修正 fixture 分别在三个版本建立 planned/delivered/deferred，另一个版本无关联。矩阵状态计数因此为 0/1，不表示同格多个范围。
- 验证显式列顺序、三类状态、未关联零值、无范围功能仍占一行、第二页与超末页总数、缺版本权限/版本不存在拒绝。查询与输入专项通过。Runtime/BFF/UI、顺延及发布证据增强继续。

### 2026-09-08：功能版本矩阵范围与顺延追溯

- 按既有功能×版本唯一约束，将状态聚合改为直接读取唯一范围，新增 scope_id、deferred_from_scope_id、deferred_from_version_id；未关联为 null 和零状态，不伪造范围身份。
- 顺延来源连同所属版本核对同产品，来源缺失/跨产品或重复单元范围明确拒绝；来源版本无需在当前所选列中，仍可追溯。
- 实际 MySQL 专项验证原范围身份、后继范围指向原版本与范围、未关联 null；输入与数据库专项通过（0.762s）。Runtime/BFF/UI 和发布证据仍待继续。

### 2026-09-08：功能版本矩阵 Runtime 接入

- 新增 features:version-matrix 只读动作，复用 product-features:read 精确能力和可信委托 actor；输入为 version_ids/page/page_size，分别解码功能 authorization 与 version_authorization，再执行双授权领域查询。只读传输登记同步，grant 数量不变。
- 能力边界、第二 permit/输入覆盖解码与方法专项通过，服务器只读分类专项通过。Runtime 成功数据库集成、浏览器代理和矩阵页面继续。

### 2026-09-08：功能版本矩阵浏览器代理

- 新增 GET /api/v1/products/{code}/roadmaps/feature-version-matrix，复用 catch-all；versionIds 为 1–10 个逗号分隔正整数且不重复，保留列顺序，page/pageSize 受限且拒绝未知字段。
- 当前功能/版本双 view 事实一致后转发 features:version-matrix，可信 actor、精确 product-features:read、短期双 permit、no-store；输入与路由六项回归、相关 ESLint 和全应用 typecheck 通过。
- 代理双权限专项、Runtime 成功数据库集成和矩阵页面仍待继续。

### 2026-09-08：矩阵代理权限专项与契约

- 新增矩阵 BFF 专项，验证列顺序/分页、可信 actor、精确只读能力与双 permit；权限拒绝、事实混合、错误产品和不安全查询在传输前拒绝，服务错误保持。与输入专项合计三项通过，代理 ESLint 通过。
- 新增 Aims-Feature-Version-Matrix-API.md，明确唯一范围格、完整功能分页、未关联与顺延语义及剩余范围。Runtime 成功集成与页面继续。

### 2026-09-08：功能版本矩阵 Runtime 成功集成

- 在隔离交付发布集成中以显式 SQL fixture 将当前范围关联测试功能，经 Adapter.HandleRuntime 总入口读取矩阵；不修改冻结发布快照。
- 验证标准信封/operation、产品修订、功能总数、所选版本、具体范围 ID 和 delivered=1（其他状态为零）。整条交付发布 Runtime 专项通过（0.984s）。该测试验证读取，不宣称 fixture 的 SQL 是正式功能关联写入流程。
- 矩阵页面、发布证据增强、浏览器/视觉及真实授权仍待继续。

### 2026-09-08：功能版本矩阵页面静态检查完成

- 页面已提供版本选择与移除（最多 10 个、保留顺序）、功能真实分页、当前范围状态、版本范围及顺延来源链接；版本列表增加入口，错误与空数据分别展示。
- 确认此前检查进程均已结束且无可恢复结果后，本轮重新运行页面/版本入口 ESLint 和全应用 typecheck，两者退出码均为 0。
- 此记录只证明页面实现和静态检查，不证明浏览器行为、响应式视觉或真实账号授权验收。发布证据增强及完整方案其余范围继续。

### 2026-09-08：功能版本矩阵浏览器交互验证

- 使用隔离 QA-MATRIX 模拟接口加载实际页面，Chrome 先加入 v2 再加入 v1，确认列顺序为功能/v2/v1，当前范围分别显示已交付/计划中，顺延来源链接指向 v1 范围。
- 21 个功能第一页显示 1–20，第二页仅显示无范围的功能 21、两列均为未关联，完整总数仍为 21。第二页移除 v2 后回到第一页且仅保留 v1；再移除 v1 后表格和分页清空，显示尚未选择版本。
- 本轮为实际浏览器上的模拟接口交互验证；错误恢复、1440/390 视觉、真实授权及发布证据增强仍待继续。

### 2026-09-08：功能版本矩阵错误恢复验证

- 隔离 QA-MATRIX 第二页连续两次 503（覆盖 GET 自动重试），实际 Chrome 显示矩阵读取失败，保留 v1 选择，隐藏第一页旧行和分页；点击刷新矩阵后恢复第二页功能 21/未关联，完整总数仍为 21。
- 修正失败空表提示：分页控件在错误状态不可见，因此改为引导刷新当前页或移除版本重新选择，避免提示不可执行的调整页码。页面 ESLint 通过。
- 模拟接口交互通过不替代 1440/390 视觉或真实授权验收；发布证据增强及完整产品中心其他范围继续。

### 2026-09-08：矩阵最新发布证据查询

- 矩阵每个所选版本读取最新发布记录，复用授权事务内的发布详情 loader 校验内容 hash 和归属；按冻结功能 biz_id 投影 included/absent/unavailable、范围身份与冻结状态，保留 current/withdrawn/superseded。无发布记录为 null，不以当前 delivered 代替证据。
- 新增投影专项，覆盖撤回仍保留历史、legacy 证据未知、无成员、重复范围/未校验快照/不一致身份拒绝及快照值不共享可变引用。专项通过（0.363s）；接入矩阵后投影与实际 MySQL 矩阵回归通过（0.718s），矩阵数据库 fixture 为无发布记录场景。
- 最新发布成功数据库链路、前端校验与展示仍待继续；当前不宣称该证据已在页面可用。

### 2026-09-08：矩阵发布证据实际数据库验证

- 扩展真实验收/发布集成 fixture，在验收前关联功能，由正式验收与发布命令冻结。矩阵查询验证首次发布 included/冻结 delivered/current，撤回后 included 保留且 withdrawn=true/current=false，更正发布后选中第二份最新记录。整条验收发布专项通过（0.868s）。
- 扩展实际 Runtime 交付发布链路：发布后才关联的当前 delivered 功能，矩阵返回旧快照 absent、范围与冻结状态为 null，并保留撤回状态，防止使用当前关系伪造历史。整条 Runtime 专项通过（1.007s）。
- 以上为隔离实际 MySQL 证据；前端发布证据校验/展示及真实账号端到端仍待继续。

### 2026-09-08：矩阵发布证据前端展示

- 每格新增独立最新发布快照区块，展示无记录、包含/未包含/历史导入未知，包含时展示冻结状态；保留当前有效/非当前、撤回/更正标记，提供具体发布记录链接。
- 响应校验拒绝缺失证据字段、错版本/非法记录身份、当前且撤回或更正的矛盾状态，以及 membership 与冻结范围字段不一致；不把 unavailable 当作未包含。两项专项测试通过，相关 ESLint 与全应用 typecheck 通过。
- 隔离浏览器 fixture 已扩展上述状态，浏览器展示与视觉验收仍待执行，真实授权端到端及完整方案其余范围继续。

### 2026-09-08：矩阵发布证据浏览器展示验证

- 隔离 QA-MATRIX 实际 Chrome 验证包含+冻结状态、未包含、历史导入未知、无发布记录四种展示；撤回记录标记非当前/已撤回，当前有效发布独立标记。记录链接分别指向对应版本与 record ID。
- 同格可同时显示当前范围计划中与冻结已交付，确认页面不以当前状态覆盖发布快照。第二页模拟 503 后刷新，恢复功能 21、无发布记录和总数 21。
- 此 fixture 按行组合不同证据状态用于组件显示分支验证，不作为同一真实发布内容的建模样例。实际发布一致性已有 MySQL 专项覆盖；1440/390 视觉及真实授权端到端仍待完成。

### 2026-09-08：PC-15 多项目协调汇总领域实现

- 新增基于既有执行快照的协调汇总：按稳定 work-item ID 去重，输出全量及分项目目标数、未完成目标、未关闭关联缺陷、总/完成权重和零计划标记，保留缺陷覆盖范围。权重不伪装成人时；没有日期证据不推断延期。
- 相同 ID 的矛盾事实、非法身份、权重溢出和已完成项混入未关闭缺陷拒绝；分项目按 ID 稳定排序。新增专项覆盖跨项目去重、3/4 完成权重、零计划及异常事实。
- 当前仅为领域汇总，尚未接入查询、项目权限过滤与页面；不能作为已交付的多项目协调功能。完整方案继续。

### 2026-09-08：多项目协调授权查询与 Runtime

- 复用验收预览授权事务取得执行快照，再生成协调统计，返回产品/版本/修订身份；实际 MySQL 验证目标与关联范围去重、权重 4/完成 3、未完成目标和缺陷各 1，错误资源与外产品版本拒绝。相关领域专项通过（0.841s）。
- 新增 versions:execution-coordination 内部只读 Runtime，精确 product-versions:read 和可信 actor，登记只读传输。版本 Runtime 边界专项通过（0.381s）；新增 API 文档明确项目明细必须经 BFF 权限过滤。
- Runtime 成功数据库入口、只读分类专项、浏览器代理过滤/分页和页面仍待继续。

### 2026-09-08：协调汇总权限过滤与分页 helper

- 新增服务端可见性 helper：校验产品/版本/修订、计数与项目总和、稳定项目顺序及零计划一致性，再逐项目授权，最后仅对可见项目分页；保留产品全量统计和受限项目数量，不返回受限标识。输出字段白名单避免额外 Runtime 字段绕过过滤。
- 两项专项通过：中间项目无权时第二页正确返回第三项目、全量权重不变、全拒绝无明细、未知额外字段剔除、错误事实在授权前拒绝，以及授权服务失败原样传播。helper ESLint 通过。
- 当前 helper 尚待接入浏览器代理；真实项目授权调用、路由及页面继续。

### 2026-09-08：协调查询浏览器代理

- 新增 GET roadmaps/execution-coordination，版本与分页严格校验，复用现有 catch-all 避免增加 Nitro 路由推导压力。产品 view 事实与可信 actor 转发精确 product-versions:read。
- 复用完整项目授权对象，要求 projects/view 与 work_items/view，接入先过滤后分页 helper；仅返回白名单响应，不携带 Runtime 未过滤项目字段。运行服务不可用及授权故障保留。
- 路由/可见性相关七项回归、ESLint 与全应用 typecheck 通过；代理自身授权专项、Runtime 成功入口与页面仍待继续。

### 2026-09-08：协调代理授权专项

- 两项 BFF 专项通过：可信 actor、精确 read capability、短期版本 view permit、no-store；项目 view 或 work_items view 缺任一项即过滤，完整统计保持、受限标识及额外私有字段不返回。
- 非 GET、非法版本/分页、客户端 actor 覆盖、产品授权拒绝及错误产品事实在传输前拒绝；运行服务不可用、业务冲突与授权服务故障分别保留 503/409/503。
- 新 Runtime 动作补入只读传输分类回归。Runtime 成功数据库总入口及协调页面仍待继续。

### 2026-09-08：多项目协调页面实现

- 新增 execution-coordination 页面及版本列表入口，版本选择后显示整体完成/总权重、未完成/全部目标和未关闭关联缺陷，再展示有权查看的项目分页表与工作项入口。明确权重不是工时、缺陷仅覆盖关联后代；零权重显示无执行计划。
- 受限项目数量独立提示，整体统计不因项目过滤或分页改变；读取失败隐藏旧结果并提供刷新。响应校验产品/版本/分页身份、项目顺序、计数及当页统计不超过全量，版本切换重置分页。
- 全应用 typecheck 通过，修正两处单行语句格式后页面/入口 ESLint 通过。浏览器交互/视觉、完整 Runtime 数据库总入口与真实授权端到端仍待继续。

### 2026-09-08：协调查询 Runtime 成功数据库链路

- 扩展隔离交付发布集成，经 Adapter.HandleRuntime 总入口调用 versions:execution-coordination，验证标准信封/operation、产品/版本/修订、缺陷覆盖口径和无目标时明确无计划，各计数为零、项目为空。缺失版本拒绝。
- 整条 Runtime 交付发布专项通过（1.007s）。该场景是无目标计划；非零权重及目标/缺陷关系已由领域数据库专项覆盖，不把此例宣称为多项目非零 Runtime 验证。
- 同步 API 文档页面已实现状态；浏览器/视觉与真实授权端到端仍待继续。

### 2026-09-08：协调页面分页与版本切换浏览器验证

- 隔离 QA-COORD 模拟 21 个可见/1 个受限项目，实际 Chrome 显示整体 42/44、未完成目标 1/22 和受限提示；第一页项目 1–20，下一页仅项目 21，全量统计保持。
- 从第二页切换无目标的 v2，显示无执行计划、0/0 和零缺陷，旧项目与受限提示清除并回到第一页。项目入口指向实际工作项页面。
- 修正空列表描述：总数为零时不再建议调整页码，分别说明无可见明细或尚无关联执行项目。页面 ESLint 通过。本轮为模拟接口浏览器 DOM 验证；错误恢复、1440/390 视觉及真实授权仍待继续。

### 2026-09-08：协调页面桌面与移动视觉检查

- 在临时目录安装 Playwright（未修改项目依赖），使用独立 headless Chrome 对实际页面/隔离接口生成 1440×900、390×900 全页截图并检查。两尺寸 document.scrollWidth 均等于视口，pageerror 均为空。
- 首轮手机表头被挤成逐字换行，已改为表格最小宽度 640px、外层局部横向滚动及手机提示；复查截图文字恢复横排，整页不横向溢出。页面 ESLint 通过。
- 截图保存于 /tmp/hzy-product-browser-qa/coordination-1440.png 与 coordination-390.png，验证脚本 coordination.cjs。此为隔离外壳内协调页的视觉证据，不覆盖生产 Shell、其他产品页面或真实授权。协调错误恢复及完整方案其他范围继续。

### 2026-09-08：协调错误恢复与矩阵视觉修复

- 独立 Chrome 脚本验证协调第二页连续两次 503 后旧整体统计和表格清除、版本选择保留；刷新恢复项目 21、42/44 整体权重，无第一页旧项目。脚本 coordination-error.cjs 通过。
- 矩阵 1440/390 截图检查覆盖两个版本，发现手机功能名称逐字挤压，已为功能名称和版本格设置最小宽度并增加局部横向滑动提示。复查手机功能名恢复横排，两尺寸整页宽度等于视口，pageerror 为空；页面 ESLint 修复格式后通过。
- 矩阵截图与脚本位于 /tmp/hzy-product-browser-qa/matrix-{1440,390}.png、matrix.cjs。本轮视觉为隔离外壳与模拟接口，真实 Shell/授权及完整方案其余验收继续。

### 2026-09-08：PC-16 实施边界核对

- 核对 Codocs 产品分类、项目正文签名/ACL 路径与 AIMS 产品页面/Schema，确认分类已有但产品文档关系及独立产品范围合同缺失。
- 新增 Aims-Product-Document-Space-Contract.md，明确关系与正文事实源、独立产品文档权限、可见性先于分页、模板创建失败恢复、双 deployment 身份及实施/验收顺序；标注为尚未实现的目标契约。
- 本轮是 PC-16 实施契约准备，不宣称产品文档空间已可用；关系、权限、Codocs 合同与页面继续。

### 2026-09-08：产品文档关系 Schema

- 新增 v5.34 product_documents 与 canonical Schema：稳定 biz_id、产品+文档 UUID 唯一关系、用途、修订、建立/解除操作者和时间。外键只指向本应用产品空间，不连接 Codocs DB，不保存标题/正文或 ACL。
- 隔离 MySQL 验证重复/不存在产品/非法用途/缺解除 actor 拒绝，解除后不可重复插入、恢复保留身份，迁移重放保留数据。完整 Schema 与增量迁移的字段、索引、FK、CHECK 和 trigger 签名一致；两项专项通过（1.871s）。
- 未执行目标业务环境迁移；在线关系命令、产品文档权限、Codocs 合同与页面仍待实现。

### 2026-09-08：产品文档关系权限定义

- manifest 新增 product_documents/view、edit，描述明确只管 UUID 关系，不赋予 Codocs 正文/分享权限。拥有版本查看建议权限的产品角色增加关系查看，只有产品经理模板增加关系维护。
- 沿用 manifest 动态权限投影，无新增授权解析算法。移除早期固定六资源数量断言，验证新资源实际投影，补文档关系角色隔离与无 Codocs 权限注入测试；四项 manifest 专项通过。
- 此为权限定义和推荐角色模板更新，不代表目标环境已安装新授权。关系命令、独立 Codocs 正文合同与页面仍待继续。

### 2026-09-08：产品文档关联创建命令

- 新增 CreateProductDocument：规范非零 UUID、用途和预期修订校验，独立 product_documents/edit permit，归档/旧修订/重复关系拒绝；关系、产品修订、活动与幂等回执同事务。已解除关系须恢复，不重复插入。
- 活动仅记录关系 biz_id/修订，不记录文档 UUID 或标题；Codocs 权限核验仍须由后续可信调用边界执行，尚无 Runtime/BFF 浏览器入口开放此命令。
- 隔离 MySQL 专项验证错误资源拒绝、审计失败全部回滚、创建/幂等重放、重复关联与活动 UUID 不泄露。初次回执比较因 MySQL JSON 排版变化失败，改为解析后语义比较并验证 Replayed 标记。

### 2026-09-08：产品文档关系解除与恢复

- 新增 TransitionProductDocument，独立 edit 授权、产品/关系双修订、状态流转检查，解除记录 actor/time，恢复清除解除状态并保留 biz_id；根修订、关系、活动与回执同事务。未修改 Codocs 文档或 ACL。
- 隔离 MySQL 覆盖审计失败回滚、解除/恢复幂等重放、旧关系修订拒绝、已恢复状态重复操作拒绝和唯一关系身份保留。创建与生命周期两项专项合计通过（1.239s）。
- 领域命令尚未开放 Runtime/BFF；恢复前 Codocs 当前访问核验、用途维护、关系读取、服务契约与页面继续。

### 2026-09-08：产品文档用途维护

- 新增 ChangeProductDocumentPurpose，复用用途校验、独立 edit permit、产品/关系双修订与幂等事务；已解除关系、无变化用途和非法身份拒绝，不修改 document_uuid。活动记录用途前后值及修订，不记录文档标识或正文。
- 扩展实际 MySQL 生命周期验证恢复后用途更新、UUID 保持、关系修订递增、幂等重放与旧关系修订拒绝；与创建专项一并回归。
- 命令尚未开放服务或浏览器入口，Codocs 当前权限核验及关系读取仍待继续。

### 2026-09-08：产品文档候选关系读取

- 新增 ListProductDocuments，独立 product_documents/view 与授权事务，按用途及有效/已解除状态筛选，按 ID 倒序真实分页并返回根修订；仅读取 AIMS 关系，不联查 Codocs。
- 隔离 MySQL 专项覆盖两页与超末页、产品隔离、用途筛选、解除状态切换、错误资源和非法用途拒绝。
- 此为供 BFF 后续 Codocs ACL 核验的内部候选页，不等于浏览器可见页；UUID 未经 Codocs 当前访问校验不得直接返回浏览器。服务入口及可见分页编排继续。

### 2026-09-08：Codocs 产品文档元数据领域读取

- 从现有项目服务命令校验中提取固定契约参数，项目路径保持原动作；新增尚未挂路由的产品 metadata 领域方法，使用独立 productCode/operation/schema/capability，再调用现有 documentAccess ACL。
- 产品上下文不携带部门/项目授权事实，仅读取当前 actor 的 owner/share/relation 权限；只投影 UUID、标题、类型、更新时间，无 OSS 路径、正文或 owner 信息。
- 项目服务原专项回归通过；新增产品专项验证项目契约不可充当产品契约、owner ACL 后允许引用既有项目文档、输出字段白名单。完整 Service API/JWT/精确 grant 入口未开放，非 owner 及授权撤销专项继续。

### 2026-09-08：产品文档非所有者分享与撤销专项

- 同一 actor/产品/文档连续读取：第一次有 Codocs read 分享允许元数据，第二次分享移除且无 can_read 关系时返回 permission_denied，结果为空；每次重查当前 ACL，不复用前次允许结果。
- 请求同时注入两种部门访问 hint，产品读取主动丢弃，不能因文档属于相同部门而绕过撤销。与原项目服务及产品元数据专项合并回归。
- 此为 SQL mock 领域授权专项，不代表真实分享操作、JWT 或目标部署验收；完整服务认证入口继续。

### 2026-09-08：产品文档签名载荷边界收紧

- 产品 metadata 命令在共享签名上下文核验前严格限制四字段 actorUid/productCode/documentUuid/action；要求真实字符串、长度、无控制字符、规范非零 UUID、明确 metadata:read，拒绝 role/scope 等额外字段和身份类型强制转换。
- 产品测试 fixture 改用规范 UUID，补身份类型、产品路径/空白、非法 UUID、动作与角色注入拒绝回归。原项目契约仍走既有校验，不扩展其权限。
- 核对发现旧项目 Service API 使用宽 runtime scope 且独立 caller 白名单，产品新入口须采用精确能力及正式 manifest/grant 合同，尚未开放。

### 2026-09-08：Codocs 产品文档精确能力定义

- Codocs manifest 声明 product-document/read，新增精确服务认证策略；该 actor 委托入口只接受 AIMS 签名产品关系来源 aims.runtime。API 文档解释该受限来源的安全原因，并明确路由尚未开放。
- 新专项确认能力在 manifest 有定义、正确身份可用、通配/旧项目 capability 不可替代、错误应用/客户端拒绝、用户 token 拒绝及 introspection 故障保留；与既有服务认证回归共 15 项通过。
- 尚未安装 Console grant，也未开放服务路由；完整 JWT/HMAC、Runtime 入口和调用方继续。

### 2026-09-08：Codocs 产品文档 Runtime 入口

- 内部 product-documents/{uuid}/metadata 接入 adapter，POST 限制和精确 capability 校验先于文档存储读取，随后执行产品签名载荷/上下文与 Codocs ACL。宽 read、通配及旧项目 scope 不可替代。
- 登记 codocs.read 传输，新增只读分类专项；产品与项目服务领域/边界回归通过（0.352s）。Nuxt Service API、JWT/HMAC 总链路和 Console grant 未开放，后续继续。

### 2026-09-08：Codocs 产品文档 Nuxt 服务接口

- 新增 metadata.post.ts，服务身份/精确 capability 与跨 deployment 绑定先于 body 读取；规范 UUID/固定四字段与 payload hash 校验后，复用 Foundation HMAC 验证 method/path/request ID 和独立源/目标 deployment。
- 目标以自身 runtime 身份申请 codocs.read+精确 product-document:read，再签名 actor；响应仅投影四个元数据字段，no-store。middleware 登记本地服务 handler，避免落入通用转发。
- Codocs typecheck 及相关 ESLint 通过，MODULE_CONTRACTS/API 文档同步。完整 handler 授权专项、Console grant 与实际跨服务验收仍待继续。

### 2026-09-08：产品文档 Service handler 与真实 HMAC 专项

- 实际 metadata handler 的 VM 专项验证授权在 body 前、签名失败在 Runtime 前拒绝，独立源/目标 deployment、精确 runtime scope、委托 actor、字段白名单及下游 503 保留。
- 增加真实 Foundation hash/build/verify helper 集成，成功签名允许调用；替换 actor 并重算 body hash、请求 ID、源/目标 deployment、capability 或签名均拒绝，Runtime 调用为零。三项测试通过。
- 此轮入站身份解析及 Runtime 仍为 stub；真实 HMAC 不等于真实 JWT/JWKS 或部署验收。Console grant、AIMS 调用方/可见分页/页面及完整产品中心剩余范围继续。

### 2026-09-08：产品文档精确服务授权安装与核验

- 统一 grant 生成器新增 Codocs manifest 校验，安装 AIMS→Codocs 产品文档 read 及 Codocs→双 Runtime audience 的精确 read；既有 Codocs 传输 read 仅核验。三客户端及当前凭证全部有效才执行安装，无关客户端不授权。
- 生成式 Seed/Verify 更新至 165 业务 grant / 173 核验项。两项 TS 契约测试及隔离 MySQL 实际 SQL 通过，覆盖重复安装、缺失客户端、Codocs 凭证失效、过期凭证、inactive grant 和 mysql --force 下失败 guard 不授权。
- 未执行目标业务环境安装或真实 token 签发；AIMS 文档调用方、可见分页、页面及其余方案范围仍待完成。

### 2026-09-08：AIMS 产品文档元数据调用方

- 新增内部 readProductDocumentMetadata，先执行产品文档 view 权限，actor 只来自已校验产品授权事实；要求 Foundation 可信 Gateway/目标服务路由，分别绑定源/目标 deployment，以精确 capability 获取 Codocs token 并签名固定命令。
- 调用目标 Service API，不直连 Codocs Runtime；仅返回 UUID/标题/类型/更新时间，畸形身份响应失败，不吞掉上游错误。用于关联预检或已验证 AIMS 关系的元数据补全，尚未开放浏览器入口。
- 两项 VM 专项通过：用户身份、精确 scope、目标路径/路由三字段、缺权限/路由时不申请 token，以及错误响应/503 保留。此轮路由与认证 helper 为 stub，不代表真实跨部署验收。当前 helper 要求可信 Gateway 服务目录，其他部署方式的路由接入尚待验证。

### 2026-09-08：产品文档候选关系 Runtime 读取

- 新增 documents:list 并接入 Adapter 总入口，要求 aims:product-documents:read、受信 actor 和独立 product_documents/view 许可，调用既有产品隔离/真实分页领域读取。登记 POST 只读传输；未开放浏览器关系列表。
- Manifest 声明内部精确 read，生成器补双 Runtime audience。六项 manifest/grant 契约及隔离 MySQL 安装专项通过，当前 167 业务 grant / 175 核验项。未执行目标环境安装。
- Runtime 边界测试覆盖缺用户/签名上下文、宽 scope、Codocs capability 不可替代和 GET 拒绝；缺用户身份沿用 401，其余缺范围/签名上下文为 403。可见分页和页面继续。

### 2026-09-08：产品文档可见分页编排

- 新增 pageVisibleProductDocuments：有界候选页逐页读取，对全部候选核验当前文档权限后计算可见总数和页面，仅保留当前页元数据；受限项只返回计数。严格检查产品、UUID、用途、解除状态、重复关系和页长度，响应只投影白名单。
- 全过程要求产品根修订/候选总数一致，完成时再次核验修订；服务故障传播，不转换为权限拒绝或返回部分结果。调用方必须仅将明确 Codocs ACL 拒绝转换为 null。
- 两项专项通过：105 候选跨两页，52 可见/53 受限，第二页正确切片、超末页仍保留总数；修订变化、重复关系和 503 均失败。此为编排 helper，尚未接入 BFF/页面；真实 ACL 并发撤销、请求时限与大规模文档性能仍需联调。

### 2026-09-08：产品文档列表 BFF 接入

- 新增 GET products/{productCode}/roadmaps/documents，严格产品/用途/解除状态/分页，no-store；串接已授权候选 Runtime 与 Codocs 元数据 helper，再输出可见分页。每页候选和结束均检查产品修订，结束重新校验当前权限。
- 两项实际 BFF VM+真实分页 helper 专项通过：精确候选 capability、用户/许可、元数据成功；仅明确文档 ACL 拒绝/停用过滤，scope/来源/未知 403 和 503 保留。依赖适配器为 stub，非真实部署验收。
- 文档页面、关联写入口、正文/模板、性能及真实 JWT/权限验收继续。

### 2026-09-08：产品文档列表页面

- 新增 products/{productCode}/documents 页面和产品主页入口，接入可见列表 BFF；用途/关联状态筛选、分页、受限计数、加载/错误清除旧结果及刷新。手机表格局部横向滚动，不整页溢出。
- AIMS typecheck 与页面 ESLint 通过。隔离 Nuxt 外壳/模拟 21 可见+2 受限，真实 Chrome 1440/390 截图检查，整页宽度等于视口、pageerror 空；两尺寸第二页仅第21条，无第一页旧文档。临时脚本 documents.cjs、截图 documents-{1440,390}.png 位于 /tmp/hzy-product-browser-qa。
- 列表页面已实现；筛选切换/错误恢复浏览器专项、真实 Shell/权限/跨服务验收、关联维护、正文与模板尚未完成，不代表完整文档空间可用。

### 2026-09-08：产品文档筛选与错误恢复浏览器专项

- 在 390px 真实 Chrome、隔离 Nuxt 页面与模拟接口下，先翻第二页再切需求用途，确认请求 page=1/purpose=requirements 且空结果；恢复全部用途后切已解除关联，旧受限计数清除。
- 模拟服务 503，确认旧文档、可见总数及受限计数全部清除；恢复服务后刷新，列表与总数恢复。专项脚本 /tmp/hzy-product-browser-qa/documents-state.cjs 通过，无需修改页面行为。
- 这是模拟接口的真实浏览器交互证据，不代表真实 Codocs ACL、JWT、生产 Shell 或目标业务环境验收。关联维护、正文与模板仍待接入。

### 2026-09-08：产品文档关系详情读取

- 新增 ReadProductDocument 及 documents:view Runtime，总入口复用精确 read、签名 actor 与 product_documents/view；规范 UUID，按产品+关系读取当前状态/用途/修订及根修订，支持已解除关系。
- 扩展隔离 MySQL 读取专项，验证解除后详情与列表一致、跨产品和错误资源拒绝、非法关系身份拒绝，专项通过（0.805s）。详情仍为内部数据，供后续维护预检，未开放浏览器详情。
- 无新增 capability/grant；关联维护、Codocs 当前权限预检及页面操作继续。

### 2026-09-08：解除文档关联 Runtime 接入

- documents:remove 接入 Adapter 总入口，动作固定为解除，精确 remove capability 和受信 actor 先于 body/数据库，复用已有双修订、幂等、审计同事务领域命令；不修改 Codocs 内容/访问权限。
- Manifest/生成式双 audience grant 同步至 169 业务 grant / 177 核验项。Runtime 列表/详情/解除边界专项通过（0.394s），隔离 MySQL 授权安装专项通过。未执行目标环境安装；BFF/页面解除操作及恢复/创建仍待接入。

### 2026-09-08：解除文档关联 BFF

- 现有产品路由接入 documents/remove，POST/无 query/稳定幂等键、严格三字段与双修订；edit 授权先于 body，拒绝 actor 注入，以当前事实和受信 actor 调精确 remove Runtime。
- 专项验证成功信封、旧修订交 Runtime 重放、精确 scope/key/actor、未授权不读 body、非法修订/额外身份字段不调用 Runtime。此为 VM 边界验证，真实数据库回执沿用领域专项；页面按钮和完整链路仍待继续。

### 2026-09-08：文档维护按钮权限准备

- 列表响应新增 canEdit，末尾单独核验 product_documents/edit 与当前查看事实的产品/actor/修订/状态一致，归档不开放；不以 view 推导 edit。
- 三项 BFF 专项通过，新增有/无编辑权限和权限事实修订漂移 409。按钮仍待接入，写 BFF/Runtime 保留独立授权。

### 2026-09-08：解除文档关联页面操作

- 文档列表按 canEdit 和有效关联状态显示解除按钮，Foundation warning 确认包含文档名及保留 Codocs 文档/ACL 的说明。捕获产品/根修订，产品切换或忙碌后不继续；按关系保留失败请求 key/body，成功核对回执身份/解除状态后刷新。
- 页面 ESLint、AIMS typecheck 通过。隔离 Chrome 1440/390 无整页溢出/pageerror，手机截图检查；专项实际打开 Foundation 对话框，连续两次模拟 503，确认重试沿用相同 key/body。临时 documents-remove.cjs 通过。
- 尚未验证真实解除成功/回执丢失与数据库全链路、角色及真实 Shell。创建/恢复、用途修改、正文及模板继续。

### 2026-09-08：解除关联 Runtime 实际数据库与回执重放

- 新增隔离 MySQL 专项，经 Adapter.HandleRuntime 总入口和当前产品 edit 许可执行 documents:remove；验证标准信封、operation、解除结果。
- 同键重试返回 Replayed 和相同 receipt_id；产品/关系修订均只递增一次，审计只有一条，文档 UUID 保持。旧修订换新键拒绝。专项通过（0.916s），测试数据库自动清理。
- 此为真实数据库+Runtime adapter 链路，入站签名上下文由 fixture 提供，不代表真实 JWT/JWKS、浏览器成功回执链路或目标环境验收。完整方案继续。

### 2026-09-08：解除成功回执丢失的浏览器恢复

- 新增隔离 Chrome 专项，第二页解除第21条，模拟服务已应用但首次回执返回503；再次确认后提交相同 key/body/原根修订，返回 replayed 成功回执。
- 页面正确回到第一页，可见总数21→20，第21条消失、第一条重新出现。临时脚本 /tmp/hzy-product-browser-qa/documents-remove-success.cjs 通过。
- 此为真实浏览器+模拟服务回执，与此前实际 MySQL/Runtime 幂等专项分别覆盖；尚未串成真实 JWT/BFF/Runtime 数据库端到端链路。

### 2026-09-08：文档用途编辑 Runtime

- documents:edit 接入 Adapter 总入口，固定用途编辑动作、精确 capability、受信 actor 与独立 edit permit，复用 ChangeProductDocumentPurpose 的用途/双修订/幂等审计事务。不修改文档 UUID 或 Codocs 权限。
- Manifest 与生成式双 audience 授权更新为 171 业务 grant / 179 核验项，隔离 MySQL 安装专项通过。浏览器用途编辑、关联创建/恢复及其余文档空间范围继续。

### 2026-09-08：文档用途编辑 BFF

- documents/purpose 接入既有产品 catch-all 路由，与解除关联共用内部维护 handler；固定动作 edit、精确能力、四字段及六用途枚举，授权先于 body，保持稳定幂等键和原始双修订。
- 八项相关 BFF/路由测试通过，新增用途 capability/path/input、非法/缺失用途、额外 actor、无编辑权限拒绝。页面用途编辑及完整真实跨服务验收继续。

### 2026-09-08：文档用途编辑弹窗

- 新增 EditDocumentPurpose，列表仅可编辑的有效关联显示修改用途；单字段 Modal，双修订保存，严格成功回执身份/用途核验，成功刷新列表。失败保留选择，同一产品/关系/用途/修订重试复用 key，载荷变化才换键。
- 页面/组件 ESLint、AIMS typecheck 通过。真实隔离 Chrome 1440/390 选择使用指南、连续两次模拟503，确认相同key/body；两尺寸弹窗截图已检查，无溢出或重叠。临时 documents-purpose.cjs 和 purpose-{1440,390}.png 留作证据。
- 成功保存浏览器与实际 Runtime 数据库串联、真实权限、创建/恢复/正文/模板及完整方案剩余范围继续。

### 2026-09-08：用途编辑实际 Runtime 数据库回归

- 将解除 Runtime 数据库专项整理为 remove/edit 两种动作，共用实际 Adapter 总入口、隔离 MySQL 与当前产品许可；用途编辑验证实际存储和回执均为 user-guide，文档 UUID 保持、关联仍有效。
- 两动作均验证同键相同回执、Replayed、根/关系修订只加一次和单条审计，旧修订换新键拒绝。专项 TestMySQLProductDocumentMutationRuntimeReplay 通过（1.298s）。
- 真实签名/JWT 和浏览器至数据库整链仍待验收；关联创建/恢复、正文、模板及方案其他范围继续。

### 2026-09-08：恢复关联 Runtime 与数据库验证

- documents:restore 接入 Adapter 总入口，固定恢复动作、精确 restore capability、受信 actor 和 edit permit，复用双修订/审计/回执事务；Manifest/生成授权同步至173业务grant/181核验项。
- Runtime 边界、六项 Manifest/grant 契约、隔离 MySQL 授权安装通过。实际 Runtime 数据库 mutation 专项扩展 remove/edit/restore，验证恢复保留关系与UUID、同键回执重放、单次修订/审计、旧修订新键拒绝，合计1.497s。
- 浏览器恢复入口未开放；BFF 的同产品关系读取和 Codocs 当前ACL预检继续，不能视为完整恢复功能已验收。

### 2026-09-08：恢复关联 BFF 与 Codocs 预检

- documents/restore 接入共享维护 BFF，独立 edit/view 同修订事实，读取同产品关系后从服务端详情提取 UUID，Codocs 当前权限核验成功才提交 restore。已恢复状态继续交 Runtime 判断幂等回执，不接受浏览器指定 UUID。
- 九项相关测试通过，新增关系→Codocs→恢复链路、精确 scope、跨产品关系与 ACL 拒绝不写入；ESLint 和 AIMS typecheck 通过。此为 VM 边界，真实跨服务/页面恢复仍待验证。

### 2026-09-08：恢复关联页面入口

- 已解除文档列表按 canEdit 显示恢复按钮，复用 Foundation warning 确认和 transitionDocument；解除/恢复按产品+关系+动作分别保留重试键，核对返回状态再刷新。
- ESLint/AIMS typecheck通过。隔离 Chrome 1440/390 验证已解除项无用途编辑、恢复首次503后同键同body重试、成功后已解除列表变空；确认弹窗两尺寸截图检查通过。临时 documents-restore.cjs、restore-{1440,390}.png。
- 测试使用模拟回执，真实 Codocs/BFF/Runtime 全链路仍待验收；文档关联创建、正文与模板及整体方案其余范围继续。

### 2026-09-08：文档关联创建 Runtime

- documents:create 接入总入口，精确create能力/受信actor/edit许可，复用规范UUID、用途、唯一关系及幂等事务。Manifest与双audience生成授权更新175业务grant/183核验项。
- Runtime边界、六项Manifest/grant契约、隔离MySQL授权安装通过。实际Runtime数据库专项扩展create，四动作合计1.930s；创建只产生一个关系/审计和回执，同键重放、旧修订新键拒绝，文档UUID保持。
- 创建BFF/Codocs预检/选择文档页面尚未接入；真实跨服务及整体方案剩余范围继续。

### 2026-09-08：文档关联创建 BFF

- documents/create 接入现有产品路由，严格三字段、精确create能力和幂等键；产品edit授权先于body，Codocs当前ACL读取先于自身Runtime创建，不信任浏览器actor。
- 十项相关BFF/路由专项通过，新增正确UUID预检/写入顺序、Codocs拒绝不写入、非法UUID/用途/修订/额外actor字段拒绝。文档选择页面与真实跨服务验收继续。

### 2026-09-08：Codocs 可见文档搜索领域能力

- 现有选择器依赖项目/部门，不直接用于产品中心。新增内部标题搜索，复用 Codocs owner/share/can_read关系可见条件，不接受部门hint；ACL先于COUNT和LIMIT，重复读事务保持计数/页面一致，仅读四元数据字段。
- 输入限制页码/页大小/搜索长度和控制字符；LOCATE按字面搜索，百分号不扩大为通配。SQL mock专项验证可见性参数、第二页OFFSET、字段白名单及非法输入在存储前拒绝。
- 搜索尚未开放签名Service API/Runtime或浏览器选择器；需继续补产品搜索签名合同与完整验收。

### 2026-09-08：产品文档搜索签名领域合同

- 新增固定 search.v1 operation/schema，复用精确 product-document:read 和共享来源/actor/tenant/deployment 验证；命令严格六字段 actorUid/productCode/action/search/page/pageSize，拒绝身份强转、null搜索、分数分页、超界及role注入。搜索无documentUuid，产品仅绑定业务上下文，不授予ACL。
- 搜索领域/命令和既有项目命令专项回归；新增有效空搜索/第二页、非法字段、actor替换和宽scope拒绝。尚未挂Runtime或Nuxt Service路由，真实HMAC/JWT、调用方和选择器继续。

### 2026-09-08：产品文档搜索 Runtime 接入

- product-documents/search 接入Codocs Adapter总入口，仅POST、精确read capability先于存储，调用固定签名搜索合同和ACL分页领域逻辑；登记只读传输。
- 搜索命令/边界/只读分类专项通过；成功SQL mock专项改从Adapter总入口进入，覆盖标准success信封、operation、用户ACL参数、第二页和元数据白名单。非真实JWT或数据库验收。
- 外部Service API、AIMS调用方、选择器与整体方案其他范围继续。

### 2026-09-08：Codocs 搜索 Service API

- search.post.ts 接入，精确服务授权/tenant/deployment 先于body，固定六字段/搜索长度/分页和hash校验后复用Foundation HMAC，再以Codocs自身Runtime身份重签actor；输出分页和四字段白名单。middleware本地服务登记。
- 两项handler专项通过，含真实HMAC、actor/请求ID/部署篡改拒绝、未授权不读body、非法分页/搜索/role注入拒绝和503保留；身份解析及Runtime为stub，非真实JWT验收。
- 新路由触发既有远程Console目录调用类型推导过深，为其显式标注已有响应类型和string远程URL泛型；不改变请求行为。AIMS调用方和选择器继续。

- 搜索最终由既有 tenant-runtime middleware 精确路径分发 productDocumentSearchService handler，不新增文件路由，避免Nuxt路由类型上限；非POST返回405。中途目录调用类型尝试已撤回，无目录模块行为改动。外部路径保持 /api/v1/service/product-documents/search。

### 2026-09-08：AIMS 搜索服务调用方

- productDocumentCodocs 提取共同签名发送编排，新增searchProductDocuments，严格搜索/分页，当前view授权事实绑定actor，复用精确read scope和可信路由；校验返回页/总数/页长度、规范UUID和重复项，白名单输出。
- 三项调用方VM专项通过，含原元数据调用回归、签名搜索/分页、第二页结果和非法搜索/UUID拒绝。浏览器搜索BFF及选择器继续。

### 2026-09-08：浏览器文档搜索入口校验

- GET /api/v1/products/{productCode}/roadmaps/documents/search 复用签名搜索调用，禁止缓存，严格分页参数并拒绝额外 actor 等查询字段；权限拒绝和上游不可用保留原状态。
- 搜索入口与保存视图相关六项测试通过；现有 catch-all 路由测试补充 documents 列表、search/create/remove/restore/purpose 的实际分发断言。AIMS typecheck 通过。
- 文档选择与关联弹窗尚未完成。保存视图测试文件存在既有格式及 VM any lint 问题，本次未将其整体格式化，不能宣称整个专项文件组 lint 全通过。真实跨应用验收仍待完成。

### 2026-09-08：关联已有文档弹窗

- 产品文档页接入 LinkDocument：使用 Foundation 防抖标题搜索、每页10条真实接口分页、文档选择、六类用途及创建关联。旧搜索响应通过请求代际隔离，关闭或切换产品后不回填结果。
- 创建使用打开弹窗时的工作空间修订；相同请求失败后保留选择并复用幂等键，成功后关闭并刷新列表。错误提供重复关联/已解除关联及修订冲突处理提示。
- AIMS typecheck、两个变更Vue文件 ESLint通过。隔离Nuxt真实Chrome在1440/390视口通过第二页选择、503后同键同body重试、成功关闭、无pageerror及无横向溢出检查；两张错误状态截图已检查。接口为mock，未证明真实JWT/ACL跨服务链路。
- 后续仍需文档正文、模板/创建、真实环境验收及PC17/18等整体范围。

### 2026-09-08：产品文档正文授权领域能力

- Codocs 提取产品文档当前ACL授权，元数据保持原四字段响应；新增内部正文授权操作 aims.codocs.product-document.content-read.v1（schema同值、action content:read），严格产品/actor/UUID绑定，复用精确 product-document:read 能力。元数据签名不能用于正文操作。
- 正文领域返回供Codocs自身BFF消费的存储授权，缺存储路径返回404；该内部返回不得外发AIMS/浏览器。尚未注册正文Runtime或外部Service API，亦未接入正文UI。
- 产品文档专项Go测试通过。新增SQL mock验证分享可读、撤销后拒绝、忽略部门提示，以及元数据action/operation不能替代正文授权；真实存储与JWT链路仍待验收。

### 2026-09-08：产品文档正文 Runtime 入口

- Codocs Adapter 接入 POST service/product-documents/{uuid}/content，登记 codocs.read 传输；领域仍要求精确 product-document:read 和独立正文签名操作，非POST拒绝405。内部存储授权仅供Codocs自身BFF消费。
- 产品文档及传输分类专项通过；正文分享/撤销SQL mock改从Adapter入口执行，验证成功信封与六字段内部授权，增加宽scope/缺scope拒绝及GET/PUT/DELETE拒绝。
- 外部Service正文下载/白名单输出、AIMS调用和预览页面尚未接入，未完成真实JWT/存储验收。

### 2026-09-08：产品文档正文 Service API

`POST /api/v1/service/product-documents/{uuid}/content` 由 Codocs middleware 精确分发，复用 `codocs:product-document:read`。固定 operation/schema 为 `aims.codocs.product-document.content-read.v1`，command 严格为 actorUid/productCode/documentUuid/action（content:read）；源 AIMS 签名及 tenant/双 deployment 绑定先于 Runtime 和存储。Codocs 使用自身身份与同一精确 capability 访问 Runtime，当前文档 ACL 校验后才下载正文；空 Markdown 按既有 Yjs 恢复机制处理。对外仅返回 uuid/title/docType/updatedAt/contentSize/content，不返回 OSS 路径。存储失败为脱敏503。

复用已登记 read grant，不增加 scope 或放宽现有权限。AIMS 正文调用及预览尚未接入；VM测试含真实HMAC，但身份解析、Runtime及存储为stub，不等同真实JWT/OSS验收。

验证：四项正文handler测试、Codocs typecheck通过；覆盖授权顺序、签名篡改、存储错误脱敏、快照恢复与输出字段白名单。

### 2026-09-08：AIMS 正文服务调用方

- productDocumentCodocs 新增 readProductDocumentContent，复用可信路由、精确 read token 和签名发送，固定独立正文operation/action；当前产品view事实绑定actor。调用方仍须先核实产品文档关系，暂未提供浏览器直传UUID正文入口。
- 校验目标UUID、正文类型及非负安全整数大小，返回六字段白名单，不传播存储路径。四项调用方专项通过，包括元数据/搜索回归、正文operation/actor、异常正文/UUID和上游失败。产品关系读取BFF及预览UI继续。

### 2026-09-08：AIMS 产品关联正文 BFF

- GET products/{productCode}/roadmaps/documents/content 只接受 bizId 查询；以当前产品view授权读取自身 documents:view，核实产品/关联身份及工作空间修订，已解除关系404，文档UUID由服务端关系提供。Codocs返回正文后重新获取产品view并核对actor/修订，变化409，不返回旧正文。
- 七项正文/路由相关测试通过，覆盖额外UUID注入、非法bizId、跨产品/已解除关系阻断、Codocs ACL拒绝、读后修订变化及真实catch-all路径分发。测试使用受控授权/Runtime adapter，真实环境验收及预览UI继续。

### 2026-09-08：产品文档正文预览

- 有效关联行增加阅读文档，PreviewDocument 弹窗调用正文BFF（只传bizId），校验返回UUID并复用现有 MarkdownContent 安全渲染。支持加载、空正文、错误、重新读取，关闭或切换关联通过请求代际丢弃旧响应。每次重新读取先清除旧正文。
- AIMS typecheck及两个Vue文件ESLint通过。隔离Nuxt/Chrome1440与390视口验证正文/表格、脚本不执行、403后清除旧正文及重试恢复，无pageerror/横向溢出，截图已检查。第一次脚本误假定403使用fallback标题而超时，改为验证旧正文清除后通过；未改变应用错误映射。接口为mock，非真实Codocs/JWT/存储验收。
- PC16仍有模板创建/关联恢复流程及真实集成验收，PC17/18等完整目标继续。

### 2026-09-08：模板创建实际路径核实

- 实查Codocs快捷创建、普通Service创建与领域事务：缺产品/模板上下文、签名创建资格和可重放正文上传回执；公司模板入口目前是资产目录浏览，不可假定都是文档UUID。
- 文档空间契约追加现状纠正、精确create能力、模板身份/ACL、固定UUID上传回执、AIMS待关联恢复及验收顺序。未开放不具备恢复保障的创建入口；本轮为实施依赖调查与契约更新，未增加可用创建功能。

### 2026-09-08：模板创建命令边界

- Codocs manifest 声明 product-document:create，与read独立。当前创建Runtime未开放，授权生成器仍只安装已实现接口；新增测试确保create不会提前进入Seed/Verify。七项manifest/grant测试通过，未改实际租户授权。
- 新增内部创建命令解析：固定create.v1 operation/schema，严格六字段actorUid/productCode/documentUuid/templateUuid/title/action，规范非零UUID、模板/目标不可相同、标题200字符且无控制字符，当前actor与受信来源绑定；read scope不能创建。领域边界专项覆盖有效命令与七类注入/替换拒绝。
- 解析器尚未接Runtime，后续需当前用户创建资格、模板ACL、持久操作/正文上传/成功回执及AIMS待关联恢复；本轮不代表文档创建可用。

### 2026-09-08：创建模板读取权限门禁

- readProductCreationTemplate 先解析精确create签名命令，再按其中actor和模板UUID调用Codocs现有documentAccess；忽略产品/部门hint授权，模板必须active且有正文路径。仅向Codocs内部返回模板UUID/类型/路径，不进行创建或上传。
- Go命令/模板专项通过：模板owner允许、无share/relation拒绝（即使传部门hint）、停用拒绝、缺正文拒绝。SQL mock确认只读目标模板，目标新文档UUID保持分离。
- 该门禁不等于用户创建资格；后续仍须独立创建资格、持久操作/回执和上传恢复，尚未开放创建端点。

### 2026-09-08：签名用户创建资格检查

- 新增 requireProductDocumentCreateEligibility：供验签后的创建Service流程使用，以签名actor调用Foundation Console授权快照，核对返回uid并通过统一动作策略判断 documents:create；不从service client推导用户权限，不启用本地开发授权fallback。
- 专项测试采用实际Foundation动作判断，验证create允许、仅view/edit/admin/服务capability拒绝、错uid和Console不可用保持503、非法actor在授权请求前拒绝。helper尚待创建Service流程接入，不构成已启用入口。

### 2026-09-08：创建命令接入共享回执校验

- 实查现有service_command_receipt约束：schema列30字符、operationId为UUID；创建schema改为product-document-create.v1，operation仍为aims.codocs.product-document.create.v1。创建解析调用共享ReceiptCommandFromBody，进入模板存储前校验幂等身份和command hash。
- 命令/模板专项通过，新增错误hash、非UUID操作ID及旧超长schema拒绝。仍未写入持久回执；上传流程与事务实现继续。

### 2026-09-08：模板创建持久准备记录

- Codocs migration_v1.6_product_document_creation.sql 与canonical schema增加准备记录表，保存操作/幂等身份、目标/模板UUID、actor/product/title和模板正文/hash/字节数；身份及目标唯一，模板与目标不同，prepared/completed状态及完成路径/时间一致性由CHECK约束。正式文档和ACL仍由documents/relations保存，成功回执复用service_command_receipt。
- 隔离MySQL临时库验证迁移两次、有效准备记录、重复身份拒绝、正文/hash不符拒绝、不完整完成状态拒绝、模板等于目标拒绝及合法完成更新；临时库已删除，未改目标租户数据库。数据库约束不保证快照不可改，后续领域逻辑必须禁止替换已有快照。
- 下一步接准备事务与上传后完成事务，上传尝试采用独立对象路径，已发布路径不得被迟到重试覆盖；当前无创建Runtime入口。

### 2026-09-08：创建准备事务

- 新增内部prepareProductDocumentCreation：共享命令/回执校验后，最多4MiB UTF-8正文写入准备表；重复键只做无变化更新，随后锁定并核对操作/租户双部署幂等身份hash、命令hash、actor/product/目标/模板/title。冲突回滚；合法重试返回数据库原正文与hash，模板后来变化不能覆盖已冻结快照。
- Go创建相关专项通过；SQL mock验证重复请求返回原快照、不同命令冲突回滚与事务顺序。此轮未做真实MySQL并发准备验证。
- 内部准备方法须在当前用户创建资格及模板ACL读取后调用；尚未接Runtime，完成事务/上传与正式回执仍待实现。

### 2026-09-08：上传后文档完成事务

- completeProductDocumentCreation 接共享ReceiptRepository.Execute，校验操作专属上传尝试UUID路径；事务锁定准备记录，核对幂等身份/命令/actor/产品/模板/目标及冻结正文hash，与上传hash一致才创建product文档、创建者关系并推进completed。成功回执由共享执行器在同事务提交，对外业务结果只含uuid/title/productCode。
- Go创建专项通过；新增SQL mock覆盖事务内文档/owner/完成状态写入及错误上传hash在文档写入前拒绝。测试未覆盖完整回执重放、真实数据库回滚或OSS上传；这些验收仍待补。
- 完成方法为内部能力，须在当前用户创建资格/模板ACL及上传验证后调用；Runtime/外部创建Service和上传编排尚未接通。

### 2026-09-08：创建事务真实MySQL验收

- 新增可重复执行的TestMySQLProductCreationReceiptReplay，显式隔离socket临时库，使用canonical folders/documents/relations及实际回执/准备迁移。验证准备重试保留原正文；注入owner关系失败，文档/关系/回执均为0且准备仍prepared；移除故障后完成、重放返回同receipt且三表各一条、状态completed。成功后修改文档标题，再重放不覆盖用户修改。
- 指定隔离socket实跑通过，临时库由测试清理；未使用生产租户、真实JWT或OSS。尚待上传编排、Runtime/Service入口与UI，不能将事务测试视为创建流程已可用。

### 2026-09-08：完成后准备重试恢复

- 准备记录读取增加内部PublishedPath；completed必须具有已发布路径，prepared不得含路径。相同命令在完成后重试仍返回原冻结正文与已发布路径，供后续编排直接重放完成回执并跳过上传；路径不得外发AIMS或浏览器。
- 隔离真实MySQL测试通过：完成后修改文档标题，再次prepare（传入变化后的模板）取回原正文/原路径，使用恢复值重放返回同一回执，不覆盖编辑。准备SQL mock同步通过。
- Runtime/Service及上传编排仍待接入，当前测试证明持久恢复信息可用，不证明已实现不重复上传。

### 2026-09-08：冻结正文上传编排

- uploadPreparedProductDocument 校验准备快照操作/文档身份、UTF-8字节上限与SHA-256；prepared以每次独立UUID对象路径上传原正文后调用完成步骤，completed校验原路径后直接重放完成，不调用上传。上传异常脱敏503且不进入完成。
- 两项专项测试通过，覆盖冻结正文/类型、两次尝试路径不同、已完成零上传、身份/hash/完成路径损坏拒绝以及上传失败不提交。依赖注入为stub，尚未绑定实际OSS与Runtime，未证明实际存储效果。
- 待接创建Runtime、Service编排、授权种子及UI；完整目标继续。

### 2026-09-08：产品模板创建内部 Runtime 阶段

Codocs Runtime 新增 POST `/v1/codocs/service/product-documents/create/{template|prepare|complete}`，固定签名创建命令与精确 `codocs:product-document:create` 先于存储；非POST拒绝。template返回内部模板读取授权，prepare/complete每次重新校验模板ACL，分别调用冻结快照及共享回执完成事务。快照/上传参数是Codocs BFF自产的内部数据，不接受浏览器直传；外部BFF还必须校验实际用户documents:create资格。返回模板/快照中的存储路径仅供Codocs内部，不得传给AIMS。

外部Service未开放，创建授权Seed仍不安装；后续接BFF时需要Codocs自身Runtime写传输授权及精确create能力。专项Go测试通过，覆盖三阶段缺scope/宽scope/readscope/缺签名及非POST在存储前拒绝；此轮未验证真实Service/JWT/OSS链路。

### 2026-09-08：创建Service处理器编排

- productDocumentCreateService完成严格六字段/UUID/schema/create capability与HMAC校验，签名用户创建资格先于模板读取；接实际Codocs Runtime template/prepare/complete、正文下载/恢复及uploadPreparedProductDocument和uploadDocument。完成前再校验创建资格，回执核对目标/产品/标题，白名单输出无存储路径。
- Codocs typecheck及处理器Lint通过；两项VM专项验证真实HMAC、资格检查顺序、精确写scope/actor、模板正文传入准备、readscope/actor篡改拒绝；Runtime/上传编排适配器为stub。
- 处理器尚未注册middleware外部路径，create授权仍未安装；待挂入口、生成授权与完整联调。

### 2026-09-08：产品模板创建 Service 入口与授权产物

`POST /api/v1/service/product-documents/create` 已由 Codocs middleware 精确分发到创建处理器。入站要求 AIMS 精确 `codocs:product-document:create`；Codocs 自身访问 Runtime 使用 `codocs.write codocs:product-document:create`。Console生成产物增加AIMS→Codocs及Codocs→双Runtime的create业务授权，Codocs写传输只列前置核验、不自动扩大。

矩阵现为178条业务授权、10条传输前置要求，共188项。七项manifest/grant测试、Codocs typecheck及相关Lint通过；隔离MySQL验证188项、种子幂等、缺客户端、非选定客户端、缺传输、inactive授权与过期凭证门禁。原测试固定数量随新增组合更新：Codocs凭证失效影响8项，AIMS凭证失效影响176项、其余12项通过。未安装到真实租户，未完成实际service token组合签发探测或OSS联调。AIMS模板创建调用与UI仍待接入。

### 2026-09-08：创建Service与实际上传编排组合验证

- 创建handler测试移除uploadPreparedProductDocument替身，直接执行实际快照身份/hash校验、随机路径上传和完成重放逻辑，保留真实Foundation HMAC验证；验证上传使用冻结正文而非本次重新下载内容。
- 六项创建相关测试通过：completed跳过upload、原路径重放、上传失败不complete、首次/完成前创建资格拒绝阻断后续提交。存储及Runtime仍为stub，不宣称真实OSS/JWT端到端验收。

### 2026-09-08：AIMS 模板创建服务调用

- 新增createProductDocumentFromTemplate，严格目标/模板/操作UUID、幂等键及标题，要求当前产品documents edit；复用可信路由与签名编排，以独立create scope和短schema发送持久身份，验证回执目标/产品/标题并返回最小创建结果。只读调用保持原scope与schema。
- 五项调用方VM测试通过，含元数据/搜索/正文回归、稳定操作/幂等身份与签名actor、精确create、错误回执和权限拒绝。
- 尚待AIMS持久创建请求与关联恢复、BFF及UI接入，不能由helper存在视为产品内模板创建可用。

### 2026-09-08：AIMS 创建请求持久关系

- v5.35与canonical schema新增product_document_creation_requests，关联现有integration_operation（冻结命令/actor/回执事实源），只保存产品、目标UUID、用途与最终产品文档关联。请求/操作/目标/关联各自唯一，工作空间/操作/关联外键，关联ID与时间一致性CHECK。创建中/待关联状态将从操作结果与relation是否为空推导，不新增第二套操作状态机。
- 隔离MySQL验证迁移重复执行、真实integration_operation列兼容及缺操作外键拒绝；产品中心测试fixture加入实际操作表前置依赖和v5.35，canonical与增量迁移一致性测试通过。
- 下一步同事务登记请求与冻结操作、回执后关联恢复；当前只有存储结构，未开放BFF/UI。

### 2026-09-08：AIMS模板创建请求登记事务

- CreateProductDocumentRequest校验当前product_documents edit、active/修订及模板/标题/用途；同事务生成稳定请求/操作/目标UUID、现有integration_operation冻结六字段创建命令/hash、请求关系、工作空间修订及脱敏活动记录。本地命令回执保证重试返回原身份，next_attempt_at显式UTC写入。
- 真实隔离MySQL专项通过：请求插入故障时操作/请求/本地回执均回滚；重试成功后再重放保持操作/目标身份，操作JSON目标与请求表一致。首次测试按JSON字节比较受MySQL格式影响，已改语义比较。
- 未挂Runtime/BFF或派发器；下一步需领取/回执确认及产品关联恢复，不能假设pending操作已能自动执行。

### 2026-09-08：交互重试保持原始创建人

- 模板创建调用输入补充持久actorUid；当前用户获得product_documents edit后必须与原actor相同，否则在token签发/签名/外呼前403。避免换操作者重试时修改已冻结命令hash。
- 六项调用方测试与Lint通过，新增actor变化不外呼验证。后台派发后续应使用领取操作中的原命令，并由Codocs重新检查原用户创建资格，不能调用会重绑定会话的交互helper。
- 实查现有通用AIMS派发器尚不识别产品创建operation，需新增专用分支及对应Runtime允许清单后才可开放请求登记入口。

### 2026-09-08：创建回执补齐派发确认身份

创建Runtime及外部Service回执增加 operationId/operationCode/idempotencyKey/commandSchemaVersion/commandSha256，均取已验证创建信封；Service逐项与本次冻结命令比较，避免仅凭目标UUID确认另一条命令。保留原receiptId/status/target/result白名单，不外发存储路径。四项handler组合测试和创建Go专项通过，新增回执command hash不匹配拒绝，相关Lint通过。后台派发器分支尚待实现。

### 2026-09-08：产品文档创建专用执行器

- executeClaimedProductDocumentOperation复用Foundation命令信封/回执/失败分类，校验冻结command hash与固定create合同，保持原actor；验证目标及业务结果后使用operationId/fencingToken完整回执身份确认成功。目标成功但source ACK失败保持pending，不写失败覆盖已成功目标。
- 专项VM测试使用实际Foundation hash/回执校验，覆盖成功lease checkpoint、篡改actor不外呼、错误回执不确认、ACK丢失不标失败。执行器尚未接统一dispatcher/真实IO，后续须补Runtime领取与确认允许清单、授权与集成测试。

### PC16 文档创建统一派发接入（2026-09-08）

- AIMS 统一 claimed operation dispatcher 已识别 `aims.codocs.product-document.create.v1`，交由专用执行器校验冻结命令、目标回执与 fencing token。
- 投递 IO 缺失时以 503 记录可重试失败，不把合法产品文档命令误判为不支持的永久失败；目标成功但 checkpoint 失败仍保留待恢复状态。
- 验证：执行器测试经真实统一 dispatcher 运行，覆盖冻结操作者、命令篡改、错误回执、ACK 丢失和通道缺失；与 drain 契约测试合计 6 项通过。
- 尚待完成：Runtime claim/succeed 对产品文档操作的支持核验、创建后关联、请求 API 与页面，以及真实环境授权与跨部署调用验收。本次不代表创建闭环已可用。

### PC16 Runtime 文档创建回执兼容（2026-09-08）

- Runtime 的成功／失败 checkpoint 现在识别产品文档创建命令，严格检查六字段、操作者／产品／标题、规范 UUID 和目标应用；目标文档标识只取冻结命令。
- 修正通用成功处理固定使用 `v1` 的问题：产品文档创建使用 `product-document-create.v1`，既有操作维持原 schema。
- 增加真实 Runtime handler 的 SQL mock 成功路径，验证目标文档、receipt、worker、fencing token 与事务提交；另覆盖错误目标、非法字段与多余字段。相关 Go 测试通过。
- 这里只保存 integration operation 成功事实；产品关联仍待独立事务补齐，未宣称真实 JWT／跨应用／数据库端到端验收完成。

### PC16 创建结果关联事务（2026-09-08）

- 新增 `LinkCreatedProductDocument` 领域命令：当前产品文档 edit permit、活动状态和产品修订通过后，锁定创建请求；核验 caller operation 已 succeeded，且目标回执、冻结产品和文档 UUID 与请求一致。
- 文档关系、创建请求关联、产品修订和脱敏活动日志同事务写入；已有有效关系可复用，已解除关系必须显式恢复，不能由创建重试复活。
- 验证：隔离 MySQL 的 `TestMySQLProductDocumentRequestAtomic` 扩展覆盖 pending 拒绝、注入请求更新失败后的关系回滚、成功关联、同键重放和解除后拒绝重新关联，实际执行通过。
- 仍未暴露新接口：调用方必须先通过 Codocs 验证当前用户对服务端解析出的文档可访问；后续补 Runtime/BFF 与页面。

### PC16 创建请求内部读取（2026-09-08）

- 增加 documents:request-view 内部 Runtime 入口，复用精确 read scope，同时强制产品文档 edit 范围，服务端按请求 biz_id 解析目标文档、operation key 和状态。
- 隔离 MySQL 测试覆盖 pending 请求读取、错误产品和错误操作者拒绝；既有创建／关联事务测试及 AIMS 产品文档相关测试通过。
- 浏览器 BFF、创建与关联写入入口、页面仍待接通；内部读取不等于 Codocs ACL 授权。

### PC16 创建与关联内部写入入口（2026-09-08）

- Runtime 已接通 documents:template-create 和 documents:link-created，复用既有精确 AIMS 文档创建 capability，领域层继续校验当前产品 edit permit。创建操作的租户／源部署只由认证后的 Runtime query 构造，操作者不从浏览器 body 获取。
- Runtime 边界测试加入两条写入口与 request-view，覆盖缺失委托身份／租户／部署／服务身份、宽 scope 和错误 HTTP 方法拒绝；相关 Go 测试实际通过。
- 尚待浏览器 BFF 的 Codocs ACL 预检、即时派发与页面，不视为用户可用的完整功能。

### PC16 模板创建 BFF（2026-09-08）

- 已接入现有 roadmaps catch-all 的 documents/template-create；严格四字段输入、稳定幂等键、产品 edit、Codocs 模板 ACL、操作者／修订二次检查后登记请求；只返回请求编号和产品修订。
- 相关 7 项测试通过，新增路径实际 dispatcher 测试通过，AIMS typecheck 与新增 helper/test lint 通过。覆盖模板 ACL 拒绝、actor 注入、身份变化、错误产品回执。
- 尚待即时派发／状态恢复与结果关联 BFF、模板创建页面；不表示已完成创建闭环。

### PC16 创建结果关联 BFF（2026-09-08）

- 接通 documents/link-created 浏览器路由；目标 UUID 仅从产品创建请求解析，目标创建成功及当前 Codocs ACL 通过后才关联，关联前复核产品身份与修订。
- 新增 VM BFF 测试覆盖服务端解析／ACL／稳定幂等键，以及注入、ACL 拒绝、身份变化、外产品请求和 pending 请求拒绝；结合路由等相关测试 7 项通过。
- 即时派发、状态恢复与模板创建 UI 仍待接通，尚未真实跨应用端到端验收。

### PC16 模板请求即时派发（2026-09-08）

- 模板创建 BFF 现在在持久化后尝试领取原 operation 并执行 Codocs 创建；核对租约响应的 key／产品／operation code。即时失败保留原请求，返回 creationConfirmed=false；仅目标和 source checkpoint 均确认才为 true。
- 相关 BFF／执行器 6 项测试及即时派发绑定测试通过，覆盖调用失败保留请求、错误 key／产品／类型不得外呼、无租约保留 pending。
- 状态恢复入口和模板创建 UI 待完成；真实环境 grant、JWT、OSS 与跨应用端到端仍未验收。

### PC16 创建状态 BFF（2026-09-08）

- 已接通 documents/request-status GET，可查询原请求状态用于恢复 UI；只返回请求、状态、产品修订和已建立关联 ID，不公开内部文档／任务标识。成功状态检查 Codocs ACL，pending 不访问目标文档。
- 相关 7 项测试通过，覆盖无目标标识泄露、pending 分支、额外字段、跨产品响应、未知状态、ACL 拒绝和授权变化，并验证真实 catch-all 分发。
- 尚待模板创建页面与恢复交互、真实跨应用验收；整体产品中心目标未完成。

### PC16 模板创建页面（2026-09-08）

- 文档页增加从模板创建入口，复用已有搜索选择弹窗；填写新标题和用途，登记请求后查询状态，成功后按最新产品修订关联。pending 保留请求编号，重复刷新只查原请求，不重新创建。关闭弹窗后可在当前页面重新打开进度。
- AIMS typecheck 与修改 Vue 文件 lint 通过；隔离 Nuxt + Chrome 在 1440/390 视口完成模板选择、填写、pending、刷新成功关联，断言只创建一次／只关联一次／无 pageerror／无横向溢出，并检查两张截图。接口为浏览器模拟，不能证明真实 JWT／OSS 链路。
- 尚待整页刷新后的历史请求恢复、终态失败管理、真实跨应用联调；不得视为 PC16 全部完成。

### PC16 请求历史分页基础（2026-09-08）

- Runtime 增加 requests-list，当前产品文档 edit 范围内分页查询产品自有请求事实；不带文档内容、标识或内部任务细节。
- 实际隔离 MySQL 验证两条请求跨页、固定降序、总数、已关联标记和错误操作者拒绝；Runtime 精确 scope／身份／HTTP 方法边界测试通过。
- 下一步补浏览器 BFF 和历史请求列表，使整页刷新后能恢复原请求。

### PC16 历史请求 BFF（2026-09-08）

- 已接通 documents/requests 的服务端分页浏览器接口，严格输入、响应一致性及字段白名单，当前产品 edit 二次校验后返回。
- 相关 7 项测试和 AIMS typecheck 通过；测试覆盖分页参数传递、内部字段剥离、非法参数、错误产品／状态／行数、授权变化及路由分发。
- 后续把历史列表接入页面，以完成刷新页面后的恢复入口。

### PC16 历史请求恢复页面（2026-09-08）

- 文档页增加创建记录弹窗，真实分页请求 10 条，展示请求编号／用途／状态；未关联请求可继续处理，复用模板创建组件的原请求状态查询与关联流程，不重建操作。
- typecheck 与 Vue lint 通过；隔离 Chrome 1440/390 实际 reload 后从历史列表恢复 pending 请求，刷新为 succeeded 并关联，断言创建接口调用 0 次、关联 1 次、无 pageerror／整页横向溢出。检查稳定截图并加宽手机端请求编号列，表格局部可横向滚动。接口使用 mock，真实多应用链路仍未验收。
- 后续继续处理终态失败管理、恢复时实际重新派发策略及真实环境验收，整体目标未完成。

### PC16 派发精确权限核对（2026-09-08）

- 修复 AIMS integration operation 执行检查仍接受 `*`／`aims.*` 的问题，现在仅精确 `aims:integration_operation:execute` 可通过；BFF 原本已请求此精确 scope，无需退回宽 scope。
- 新增四条真实 Runtime 路由（claim-next／claim／fail／succeed）对五类宽 scope／管理界面 scope 的拒绝测试，保证数据库访问前失败；相关 integration operation 和文档回执测试通过。
- 核对发现本产品中心 grant 生成器尚未列入既有 worker 精确执行 scope；已查找的 Console SQL 中仅发现覆盖核验引用，未确认双 audience seed。下一步补齐／核验 worker 授权交付，目标环境启用仍未证明。

### PC16 worker 授权交付补齐（2026-09-08）

- AIMS manifest 补登记既有 `integration_operation:execute` 服务能力，不加入 recommendedRoles；产品授权生成器为 AIMS runtime client 安装 data-runtime／tenant-runtime 双 audience 的精确执行 grant。
- 重生成 Console Seed／Verify；当前矩阵为 180 项安装授权 + 10 项传输前置要求 = 190 项。隔离 MySQL 实际执行通过，覆盖幂等 seed、缺失／诱饵客户端、失效凭证、inactive grant 和双 audience。
- 4 项 grant／manifest 契约测试通过。真实目标环境尚未执行安装或核验，不能据此宣称 worker 已启用。

### PC16 请求恢复重新派发（2026-09-08）

- 增加 request-resume POST，复用请求归属和产品 edit 校验，只领取原可重试 operation，不创建新请求或修改终态。UI 继续处理先恢复再查询最新状态与关联。
- 8 项相关测试、AIMS typecheck、修改代码 lint 通过；Chrome 模拟接口 1440/390 历史恢复复测通过，恢复 body 保留原 requestBizId，创建接口 0 次、关联 1 次。
- 真正 grant/token/OSS/跨部署端到端验收仍未完成；终态管理入口与其他产品中心阶段继续推进。

### PC16 实际投递适配器验证（2026-09-08）

- 新增对真实 serviceTicketDeliveryOperation 模块的 VM 测试，分别调用 request-bound／scheduled IO，核对产品创建 URL、精确 scope、原操作者、幂等键以及签名的不同源／目标 deployment。
- 覆盖缺少 trusted route、缺少 gateway、租户不匹配时在 token 请求前拒绝；scheduled 缺少目标 deployment 不回退源部署。两项测试通过；Foundation 签名／token／fetch adapter 为受控替身，不能替代实际 JWT/HMAC/网络验收。
- 共享 Codocs 投递错误文案改为通用操作说明，避免文档创建失败时误报公司周报发布失败。

### PC16 关联成功证据绑定加强（2026-09-08）

- 关联事务额外要求非空 receipt、精确 Codocs 创建 capability、固定创建 schema，并核对 operation 原操作者及冻结 command actor 与请求创建人一致。当前恢复操作者仍单独经过产品 edit 和 Codocs ACL，不替换历史创建人。
- 隔离 MySQL 扩展注入空 receipt、错误原操作者、错误 schema、宽 capability 四种损坏证据，均拒绝关联；还覆盖原有成功、回滚、重放、分页场景。实际测试通过。

### PC17 首条反馈集成契约细化（2026-09-08）

- 新增 Aims-Product-Feedback-Contract.md，依据已有 Altoc 服务工单产品字段与 AIMS 手工来源边界，明确需求类工单进入产品需求池的拟定接口、冻结身份、自然键、权限、事务、回执、合并和状态回流规则。
- 明确客户服务 priority 不转为产品评分，verified 只证明来源，不证明价值；状态回流不关闭工单。列出六步实现和验收要求。
- PC17 尚未编码或启用，源工单并发令牌与对象授权机制仍须实现前核对；PC12 真实验收依赖未解除。

### PC17 冻结反馈命令输入边界（2026-09-08）

- 核对 Altoc 既有工单冻结操作采用 edit + 对象范围 + FOR UPDATE；未把 operation.version_no 当作工单修订使用。
- AIMS 新增 FeedbackRequest 严格七字段解析，规范 UUID、标识／标题长度及文本边界；不接受 priority／verified／customerId 等附加覆盖字段，避免客户服务优先级直接进入产品评分。
- Go 输入测试实际通过。尚无 PC17 Service API、来源持久化和回执链路，继续按独立契约实施。

### PC17 正式反馈来源绑定 Schema（2026-09-08）

- 增加 v5.36 product_feedback_bindings 并同步 canonical schema：正式来源三元组唯一、来源证据 ID 唯一，关联产品工作空间／产品需求／来源证据外键；首版仅接受 Altoc service_ticket 来源和非空创建人。手工来源表保持既有行为。
- 隔离 MySQL 验证不同证据不能重复绑定同一来源、同一证据不能绑定第二来源、非法来源／空标识／空创建人拒绝；canonical 与增量迁移一致性测试通过。
- 目前仅存储约束，request/source/product 跨字段一致性仍由后续接收事务强制校验；尚无可调用反馈服务。

### PC17 反馈接收事务核心（2026-09-08）

- 新增 ReceiveFeedbackRequestTx，供未来目标 receipt 事务调用：当前产品 create 授权及活动状态、来源自然键检查后，写需求、正式来源、绑定、产品修订和脱敏日志；同来源另一需求／产品冲突。
- 初始需求 submitted/P2，来源 verified/neutral；不将服务工单优先级或客户主张直接转换为产品评分。verified 依赖调用前真实服务认证，当前函数未暴露 API。
- 隔离 MySQL 测试覆盖绑定插入故障时三表回滚、成功接收、重复调用单一记录、同源第二需求拒绝。目标 service receipt 外层和来源派发尚待实现，不能声称已完成跨应用原子回执。

### PC17 接收回执事务（2026-09-08）

- ReceiveFeedbackWithReceipt 固定校验来源／目标／操作／capability／schema 与原 actor，一次当前产品 create 授权预检后调用共享 ReceiptRepository，需求写入 callback 内再次检查产品授权；成功 mutation 和 receipt 同事务。
- 隔离 MySQL 实际加载 AIMS receipt schema，验证成功与同键重试返回同 receipt；注入末端活动日志失败，需求／来源／绑定／回执四表均回滚；原 actor 不一致拒绝。
- 该封装仅供后续经过 JWT／签名验证的服务入口调用，不是认证边界；尚未接通外部接口与 Altoc 派发。

### PC17 回执重放补充验证（2026-09-08）

- 隔离 MySQL 扩展验证同键异内容拒绝、产品经理修改需求后原请求重放不覆盖当前标题、撤销成员资格后旧 permit 无法读取成功回执。
- TestMySQLFeedbackReceiptReplay 实际通过；该证据覆盖持久化与当前产品事实，仍不替代外部 JWT／签名／服务授权验收。

### PC17 Runtime 反馈命令认证绑定解析（2026-09-08）

- 复用共享 ReceiptCommandFromBody 校验冻结命令 hash／receipt 身份；额外固定 Altoc 来源 client、AIMS 目标、短 schema、精确 capability，并将 service-command 委托用户、Runtime tenant 和目标部署与命令绑定。
- Go 测试覆盖可信输入、逐项伪造 actor／tenant／deployment／来源／委托用途、宽 scope 以及命令 hash 篡改，实际通过。该测试使用 Runtime 注入上下文夹具，不代表完成 HTTP JWT／签名验证。
- 解析器尚未注册外部可调用入口；产品授权与接收回执事务将在后续 handler 中串联。

### PC17 内部接收 Runtime 入口（2026-09-08）

- 已串联命令解析、当前产品 permit 和共享回执事务，内部 POST product-requests:from-feedback 返回完整标准回执。manifest 声明精确服务能力，不加入用户角色。
- Go 解析与真实路由拒绝测试通过：宽 scope、缺失签名上下文在存储前失败，GET 405；4 项已有 grant/manifest 契约测试通过。
- 成功事务已有领域 MySQL 证据，但新 Runtime 组合成功路径／外部 BFF／Altoc 源派发和部署授权尚待完整验证。

### PC17 服务操作者授权事实入口（2026-09-08）

- 核对现有 productAuthorization.ts 依赖浏览器 session，不能直接用于服务命令；增加反馈专用内部 authorization 查询，先走完整 command 身份解析再读取冻结 product/actor 的当前事实。
- 保持现有普通产品授权入口限制，不通过伪造 session 或放宽 actor purpose 实现服务授权。Go 反馈相关测试通过，新增未签名 actor／普通 read capability 拒绝场景。
- 后续 AIMS BFF 仍须用 Foundation scoped evaluator 将事实与当前 Console grant 合并为 permit；此查询不授予任何产品动作。

### PC17 原操作者产品权限评估（2026-09-08）

- 新增 requireProductFeedbackAuthorization：按签名原 actor 与服务端产品事实构造既有 productAuthorizationObject，通过 Console scoped authorization 和 Foundation evaluator 评估 product_requests:create，输出短期 permit。无浏览器 session 替换，无复制授权算法。
- 两项测试使用真实 Foundation evaluator，覆盖原 actor、产品范围、仅 view 权限、成员撤销、错误产品事实和归档产品；实际通过。Console 访问使用替身，外部服务 handler 仍待接入。

### PC17 外部服务身份绑定 helper（2026-09-08）

- 新增 requireProductFeedbackServiceAuth，调用现有 Console 认证与精确 service scope helper，并要求 altoc.runtime、Altoc 源身份及已验证 Gateway 的 AIMS 目标部署；源／目标部署分别返回给后续签名校验。
- 测试覆盖不同源目标部署、错误客户端、缺失可信 Gateway、租户／目标应用不匹配；实际通过。未注册新的外部 endpoint，HTTP JWT／完整签名链路仍待接入。

### PC17 外部反馈服务处理器（2026-09-08）

- 新增 handleProductFeedbackService：精确来源认证、七字段与命令 hash 校验、Foundation 签名验证、command-bound 产品事实查询、原 actor scoped permit、内部接收及完整 receipt 匹配；返回字段白名单不泄露 command。
- 两项 VM 处理器测试使用真实 command hash，覆盖调用顺序、签名失败、命令篡改、权限拒绝及错误目标 receipt；token/signature/runtime/Console 依赖为替身，尚不是真实集成验收。
- 当前未注册外部路由，下一步同时接入路由和服务授权配置。

### PC17 外部反馈路由接入（2026-09-08）

- 已登记确切 /api/v1/service/product-requests/from-feedback，Console auth context 解析后进入专用处理器，不经过通用 Runtime 转发。同步模块契约与 AIMS CLAUDE。
- 9 项路由／处理器／service auth 测试通过；路由 VM 验证 auth→feedback 顺序与禁止 generic proxy。
- Altoc 来源提交／派发和 Console grant 安装仍待完成，路由存在不等于部署态可用。

### PC17 反馈精确服务授权配置（2026-09-08）

- grant generator 增加 Altoc → AIMS 的 product-request:create-from-feedback，以及 AIMS → 两种 Runtime audience 的同名精确能力；独立选择 altoc.runtime 客户端，安装前检查四个客户端及当前凭据。
- 重新生成 Seed / Verify SQL；现有 transport 权限仍只校验，不自动扩权。5 项契约测试通过；隔离 MySQL 验证 193 项要求（183 项安装、10 项既有 transport），包含重复安装、无关客户端不授权、Altoc 无效凭据时即使 --force 也不产生授权。
- 未向实际 Console 租户安装授权；Altoc 提交／派发与真实 token、签名验收仍待完成。

### PC17 Altoc 来源摘要与并发协议（2026-09-08）

- 核对工单无可复用整数修订，确定首次提交使用 expectedSourceSha256 并在行锁内重算；已有绑定重用原冻结命令。
- 实现 Altoc 来源摘要 helper，限定需求类工单、规范产品／编号／标题与说明；空说明统一为空字符串，客户联系方式与服务优先级不进入快照。
- Go 测试通过：标题变化使摘要失效、服务优先级变化不影响摘要、非法来源拒绝。尚待接入读取／冻结事务与派发，不能视为已完成提交链路。

### PC17 Altoc 首次提交冻结事务（2026-09-08）

- 新增 Altoc 046 迁移及 canonical service_ticket_product_feedback：每工单唯一提交、请求 UUID 与 operation UUID 唯一，记录冻结产品、来源摘要和原 actor；不复制客户主档，不修改工单 SLA／状态。
- 实现 freezeServiceTicketProductFeedback：当前工单 edit／对象范围、可信租户部署、行锁、首次来源摘要匹配、operation + 绑定 + 审计同事务；已有绑定返回原身份，工单后续编辑不重建反馈。
- Go/sqlmock 覆盖来源变更、跨 owner 拒绝、成功、重放及绑定插入失败回滚，通过。该证据不替代真实 MySQL 事务验收；函数尚未注册用户入口，读取／派发／checkpoint 仍待接入。

### PC17 Altoc 冻结事务真实 MySQL 验证（2026-09-08）

- 新增 TestMySQLProductFeedbackFreezeAtomic，在专用隔离 socket 的临时数据库加载 canonical operation／audit／反馈绑定 DDL，并重复应用 046 迁移。源 customer／ticket 使用最小真实表夹具。
- 实际调用冻结函数：注入末端审计故障后三表全回滚；成功后修改工单标题和产品，重复提交保持原 request UUID／产品／命令；撤销 owner 后拒绝读取原绑定。验证提交、请求、operation 唯一键及工单外键、非空产品／actor 约束。
- 上述真实 MySQL 测试和来源摘要／sqlmock 测试共同通过；不代表源 BFF、派发、目标认证或真实租户部署验收完成。

### PC17 Altoc Runtime 读取与冻结入口（2026-09-08）

- Runtime 登记 GET service-tickets/{code}/product-request 与 POST product-request:freeze；读取要求当前工单 edit／对象范围及可信租户部署，在一致快照事务中返回首次提交预览摘要或原提交状态白名单。
- 已提交工单返回冻结产品和请求身份，不把后续修改后的标题／正文当作已提交内容展示；冻结路径继续使用同事务操作。
- 扩展隔离 MySQL：读取预览摘要与冻结值一致，工单修改后状态仍指向原产品，owner 撤权后状态读取拒绝。测试通过。浏览器 BFF 严格输入、授权转发与实际派发尚未接通，新增 Runtime 路由本身不代表可从页面提交。

### PC17 Altoc 浏览器 BFF 接入（2026-09-08）

- 新增 GET／POST service-tickets/{ticketCode}/product-request，本地 middleware 保留专用 handler；当前登录、service_ticket:edit 和 scoped query 经既有 Foundation Runtime 客户端传递。
- POST 严格仅接受 expectedSourceSha256，禁止 query／产品／actor 覆盖；返回 202 accepted 的白名单提交状态，不返回内部 operation 或 command。GET 返回已授权预览或状态。
- Altoc typecheck、2 项 BFF VM 测试及相关文件 lint 通过；测试覆盖未登录、权限拒绝、附加字段和 query 注入拒绝。Runtime／授权依赖为替身，不代表真实跨应用投递完成。
- 尚未实现反馈 executor 和页面按钮，不能启用为完整反馈功能；需完成 worker 注册、receipt checkpoint 及恢复链路后验收。

### PC17 反馈 worker 与回执确认（2026-09-08）

- 新增 productFeedbackOperation 并注册既有 integrationOperationDrain，固定目标路径／capability／短 schema／原 actor／需求 UUID；复用标准 envelope 和 receipt verifier，成功通过源 Runtime :succeed 保存回执。
- 源 Runtime expected target 增加 product_request，回执 schema 按固定反馈 operation 选择 product-feedback-create.v1，其余既有操作保持 v1。提交关联状态通过同一 operation 读取，无需复制工单状态。
- 目标成功后 source checkpoint ACK 丢失返回 pending，不再补写 fail。执行器测试使用真实 Foundation envelope／receipt helper，验证成功、错目标、原 actor 冲突和 ACK 丢失；网络 IO 为替身。
- Altoc typecheck、执行器 lint、相关 Go 与 TS 测试通过。即时提交派发／页面／实际 token-signature 传输及新 Runtime success 组合验收仍待完成，不代表部署可用。

### PC17 提交后即时派发（2026-09-08）

- 浏览器提交冻结成功后尝试领取该 submission 的确定性 operation key，额外绑定工单／产品／请求身份后调用已注册反馈 executor；不接受浏览器指定 operation。
- processing／终态不重置，领取失败或 ACK 异常保留已持久化提交。源确认 succeeded 后响应显示成功状态；其余仍返回 accepted，GET 状态读取不产生网络写入。
- VM 派发测试覆盖正确身份、错误工单／产品／请求／键、领取失败及无需重领状态；BFF 测试、Altoc typecheck、相关 lint 通过。实际服务 transport 签名与授权仍需验证，页面／状态回流仍待完成。

### PC17 专用签名传输补齐（2026-09-08）

- 核对发现 Altoc 既有 callServiceApp 仅附带 service token，未生成反馈目标要求的命令签名；反馈 executor 改为强制专用 transport，不再调用该无签名通道。
- 新增 sendProductFeedback，使用 Foundation buildServiceCommandRuntimeHeaders，绑定冻结 tenant／源 deployment、可信 AIMS 目标 deployment、altoc.runtime、精确 capability、原 envelope 与 request target；浏览器请求缺失可信 Gateway／route 或租户部署不符时在申请 token 前拒绝。
- scheduled IO 接受显式 feedbackTargetDeployment，缺失时安全失败，不回退源部署；上层 scheduled 配置传入仍待接线。
- 实际 transport 模块 VM 测试核对不同源目标部署、签名 header 和缺失路由拒绝；签名/token/fetch 提供器使用替身，尚未完成真实 HMAC／JWT 调用。执行器测试、Altoc typecheck 和相关 lint 通过。

### PC17 scheduled 目标部署接线（2026-09-08）

- Nuxt 增加 hzy.productFeedback.aimsDeployment，映射 HZY_ALTOC_PRODUCT_FEEDBACK_AIMS_DEPLOYMENT；scheduled drain 显式传入专用反馈 transport。
- 配置测试验证 config／env 取值与禁止回退 Altoc 源部署；结合 transport 测试，缺失目标在 token 申请前拒绝。两项测试、Altoc typecheck 和相关 lint 通过。
- 未修改实际环境配置或授权。后续仍需核对 Altoc worker 自身 Runtime execute 精确 grant、真实签名验收及页面。

### PC17 Altoc worker 与源提交服务授权（2026-09-08）

- Altoc manifest 明确声明既有 Runtime worker 使用的 integration_operation:execute 服务资源，不加入用户角色；与人类诊断／重放的 integration_operations 资源区分。
- 产品授权生成器增加 Altoc 两种 Runtime audience 的 execute、service_ticket:edit 精确能力，并校验 Altoc manifest；read/write transport 仅作为已有前提检查，不自动扩权。
- 6 项授权契约测试通过；隔离 MySQL 执行生成 SQL 验证 201 项要求（187 项安装、14 项 transport 前提），包括 Altoc 凭据失效阻止整个安装、重复 seed、无关客户端不授权和 expired credential。
- 未在真实 Console 租户安装；真实 token issuance、角色／产品权限、页面与状态回流验收仍待完成。

### PC17 真实签名算法验证（2026-09-08）

- 将反馈 transport 测试中的签名替身替换为 Foundation 实际 buildServiceCommandRuntimeHeaders，fetch 边界调用实际 verifyServiceCommandRuntimeHeaders；命令摘要使用实际 hashServiceCommandPayload。
- 请求态与 scheduled 两种源／目标部署路径均能完成真实签名验签；更换 token、目标部署、请求路径或原 actor 对应命令 hash 均被拒绝。测试及 lint 通过。
- Token 仍为测试字符串、Gateway／网络仍为受控替身，因此证据仅证明实际签名算法和参数衔接，不证明 Console JWT 发行、部署授权或真实 HTTP 端到端完成。

### PC17 刷新后恢复原反馈提交（2026-09-08）

- 新增 POST service-tickets/{ticketCode}/product-request-resume，严格空对象输入；重新按当前工单 edit／对象权限读取原提交后派发，不依赖首次摘要，不调用冻结创建。
- 无原提交返回 409；已有 processing／终态沿用 dispatcher 行为，不重置租约或另建请求。GET 状态查询仍无派发副作用。
- 3 项 BFF 测试和相关 lint 通过，覆盖恢复调用仅使用 Runtime GET、无提交拒绝和覆盖字段拒绝。该入口将用于页面刷新后的继续派发。

### PC17 工单产品反馈页面（2026-09-08）

- 客户详情的需求类服务工单增加产品反馈弹窗：授权预览产品／标题／说明，确认提交，查看原需求编号和派发状态，刷新后继续派发；不把进入需求池显示为版本承诺或工单关闭。
- 请求失败后清除可提交状态并提示刷新核对；切换工单使旧请求失效。派发中禁止重复操作，未确认结果不自动重建提交。
- Altoc typecheck／组件 lint 通过；隔离 Nuxt 导入实际组件，在真实 Chrome 1440／390 尺寸完成提交→刷新页面→继续派发，验证每次仅一次创建、一次恢复，无页面错误／全局横向溢出，截图已查看。
- 页面 QA 使用模拟 API，不能证明客户详情真实数据权限、JWT 或实际跨应用投递已验收。状态回流与 PC12 真实环境验收仍待完成。

### PC17 源侧回执真实 MySQL 收口（2026-09-08）

- 扩展实际 MySQL 场景加载 canonical attempt／dead-letter 表，调用真实 Runtime claim 与 succeed 函数，使用冻结 operation 的 hash、租约和目标身份完成源回执确认。
- 验证另一需求 UUID 的回执拒绝、错误 v1 schema 拒绝；正确反馈短 schema 与冻结需求回执成功后，工单反馈读取显示 succeeded。
- TestMySQLProductFeedbackFreezeAtomic 通过，串联源冻结→领取→receipt checkpoint→状态读取；目标 receipt 为构造证据，仍不替代真实 AIMS 网络与 JWT 验收。

### PC17 产品决策回流投影核心（2026-09-08）

- 新增 Altoc 047/canonical product_feedback_status_projection，以及供已认证 receipt 事务调用的 applyProductFeedbackStatusTx。绑定原工单提交产品和 request UUID，保存 canonical request 与决策，不改写工单或原提交身份。
- sourceRevision 单调推进：较旧事件跳过，同 revision 同 hash 幂等、异内容冲突；merged 必须引用另一 canonical request，其余决策保持原 request。
- 隔离 MySQL 覆盖外层回滚无投影、成功提交、重复／旧代际、同代际冲突、合并保留原身份以及工单产品后改后不能冒充原提交产品，实际通过。
- 当前仅领域投影，尚无 AIMS 决策事务 outbox、Altoc 签名状态入口与回流 UI，不表示状态回流已可用。

### PC17 决策回流输入边界（2026-09-08）

- 增加精确六字段状态命令解析，拒绝缺失／null／额外字段，禁止传入工单状态覆盖；投影事务在访问数据库前检查来源标识、决策／canonical 身份一致性及正安全整数 revision。
- sourceRevision 上限采用 JavaScript 可精确表达的最大整数，避免 Go uint64 与跨应用 JSON 客户端精度差异导致版本或摘要歧义。
- Go 测试覆盖字段注入、空值、分数／字符串／零／过大 revision、非法来源和 canonical 关系，实际通过。状态服务入口与源 AIMS outbox 尚待接通。

### PC17 状态回流原子回执（2026-09-08）

- 新增 receiveProductFeedbackStatus，固定 AIMS 来源 client、Altoc 目标、状态操作／capability／schema；重复接收也检查原工单绑定仍存在，再通过共享 ReceiptRepository 将状态投影与成功回执同事务保存。
- 隔离 MySQL 加载 canonical receipt 表，覆盖状态写入故障不留下回执、成功和同键重放返回原 receipt ID，实际通过。
- 封装仍要求调用前完成 JWT／命令签名验证，尚未暴露状态服务入口；AIMS outbox 和回流页面继续待实现。

### PC17 状态回流内部 Runtime 入口（2026-09-08）

- 登记 POST /v1/altoc/internal/product-feedback:status，精确 capability、标准签名上下文解析和 Altoc 自身 Runtime tenant／目标 deployment 绑定通过后，执行状态原子回执并返回完整标准 receipt。
- Go 测试验证宽 scope、缺失签名上下文和 GET 在访问存储前拒绝，通过。当前未增加外部 HTTP 服务入口，不允许浏览器直接构造 reserved context。
- 外部 JWT／签名处理器、AIMS 状态 outbox、授权配置和状态展示仍待接入。

### PC17 状态回流能力与授权配置（2026-09-08）

- Altoc manifest 声明 product-feedback:update-status 服务能力，不授予用户角色；生成器补 AIMS→Altoc 和 Altoc→双 Runtime audience 的精确状态更新授权。
- 7 项契约测试及隔离 MySQL seed/verify 通过：共 204 项要求（190 项安装、14 项 transport 前提），包括精确客户端、重复安装、当前凭据与失败 guard。
- 仅完成配置产物，未向真实 Console 安装；外部状态服务处理器和 AIMS outbox 尚未接通，不能视为回流已启用。

### PC17 外部状态回流身份校验（2026-09-08）

- 新增 requireProductFeedbackStatusAuth，复用 Console auth 与 Altoc service guard，同时要求精确状态 scope、aims.runtime、AIMS 源部署与可信 Gateway 的 Altoc 目标部署／同租户绑定。
- 显式拒绝既有通用 guard 所兼容的宽管理员 scope，未修改其他服务入口的行为。
- 受控测试使用真实 Altoc service guard，覆盖正确不同部署、宽 scope、错误 client／tenant／target、缺失 gateway 和用户 token；测试与 lint 通过。此 helper 尚未注册外部 endpoint，JWT provider 为替身。

### PC17 外部状态处理器串联（2026-09-08）

- 新增 handleProductFeedbackStatusService，先校验服务身份，再检查精确六字段、决策／canonical 关系、安全整数 revision 和冻结 hash，调用 Foundation 命令验签后进入 Altoc 内部状态 Runtime。
- 强制 service-client-policy 来源绑定，返回完整标准回执白名单并核对目标 request UUID、revision 与 applied 标记；不接受工单状态或用户 actor 覆盖。
- 两项 VM 处理器测试覆盖顺序、篡改命令、签名失败和错目标回执；hash 为真实实现，签名／Runtime／auth 为替身。Altoc typecheck 和相关 lint 通过。
- 外部路由仍待注册，AIMS 决策 outbox 与状态展示尚未完成。

### PC17 外部状态路由注册（2026-09-08）

- Altoc middleware 对确切 /api/v1/service/product-feedback/status 调用专用状态 handler；handler 内完成 Console 服务身份、签名和回执校验，不进入通用转发。
- 新增实际 middleware 的 VM 路由测试，并联合状态 handler／auth 测试验证；外部契约同步至 MODULE_CONTRACTS。
- AIMS 决策 outbox、状态派发及 UI 展示仍待完成，未在真实租户启用。

### PC17 AIMS 决策回流 outbox 核心（2026-09-08）

- 新增 enqueueFeedbackDecisionTx，仅为正式 Altoc 来源冻结六字段状态命令，按原 request UUID／产品修订构造稳定 operation key；保留原 actor，固定目标／能力／schema，要求可信租户与 AIMS 部署。
- 隔离 MySQL 验证外层事务回滚不留下 operation、提交生成一条正确冻结命令，实际通过。
- helper 尚未插入 decide／merge 事务；需继续接通可信上下文传递、合并链来源追踪和 AIMS 派发器，不能视为决策事件已自动产生。

### PC17 需求决策与回流操作同事务（2026-09-08）

- DecideProductRequest 在需求／工作空间修订更新后、提交前生成正式反馈状态 operation；Runtime 从认证注入 query 传入可信 tenant／deployment，不接受业务 body 覆盖。
- 无正式反馈来源的普通需求不生成 operation；正式反馈缺失可信上下文时整笔决策回滚，不能静默丢失回流。
- 隔离 MySQL 覆盖真实 decide 缺失上下文回滚、正确上下文生成 evaluating 事件，并运行既有决策测试，通过。合并链来源传播、AIMS 派发器与回流展示仍待完成。

### PC17 需求合并链回流事件（2026-09-08）

- MergeProductRequest 与决策一样从 Runtime 接收可信来源上下文，在原事务内生成回流操作；递归追溯合并前驱的正式反馈绑定，保持原 request UUID，更新最终 canonical request。
- 目标需求后续再合并时，原客户反馈继续收到新 canonical 引用；决策处理也能找到合并前驱，原来源状态保持 merged，不冒充未合并需求。
- 隔离 MySQL 实际执行两次连续合并，验证最终事件仍指向第一条反馈身份和第三条 canonical 需求，通过。既有合并测试同时通过。AIMS 状态派发器和回流页面尚待接通。

### PC17 AIMS worker 状态操作校验（2026-09-08）

- AIMS Runtime worker 白名单增加固定 Altoc 状态回流操作，严格六字段、UUID／canonical 决策关系和 JSON 安全整数 revision；仅允许目标 Altoc。
- 成功回执目标固定 product_feedback／原 request UUID，按该 operation 选择短 schema product-feedback-status.v1，保持其他 operation schema 行为。
- Go 测试覆盖正确命令、错误目标、异常 revision 和字段注入，及既有产品文档相关测试通过。BFF executor／签名传输和 UI 状态展示仍待实现。

### PC17 AIMS 状态回流 executor 注册（2026-09-08）

- 新增 productFeedbackStatusOperationExecutor 并登记共享 dispatcher；检查冻结命令 hash、revision／canonical 决策关系、租约和精确 operation 身份，核对 Altoc receipt 的原 request／revision／applied 结果后 source succeed。
- ACK 丢失保留 pending 不补 fail；缺失专用 transport 返回可恢复失败，不误用其他操作通道。
- 状态与既有文档 executor 共 6 项测试通过，AIMS typecheck 与相关 lint 通过。实际签名 transport 尚未接入，回流页面和真实验收继续待完成。

### PC17 AIMS 状态回流签名传输（2026-09-08）

- 新增 productFeedbackStatusTransport，接入请求态／scheduled IO，固定 Altoc 状态 URL、精确 scope、aims.runtime 与冻结 envelope。请求态要求可信 AIMS Gateway 和 Altoc route；scheduled 从 HZY_ALTOC_TARGET_DEPLOYMENT 取得显式目标，不回退源部署。
- transport 测试实际执行 Foundation 签名／验签，覆盖不同部署、错误 token／路径／revision hash、缺失 route／目标的 token 前拒绝；token issuer 与 fetch 仍使用替身。
- 新 transport 测试及文档 transport／状态 executor 相关 5 项测试通过，相关 lint 通过。真实租户部署、状态展示及完整产品中心其他剩余项未完成。

### PC17 已授权反馈查询展示决策数据（2026-09-08）

- Altoc 反馈读取在同一一致快照／当前工单对象权限下读取最新产品决策投影，返回 decisionStatus、canonicalRequestBizId 和 sourceRevision；尚无回流时不伪造评估结果。
- BFF GET 白名单透传三个字段，保留既有派发 status 的独立含义，不泄露 operation 或冻结 command。
- 隔离 MySQL 验证最新合并目标／revision 可读及撤权拒绝；4 项 BFF 测试和相关 lint 通过。弹窗决策展示与真实部署验收仍待完成。

### PC17 产品决策弹窗展示（2026-09-08）

- 反馈弹窗独立显示产品评估状态；未收到回流明确显示“尚未收到产品评估结果”，合并显示最终需求编号，保留原需求编号及派发状态。
- 隔离 Nuxt 实际组件在 Chrome 1440／390 完成首次提交、无评估结果、刷新恢复及 merged 结果展示验证；截图已查看，无页面异常／全局横向溢出，创建与恢复次数均为一次。组件 lint 通过。
- API 使用模拟结果，真实 JWT／跨部署网络／租户安装及完整方案剩余项仍未验收。

### PC17 联合回归与剩余边界核对（2026-09-08）

- 一次联合执行 Altoc 12 项、AIMS 17 项反馈／授权 TS 测试全部通过；Go 三个相关包的 Feedback／RequestDecision／RequestMerge 测试通过，包含隔离 MySQL 场景。
- 反馈契约新增当前实现与剩余边界，明确需求决策回流不等于功能／版本进度回流、原 merged 状态不等于 canonical 评估进展，且尚无自动客户通知。
- PC12 实际部署验收与 PC18 采用／经营结果未完成，整体目标保持进行中。

### PC17 状态 Runtime 成功组合验证（2026-09-08）

- 隔离 MySQL 增加经 Altoc HandleRuntime 的完整内部状态命令，按 server/service_command_context.go 的实际注入约定放入已验证 body context，保留目标 runtime query 绑定。
- 验证已有命令通过路由返回原 receipt／idempotent，新 revision 通过同一路由推进实际投影；测试通过。该上下文仍为受控构造，不冒充已完成公网 JWT／HTTP 验收。

### PC18 数据事实核对与接入契约（2026-09-08）

- 核对 Assets 正式部署关系与 Finance 分摊 schema，新增 Aims-Product-Adoption-Outcome-Contract.md，明确当前采用去重、环境角色、版本冲突／未知、历史证据限制和产品期间归因。
- 明确 Finance 裸成本分摊缺少逐条币种，不可直接跨项目相加；收入归因／readiness 缺失不能伪造产品毛利。
- 已形成后续接口、权限、实现顺序与验收要求，PC18 尚未编码，整体目标继续进行。

### PC18 当前采用聚合核心（2026-09-08）

- Assets 新增按交付资产／环境 pair 聚合的核心函数，多 relation_type 合并为角色集合；deployed/online/accepted 计采用，production 单独标识。
- 实际版本多值保留并标冲突，空版本标未知；planned/provisioning 的版本不混入实际部署版本，输出顺序稳定。
- Go 测试覆盖重复角色、版本冲突、规划版本隔离、未知测试环境和输入顺序无关，通过。
- 输入必须由后续读取器先执行产品／资产／环境授权与有效关系过滤；当前仅聚合函数，尚无 PC18 可用接口或页面。

### PC18 采用摘要独立计数（2026-09-09）

- 新增采用摘要核心，从完整授权关系集合按实例去重后分别统计采用实例、环境、客户、生产实例、版本未知和版本冲突；空客户引用不虚构客户数，规划和暂停部署不计当前采用。
- Go 定向测试通过，覆盖多资产共用环境、同客户多环境、多角色重复、同实例同时存在未知与冲突版本、空集合。摘要必须在分页前执行。
- 当前仍是计算核心，原用户交付资产／环境授权读取、服务接口和页面未完成，不能视为已提供可用采用看板。

### PC18 两类对象范围组合（2026-09-09）

- 新增采用查询范围 helper，复用 Assets scope-unit 解析，将交付资产与环境两个独立资源的当前授权取交集；要求 actor 相同，缺失／拒绝／空 relation scope 在数据库查询前失败。
- 固定字段映射到各自主档责任人／负责人、部门和项目；保留 grant 内 AND、grant 间 OR，不支持的 user/custodian 分支不会退化成更宽的部门查询。
- ProductAdoption 定向 Go 测试通过，包括双资源缺权、actor 不一致、独立全局授权和混合维度约束。当前 helper 尚未注册 API；原用户委托与授权加载、数据读取及页面继续待完成。

### PC18 授权关系读取与实例分页（2026-09-09）

- 新增内部 readProductAdoption：产品精确匹配、交付资产／关系软删除过滤、active 关系及双对象 scope 同一 SQL 执行；一次 SELECT 提供摘要和明细，避免两次读取快照不一致。
- 服务端按完整实例聚合后分页，返回独立采用摘要、实例 total 和查询时间；校验产品／分页参数，超大页码不会整数溢出。
- ProductAdoption 定向 Go 测试通过；新增 SQL mock 验证参数化双 owner 过滤、多角色跨行合并、第二页、超大页和数据库前拒绝。尚未完成真实 MySQL 读取验收、可信委托入口和页面。
- 当前完整授权关系在内存聚合；后续接入前需评估大产品数据量。environment 表没有 deleted_at，使用正式 INNER JOIN 排除缺失环境，不凭空查询不存在的软删除列；生命周期与 effective 时间边界仍需联合样本核验。

### PC18 真实 MySQL 读取验证与有效期（2026-09-09）

- 使用隔离测试 socket 创建临时数据库，从 Assets canonical schema 原样建立环境、交付资产和部署关系三张表，执行实际 readProductAdoption；没有修改真实租户数据。
- 验证双 owner 范围、无权交付资产／环境、资产与关系软删除、精确大小写产品码、全局授权独立计数与第二页、负责人撤销均生效。
- 查询补充 effective_from/to 当前有效区间，真实数据库验证未来生效、过去到期和 ended 状态不参与结果；多角色删除后冲突版本计数随之消除。联合 ProductAdoption Go 测试通过。
- 可信原用户委托、Console scoped 授权加载、外部 service API 与采用页面仍未实现；真实隔离数据库测试不等于真实租户链路验收。

### PC18 签名读取命令字段契约（2026-09-09）

- 确认复用 Foundation 现有产品文档只读签名命令机制，固定采用 operation/schema/capability，新增五字段严格解析器；拒绝 actor 控制字符、错误 action、权限字段注入、非整数和越界分页。
- ProductAdoption 定向 Go 测试通过。当前仅命令字段验证，不冒充签名认证；目标验签、用户委托、当前 scoped 授权及 Runtime 路由仍待接通。

### PC18 服务身份与部署绑定（2026-09-09）

- 新增 Assets 采用服务身份 helper，调用 Foundation Console authentication 和可信 Gateway helper；要求精确 assets:product-adoption:read、固定 AIMS 签名协议来源 aims.runtime、同租户及独立 Assets 目标部署。
- 5 项相关 TS 测试及新增文件 lint 通过。测试复用真实 Assets service scope guard，覆盖宽 scope、来源／客户端／租户／目标错误、缺 Gateway、用户身份、失效身份和 introspection 503；Console JWT provider 与 Gateway 为替身，未执行真实 Token 验证。
- helper 尚未注册外部入口；manifest/grants、命令验签与当前用户 scoped 授权、Runtime 及页面继续待实现。

### PC18 采用服务能力与授权产物（2026-09-09）

- Assets manifest 声明 product-adoption:read，仅用于服务调用，不加入用户推荐角色；生成器增加 AIMS→Assets 和 Assets→data-runtime/tenant-runtime 三项精确授权。
- 8 项产品服务授权契约测试通过，隔离 MySQL 实际验证 seed/verify、重复安装、错误客户端、失效授权和过期凭据 guard。当前共 207 项要求，其中 193 项安装授权、14 项既有 transport 前提。
- 未安装到真实 Console，尚未开放采用查询路由；授权配置产物不代表功能已启用。命令验签、当前用户 scoped 授权、Runtime 与页面继续待接通。

### PC17／PC18 原用户 scoped 授权身份缺口修正（2026-09-09）

- 检查 Foundation loadScopedAuthorizationFromConsoleRuntime 与 Console scoped-authorization 路由发现：函数 uid 参数不会选择查询主体，当前接口按已认证会话 UID 加载权限。因此不能用该函数直接宣称已完成 service-only 原用户委托。
- PC17 feedback authorization 新增返回 snapshot.uid/appCode 精确匹配，阻止将另一会话的 grants 与冻结原用户的产品事实组合；新增错用户、缺用户、错应用回归通过。
- 原有 PC17 的 VM 测试仅证明 evaluator 和调用参数，不能证明真正的委托主体加载。PC17 和 PC18 都还需要 Console/Foundation 专用、受信且固定用途的原用户 scoped 授权通道；这项是上线前必需工作，不能由 service grant 或对象事实检查替代。

### Console 固定用途 scoped 授权请求契约（2026-09-09）

- 新增独立 subjectScopedAuthorizationContract，复用既有用户 UID／purpose 输入校验；固定 AIMS product_feedback_create→product_requests:create、Assets product_adoption_deliveries→deliveries:view、product_adoption_environments→environments:view。
- 要求完整服务主体与 Console 绑定的 tenant/deployment，禁止请求覆盖资源、动作、租户或模拟角色；两项契约测试覆盖三个固定用途、跨应用用途复用、错误身份与字段注入，通过。
- 当前仅请求契约，尚未开放 Console endpoint；后续必须加载 active Directory 用户、fresh merged scoped grants，禁用模拟并由 Foundation 专用服务调用消费。不是完成委托权限查询的声明。

### Console 原用户 scoped 权限加载（2026-09-09）

- 新增 loadSubjectScopedAuthorization，按固定用途请求的 subjectUid 查询 Directory active 状态，复用 fresh-policy 与 loadPolicyScopedAuthorization；强制 merged、禁用角色／用户／特权模拟，忽略模拟会话并绕过 snapshot cache。
- 返回前核对 snapshot 用户、应用和 merged 模式；只返回用途、范围 grants、actionPolicy 与策略版本，不返回角色列表。用户停用／不存在拒绝，Directory／policy 不可用保持 503，dev bypass 不作为有效授权。
- 三项契约／加载测试通过，新增文件 lint 和 Console typecheck 通过；测试中 Directory、fresh-policy transport 与 policy loader 为替身，仅证明组合边界与调用参数。Console 服务路由、专用能力及 Foundation 消费仍待接通。

### Console 原用户范围授权入口（2026-09-09）

- 注册 POST /api/v1/console/service/authorization/subject-scoped，Console manifest 声明服务专用 subject-authorization:read。先 requireConsoleServiceActor 精确能力和目标 app，再解析固定用途与 tenant/deployment，最后加载原用户授权；拒绝 query 和客户端权限覆盖。
- 四项相关 TS 测试通过，包括未授权不读 body、不加载 policy、错误 purpose 和权限字段注入。新增入口 lint 通过；JWT verifier 在路由测试中为替身，不能替代真实 Token 验收。
- 调用方精确 grants、Foundation 服务客户端、PC17／PC18 消费及真实租户链路尚未完成。

### Console 原用户授权调用方 grants（2026-09-09）

- 产品中心 grant 生成器检查 Console manifest 的 subject-authorization:read 声明，为精确 aims.runtime 和 assets.runtime 准备 aud=console 对应授权；不授予用户推荐角色。
- 9 项产品授权契约测试和隔离 MySQL seed/verify 通过，包含重复安装、失效客户端与过期凭据 guard。现为 209 项要求：195 项安装授权、14 项既有 transport 前提。
- 未向真实租户安装。Foundation 专用客户端及 PC17／PC18 消费仍待实现；已确认可复用 fetchConsoleServiceJson 的 Cloudflare Service Binding 路径，避免公网自等待。

### Foundation 委托授权客户端与 PC17 接入（2026-09-09）

- 新增 loadSubjectScopedAuthorizationByService，复用 requestWithServiceAccessToken、trustedServiceRequestHeaders 和 fetchConsoleServiceJson，精确 Console scope；请求仅 subjectUid/purpose，返回核对用户、应用、用途、资源／动作、merged 模式、策略修订和 grants 资源。
- AIMS productFeedbackAuthorization 已从会话 scoped helper 切换到专用服务客户端，保留原用户 snapshot 身份核对及当前产品对象权限评估。
- Foundation 客户端受控测试及两项 AIMS 授权测试通过，相关 lint 和 AIMS typecheck 通过。Console transport/token provider 为替身，实际跨部署绑定和真实用户授权仍需租户联调；Assets 采用查询尚未消费该客户端。

### 原用户部门范围数据（2026-09-09）

- Console 在 Assets 委托授权中按原 subjectUid 查询 Directory 当前有效部门关系，只返回 orgType=department 且 relationType=member 的去重 departmentCodes；委员会和观察员关系不作为本人部门。目录查询失败返回 503，不退回服务客户端部门。
- Foundation 响应契约增加并校验 departmentCodes。Console 与 Foundation 定向测试通过，覆盖部门去重、非部门／非成员排除和目录故障；测试 transpile target 修正为 ES2022，避免旧默认 target 错误降级 Set 展开。
- Assets scope 消费及采用接口仍未接通；此改动仅补齐被委托用户的部门事实来源。

### Assets 采用双资源委托授权消费（2026-09-09）

- 新增 resolveProductAdoptionAuthorization，分别调用 Console 固定用途 deliveries/view 与 environments/view，复用既有 Assets grant-unit 转换，按 snapshot.departmentCodes 计算本人部门；两类任一缺权即拒绝。
- 使用真实 Assets scope core 的受控测试通过，验证不消费 service consoleAuth 中另一部门、分别拒绝两类资源缺权；新增文件 lint 通过。
- 调用方仍须验签原用户并提供当前租户 Directory 部门树，helper 尚未接到采用服务 handler／Runtime，不能视为页面可用。

### 采用授权部门树来源接通（2026-09-09）

- Console Assets 委托授权从当前租户 Directory active flat 投影生成 departmentTree，展开部门后代，检测重复／循环关系；不引入进程级缓存。Foundation 校验该字段，Assets scope helper 直接消费返回树，不再接受调用方提供的树参数。
- Console 两项、Foundation 一项、Assets 一项定向测试通过，覆盖部门后代、非部门排除、循环拒绝和原用户部门范围。相关新增／修改文件 lint 通过。
- 采用服务验签 handler、Runtime 路由及页面仍待实现，真实租户授权链路尚未验证。

### Assets 采用 Runtime 路由（2026-09-09）

- 注册 POST /v1/assets/internal/product-adoption:read，精确 capability、共享签名 command context/hash/schema 校验、AIMS 源身份及 Assets 自身 Runtime tenant/deployment 绑定；要求 service-command 委托 actor 与命令 actor 一致。
- 消费 Assets BFF 生成的短时 productAdoptionAuthorization 双对象范围，要求有效期及 actor 一致后调用现有读取器；只读操作不写 receipt/outbox。
- ProductAdoption 定向 Go 测试通过，新增 Runtime 测试覆盖宽 scope、缺签名、GET 与无关路由；完整签名成功路由尚需组合测试，不能用拒绝测试证明成功链路。
- 外部 Assets handler、AIMS 调用与页面仍未接入。

### 采用 Runtime 成功路径与委托拒绝回归（2026-09-09）

- 隔离 MySQL canonical 三表测试增加真实 Adapter.HandleRuntime 调用，提供标准冻结 hash、受控已验签上下文、service-command actor 与短时双 owner 范围，返回一条授权实例和版本冲突结果，实际通过。
- 新增错误用户、runtime 来源、租户、目标部署、委托标记／purpose，以及过期和超长授权有效期的数据库前拒绝测试。联合 ProductAdoption Go 测试通过。
- 受控 context 不是真实 JWT／公网验签，外部 Assets handler、AIMS transport 与采用页面仍待完成。

### Assets 采用服务处理器串联（2026-09-09）

- 新增 handleProductAdoptionService，按服务身份、严格五字段/hash、Foundation 签名、Console 原用户双资源 scope、Assets 自身 Runtime 顺序读取；外部请求不能携带自造授权快照。
- 使用 serviceCommandActor 和 service-client-policy，正确解包 maybeCallTenantRuntime 的 handled/data envelope；校验目标产品、分页与明细数，返回业务字段。
- 受控处理器测试通过，覆盖认证／验签／对象授权拒绝、授权字段注入和错误目标响应；修正测试替身为实际 Runtime envelope 形状。Assets typecheck 通过。签名/hash/Console/Runtime provider 在本测试为替身，真实密码学链路仍需验证。
- 此处理器尚未注册外部路由；AIMS 调用与页面待完成。

### Assets 采用外部路由注册（2026-09-09）

- Assets middleware 对确切 /api/v1/service/product-adoption/read 交给专用 handler，在通用 proxy 前完成认证／签名／原用户授权；专用处理失败不回退其他通道。
- 四项采用相关 TS 测试通过，覆盖实际 middleware 专用分发与拒绝不回退；相关 lint 通过。跨模块契约已同步路由现状。
- AIMS 签名调用、采用页面、响应 DTO 完整校验及真实 JWT／跨部署链路仍需完成。

### AIMS 产品采用签名调用（2026-09-09）

- 新增 readProductAdoptionFromAssets：参数校验及当前 products:view 之后，使用授权事实 actor、可信 AIMS Gateway 与 Assets route 构造五字段命令，精确 Assets scope，Foundation 签名和目标三项网关 header 改写；只读请求生成独立 UUID，不写 operation。
- 受控 transport 测试通过，覆盖权限／缺路由在 Token 前拒绝、源目标不同部署、正确用户和错误产品响应；签名与 Token provider 为替身。相关 lint、AIMS typecheck 通过，修正 Nuxt 动态外部 $fetch 的泛型推断。
- 当前 helper 尚未接入用户侧 API；页面、DTO 完整校验和真实服务链路仍待完成。

### AIMS 用户侧采用查询 API（2026-09-09）

- 在现有产品 roadmaps catch-all 注册 adoption，GET /api/v1/products/{productCode}/roadmaps/adoption 调用已实现的产品权限与 Assets 签名读取；只接受 page/pageSize，禁止客户端 actor 或其他字段覆盖，响应 no-store。
- 复用产品分页输入规则（用户 API pageSize≤100，服务内部≤200）；两项 API／transport 定向测试通过，覆盖非 GET、产品路径注入、无效页码及 actor 注入；相关 lint 通过。
- 采用页面、业务响应 DTO 完整校验、真实浏览器／跨部署验收仍待完成。

### 采用响应 DTO 与一致性校验（2026-09-09）

- 新增页面可复用的 ProductAdoptionPage／Instance／Summary 类型和 AIMS 边界解析器，校验查询时间、分页、计数上限、唯一实例、角色／状态枚举、实际版本集合及 unknown/conflict/adopted 标记关系；返回显式字段，去除未声明内部数据。
- AIMS Assets transport 已消费该解析器，四项采用相关测试通过，包含重复实例、矛盾计数、虚假版本冲突、无效时间和内部字段剔除。相关 lint 与 AIMS typecheck 通过。
- 采用页面、真实浏览器与跨部署服务验收仍待完成，经营结果和整体方案其他剩余项保持未完成。

### 产品采用页面与浏览器验证（2026-09-09）

- 新增 /products/{productCode}/adoption，并在产品首页增加入口。页面展示六项采用摘要、当前查询时间、角色／部署状态／实际版本、未知与冲突标记，分页读取用户 API，区分采用数与全部有效关联实例数。
- 使用当前产品／页码与 success 状态约束展示，查询错误隐藏旧摘要和明细；提供加载、错误提示、刷新和空状态，手机表格局部横向滚动。
- AIMS typecheck、相关页面 lint 通过。隔离 Nuxt 导入实际页面，在 Chrome 1440/390 验证加载、翻至第二页和刷新撤权后旧数据消失；无 pageerror／全局横向溢出，两张截图已查看。
- 浏览器 API 使用模拟数据，截图在 /tmp/hzy-product-browser-qa/adoption-{1440,390}.png；真实租户授权／跨部署调用与经营结果仍未验收，整体目标继续进行。

### 采用调用 Service Binding 接入（2026-09-09）

- AIMS→Assets 采用 transport 改为 Foundation serviceAppFetch，复用匹配应用的 Cloudflare binding、目标上下文改写和错误处理，保留原签名参数；移除直接 $fetch 主路径。
- 采用 transport 测试及 Foundation 15 项 appServiceBinding 测试通过，覆盖匹配 binding、路径前缀、三项目标上下文与失败响应；相关 lint 和 AIMS typecheck 通过。
- 未执行真实 Worker 部署／租户 Token 探测，不能视为托管云已启用。经营结果、进度回流和完整方案验收仍待完成。

### Finance 产品成本精确分摊核心（2026-09-09）

- 核对 Finance canonical schema，项目汇总与 allocation 均缺逐金额币种，不能直接合计为已就绪产品成本。
- 新增单项目／月度完整规则修订的计算核心，整数基点限制合计不超过 100%，拒绝重复产品与无依据修订；使用大整数处理 DECIMAL(18,2)，分别返回产品成本、未分配比例及金额、舍入差额，不默认币种或换汇。
- 三项定向 Go 测试通过，覆盖 100% 上限、重复／无效规则、一分钱分摊、完整及空规则、最大金额无溢出和输入不被排序修改。
- 当前为未接入服务的计算核心，不代表经营结果已可用。规则持久化与并发控制、来源币种／readiness、反转处理、授权接口及页面仍待实现。

### Finance 产品成本规则事务存储（2026-09-09）

- 新增 Finance canonical DDL 和独立增量迁移：项目／月份 head 行及不可变规则 revision，保存完整比例、依据、原用户及时间。
- 新增事务内替换和读取 helper：首次创建也经过数据库行锁；expectedRevision 冲突不写新修订，历史保留；读取单次 join 校验完整规则和存储比例一致。helper 尚未注册外部入口，不自行承诺用户授权或提交 receipt。
- 隔离 MySQL 与计算核心联合测试通过，实测两个并发首写仅一个成功、回滚不泄漏、旧修订冲突、超额拒绝、历史保留、精确业务键及未配置期间。迁移重复执行通过，未触碰真实租户库。
- 下一步仍需接入授权服务与可靠 receipt、补齐成本来源币种／readiness，并实现经营结果页面；整体方案未完成。

### 人力成本同步保留币种来源证据（2026-09-09）

- 核对 People standardCostRateSummary 实际返回 currency，Finance 参数返回 currency_code；既有 Finance 人力同步此前没有把两种币种保留进来源快照。
- 同步命令的员工和 allocation 来源现分别保留 People standardRateCurrencyCode 与 Finance 参数 currencyCode；缺失、非法或小写值为 null，不默认 CNY，也不把单个来源币种声称为整个合成成本的币种。
- Finance 相关 9 项测试及 lint 通过，类型检查通过；核对 People 字段后定向测试和 lint 再通过。覆盖来源币种不同、缺失、非法值及两份快照一致。
- 仅新同步可补入证据，未重写历史成本。产品成本读取仍须核对来源币种一致、ready、当前 allocation 状态及来源修订；本次尚未接入产品经营服务或修改项目核算 readiness 口径。

### 产品成本来源币种校验（2026-09-09）

- Finance Runtime 增加 managed labor 来源校验器：要求 active、有效精确金额和期间、固定来源及规则，快照项目／月份／员工匹配，成本参数与职级规则引用完整，两个来源币种明确且一致。
- reversed、历史币种缺失、混币种、错误主体和暂未支持的资产／其他成本来源分别返回原因，不推断默认币种。校验器不宣称项目成本完整或收入／毛利已就绪。
- ProductCost 定向 Go 测试通过，包含来源证据拒绝矩阵。此 helper 尚未接入经营服务；完整来源读取、项目 readiness、授权接口与页面继续待完成。

### 产品成本同快照读取（2026-09-09）

- 新增 Finance 内部读取器，在只读 Repeatable Read 事务内读取完整归因规则修订、项目摘要 readiness／输入 hash／检查时间，以及当期 active allocation 来源。项目使用精确大小写匹配，反转记录在 SQL 中排除。
- 缺规则、缺摘要和 NULL 金额保留缺失，不推断零成本或 ready；任一读取失败不提交事务。原始来源含薪资信息，仅为内部事实结构，不得直接返回用户 API。
- ProductCost 定向 Go 测试通过，覆盖缺失证据、下游读取失败回滚、规则修订与来源快照保留，并调用实际币种校验器验证读取后的证据。SQL provider 为替身，尚未完成真实数据库快照隔离验收。
- 当前读取器未开放服务路由，调用方仍需先校验项目授权；经营结果聚合、直接支出及其他成本币种、服务与页面继续待完成。

### 产品成本读取器真实 MySQL 验证（2026-09-09）

- 扩展既有隔离 MySQL 用例，直接加载 Finance canonical 项目摘要及 allocation DDL，写入真实 JSON 来源和 NULL DECIMAL 后调用实际读取器与币种校验器。
- 联合测试通过：来源 JSON 经 MySQL driver 后仍可验证币种；NULL 支出不变为零；反转后新读取排除该 allocation；项目编码大小写不同不泄漏摘要。既有规则并发、回滚和迁移测试继续通过。
- 本次证据覆盖真实存储及读取行为，不覆盖读取期间并发修改的快照一致性，也不替代用户授权或真实租户跨应用验收。经营聚合、接口与页面仍待完成。

### 产品项目成本聚合核心（2026-09-09）

- 新增项目期间聚合：检查规则、摘要 ready、来源输入 hash、检查时间及金额完整性，核对人力／其他 allocation 数值与摘要，按已验证币种分别汇总并调用精确比例分摊；不生成跨币种总金额或收入／毛利。
- 缺币种、重复明细、反转后摘要未更新、范围错配及尚未解析币种的非零直接支出均返回原因并清空分摊结果，避免将部分已验证成本呈现为完整结果。原始薪资快照不进入结果结构。
- Product 定向 Go 测试通过，覆盖 CNY/USD 分列、比例分摊及未就绪拒绝矩阵。当前完整就绪路径仅覆盖有明确币种的人力成本且无其他支出的项目；其他成本来源、授权接口和页面仍待接入，PC18 未完成。

### 产品直接支出读取口径（2026-09-09）

- 核对 Finance 项目重算和人力同步重算：直接支出使用 expense_amount，不额外计 fee_amount；按 expense_date 所属月取未删除、非 canceled 行，其中包括 draft／pending_payment，不能标为实际已付成本。
- 新增事务内直接支出读取 helper，沿用该口径，以月初闭区间至下月初开区间读取精确项目，保留支出编码、状态和自身币种；缺失币种不默认 CNY。
- Product 定向 Go 测试通过，包括跨年月份边界、非法月份、缺币种与 draft 事实保留。helper 尚未合入统一快照与聚合，当前非零直接支出的未就绪保护保持生效；后续须展示清晰的台账口径。

### 直接支出合入快照与聚合（2026-09-09）

- 统一只读事务现在读取直接支出；聚合校验支出标识、重复、项目期间、状态、金额及币种，按币种与其他已验证成本合并，核对直接支出合计与摘要后分摊。缺币种或摘要不符仍不输出部分结果。
- 隔离 MySQL 使用完整 canonical 支出表及依赖表通过联合测试，验证 draft 被保留，canceled、软删除和下月支出排除；真实读取返回 USD 原币种。计算测试验证 CNY 直接支出与人力成本合计后按规则分摊，以及缺币种拒绝。
- 资产／共享费用等 allocation 来源仍待解析，服务权限、可靠规则写入入口和经营页面仍待完成。已付现金口径与本次非取消支出台账口径不同，页面必须明确说明。

### 成本结果来源修订与资产来源核对（2026-09-09）

- Assets serviceProjectCostSummary 当前 currency 写死 CNY，采购／订阅／环境金额未按请求月份筛选；不能用该响应证明产品期间成本，资产来源暂保留 unsupported 未就绪，后续须完善实际来源接口。
- 产品成本结果新增 SourceRevision，基于规则、摘要、直接支出和 allocation 来源生成版本化 SHA-256 内容摘要；不再仅依赖人力 input hash 判断更正。排序及 JSON 格式归一化保留数字精度，避免展示顺序导致修订漂移。
- Product 定向 Go 测试通过，验证金额更正、反转、支出变化、规则修订都会改变来源摘要，纯排序／JSON 排版变化不改变；非法 JSON 拒绝。该摘要不是授权凭据或时间序列，服务与历史结果留存仍待实现。

### 单产品经营结果返回投影（2026-09-09）

- 新增带明确 JSON 字段的单产品／项目／期间结果投影，完整项目规则计算后仅返回请求产品的比例和分币种金额；未归因不重新归一化，未就绪不暴露部分金额。
- 返回规则修订、来源摘要、成本台账口径，以及独立的收入未配置状态；不返回其他产品份额、员工标识、薪资来源快照或未分配的项目金额。
- Product 定向测试通过，覆盖 50% 份额、不相关产品剔除、未归因、错误项目及未就绪。投影不替代授权，服务入口仍须同时验证产品和项目权限；接口与页面尚未注册。

### Finance 原用户经营读取授权用途（2026-09-09）

- 核对 Finance 现有 project_accounting grant 转换保留项目范围交集和多 grant 合并；后续专用读取将复用该转换，不能直接调用以服务会话为主体的旧 helper。
- Console subject-scoped 新增仅 Finance 可调用的 product_cost_read，固定 project_accounting:view，不开放通用资源、动作或写入用途。
- 两项契约测试和相关 lint 通过，包含 Finance 正确用途、其他应用错用途及未注册写用途拒绝。Finance 专用消费者、客户端 grant 和经营服务注册仍待完成。

### Finance 原用户授权消费者（2026-09-09）

- 提取并复用既有 project_accounting 范围转换，普通会话入口行为保持原逻辑；产品成本消费者改用 Console 专用 subject-scoped 服务，核对原 UID／Finance／merged，无授权返回 403。
- 使用真实 Finance 范围转换和 Foundation 动作判断的受控测试通过，验证 grant 内项目交集、grant 间并集、原用户不取服务会话及缺权拒绝；另三项既有范围回归通过。实现 lint、Finance typecheck 通过，测试 lint 修正后通过。
- Console/token 为测试替身，消费者尚未接到验签后的经营服务入口；客户端 grant、真实跨应用授权和页面仍待完成。

### 产品成本读取命令解析（2026-09-09）

- 冻结五字段读取命令与 operation/schema/capability 常量，严格限制 actor、产品、项目、月份及 action；拒绝服务主体、缺字段、额外 scope／币种及路径控制字符。
- Product 定向 Go 测试通过，含命令有效路径和注入／无效主体／期间拒绝。尚未注册 Runtime 或 BFF 路由，不把解析校验当作验签或授权。

### Finance Runtime 产品成本路由（2026-09-09）

- Finance mutation dispatcher 注册只读 POST /v1/finance/internal/product-cost:read，校验精确能力、共享 command 签名上下文／schema、AIMS 服务来源、Finance 自身租户部署及 service-command 原 actor，消费 Finance BFF 生成的短时授权后读取并返回单产品投影。
- 复用项目范围检查前显式拒绝空 access，避免既有 helper 的兼容空范围语义放行。读取不写 receipt 或业务数据。
- Product Go 测试通过，新增 dispatcher 测试验证宽能力、无签名和 GET 在数据库前拒绝。成功签名组合路径尚未验证；BFF、manifest/grants、真实 JWT 及页面仍待接通。

### Finance Runtime 成功读取组合验证（2026-09-09）

- 隔离 MySQL 用标准 command hash 和受控已验签上下文调用实际 Finance dispatcher：缺规则返回未就绪；保存完整规则、补齐直接支出摘要后返回 ready，P1 的 50% 份额分别为 CNY 50.00、USD 10.00。
- 增加用户／租户／部署／runtime 来源／委托标记、空及无权项目范围、过期／超长授权数据库前拒绝测试。Product 与隔离 MySQL 联合测试通过。
- 受控签名上下文不是真实密码学 JWT 验证；外部 BFF、grants 和 AIMS 页面仍待接入，整体方案未完成。

### 产品成本精确服务授权安装产物（2026-09-09）

- Finance manifest 新增服务专用 product-cost:read，无用户角色授予；grant 生成器加入 AIMS→Finance、Finance→双 Runtime 精确能力、Finance→Console subject-authorization，以及只验证不安装的 Finance 双 Runtime read transport 前提。
- 安装 guard 扩为五个精确 runtime 客户端，Finance 当前凭据无效时整个安装不写 grant；生成 seed/verify 当前 215 项要求，其中 199 安装授权、16 transport 前提。
- 9 项 grant 契约测试及隔离 MySQL 安装／重复安装／过期凭据／Finance 停用 guard 测试通过。未安装真实租户，BFF 与页面继续待接入。

### Finance 产品成本服务身份边界（2026-09-09）

- 新增专用 BFF 身份 helper，复用 Finance 精确 capability 和 introspection 故障分类；固定 aims.runtime、AIMS 源应用及可信 Finance Gateway 同租户／源目标部署，返回后续验签所需绑定。
- 使用实际 Finance capability guard 的受控矩阵测试通过，覆盖正确调用、宽 scope、错来源／客户端／租户／目标、缺 Gateway、用户令牌、过期及 introspection 故障；lint 与 Finance typecheck 通过。
- Console/Gateway provider 为替身，helper 尚未接入外部服务处理器，真实 Token、BFF 路由及页面未验收。

### Finance 产品成本 BFF 处理器（2026-09-09）

- 新增完整处理器，身份→严格五字段/hash→Foundation 签名→原用户 Console 项目范围→Finance Runtime 顺序调用；不接受外部自带授权快照，内部授权有效期 15 秒。
- 校验返回产品／项目／期间、ready／原因、修订、比例与分币种精确金额，以及台账／收入状态；只返回明确字段，剔除额外内部数据。
- 受控组合测试通过，覆盖身份／签名／权限拒绝、授权注入和错产品响应；lint 与 Finance typecheck 通过。签名、Console 和 Runtime provider 为替身，处理器尚未注册外部路由，真实服务及页面仍待接通。

### Finance 产品成本外部路由注册（2026-09-09）

- Finance middleware 注册 /api/v1/finance/service/product-cost/read，专用 handler 在通用转发前接管，请求拒绝不回退；跨模块与 PC18 契约同步。
- Finance 9 项产品成本／服务认证／runtime registry 相关测试及修改文件 lint 通过，包含实际 middleware 专用分发和拒绝不回退。真实租户 JWT、AIMS transport、经营页面及规则写入服务仍待完成。

### AIMS 产品成本签名调用与响应校验（2026-09-09）

- 新增 AIMS→Finance Service Binding 调用：先验证当前产品查看权限及项目／期间参数，再以原 actor 和可信源目标部署生成签名五字段只读命令，获取精确产品成本 capability。
- 新增白名单响应解析器，校验产品／项目／期间、就绪／原因、比例、修订及分币种精确金额，剔除内部字段，不接受数字金额或重复币种。
- 两项 AIMS 响应／transport 定向测试、lint 与实现 typecheck 通过；transport provider 为替身。用户 API、页面与真实跨部署验收仍待完成。

### AIMS 用户侧产品成本 API（2026-09-09）

- 产品 roadmaps catch-all 注册 GET /api/v1/products/{productCode}/roadmaps/cost，仅接受 projectCode／periodMonth，返回 no-store；调用已实现的产品权限与 Finance 签名读取，不接受客户端 actor 覆盖。
- 三项产品成本响应／transport／用户 API 测试及修改文件 lint 通过，覆盖非 GET、路径注入、非法期间和额外 actor。页面及真实租户调用仍待验收，规则写入和资产成本来源仍未完成。

### 经营页面类型与状态文案（2026-09-09）

- 增加前后端共用 ProductCostResult 类型及中文未就绪原因映射，未知原因使用统一说明，不直接暴露内部错误码；明确展示成本台账与实际已付的区别及币种分列口径。
- 核对现有 HandoffProjectPicker 只列关联产品的 active product_dev 项目，不适用于历史期间及多产品分摊的项目选择，经营页不能直接复用其筛选限制。后续使用既有授权项目列表能力选择项目，再由 Finance 重验财务权限。
- 修改文件 lint 通过，页面尚未生成和浏览器验收，整体方案保持未完成。

### 产品经营页面与项目选择器（2026-09-09）

- 新增 /products/{productCode}/cost 与授权项目搜索分页选择器，不强加 active/product_dev/product_code 筛选；按选择项目和月份请求经营 API，展示当前产品比例、分币种成本、未就绪原因、收入状态及可展开来源修订。
- 查询开始及切换选择清除旧结果，使用请求 generation 丢弃过时响应；错误不保留旧金额。明确区分非取消支出台账和实际已付款。
- 页面与组件 lint、AIMS typecheck 通过。尚未增加产品首页入口，等待 1440/390 浏览器验证；真实租户查询、规则写入与资产成本来源保持未完成。

### 经营页浏览器验证与入口（2026-09-09）

- 实际 Chrome 在隔离 Nuxt 使用仓库真实页面与组件，1440/390 验证历史项目选择、期间查询、CNY/USD 分列、未就绪原因以及 403 后旧结果清除；无 pageerror 或全局横向溢出。两张截图已查看，位于 /tmp/hzy-product-browser-qa/cost-{1440,390}.png。
- 产品首页增加“经营结果”入口，相关 lint 通过；隔离预览进程已停止。本轮 API 为模拟数据，不替代真实权限或跨部署验收。
- 仍需规则写入服务／页面、资产等成本来源、收入归因及整体真实租户验收，PC18 和产品中心整体未完成。

### 完整分摊规则写入命令（2026-09-09）

- 新增严格六字段规则解析：原 actor、项目、月份、expectedRevision、依据和完整 shares；份额仅产品与整数基点，复用既有 100% 上限／重复检查并生成下一修订。
- 明确空数组为移除全部分配，null 不表示清空；拒绝额外金额／scope、服务 actor、非整数或字符串修订。Product 定向 Go 测试通过。
- 尚未注册写入路由。边界须验证整个项目的规则编辑权限并与幂等 receipt 同事务，不能用单产品查看权限替代；编辑页、资产来源及真实验收仍待完成。

### 规则写入共享 receipt 事务处理器（2026-09-09）

- 新增 ReceiptHandler，解析仓库交付的精确命令 JSON，核对授权 actor／项目／月份后在 receipt 事务内替换规则修订，返回稳定业务标识和精简结果；不自行提交事务，不暴露完整分摊份额。
- Product 定向 Go 测试通过，覆盖授权上下文三项错配和非法 JSON 在存储前拒绝。仅处理器已实现，尚未连接 ReceiptRepository.Execute 或公开路由，不能据此宣称幂等重放已验收；上层仍须在每次请求含重放时验证当前编辑权限。

### 规则写入 receipt 与数据库组合验证（2026-09-09）

- 隔离 MySQL 加载 Finance canonical receipt 迁移，将规则 handler 交给实际 ReceiptRepository.Execute：首写成功、同身份重试复用 receipt 且只留一个规则修订；新身份携带过期 expectedRevision 时规则冲突，receipt 同事务回滚不残留。
- 测试修正命令 hash 为规范化对象计算，与实际 ReceiptCommandFromBody 保持一致；联合隔离 MySQL 测试通过。写入 schema 采用 product-cost-rules.v1，避免超出 Finance receipt 的 VARCHAR(30)；operation 可独立保持完整业务名。
- 此为 repository 组合验证，公开写入路由、当前编辑权限及源端可靠命令仍未接入，整体方案未完成。

### 分摊规则编辑原用户授权（2026-09-09）

- Console 新增仅 Finance 可调用的 product_cost_rules_edit，固定 project_accounting:edit；Finance 消费者新增编辑入口，复用当前原用户范围转换，不让 view 权限满足 edit。
- Console 两项用途契约测试、Finance 授权矩阵及相关 lint 通过；实际范围转换验证 edit 保留项目交集／并集、只有 view 时编辑拒绝。未新增用户角色授予。
- 公开写入服务、AIMS 源端可靠命令和编辑页尚待完成，当前用途与消费者不等同于写入端到端启用。

### 规则写入 Runtime 入口（2026-09-09）

- 注册内部 product-cost:replace-rules，独立 replace-rules capability／operation 与短 schema；验证 AIMS 来源、租户部署、actor、编辑 purpose/action 及当前项目范围后调用共享 ReceiptRepository，规则冲突返回 409。
- 每次调用在 receipt lookup 前检查授权，重放不能绕过当前权限；返回共享 receipt 精确证据。Product Go 测试通过，验证读取能力、读取 purpose/action、其他项目和空范围在数据库前拒绝。
- 此路由尚无外部 BFF 和写入 grants，成功路由组合及真实 JWT 仍待验证；源端可靠命令、规则编辑页仍未完成。

### 规则写入 Runtime 成功与撤权重放验证（2026-09-09）

- 隔离 MySQL 使用实际 dispatcher、共享 receipt 与规则存储，受控可信命令首次写入返回 succeeded，重复请求复用同 receipt 且 idempotent=true，项目历史仅一条修订。
- 同一已成功命令撤销当前项目 access 后再重放被拒绝，旧成功收据不能绕过授权。Product 与隔离 MySQL 联合测试通过。
- 本轮签名上下文为受控注入，不是完整 JWT 联调。BFF、写入 grants、源端可靠命令与编辑页继续待完成。

### 分摊规则 BFF 独立写能力（2026-09-09）

- Finance 产品成本身份 helper 复用固定来源／Gateway 校验，新增仅要求 finance:product-cost:replace-rules 的写入入口；读取入口仍精确要求 read，不互相替代。
- 受控身份测试增加写能力成功和只读令牌写入拒绝，测试与相关 lint 通过。完整写 BFF 处理器、grants 和规则编辑页继续待完成。

### 规则写入 BFF 输入校验（2026-09-09）

- 新增 TypeScript 六字段完整规则解析，校验 actor／项目／期间、可安全递增的整数修订、UTF-8 字节长度依据及产品基点集合，保留提交顺序以匹配签名原文；拒绝重复、超额及额外金额／scope。
- 定向测试与 lint 通过，包括空集合明确清空、null 拒绝、中文依据字节上限和最大安全修订拒绝。尚未接到完整签名写处理器，端到端写入保持未完成。

### 分摊规则签名写入 BFF 处理器（2026-09-09）

- 新增独立写处理器，精确写能力、六字段规则/hash、短 schema、Foundation 签名、Console 原用户 edit 范围后调用 Runtime，内部授权固定编辑 action/purpose 且短时有效。
- 校验 receipt 命令身份、目标修订、状态和返回结果，显式返回精简收据；不接受外部自带授权。受控组合测试及 lint 通过，覆盖身份／签名／权限／授权注入／错误结果；真实签名 provider 与公开路由仍待接通。

### Finance 规则写入公开服务路由（2026-09-09）

- middleware 注册 /api/v1/finance/service/product-cost/replace-rules，独立写 handler 在通用代理前接管；读取路由继续走只读 handler。
- 三项读／写分发及写处理器受控测试、修改文件 lint 通过，拒绝时不回退通用 proxy。写入 grants、AIMS 源端 reliable operation、编辑页与真实 Token 验收仍待完成。

### 分摊规则写入授权安装产物（2026-09-09）

- Finance manifest 增加独立 replace-rules action，不授予推荐用户角色；安装矩阵增加 AIMS→Finance 与 Finance 双 Runtime 精确写能力，Finance 通用 write 只列为既有 transport 验证前提。
- 生成矩阵现为 220 项要求（202 安装、18 前提）。10 项 grant 契约测试和隔离 MySQL 重复安装／凭据 guard 验证通过，Finance 凭据失效阻断安装。
- 未修改真实租户 grant。AIMS 源端可靠命令、规则编辑页与真实 Token 联调仍待完成。

### AIMS 规则可靠命令身份校验（2026-09-09）

- 新增源端冻结规则校验与期望 receipt 业务目标计算，限制完整六字段、项目月份、原 actor、整数修订及份额合计，精确期望目标为项目／月份／下一修订。
- AIMS 定向 Go 测试通过，覆盖正确规则、目标修订和无效 actor／修订／份额／额外 scope。尚未注册源端 worker allowlist 或生成 operation，可靠提交与编辑页仍待接入。

### AIMS 分摊规则执行器（2026-09-09）

- 已将 `aims.finance.product-cost.rules.replace.v1` 接入统一 claimed-operation 派发器；执行器校验冻结命令摘要、来源/目标/capability/schema，并使用 Foundation 标准回执校验和 fencing token 回写结果。
- 回执业务标识必须为 `projectCode:periodMonth:nextRevision`，结果中的项目、月份、版本也必须一致；目标成功但本地确认失败保持 pending，不误报目标失败。
- 验证：Go `TestProductCostOperation` 通过；tsx 执行规则与文档执行器共 7 项测试通过；本次 TypeScript 文件 ESLint 通过。直接 Node strip-types 无法解析现有无扩展名导入，改用项目可用的 tsx 后通过。
- 尚未完成：Finance 实际投递 IO、源端冻结入口、规则读取/编辑页面及真实租户联调。当前缺失 IO 会可靠记录 503 重试状态，不能视为规则保存链路已可用。

### Finance 规则实际投递 IO（2026-09-09）

- AIMS request/scheduled IO 已连接 Finance replace-rules Service API，复用 Foundation 短期 token、签名和 Service Binding；保持原冻结命令及幂等键，分别绑定来源与目标部署。
- 定时 drain 从 HZY_FINANCE_TARGET_DEPLOYMENT 获取明确目标部署，缺失不回退为 AIMS 部署。Cloudflare renderer 已补 HZY_FINANCE_SERVICE（Worker 名可由 HZY_FINANCE_WORKER_NAME 配置）。
- 验证：签名/执行器/反馈回归 6 项通过；统一 IO 相关回归原 20 项中 19 项通过，1 项旧 Codocs 函数名断言已修正，修正后相关配置与 drain 7 项通过；ESLint 和 AIMS 类型检查通过。
- 剩余：源端冻结入口、完整规则读取/编辑页、真实租户 token/grant/部署联调。未执行部署。

### 分摊规则源端冻结事务函数（2026-09-09）

- 新增 freezeProductCostRules：绑定 aims.runtime、租户/来源部署、原 actor 和项目，校验完整六字段命令，使用共享 canonical digest，以请求 UUID 固定 operation ID/幂等键，写入 pending integration_operation。
- 函数仅使用调用方事务，不自行提交；需要上层在同一事务中处理源请求和幂等结果，并在调用前完成完整项目的授权。当前尚未注册用户可调用的保存接口。
- Go TestProductCostFreezeUsesCallerTransactionAndCanonicalCommand 与 TestProductCostOperation 通过；sqlmock 验证参数、命令摘要及调用方回滚，不能替代真实数据库事务/租户鉴权验收。

### 分摊规则源请求幂等（2026-09-09）

freezeProductCostRules 现在通过不修改原任务的重复键处理及事务锁定读取，比较完整不可变身份、命令摘要、schema、capability 和原 actor。同请求同命令复用原任务；不同命令或身份返回冲突，成功任务不会被重新排队。

验证：Go 冻结/命令单测通过；专用 /tmp MySQL 实例的 TestMySQLProductCostFreezeConcurrentRetry 通过，实际覆盖并发重复提交只留一行、改参冲突、成功状态保持和回滚无残留。保存路由、完整项目授权、编辑页及真实租户链路仍未完成。

### 规则提交的 AIMS 项目授权函数（2026-09-09）

新增 requireProductCostRulesProjectPermission，基于当前会话 UID、完整项目 authorization-object 和 Foundation projects:edit 对象范围决策。请求项目 ID/编码必须与事实一致；目录失败向上传递，不转换成空部门范围。此函数只负责 AIMS 源端提交权限，不授予 Finance 权限；目标投递仍独立复核 project_accounting:edit。

VM 边界测试覆盖允许、拒绝、项目错配、目录失败和无效 ID；ESLint 通过。授权函数尚待保存路由调用，因此不能声称用户提交链路已完成。

### 规则冻结 Runtime 入口（2026-09-09）

新增并注册 POST /v1/aims/internal/product-cost-rules:freeze，固定 aims.runtime 和 aims:product-cost-rules:freeze。仅接受 requestId、command、authorization；授权绑定原 actor、项目 ID/编码、projects:edit、固定 purpose 和最长 30 秒有效期。事务锁定项目、核对编码，再冻结任务；请求冲突返回 409。该入口仍需用户 BFF 路由调用，尚未提供完整保存流程。

Manifest 与双 Runtime audience grant seed/verify 已同步。Go 产品成本测试通过；授权脚本 10 项测试通过；隔离 MySQL 安装验证通过（222 项要求，204 项安装 grant，18 项已有传输前提）。无真实租户授权安装或部署。

### 用户侧规则保存 BFF（2026-09-09）

已注册 POST /api/v1/projects/{id}/product-cost-rules，并绕过通用代理进入专用 BFF。严格六字段输入，禁止客户端提供 actor/授权；项目 scoped edit 后冻结，再即时 claim/派发。冻结后的唤醒失败保留原 requestId 并返回 202，避免用户以新请求重复写入。

保存、授权和执行器 6 项测试通过，ESLint 通过。当前规则读取、编辑页面、终态查询、产品引用完整性和真实租户验收仍需完成；接口已连接不等于完整经营结果功能交付。

保存接口最终由现有 tenant-runtime middleware 在会话解析后直接分派至专用 BFF，使用规范化路径中的项目 ID。未保留独立 Nitro route 文件，避免其新增全局路由类型触发既有页面 $fetch 过深推导；无关文档组件试探改动已撤回。最终 AIMS 类型检查、相关 ESLint 和保存接口测试通过。

### 规则提交终态查询（2026-09-09）

状态 BFF 与 Runtime 已接通，限定原提交人及当前项目编辑权限，白名单输出任务状态，终态不再标记 pending。新增 aims:product-cost-rules:status manifest 和双 audience grants。

验证：Go 产品成本测试（含 SQL 查询参数隔离与状态映射）通过；11 项 TS 状态/授权脚本测试通过；隔离 MySQL grant 验证 224 项要求通过（206 安装、18 前提）；ESLint 与 AIMS 类型检查通过。规则读取和编辑页面、引用完整性以及真实租户验收仍未完成。

### 完整规则读取 Runtime（2026-09-09）

已实现 Finance 精确 read-rules Runtime：完整项目规则读取，不接受单产品过滤；复用原 actor 的项目核算 edit 授权，缺失规则返回 revision 0。读取签名、目标部署与命令字段均受校验，不创建写操作 receipt。

Go 成本测试及新读取测试通过（普通 view 拒绝、空范围拒绝、完整双产品规则和未配置规则）；10 项 grant 契约测试通过；隔离 MySQL grant 安装验证通过，227 项要求（209 安装、18 前提）。Service BFF、AIMS 读取与编辑页面仍待完成。

### Finance 规则读取服务边界（2026-09-09）

已接入 read-rules Service API、精确 capability 身份检查、四字段命令校验和完整规则响应解析。普通成本 read token 不能读取完整规则；签名通过后才加载原 actor 的项目核算 edit 授权；额外授权注入被拒绝。

输入/结果解析、服务编排、实际 middleware 分派及服务 guard 测试通过；Finance 类型检查和相关 ESLint 通过。AIMS 读取调用与编辑页面、引用完整性及真实租户链路未完成。

### AIMS 完整规则读取链路（2026-09-09）

已连接 GET 项目规则入口、项目 edit 授权、Finance read-rules 签名传输及响应解析。与保存共用项目路径，GET/POST 分别分派；不新增 Nitro 全局路由类型。

传输/响应测试通过，覆盖先授权后 token、可信部署绑定、错配响应、重复产品、比例越界、修订和空规则语义；相关 ESLint 通过。编辑 UI、产品引用完整性、真实租户联调及全方案验收仍待完成。

### 分摊规则产品引用完整性（2026-09-09）

源端冻结事务已逐项验证 product_workspaces 登记，拒绝缺失/大小写错配，不把部分匹配当作有效完整规则；归档产品允许历史归集。Go 成本测试通过，隔离 MySQL 使用实际产品中心迁移验证 active/archived、大小写错配及缺失产品均通过。编辑页面及真实租户验收仍待完成；Assets 实时主档状态未在此校验中声称覆盖。

### 分摊规则编辑页（2026-09-09）

已新增 /products/{productCode}/cost-rules，并从经营结果页进入。复用项目选择器，读取完整期间规则，按百分比编辑产品编码/比例/依据，显示已分配及未分配比例；保存替换完整规则前使用 Foundation 确认。冻结请求后锁定编辑、保留请求 UUID，支持查询状态及重试原请求，终态后重新读取编辑。明确的客户端拒绝允许重新读取修正。

AIMS 类型检查及相关 ESLint 通过；Chrome 1440/390 使用真实页面和模拟 API 验证读取双产品、确认提交、202 待处理和查询成功，无 pageerror、横向溢出，截图已检查（/tmp/hzy-product-browser-qa/cost-rules-{1440,390}.png）。仍待增强产品选择体验、刷新后请求恢复和真实租户链路验收；本页完成不代表完整 PC18 或整体产品中心完成。

### 规则任务刷新恢复（2026-09-09）

编辑页使用 sessionStorage 仅保存 requestId、项目 ID/编码和月份，不存规则明细、依据或授权。刷新后恢复查询指针并调用受权限约束的状态接口；不从本地恢复可执行命令。服务端确认终态后可重新读取；停止跟踪需确认且明确不取消后台任务。原页面尚在时仍可使用内存冻结命令重试。

Chrome 1440/390 已验证提交后刷新、自动查询成功、无原命令重发入口，以及存储无 shares/evidenceRef；截图已检查，无 pageerror。相关 ESLint 和 AIMS 类型检查通过。该恢复仅限当前标签页会话，仍不代替真实租户全链路验收。

### 正式项目表闭环回归与修复（2026-09-09）

核对 canonical aims_schema.sql 后发现冻结/状态 Runtime 错用了 projects 表名，已改为 aims_projects；同步修正模拟断言。新增 TestMySQLProductCostFreezeAndStatusRuntime，从正式 schema 提取 aims_projects DDL，加载实际产品中心及 outbox 迁移，经 Adapter.HandleRuntime 验证有效提交、幂等重放、pending 状态查询、原 actor 隔离、未知产品拒绝及事务无残留。

专用 MySQL 实例上 AIMS/Finance 的 Test.*ProductCost 测试均通过。本轮证据修正了此前仅模拟测试对 Runtime 表名覆盖不足的问题；真实租户 JWT、授权安装和完整产品中心验收仍未完成。

### 规则冲突错误语义修复（2026-09-09）

Finance 成本/规则 Service BFF 不再把 Runtime 非零结果一律转换成 503。通过 Foundation 提取受支持的业务 HTTP 状态和稳定错误码，保留版本冲突 409、权限拒绝 403 等终态语义；服务故障仍以 503 处理，不回传原始诊断内容。

相关服务边界和错误分类测试通过，新增实际写入 BFF 的 revision-conflict 响应场景，确认冲突不会误判为自动重试。相关 ESLint 通过；真实网络失败及租户链路仍需整体验收。

### PC-11 旧特性写入口收敛（2026-09-09）

旧 admin/products 页移除特性编辑弹窗及 PATCH/DELETE 调用，特性行统一提供“管理特性”深链至 /products/{productCode}/versions/{versionId}/features，与此前已迁移的版本入口一致；服务端兼容 API 保留，不能据此宣称全部旧客户端已迁移。手机特性行允许换行，操作按钮不再挤压标题。

101 项 sensitive-route 回归、AIMS 类型检查及 ESLint 通过。隔离 Chrome 1440/390 验证深链地址与实际页面显示，截图已检查；真实角色及项目存量流程验收仍待完成。根 validate:business-cloudflare 校验八个业务应用通过。

### PC-11 Assets 产品中心深链（2026-09-09）

Assets 产品台账详情的版本摘要卡增加“进入产品中心”，依据当前用户应用目录生成 /products/{productCode} 深链。同源使用 Foundation Console Shell 路由，跨源沿用授权目录地址，Shell 嵌入场景跳转顶层；无目录项或有效 basePath 时不猜测地址。

链接单测覆盖同源、跨源、无授权目录、非法编码路径和缺失 basePath；Assets 类型检查与相关 ESLint 通过。本次仅增加入口，未完成真实 Shell/租户跳转验收，版本摘要公开字段和存量流程仍需继续检查。

### PC-11 Assets 版本摘要字段收敛（2026-09-09）

Assets 版本适配器不再原样转发 AIMS 响应，白名单保留版本身份、名称、状态、日期及公开特性计数；去除关联项目、actor、工作量和特性正文。跨应用请求改为 Foundation Service Binding/目标上下文，不转发来源 Runtime token 头。台账移除内部项目/工作目标进度列，并直接使用服务端公开特性计数，避免字段过滤后误显示为 0。

字段过滤和适配器契约测试通过，相关 ESLint 通过。此次尚未执行 Assets 页面浏览器验收；现有 aims:read 存量 capability 及目标服务公开范围仍需后续收敛，不能称 PC-11 整体验收完成。

### 2026-09-09 — PC11 Assets 专用版本摘要验证

- Assets 改用 `GET /api/v1/service/products/:productCode/version-summaries`，来源仅 Assets，精确权限 `aims:product-version-summary:read`，AIMS 到两个 Runtime audience 同步授权。旧版本接口保留兼容。
- 修复新增接口未进入运行时转发路由的遗漏；测试执行实际中间件函数，验证 GET 转发、写方法拒绝、来源白名单和 Runtime scope。
- Runtime 仅返回版本元数据、公开特性总数/已交付数；拒绝非法 UTF-8、控制字符和路径分隔符。隔离 MySQL 使用旧版本表真实 DDL，验证私有特性排除、零特性归零、BINARY 产品边界；查询不依赖内部项目表。
- 通过：Go 摘要权限与 MySQL 测试；AIMS 路由 1 项、授权契约 10 项；Assets 摘要 2 项；授权 SQL 230 条要求（212 条安装、18 条传输前置条件）幂等及凭据失效验证；受影响文件 ESLint、AIMS/Assets typecheck。
- 限制：pnpm 使用 Node 25.2.1，仓库要求 >=24.18 <25，类型检查有引擎警告但通过。真实租户 JWT/服务授权联调、Assets 页面浏览器验收未完成。未生产迁移或部署，PC11 与整体目标继续进行。

### 2026-09-09 — PC17 合并需求功能／版本进度读取

新增事务内反馈进度快照读取，解析 canonical 决策并聚合合并需求族关联的公开版本特性；保持计划和实际日期分列，避免重复计数及内部内容透传。隔离 MySQL 验证连续合并、公开过滤、产品边界、空结果、循环和不一致合并状态；既有反馈决策 outbox 回归通过。

当前仅完成读取层，尚未接入回传协议、目标投影或 Altoc UI。后续必须以新 schema/operation 保留旧冻结命令可重试性，继续完成进度回传与真实环境验收；PC17 仍未完成。

### 2026-09-09 — PC17 Altoc 进度校验与投影事务

新增严格八字段进度解析及独立 progress projection，保留旧 v1 决策链路。迁移 048 与 canonical schema 同步；投影锁定原提交绑定并执行单调修订、同代际内容冲突和全量快照替换。解析测试与隔离 MySQL 回归通过，覆盖回滚、幂等、旧代际、清空版本及错产品拒绝。

未完成：新 operation/schema 和签名接收／receipt 接线、AIMS 源 outbox 与功能/版本变更触发、Altoc 读取及 UI、真实环境验收。未执行生产迁移；整体目标保持进行中。

### 2026-09-09 — PC17 新版进度回执原子性

新增 Altoc 新版进度 receipt 接收核心，固定独立 operation/schema/capability，复用共享回执事务；重试重新核验原提交绑定及未删除工单。隔离 MySQL 验证投影失败无成功回执、恢复重试、receiptId 稳定及删除来源后拒绝重放；旧状态 Runtime 回归通过。

当前仍为内部核心函数，尚未对外注册或部署。后续继续接通精确授权、签名 HTTP、AIMS 触发和 Altoc 展示，PC17 未完成。

### 2026-09-09 — PC17 新版进度 Runtime 与精确授权

已注册 Altoc progress Runtime 路由并接入事务回执；隔离 MySQL 实际路由测试通过，验证重放以及错误权限／租户／部署／来源拒绝。manifest 和授权生成器新增三条精确 grant，233 条要求（215 安装、18 前置）SQL 验证及 10 项契约回归通过。

外部签名 BFF、AIMS 触发与派发、Altoc 展示和真实环境验收仍未完成；未执行真实授权安装或部署。

### 2026-09-09 — PC17 Altoc 新版进度签名入口

接通 `/api/v1/service/product-feedback/progress`：精确服务身份、可信租户部署、命令摘要／签名、版本快照边界校验后调用自身 Runtime，并白名单返回核验后的回执。5 项受控 TypeScript 测试、受影响文件 ESLint 和 Altoc typecheck 通过；pnpm Node 25.2.1 引擎警告仍存在。

待完成 AIMS 新版 operation 冻结／派发及变更触发、Altoc 新投影读取／UI、真实 JWT 与跨部署联调。未部署，PC17 未完成。

### 2026-09-09 — PC17 AIMS 新版进度冻结核心

新增独立进度 outbox 冻结 helper，保留原反馈身份并记录 canonical 决策和公开版本快照。修复嵌套结构体与接收端 JSON map 摘要排序不一致；隔离 MySQL 对落库命令复算摘要、协议身份、合并状态和父事务回滚验证通过，旧决策 outbox 回归通过。

尚未接入业务触发及 AIMS 派发执行器，Altoc UI 与真实环境验收仍待完成。未部署。

### 2026-09-09 — PC17 AIMS 新版进度命令识别

AIMS Runtime 的已租约 operation 校验、目标回执身份及 schema 解析已识别 update-progress.v1。新增八字段／公开版本快照校验，拒绝错误目标、非法修订、重复版本、错误日期及计数越界；旧版与新版相关 Go 测试通过。

尚待 TypeScript 执行器与签名 transport、业务事务触发和 Altoc UI 接线；当前不能认定新版进度可以自动派发，整体目标继续进行。

### 2026-09-09 — PC17 AIMS 新版进度派发

新版 progress 执行器、签名 transport 已接入共享 dispatcher、请求态及 scheduled IO，复用 Altoc 明确目标部署配置。7 项执行器／传输及旧状态回归测试、受影响文件 ESLint、AIMS typecheck 通过；类型检查仍有 Node 25.2.1 引擎警告。

业务变更触发尚未接入，所以目前不会自动冻结新版进度事件。后续继续需求／功能／版本触发、Altoc 展示与真实环境验收，整体目标未完成。

### 2026-09-09 — PC17 需求决策与合并自动冻结进度

DecideProductRequest 和 MergeProductRequest 事务已调用新版进度冻结 helper。合并使用目标需求族，保留原反馈身份；最终需求继续评估时也向历史合并来源冻结新的 canonical 决策。

隔离 MySQL 需求决策／合并／反馈回归通过；新增注入进度 outbox 失败验证需求修改和旧状态 outbox 一同回滚，连续合并及 canonical 后续评估事件内容验证通过。现在这两类业务事务可产生待派发 progress operation，但功能关联与版本变化触发、Altoc 页面读取展示、真实 worker/JWT 验收尚未完成。未部署。

### 2026-09-09 — PC17 功能需求关联变更触发

ChangeFeatureRequest 的关联／解除关联事务已冻结新版反馈进度，Runtime 传递可信租户部署上下文；仅存在正式反馈来源时要求该上下文，不改变普通手工需求行为。隔离 MySQL 真实 link/unlink 流程验证：关联后事件包含公开版本，解除关联后新版事件清空版本数组；既有关联授权、并发修订、回滚及幂等测试通过。AIMS 反馈相关 Go 测试通过。

版本自身状态／特性变化触发、Altoc 展示与真实环境验收仍待完成，未部署。

### 2026-09-09 — PC17 版本编辑与归档触发

新增产品级反馈进度刷新 helper：从正式来源绑定找到 canonical 需求族，每族冻结一次，避免只按当前版本关联选取而漏掉已移除证据。版本编辑和归档事务已调用该 helper，Runtime 传递可信租户部署上下文。

隔离 MySQL 实际 EditProductCenterVersion / ArchiveProductVersion 验证通过：计划日期调整进入新修订快照，归档状态进入后续快照。AIMS 相关编译及版本／反馈回归通过。当前产品级刷新会读取各反馈来源，较大反馈量的性能验证仍待完成。

待完成版本发布与版本特性变化触发、Altoc 展示及真实环境验收；未部署，整体目标未完成。

### 2026-09-09 — PC17 版本发布触发

新增带可信反馈上下文的版本发布入口，并由实际 Runtime 调用；发布事务在更新产品修订后冻结产品反馈进度。保留原发布函数兼容无正式反馈的调用，不允许有反馈时静默漏发。隔离 MySQL 实际验收／发布／重放测试验证发布修订只产生一条进度事件，相关 AIMS 反馈测试通过。

版本重新打开、更正及版本特性变化仍需补齐触发；Altoc 展示和真实环境验收未完成，未部署。

### 2026-09-09 — PC17 版本重新打开触发

ReopenProductVersion 事务和实际 Runtime 接线新增可信反馈上下文，重新打开发布版本后冻结新修订进度。隔离 MySQL 发布／重新打开回归通过：审计写入失败时无进度 outbox 残留，成功及同命令重放只保留一条新版事件；AIMS 反馈相关测试通过。

尚未完成版本特性变化／更正触发、Altoc 展示与真实环境验收，未部署。

### 2026-09-09 — PC17 版本范围交付／撤销交付触发

版本范围确认交付和重新打开事务已冻结新版产品反馈进度，实际 Runtime 传递可信来源。隔离 MySQL 真实动作验证：确认交付后公开版本已交付计数从 0 变 1，重新打开后回到 0；保留原有 accept 权限要求。相关版本范围及反馈 Go 回归通过。

公开可见性调整、其他范围增删／顺延、更正触发仍需审计补齐；Altoc 展示及真实环境验收未完成，未部署。

### 2026-09-09 — PC17 版本进入开发触发

审计发现规划→开发也是对外快照状态变化；TransitionProductVersion 与 Runtime 已接入可信反馈进度冻结。隔离 MySQL 实际动作验证新修订中版本状态为 developing，相关版本转换和反馈测试通过。

公开可见性仍存在旧 updateVersionFeature 入口，需结合旧写入口收敛与产品修订锁补齐，不能直接在非事务 UPDATE 后补发。范围顺延、更正及 Altoc 展示／真实环境验收仍待完成。未部署。

### 2026-09-09 — PC17 新增／顺延范围触发

CreateProductVersionScope 与 Runtime 接入可信反馈上下文；新增范围及同事务顺延原范围后冻结产品级进度。新范围仍按既有规则默认非公开，未因回传扩大可见性。隔离 MySQL 实际规划选择→范围顺延→重复提交验证只生成一条新版事件，相关范围与反馈回归通过。

旧公开可见性入口、发布更正及 Altoc 展示／真实环境验收仍需完成，未部署。

### 2026-09-09 — PC17 Altoc 新版进度读取

工单反馈读取在原有当前用户 edit／对象范围检查和 RepeatableRead 事务内读取新版投影，校验原工单、产品、需求与修订绑定。新版修订不低于旧决策时返回 canonicalDecisionStatus、versions、progressSourceRevision；旧决策先到而进度落后时仅标记 progressPending，不把旧版本快照当当前进度。BFF 白名单同步新增字段。

隔离 MySQL 实际授权读取覆盖新版优先和乱序待更新；提交 BFF 回归、ESLint、Altoc typecheck 通过（Node 引擎警告仍存在）。页面展示尚未接入，公开可见性旧写入口／发布更正及真实环境验收仍待完成，未部署。

### 2026-09-09 — PC17 回传错误分类修复

修复 Altoc 新旧反馈服务将所有 Runtime 非零响应统一变为 503 的问题。现保留权限、绑定、修订冲突及限流状态，保留稳定错误码并移除原始诊断；同代际异内容 409 可由共享执行器判为不可重试，避免永久冲突反复投递。

7 项服务处理器／错误分类测试通过，覆盖实际处理器非零 envelope 分支；受影响服务 ESLint、Altoc typecheck 通过（Node 引擎警告仍存在）。页面展示、旧公开写入口、更正与真实环境验收仍待完成，未部署。

### 2026-09-09 — PC17 Altoc 进度页面展示

工单 ProductFeedback 弹窗已显示 canonical 评估状态、公开版本状态和相关特性交付计数、计划／实际发布日期。进度尚未追上时显示等待更新，已确认空快照显示暂无公开版本；说明发布不代表客户部署。

实际组件配模拟 API 的 Chrome 1440/390 流程验证通过：提交、刷新恢复、继续派发、合并后评估与版本信息显示，无页面错误和水平溢出；两张截图已人工查看。受影响组件 ESLint、Altoc typecheck 通过（Node 引擎警告仍存在），隔离预览已停止。真实租户跨应用联调、旧公开写入口及发布更正等剩余项未完成；未部署。

### 2026-09-09 — PC17 发布更正触发核验

核实发布更正复用 PublishProductVersionWithFeedback 的重新发布事务，已有进度触发覆盖，无需新增平行更正入口。扩展隔离 MySQL 真实更正流程：审计失败时更正记录、事件及进度 outbox 均回滚；恢复成功和同命令重放仅产生一条该修订进度事件，回执不变。测试通过。

此前“发布更正触发待完成”现由上述证据消除；旧公开可见性写入口、较大反馈量性能及真实环境联调／整体方案其他验收仍待完成。未部署。

### 2026-09-09 — 版本公开可见性事务核心

新增 ChangeProductVersionScopeVisibility：当前产品 edit 授权、工作空间／版本／范围修订校验，显式布尔值及原因；在同事务内修改公开设置、递增修订、冻结反馈进度并记录审计。已发布／归档版本禁止直接改公开设置。隔离 MySQL 真实命令验证隐藏后版本从反馈快照移除，重新公开后恢复，授权刷新后的幂等重放保持原回执。

当前仅领域事务核心，尚未注册 Runtime/BFF/UI 或收敛旧 updateVersionFeature 入口，不能宣称公开可见性迁移已完成。真实环境验收与整体方案剩余项继续进行，未部署。

### 2026-09-09 — 公开可见性 Runtime 与精确授权

注册内部 versions:scope-visibility，接入领域事务和可信反馈上下文；要求独立 aims:product-versions:scope-visibility capability。manifest 与双 Runtime audience grant 同步，授权矩阵现为 235 条要求（217 条安装、18 条传输前置），隔离 MySQL 幂等与凭据失效验证通过，10 项授权契约测试通过。运行时拒绝普通 read/edit capability 和 GET 的测试通过。

尚未接入 BFF/UI 或关闭旧写入口，公开可见性迁移仍未完成；未安装真实环境授权或部署。

### 2026-09-09 — 公开可见性 BFF 接线

新增 features/:scopeId/visibility POST handler，复用产品版本范围 BFF；严格解析 isPublic 布尔值、三层修订和原因，路由绑定版本／范围，校验当前产品 edit 权限并使用独立 Runtime capability。5 项范围 BFF 测试通过，新增覆盖 false 值保留、错误类型、伪造 actor 和无效修订拒绝；受影响服务 ESLint 通过。

尚待页面操作、旧写入口收敛及真实环境验收，未部署。

本轮接线补充：独立 Nitro 路由文件触发既有 document picker 的类型实例化深度错误，已移除该新增文件，改由完成 Console 认证后的 tenant-runtime 中间件接管同一路径，POST 限定并解码路由产品标识，再调用同一 BFF。调整后 AIMS typecheck 与中间件 ESLint 通过；用户接口路径保持不变。

### 2026-09-09 — 公开可见性中间件路由验证

修复 visibility 路由匹配未使用既有 normalizedApiV1Path 的遗漏，支持带应用前缀路径。测试执行实际中间件分支与实际路径归一化函数，验证认证先于派发、中文产品编码解码、POST 限制、非法百分号编码拒绝。与范围 BFF 共 6 项测试、相关 ESLint 通过。

页面与旧写入口收敛仍待完成，未部署。

### 2026-09-09 — 版本范围读取公开设置

发现产品中心范围列表未返回 is_public，页面无法可靠显示或切换当前值。读取 DTO、SQL 与扫描同步补充布尔字段，沿用当前产品 view 授权及事务。隔离 MySQL 在实际隐藏／公开命令后读取列表，验证 false／true 与持久化一致；范围、规划选择和反馈回归通过。

公开设置页面操作与旧写入口收敛仍待完成，未部署。

### 2026-09-09 — 公开可见性页面操作接线

版本范围页新增独立公开设置弹窗，仅产品 edit 权限且版本可修改、服务返回明确 is_public 布尔值时显示。提交包含原因、三层修订、Foundation 确认和稳定幂等键，相同内容重试沿用键；成功刷新范围列表。受影响 Vue／类型文件 ESLint 通过。

目前页面尚未执行桌面／手机浏览器验收，不能标为 UI 完成。旧写入口收敛及真实环境验收仍待完成，未部署。

### 2026-09-09 — 公开设置弹窗浏览器验证

实际 VersionScopeVisibility 组件在隔离 Nuxt 预览配模拟 API，通过 Chrome 1440/390 宽度验证：填写原因、Foundation 确认、POST 布尔值与三层修订、幂等键、成功通知，无页面错误或水平溢出。等待弹窗动画结束后重拍并查看桌面／手机截图，布局正常。预览已停止。

该证据覆盖独立组件的设为公开成功流程，不等同完整范围页权限切换、失败恢复或真实租户验收；旧写入口收敛仍未完成。

### 2026-09-09 — 旧版特性修改入口退役

项目 releases 和 admin product-versions 两条旧特性 PUT/PATCH 写路径均返回 410 与稳定迁移错误码，移除绕过产品修订、验收及反馈 outbox 的直接 UPDATE。产品中心已提供规划范围编辑、交付确认和公开设置。实际路由测试覆盖两路径与两方法，均在访问数据库前拒绝；旧版本退役回归通过。

旧特性 DELETE 仍需结合证据保留策略处理；不能据此宣布所有旧写入口完成收敛。完整页面／失败恢复、真实环境和整体方案验收继续进行，未部署。

### 2026-09-09 — 旧版本范围删除入口退役

依据方案保留原版本范围标识、验收及顺延证据的要求，停用项目和 admin 两条旧特性 DELETE：原实现直接清空 work_items.feature_id 并删除范围，不经过产品修订／反馈事务。现在返回 410 与迁移说明；实际路由测试验证在数据库访问前拒绝，旧版本退役回归通过。

此项不删除任何已有数据，也不影响长期功能的无引用草稿删除。新旧入口整体回归、完整范围页与失败恢复及真实环境验收仍待完成；未部署。

### 2026-09-09 — PC11/PC17 新旧入口联合回归

对当前工作树执行联合验证：隔离 MySQL 下 AIMS、productcenter、Altoc 的 ProductVersion / VersionScope / Feedback / Legacy Version/Scope 测试全部通过；AIMS 111 项权限、进度执行器／transport、范围 BFF 与 visibility 中间件测试通过。Altoc 新版服务身份／签名入口／路由／输入／错误分类与提交读取回归通过。

该批证据覆盖各层受控测试及隔离数据库，不能代替真实租户 JWT、服务凭据、跨部署 HTTP、worker 恢复演练和产品整体 AC 验收。完整范围页失败恢复、较大反馈量性能及整体计划其他模块剩余项继续进行，未部署。

### 2026-09-09 — 合并反馈刷新去除重复版本聚合

将 canonical 需求解析从版本快照查询中拆分；产品版本变更按 canonical 数字 ID 去重后，每个合并需求族只在冻结事件时读取一次版本聚合，移除逐来源版本聚合及 biz_id 反查。原有循环、64 层深度、状态／引用一致性和产品边界校验保留；原始反馈身份仍分别生成事件。

隔离 MySQL 反馈／版本范围回归通过；新增两个来源需求属于同一合并族的实际事务验证，确认两条独立事件、两个原始身份和一致版本快照。此项消除明确的重复聚合，不代表大批量性能验收完成；合并链解析仍逐来源查询。真实环境联调与整体方案其他验收未完成，未部署。

### 2026-09-09 — 公开设置确认与失败重试验证

修复公开设置等待 Foundation 确认时仍允许重复保存／修改表单的竞态：进入确认前置 busy，冻结请求 URL 和内容；取消及失败均经 finally 解锁。网络结果不明时保留原因及同内容幂等键。

实际组件隔离预览在 Chrome 1440/390 下通过模拟首次 503、错误提示、原因保留、再次确认成功流程；断言确认期间输入禁用、两次提交内容相同、幂等键相同，仅两次写请求且无页面错误／水平溢出。组件 ESLint 通过。该证据仍不代替完整范围页并行动作、角色切换和真实跨应用联调，未部署。

### 2026-09-09 — 公开设置接入范围页操作锁

公开设置组件新增 disabled 输入与 busy 事件，接入范围页既有 busy 状态，使其他范围操作和路由离开保护覆盖确认／保存阶段；保存期间同时禁用弹窗关闭按钮。成功事件改为释放 busy 后发出，避免父页 reload 的 busy 守卫跳过刷新。

隔离预览使用相同父子 busy 接线，Chrome 1440/390 验证确认期间兄弟操作禁用、503 后可重试、成功后解锁以及同内容幂等键不变；受影响组件／页面 ESLint 通过。仍需完整页面权限切换与真实租户联调，未部署。

### 2026-09-09 — 完整范围页刷新与权限变化浏览器验收

隔离 Nuxt 预览直接挂载仓库完整 features.vue，使用模拟 API 在 Chrome 1440/390 验证：公开设置实际 POST 后范围列表重新读取，按钮变为设为内部；随后撤销 edit 权限并重新读取，等待列表和权限请求完成后，公开设置及补录验收标准入口消失。此次不再只验证独立组件，保存后的父页刷新路径已执行。

两个视口均无页面错误和水平溢出，已查看最终列表截图。测试脚本位于 /tmp/hzy-product-browser-qa/scope-page.cjs；证据限定为真实页面配模拟服务，不能证明真实授权签发或服务端撤权执行。真实租户联调、完整角色矩阵及剩余方案验收仍未完成，未部署。

### 2026-09-09 — 固化范围页浏览器回归

将完整范围页回归保存为 test/integration/product_scope_browser.cjs，并提供运行说明。仅允许 loopback 预览，拦截未声明 API 请求，Playwright 路径可配置。新增断言：edit 撤销后公开／补录入口消失，但独立 accept 权限的确认交付仍可用。仓库脚本在现有隔离预览下两个视口执行通过。真实角色矩阵与租户授权验收仍未完成。

### 2026-09-09 — 公开设置回执完整性

公开设置 UI 不再把任意 HTTP 成功当作命令完成。按冻结的提交对象校验 code、范围 ID、版本 ID、公开布尔值和三层修订递增；不完整结果进入原有错误恢复，保留原因与幂等键，不发 saved 或刷新。

仓库浏览器脚本新增首个响应 code=0 但缺 value 的场景，验证列表未提前刷新、同键重试收到完整回执后才完成；Chrome 1440/390 均通过，组件和脚本 ESLint 通过。真实环境联调仍待完成，未部署。

### 2026-09-09 — Assets 版本摘要用户授权补齐

审计本地 products/:id/versions 路由发现其绕过通用 runtime 转发，原处理器未显式检查 products:view，内部产品 lookup 也未携带当前用户。现先通过既有 requirePermission 校验，再向自身 runtime 传入 requireRequestUid 的已验证身份，最后申请 AIMS 摘要服务令牌。

执行实际处理器的 VM 测试验证拒绝发生在 lookup／token 之前，成功路径传递 verified actor；3 项摘要测试通过。Assets 既有 checkPermission 对授权依赖故障的错误分类及真实环境对象边界仍需继续核验，不能据此宣称端到端授权验收完成。未部署。

### 2026-09-09 — Assets 授权依赖故障分类

修复产品摘要所调用的 Assets 既有 checkPermission：Console 授权加载失败不再返回 false 并被 requirePermission 误映射为 403，改为统一、不含内部诊断的 503。未登录仍 401，有效快照明确拒绝仍 403；授权算法继续由 Foundation 执行，未修改角色或动作蕴含规则。该共享 helper 的其他 Assets 调用方同步获得同一故障语义。

实际 helper VM 测试覆盖允许、拒绝、依赖故障、匿名不加载快照及诊断不泄露；与版本摘要共 4 项测试通过，ESLint、Assets typecheck 通过（既有 Node engine 警告）。真实产品对象范围与跨应用联调仍待核验，未部署。

### 2026-09-09 — Assets 摘要下游错误语义

Assets 产品 lookup 与 AIMS 版本摘要非零 envelope 现在复用 Foundation 状态提取，保留明确的 400/401/403/404/409/422/429，其他故障返回 503；统一用户提示，不再透传下游内部 message 或一律 502。

实际处理器测试调用真实 Foundation 提取函数，覆盖两个边界的 401/403/404/409/429/500 共 12 个错误场景，验证本地 lookup 拒绝后不申请服务令牌，且诊断不泄露。3 项摘要测试和相关 ESLint 通过。传输层异常继续由 Foundation 处理；真实对象范围和跨应用环境验收仍未完成，未部署。

### 2026-09-09 — Assets 产品对象范围审计发现

追踪实际 Runtime 发现产品详情专用 getProduct(ctx,id) 不接收 query，SQL 仅按 ID；因此此前补入 current_user 并不构成对象范围执行证据。BFF products:view 修复仍有效，但仅为资源级权限。通用 middleware 范围集合也未包含 products。

新增 Aims-Product-Center-Assets-Scope-Gap.md，记录具体证据、规范字段、完整入口整改范围与验收要求。该发现使下一步从 UI 联调转为 Assets 产品列表／详情／写入对象范围补齐；不能用仅摘要接口限制代替完整修复。未部署，PC11/PC12 授权验收仍未完成。

### 2026-09-09 — Assets 产品范围 SQL 核心

新增 productObjectScopeWhere，复用既有授权单元结构与关系谓词规范化，映射产品业务／技术负责人和规范项目字段；同一单元条件 AND，不同单元 OR。未知／不适用关系、缺失直接关系 actor、空单元及无规范映射的部门限制均不放宽；部门条件存在时整个单元不参与授权。

隔离 MySQL 直接执行生成谓词，覆盖双负责人、项目、单元交叉组合、部门不能丢弃、未知关系及空范围共 8 个场景。该核心尚未接入产品 list/detail/write 与 BFF，不能宣称对象范围漏洞已修复；继续按 Assets-Scope-Gap 文档完成完整接线和验收。未部署。

### 2026-09-09 — Assets 产品详情范围接线

产品详情 Runtime 现在必须提供可信 actor 与对象范围，relation 使用产品范围 SQL，在读取任何关联明细之前限定主产品；缺失／none 范围直接拒绝。通用 middleware 将 products 纳入 Foundation scoped authorization 派生，本地版本摘要 lookup 同样显式派生并传递 products:view 范围。

新增实际详情函数 SQL mock 测试：缺范围不访问存储，负责人 AND 项目条件写入主查询，越界无关联查询。隔离 MySQL 范围谓词、详情与既有列表过滤回归通过；Assets 摘要处理器测试及受影响 ESLint 通过。注意普通产品列表和既有 serviceProducts 共用 listProducts，尚需拆分精确服务契约后接入用户列表；写入口仍未完成，整体范围缺口未关闭。未部署。

### 2026-09-09 — Assets 用户列表与服务目录拆分

普通产品 listProducts 现要求 actor／对象范围，与详情使用相同产品范围谓词；items、total 及汇总来自范围过滤后的同一结果。存量 serviceProducts helper 改走独立自身 runtime /service/products，复用已安装脚本定义的 assets:product:read capability，经受信服务校验后读取目录，避免通过用户列表绕过范围。

隔离 MySQL 产品目录／范围测试、实际列表与服务路由 SQL mock 回归通过，覆盖缺范围、宽服务 scope 拒绝、负责人 AND 项目以及精确服务成功。服务 helper ESLint 通过，模块合同和 Assets CLAUDE 同步。列表仍为存量非分页实现，写入口范围与真实环境验收待完成，未部署。

### 2026-09-09 — Assets 产品主档修改事务范围

产品 PATCH 改为事务内执行：使用可信 current_user 和 edit 范围锁定产品，执行更新后重新验证范围，越界归属变更回滚；updated_by 不再通过 body 回退。新增 requireProductWriteScopeTx 可用于其余产品关联写入口。

实际修改函数 SQL mock 验证原对象越界拒绝、更新后移出范围回滚、合法修改提交；隔离 MySQL 范围谓词与产品读取回归通过。产品创建、关联底座／资产／文档的事务范围及关联目标授权仍未完成，真实环境验收未完成，未部署。

### 2026-09-09 — Assets 产品创建事务范围

产品创建现在要求可信 actor 与 edit 对象范围，不再从 body 回退操作者；在创建事务内对新主档执行相同负责人／项目范围谓词，越界时回滚且不写创建事件。有效全局授权仍可创建任意符合业务字段要求的主档，受限授权须使新主档处于自己的范围。

实际创建函数 SQL mock 验证匿名不访问存储、新行越界回滚且无审计事件、合法新行与事件一起提交；产品修改／读取与隔离 MySQL 范围谓词回归通过。关联底座／资产／文档写入口及真实存量数据库事务验收仍待完成，未部署。

### 2026-09-09 — 产品关联写入的父对象事务范围

产品关联底座、资源资产及文档均改为使用可信 query actor，并在关联事务内锁定、校验父产品 edit 范围。文档专用 wrapper 复用原有 linkDocumentWithSchema，不改动其他对象文档路径；父产品越界不产生关联或事件。

三类关联的实际函数 SQL mock 验证父范围拒绝发生在写入之前并回滚；产品创建、修改、列表和详情回归通过。此项仅完成父产品边界；目标资产／底座／Codocs 文档权限仍必须分别补齐，不能将父对象可写解释为目标可访问。真实环境与整体验收未完成，未部署。

### 2026-09-09 — 产品关联资产的独立目标范围

关联资产 middleware 除 products:edit 外，独立获取 asset_items:view 范围，清除传入 query/body 的目标范围字段后设置受信值。Runtime 在同事务内先锁定父产品，再使用既有 assetItemScopeWhere 锁定非归档目标资产；产品全局权限不能替代资产权限，目标范围缺失／none 拒绝。

实际关联函数 SQL mock 验证产品全局权限配目标缺失、none、项目越界均回滚，目标全局有效且存在时关联与事件提交；相关产品事务回归和 middleware ESLint 通过。middleware 派生／防伪造执行测试及真实数据库关联验收仍需补齐；底座和 Codocs 文档目标授权未完成，未部署。

### 2026-09-09 — 关联资产中间件范围防伪造回归

新增 test/productTargetScopeMiddleware.test.ts，执行实际 resolveAssetsRuntimeQuery 并使用实际权限路由／范围字段清理 helper。验证 products:edit 与 asset_items:view 分别获取，同一请求父范围 relation 不改变目标 none；query/body 伪造 all、units、admin 被移除，普通字段保留，匿名不产生范围，目标授权服务故障向上抛出而非降级。

与授权可用性／版本摘要共 5 项测试通过，新增测试 ESLint 通过。此证据覆盖 BFF 接线，不代替真实租户可信 actor 传播和数据库关联验收；底座与文档目标授权仍待完成，未部署。

### 2026-09-09 — 产品关联底座独立目标范围

关联底座中间件独立获取 technology_bases:view；Runtime 在父产品锁内校验目标底座 owner_uid／technical_owner_uid 和 project_code。复用相同授权单元 AND/OR 组合逻辑，负责人列是代码中的规范常量，不接受请求指定字段。缺目标范围、none 和越界拒绝，不以产品权限替代底座权限。

实际关联函数 SQL mock 覆盖目标缺失／none／越界回滚及有效全局范围提交；中间件执行测试确认 bases 路径获取 technology_bases:view 而非 asset_items:view。隔离 MySQL 产品相关回归及 ESLint 通过。Codocs 文档目标授权、真实数据库关联与租户验收仍未完成，未部署。

### 2026-09-09 — 产品主档真实 MySQL 事务与结构修复

真实数据库验收发现规范 product_assets 缺少运行时代码已使用的 build_stage、current_version、target_version、productization_value_level、supported_terminals、covered_legacy_systems 六列。规范 schema 已补齐，并新增幂等迁移 assets/docs/migrations/20260909_product_master_runtime_fields.sql；不改写已有列或产品数据。

新增 TestMySQLProductMasterScopeTransactions：独立临时库按规范 DDL 建表，重现旧结构缺列后执行迁移及重放；实际创建合法产品、越界项目修改回滚、越界创建回滚，最终仅保留一条产品和一条创建事件。测试通过，临时库自动清理。该证据补强主档事务，不等于关联事务／真实租户验收；文档目标授权仍未完成，未部署或迁移业务库。

### 2026-09-09 — 底座与资产关联真实 MySQL 回滚验收

扩展真实隔离 MySQL 主档测试，按规范 DDL 创建底座、资产和两类产品关联表。实际函数验证底座负责人越界、资产项目越界及归档资产均不能关联；通过数据库触发器注入审计失败，确认底座／资产关联 INSERT 均随事务回滚。移除故障后成功关联，最终关联数与事件数精确一致。测试通过并清理临时库。

该证据关闭此前两类关联仅 SQL mock 的事务验证缺口，仍不代替真实租户授权传播或并发授权撤销；Codocs 文档目标授权和整体方案其余验收继续进行，未部署。

上述真实关联测试还暴露并修复了 is_primary 缺省问题：省略该可选参数时原转换返回 NULL，与规范 NOT NULL 列冲突。关联 INSERT 现将缺省值按表定义取 0；实际 MySQL 成功关联和目标范围回归通过。

### 2026-09-09 — 产品文档规范身份校验

核实现有 Codocs 产品文档签名合同绑定 aims.runtime，Assets 不可直接冒用。目标文档授权仍需独立合同接线。本轮先补产品文档 UUID 边界：仅接受规范非零 UUID，兼容既有三个字段名但拒绝冲突，非法身份在元数据查询及事务前拒绝；其他对象的 legacy 文档引用未改变。产品关联弹窗标签与占位提示同步 UUID。

实际函数测试覆盖缺失、任意编号、非字符串、零 UUID、空白和冲突别名拒绝，三个有效别名通过；父产品范围回归通过。此项不是文档 ACL 验收，目标授权仍未完成，未部署。

### 2026-09-09 — Assets 产品权限联合回归与服务身份收紧

对当前工作树执行 Assets Go 包全部测试（配置产品中心隔离 MySQL）、22 项 BFF 权限路由／目标范围／摘要／授权可用性测试及 Assets typecheck，均通过。typecheck 保留既有 Node engine 警告。

审阅独立服务目录发现客户端身份仅检查非空，已收紧 requireProductCatalogService 为 assets.runtime，保持 source_app=assets、tenant/deployment 及精确 capability 校验；新增错客户端拒绝，产品相关回归通过。此变更同时作用于分页 catalog 和存量服务目录。文档目标授权、列表分页及真实租户验收仍未完成，未部署。

### 2026-09-09 — Codocs Assets 文档授权领域核心

Codocs 共享签名文档命令校验支持由代码固定的 SourceApp，既有合同默认仍为 aims；新增内部 assetsProductDocumentMetadata 使用独立 assets.codocs.product-document.read.v1 操作及 assets.runtime 来源，复用当前用户的 Codocs documentAccess，不从产品归属继承文档 ACL，仅返回四项元数据。

领域测试验证 AIMS 身份不能用于 Assets 操作、Assets 操作不能用于 AIMS 入口，合法 Assets 命令经过真实 documentAccess 查询并剔除存储路径／正文等字段；产品／项目文档相关回归通过。尚未注册 Assets 专用 Runtime／Service API，也未接入 Assets BFF、签名传输和 grants；目前只是领域核心，文档关联目标授权仍未完成，未部署。

### 2026-09-09 — Assets 文档元数据 Runtime 注册

注册 Codocs 自身 POST /service/assets-product-documents/:uuid/metadata，调用独立 Assets 签名授权核心；方法、精确 capability 与来源身份约束保持。实际 Adapter.HandleRuntime 成功路径经过文档 ACL 并返回四字段元数据，宽 scope／GET 在数据库前拒绝，产品／项目文档回归通过。

模块合同记录实现中边界；Codocs Service API、Assets BFF 签名传输及 source grants 尚未接入，用户文档关联目标授权仍未完成，未部署。

### 2026-09-09 — Codocs Assets 文档 Service API

注册独立 assets-product-documents/:uuid/metadata POST，限定 assets.runtime 与精确 capability，沿用 Foundation 的 token、tenant/deployment、HMAC 与委托 actor 校验，再以 Codocs 身份调用自身 Runtime。中间件允许该已登记本地 Service 路径；合同与模块说明同步。

Assets／AIMS 两条元数据处理器共 6 项测试通过，包含真实 HMAC 和篡改拒绝；受影响文件 ESLint 通过。新增 Nitro 路由触发现有 directoryService 动态 $fetch 类型实例化过深，已显式声明该外部 Directory 响应／URL 类型，避免参与本应用路由推导。Assets 调用端与 source grants 尚未完成，未部署。

本轮接线最终调整：独立 Nitro 路由引发其他存量动态请求连续出现类型深度错误，已移除新增路由文件，改为 Codocs 完成 Console 认证后的中间件精确匹配同一 API 路径、限制 POST、绑定 uuid，再调用独立 service helper。临时 Directory 类型改动全部撤回（该文件无 diff）。最终两条处理器 6 项签名测试、相关 ESLint 与 Codocs typecheck 均通过。中间件新派发分支执行测试仍需补齐。

### 2026-09-09 — Assets 文档中间件与服务 grant 验证

新增执行实际 Codocs 中间件分支的测试，覆盖应用前缀、路径 UUID 覆盖旧 params、认证先于派发、GET 405 和认证故障不派发；与 Assets 签名处理器共 4 项测试及 ESLint 通过。

产品授权生成器新增 assets→codocs 的 product-document:read；复用 Codocs 双 runtime audience 既有精确授权。矩阵现 236 条要求（218 条安装、18 条传输前置），10 项生成器契约测试及隔离 MySQL 幂等 seed、缺客户端、诱饵客户端、失效凭据验证通过。业务环境未执行 seed，Assets 调用端和文档关联原子授权绑定仍需实现，未部署。

### 2026-09-09 — Assets 文档元数据签名调用 helper

新增 Assets productDocumentCodocs helper：当前用户 products:edit 检查、规范产品／文档输入、可信双 deployment 路由、精确服务令牌、Foundation HMAC 与 serviceAppFetch。返回核对文档 UUID 和四字段元数据，忽略其他字段；产品对象范围由调用方先行解析，不能直接把浏览器 productCode 当已授权对象。

实际 helper VM 测试验证用户身份、服务来源、双部署、固定路径、权限先于 token／fetch、错误 UUID 回执拒绝及字段白名单；ESLint、Assets typecheck 通过。首次类型检查发现 ServiceAppFetchOptions 不支持 retry，已移除该无效参数。helper 尚未接入产品关联写入口；短期校验结果与具体写入绑定仍需完成，未部署。

### 2026-09-09 — 产品文档关联预检与事务身份绑定

Assets middleware 文档关联分支现先验证 UUID 别名一致、按当前产品范围读取 product_code，再调用 Codocs 签名 ACL 查询；成功后派生 actor/product id/code/document uuid/15 秒截止时间，移除入站同前缀伪造字段。Runtime 关联事务在产品锁后校验期限及所有绑定，并重查当前产品编码，避免重命名后使用旧预检。

BFF helper 实际函数测试验证查询顺序、可信 actor 覆盖、规范产品码、文档拒绝与冲突身份；Runtime 测试验证绑定缺失、期限及产品码变化拒绝。产品文档／父范围回归、ESLint、Assets typecheck 通过。仍需完整中间件文档分支、真实数据库文档关联事务、浏览器及真实租户链路验收；15 秒预检不是跨库原子 ACL 撤权。未部署。

### 2026-09-09 — 产品文档关联真实事务与中间件防伪造

真实隔离 MySQL 测试新增规范 asset_documents 表：过期预检、错误产品编码不写入；有效预检重复关联仅一条记录；触发器注入关联更新失败后，原 remark 与 linked_by 保持不变。与主档／资产／底座事务场景一起通过。

实际 Assets 中间件文档分支执行测试验证先派生产品 edit 范围、清除 query/body 伪造 document proof 后调用预检，返回仅服务端派生字段；与预检 helper 共 2 项测试及 ESLint 通过。尚缺真实跨应用 HTTP／JWT 与浏览器文档关联验收，不能把本地 proof 测试当作生产 ACL 验收。未部署。

### 2026-09-09 — 产品文档关联弹窗恢复与浏览器验收

弹窗新增规范 UUID 校验与内联错误提示，提交期间禁止重复点击、修改字段和关闭；冻结本次产品 ID，校验成功回执 code／产品 ID 后才通知完成。服务失败保留输入并提示检查产品及文档访问权。

实际组件隔离 Nuxt 预览配模拟 API，Chrome 1440/390 验证无效 UUID 不发请求、首次 503 保留 UUID、再次提交成功、无页面错误或水平溢出；截图已查看。组件 ESLint 与 Assets typecheck 通过。该验证不是完整产品详情页／真实服务链路，业务环境 JWT、grants、跨应用请求仍待验收，未部署。

### 2026-09-09 — 产品列表分页 Runtime 基础

产品列表显式携带 page/pageSize 时现执行 SQL LIMIT/OFFSET，限制页容量 100；汇总与当前页使用同一个只读 REPEATABLE READ 事务，全部沿用产品对象范围及搜索条件，空的越界页仍返回筛选总数。未携带分页参数的存量调用保持兼容。

定向 Go 回归通过，包含受限负责人与项目范围、空页保留全量总数、非法参数在数据库前拒绝及存量服务目录。当前证据为 SQL mock；真实 MySQL 分页测试、页面服务端筛选／排序和分页控件尚未完成，不视为列表分页交付完成。未部署。

### 2026-09-09 — 产品列表筛选排序与分页接线

产品主档列表请求 page/pageSize、product_line、status、sortBy/sortOrder；排序列由 Runtime 固定白名单映射，并加 id 消除同值排序歧义。前端产品分支取消当前页二次筛选和排序，搜索／筛选／排序变化重置第一页，新增分页与空状态，产品统计读取服务端 total。技术底座分支保持原逻辑，尚未分页。

隔离 MySQL 按规范 DDL 验证两页及空页总数、产品线过滤、负责人和项目范围排除、编码顺序；首次测试 fixture 缺少规范必填客户域／业务域，补齐 fixture 后通过。相关 Go 回归、页面 ESLint、Assets typecheck 通过。实际页面组件配隔离 Nuxt 及模拟 API，在 1440/390 Chrome 验证翻第二页、搜索回第一页；无 pageerror，截图已检查。预览壳重叠已在预览中修复。该证据不替代完整应用壳、真实租户及跨应用授权验收，未部署。

### 2026-09-09 — 产品列表失败恢复与持久浏览器回归

产品／底座列表读取失败时显示明确错误和当前标签重试，保留搜索筛选；失败时不显示空状态、当前列表条数和产品分页，任一数据源出错时隐藏组合汇总，避免把服务故障呈现成零产品。

页面 ESLint、Assets typecheck 通过。1440/390 Chrome 实际组件模拟 503 后重试成功且搜索保留；同时回归翻页及搜索回第一页。浏览器脚本已保存 assets/test/integration/product_list_browser.cjs，并记录隔离预览前置；真实租户／应用壳及底座分页仍待完成，未部署。

### 2026-09-09 — AC-09 转交全阶段回滚补强

对照正式 AC 矩阵发现真实项目转交测试此前只注入审计失败。现 TestMySQLProductHandoffRuntimeCreatesActualProjectDraft 逐一在 requirement_items、requirement_contents、requirement_item_contents、product_request_delivery_links、product_activity_logs、product_command_receipts 六个 INSERT 点注入数据库故障，每次核对六表均保持原计数，随后成功转交及幂等重试沿用原测试验证。

本轮实际执行暴露测试夹具未安装 v5.36 反馈绑定迁移，使其后续版本编辑步骤报 product_schema_unavailable；夹具补齐迁移后整条 Runtime 集成测试通过。另以隔离 socket 执行 productcenter Go 包完整回归通过（54.848 秒）。上述不证明真实 JWT／五角色试点。已向用户请求目标测试租户、两产品、经理／独立发布者及项目，等待业务输入期间仍可推进独立实现与测试；未部署。

### 2026-09-09 — AC-13 同键并发发布与授权失效重放

既有验收／发布 MySQL 流程改为两个请求携带同一发布前授权快照和幂等键并发启动。实测提交者会使另一请求授权快照失效；测试只允许精确 product_authorization_changed，再获取新授权重试，断言相同 receipt、仅一次非重放结果、仅一条发布记录；后续原有断言继续验证反馈 outbox 仅一条、发布证据与更正历史。生产授权逻辑未放宽。

定向 TestMySQLProductVersionAcceptanceImmutable 通过。AC-13 的不同键双发布、发布与新增范围／工作项换版本并发仍需独立证据，不能将本测试视为完整 AC-13 验收。未部署。

### 2026-09-09 — AC-13 不同键双发布

验收／发布真实 MySQL 流程现分别运行 same-key 和 different-keys 两个隔离场景。不同键场景要求恰好一个首次发布成功，另一请求因旧授权快照拒绝；重新授权后仍以旧预期 revision 被拒绝，不新增发布记录。成功键后续重放返回原 receipt；两种场景均继续验证单条发布、单条反馈 outbox、验收与发布证据、更正历史。定向两场景测试通过（1.444 秒）。

AC-13 发布与范围新增／工作项换版本并发仍未完成，本轮只关闭不同键双发布证据缺口；未部署。

### 2026-09-09 — 旧项目移除工作项发布锁修复

审阅发现 detachVersionItem 在项目读取授权后直接 UPDATE，未检查发布状态。现进入事务先锁定 product_versions 根记录，仅 planning/developing 可移除；工作项解除与版本 revision/scope_revision 递增同事务，使已有验收失效。已发布／归档拒绝，修订写入失败回滚。SQL mock 定向测试覆盖这些分支通过。该入口仍保留原项目授权；真实 MySQL 发布竞争及其他 attach/通用换版本入口待补，不能视为完整 AC-13。未部署。

### 2026-09-09 — 移除版本工作项真实事务验证

扩展实际 Runtime 集成测试，使用规范 work_items DDL 插入目标工作项，验证 released／archived 状态不能移除；开发中通过 product_versions 更新触发器注入修订失败，确认 version_id 关联仍保留；移除故障后解除成功，revision 和 scope_revision 各增加一次。完整 TestMySQLProductHandoffRuntimeCreatesActualProjectDraft 通过（1.006 秒），临时数据库自动清理。

上述调用实际移除事务 helper，尚不证明 HTTP 用户授权或发布竞争的两个锁获取顺序；attach 和通用换版本入口仍待统一加固。未部署。

### 2026-09-09 — 批量关联工作项原／目标版本锁

attachVersionItems 保留既有项目与目标可见性校验，写入改为专用事务：发现原版本，按 id 顺序锁定所有原／目标版本并重验可编辑状态，目标特性在锁内核对所属版本，再锁定工作项确认原关联未变化；有竞争变化返回 work_item_version_changed。关联和所有受影响版本 revision/scope_revision 递增同事务；重复工作项 ID 去重。

真实隔离 MySQL 验证已发布原版本不能移走、已发布目标不能接收、修订故障回滚、重复 ID 只处理一次，以及成功后原／目标各递增一次；完整 Runtime 集成测试通过（1.058 秒）。仍缺通用 work-items PATCH 换版本路径加固、真实发布竞争及完整权限验收；未部署。

### 2026-09-09 — 通用工作项换版本事务校验

prepareWorkItemVersionFieldsUpdate 的解除／改派分支现调用同一事务 helper：按序锁定原／目标版本并校验规划／开发状态，锁内重验原关联，目标特性校验所属版本，最后写关联并递增受影响版本修订。核对 ResourceSpec 已有 version_id/feature_id WriteDenyColumns，通用更新不会提前改这两列；因此撤回临时的重复 body 过滤，保留现有兼容更新器。

真实 MySQL 模拟通用字段更新与该 hook 同事务，验证已发布原版本不可解除、原关联过期拒绝、失败回滚同时修改的标题、有效解除与标题一起提交；与实际 Runtime 既有集成流程通过（1.053 秒）。完整 HTTP 路由及与发布的锁竞争仍待验收；未部署。

### 2026-09-09 — 三个版本关联入口联合回归

在当前工作树执行 HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.5lV20A/mysql.sock go test ./internal/apps/aims -count=1，完整 AIMS 包通过（5.963 秒）。此轮覆盖最近 detach、attach、通用 work-item version hook 改动后的包级回归；不重跑未变化的 productcenter 子包。

下一交付重点仍是 AC-13 发布与新增范围／工作项换版本的真实竞争、AC-16 真实 Token 传输以及 PC-12 两产品／五角色试点。上述包级通过不替代这些尚缺证据，目标保持进行中，未部署。

### 2026-09-09 — 发布与工作项关联真实竞争

新增 TestMySQLPublicationCompetesWithWorkItemAttachment，复用完整规划、评估、转交、版本范围及验收准备，在独立 MySQL 使用多个连接、同一启动门并发调用实际 Runtime 发布入口与实际批量关联事务。断言恰好一方成功；发布失败必须为 product_version_revision_conflict，关联失败必须为 version_not_editable；最终发布记录数、版本状态与工作项归属必须对应唯一成功方。

与原完整 Runtime 流程联合运行通过（1.692 秒）；加入精确失败码断言后竞争用例通过（0.976 秒）。本测试按调度实际获胜方判断，不宣称强制覆盖两个锁获取顺序。新增范围竞争、通用 PATCH／detach 竞争及真实租户完整授权仍待验收；未部署。

### 2026-09-09 — 发布与通用版本编辑 hook 竞争

新增 TestMySQLPublicationCompetesWithWorkItemVersionPatch，复用实际发布 Runtime 与真实数据库，另一连接先执行普通标题 UPDATE，再执行实际 updateWorkItemVersionTx 并提交，与兼容更新器的先普通字段、后 hook 顺序一致。要求恰好一个成功、精确失败码、发布记录／状态／关联一致，普通标题也随编辑成功提交或失败回滚。

attach/patch 两个竞争用例联合通过（1.609 秒）；加入普通字段原子性验证后 patch 用例通过（1.001 秒）。这仍是实际 hook 的事务竞争，不替代 HTTP PATCH 路由授权；调度未强制两个锁顺序，新增范围竞争和真实租户试点未完成。未部署。

### 2026-09-09 — 发布与新增范围真实竞争

新增 TestMySQLPublicationCompetesWithNewScope：在首次验收前将已交付范围准备为未映射规划事项的历史 fixture，已有选中规划事项用于新增范围；实际 Runtime 发布与实际 CreateProductVersionScope 在多连接下同时启动。仅一方成功，另一方必须精确 product_authorization_changed；按获胜方验证范围 1/2 条、发布记录 1/0 条及版本状态一致。定向 MySQL 测试通过（1.023 秒）。

本轮未强制调度两个锁获取顺序，测试 fixture 身份由领域测试准备，不等于真实导入演练；完整 HTTP 授权、旧入口交互及两产品真实试点仍待完成。未部署。

### 2026-09-09 — 项目版本页关联交互保护

旧项目 releases 页已发布／归档状态隐藏挂接目标入口；打开／提交均复查状态，提交冻结版本和工作项数组，防止重复请求，忙时禁改字段／关闭弹窗，失败内联保留选择。成功回执核对目标版本，刷新时不覆盖已切换的详情；读取候选失败提供反馈。实际函数 VM 测试验证重复提交、错版本回执和不可编辑状态保护，页面／测试 ESLint 与 AIMS typecheck 通过。完整页面 1440/390 浏览器验收尚未完成。

类型检查发现此前 Assets 隔离预览经 utils 目录符号链接在 aims/app/utils 留下 productAssets.ts 链接；确认是本任务创建后移除，将预览 utils 改为独立目录内逐文件链接，避免再次污染源码。无业务文件删除，未部署。

### 2026-09-09 — 项目版本关联回执与重试交互

关联成功回执增加 attached 数量核对，必须与本次去重目标数一致。实际 attachItems 函数测试扩展服务故障保留选择、重试、请求参数冻结，以及请求中切换版本后不打开错误详情；两项测试和页面／测试 ESLint 通过。完整页面浏览器验收仍待完成，本轮未部署。

### 2026-09-09 — 旧项目版本页浏览器回归

实际 releases.vue 页面在隔离 Nuxt 中，以模拟项目 Store/API 验证 1440/390 Chrome：已发布不显示挂接、开发中可选目标、503 保留选择并内联提示、重试成功关闭。无 pageerror，桌面／手机错误状态截图已检查，无弹窗溢出重叠。脚本保存 aims/test/integration/project_release_browser.cjs，预览前置记录 README。真实 Console 会话／Shell／业务服务链路仍未验收，未部署。

### 2026-09-09 — 项目版本详情响应竞态

openRelease 增加递增请求标识；快速切换版本后旧请求不得覆盖新详情、提前结束新请求 loading 或弹出旧错误。执行实际函数的测试控制两次响应顺序，验证旧响应不覆盖且 loading 等待最新响应；与关联交互共三项测试及 ESLint 通过。本轮为局部请求竞态修复，真实租户验收仍待完成，未部署。

### 2026-09-09 — 版本写入部署结构检查

新增只读 product_version_write_postflight.sql，检查版本 revision/scope_revision、工作项及特性关联列类型／可空性和六张相关表的 InnoDB 引擎；只返回不满足的结构标识，不读取业务明细。实施计划发布步骤已链接并说明空结果门槛及证据范围。

完整 Runtime MySQL 夹具执行正常结构结果为空，再仅在临时库删除 scope_revision，确认返回一项问题；定向测试通过（1.073 秒），临时库清理。未在业务库执行，不等于生产迁移验收；未部署。

### 2026-09-09 — 发布竞争 Go race 检查

以隔离 MySQL 执行 go test -race ./internal/apps/aims ./internal/apps/aims/productcenter -run 'TestMySQLPublicationCompetes|TestMySQLProductVersionAcceptanceImmutable' -count=1，两包通过（3.801／3.086 秒）。覆盖同键／不同键双发布，以及发布与批量关联、通用版本编辑 hook、新增范围竞争；未发现 Go 共享内存数据竞争。该检查不强制全部数据库锁调度，也不替代真实 JWT／租户验收，未部署。

### 2026-09-09 — 产品反馈合并链重复查询优化

产品版本变更批量刷新反馈时，新增单个 workspace-locked 事务内的合并节点缓存，多条原始需求共用上游节点只查询一次；缓存不跨产品／事务存活，不缓存授权。仍按每条来源遍历并验证 64 节点上限、环路及 merged 状态与引用一致性，不通过路径压缩绕过深度约束。

SQL mock 精确验证共享上游不再重复查询，缓存全命中时仍验证环路／深度／状态；反馈真实 MySQL 及验收／发布回归通过（3.797 秒）。大规模负载时间／内存及真实 worker 联调仍未完成，未部署。

### 2026-09-09 — 千条合并反馈刷新验证

SQL mock 验证 1000 条来源共享一个规范节点时只执行 1001 次节点 SELECT（原逐链为 2000 次），缓存大小为 1001，边界检查回归通过。新增真实隔离 MySQL 测试创建 1000 条正式绑定来源，持 workspace 锁刷新 outbox，核对 1000 个原始 requestBizId、同一 canonicalRequestBizId、1000 个空公开版本快照，未遗漏来源。

本机单次刷新加聚合核对约 215.65ms，整项测试 0.92 秒；该样本无公开版本、单一合并族，不是生产 SLA 或多族／多版本性能结论。真实 worker 联调仍未完成，未部署。

### 2026-09-09 — 千条反馈含公开版本负载

批量 MySQL 测试增加 20 个公开版本及一个仅内部范围的版本，同族三条需求关联相同长期功能。1000 条来源各有 20 个公开版本快照；全体版本快照一致，内部标题标记不透传，内部版本排除，同一特性不会因多需求链接重复计数，公开／已交付数均为 1。

空快照与公开版本两样本均通过；本机公开版本样本刷新及核对约 480.82ms（整项 1.19 秒），不作为生产 SLA。多合并族、长链与真实 worker 仍需验证，未部署。

### 2026-09-09 — 经营结果合同状态收敛

核对现有 AIMS cost/cost-rules/adoption 页面、productCost 调用端和 Finance snapshot/view 后，修正采用与经营合同中仍将已接入服务／页面标记为待实现的历史描述。新增当前交付边界：已有规则与成本读取链路复用；缺币种来源保持未就绪；收入明确 revenue_attribution_not_configured；真实租户迁移、grants、Token、后台投递仍待验收。本轮仅文档事实收敛，无运行功能变更，未部署。

### 2026-09-09 — 非人工分摊币种存储扩展

Finance canonical project_cost_allocation 新增可空 currency_code，提供幂等扩展迁移，不设置默认币种、不回填历史。实际隔离 MySQL 按规范建表后模拟旧结构，迁移两次，历史金额 12.34 保持不变且币种仍 NULL；与规则并发／读取回归通过（0.423 秒）。尚未接入通用分摊写入、产品成本来源解析和 UI，不能视为非人工成本已就绪；未迁移业务库、未部署。

### 2026-09-09 — 分摊币种写入验证

通用 UpsertProjectCostAllocation 已保存明确提交的三位大写 currencyCode/currency_code；空值或省略在完整 upsert 中保存 NULL，不默认人民币。非法格式在 SQL 写入前拒绝。实际隔离 MySQL 验证 USD 保存、非法输入不改变原金额与币种、再次完整提交省略币种后保存 NULL；输入校验与归属规则／迁移回归联合通过（0.427 秒）。读取使用 SELECT *，包含已保存字段；产品成本来源解析及 UI 尚未接入，不能据此标记非人工分摊成本就绪。未迁移业务库、未部署。

### 2026-09-09 — 非人工分摊进入产品成本计算

产品成本快照读取明确的 allocation.currency_code；asset/shared_expense/other 使用逐条币种，历史未知仍未就绪。托管人工继续要求来源快照一致，台账币种不能绕过或冲突于来源证据。币种作为来源内容修订的一部分，修改币种会改变 SourceRevision。修复 nullable source_refs_json 扫描为 RawMessage 时的真实数据库错误，允许无人工来源 JSON 的非人工台账读取。

测试覆盖三类非人工成本按币种分开分摊、币种更正修订变化、缺币种不输出金额，以及人工来源不能被显式币种绕过；实际隔离 MySQL 验证保存后可经产品快照解析到 USD。Finance 包整体通过（0.400 秒，含配置的隔离 MySQL 用例）。合同与发布步骤已更新列依赖。页面输入和真实环境联调未完成，未迁移业务库、未部署。

### 2026-09-09 — 分摊页面币种录入

Finance 现有项目成本分摊配置增加 currencyCode 文本录入和 currency_code 列，提示三位大写代码及未知留空后产品成本未就绪。复用现有动态表单、原样构造 POST body 和服务端校验，不设置默认币种。检查确认银行余额页的 CNY 默认值仅在该页面分支执行，不影响分摊录入。配置 ESLint 通过；本轮为现有组件字段配置变更，未执行完整浏览器／真实会话验收。尚未部署。

同时补齐 Runtime 分摊列表的 Select 白名单 currency_code，确保表格列能收到该字段。Finance Go 包测试通过（本次未配置 MySQL socket，数据库用例的证据沿用上一轮，不能视为本轮重新执行）。

### 2026-09-09 — 分摊列表实际读取与收入来源核对

隔离 MySQL 用例扩展实际 ListResource 调用，按已登记 project-cost-allocations spec 搜索刚保存的分摊，验证 total=1 且 currency_code=USD；与币种写入／快照读取联合通过（0.421 秒）。这证明 Runtime 列表返回字段，不替代浏览器或真实 JWT 验收。

核对 Finance canonical schema 与 Finance PRD／设计文档：当前存在到账、开票和 finance_unclassified_income（received_at/amount），未找到正式收入确认台账。PC18 合同禁止用这些金额直接替代产品收入。已向用户询问本期是否新增 Finance 收入确认台账，或先交付成本／采用并保留收入未就绪；问题待答复，不改变完整目标或将收入标记完成。

### 2026-09-09 — 托管人工同步币种一致性

标准人工成本同步使用同一产品成本来源解析器验证项目、月份、员工和 People／Finance 快照币种，并在原事务内写入 allocation.currency_code。证据缺失／冲突保存 NULL；重新同步同样覆盖该列，避免旧币种残留。未改变原项目 readiness 合同，产品结果仍独立校验证据。

扩展原原子同步测试为 missing/verified/conflicting 三种来源，精确校验 allocation SQL 的币种参数分别为 NULL/CNY/NULL，同时保留整组同步提交及失败回滚测试；定向 Go 测试通过（0.280 秒）。这属于 SQL mock 事务验证，本轮未运行真实人工同步数据库测试或真实租户同步。未部署。

### 2026-09-09 — 分摊币种纳入运行时结构检查

Finance SchemaStatus 的 requiredColumns 加入 project_cost_allocation.currency_code，旧结构会明确报告 schema_mismatch 和缺列标识。隔离 MySQL 验证迁移后的列被检查且不报缺失，再仅在临时库删除该列，验证准确报缺失；定向测试通过（0.435 秒）。发布计划记录人工同步同样依赖此迁移。未执行业务库结构检查或迁移，不能据此宣称部署就绪。

### 2026-09-09 — Finance 分摊表单浏览器检查

实际 FinanceEntityFormSlideover 与 allocations page config 在隔离 Nuxt 中通过 1440/390 Chrome：币种初始为空、模拟提交失败保留输入、更正 USD 后提交携带金额和币种。两尺寸无 pageerror，已检查截图，无表单溢出。脚本与 fixture 保存在 finance/test/integration，README 记录复现前提。提交由预览桩处理，不验证真实 Finance POST、服务端错误文案、登录或授权；真实会话验收仍待完成。未部署。

### 2026-09-09 — 调序成功回执校验

核对 PlanningQueueMoveForm 与实际 MovePlanningQueue 返回合同后，补齐成功回执校验：要求有效 receipt_id/replayed、目标周期一致；changed=true 时产品／周期／队列三方修订均加一，changed=false 时保持原修订。空 code=0 或错误周期／修订不再触发成功导航，沿用原错误保留与同 payload 幂等重试。

两项测试覆盖实际形状的变更／无变化／重放结果，以及空成功、错周期和修订漂移，均通过；涉及文件 ESLint 通过。键盘完整调序与发布确认仍需浏览器验证，本轮不能视为 AC19/26 完成。未部署。

### 2026-09-09 — 实际调序页面全键盘验证

新增 product_queue_keyboard_browser.cjs，在实际 move 页面与 Foundation 确认弹窗中，仅以 Tab/Enter/键盘输入完成选目标、填理由、预览、确认；模拟首次 POST 503 后选择／理由保留，再次确认使用相同 payload 和幂等键，有效回执后导航。1440/390 Chrome 均通过、无 pageerror，稳定弹窗截图已查看，确认按钮焦点可见且无溢出。

API 为模拟响应，本轮覆盖单页目标，不替代真实 JWT、跨页目标与发布确认的键盘验收；AC19/26仍未整体完成。复现说明见 aims/test/integration/README.md。未部署。

### 2026-09-09 — 全键盘跨页目标保留

调序浏览器夹具扩为11个事项，使用实际分页 Next Page/Previous Page 控件，以键盘到第二页选择 I11，再回第一页核对已选摘要；两次正式提交均核对 beforeId=I11、payload和幂等键一致，首次503后保留选择与理由。1440/390均通过，无pageerror。最初测试误用未渲染的页码按钮，核对DOM后改用实际可访问名称；没有修改业务分页行为。此为模拟API下的跨页键盘证据，真实权限和发布确认仍待验收。

### 2026-09-09 — 发布确认全键盘验证

实际 VersionPublisher 与 Foundation 确认弹窗在1440/390隔离Chrome中，以Tab/输入/Space/Enter完成打开发布、填写原因、勾选核验、两次确认；模拟首次503后理由保留，第二次使用原payload及幂等键，合法回执后显示发布成功。无pageerror，已查看两尺寸稳定截图，焦点可见、弹窗无溢出。

脚本 product_publish_keyboard_browser.cjs 和 README 保存复现条件。该证据为实际组件和模拟API，不验证父验收详情页加载、真实发布或JWT权限。完整AC19及真实角色验收仍不能标记全部完成，未部署。

### 2026-09-09 — 路线窗口键盘清空与失败提示

实际探索时间窗口页在1440/390以键盘清空日期、填写原因并确认；模拟首次503后理由保留，第二次相同payload/key保存，刷新后两日期为空且理由重置。补充保存错误 UAlert 的 role=alert，浏览器验证失败提示可通过告警语义定位。两尺寸通过，无pageerror，稳定确认弹窗截图已查看，焦点可见无溢出；页面ESLint通过。

脚本 product_roadmap_keyboard_browser.cjs 已保存。只覆盖清空日期的操作路径，未验证键盘日期输入、真实权限／数据库写入，不将AC19整体标完成。未部署。

### 2026-09-09 — 优先级事务及调序回执对照

扩展实际 MySQL PlanningAssessmentAtomicity，用真实 CommandResult 核对调序首次提交、重放、无需变化三种回执：周期身份一致，有效回执ID，changed与三方修订增量匹配。与原用例中的评估、容量分类变化、错误权限、队列冲突、审计失败回滚、依赖顺序拒绝及202项矩阵截断联合通过（0.970秒）。这为新增前端调序回执校验提供实际数据库合同证据。

用例中身份和部分场景状态由夹具准备，不等于真实JWT/BFF或完整用户操作链；目标环境和试点仍待验收，未部署。

### 2026-09-09 — AIMS／Finance 类型集成检查

近期币种配置、调序回执 helper、路线窗口告警语义修改后，AIMS 与 Finance 分别执行 pnpm run typecheck，均退出0；相关改动 git diff --check 通过。运行环境 Node25.2.1 不在仓库声明的 >=24.18.0 <25 范围，pnpm 有 engine 警告，本次结果不能替代正式构建环境验收。没有扩大重跑数据库或浏览器已通过用例，未部署。

### 2026-09-09 — 声明支持的 Node 24 类型检查

发现工作区已有 /Users/gavinzhou/.nvm/versions/node/v24.18.0/bin/node，应用目录 shell 的实际 Node 为25.2.1。显式将 Node24.18.0 目录置于本次命令 PATH 前端，确认 node --version 后分别运行 AIMS／Finance pnpm run typecheck；两项均退出0，无先前engine警告。没有改动用户shell或项目配置。这消除上一轮类型检查的Node版本偏差，仍不替代真实部署／构建与业务验收。

### 2026-09-09 — 分摊原项目与目标项目双向授权

发现通用分摊 upsert 只校验提交项目，已知其他项目 code 时可能覆盖原记录。改为 RepeatableRead 事务中按唯一 code SELECT FOR UPDATE，原记录存在时校验其项目授权；目标项目仍先校验。写入、读取回执及提交在同一事务，失败回滚，避免校验后更换归属。

Finance包回归通过（0.479秒，配置隔离MySQL）；新增真实数据库场景分别验证仅目标授权拒绝接管且原项目／金额／币种不变、仅原项目授权拒绝迁入未授权目标、同时授权两项目可完整更正。并发锁调度和真实JWT入口仍待专项验收，不宣称其已完成。未部署。

### 2026-09-09 — 自动人工来源防止手工覆盖

通用分摊写入拒绝提交托管人工 source/rule 标识（大小写不敏感），并在原记录锁内拒绝覆盖已有托管人工，即使提交时省略来源字段或原记录已反转。返回 managed_labor_sync_required，自动人工继续走原整组同步事务。

隔离MySQL验证手工覆盖被拒绝且原金额／reversed状态保持，冒用来源不会插入新记录；Finance包整体通过（0.462秒）。未验证真实JWT入口，未部署。

### 2026-09-09 — 分摊归属并发变更授权

真实隔离MySQL中，事务先将分摊从P2更正到P3并持锁，另一连接以仅P1/P2授权提交更新。通过测试库PROCESSLIST确认实际SELECT FOR UPDATE已发起，再提交归属更正；等待的更新必须精确403 finance_project_access_denied，最终P3归属、EUR和99.99保持。

最初依赖INNODB_TRX LOCK WAIT的观测不稳定，该实例把查询显示为statistics；调整为观测在途锁定读取后，连续三次通过（整组0.648秒）。不据此声称覆盖所有锁调度、真实JWT撤销或租户联调。未部署。

## 2026-09-10：统一产品目录与管理入口

- 产品中心默认展示全部有权查看的产品，合并生效目录与已有空间，区分未启用／已启用／已归档；未启用项不跳转不存在的空间。启用后同一产品只有一行，历史缺失主档的空间仍保留。
- SQL 在同一只读快照完成权限、筛选、计数与分页；未启用产品按非成员查看范围判定，不放大产品成员／经理范围。未增加权限或角色隐式授权。
- 行内“启用产品管理”打开弹窗，要求选择真实初始产品经理并填写原因，复用原接入接口的实时主档核验、权限与幂等机制。产品接入设置页继续复用此组件。
- 同步入口收纳为弹窗；启动后自动推进至完成，每次操作自动续取最多 10 页，失败停止并保留批次供恢复，不自动无限重试。目录生效后自动刷新产品中心。
- 验证：真实隔离 MySQL 覆盖 105 个目录项与历史空间合并、去重、跨页、三种状态、关键词／产品线、全局与具体编码范围、成员范围隔离；原列表授权测试继续通过。Aims Go 两包、12 项相关 Node 测试、页面 ESLint、Nuxt 类型检查和 Cloudflare 构建／dry-run 通过。测试环境发布与登录后视觉验收见部署记录。

### 产品列表滚动修复

产品列表页作为 LayoutSidebar 的 flex 子项，必须通过 min-h-0 / flex-1 / overflow-y-auto 限制高度并承担滚动。此前父布局 overflow-hidden、页面自然高度超过视口，导致下方产品及分页被裁切。已在页面根容器修复；不改变共享布局或其他页面滚动行为。

### 产品全部子路由统一滚动

将滚动容器提升到 `app/pages/products.vue`，通过 NuxtPage 统一承载列表、产品详情及规划／功能／版本等子路由；移除列表自身的重复滚动容器。产品子页面不再依赖单页补丁，继续保留现有页面元数据、内容宽度与局部横向滚动。

## 2026-09-10：产品工作台按三个工作视角重排页签

### 信息架构

产品详情此前把十余个功能入口以同等权重平铺在概览页按钮墙上，用户无法按岗位判断该看什么。现按岗位关注点重排为一级「工作视角」+ 二级入口：

| 工作视角 | 主要面向人员 | 二级入口 |
| --- | --- | --- |
| 概览 | 全部相关岗位 | 产品定位、关键计数、三个视角的入口卡片 |
| 产品与研发 | 产品负责人、研发负责人 | 功能目录、产品模块、需求池、规划事项、规划周期、产品版本、关联项目；更多：功能版本矩阵、发布范围对比、路线图视图、评分模型 |
| 销售与交付 | 销售、售前、项目经理、服务人员 | 客户采用、已发布能力、版本发布、版本差异、产品资料 |
| 经营与管理 | 企业负责人、业务负责人 | 产品目标、经营结果、成本分摊规则、客户覆盖 |
| 设置 | 产品负责人、产品总监 | 产品信息维护、空间归档／恢复、产品成员 |

视角是岗位视图而不是目录树，因此版本、功能版本矩阵、发布范围对比、客户采用被多个视角复用。归属视角按 `app/config/productNavigation.ts` 的声明顺序确定；跨视角进入时链接带 `view=<视角>`，一级高亮保持来源视角，过期或伪造的 `view` 回落到归属视角。用户级筛选／分页 query 与 `view` 共存，`useListPage` 同步 URL 时保留该参数。

销售与交付视角的「可售规格、客户权益、续费」和经营与管理视角的「销售、客户、风险」在 Aims 内没有事实源（分别归 Altoc 与 Finance），本轮没有为它们制造页面或占位数据；视角摘要只描述当前真实可见的内容。

### 页面结构

- 新增 `app/pages/products/[productCode].vue` 作为产品工作台外壳：固定产品身份栏与两级导航，内容区独立滚动；参考 `ProjectNavbar` 的产品切换器、编码／状态标识与页签高亮方式。
- 概览页改为项目概览同款结构：关键计数卡片（功能、版本、需求待评估、采用客户）→ 三张工作视角卡片（面向岗位、优先呈现、计数、快捷入口）→ 产品定位只读区。计数按入口分别读取列表接口 total，单个入口无权限或失败显示「—」，不用 0 冒充未知，也不阻塞整页。
- 新增 `app/pages/products/[productCode]/settings.vue`，承接原概览页的产品信息编辑、归档／恢复与成员管理；概览页只做只读呈现。
- 移除十三个已成为页签的产品页面上的「返回产品／返回产品版本」按钮；对象详情页（目标详情、规划事项详情等）保留返回上一级。`cost.vue`、`cost-rules.vue` 补齐与其他产品页一致的 `p-4 sm:p-6` 内边距。
- 滚动容器随之下移：`products.vue` 只做布局容器，列表页与产品工作台内容区各自承担滚动，使两级导航在滚动时保持固定。这修正了上一轮「统一在 products.vue 承担滚动」的做法。

### Runtime 变更

`ReadWorkspace` 返回 `WorkspaceDetail`，在原有空间字段外附加只读 `product_name` / `product_line` / `product_line_label`，取自当前 `status='active'` 的目录代次投影。没有生效代次、或产品不在该代次时三个字段为 null，页面回落显示产品编码，不臆造名称；写路径 `loadWorkspace` 与 `ChangeWorkspace` 未变更。Assets 仍是产品主档事实源。

### 验证

- `go test ./internal/apps/aims/...` 通过；隔离 MySQL（`HZY_PRODUCT_CENTER_TEST_SOCKET`）下新增 `TestMySQLWorkspaceReadCarriesCatalogIdentity` 通过，覆盖目录刷新前为 null、刷新后取到名称与产品线、未进目录的产品保持 null，且空间 revision／status 不受 join 影响。
- 新增 `aims/test/productWorkspaceNavigation.test.ts`（8 项）覆盖视角划分、岗位与呈现内容声明、入口对应真实页面文件、跨视角归属与 `view` 参数、子路由高亮、`cost` 与 `cost-rules` 前缀不互相吞掉、产品编码编码，以及概览页不再保留按钮墙与成员／归档区块。
- 新增 `aims/test/integration/product_workspace_browser.cjs`：隔离 Nuxt 预览挂载仓库实际外壳、导航栏、概览页与设置页，模拟全部 `/api/v1` 响应，在 1440／390 视口验证一级视角、二级入口、更多下拉、跨视角 `view` 高亮、产品切换器、设置页归位，并断言两个视口都无横向溢出、无 pageerror。截图已查看。该证据不覆盖真实 Console 会话、租户授权与后端契约。
- 本机 Console dev 无法完成 OIDC authorize（`console/.env.dev` 未配置 Console 自身 `HZY_SERVICE_CLIENT_ID` / `HZY_SERVICE_CLIENT_SECRET`，日志为 `Console service client is not configured`），因此没有在真实登录态下走通产品工作台；相关验收待测试环境发布。未部署。

### 产品采用 403 归类与可执行提示

测试环境报告 `GET /aims/api/v1/products/HZ-TY-S-002/roadmaps/adoption` 返回 403，并伴随 `/aims/api/auth/permissions` 503。核对代码后确认 403 不可能来自 AIMS 产品权限：`requireProductPermission` 对 `view` 动作在无权限时返回 404「产品不存在或不可见」，只有非 view 动作才返回 403。403 只能来自下游 —— Assets 的三个 403 出口，或 Console 服务令牌签发失败被原样透出。

原实现把这几种失败混在一起：Assets 的对象范围拒绝、服务身份/签名拒绝，以及 `requestServiceAccessToken` 抛出的 Console 状态码与诊断串，都会以原状态码到达浏览器。结果是服务授权漂移会显示成「访问权限不足」，把排查引向给用户加权限；而 Console 诊断串外泄也违反不得向调用方泄露内部诊断的约定。

本轮变更：

- Assets 三个 403 出口补稳定 `data.reason`：`assets_object_scope_denied`、`product_adoption_service_identity_invalid`、`product_adoption_command_invalid`。
- 新增 `aims/server/utils/productAdoptionFailure.ts` 做归类。只有 `assets_object_scope_denied` 保持 403 并给出「补 Assets `deliveries:view` / `environments:view` 及数据范围」的可执行说明；其余 401/403、令牌签发失败、无效响应统一为 503，不带 Console 诊断串。令牌失败在服务端记录状态码。
- `adoption.vue` 仅在该 reason 下展示补权提示，其余失败沿用通用告警。
- 顺带把 `productCrossDependencyInput.ts` 的 `./productWorkspaceInput` 补成 `.ts` 后缀（仓库内已有同款写法），使相关 Node 用例可以实际运行。

验证：新增 `test/productAdoptionFailure.test.ts`（8 项）覆盖四类归类、两种错误体形状、Assets 三处 reason 与页面判定；扩展 `test/productAdoptionAssets.test.ts`，在真实 `readProductAdoptionFromAssets` 上新增 `scope-denied` / `service-rejected` / `token-failure` 三种模式，断言状态码、reason、调用序列，以及令牌失败不外泄 `insufficient_scope`。补后缀后该用例可实际执行并通过；AIMS 全量 `node --test` 失败文件数由 134 降到 126，无新增失败。隔离预览的 1440／390 浏览器回归增加两段断言：缺范围时出现指名 `deliveries:view` 的提示，服务侧 503 时该提示不得出现；截图已查看。AIMS 与 Assets typecheck、相关 ESLint 通过。

未验证：真实租户下这条链路究竟落在哪一类失败，仍需线上响应体确认；`assets:product-adoption:read` 的真实令牌签发探测与端到端验收未完成。`/api/auth/permissions` 的 503 属于 Console 授权快照不可用，与本次归类无关，尚未定位。未部署。

### 产品与研发视角示例内容

为让三视角工作台能用真实语料评估，新增汇智云（HZ-TY-S-002）产品与研发视角的示例内容与投递脚本。内容取自本仓库的平台分层、模块契约和在办事项，不虚构外部客户或业务数据。

- `scripts/product-center-demo-content.mjs` 只描述写什么：4 个根模块 + 17 个子模块（对应控制面、企业基础运行时、业务应用、共享层与运行时）、38 条功能、10 条需求、7 条规划事项、2 个季度周期、4 个产品版本。
- `scripts/seed_product_center_demo.mjs` 负责写入，注册为 `pnpm --dir aims seed:product-center-demo`。三种模式：不带 cookie 时离线打印内容清单；带 `--base-url` 与 `--cookie-file` 时联网 dry-run；再加 `--apply` 才写入。
- 写入全部走浏览器同款用户 API，不直连数据库、不签发服务令牌、不绕过任何鉴权：授权、数据范围、workspace revision 与幂等键都由服务端按既有规则判定，脚本能写成功即说明该账号本来就有对应权限。每次写入前重新读取所在资源的 permissions 取当前 revision；每条示例使用稳定幂等键，并先按名称／编码跳过已存在项，可重复执行。
- 模块与功能分两轮处理：先补齐缺失项，再用创建后的最新列表建立父子关系和功能归属，避免同一次执行里父模块 id 未知。功能归属只对当前未归属的条目执行，不改动已有归属。
- 「关联项目」页签是按版本聚合的执行视图，由真实项目与工作项派生，脚本不写入也无法伪造。产品版本新建后处于规划中状态，验收与发布仍走各自命令。

验证：新增 `test/productCenterDemoContent.test.ts`（7 项），用服务端真实校验器（`productComponentWriteInput`、`productFeatureCreateInput`、`productFeatureComponentInput`、`productRequestCreateInput`、`productPlanningCreateInput`、`productPlanningCycleCreateInput`、`productVersionCreateInput`）逐条校验全部示例，并检查模块引用存在、名称与版本编码唯一、周期区间不重叠、计划发布日期递增、缺省不产生 businessOwnerUid。离线模式实际执行并核对输出。为让这些校验器可被 Node 测试加载，补齐了 `productComponentInput.ts`、`productVersionInput.ts`、`productFeatureInput.ts` 中 4 处相对导入的 `.ts` 后缀（仓库内已有同款写法）；AIMS 全量 `node --test` 失败文件数保持 126，无新增失败。ESLint 与 typecheck 通过。

未验证：API 版本脚本的联网 dry-run 与 `--apply` 需要真实登录会话，本轮没有执行。

### 受控环境直写旁路（已在本机测试库执行）

按要求增加 `scripts/seed_product_center_demo_sql.mjs`，复用同一份内容直接写 AIMS 数据库，注册为 `pnpm --dir aims seed:product-center-demo-sql`，默认 dry-run（在事务内执行后回滚），`--apply` 才提交。连接信息取本机 Runtime 配置，脚本拒绝非回环地址，也不打印口令。

这条路径的代价必须记清楚：不产生命令回执，因此这些数据没有操作留痕；不经过 Console 授权判定；只写展示所需最小列。它是受控测试环境的铺数手段，不是在线业务路径，生产不得使用；需要留痕或验证授权链路时用 API 版本。

为不伪造终态，周期写入后保持 `draft`、版本保持 `planning`、需求保持 `submitted`、规划事项保持 `proposed`；开放周期、验收与发布仍走各自命令。功能 lifecycle 写 `active`，因为示例描述的是汇智云已具备的能力。

执行结果（`hzy_aims_test_local_20260910`，产品 HZ-TY-S-002，操作人取产品空间创建人 zhouguangying）：写入前六张表均为 0；写入模块 22、功能 38、需求 10、规划事项 7、周期 2、版本 4，并按运行时同样方式把 workspace revision 由 2 推进到 3。

重复执行时计数全为 0 是幂等生效，不是失败。首版输出在零新增时仍打印“已提交，刷新即可查看”，实际造成过误读；现已区分三种结局，并在写入模式回读当前各表条数，避免把“本次新增 0”当成“库里没有数据”。

验证：用运行时 `component_list.go` 的实际查询回读，四个根模块的 `child_count` 分别为 3/5/7/3，`biz_id` 均为合法 UUID；38 条功能全部归属模块，无悬空 `component_id`；两个周期 `model_snapshot` 通过 `JSON_VALID`，`model_version` 与运行时常量一致；版本、需求状态分布符合预期。页面级最终呈现由使用者在测试环境确认。未部署。


### 需求管理内嵌规划（2026-09-11）

产品与研发视角将需求池、规划事项、规划周期收敛为单一「需求管理」入口。需求页内以「整理建设范围」「安排优先级」承接规划流程；原 planning、planning-items、cycles 路由仍可访问，统一高亮需求管理，并在内部步骤提供返回需求管理入口。单条未合并需求可通过「明确建设范围」复用既有规划表单，带入标题、问题说明、紧急程度和来源需求 revision；保存仍调用原规划命令，保留独立规划编辑权限、幂等及交付决定约束。

验证：导航测试、受影响文件 ESLint、Aims typecheck；隔离 Nuxt 预览使用真实页面与组件、模拟 API，在 1440 / 390 视口检查导航归属、返回路径及来源带入。此项不表示已部署或真实租户端到端验收通过。


### 产品线树形目录与统一管理（2026-09-11）

产品列表改为按产品线分页、展开后按产品分页的树形列表；整条线无独立/归档空间时提供「启用统一产品管理」。确认全部来源产品、经理和原因后，统一空间及来源模块同事务创建。新增 v5.37 数据库迁移，复用既有产品接入/查看能力，不修改 Assets 主档。设计、接口及安装顺序见 [产品线统一管理](Aims-Product-Line-Management.md)。代码验证见该文档，本次尚未对 CF 测试环境或 Runtime 部署，也未执行目标库迁移。

验证：14 项 Node 输入/导航测试、AIMS 与 productcenter Go 包测试，以及隔离 MySQL 上 22 项领域回归通过；包含 v5.37 重复迁移和真实事务/并发验证。受影响文件 ESLint、Nuxt typecheck 通过。真实浏览器在 1440px 与 390px 使用模拟 API 验证树形展开、统一启用预览、经理/原因必填及成功后的模块展示，浏览器 error 日志为空。
