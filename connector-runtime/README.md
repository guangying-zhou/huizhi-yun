# Enterprise Connector Runtime

`hzy-connector-runtime` 是安装在租户自有 Linux 服务器上的固定出口连接组件。它不是通用 HTTP 代理，只执行编译进产品、经过版本化的企业连接能力。

Phase 1–5 已提供：

- 企业微信 textcard 通知：`POST /v1/notifications/send`
- 脱敏 delivery 查询：`GET /v1/deliveries`
- 证据支持的 `partial_unknown` 对账：`POST /v1/deliveries/{deliveryId}/reconcile`
- `hzy.connector-capabilities.v1`：`GET /runtime/capabilities`
- 企业微信登录身份交换：`POST /v1/identity/wecom/exchange`
- 企业微信租户 Connector 固定域回调登录：`POST /v1/identity/wecom/authorizations`、`GET /v1/identity/wecom/callback`、`POST /v1/identity/wecom/handoffs/redeem`
- 钉钉登录身份交换：`POST /v1/identity/dingtalk/exchange`
- 钉钉工作通知：复用 `POST /v1/notifications/send` 的类型化 `channel=dingtalk`
- 钉钉组织与 People 异步同步：`POST /v1/people-sync-jobs`
- 异步任务进度：`GET /v1/people-sync-jobs/{jobId}`
- 运行中任务取消：`POST /v1/people-sync-jobs/{jobId}/cancel`
- 失败任务幂等重试：`POST /v1/people-sync-jobs/{jobId}/retry`
- 聚合运行诊断：`GET /v1/diagnostics`
- 60 秒设备心跳、管理端吊销与单次 enrollment 轮换

通知首次成功返回 `replayed=false`；完全相同的 tenant、deployment、source app、
idempotency key 与请求内容再次提交时，Runtime 从持久账本返回原结果并标记
`replayed=true`，不会再次调用供应商。相同 key 但内容不同继续返回 409。

目标 scope：

```text
connector-runtime:notifications:send
connector-runtime:deliveries:read
connector-runtime:deliveries:reconcile
connector-runtime:identity:exchange
connector-runtime:identity:dingtalk:exchange
connector-runtime:people:sync
connector-runtime:jobs:view
connector-runtime:jobs:cancel
connector-runtime:diagnostics:view
connector-runtime:directory:sync
```

安装命令必须从 Console“企业连接运行时”页面生成。命令只携带 15 分钟有效、单次使用的 enrollment code，不携带长期 client secret。Runtime 在本机生成 RSA-3072 工作负载私钥，兑换一次性凭据后将私钥和环境文件以 0600 保存。

默认单实例 SQLite：

```text
/opt/hzy/connector-runtime/data/operations.db
```

企业微信和钉钉长期凭证仍只保存在 Console Vault；Runtime 按固定的
`integrationCode=wecom.default|dingtalk.default` 临时解析。Provider 网络目标固定为代码审核过的
企业微信/钉钉官方 HTTPS origin，Integration 配置不能覆盖为其他 origin。

浏览器登录只把当前租户登记的 Connector Runtime 公网域名作为企业微信授权回调域。每个租户
仍需在自己的企业微信应用中单独配置该域名，并在 Console 单独维护本租户的企业微信应用参数与
Vault 凭证；wiztek 验证环境使用的 `wecom-api.wiztek.cn` 不是其他租户的全局默认值。Console
先创建五分钟授权事务；Runtime 仅保存 state 与交接码的 SHA-256，回调消费一次性 authorization code 后
生成单次交接码并跳回租户 Console。Console 用 tenant/deployment 绑定的服务令牌兑换规范化的
`provider/integrationCode/subject{id,kind}`。authorization code、企业微信 access token、
原始 provider 响应及完整用户资料不会写入操作账本或返回 Cloudflare，provider subject 也不会
出现在浏览器 URL。Console 登录 state 同时使用数据库中 SHA-256、浏览器绑定、tenant/deployment
绑定和单次消费；禁用的外部身份或目录用户必须失败关闭。

