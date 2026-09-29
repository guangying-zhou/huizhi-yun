# ADR-017 / ADR-018 实施分支代码审查

审查日期：2026-09-16  
仓库：guangying-zhou/huizhi-yun  
分支：feat/adr018-enterprise-integration  
固定提交：`6b46c8f366189431bf16f5b3ae2ee89d184b4805`  
对照主线：`baa0bfaa605a723ff5dabc6e946a825ee624f917`

## 结论与范围

建议 Request changes：修正新增入口的功能阻断及读取代次检查缺口后，再扩大试点或实施生产切换。两项 ADR-017 认证问题在对照主线已有相同实现，属于遗留未闭环项，不列为该分支新增回归。

这是风险导向的静态代码审查，加一项源码级动态复现，不是全仓逐行审计或完整系统验收。重点读取了 Host 组合与业务入口、Runtime 调用身份、连接注册、事务、产品目录读取、Console 签发及引导信任、迁移与源库写入围栏。公开镜像的两个分支没有共同祖先，采用固定快照和相关文件内容对照；不能把一次 GitHub compare 返回的前 300 个文件当成完整改动集。

未执行完整 Nuxt 构建、Go 全量测试、MySQL 迁移、真实浏览器端到端测试或线上请求。GitHub Actions 查询该提交返回 total_count=0；这不证明项目没有在其他环境执行测试。没有修改用户仓库或部署。

## 汇总


| 编号  | 级别         | 问题                                                         | 归属              |
| --- | ---------- | ---------------------------------------------------------- | --------------- |
| F1  | P1         | Host 就绪性白名单遗漏已注册的业务路由，正常请求被提前拒绝为 503                       | 新整合路径           |
| F2  | P2，生产切换前修复 | ProductDirectoryService 的 List/Resolve 绕过持久化 generation 检查 | 新整合路径           |
| F3  | P1         | OIDC 通用签名接口未根据会话、客户端和服务授权事实形成签发结果                          | 主线遗留 ADR-017 缺口 |
| F4  | P1         | OIDC bootstrap 在已经初始化后仍可改写 issuer/JWKS 信任配置                | 主线遗留 ADR-017 缺口 |


## F1：Host 就绪性白名单与已实现路由不同步

位置：`enterprise/server/middleware/01-business-api.ts`，项目 GET 特判及最后的 aims/assets API 默认拒绝。

该中间件仅放行 `GET /aims/api/v1/projects` 和部分已登记的产品等接口。以下入口已有路由文件，却没有获得中间件放行：


| 请求                                | 已存在的路由文件                                                           | 中间件结果 |
| --------------------------------- | ------------------------------------------------------------------ | ----- |
| POST /aims/api/v1/projects        | enterprise/server/routes/aims/api/v1/projects/index.post.ts        | 503   |
| GET /aims/api/v1/work-items       | enterprise/server/routes/aims/api/v1/work-items/index.get.ts       | 503   |
| GET /assets/api/v1/digital-assets | enterprise/server/routes/assets/api/v1/digital-assets/index.get.ts | 503   |


`aims/layer/pages/enterprise-projects.vue` 显示创建项目按钮；`enterprise-project-new.vue` 会提交第一个请求。这不是只有尚未实现的页面占位，而是页面、路由已接入，入口围栏仍阻断它们。请求无法进入后续业务处理器，调整用户角色或数据库权限不能修复此处 503。

修复建议：从明确审核的 METHOD + PATH + handler 注册表生成就绪性判断，或至少同步白名单并增加契约测试。保留未知/尚未迁移入口的默认拒绝，不全局放开 `/aims/api/**`。端点是否已部署与人员业务授权仍是两种不同判断。

验证：本包复制了上述中间件，Git blob SHA 为 `8eb2da23a74ee1516b17d8446a9d3e2842b783a4`，与仓库一致。`reproduce-readiness.mjs` 只替换三个 H3 辅助函数，在 Node 中执行实际处理函数。结果见 `readiness-results.json`。这是源码级控制流验证，不是实际 Nitro/HTTP/浏览器运行。

应补回归：已登记接口通过就绪性判断后，仍由 handler 按人员权限拒绝或执行；未知接口继续拒绝。项目创建需要经真实 HTTP 和授权夹具跑通，不能只测试 Go 内部服务或直接调用 TS handler。

