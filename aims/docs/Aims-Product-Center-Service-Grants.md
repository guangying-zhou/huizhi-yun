# 产品中心服务授权安装与验收

本文覆盖当前已实现的空间、成员、接入和产品目录链路。用户角色／产品范围仍由 Foundation → Console 决策；服务能力不替代用户权限。规划／版本新命令接入时须扩展精确能力，不能预先授予通配权限。

## 1. 安装产物

- [生成器](../scripts/generate-product-center-grants.mjs)：从目标 manifest 校验能力声明后生成 SQL；不读取环境变量、数据库或秘密。
- [Seed](../../console/docs/sql/Console-SQL-Seed-product-center-20260907.sql)：只为指定的 Aims／Assets 服务客户端安装 162 条精确业务 grant。
- [Verify](../../console/docs/sql/Console-SQL-Verify-product-center-20260907.sql)：逐条检查 168 个组合，包括 6 条已有传输权限；缺客户端仍返回 FAIL，不能以空结果当通过。

生成与漂移检查：

```sh
node aims/scripts/generate-product-center-grants.mjs
node aims/scripts/generate-product-center-grants.mjs --check
```

在明确的目标 Console 租户数据库会话内设置 `@pc_aims_client_code` 和 `@pc_assets_client_code` 为实际已登记客户端 code；未设置时分别选 `aims.runtime`、`assets.runtime`。脚本不会选取所有同 app_code 客户端，不创建账号、不读取凭证秘密、不分配租户用户角色。先核对目标租户／部署，再执行 Seed 和 Verify；每个实际运行客户端组合单独执行。

Seed 要求两客户端归属正确应用，且当前凭证属于该客户端、active、未过期。guard 失败不得继续安装；即使操作工具启用继续执行错误语句，空 guard 也不会产生 grant。Seed 可重复执行并修复指定精确 grant 的 inactive 状态。它不安装宽传输权限，缺失时按现有应用 Runtime 安装流程恢复，不能用宽权限替代精确能力。

## 2. 真实签发与请求验证

Verify 全部 PASS 只证明数据库记录符合前提，不能证明签名、JWKS、绑定或用户范围已生效。用目标部署真实客户端，经现有 Foundation／Console 令牌路径逐组探测下表；记录 tenant、deployment、客户端 code、audience、scope、时间和结果，禁止保存 Token 或客户端秘密。

| 调用身份 | audience | 请求 scope 组合 |
| --- | --- | --- |
| Aims | assets | `assets:product:read` |
| Aims | console | `console:directory-users:read` |
| Aims | data-runtime、tenant-runtime 分别验证 | `aims.read aims:products:authorization-object` |
| Aims | data-runtime、tenant-runtime 分别验证 | `aims.read aims:products:view` |
| Aims | data-runtime、tenant-runtime 分别验证 | `aims.read aims:products:admin`（成员列表） |
| Aims | data-runtime、tenant-runtime 分别验证 | `aims.read aims:products:onboard`（读取本人目录刷新状态）；刷新写入使用已有 `aims.write aims:products:onboard` |
| Aims | data-runtime、tenant-runtime 分别验证 | `aims.write aims:products:edit`、`aims.write aims:products:archive`、`aims.write aims:products:restore`、`aims.write aims:products:onboard`、`aims.write aims:products:admin`，逐组测试 |
| Assets | data-runtime、tenant-runtime 分别验证 | `assets.read assets:product:read` |

表中 scope 是 Foundation 请求的语义值。Console grant 的 runtime audience 前缀是现有签发存储约定，不是另一个业务 capability；勿把前缀存储格式直接拼进 BFF。

签发成功后用真实链路验收：候选搜索、接入、空间读取／编辑、成员交接；并验证缺精确能力、错 audience、错 tenant/deployment、过期 Token、缺用户签名、无产品范围均被拒绝。目录服务使用 Assets 自身 Runtime 身份，不能转发 Aims 入站 Token。用户应覆盖多角色合并、模拟隔离、定制角色和过期授权。

## 3. 仓库验证与环境边界

`aims/test/productServiceGrants.test.ts` 检查生成器漂移、manifest 声明及双 audience 覆盖。真实 SQL 集成测试要求显式隔离 Unix socket，不接受业务 DSN：

```sh
HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.EXAMPLE/mysql.sock \
  python3 aims/test/integration/product_service_grants_mysql.py
```

该测试创建并删除随机测试数据库，覆盖重复安装、空客户端、同应用无关客户端、传输权限缺失、精确 grant 停用、当前凭证到期和失败 guard。它使用最小 Console 表 fixture，不能替代整库迁移或真实环境令牌签发验收。实际执行证据登记在[实施记录](Aims-Product-Center-Implementation-Status.md)。

需求创建增加 `aims:product-requests:create`，覆盖两个 Runtime audience；用户资源仍为 `product_requests`。新增两条授权的 SQL 实测与目标租户签发验收仍待完成。

规划周期接入说明：现有 `aims:product-priorities:create` 用于规划事项及周期草案创建，`read` 用于两者列表／详情；周期内部写命令有独立 cycle-create 幂等身份。创建不包含周期开放、关闭、评估或最终决策。未新增 grant，当前生成数量仍按本文统一清单验证。

周期草案编辑复用 `aims:product-priorities:edit`，对应独立 cycle-edit 命令身份；开放／关闭周期不在此服务动作内。产品 BFF 的字面精确服务 scope 由 productServiceGrants 测试对照 Manifest resources/actions 校验，防止未声明能力名漂移。

投入确认写操作独立要求 `aims:product-priorities:consumption-confirm`；用户对象动作仍为 assess，不由 prioritize 或 edit 隐式获得。两个 Runtime audience 均需安装精确 grant。
