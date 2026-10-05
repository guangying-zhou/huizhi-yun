# wiztek 生产只读核对（2026-09-28）

状态：P1/P2 只读核对已执行（2026-09-28 17:25–17:35 UTC，见文末“P1/P2 只读核对结果”），前文保留当日早些时候的边界记录。全程没有执行生产写入，也没有读取或输出任何凭据值。

## 当前访问与证据边界

- 05:47 UTC 后本机文件、MySQL 测试实例和受控 Chrome 已恢复；此前本机 DNS 失败不再代表当前状态。无凭据 `GET https://gitlab.wiztek.cn/api/v4/version` 当前返回 401，证明本机可抵达受保护 GitLab 入口，**不能**证明 Cloudflare Host Worker 可直连或私有仓库可见。
- `GET https://wiztek-data-runtime.huizhi.yun/runtime/health` 当前 200，返回 Runtime `0.3.219`、提交 `c11c7c66-dirty`、构建时间 `2026-09-10T05:54:23Z`。此健康端点不证明所连生产业务库的 grant 状态。
- Wrangler 只读 `deployments status`：`hzy-tenant-gateway` 当前 100% 版本 `03f345e2-a300-411d-b7c5-9d8154f3e1fb`（2026-09-07）；`hzy-console-prod` 当前 100% 版本 `81f79fbb-e90e-4133-b028-e337cf06fb3b`（2026-09-10）；`hzy-workflow` 当前 100% 版本 `20bfe9f9-cb50-48ce-9a43-305d9dedb388`（2026-09-22）；`hzy-assets` 当前 100% 版本 `89015190-d624-4f0d-b0e1-60e3ef8c2647`（2026-08-29）。这证明 Worker 已部署；未读取其业务健康或租户路由。
- 尚无获验证的生产库只读连接。Workbench 当前连接显示本机测试库，不能拿它的 grant/集成数据冒充生产。Cloudflare 套餐、生产 grant 与 GitLab 凭据实际存储仍待生产只读权限/控制面核对。

## GitLab 凭据

仓库初始化脚本 [Console-SQL-Seed-v1.10-gitlab-integration.sql](../console/docs/sql/Console-SQL-Seed-v1.10-gitlab-integration.sql) 定义 `gitlab.default` 集成、`integration.gitlab.default.bot_token` secret code、`integrations` → `integration_credentials` → `vault_secrets` / `vault_secret_versions` 元数据关联。该脚本初始方案是 `storage_backend=env_ref`、`encryption_scheme=external_ref`、后端引用名 `GITLAB_BOT_TOKEN`；这**不是**生产现状的证明，也不符合上线目标的最终存储方式。

生产待核字段仅限元数据：集成 code/id、凭据行 id 与状态、secret code/id、`storage_backend`、`encryption_scheme`、密钥标识名、版本 id、归属类型与归属键。查询不得包含 token、`ciphertext_blob`、明文、`backend_secret_ref` 的值或解密操作。若实际来源并非 Console 这四张表，须只读定位来源表及加密方案后再设计迁移。

已确认的代码消费者：Foundation 的 Git integration 固定操作默认使用 `gitlab.default`（`foundation/server/utils/gitIntegration.ts` 及 `foundation/server/api/git-integration/*`）；Aims 项目提交同步读 `gitlab-commits` 并通过该集成链获取 GitLab 内容（`aims/server/api/v1/projects/[id]/sync-gitlab.post.ts`）。生产实际启用的调用方、集成所有者和凭据记录尚待现场元数据核对。

## Host Worker → GitLab 可达性

本机无凭据 GET 当前到达 GitLab 入口并返回 401；这不能替代 Cloudflare Host Worker 的出站路径证明。现场核对需确认 Host Worker 的 egress/Access/防火墙配置，并从受控测试 Worker 发一次无凭据、无业务数据的 GET，仅记录状态码与网络错误类别；不传生产 token。

## 可清理测试仓库

无凭据 GitLab API 搜索拟用名称 `hzy-pilot-aims-gitlab-20261008` 返回 HTTP 200、公开可见匹配数 0；这不能排除私有测试仓库。若经有权目录确认没有，建议在 wiztek GitLab 的测试命名空间新建此私有仓库：仅放无敏感内容的标记提交与一条可关联事项，验收后先经正式 UI 解除项目关联并清理测试记录，再删除或归档仓库。预发 C000001 使用只限此仓库的独立、最小权限 token，绝不复制生产凭据。**创建仓库和 token 尚未授权执行**，由整合负责人取得用户批准后实施。

