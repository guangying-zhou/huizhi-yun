# Enterprise Connector Runtime SLO 与运维基线

状态：wiztek 内部验证基线（2026-07-14）。达到真实租户验收前，不作为付费 SLA 承诺。

## 服务目标

| 能力 | 内部目标 | 失败语义 |
| --- | --- | --- |
| 安装与登记 | 标准 Linux 主机 10 分钟内完成；安装码 15 分钟单次有效 | 任一签名、绑定或健康检查失败即停止，不保留安装码 |
| 设备心跳 | 默认 60 秒；Console 超过 3 分钟未见心跳标记为 stale | 心跳业务请求的 401/403 先淘汰缓存 Token、重新认证并只重试一次；新 Token 仍被拒绝或 Token 端点拒绝 client credential 时，Runtime 才以状态 78 停止；systemd 不自动重启该状态，普通网络错误本地记录并继续重试 |
| 设备吊销 | 管理员操作后 2 分钟内停止新的 Connector 能力调用 | 同事务吊销实例、未用安装码、service credential 和 grants |
| 同步任务提交 | Console 请求 p95 小于 2 秒并返回 202 | Cloudflare 只提交/查询，不等待供应商分页 |
| 同步任务控制 | 取消/失败重试请求 p95 小于 2 秒；同来源重试提交幂等 | 取消不回滚已写入批次；只有 failed 可重试，其他状态 409 |
| 钉钉 People 同步 | 单任务最长 30 分钟；每批最多 500 人进入 data-runtime；Console 内层回执等待 20 秒、Connector 外层等待 30 秒 | 批次 hash 冲突 409；同 hash 成功重放零写；HTTP 超时只表示客户端确认未知，重试仍依赖 operation ID 与批次 hash 幂等 |
| 通知投递 | 保留既有 ledger 幂等与 `partial_unknown` 对账 | 不把超时推断为成功，不自动重复产生不可判定副作用 |
| 诊断 | 10 秒内返回健康、版本和聚合状态计数 | 不返回用户、消息正文、provider subject、token、secret 或内部错误详情 |

## 计量边界

首版只采集本机 SQLite 聚合量：通知各状态累计数、People job 各状态累计数和数据库文件大小。
心跳按 tenant/deployment/connector 绑定写入 Console `connector_runtime_instances.metrics_json`。
这些数据用于容量评估和故障诊断，尚不直接生成账单；正式计费前必须增加按周期不可篡改的
usage bucket、迟到数据处理、退款/冲正和租户可核对明细。

钉钉组合任务中的目录资料回调只修改 Console Directory 的 `real_name/display_name`，并记录
同步任务进度；它必须发生在对应 People 批次成功之后。入职日期、待离职、离职日期/原因、部门和钉钉身份由
People 事实与 durable Directory lifecycle operation 处理，资料回调不得越权修改这些字段。
Platform subject 投影不包含姓名，因此姓名回调不得触发无关的 Platform 重建；账号状态与授权
变化由 lifecycle 的 Console → Platform 下一跳处理。

Connector Runtime 同时复用每分钟心跳已经读取的同一聚合快照，每 5 分钟向本机 journald 写入
`connector_runtime_slo_snapshot` JSON；不新增 Cloudflare 调用，也不为观测再次扫描 SQLite。
`hzy-connector-runtime -slo-snapshot` 可按需输出相同的当前快照。两种输出都只允许版本、
tenant/deployment/runtime 绑定、采集时间、数据库字节数和状态计数，禁止消息正文、收件人、URL、
provider subject、幂等键、token、secret 及供应商原始响应。内部验证期可用 journald 时间序列观察
容量与状态变化；它不替代正式计费所需的不可篡改 usage bucket。

发行包安装只读窗口验收脚本：

```bash
sudo /opt/hzy/connector-runtime/verify-slo-window.sh
```

默认读取最近一小时，要求至少 4 个快照且首尾覆盖至少 15 分钟；所有快照必须可用，
`runtimeId/tenant/deployment` 不得漂移，通知与 People job 总量不得倒退，systemd `NRestarts`
不得超过 0。计划内版本升级允许出现在窗口中，并以首尾版本报告。脚本只接受上述脱敏 schema
的白名单字段，遇到额外字段或敏感键时失败关闭。

## 设备身份与轮换

- 每次 enrollment 在客户服务器生成 RSA-3072 私钥，私钥不上传 Console。
- “生成轮换指令”创建新的短期单次 enrollment；兑换成功后原 service credential 被 retire，
  Connector 公钥原子替换。旧实例在新 enrollment 成功前仍可运行。
- “吊销实例”立即把登记、公钥信任、service credential 和 grants 一起撤销；恢复必须重新安装。
- systemd 必须声明 `RestartPreventExitStatus=78`；被吊销身份不得因 `Restart=always` 形成认证风暴。
- 监控必须同时告警“超过 3 分钟未见心跳”和 systemd `status=78`；不得依赖人工进入同步页才发现停机。
- Console 后台刷新不得清除尚未过期的一次性安装/轮换指令；实例状态改变、指令过期或兑换成功后必须清除。
- 供应商 AppSecret/CorpSecret 轮换独立于设备轮换，仍由 Console Vault 管理。

## 发布与回滚

1. 先执行 Console migration/seed 和 People schema migration。
2. 再发布 Console/Platform/Tenant Gateway，确认 enrollment、heartbeat 和 diagnostics API。
3. 发布 data-runtime 后验证 loopback 签名和 People receipt。
4. 最后发布 Connector Runtime，并在 wiztek 执行登录、通知、同步、吊销和轮换验收。
5. Notification Runtime 迁移继续使用显式迁移脚本；失败恢复旧 service 与 SQLite 账本。

任何步骤不得在没有 clean release manifest、独立 Ed25519 签名 key、Console 已配置的公钥
trust anchor、回滚窗口和真实测试账号时直接扩大到付费租户。安装命令必须先验证
`install.sh.sig`，安装器和 updater 必须验证 manifest 与归档签名；只校验同源 SHA-256
不视为发布真实性校验。