钉钉 People 同步只由 Console 获授权操作人显式提交，不启用周期全量任务。Connector 在企业侧
分页读取固定通讯录 API（含员工入职日期），并从 HR 离职接口读取明确的待离职/已离职状态、
最后工作日和离职原因；不得把通讯录缺失推断为离职。批次用本机 RSA 工作负载私钥签名后，仅调用安装指令锁定的
data-runtime 精确内部路径。与 data-runtime 分机部署时必须使用 HTTPS origin；仅显式同机部署可使用
loopback HTTP。Connector 不持有 Console 或 People 数据库账号。data-runtime
只接受当前租户登记且 active 的 Connector 公钥，先同步稳定部门参照，再把员工/任职事实写入
People。既有钉钉身份或唯一且无歧义的邮箱会复用原 Directory uid；新入职员工生成稳定内部 uid；从未被
系统管理的历史离职人员不会反向创建账号。People 再通过 durable lifecycle operation 创建或启用
Directory 用户/钉钉身份，或在离职生效日停用账号并撤销本地会话。
运行中任务可以单独授权取消；取消只阻止后续分页和批次，不回滚已成功写入的幂等批次。
失败重试生成带 `retryOfJobId` 的新任务，沿用原 watermark 和对象范围；同一失败来源的提交
重放返回同一个重试任务，不会因网络确认丢失重复执行。
Connector 等待 data-runtime 批次回执的默认 HTTP 超时为 30 秒，以覆盖最终批次触发
Platform subject projection 的正常处理时间；Console 到 data-runtime 的该类型化内部调用
使用 20 秒超时并为外层响应保留余量。Connector 超时可用
`HZY_CONNECTOR_RUNTIME_CONSOLE_TIMEOUT_MS` 显式调整。超时只能判定本次客户端确认未知，
不能推断服务端未处理，重试必须继续依赖 operation ID 与批次 hash 幂等。
组合任务中的钉钉资料回调只更新 Directory 的 `real_name/display_name` 并记录任务进度，且必须
在 People 批次成功之后执行。入职、离职、身份、部门和成员关系由 People lifecycle 处理；
Platform subject 投影不包含姓名，因此姓名回调不会同步重建 Platform 投影。

Runtime 每 60 秒用独立 `console:connector-runtime:heartbeat` 服务权限向 Console 上报版本、能力和
聚合状态计数。管理端可吊销实例；Console 会同时撤销登记、公钥信任、未使用安装码、service
credential 和 grants。心跳业务请求收到 401/403 时，Runtime 先淘汰缓存 Token、重新执行一次
`client_credentials` 并只重试一次；新 Token 仍被拒绝，或 Token 端点直接拒绝当前 client
credential 时，才以身份撤销状态停止。诊断接口只返回版本、绑定和本地 SQLite 状态聚合，
不返回用户、消息正文、provider subject、token 或 secret。轮换通过新的 15 分钟单次安装指令
完成，新 enrollment 成功前旧实例保持运行。

Runtime 复用心跳已经读取的聚合快照，每 5 分钟向本机 journald 写一条
`connector_runtime_slo_snapshot` 结构化记录；这不会增加 Cloudflare 请求或再次扫描 SQLite。
记录只包含版本、tenant/deployment 绑定、SQLite 文件大小以及通知/People job 的状态计数。
企业 IT 管理员也可以即时读取相同的脱敏快照：

```bash
sudo -u hzy-connector \
  bash -c 'set -a; source /opt/hzy/connector-runtime/.env; set +a; hzy-connector-runtime -slo-snapshot'
```

该命令和 journald 记录都不得输出消息正文、收件人、URL、provider subject、幂等键、token 或 secret。

安装包还提供只读时间窗口验收。默认要求最近一小时内至少 4 个快照、首尾覆盖至少 15 分钟、
租户/runtime 绑定不漂移、全部快照可用、通知与 People job 总量不倒退且 systemd 自动重启次数为 0；
窗口内的计划版本升级会作为首尾版本报告，不被误判为租户绑定漂移：