## F2：产品目录 List / Resolve 未使用持久化代次围栏

位置：`data-runtime/internal/enterprise/product_directory.go` 的 `list` 和 `Resolve`。

两条路径先执行 `Registry.Resolve`，随后直接调用：

```go
assets.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
```

`Registry.Resolve` 只核对冻结在进程内的 binding、schema、generation 和路径模式。它不读取数据库内 `enterprise_schema_registry`。

与之相对，`enterprise/transaction.go` 的 `beginDomainTransaction` 会读取并 SHARE 锁定持久化 registry，核对 tenant、environment、runtime deployment、schema version 和 generation；`BeginSnapshotReadTransaction` 已封装此能力。

目录路径有对象范围、授权过期和目录水位校验，但目录 epoch/revision 不是 Runtime generation。入口认证也不能替代对数据库持久代次的检查。

触发条件：运行中的实例绑定 generation=1，运维/恢复切换已经将持久 registry 改成 generation=2，而旧实例仍收到使用其有效 Host 身份的请求。List/Resolve 没有触发持久代次校验的机会，可能继续成功返回；它们也没有在整个读取事务期间持有 generation 围栏。

影响边界：已确认的是旧代次读取失效检查缺口，不据此声称已发生跨租户泄漏或重复写入。

修复建议：两条路径统一走 `Registry.BeginSnapshotReadTransaction`，列出实际参与的域并使用返回的相同事务；保留授权、分页快照、目录水位语义。不要通过删去其他路径的代次检查实现一致。

应补回归：启动后修改持久 generation，旧实例 List 和 Resolve 都应拒绝；并发 generation 变更不能穿过已开始的受保护读取；正常代次下列表、总数和字典仍遵循同一授权范围。

## F3：通用签名接口尚未落实客户侧签发权威

位置：

- `data-runtime/internal/apps/console/auth_signing.go`：`SignOIDCToken`、`normalizeOIDCSigningClaims`。
- `data-runtime/internal/server/server.go`：`/v1/console/auth/oidc/sign` 分支。
- `console/server/utils/oidc.ts`：`signJwt`、`signServiceAccessJwt`。

Console 构造 claims 后调用 Runtime sign。Runtime 检查字段类型、用途和格式，绑定 tenant/deployment，随后用客户侧私钥签名。签发路径未据 sid 查询当前有效 Session，未据用户会话形成 subject，未核对请求 audience 与该次认证事务，也没有调用独立存在的服务凭证/授权状态校验来约束这些 service claims。

前提必须说清楚：这不是匿名签名接口；需要获准的 Console workload 及签名 capability。问题在于该 workload 一旦发生逻辑错误、越权调用或被攻陷，可以请求尚未由 Runtime 核验事实的签发内容。密钥位于客户侧不等于签发决策也已经由客户侧权威事实控制。

分支 ADR-017 §2.4/§2.8 已明确禁止任意 payload/subject/scope 签名服务，并要求 Runtime 依已验证身份形成签发结果。该处尚未满足。

修复建议：以授权码兑换、Refresh Token 轮换、服务凭证签发等领域操作替代通用 claims 签名入口；Runtime 从会话/认证事务/客户端及服务授权记录生成受限 claims。迁移期仍存在的签名适配也应验证这些事实，不能只验证格式。issuer 来源为受控租户配置，不由任意调用参数决定。

应补回归：具有合法 Console workload 身份但携带不存在/已撤销 Session、subject 与会话不符、错误 client/audience、停用服务凭证或未授予 scope 时，签发必须拒绝。

归属：此文件在主线和审查分支的 blob SHA 均为 `8e9c11d94562342df907b88e1a3ffeb403053857`。这是主线遗留，不是本分支新引入。

## F4：引导完成后仍可覆盖 JWT 信任配置

位置：

- `data-runtime/internal/server/console_oidc_bootstrap.go`：`bootstrapConsoleOIDCSigningKey`。
- `data-runtime/internal/apps/console/auth_signing.go`：`BootstrapOIDCSigningKeyToVault`。
- `data-runtime/internal/config/config.go`：`PersistJWTTrustOverlay`。

