# 持久授权包与独立同步

2026-09-21 候选代码补充：Console 已增加 `verified-runtime` 后端，使用 Platform
完整签名信封与 Runtime 独立 `verified_policy_snapshots`，不使用下述旧 HMAC。
当前 renderer、本地 runner 和运行配置未切换，本文旧路径仍为现行运维记录；
不能照搬下面的启用步骤到新后端。切换前提及隔离测试证据见
[策略合同第 9 节](../../../docs/Console-Enterprise-Policy-Verification-Contract.md#9-同步与-console-消费者候选接线未切换运行环境)。

## 存储路径

`Console 内存 → Foundation consolePolicyStore → Data Runtime → hzy_console.policy_bundle_snapshots`

适用于本地多 Worker、生产 Cloudflare 与具备请求 Runtime 上下文的私有 Console。Console 不持有数据库凭据、不直连 MySQL，不再使用 R2 policy Binding。

```dotenv
HZY_PLATFORM_BUNDLE_CACHE_BACKEND=runtime
HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS=300000
```

生产 renderer 默认仍为 memory，避免代码更新自动启用尚未迁移的数据库。旧 R2 配置明确报错，不静默回落文件。旧本地 R2 对象保留但不再读取。

## 认证和存储契约

- 固定 `GET/PUT /v1/console/policy-bundle` 使用 `console:policy-bundle:read|write` 和 service-client-policy。仅这两个精确 capability 的 Token 签发跳过可选包摘要，避免冷启动循环。
- Runtime 校验 JWT/JWKS、issuer、audience、source/target、tenant/deployment、有效期、当前 credential 和 active grant。来源必须是 Console；Platform bootstrap Token 仅允许访问原有 Token issuer，不能读写包。
- Console 先校验 Platform Ed25519 签名/hash/上下文，再用 Gateway internal token（兼容 Cloudflare internal token）HMAC 密封完整记录。冷读本地验证 HMAC，不查询 Platform 公钥。轮换完整性密钥须协调重新同步。
- 主键为已认证 tenant + Console deployment + scope hash；scope 包含环境，Runtime/数据库继续按环境隔离。托管包是租户/环境级，原始包内 deployment 不一定等于当前 Console deployment，不改写原始元数据。
- 保存密封包、原始签名、版本/hash、同步起始时间和内容 ETag。SQL CAS 要求 expectedEtag 匹配、同步时间严格递增；重复相同内容幂等。竞争失败返回 stored:false，客户端有界重试，旧请求不得覆盖新记录。
- GET query 为 key，返回 {code:0,data:null|{body,etag}}；PUT body 为 {key,body,expectedEtag}，返回 {code:0,data:{stored:boolean}}。body 是完整密封 envelope 字符串。PUT 必须提供 SHA-256 形状 Idempotency-Key，Foundation 从命令生成；幂等由内容 ETag/CAS 实现。GET 不写业务数据，响应 no-store。
- 单包 envelope 上限4MiB，该专用 HTTP 命令允许8MiB以容纳JSON转义；其他业务命令仍为1MiB。超限失败关闭，需监控大租户包体积。
- 普通读包不请求 Platform 策略；Gateway registry/bootstrap 基础设施依赖并未全部消失。Runtime 故障不能恢复直连数据库或本地策略 fallback。

## 独立同步与五分钟

Gateway `HZY_POLICY_SYNC_HOSTS` 指定精确租户域名，分钟 cron 通过 Console Binding 唤醒内部同步端点。最多100目标、并发4，更大规模需拆分调度；公网不能触发。五分钟业务 drain 保持独立。

同步不重复 materialize Auth clients；目录、身份、enrollment 由原有安装流程就绪，策略包 ready 不等于全部业务安装完成。

- 内存 TTL 最长5分钟，不能越过同步起始时间+5分钟或包自身到期。
- 读库不续期；缺包、篡改、超龄失败关闭。内存有效时不读库，过期后 Runtime 不可用则返回不可用。
- 普通授权撤销最多延迟约5分钟；用户会话撤销仍实时检查。
- 普通 cache-miss 不刷新 Platform；既有高风险 fresh-policy 和显式管理刷新保留。
- 建议每租户连续2分钟同步失败告警，5分钟为安全截止。

## 生产上线记录

### 2026-09-07 后续故障：Workers Free CPU 限制

此前短时上线验收不能证明持续运行。后续项目首页出现待激活，生产核查确认：

- Runtime 快照表存在、两个精确 grant 均 active；读取时快照年龄为 361447ms，已超过 300000ms 截止。
- Gateway 分钟 Cron 正常触发，Console 同步请求返回 503。Console Tail 在该同步请求记录 `outcome=exceededCpu`、`cpuTime=10`、`Worker exceeded CPU time limit`，而非缺失调度配置。
- Cloudflare settings 的 `usage_model=standard` 和账户 `workers/standard` 的 `standard=true` **不代表已购买 Workers Paid**。设置 Console CPU 预算的 API 明确返回 HTTP 400 / code 100328：Free plan 不支持 CPU limits，必须使用 Paid plan。
- 新增同步链路需要验签及读写约 630KB 密封快照，不能依赖免费套餐偶发超额宽容。连续同步失败使快照过期，授权失败关闭，再被 UI 展示成待激活。这是本次生产故障的直接链路。

曾准备 `limits.cpu_ms=1000`，但生产 API 拒绝，未更改线上配置。用户随后要求优先恢复服务，选择下面的旧版本回滚；未购买套餐，未采用该预算配置，相关未发布改动已撤除。

重新启用持久策略的验收必须覆盖：实际分钟 Cron 连续成功超过一个五分钟窗口、快照同步时间持续推进、Console 激活状态、已登录项目首页，以及匿名/未授权请求仍被拒绝。不能以一次手动重试成功代替持续调度验收。

### 2026-09-07 04:24 UTC 服务恢复回滚

用户明确要求先恢复服务，变更号 `RESTORE-POLICY-C000001-20260907`：

- Console 已恢复 `81ad528b-3c5f-45ea-91d3-3deb554174cb`，100% 流量，deployment `2ddc804d-3bbc-4b38-b88f-c2b4def5fa4b`；该版本使用原 memory 缓存和缺包时拉取路径。
- Gateway 已恢复 `03f345e2-a300-411d-b7c5-9d8154f3e1fb`，100% 流量，deployment `9b755035-a412-421f-a84e-656e78a1ed71`。版本回滚不会自动回滚 Cron 配置，因此另行移除新增的分钟触发器，只保留 `*/5 * * * *` 业务 drain，并经 API 回读确认。
- 本地生产 Console env/生成配置已对齐 memory；Gateway 发布配置停用分钟触发器并清空策略同步目标，防止普通发布误启用该机制。重新启用持久策略必须单独完成容量和持续同步验收。
- Runtime 仍保留 `0.3.216`，未回滚数据库、删除快照或修改 grant；其新增存储接口不再被旧 Console 使用。未发布业务应用。
- 回滚后激活接口分别在 04:24:08 和 04:26:47 UTC 重新拉取成功，返回 active/bundleReady，无错误。真实已登录浏览器已打开项目 257 概览、版本列表及 V1.0.0 详情。
- 04:29:15 UTC 再次检查仍为 active/bundleReady，超过首次恢复后的五分钟窗口；匿名 `/api/auth/permissions` 返回 401，未关闭登录授权。项目首页显示 25% 进度、1/4 里程碑完成，截图见操作证据目录。
- Console 配置校验、Gateway 与发布工具合计 39 项测试通过。操作证据保存在 `build/release/RESTORE-POLICY-C000001-20260907/`。此为恢复旧运行路径，不表示新的持久策略同步问题已修好。

### 2026-09-07 UTC 执行结果（已完成）

变更号 `POLICY-STORE-C000001-20260907`，用户明确批准后执行。以下历史发布前检查保留供追溯，其中配置缺失和“未执行”状态已由本节结果取代。

- 本次验证租户为 `wiztek.huizhi.yun` / `C000001`，Console binding 为 `C000001-console`。未将结果外推为其他租户已完成验收；共享 Worker 新增租户必须先准备其 Runtime、数据库、grant 和同步目标。
- 生产 `hzy_console.policy_bundle_snapshots` 已创建，`console.runtime` 的两个精确 active grant 已确认。仅新增表及补充授权，不修改已有业务行。变更前仅对受影响的 `service_client_grants` 表备份，并非完整业务数据库备份；受控主机备份目录为 `/var/backups/hzy-policy/POLICY-STORE-C000001-20260907/`。
- 正式签名 Runtime `0.3.216` 已上传固定版本并安装，所有应用数据库健康检查通过。自动更新保持 pinned，未推广全局 `latest`（本次发布前为 `0.3.215`）；不得在通道仍指向旧版时直接解除固定。旧二进制保留于 `/opt/hzy-data-runtime/hzy-data-runtime.previous`。
- Runtime 制品 inventory SHA-256 为 `96a5858d2564ff6e00940713f34d43c2cb2388d5c0f47f53fa958dc547804929`。制品构建元数据为 `6e37d294-dirty`，不能声称 clean build；相关源码后续提交为 `9f18b507`，Console 两阶段预检补充提交为 `29e6ef45`。未覆盖重传固定版本制品。
- Console 先发布 memory 预检版本 `d90b99af-826e-42ba-9dab-0c22521ddaa1`，经真实受信调度完成两个 audience × 三组 scope 的六次签发核验，再切换 runtime 后端。最终 Cloudflare Console 版本为 `bf9063bd-6eee-48d3-be60-769444b22a9e`，TTL 为 `300000`。
- Gateway 最终版本为 `7e586da7-7e73-4dfc-a4d5-0ab423f89d97`，deployment 为 `3f950ab2-9b93-4de5-9f47-9bb06676c82c`。分钟同步目标为 `wiztek.huizhi.yun`；保留原 Service Binding 和独立五分钟业务 drain。
- 独立同步返回 `200`，数据库中该租户快照为 1 条、约 630 KB；后续同步时间从 `1788741464497` 更新至 `1788741704496`，复查包年龄约 12 秒，确认持续刷新。
- 已登录生产员工页正常呈现 92 条记录；匿名 scoped authorization 和员工查询返回 `401`，公网内部同步入口返回 `404`。未在生产人为断库、撤销真实用户或制造 Platform 故障；不能将自动化/TEST 的故障测试描述为生产已执行。
- Console 全发布验证（lint、typecheck、tests、build、dry-run）、Gateway 33 项测试及发布工具 6 项测试、Runtime Console/auth/server 测试通过。发布合同见 `docs/release/POLICY-STORE-C000001-20260907.release.json`，本机 Gateway 执行证据见 `build/release/POLICY-STORE-C000001-20260907/gateway.json`。
- 未发布 People、Platform 或 TEST 环境。回滚锚点：Console `81ad528b-3c5f-45ea-91d3-3deb554174cb`、Gateway `03f345e2-a300-411d-b7c5-9d8154f3e1fb`、Runtime `0.3.215`。需回退 Runtime 时先恢复 Console memory 路径；保留新增表和备份，不自动删表或删除 grant。

### 2026-09-06 发布前检查

- Cloudflare OAuth 只读盘点成功。当前 Console `hzy-console-prod` 为100%版本 `81ad528b-3c5f-45ea-91d3-3deb554174cb`；Gateway `hzy-tenant-gateway` 为100%版本 `03f345e2-a300-411d-b7c5-9d8154f3e1fb`。正式执行前必须重新读取，不能假设盘点后版本未变化。
- 生产配置校验器已覆盖 memory/runtime 两种模式和 runtime 默认300000ms；继续拒绝直连数据库及旧 R2 后端。`node scripts/validate-console-cloudflare-config.mjs` 通过。
- 当前工作站缺少 `console/.env.cloudflare`，未配置 `HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE`，文档示例私钥路径也不存在。须从正式部署环境获取配置位置与已有签名密钥路径，不能新造信任根或使用测试密钥替代。
- 现有 `docs/release/P3-P4-2026-07.release.json` 为 `superseded`，不作为本次执行合同。需要按发布手册建立本次目标、变更号、来源版本及回滚锚点；共享 Console 切换前逐个确认受影响的生产租户 Runtime/数据库和同步目标。
- 本轮仅做生产只读盘点及本地校验修复；未执行生产 DDL、grant seed、Runtime 升级或 Worker 发布。

### 执行顺序

2026-09-06 补充检查（用户提供正式配置及签名路径后）：

- `console/.env.cloudflare` 严格校验通过，当前仍为 memory，未提前切换。正式 Console/Gateway 目标仍为 Cloudflare。
- 从发布 shell 加载正式 Ed25519 密钥；权限由0644收紧至0600。公钥指纹 `e1f7cfc0fb174116c305766c2a39d90606e22cc5a3c02d1cf7fc749578bcab82` 与生产 Runtime 预置公钥一致。
- 日本 `oa.wiztek.cn` 生产 Runtime active/health ok，租户 `C000001`、Runtime deployment `c000001-prod-tenant-runtime`、Console binding `C000001-console`、Console 库 `hzy_console`。JWT issuer 为 `https://wiztek.huizhi.yun`，Console 使用专用数据库账号。
- 当前 Runtime 为0.3.215，二进制SHA-256 `8a38aad4460b0a76d47408c7ebd549c412127070ffa983052015f8fc7e197646`；自动更新 tracking/latest，正式操作前须记录并固定目标版本。不能先推广 latest 让定时器隐式升级。
- 本地已生成签名候选0.3.216（amd64/arm64），inventory SHA-256 `96a5858d2564ff6e00940713f34d43c2cb2388d5c0f47f53fa958dc547804929`；stage预览摘要 `8eaebd93806118e0ee35020d945db897422f7330d679d58856c253d80fab3b7f`。仅候选，尚未上传或安装；来源为当前dirty工作树，不代表clean/locked发布门禁已通过。
- `pnpm --dir console run verify:cloudflare-deploy` 全流程通过（lint/typecheck/tests/build/dry-run）；Gateway33项测试通过，Data Runtime Console/auth/server测试通过。
- 生产DDL、grant seed、Runtime升级、Worker发布、latest推广仍未执行。正式执行需要锁定本次源码与变更计划并完成人工复核，不能将旧superseded合同直接改为locked。

1. 对明确选择的租户库执行 `console/docs/sql/Console-SQL-Migration-policy-bundle-snapshots.sql`；不要执行整个 schema 文件创建默认库。
2. 升级 Data Runtime，核对 deploymentBindings、issuer/JWKS；执行 `Console-SQL-Seed-policy-bundle-grants.sql`，仅补缺失 grant，不重新激活禁用 grant。
3. 先部署仍使用 memory 的新版 Console，再配置 Gateway 同步目标。内部同步端点在 memory 阶段只预检 data-runtime、tenant-runtime 两个 audience 的 read、write、组合 scope 实际签发，成功返回 `200`、`preflightReady:true`、`ready:false`，不表示持久包已就绪。安装列表初始化精确 grant，issuer 将这两个 capability 限于 Runtime audience；SQL 行存在不能替代签发核验。
4. 六次预检通过后，Console 显式设 runtime 后端和300000 TTL，重新渲染并发布配置。此阶段内部同步端点执行独立包刷新，不再每分钟重复六次预检。首次无包会503，完成受信首包同步后验证业务流量。
5. 验证每租户同步、重启数据库冷读、业务授权及负向隔离/撤销测试。生产使用正式签名 Runtime 制品，不使用测试二进制。
6. 回滚恢复旧 memory 配置及对应版本，保留新表和旧对象。memory 恢复旧冷加载行为。

本地 local-workers.mjs start 每分钟经受保护 loopback 入口执行同一 Gateway 同步函数，数据存隔离测试 Console 库，不创建云端桶。生产使用相同代码，但自己的 Runtime、数据库、密钥和调度目标。
