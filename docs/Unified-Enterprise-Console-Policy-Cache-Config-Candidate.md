# Console Runtime 策略缓存配置候选

2026-09-13 只读盘点与本地候选；未上传或部署。目标为 `hzy-test-console`，C000001/test。当前100%版本 `e8038396-6f4b-44ee-b9bb-34710a1a8cca`，部署 `7e65d0e1-64af-4156-b02b-351fe1d98d2b`。再次读取 versions 列表确认该100%版本也是最近上传版本，避免 inherit 从不同的未发布版本取值。

## 精确修改与制品

唯一配置变化是 `HZY_PLATFORM_BUNDLE_CACHE_BACKEND: memory → runtime`。目录 `deploy/test-env/.cloudflare-workers/console-policy-runtime-candidate-20260913` 包含原模块、原元数据、候选 wrangler.json、manifest 和 Runtime 存储观察。文件/目录权限为0600/0700；OAuth只在内存使用，秘密绑定仅保留名字，不导出值。

- 原模块1个，7,274,121 bytes，原字节逐项SHA-256验证；没有运行 Nuxt build 或使用本地 dirty 业务源码。
- 82个非秘密绑定保持 inherit，9个秘密绑定 keep_bindings，静态资源 keep_assets；compatibility、usage_model、placement、tags、tail_consumers、logpush保持当前设置。不配置 routes/workers.dev，也不执行路由命令。
- 只读版本系统注解 `workers/triggered_by` 保存在原元数据证据中，不伪造为上传配置。它不是业务运行配置。
- 本地验证命令：`node deploy/test-env/console-policy/verify-candidate.mjs deploy/test-env/.cloudflare-workers/console-policy-runtime-candidate-20260913`。验证模块、配置字段白名单和只变一个变量，当前 reviewHash `a768c5c62d4e104b707fa20036abb6f1bda971dfad00a2a3907506135c1e2a40`。
- Wrangler `deploy --dry-run` 成功，7103.63 KiB / gzip2350.68 KiB；只有 unsafe metadata 实验字段提示，没有执行上传。准备脚本 `console-policy/prepare-live-console.mjs` 强制新目录、固定测试Worker、单一100%版本且最新版本相同，导出后重新验证部署未变。

保留资产/绑定的语义依据 [Cloudflare multipart metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/) 与 [上传接口 inherit 严格模式](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)。实际上传前仍必须核对基线版本没有变化；不能用本地 dry-run 当云端继承成功证据。

## 已证实与明确缺口

导出代码实际包含 runtime backend 判断、`/v1/console/policy-bundle` GET/PUT、`console:policy-bundle:read/write` 与 ETag CAS。现有 Runtime `enterprise_policy_store_mysql_test.go` 覆盖真实 JWT/current grant、CAS冲突不覆盖、tenant/deployment隔离、重建Server持久化及撤销/503；这些现有测试不等于本次线上请求已经执行。

本次直接只读观察本机 C000001 Console 源库：policy_bundle_snapshots 表存在，console.runtime client active，对应 read/write grant active。没有签发测试token、没有通过线上Worker发起写入、没有读取业务策略内容。

当前线上导出代码 **没有 enterpriseEntitlement 消费逻辑，也没有本轮企业资格单调revision拒绝回放实现**。因此候选 `configurationOnlyReady=true`、`adr018ConsumerReady=false`、`hold=true`。仅改backend能启用原有持久存储，但不能宣称 ADR-018 企业资格与权限消费接线已发布；需要单独审查并发布对应已验证代码，不能把本地最新源码的安全能力算到这个旧版本中。

## 后续验证与回退（未执行）

