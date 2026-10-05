# 原生产系统重新打开（仅供对照）执行单

状态：**待用户批准；本文所列写入均未执行**。日期：2026-10-02。起草：Claude（协调会话）。

目的：在不影响现生产（`aidcp.wiztek.cn`）和员工的前提下，重新打开切换前的原生产系统，供用户对照页面设计与行为。原系统的数据停在 2026-09-30 切换时刻，打开后的任何操作只影响原系统自己的库，不回流现生产。

## 1. 原系统现状（2026-10-02 只读核查）

| 组成 | 现状 |
| --- | --- |
| 入口 `wiztek.huizhi.yun` | Cloudflare 上有一条 `wiztek.huizhi.yun/*` → Worker 为 None 的路由（B1 加的），入口不可达 |
| 公共 Gateway Worker `hzy-tenant-gateway` | 运行中，同时服务测试环境 `hzy-test.huizhi.yun`；按子域名向原 Platform `huizhi.yun` 解析租户；每 5 分钟 cron |
| 应用 Worker | `hzy-aims` 最后部署 2026-09-01，`hzy-console-prod` 2026-09-10，均为切换前版本（即原界面） |
| 原 Platform `hzy-platform`（`huizhi.yun`） | 运行中，经 Hyperdrive 连日本机 MySQL `hzy_platform`；老版本，没有租户调度归属开关 |
| 日本机 `oa.wiztek.cn` | MySQL 8.0.45 运行；`hzy-data-runtime` 0.3.219 及目录连接器、自动更新单元均已停止；`cloudflared` 运行（Runtime 公网端点 `wiztek-data-runtime.huizhi.yun`） |
| 原库待投递 | `hzy_workflow.flow_actionable_outbox` 12 条 pending（只投递到原 Console 待办，不直接发消息）；`hzy_aims.integration_operation` 0 行 |
| 原库集成 | `wecom.default`、`dingtalk.default`、`dingtalk.identity`、`ai.default`、`oss.default`、`gitlab.default`、`directory.ldap` 均为 active |
| 登录 | 不使用企业微信；可用 LDAP 账号密码（需启动日本机目录连接器） |

## 2. 风险与防护

| 风险 | 防护 |
| --- | --- |
| 员工误用原系统、在里面录入数据 | 入口加 Cloudflare Access，只允许用户本人账号；员工即使用旧书签也进不去 |
| 原系统定时任务或待办投递给员工发真实企业微信/钉钉消息 | 原库停用 `wecom.default`、`dingtalk.default`、`dingtalk.identity`（消息发送失败关闭）；`ai.default` 一并停用 |
| **共用 OSS 桶 `wiz-rs`：在原系统编辑/上传会覆盖现生产同名对象** | 方案 A（推荐）：用户在阿里云 RAM 建一个只读 AccessKey（仅 `oss:GetObject`/`ListObjects`，限 `wiz-rs`），替换原系统 `oss.default` 凭据，原系统从根上无法写 OSS。方案 B：不换凭据，约定在原系统**只看不改**（不新建/编辑文档、不上传附件、不发布周报）——只靠人为约束 |
| 原 Runtime 自动升级或被原 Platform 下发更新 | 只启动 `hzy-data-runtime` 与 `hzy-data-runtime-directory`，自动更新 timer 与 update-request.path 保持停止 |
| 原库是切换前的基线证据 | 打开前对日本机全部业务库做一次加密全量备份 |
| GitLab | 保持 `gitlab.default`（仓库文档预览需要）；原系统里不要触发 Issue 同步 |

## 3. 步骤（每步回读，失败即停）

