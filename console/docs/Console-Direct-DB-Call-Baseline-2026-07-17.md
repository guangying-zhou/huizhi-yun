# Console 直接数据库调用基线

状态：CTR-003 冻结基线；当前边界已归零

基线时间：2026-07-17

扫描入口：`scripts/audit-console-db-boundary.mjs`

## 1. 结论

初始冻结基线保持不变，用于衡量迁移量。2026-07-17 最终静态复扫结果为：

| 当前指标 | 结果 |
| --- | ---: |
| 直接导入数据库 helper 的生产文件 | 0 |
| 静态数据库 helper 调用点 | 0 |
| 读/写/事务/连接池调用 | 0 |

同时已删除 `console/server/utils/db.ts`、Console 对 `mysql2` 的直接依赖、
Nuxt DB runtimeConfig、Cloudflare Hyperdrive/`DB_NAME`、Console Vault master key
和 OIDC private key 配置。PM2 与 dev-stack 启动模板会显式剥离这些变量。
这仍不代表 Wiztek 已完成生产切流、grant/ACL 撤销和观察期。

初始冻结时 Console 生产服务端代码共有：

| 指标 | 基线 |
| --- | ---: |
| 直接导入数据库 helper 的生产文件 | 51 |
| 静态数据库 helper 调用点 | 522 |
| 读调用 | 216 |
| 写调用 | 265 |
| 显式事务调用 | 41 |
| 绕过 helper 的连接池调用 | 0 |

首个迁移样板 `console/server/api/v1/console/profile.get.ts` /
`profile.put.ts` 不导入数据库 helper，固定经 Foundation
`getConsoleTenantProfile()` / `updateConsoleTenantProfile()` 调用
`GET/PUT /v1/console/profile`。写入要求精确 Console service identity、签名用户
委托、`Idempotency-Key` 和 `expectedRevision`，Runtime 在同一事务提交 CAS、
`console_mutation_receipts` 与 `operation_logs`。Legacy companies 企业资料端点也
已改为 Runtime 兼容层。

截至 2026-07-17 的 P2/P3 本地实现进度：企业资料、系统参数、业务领域、行政区域、
工作日历、operation/login/lifecycle 审计视图与用户通知读状态已切为
Runtime-only；旧 `orgCompat.ts`、`businessDomains.ts`、`workCalendar.ts` 与
`operationLogFilters.ts` 已删除；Console 启动阶段从 Platform 拉取后直写
`org_profiles` 的旧 bootstrap 也已移除。Directory 的正式读取路由及 legacy alias
兼容仓库已切至 Runtime，委员会、subject export/membership 同样不再直读 Console
数据库。用户、部门、委员会、项目及成员 mutation 也已迁入 Runtime，写事务统一
包含幂等 Receipt、操作审计和最小 subject 投影；`directoryAdmin.ts` 仅保留类型
契约。People 生命周期命令、目录同步任务查询/登记、钉钉姓名同步批次与失败回执、
头像元数据更新也已迁入 Runtime；服务器托管系统参数更新使用独立精确 capability、
CAS、幂等 Receipt 与事务内审计。LDAP 用户创建、本人改密、立即同步和连接测试
的命令排队及 operation 状态查询也已迁入 Directory Runtime，Console 已删除对应
`integration_operation` 直连实现。Directory source/Vault credential 绑定、Connector
配置读取和 Platform 签名 enrollment 也已迁入 Runtime；Connector 不再领取 Console
OAuth credential，配置、lease、complete、sync 均只走本机签名 loopback 合同，旧
Console service endpoints 和直连 enrollment utility 已删除。阶段复扫结果为 28 个
生产文件、299 个调用点（110 读、167 写、22 事务）。随后删除旧 Console
`directoryProviderRunners.ts` 与 `directorySyncJobs.ts`；未迁移的 Account/WeCom/
GitLab/非托管 LDAP 明确 503 且 UI 不再暴露执行按钮。最终复扫为 26 个生产文件、
247 个调用点（93 读、134 写、20 事务）；删除已无调用者的最后一个
`directorySources.ts` 兼容仓库后为 25 个生产文件、246 个调用点（92 读、134 写、
20 事务）。P4 随后把 Enterprise Connector Runtime 的 enrollment、实例 metadata、
heartbeat、revoke、hash-only service credential/grant 原子事务迁入客户侧 Runtime；
Console 只做安装指令组装、权限和服务身份 BFF，两个旧 utility 不再导入 DB helper。
Integration 管理、连通性检查和业务 service 授权/credential 解析随后迁入客户侧
Runtime；旧 Console service API 返回 410。被 Enterprise Connector Runtime 取代的
Notification Runtime 本地安装器也已删除；企业微信配置与 credential connectivity
检测改由 Runtime 执行，Console 消息测试不再写 Integration check 表。该阶段复扫为
21 个生产文件、168 个调用点（65 读、90 写、13 事务），相对冻结基线减少 30 个文件
和 354 个调用点。随后 Auth/Session/OIDC、Service Client、通知/Actionable、
可靠 operation、统一审计和兼容运行态全部迁入 Runtime，并删除最后的 DB helper、
driver 和部署配置；最终复扫为 0 个文件、0 个调用点。该数字只表示代码边界收敛，
不代表 Wiztek Schema migration、生产切流或权限撤销已经执行。

## 2. 领域分布

| 领域 | 直接 DB 文件数 | 风险 |
| --- | ---: | --- |
| Auth / Session / OIDC | 12 | 极高 |
| Directory / Connector | 0 | 主链已迁；provider adapter 功能验收仍未完成 |
| Notification / Operation | 7 | 高 |
| 其他 Console Core | 6 | 中；需继续细分 |
| Runtime / Bootstrap | 3 | 中至极高 |
| Integration | 1 | 高 |
| Vault / Service Identity | 1 | 极高 |

## 3. 生成方式

```bash
pnpm run audit:console-db-boundary
pnpm run audit:console-db-boundary -- --json
```

脚本扫描 `console/server/**/*.ts`，排除测试、构建产物和数据库 helper
自身，按文件输出：

- 领域；
- 读、写或读写模式；
- helper 调用点数量；
- 风险等级。

该结果是保守上界：所有生产源码中的直接 DB 依赖都纳入，即使某个旧
utility 暂无路由调用。这样不会把“暂时不可达但仍可被重新引用”的 SQL
误当成已迁移。每个领域切换 `runtime_only` 时，还必须删除或隔离对应旧
SQL，并重新运行扫描确认基线下降。

## 4. 完成判定

最终完成条件不是调用数下降，而是同时满足：

1. 扫描结果为 0；
2. Console 生产构建不再包含 MySQL/Hyperdrive 数据访问路径；
3. Console、PM2 和 Cloudflare 环境不再持有 `hzy_console` 凭证；
4. 客户 Runtime DB 用户成为唯一可访问者；
5. 网络 ACL 和数据库授权完成撤销并留存证据。
