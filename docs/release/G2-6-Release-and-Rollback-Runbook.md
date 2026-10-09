# G2-6 发布与回滚演练手册

状态：离线准备完成，真实演练待发布负责人、数据库负责人和租户负责人授权。

本手册只使用仓库内版本化指令和 Cloudflare Wrangler 指令，不依赖
GitLab Runner。除 Platform 外，Console、Tenant Gateway、People 和业务
Worker 走 Cloudflare；`wiztek` 的 Platform 因企业微信固定出口 IP 约束，
按模块规则继续使用 PM2/Nginx，除非另一个已锁定发布合同明确批准例外。

## 1. 不可跳过的安全边界

- 所有真实部署、数据库 seed、bundle 生成/刷新和回滚都必须绑定 change ID。
- 发布合同必须为 `locked`，各仓库 target commit 必须 clean 且与合同一致。
- 不在命令行、计划或证据文件中写 token、cookie、密码、Authorization 或 secret。
- Cloudflare 回滚必须使用发布前记录的精确 version/deployment ID，不能写“上一版”。
- data-runtime 回滚必须锁定上一版 artifact SHA-256，并先暂停或钉住自动更新通道。
- data-runtime package、installer 和 manifest 必须通过服务器独立预置的 Ed25519 公钥验签；R2 不得提供或替换信任根。
- 失败立即停止并记录 `partial_or_unknown`；不自动重试，也不自动猜测回滚目标。
- 回滚是独立变更：重新生成计划摘要、重新审批，演练后再显式 roll-forward。

## 2. 生成离线发布计划

不提供 snapshot 时，命令只列出缺失的远端锚点：

```bash
corepack pnpm run plan:g2-6-release -- \
  --operator <operator-uid> \
  --change-id <change-id> \
  --plan-file build/release/g2-6/plan.json
```

计划文件以 `0600` 写入。命令不运行 build、release check、Wrangler、数据库
客户端或 HTTP 请求。远端只读盘点完成后，把下列结构保存为受控的离线 snapshot，
再重新生成计划；文件中只能放版本、哈希、状态和 ID：

```json
{
  "releaseId": "P3-P4-2026-07",
  "tenant": "wiztek",
  "environment": "production",
  "schema": { "businessFactsFingerprint": "<sha256>" },
  "dataRuntime": {
    "currentVersion": "<exact-version>",
    "currentArtifactSha256": "<sha256>",
    "targetArtifactSha256": "<sha256>",
    "signingKeyId": "<trusted-public-key-sha256>",
    "autoUpdateState": "pinned"
  },
  "platform": { "releaseId": "<release-id>" },
  "cloudflare": {
    "console": { "deploymentId": "<id>" },
    "gateway": { "deploymentId": "<id>" },
    "people": { "deploymentId": "<id>" },
    "assets": { "deploymentId": "<id>" },
    "codocs": { "deploymentId": "<id>" },
    "finance": { "deploymentId": "<id>" },
    "aims": { "deploymentId": "<id>" },
    "altoc": { "deploymentId": "<id>" }
  },
  "serviceGrants": { "fingerprint": "<sha256>" },
  "policyBundle": { "version": "<version>", "sha256": "<sha256>" }
}
```

```bash
corepack pnpm run plan:g2-6-release -- \
  --operator <operator-uid> \
  --change-id <change-id> \
  --snapshot-file <reviewed-snapshot.json> \
  --plan-file build/release/g2-6/plan.json
```

`confirmationSha256` 变化表示合同、源码、seed、目标版本、回滚锚点或执行上下文
发生变化，原审批不得复用。

## 3. 固定执行顺序

| 阶段 | 组件 | 进入条件 | 必须记录 | 退出验证 |
| --- | --- | --- | --- | --- |
| 0 | release contract / release check | 合同 locked、仓库 clean | commit、合同 SHA、执行人、change ID | `release:check` 通过 |
| 1 | schema 前置 | 已备份、仅增量迁移 | schema SHA、前后版本、业务事实指纹 | 迁移 verifier 通过 |
| 2 | data-runtime | 精确包版本/SHA、自动更新 pinned | current/target version、artifact SHA | health、version、tenant、deployment、schema probes |
| 3 | Platform / Console | runtime 验证通过 | Platform release、Console 前后 CF ID | diagnostics、授权基础读取 |
| 4 | service grants / bundle | Console 已稳定 | grant diff/指纹、bundle 前后版本和 SHA | mint/call 正负例、refresh `code=0` |
| 5 | Tenant Gateway | 控制面与授权验证通过 | gateway 前后 CF ID | 旧路径矩阵、header 防伪、People 路由 |
| 6 | People | Gateway 验证通过 | People 前后 CF ID | G2-2 只读 canary |
| 7 | Assets → Codocs → Finance → Aims → Altoc | 被调用方先就绪 | 每个 Worker 前后 CF ID | 每步只读 canary；环路兼容探针 |
| 8 | G2 验收 | 所有组件稳定 | request ID、业务键哈希、结果 | G2-3/G2-5 严格验收 |
| 9 | 回滚演练 | 单独审批、精确锚点 | rollback/roll-forward ID、主档指纹 | runtime 与 gateway 均恢复目标版本 |