## 尚待补入的生产现场表

| 项 | 当前结论 | 待读取证据 |
| --- | --- | --- |
| Runtime / Console / Gateway 版本 | Runtime `0.3.219` / `c11c7c66-dirty`；Console Worker `81f79fbb-e90e-4133-b028-e337cf06fb3b`；Gateway Worker `03f345e2-a300-411d-b7c5-9d8154f3e1fb` | Runtime health 与 Wrangler active deployment；Console/Gateway 代码提交与业务健康待核 |
| Cloudflare 账户套餐 | 未核实 | 账户只读 billing 设置；当前未调用计费 API |
| Workflow / Assets 部署 | 两个 Worker 均有 100% active 版本：Workflow `20bfe9f9-cb50-48ce-9a43-305d9dedb388`，Assets `89015190-d624-4f0d-b0e1-60e3ef8c2647` | Wrangler active deployment；业务健康/生产租户绑定待核 |
| 生产 service grant | 未核实 | 只读聚合计数与 audience/绑定缺口，不输出 scope_json 原文 |
| 已删 Host 服务资源的角色孤儿行 | 未核实；本机 dev Platform 的 74 个 `(app_code, resource_code)` 在三表均为 0 | **批 3 生产 release 前置门禁：**生产库 `tenant_role_permissions`、`tenant_role_scopes`、`platform_app_role_permissions` 对这 74 对资源覆盖所有租户的命中必须均为 0；只读聚合输出表、租户、资源、计数，不选凭据或密文列。任一非 0 即停止 release，先裁定清理或兼容方案。 |
| GitLab 集成与凭据来源 | 未核实 | 生产元数据列，不选择密文/引用值 |
| Host Worker 出站 GitLab | 本机 GET 到达入口得 401；Worker 出站未核实 | 测试 Worker 无凭据状态码与网络配置 |
| 现成可清理测试仓库 | 拟用名称的无凭据公开搜索 0 项；私有库未核实 | GitLab 测试命名空间有权只读列表 |

## P1/P2 只读核对结果（2026-09-28 17:25–17:35 UTC，Claude 执行）

**通道**：用户授权使用现有凭据（生产 MySQL 与测试库同口令；Cloudflare 用本机已登录 wrangler 账号）。生产库 `oa.wiztek.cn:3306`（`@@hostname=vultr.guest`，MySQL 8.0.45），每个会话 `SET SESSION TRANSACTION READ ONLY`（回读 `transaction_read_only=1`）；Cloudflare 仅 GET/GraphQL 读取，令牌不落盘、不打印。原始证据（脱敏文本/JSON）存本机 `~/Library/Application Support/HuizhiYun/go-live/20261008/prod-readonly/20260928T172*/`，不入库。库名：Console `hzy_console`、Platform `hzy_platform`、Workflow `hzy_workflow`、Aims `hzy_aims`；生产租户为 **C000001**（`wiztek.huizhi.yun`），清单 §08 中的 `wiztek` 应读作 C000001。

