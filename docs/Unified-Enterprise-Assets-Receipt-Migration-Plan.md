# 统一库 Assets receipt CHECK 补装计划

## 范围与基线

C000001 已激活的统一库中，Assets owning receipt 是物理表 `assets_service_command_receipt`；同名无前缀的 `service_command_receipt` 是兼容视图，不是 DDL 目标。当前 enforced CHECK 为 `assets_chk_scr_cross_app_ffc9e2bc`，含产品主档、产品目录及三项产品关联命令，缺数字资产与知识产权命令。Runtime 因而分别返回 `assets_digital_asset_receipt_schema_unavailable` 和 `assets_ip_asset_receipt_schema_unavailable`。2026-09-25 只读基线为 receipt 6 行；这不表示任何 Assets 新建测试行已落库。

目标约束取自 [20260917 完整 allowlist](../assets/docs/migrations/20260917_assets_owned_ip_asset_product_link_receipts.sql)，涵盖 20260915 数字资产、20260916 知识产权，以及 IP 产品关联的最终条款。受控工具将源 DDL 的表名与约束名映射到已注册物理名称；不得直接对兼容视图执行原始 SQL，也不得仅运行 15/16 后丢掉 17 的条款。目标只替换该 CHECK；其它索引、状态 CHECK、业务表、grant、授权及策略不变。

## 只读计划与批准后的应用

工具：[enterprise-assets-receipts.mjs](../deploy/test-env/enterprise-assets-receipts.mjs)。默认只读；从受保护 Runtime 配置读取 tenant、deployment、environment、generation、数据库及 MySQL server UUID，确认物理表与 enforced CHECK，记录约束和迁移文件 SHA-256、允许的操作、旧 receipt 行数及不输出的旧行摘要，生成绑定租户与实例的 review hash。未知操作、缺原有产品操作、约束未 enforced、表/实例不匹配均停止。计划中不输出凭据、原始 CHECK 或 receipt 内容。

```sh
node deploy/test-env/enterprise-assets-receipts.mjs \
  --config <受保护的 Runtime 配置路径> --tenant C000001 --database <统一库名>
```

C000001 当前 plan review hash 为 `ba78a21bde4b53d7b0ad8a947c5a05be202685005602bd0db7cb31cb946af660`，来源 CHECK SHA-256 为 `1cf57f68dd747330806622e43c16fda4593942cab3a86d0db539b5215adb0372`，目标 SQL 文件 SHA-256 为 `4cbce759cdf84562922f0a042448bcb5d36692e50ff6138eb2fbcc623e953168`。任何 receipt 新增或约束/配置/实例变化都会改变计划，必须重新只读 plan 与审查，不能复用旧 hash。

**C000001 apply 仍待用户批准。** 批准后先在维护窗口停相关写流量，按现有受保护流程对统一库作全量加密备份并核验可恢复；用独立 0600 迁移账号配置提供 DDL 权限。工具要求备份文件、独立迁移配置、与实时 plan 相同的租户绑定 review hash；连接必须指向 Runtime 配置中的同一库和 MySQL 实例。单库 advisory lock 内再计划防漂移、执行一次 `ALTER TABLE ... DROP CHECK ..., ADD CONSTRAINT ...`，随后核对目标所有操作及精确 capability、CHECK enforced、旧 receipt 行数/摘要不变。已到目标形状时可重复执行而不发 DDL。

```sh
node deploy/test-env/enterprise-assets-receipts.mjs \
  --config <同一受保护配置> --tenant C000001 --database <同一统一库> \
  --apply --review-hash <复核后的实时 hash> \
  --backup <已验证的加密备份路径> --migration-db-config <独立 0600 迁移账号 JSON>
```

ALTER 属非事务 DDL。若执行或后验失败，停止相关写流量，保留当前 schema 与备份供审查；不能假设事务回滚或直接套用旧 CHECK（已有新 receipt 时会与数据冲突）。Runtime 二进制不依赖旧 CHECK 形状，但回滚仍须先审查新行和当前约束。C000002 等其它租户须各自 plan、备份、批准和验收，不得沿用 C000001 的 hash。

## 隔离演练与后续冒烟

`node deploy/test-env/test/enterprise-assets-receipts.test.mjs` 在 `/tmp` 一次性 MySQL 以 canonical Assets receipt 表起步，安装旧产品关联约束、插入产品及跨应用旧 receipt；核对数字资产原本被 CHECK 拒绝、错误 hash 拒绝、完整目标 DDL 后旧行不变、数字/IP/IP 产品关联精确 capability 可用、错误 capability/未知命令仍拒绝、二次 apply 不重复。测试结束删除一次性实例和库。隔离演练不构成 C000001 apply 授权。

环境应用后仅在正式 UI 用纯标记资产分别验证创建、编辑，记录行 ID、权限/回执和清理清单；产品关联入口仍未迁入 Host，不能靠数据库迁移声称已验。