| 步 | 动作 | 写入位置 | 回读 | 回滚 |
| --- | --- | --- | --- | --- |
| L1 | 日本机加密全量备份（`hzy_console`、`hzy_aims`、`hzy_workflow`、`hzy_codocs`、`hzy_assets`、`hzy_platform` 等），解密校验 | 日本机磁盘 | 备份可解密、非空 | 无 |
| L2 | 原库 `hzy_console.integrations`：`wecom.default`、`dingtalk.default`、`dingtalk.identity`、`ai.default` 置 inactive（记录原值） | 日本机原库 | 四行 inactive，其他不变 | 按记录恢复 active |
| L3（方案 A） | 用户在阿里云 RAM 建只读 Key；经用户本机管道写入原系统 `oss.default` 凭据（不经聊天、不落盘明文） | 原系统 Vault | 原系统预览文档成功；写测试对象被 OSS 拒绝（403） | 恢复原凭据（L1 备份） |
| L4 | Cloudflare：为 `wiztek.huizhi.yun` 建 Access 应用，只允许用户本人邮箱 | Cloudflare | 未登录访问跳转 Access 登录 | 删除 Access 应用 |
| L5 | 日本机启动 `hzy-data-runtime`、`hzy-data-runtime-directory`；确认自动更新单元仍停止 | 日本机 | health 200；Platform 心跳正常 | `systemctl stop` |
| L6 | Cloudflare：删除 `wiztek.huizhi.yun/*` → None 路由，入口恢复（仍受 Access 保护） | Cloudflare | 经 Access 登录后可打开原系统；`hzy-test.huizhi.yun` 不受影响 | 重新加 None 路由 |
| L7 | 用户以 LDAP 账号登录，对照项目管理与项目文档页面 | — | — | — |

域名：建议**沿用 `wiztek.huizhi.yun`**，靠 Access 防员工误用。若改用新子域名（如 `wiztek-legacy.huizhi.yun`），需要改原 Platform 的租户子域名映射；原 Platform 同时服务测试环境，改动面更大，不推荐。

## 4. 关闭

对照结束后：重新加 None 路由（L6 回滚）→ 停日本机两个单元（L5 回滚）→ 恢复 L2 原值 → 删除 Access 应用 → 若做了 L3，删除阿里云只读 Key。

## 5. 需要用户确认

1. 域名：沿用 `wiztek.huizhi.yun` + Access（推荐），还是改新子域名。
2. OSS：方案 A（只读 Key，需要你在阿里云 RAM 操作）还是方案 B（只看不改的约定）。
3. Access 允许的邮箱。
4. 批准 L1–L6 的写入（日本机、原库、Cloudflare）。

## 6. 执行记录（2026-10-02，用户批准：域名沿用、OSS 方案 B、Access 放行 jnzgy163@gmail.com、L1–L6）

- **L1**：经用户本机 `jp-root` 导出 10 个业务库（hzy_console/aims/workflow/codocs/assets/platform/altoc/finance/people/webdev），AES-256 加密存于用户本机 `~/Library/Application Support/HuizhiYun/legacy-backup/20261001T211558Z/`（目录 0700，密钥文件 0600 同目录）；逐个解密确认导出完整。
- **L2**：原库 `hzy_console.integrations` 中 `wecom.default`、`dingtalk.default`、`dingtalk.identity`、`ai.default` 由 active 改为 inactive（4 行）；原值与时间戳记录在备份目录 `integrations-before.tsv`。`oss.default`、`gitlab.default`、`directory.ldap` 保持 active。
- **L3**：未执行（用户选方案 B：原系统只看不改，不新建/编辑文档、不上传附件、不发布周报）。
- **L4**：用户在 Cloudflare Zero Trust 建 Access 应用 `wiztek.huizhi.yun`，仅放行 `jnzgy163@gmail.com`；匿名访问 302 到 Access 登录。
- **L5**：日本机启动 `hzy-data-runtime`（0.3.219）与 `hzy-data-runtime-directory`；自动更新 timer 与 update-request.path 保持 inactive；本机与 `wiztek-data-runtime.huizhi.yun` health 200。
- **L6**：删除 zone `huizhi.yun` 的 `wiztek.huizhi.yun/* → None` 路由；入口回到 `*.huizhi.yun/* → hzy-tenant-gateway`，匿名仍 302 到 Access；`hzy-test.huizhi.yun` 不受影响（200）。
- **L4 补充**：原 Runtime 校验 Console 令牌需拉取 `https://wiztek.huizhi.yun/.well-known/jwks.json`，被整站 Access 拦成登录页 HTML，原 Console 激活失败（`token is unverifiable … invalid character '<'`）。用户另建 Access 应用 `wiztek.huizhi.yun/.well-known/*`，策略 Bypass + Everyone（仅公开的 JWKS 与 OIDC 发现文档）；回读 JWKS 200 JSON（14 个 key），整站匿名仍 302。用户确认可以登录原系统。
- **关闭时**（§4）另需删除这个 `.well-known` Bypass 应用。