1. 重新读取100%部署和最新上传版本，均须等于上述基线；否则重新导出，不能继承漂移配置。运行本地verify并核对reviewHash。
2. 用真实 Console 自身短期身份验证 Runtime exact read/write、tenant/deployment/current credential；先读取既有合法key，不创建伪造bundle。依赖失败应明确503，不能回退memory。
3. 单独版本上传后、部署前，回读新version模块SHA、assets引用、所有绑定及compatibility，只允许一个plain_text变量变化；不要执行全量重build或新路由绑定。上传方式须支持严格inherit；任一绑定解析失败终止。
4. 部署后通过实际已登录会话触发真实签名bundle刷新，观察Runtime表落盘与ETag；跨Worker isolate重新读取应使用同持久记录。验证不同tenant/key隔离及依赖失败不会被memory回退掩盖。企业资格新逻辑另按上节缺口验收。
5. 回退精确旧version `e8038396-6f4b-44ee-b9bb-34710a1a8cca` 至100%，回读变量恢复memory；不删除Runtime持久记录、不改secret或路由。若期间启用了必须持久存储的新企业资格路径，回退应先隔离该业务入口，不能默默恢复弱缓存后继续宣称资格安全边界有效。

## 2026-09-14 当前代码候选的实际部署阻碍

已在不含 dotenv 的 protected 源码快照中构建包含 `enterpriseEntitlement` 消费和持久化 revision watermark 的当前 Console，并通过局部类型、消费者、配置和 Wrangler dry-run 验证。发布前重新读取基线，仍为 `e8038396-6f4b-44ee-b9bb-34710a1a8cca` 的单一 100% 部署。

实际 `wrangler deploy` 保留所有现有绑定、secret 类型和 assets，并使用测试配置中的 `HZY_PLATFORM_BUNDLE_CACHE_BACKEND=runtime`；Cloudflare 在创建新版本前以 `10055` 拒绝：该 Worker 合计 91 个变量，超过 Free 计划 64 个变量上限。上传流程中出现的静态 asset staging 没有生成 Worker version 或流量切换。失败后立即回读确认 active 与 latest version 都仍是 `e8038396-6f4b-44ee-b9bb-34710a1a8cca`、100%。未改 routes、`workers_dev`、preview URLs、secret 或业务/Platform 配置，也没有重试或删除现场。

因此当前代码候选尚未部署，真实持久化消费者 smoke 尚未运行。继续需要能容纳既有 91 个变量的测试 Worker 计划，或经单独审查后减少/迁移绑定；不得为了绕过限制而丢弃现有绑定或 secret。

### 同日收口：等价变量精简、部署与真实 smoke

随后逐项核对当前 Console/Foundaton/collab 运行时读取点与 `cloudflareConfig('console')` 事实源。34 个遗留非秘密 cross-app URL/target alias、无读取 feature flag 和旧 public alias 没有当前运行时 reader；它们不属于当前测试配置生成值。保留 48 个实际读取的 plain-text 配置、全部 9 个 secret 类型、测试 tenant/deployment、assets 和 `HZY_PLATFORM_BUNDLE_CACHE_BACKEND=runtime` 后，总数为 57。`cloudflare-config.test.mjs` 固定该变量预算和完整移除名单。

当前代码候选已上传并成为 `952afe48-8399-477f-b4ec-9951ff8794c1` 的单一 100% 活动版本；原 `e8038396-6f4b-44ee-b9bb-34710a1a8cca` 仍是精确回滚锚点。活动版本回读确认 48 个 plain-text、9 个 secret 类型、assets、`runtime` backend，以及 `enterprise-entitlement.v1` 和持久 revision 回退拒绝标记。没有 routes、`workers_dev` 或 preview URL 变更。

使用既有 protected Gateway 身份执行一次精确测试 policy sync，HTTP 200；随后 `activation/status` 为 HTTP 200，`activated=true`、`bundleReady=true`、tenant `C000001`、deployment `wiztek-test-console`、bundle version/hash 均存在且 `lastError=null`。该调用经过 Console 的真实 Runtime 策略持久化路径；没有输出或持久化凭据，没有切换 Platform 或业务流量。
