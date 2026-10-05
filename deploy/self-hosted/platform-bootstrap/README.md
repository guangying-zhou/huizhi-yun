# G-9 Platform 克隆与信任链制品（已存档）

> **存档（2026-09-29，[Platform 方案 §8c](../../../docs/Go-Live-Self-Hosted-Platform-Plan.md)）**：生产控制面改用共享的 `https://hzy.wiztek.cn`，新机不再运行 Platform，也不克隆 `hzy_platform`。本文与 `platform/scripts/g9-platform-{schema,sanitize,data}.mjs`（会清空/整体改写）**不得用于共享实例**；现行流程见 [G-9 共享 Platform 计划](../../../docs/Go-Live-G9-Shared-Platform-Plan.md)。以下内容仅供参考。

本目录只描述待审的生产操作。`platform/scripts/g9-*` 目前只在一次性 MySQL 合成库演练；未连接生产/开发 Platform、未生成生产私钥、未签发 license 或令牌。每一个真实环境写入仍按 [Platform 方案 §7](../../../docs/Go-Live-Self-Hosted-Platform-Plan.md#7-建议执行顺序每一步单独批准) 单独批准。

## 受保护输入

- 由已批准的只读账号对源 `hzy_platform` 做 `mysqldump --single-transaction --routines --triggers --events --hex-blob --skip-lock-tables`。**不要**用 `--databases`，dump 内不得有 `CREATE/DROP/ALTER DATABASE` 或 `USE`。先加密备份并做解密自检；解密后的工作副本只放 0700 目录，文件 0600，执行后安全移除。克隆脚本只连接本地空目标库，不连源库。
- `db.json`（0600）形如 `{"db":{"host":"127.0.0.1","port":3306,"user":"<专用账号>","password":"<从受保护配置取>","database":"hzy_platform"},"options":{"runtimeEndpoint":"https://aidcp-runtime.wiztek.cn","revokedAt":"<UTC DATETIME>","oldSigningKids":["<只读盘点的每一个旧 kid>"]},"encryptedCloneBackupSha256":"<sha256>"}`。不要把它或输出的回执提交到 Git。执行迁移、sanitize 和 data apply 时，目标 Platform 与所有指向它的 Runtime/Worker 必须停止写入，由窗口负责人持有独占窗口。
- `oldSigningKids` 必须与克隆库旧签名键集合完全相等。若在数据整理之后配置了新键，不能再对该库运行旧清理 plan。
- 离线排空认可使用的 HMAC 只通过 Platform 服务的 systemd credential `offline-drain-hmac` 提供；生产不得用普通环境变量、命令行参数或仓库文件传入。启站前确认 `CREDENTIALS_DIRECTORY` 可读取这份受保护凭据，且不输出其内容。

## 顺序与命令模板

以下命令只是执行单模板，**当前不执行**。DDL 非事务；任何迁移失败，立即停止并从加密 dump 恢复目标库，不跳过或猜测缺失的表。`--migrate` 使用固定的 13 个仓库迁移文件，实测在合成旧库上新增 18 张表，并为排空认可表补齐 generation/已签制品列及唯一索引；执行前后比对旧表列/索引摘要，已有迁移表或该 ALTER 若只安装一部分则停下。

```sh
node platform/scripts/g9-platform-schema.mjs --restore /protected/db.json /protected/source.sql
node platform/scripts/g9-platform-schema.mjs --inventory /protected/db.json > /protected/schema-before.json
node platform/scripts/g9-platform-schema.mjs --migrate /protected/db.json
node platform/scripts/g9-platform-schema.mjs --inventory /protected/db.json > /protected/schema-after.json
node platform/scripts/g9-platform-sanitize.mjs --plan /protected/db.json > /protected/sanitize-counts.json
# 复核表与行数，确认加密源备份可解密后，才单独批准以下 apply。
node platform/scripts/g9-platform-sanitize.mjs --apply /protected/db.json /protected/sanitize-counts.json
node platform/scripts/g9-platform-data.mjs --plan /protected/db.json > /protected/g9-plan.json
# 复核 reviewHash、目标逐行 beforeSha256、非目标摘要及全部 after 字段。
node platform/scripts/g9-platform-data.mjs --apply /protected/db.json <reviewHash> /protected/g9-receipt.json
node platform/scripts/g9-platform-data.mjs --verify /protected/db.json
node platform/scripts/g9-orphan-gate.mjs /protected/db.json
```

`sanitize` 只清理会话、旧 bundle/撤销快照、heartbeat、enrollment、API key/webhook 等瞬态表；输入是逐表核对过的行数，任何行数漂移会回滚整个事务。它不输出被删行；回退靠已验证的**加密源 dump**重新恢复一个空目标库。`g9-platform-data` 在事务内复核 reviewHash、目标行及所有非目标行摘要；只改指定字段并把受保护的回执以 0600 保存。回滚时要求目标和非目标行均未漂移：

```sh
node platform/scripts/g9-platform-data.mjs --rollback /protected/db.json /protected/g9-receipt.json <reviewHash>
```

上述事务工具处理 C000002/异常账号停用、订阅及子订阅期限、站点 URL/路由、旧测试及 Finance/People/Webdev 部署停用、旧 Runtime token/实例撤换、两行静态 token 吊销及**删除旧 Platform 签名公钥行**。`console.vault.master_key` 的 `migrated` 行必须始终保留。`root_app_code` 清为 NULL，Enterprise 由正式开通流程安装在 `/enterprise/`，避免默认根应用路由把它装到 `/`。旧签名键删除后的回执仅供本轮回滚，不包含私钥正文。

## 正式流程与信任切换

`node platform/scripts/g9-official-trust-plan.mjs /protected/trust-public.json` 输出不含凭据的 T1–T9 操作顺序。输入只含规范 Runtime endpoint 和**将来经批准生成的**新 kid；它不请求 Platform。实际执行应由授权人员通过现有 Platform 员工/租户管理员 UI/API 取得新签名公钥、Console license、tenant runtime token、Runtime 单次 install-command、Aims scheduler owner 审计回执。新签名私钥只在目标主机 `/etc/hzy/platform-signing/` 的 0600 文件或 systemd credential，绝不入 SQL、仓库、stdout；本轮没有生成。

先根据订阅新期限走 `convertEnterpriseEntitlement` 的正式预览/转换，再由企业开通流程创建 `C000001-prod-enterprise` 并重新签发 license。该流程必须确认 Vault 字段缺失且 `migrated` 标记未变。旧 Runtime 与控制 token 均失效后，在 `platform.wiztek.cn` 取得新的单次注册命令，Runtime 注册并进入 ready，才登记 Aims scheduler owner。Workflow owner 由 Gateway drain 配置决定，不直接写 Platform owner 表。

最后逐字核对 Console、Enterprise、Runtime、Gateway 的 Platform URL、新 kid/公钥、策略 issuer、OIDC issuer `https://aidcp.wiztek.cn/console`、站点与部署编码；74 对孤儿门禁必须零行。旧 kid 内部查询须 404，旧 license/JWT 不得被新站点接受。任何一处不符，停止启站。

## Collab 部署登记（用户 2026-09-29 决定，待批准，未执行）

独立 Collab 登记为正式部署记录 `${tenant}-collab`（生产 `C000001-collab`），与其它 `C000001-<app>` 部署同形。**P4 才执行**：生产克隆库 `platform_applications` 只有 11 个应用行，没有 `collab`/`enterprise`（v2.32 只更新已有行，不插入），所以必须等 Platform 启动并可登录后，先经正式流程 `ops/applications/from-manifest` 注册这两个应用，核对 `manifest_path`/`release_tag_prefix` 后，再在正式开通之前单独批准执行（`db.json` 增加 `{"collab":{"tenant":"C000001"}}`，仍为 0600）：

```sh
node platform/scripts/g9-collab-deployment.mjs --plan /protected/db.json > /protected/g9-collab-plan.json
# 复核 operations（插入子订阅/部署或仅校正路由）、非目标摘要与 reviewHash。
node platform/scripts/g9-collab-deployment.mjs --apply /protected/db.json <reviewHash> /protected/g9-collab-receipt.json
node platform/scripts/g9-collab-deployment.mjs --verify /protected/db.json
node platform/scripts/g9-collab-deployment.mjs --rollback /protected/db.json /protected/g9-collab-receipt.json <reviewHash>
```

- 应用与 manifest：不新增 manifest 资源。`platform_applications.collab` 行须已由 `ops/applications/from-manifest` 正式注册，且 `manifest_path=collab/app.manifest.json`、tag 前缀 `collab/`（v2.31/v2.32 的形状）；行缺失或路径不符时工具停止，不由本工具补建，也不新增 SQL 制品。
- 路由取自 manifest `entry`：`base_path=/collab/`、`api_base=/api/v1/collab`、站点 `C000001-main`、`route_source=platform_override`。Gateway 实际放行的 WebSocket 路径是 `/codocs/ws` 与 `/collab/*`，由 Gateway 白名单决定，不由 Platform 路由推导。
- 不签发 license、不写 runtime endpoint、不创建凭据；服务身份是 Console 的 `collab.runtime`（`collab-prod-registration.mjs` / G-7 目录）。
- 一致性：Runtime `deploymentBindings.collab`、`collab.runtime` grant、G-7 `bindings.deployments.collab`、Gateway `apps.collab.deploymentCode` 都必须等于登记编码。启用前后运行 `node deploy/self-hosted/check-collab-deployment.mjs --tenant C000001 --platform C000001-collab --gateway /etc/hzy-gateway/gateway.json --runtime-binding <Runtime 配置值> [--g7 <配置>] [--collab-registration <配置>]`，任何漂移退出码为 1。