阶段 2 之前的 schema 是部署前置条件，不改变“runtime → 控制面 → Gateway →
People → 业务桥接”的应用发布顺序。

## 4. Cloudflare 版本化指令

应用 Worker 使用模块已存在且固定 `wrangler@4.110.0` 的门禁：

```bash
corepack pnpm --dir console run verify:cloudflare-deploy
corepack pnpm --dir console run deploy:cloudflare
```

People 和业务模块把 `console` 替换为对应目录，并严格按阶段表顺序执行。
每次部署前后都要读取并保存目标 Worker 的 deployment/version ID；不得只保存
Wrangler 完整 stdout，也不得把 secret 或内部 URL query 写入证据。

Tenant Gateway 使用专用安全入口。默认 preview 不运行命令；输出顺序、固定配置、
固定 Wrangler 版本和确认 SHA：

```bash
corepack pnpm run gateway:release -- \
  --action deploy \
  --operator <operator-uid> \
  --change-id <change-id>
```

真实 deploy 必须在计划摘要和目标 account/worker/route 经人工复核、发布合同 locked
后执行；命令先运行 Gateway tests 和 Wrangler dry-run，再记录部署前 ID、部署、记录
部署后 ID，任一步失败立即停止：

```bash
corepack pnpm run gateway:release -- \
  --action deploy \
  --operator <operator-uid> \
  --change-id <change-id> \
  --execute \
  --confirm <preview-sha256>
```

## 5. data-runtime 回滚演练

先预览二进制 SHA；预览不改文件、不重启服务：

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime rollback
```

先确认 `auto-update status` 返回 `effectiveState=pinned`。若尚未 pin，使用独立批准：

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime auto-update pin \
  --change-id <change-id> \
  --confirm pin:<change-id>
```

然后执行回滚：

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime rollback \
  --execute \
  --confirm hzy-data-runtime.previous \
  --change-id <change-id>
```

验收必须同时证明：服务健康；版本等于已审阅的上一版；新增 schema 仍存在；
旧 binary 可读新 schema；客户、合同、项目、资产、文档等业务主档稳定键/计数/哈希
与回滚前一致。该命令只交换 runtime 二进制，不回滚数据库。验证完成后再次使用同一
守卫命令交换回目标 binary，或用已审签的精确目标包 roll-forward，再恢复自动更新策略。

## 6. Tenant Gateway 回滚演练

用发布 journal 中的精确旧 version ID 生成单独回滚计划，批准后执行：

```bash
corepack pnpm run gateway:release -- \
  --action rollback \
  --version-id <exact-version-id> \
  --operator <operator-uid> \
  --change-id <change-id>

corepack pnpm run gateway:release -- \
  --action rollback \
  --version-id <exact-version-id> \
  --operator <operator-uid> \
  --change-id <change-id> \
  --execute \
  --confirm <preview-sha256>
```

回滚只改变 Worker 代码版本，不代表 KV、R2、D1、Durable Objects 或 secret 已回滚。
因此演练不得混入 secret 轮换。回滚后验证 `/`、`/api/auth/me`、People、Finance、
Aims、Altoc、Assets、Codocs、Workflow 等既有路径以及内部 header 剥离，再以目标
version ID 显式 roll-forward。

timer、API update、manual update、installer 和 rollback 共用 execution lock；更新
状态以 `/etc/hzy-data-runtime/update-journal.json` 为事实源。损坏 journal 或超过执行
窗口仍处于 running 的记录必须显示 `partial_or_unknown`，不得自动重试。回滚不会自动
unpin；恢复 tracking 需要另一个 change ID 和 `unpin:<change-id>:tracking:latest` 精确确认。

## 7. service grant 修复与 bundle 刷新

这是两个独立动作，不能互相替代：

1. Console service grant repair：先展示精确 client/capability diff，再在受控事务中
   幂等执行发布合同列出的 v1.21、v1.24、v1.31、v1.32、v1.33 seed；运行各自 Verify
   SQL，检查唯一 active client/credential、期望 grant 和无过宽 scope，并实际 mint
   service token 做正确 audience/scope 正例及错误 audience/scope 负例。
2. Platform policy bundle：生成新 bundle，记录 previous/current version、SHA、kid 和
   policy revision；然后调用 Console `POST /api/activation/bundle-refresh`。HTTP 200 不足以
   表示成功，必须确认响应体 `code=0` 且 Console fingerprint 切到预期值；失败时旧 bundle
   必须仍可用。

Console 启动可能依据 `HZY_SERVICE_CLIENT_*` 物化 client/grant，这是发布副作用，必须在
计划中显式记录，不能把一次普通重启当作无写入验证。

## 8. 证据 journal 最小字段

每一步记录：`releaseId`、`confirmationSha256`、`operator`、`changeId`、阶段、开始/结束
时间、仓库 commit、目标非敏感摘要、前后版本 ID、验证结果、request ID、错误码、
`automaticRetry=false`、`rollback=not_attempted|planned|completed`。业务对象只存稳定键
哈希；不保存响应 body、完整 stdout/stderr、cookie、token、密码、签名、secret 或内部
URL query。journal 必须临时文件写入后原子 rename，并强制权限 `0600`。

在真实 journal 完整归档前，开发任务清单中的 G2-6 五项保持未勾选。