| 清单项 | 结论 | 要点 |
| --- | --- | --- |
| 01 环境/制品（G1） | **不通过（预期）** | Runtime 仍为 `0.3.219`/`c11c7c66-dirty`（deployment `c000001-prod-tenant-runtime`，10 个应用 db ok）；Gateway `03f345e2`（9/07）、Console `81f79fbb`（9/10）、Workflow `20bfe9f9`（9/22）、Aims `c8444e4e`（9/01）。生产无 `hzy-enterprise` Worker 与 enterprise 部署。上线制品替换后复核。 |
| 02 B3 74 对孤儿行 | **通过** | 生产 `hzy_platform` 三表全租户 0 行（清单 SQL 需给 JSON_TABLE 列加 `COLLATE utf8mb4_unicode_ci`，已修正清单）。 |
| 03 B4 旧精确 grant | **不适用** | 生产无 `enterprise.runtime` 客户端，也无任何 `*:enterprise-host:*` grant；v2.28 撤销在生产无对象。生产需要的是**新建** `enterprise.runtime` 身份与五域 grant（写入，另批）。 |
| 04 Workflow effects grant | 部分 | `workflow.read/write` 仅 `workflow.runtime` 持有（data-/tenant-runtime 各 1）；无 `workflow:integration_operation:execute` 精确 grant（只有宽 `integration_operations execute`），P4 需补。实际请求审计无可用数据源 → 调用方“证据不足”，但持有者唯一。 |
| 05 GitLab 凭据（GL） | **通过** | `gitlab.default` active/healthy；当前凭据 17（v5）→ secret `integration.gitlab.default.bot_token`，`storage_backend=db_encrypted`、`aes256-gcm`、有 key fingerprint、版本 active。出站仍待 P3。 |
| 06 Workflow 迁移（G5/G6） | **不通过（待迁移）** | 012、013、014 verify 全部 FAIL（生产 Workflow 库尚未执行 012 起任何迁移）。进行中实例 2：altoc/customer/approve（2026-04-14）、codocs/documents/publish（2026-05-16），均为陈旧实例。上线窗口须按序执行 012→013→014 并先备份。 |
| 07 Cloudflare 套餐/CPU（G3） | **证据不足 + 风险** | 账户 `subscriptions` API 对 OAuth 返回 403，Workers 套餐需用户在控制台截图；zone `huizhi.yun` 为 Free Website。近 30 天 `exceededResources`：`hzy-console-prod` 7,895 次（约 3.9%）、`hzy-workflow` 1,855 次（约 15%）；Gateway `scriptThrewException` 2,895 次（约 1.8%）。CPU p99 日峰值 Workflow 124 ms、Console 118 ms。按日拆分：被 `exceededResources` 终止的调用 CPU 中位数**恒为 10 ms**（两 Worker 每天一致），而成功请求中位数 Workflow 40–60 ms、Console 8–18 ms；这与 Workers **免费套餐 10 ms CPU 上限**的特征一致（推断，待套餐截图确认）。Console 超限近 5 天升至每天 600–1,200 次。**G3 在确认/升级到 Workers Paid 之前不能通过**。 |
| 08 调度（G3/G5） | 部分 | eligible 站点 N=2（C000001 prod/test），均在 shard 0；Gateway cron `*/5 * * * *`、`SHARD_COUNT=1`，**未设 `MAX_WAKES`（默认 8，N=2 推荐 28）**。生产 Platform 无 `tenant_scheduler_*` 表（P4 需先迁移 schema）。 |
| 09 Aims 入口 | **不符（预期）** | `hzy-aims` 绑定自定义域 `aims.huizhi.yun`、workers.dev 与 Preview 均开启、cron `15 2 * * *`；Gateway `HZY_AIMS_SERVICE → hzy-aims` 正确。`hzy-test-aims` workers.dev/Preview 已关、无 cron。 |
| 10 Aims 30 天来源 | **有非内部流量，P5 关闭 `/aims` 代理须先停** | 29 天 zone 分析：经 Gateway `wiztek.huizhi.yun/aims` 页面 GET 200 约 2,100、API GET 200 约 1,180、POST 200 约 680（真实用户）；`aims.huizhi.yun` 直连约 1 万次绝大多数为扫描（`/wp/`、`/wordpress/` 等）返回 403/302。 |
| 11 aims.runtime | 存在 | 客户端 active、凭据 v1 active（2026-04-30）、secret `svc.aims.runtime.client_secret` 为 `env_ref`；已有 `aims:integration_operation:execute` 双 audience，**无 `milestone-rollover`、`notifications-due` grant**。 |
| 11b workflow.read 持有者 | **通过** | 仅 `workflow.runtime`。 |
| 11c 排序规则/LDAP | **非阻断** | 所有 `hzy_*` 库默认 `utf8mb4_unicode_ci`（临时表继承即一致）；`directory.ldap` 集成 active/healthy，制品含 `61d36f99` 修复即可。 |

**需用户/后续决定**：①Workers 套餐截图（G3）；②`exceededResources` 高占比先定位再定 CPU 预算；③Gateway `MAX_WAKES` 按 N=2 设 28（生产写入）；④P5 不能在 Host 替代 `/aims` 前关闭 Gateway 公网代理；⑤生产写入清单：Workflow 012–014、`enterprise.runtime` 身份与五域 grant、Workflow/Aims 调度精确 grant、Platform scheduler schema/登记——均逐项另批。
