# ADR-018 受管兼容视图与产品领域事务复用

日期：2026-09-13。范围：统一库中复用已有 productcenter 状态规则、授权和 receipt；属于 INT-103/105/106 的基础证据，不代表旧 HTTP/BFF 路径已经切换。

代码入口：`internal/enterprise/compatibility_views.go`、`internal/migrationlock/lock.go`、`internal/apps/aims/productcenter/command.go` / `requests.go`。

## 1. 单一物理写入责任

已有 productcenter 领域函数接受 `*sql.DB` / `*sql.Tx`，SQL 使用稳定逻辑表名。统一库的物理表按域加前缀后，以严格限定的 `SQL SECURITY INVOKER`、`ALGORITHM=MERGE` 简单视图提供兼容名称：每个逻辑名称只能对应当前库中的一个已登记 owner 物理表，不复制数据、不跨 schema/tenant、不改写任意 SQL 字符串。

同名逻辑表在多个域存在时拒绝创建。特别是 service_command_receipt、integration_operation 等不能为了让旧 handler 工作而任意指向其中一个域。Registry 仍登记物理 BASE TABLE/InnoDB，视图只供经过审阅的既有领域函数使用；这不是通过多个可写视图取消所属域约束。

权限检查仍在领域服务/BFF/Runtime：MySQL INVOKER 并不替代个人权限、产品范围或职责冲突。物理表上的 trigger、FK、唯一键及事务继续约束经视图发生的 DML。

## 2. 计划、安装和定义核验

`PlanCompatibilityViews` 只在目标 generation=0 生成带 review hash 的计划；`ApplyCompatibilityViews` 要求精确摘要，不覆盖已有对象。已有对象必须是当前期望的可更新 INVOKER view，不能是碰巧同名的物理表或不同定义视图。

MySQL 会改变 VIEW_DEFINITION 中关键字大小写及逗号空格。比较现改为 SQL token 级归一化：允许这些格式差异，保留被引用标识和字符串字面量的精确值；不再对整段 SQL 全部转为小写。筛选条件、函数、额外来源、不同 quoted identifier 等变化均不符合生成定义。真实 MySQL 重入核验通过。

构造内部服务时调用 `VerifyCompatibilityViews`，要求 registry 身份和当前 generation 一致；业务请求中不执行 CREATE/ALTER VIEW。nil pool、未登记表、跨域名称冲突和定义漂移失败关闭。

## 3. 与迁移/激活共用会话锁

MySQL DDL 会隐式提交，不能用普通事务锁横跨 generation 检查和 CREATE VIEW。`ApplyCompatibilityViews` 现在固定同一 `*sql.Conn`，在读取计划、检查 generation、创建及复验全部视图期间持有目标 named lock。

锁名称由 `internal/migrationlock.Name(instanceID, database)` 统一生成，server UUID 大小写规范化；完整影子 `Apply` 和 `ActivateFinalCopy` 已改为使用同一 helper。竞争立即失败，不无限等待。named lock 属于物理会话，DDL 隐式提交不会释放它；释放先于归还连接池。

因此，正常协议下不能发生“检查 generation=0 后，另一协调器已经激活，安装器继续 DDL”。这仍依赖维护身份遵守协议，以及业务账号没有越权 DDL/修改 registry 能力；不声称能抵抗任意管理员 SQL。

## 4. 需求创建的最小接线集合

`CreateProductRequestInTransaction` 所需唯一 Aims 逻辑视图：

- product_workspaces：根锁、生命周期和 revision。
- product_members：当前授权事实和有效期。
- product_command_receipts：幂等身份、payload hash 和原结果。
- product_requests：需求事实。
- product_components：非空模块 ID 的归属校验。
- product_activity_logs：原子审计。

构造函数接收包含 tenant/environment/runtimeDeployment、schema/generation、owner deployment 和物理表映射的完整 Binding，先对这些视图调用 VerifyCompatibilityViews。真实请求仍由已验证 Runtime 上下文构造 CommandIdentity 和 AuthorizationPermit；不能将浏览器传来的全量授权直接透传。

新协调入口在同一事务中调用所属 Assets 服务与 `CreateProductRequestInTransaction`，最终 commit 由协调入口负责。事务开始时还应锁 registry 行并核验 tenant/environment/runtimeDeployment/schema/generation，锁保持至提交；该运行时 generation guard 由整合负责人另行接线，本次没有用内存 Resolve 代替它。

## 5. 真实隔离验证