bootstrap 验证平台签名信封、时间窗、租户/部署/Runtime 绑定及 JTI 格式，然后执行 key bootstrap。当前私钥已经属于 Runtime Vault 时，adapter 返回 `already_present`；外层仍继续持久化传入 issuer/JWKS 并更新 JWT trust。

`PersistJWTTrustOverlay` 通过临时文件加 rename 替换既有 `auth-jwt-trust.json`，没有“已初始化后不得变更”的一致性校验。bootstrap 路径中也没有持久化消费 JTI。因而持有新的有效引导信封、或重放尚在有效期内且内容不同于当前状态的旧信封，仍可改写信任配置。

前提：需要有效的平台签名引导信封，并非任意未认证请求可设置 issuer。即便平台是受信治理者，也不应把一次性引导永久保留为更换认证信任根的日常操作入口。

修复建议：持久化初始化状态和已消费 JTI；初始化后仅允许完全相同配置的幂等确认，差异拒绝。正式 issuer/JWKS 迁移使用独立、批准且审计的操作。考虑进程重启和双实例下的防重放，不能只依赖进程 Mutex。

应补回归：第一次成功；同一内容重试无新副作用；完成后不同 issuer/JWKS 拒绝；已消费 JTI 在重启和双实例中继续失效；拒绝时内存与磁盘 trust 都保持原值。

归属：此 bootstrap 文件在主线和分支的 blob SHA 均为 `ab939b0fe0448fff62c492968daf148c9b55ea44`，同样是遗留问题。

## 已看到的正确方向

Enterprise 请求校验明确区分 Host workload、逻辑业务域、用户上下文和即时服务凭证状态；统一连接注册含租户、环境、部署、表映射及存储身份；事务协调已提供共享 sql.Tx 与持久代次围栏；Host 显式注册业务页面而非合并所有应用根配置。客户端根页面以会话 scope 和路由构造 page-key，不应误报成“完全没有身份切换状态治理”。

迁移工具包含审阅哈希、独立影子库、源库写入围栏及恢复相关实现；上述结论不是完整迁移正确性的验收。建议沿用这些正确机制，补齐旁路，而不是退回“一应用一库”和所有内部协作必须 HTTP。

## 放行建议

F1 修复并补 Host 层端到端入口测试；F2 补双实例/代次切换读取验证；F3/F4 单独补齐 Auth 权威与引导信任整改。在此基础上提供固定 Host、Runtime、schema、权限目录版本对应的测试记录，再扩大租户范围。

完整门禁需明确 MySQL 隔离测试是否实际执行：仓库部分测试依赖 `HZY_ENTERPRISE_TEST_SOCKET`，缺少环境会 skip，不能将普通 Go 测试输出成功等同数据库迁移与事务已经验证。

## 定位链接

全部链接固定为审查提交，不跟随分支后续变动。

- [Host readiness middleware](https://github.com/guangying-zhou/huizhi-yun/blob/6b46c8f366189431bf16f5b3ae2ee89d184b4805/enterprise/server/middleware/01-business-api.ts)
- [Product directory](https://github.com/guangying-zhou/huizhi-yun/blob/6b46c8f366189431bf16f5b3ae2ee89d184b4805/data-runtime/internal/enterprise/product_directory.go)
- [Transaction helper](https://github.com/guangying-zhou/huizhi-yun/blob/6b46c8f366189431bf16f5b3ae2ee89d184b4805/data-runtime/internal/enterprise/transaction.go)
- [OIDC signing](https://github.com/guangying-zhou/huizhi-yun/blob/6b46c8f366189431bf16f5b3ae2ee89d184b4805/data-runtime/internal/apps/console/auth_signing.go)
- [OIDC bootstrap](https://github.com/guangying-zhou/huizhi-yun/blob/6b46c8f366189431bf16f5b3ae2ee89d184b4805/data-runtime/internal/server/console_oidc_bootstrap.go)
- [Trust persistence](https://github.com/guangying-zhou/huizhi-yun/blob/6b46c8f366189431bf16f5b3ae2ee89d184b4805/data-runtime/internal/config/config.go)
- [Branch ADR-017](https://github.com/guangying-zhou/huizhi-yun/blob/6b46c8f366189431bf16f5b3ae2ee89d184b4805/docs/ADR-017-Console-Tenant-Data-Plane-Separation.md)

