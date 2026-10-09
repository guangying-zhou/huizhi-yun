# 旧 Wiztek Cloudflare 定时任务收口记录

执行日期：2026-10-07。用户批准停用旧租户自有 cron，不删除 Worker 或数据；归档入口取消，需要时只读导出。

## 备份

加密备份：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/legacy-cloudflare-cron-20261007T201929.json.enc`。

AES-256-CBC / PBKDF2 / 200000 次迭代；解密全流与原始字节一致。原始 SHA-256：`28991d19f9ad9d6e1481b23f6556add44744433cd1c14c1eaeb6f2374a6425d3`。包含十个 Worker 的 settings、schedules、deployments，三个相关 Worker 源码及本地 Wrangler 配置。密钥沿用受保护备份配置，不进入仓库。

## 实际处置

| Worker | 执行前 cron | 执行后 | 依据 |
| --- | --- | --- | --- |
| hzy-aims | `15 2 * * *` | 空数组 | 已删除，API 回读 0 条 |
| hzy-tenant-gateway | `*/5 * * * *` | 保留 | 实际调用 Platform 多租户 scheduler-page；不能按默认租户判断独占 |
| hzy-console-prod | `*/5 * * * *` | 保留 | managed-cloud-multitenant 共享进程，不盲停共享 Console |
| hzy-test-gateway | `0 16 * * *` | 保留 | 不属旧 Wiztek 范围 |
| altoc/finance/people/workflow/assets/codocs | 无 | 无 | 无需操作 |

Aims API 写入时间：`2026-10-07T20:22:10.185Z`。只调用 schedules PUT，未部署源码、删除 Worker 或改数据库。

## 旧租户不再被机器调度的依据

线上 Gateway `loadSchedulerPage` 使用 Platform 正式 registry，`HZY_DEFAULT_TENANT=wiztek` 不限定调度范围。Platform 只读查询 active deployment_sites 与 active tenants，当前仅 C000001/test（hzy-test.huizhi.yun）和 C000001/prod（aidcp.wiztek.cn），没有旧 wiztek。删除全局 Gateway cron 会影响这些站点，故保留。

Console 实际配置：后台任务关闭、Platform heartbeat 关闭；lifecycle sync 开关保留。线上编译产物仅有 Nitro 通用 scheduled dispatcher，没有注册 scheduled hook、runCronTasks 或 scheduledTasks。未发现旧租户 cron 业务执行入口，保留共享触发器。

Aims 线上产物同样未注册 scheduled hook；本次仍删除遗留触发器，防止未来恢复任务代码后重新运行。

## 验证范围与后续观察

已验证 Aims schedules 为空，旧 wiztek 不在 Gateway 有效调度站点中。此结论是配置和代码核查，**尚未取得 Cloudflare 执行遥测证明“无新执行”**。Cron 配置传播可能延迟；不得将一次回读等同于执行历史。后续应在 Cloudflare Observability 按 Worker 和 scheduled 类型确认变更生效后的新执行数量。

## 回滚

使用既有受保护 Wrangler OAuth，在进程内加载；调用 Cloudflare API：

`PUT /accounts/6cf3948db481580745329253415d59d3/workers/scripts/hzy-aims/schedules`

请求正文：`[{"cron":"15 2 * * *"}]`。GET 同路径核对唯一 cron；Gateway、Console 和 test Gateway 无写入，无需回滚。API 正文为数组，见 [官方 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/update/)。

## 防复活与限制

本次未修改通用 Aims Nuxt scheduledTasks 配置，避免影响现存自托管与测试使用方。今后不得直接重新部署旧 hzy-aims 并恢复 Wrangler cron；如需要重新部署，必须保持线上 schedules 为空并回读验证。未创建归档域名、别名或 OIDC 回调。

hzy0 未连接数据库，未停服或切进程；生产自托管服务及其定时任务均未修改。

## 二次回读（2026-10-07T20:41:07.349Z）

距 Aims 删除已超过 15 分钟，十个 Worker 触发器再次回读与上表一致：Aims 0，六个其它旧业务 Worker 0；共享 Gateway/Console 与 test Gateway 保持原 cron。受保护证据：`.git/legacy-cron-current-readback.json`。

Cloudflare GraphQL workersInvocationsAdaptive 查询从 20:37:10Z 起有 1 次 Aims 调用（20:40:30Z）。该数据集没有触发类型字段，无法区分 HTTP 与 scheduled，不能据此认定有新 cron 或证明无新 cron。证据：`.git/legacy-cron-telemetry-readback.json`。已取得配置传播等待后的空触发器证明；执行级分类证明仍待 Observability 可用数据。