复用 productcenter 私有 `mysqlTestDatabase` / migration / workspace fixture，将其中 41 张真实表一次 RENAME 为 aims_*，保留其 FK，然后生成并验证全部 41 个受管兼容视图；另建同库 Assets 合成主档。实例为 `/tmp/hzy-product-center.views.5msieylm/mysql.sock`，PID 67385。

```sh
HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.views.5msieylm/mysql.sock \
HZY_ENTERPRISE_TEST_SOCKET=/tmp/hzy-product-center.views.5msieylm/mysql.sock \
  go test -race \
  -run 'TestMySQLEnterpriseManagedViews|TestViewCanonical|TestTargetLock|TestSourceFenceMySQL' -v \
  ./internal/apps/aims/productcenter ./internal/enterprise ./internal/migrationlock ./internal/migrations/unified
```

通过：

- 真实 VIEW_DEFINITION 格式化后重复安装仍匹配；跨域歧义名称、定义篡改拒绝。
- 激活锁被另一真实 MySQL 会话持有时安装器不执行任何 DDL；generation=1 后旧计划拒绝。
- 通过视图真实创建需求、receipt、审计并推进 workspace revision。
- Aims 晚期审计失败、早期 draft 校验失败、授权失败或同键异 payload 均回滚同事务先前 Assets 修改，调用方随后 commit 返回 ErrTxDone。
- 成功共同提交后，旧 Go `CreateProductRequest` 入口指向同一新池，用相同 key/payload 重放同一 receipt/语义结果，无重复需求和 revision；旧授权事实仍被拒绝，重放不会绕过重新授权。
- 修改共享 named-lock helper 后，持久源 fence / 最终复制 / 激活回执的真实 MySQL 测试也通过。

既有 `ExecuteCommandInTransaction` 和 `CreateProductRequestInTransaction` 的实现满足本次真实集成检查，未为视图另外复制业务状态机。该段形成时的 147→149 表演练早于 Assets 三张 outbox 表补齐，只是历史证据；它不代表当前 150 张业务表的每个旧 API 都已适配。当前闭包见[产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)。

## 6. 剩余接线

实际环境还需生成并审阅必要 alias 计划、在激活前安装视图、构造真实领域服务、接事务 generation guard、真实 BFF actor/权限和 HTTP 入口，以及让兼容旧 URL/旧入口访问同一新权威存储。测试中的“旧入口重放”不是让已 fence 的旧物理库恢复写入。

来源旧物理库保持 fenced。新增目标 view 不参与业务表 count/hash，但后续以已统一库为源再次迁移时，需显式识别这些受管 view；不能直接套用当前会拒绝源 VIEW 的首版影子复制命令。

清理证据：隔离 hzy_pc_test_*/hzy_ef_* 数据库剩余 0，PID 67385 正常 shutdown，PID 文件消失，自建 datadir 已删除。未修改实际业务库。

## 7. 持久 generation 事务锁实测补充

`Registry.BeginWriteTransaction` 已由 Runtime 基础层实现。追加真实隔离测试 `TestMySQLEnterpriseWriteTransactionGenerationFence`：同租户 Aims/Assets 解析到同池；事务持有 registry `FOR SHARE` 后，另一连接修改 generation 确实出现在 `performance_schema.data_lock_waits`；writer 提交后更新完成，旧内存 registry 随后返回 `ErrBindingMismatch`。错误请求租户、持久 registry 租户不一致、跨租户不同池的组合均拒绝。

```sh
HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.generation.ahaqn6vl/mysql.sock \
  go test -race -run 'TestMySQLEnterpriseWriteTransactionGenerationFence' -v ./internal/apps/aims/productcenter
```

通过（2.805s）；同实例本轮亦通过 managed views 事务测试。专用实例 PID 75381；shutdown 前仍有 3 个 fixture 库（连接池被 registry 提前关闭后 fixture 的 DROP 未完成），已正常 shutdown 并删除整个自建 datadir/socket，因此无测试存储残留。未访问实际业务库。本项是基础接口与真实锁行为证据，不代替 HTTP/BFF 接线验收。

修正测试生命周期后再次验证：fixture 持有借给 Registry 的池并负责先 DROP 再 Close，避免测试提前关闭池。隔离实例 `/tmp/hzy-product-center.generation.1pyxpmzw`，PID 77436，同一 race 测试通过；关闭前 fixture 库剩余 0，实例 shutdown/datadir 删除完成。
