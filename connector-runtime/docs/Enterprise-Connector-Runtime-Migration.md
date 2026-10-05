# Notification Runtime → Enterprise Connector Runtime 迁移契约

状态：APPROVED（Phase 0）  
契约版本：`hzy.connector-runtime-migration.v1`

本契约约束现有 `hzy-notification-runtime` 向 `hzy-connector-runtime` 的显式迁移。普通自动升级不得静默重命名服务、切换 audience/scope 或创建一份空的投递账本。

## 不变量

- 保留 `POST /v1/notifications/send`、`GET /v1/deliveries` 与 `POST /v1/deliveries/{deliveryId}/reconcile` 的请求、响应、幂等、lease/fencing 和 `partial_unknown` 语义。
- 迁移复制并校验现有 delivery ledger；不得把供应商凭证、access token、完整消息或 PII 写入迁移状态。
- Provider 目标由编译期策略限定；安装参数、Integration 配置和 API 请求都不能提供任意 URL、method 或 headers。
- 供应商长期凭证继续只保存在 Console Vault。Runtime 只按获授权的 `integrationCode` 在内存中短期解析。
- 新 Runtime 通过健康、能力和通知兼容检查前，旧服务与二进制必须保留且可恢复。

## 显式迁移流程

1. 预检旧服务版本不低于 `0.1.6`，健康检查通过，账本 schema 完整。
2. 阻止新切换请求，等待当前 `processing` lease 结束；`partial_unknown` 可以保留，但必须完整迁移。
3. 停止旧 updater，创建 SQLite/MySQL 账本的一致性备份并记录 SHA-256；不要删除旧服务。
4. 校验 Connector Runtime 发布签名和包哈希，安装到独立路径和 systemd service。
5. 将账本迁移到 `/opt/hzy/connector-runtime/data/operations.db`，校验记录数、状态分布和不可变 request hash。
6. 验证安装时锁定的 data-runtime origin：分机部署使用 HTTPS，同机部署才允许 loopback HTTP；使用目标 service identity 验证 `/runtime/health`、`/runtime/capabilities` 和三条兼容 API，并验证 `arbitraryHttpProxy=false`。
7. Console 显式切换 Runtime URL/audience/scope，执行同 idempotency key 的成功 replay；第二次响应必须明确返回 `replayed=true`，确认由持久账本重放且不会再次调用供应商。
8. 稳定一个发布周期后，才允许停用旧 timer/service；旧备份按租户审计保留策略处理。

## Scope 映射

| 兼容操作 | 旧 scope | 新 scope |
| --- | --- | --- |
| 通知发送 | `notification-runtime:send` | `connector-runtime:notifications:send` |
| 投递查询 | `notification-runtime:deliveries:read` | `connector-runtime:deliveries:read` |
| 人工对账 | `notification-runtime:deliveries:reconcile` | `connector-runtime:deliveries:reconcile` |

迁移窗口内，新 Runtime 可以明确接受旧 audience/scope 作为兼容入口，但必须映射到同一类型化 capability，并记录调用采用的是 legacy 还是 target contract。兼容不等于通配授权，三种能力仍互不蕴含。

## 回滚

目标服务健康、capability、账本或通知 replay 任一检查失败时：停止目标服务，恢复切换前 Console 参数和旧 updater/service，使用原账本启动并再次执行健康检查。不得把目标服务运行期间产生的新 ledger 行直接覆盖回旧账本；若已经放量，必须先进入维护窗口按 delivery identity 合并并复核 `processing/partial_unknown`，否则保持目标服务隔离并人工处理。

可机读事实源位于 `notification-runtime/internal/migration/connector-runtime.v1.json`，迁移器和 Console 生成指令必须以该版本化契约为输入，不得从本文自由推断步骤。