```bash
sudo /opt/hzy/connector-runtime/verify-slo-window.sh
```

可通过 `HZY_CONNECTOR_RUNTIME_SLO_SINCE`、`HZY_CONNECTOR_RUNTIME_SLO_MIN_SNAPSHOTS`、
`HZY_CONNECTOR_RUNTIME_SLO_MIN_WINDOW_SECONDS` 和 `HZY_CONNECTOR_RUNTIME_SLO_MAX_RESTARTS`
调整内部观察窗口。脚本只读取 `connector_runtime_slo_snapshot` 的白名单字段，遇到额外字段、
不可用快照、绑定漂移、计数倒退或重启超限时失败关闭；输出仍不包含用户、消息或凭证。

发布包和 `latest.json` 使用独立 Ed25519 发布密钥签名。Console 生成安装指令时把受信公钥
作为 base64 trust anchor 放入命令；安装脚本执行前先在本机验证安装器签名，安装器随后验证
manifest、keyId、归档签名和 SHA-256。自动升级只信任安装到
`/etc/hzy-connector-runtime/release-signing-public.pem` 的公钥，不从下载站动态接受新公钥。

首次建立发布密钥（私钥不得提交到仓库或上传到 Console）：

```bash
connector-runtime/scripts/generate-release-signing-key.sh "$HOME/secure/hzy-connector-runtime-release"
export HZY_CONNECTOR_RUNTIME_RELEASE_SIGNING_KEY_FILE="$HOME/secure/hzy-connector-runtime-release/release-signing-private.pem"
export HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_PEM_BASE64="$(base64 < "$HOME/secure/hzy-connector-runtime-release/release-signing-public.pem" | tr -d '\\n')"
```

私钥环境变量仅用于本地/R2 发布；公钥 base64 配置到 Console Cloudflare Worker 后，企业 IT
管理员才能生成可验证的一键安装命令。

安装器完成 systemd 启动后会自动执行脱敏验收；也可随时手工复核：

```bash
sudo /opt/hzy/connector-runtime/verify-installation.sh
```

验收覆盖服务/timer、文件权限、精确版本、SQLite、tenant/deployment、JWT、固定 data-runtime origin、全部类型化 capability/scope、provider origin 白名单、`arbitraryHttpProxy=false` 以及 data-runtime 未签名请求的预期 `401` 失败关闭边界。输出不包含 enrollment code、client secret、provider token 或业务数据。

现有 Notification Runtime 必须按 `docs/Enterprise-Connector-Runtime-Migration.md` 显式迁移，不允许普通自动升级静默切换。

安装并配置新 Runtime URL 后，在维护窗口执行：

```bash
sudo /opt/hzy/connector-runtime/migrate-notification-runtime.sh
```

脚本只自动处理单机 SQLite：先停止两个服务并冻结旧账本，备份目标账本，复制 delivery 事实，验证 schema、health、capabilities 与精确 scope 后保持新服务运行。任一检查失败会恢复目标备份并重新启动旧服务。MySQL 不做自动推断，必须按受控数据库迁移执行。

发布：

```bash
HZY_CONNECTOR_RUNTIME_RELEASE_SIGNING_KEY_FILE="$HOME/secure/hzy-connector-runtime-release/release-signing-private.pem" \
connector-runtime/scripts/package-release.sh

# 先预览，记录 confirmationSha256；预览不执行任何网络写入。
connector-runtime/scripts/upload-r2.sh 0.4.3 --stage

# 使用刚才预览的摘要确认值，仅上传不可变版本目录。
connector-runtime/scripts/upload-r2.sh 0.4.3 --stage \
  --execute --confirm '<stage-confirmation-sha256>'

# 暂存对象全部通过远端哈希校验后，再预览并提升 latest 别名。
connector-runtime/scripts/upload-r2.sh 0.4.3 --promote
connector-runtime/scripts/upload-r2.sh 0.4.3 --promote \
  --execute --confirm '<promote-confirmation-sha256>'
```
