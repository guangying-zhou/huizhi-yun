# Gateway 断言：第四批签名与测试环境上线计划

当前状态：前三批代码已提交；第四批代码待审查，**没有执行本节任何环境步骤**。
每个环境步骤先交 Claude 审查。用户批准的大范围不代替具体目标、差集与回滚核对。
生产、main、GitHub 禁止操作；共用生产的 Worker/Runtime 立即停止。

关联：[登记迁移](Gateway-Service-Assertion-Registry-Migration.md)、
[keyset](Gateway-Service-Assertion-Keyset.md)、[exchange](Gateway-Service-Assertion-Exchange.md)。

## 第四批代码合同

Tenant Gateway 新 lane 只处理精确 `POST /oauth/token`：当前请求通过原内部 Gateway
凭证验证，来源 app 存在于已解析 registry，tenant/environment/source deployment
逐项等于登记事实。只有 JSON 无密钥 `client_credentials` 请求走签名；带密钥、
Basic Authorization、其他 grant、浏览器不可信请求与其他路由保持旧路径。
Runtime 最终复核来源 client 与 grant，Gateway 不据 `body.app_code` 建立身份。

私有配置（默认没有、不启用）：

- `HZY_GATEWAY_ASSERTION_ENABLED=true`：Gateway lane 开关，**最后开、最先关**。
- `HZY_GATEWAY_ASSERTION_IDENTITY_JSON`：员工从 Platform 精确 deployment 登记导出的
  `{deploymentCode, tenantCode, environment}`，只含公共绑定事实。当前实现每个 Worker
  只接受一个登记租户/环境；与 registry 不符拒绝，不为其他租户猜登记代码。
- `HZY_GATEWAY_ASSERTION_PRIVATE_JWK`：单个 Worker secret，Ed25519 OKP JWK
  (`kty=OKP,crv=Ed25519,x,d`)；不进 vars、Git、日志、参数或回执。
  `x` 是已登记原始公钥，`kid=SHA256(raw x)`；导入非可导出私钥，挑战验签检查
  `x` 与 `d` 配对。没有 Gateway 自登记、生成/上传密钥副作用或不受控 keyset 请求。

当前 registry 的 Console Runtime code 决定 `runtime_code`，源 app/deployment
来自原可信来源解析，Gateway deployment 来自上述员工登记导出且绑定相同租户环境。
每个请求随机 128-bit jti；iat=nbf，exp=iat+60秒，scope排序去重；固定方法/用途/路由。
Runtime 用固定根签名 keyset 验签，Gateway 不能自己决定公钥是否已被登记或撤销。

所有入站 `x-hzy-gateway-*` 先剥离并由 Worker 重建，伪造 proof/deployment 不能转发。
签名 lane 再使用显式 header 白名单：内容协商、request-id、可信 forwarded host/proto/port、
新 Gateway 身份/内部凭证、tenant/environment、source app/deployment、Console Runtime
URL/code/audience/已解析 bootstrap token；没有 Cookie、Authorization、actor、scheduler、
login secret、任意调用方头或 service route catalog。只经 `HZY_CONSOLE_SERVICE` Binding，
没有公网 fallback。请求 JSON ≤64KiB，并重建最小 OAuth body，不照搬额外字段。

Foundation 的 `gatewayExchangeWithLegacy` 唯一实现由 Nuxt TS 与 Worker JS 共用。
专用 HTTP503 + 机器码 `gateway_keyset_unavailable` 才允许一次去掉断言的旧路径调用；
相同最小 body，不再签名、不自动换 jti。仅读取错误 envelope 的 `data.code`/`code`，
不匹配文案；签名/replay/grant/存储/网络错误及 `gateway_exchange_disabled` 绝不回退。
Console 收到无密钥 proof、但自身开关关闭时明确503 `gateway_exchange_disabled`，
不把 proof 静默送旧路径。Runtime 同样在自身关闭时返回该码。

## 必须先完成的只读环境盘点（关口 E0）

送审表逐项填写实际值，不执行 `prepare-cloudflare-gateway.mjs`（它会写 secret 文件），
也不套用根 `deploy/cloudflare/tenant-gateway/wrangler.jsonc`（该配置含生产绑定/路由）。

| 对象 | 代码中测试候选 | 必须只读证明 |
| --- | --- | --- |
| Gateway Worker | `hzy-test-gateway` | 当前精确版本、只路由 hzy-test.huizhi.yun、所有 Binding 均测试、无生产租户 |
| Console Worker | `hzy-test-console` | 当前版本/构建与仅测试路由、Runtime endpoint/instance/实际部署绑定 |
| 本机 Runtime | C000001 当前本机实例 | 当前版本/配置、Console物理库绑定、所有调用方是否仅测试 |
| 测试 Gateway 实际 Runtime | registry 的 runtimeCode/endpoint | 测试 Gateway 最终去哪个实例；不得以名字推断与本机相同或擅自换目标 |
| Platform | `hzy-platform-dev` 开发进程 | 当前版本/旧output及回滚配置、测试 Gateway 对应 deployment_sites 精确 site_code/tenant/env/status/public_url |
| C000002 | 现有修订/信封/目录摘要 | 每次开发 Platform 部署与登记后保持不变 |

源代码生成器曾使用 `wiztek-test-console`、本机 seed 使用 `C000001-test-console`，
**它们不能当别名互换**。先记录真实签发 Console deployment、Gateway所选 Runtime、
每个来源 app deployment，再审差集。若测试 Gateway 的实际 Runtime 还缺 exchange，
先提交该测试实例的部署/迁移/固定根/回滚计划；不得只部署本机就声称云 lane 可开。
开发 Platform 需候选代码部署时也另送干净 worktree 构建/round6回滚与冒烟计划。

### 强制 grant 绑定差集（任何环境启用之前）

对拟启用 Gateway lane 的**全部当前调用方**及受控负载的每个 audience/scope 组合，
用正式只读查询复现 Runtime 选行条件，列逐行表：client/source app/current credential，
物理 resource/action/status/source、请求 audience、semanticScope、tenantCode、
deploymentCode 与预计 registry 绑定；只记录安全摘要，不输出完整 scope_json。

1. 列所有被精确 scope 与 audience 选中的 active grant，包括重复选中行；不能只检查
   `seed:gateway-service-token-exchange`，它是 Console 代理身份，不是业务来源 grant。
2. 每行 tenantCode/deploymentCode 必须非 NULL、非空且**精确**相等；audience或
   audiences、semanticScope按当前 Runtime合同匹配，不能重新解释授权。
3. 输出 `selected_rows / exact_bound_rows / missing_binding / mismatched_binding`。
   缺字段、空绑定、错误 audience/source/client、revoked/current credential 不符均为缺口。
4. 含任一缺口则不启用 lane，报告 Claude 另审；不静默补旧 grant，不复活 revoked，
   不为403降级、不用过宽 scope 测量。对所有有效组合做真实签发探测才过关。
5. v2.20 seed 自身精确绑定 `wiztek-test-console`、双 Runtime audiences；若实际
   Console绑定不同，**当前 SQL不得执行**，先把修订后的精确seed/verify送审。

上述真实差集尚未取得；本轮仅代码/测试，E0 完成后附表送审，才能进入 E1。

## 强制上线顺序与阶段证据

禁止并行启用。后一步以之前阶段记录的通过证据为前提；每步先审查。

### E1：备份、迁移、固定根与 Runtime keyset

- 新加密备份开发 Platform 库与本机目标 Console grant/业务库（已有租户绑定工具），
  备份旧二进制、配置、LaunchAgent、Platform旧output和回滚配置；密钥不输出。
- 重做迁移 plan / reviewHash，按已审DDL与同版本/tmp schema hash apply、verify；
  Runtime optional replay表缺失时不启用，兼容视图 CLI部署前PASS。
- 员工精确Gateway site公钥登记命令：注册next→激活active，记录kid/revision/
  到期时间/审计ID，不输出私钥；从登记行导出公共 identity事实。
- 本机/实际测试Runtime分别审配置：独立固定Platform root/kid、HTTPS签名keyset端点、
  精确tenant/environment/runtimeCode/gatewayDeployment、0600路径。开 keyset sync；
  ready heartbeat、新鲜验签、revision与active kid通过；重启后必须再新鲜拉取。
- 先应用经真实绑定复核的精确v2.20，verify各项=1与双audience签发通过。
  Runtime版本递增、备份→verify-views→启动探测→curl本机/公网连续3次新版本。
- **Gateway lane保持关闭；Runtime exchange与Console Gateway开关仍关闭**。

### E2：Runtime exchange → Console Gateway 开关

- keyset可用且E0所有选中grant均精确绑定后，先启Runtime exchange，使用已验证
  Console身份与故意无效断言探测到专用401，确认不是disabled或认证前置失败。
- 再部署/启测试Console `HZY_CONSOLE_GATEWAY_EXCHANGE_ENABLED`；原secret-backed
  P1开关与旧路径保持原值。记录测试旧版本/新版本，烟测导航/会话/旧无密钥路径。
- 只有测试Gateway私钥secret写入需要用户批准范围，此步骤前送审**具体Worker**；
  使用受保护0600文件/stdin，不把值放命令参数。不要在默认生产config执行secret操作。
- 用隔离受控调用生成一份请求验证真实新路径，一次exchange、一条审计/replay，
  对同jti重复必须拒绝；负例的grant/key/绑定失败绝不回退。Console关闭probe必须
  503 disabled，证明Gateway提前开启不会静默降级。记录安全码/计数，不记录proof/token。
- **仍不启Gateway lane**；若无法安全逐跳验证，停下报告。

### E3：最后开启测试 Gateway lane与同构建对比

- 核对E1/E2证据后，部署只含测试route/Binding的Gateway候选，并最后设置
  `HZY_GATEWAY_ASSERTION_ENABLED=true`。配置identity取员工登记事实，私钥只在secret。
- 仅用E0全组合已验证调用方做同一构建开/关负载；每批固定请求数/并发/audience/scope。
  汇总CPU/wall p50/p95/p99、exceededCpu、JWT claims/TTL一致、审计与replay计数，
  不生成影子第二枚令牌、不输出租户/用户/秘密/带查询串URL。尾延迟变差即回滚。
- 正例、同jti重放、错误tenant/deployment/audience/source/签名、过期、撤销均覆盖；
  缺keyset专用码一次回退，disabled与安全失败无回退。撤销角色/grant仍受Runtime实时校验。
- C000002修订/信封/目录及hzy0导航/一页Aims不变。仅测试开启后再交Claude验收。

## 回滚：先关 Gateway，再退其余

1. **第一步关闭测试 Gateway lane**，确认无proof旧请求仍工作；不能先关Console/
   Runtime，否则新Gateway遇disabled不回退会产生可用性故障。
2. 再关闭Console Gateway开关、Runtime exchange/keyset开关，恢复已记录版本/配置；
   不回滚原secret-backedP1或原gateway内部凭证，除非这次部署确实改变它们。
3. 新可选表/grant先保留并禁用新入口；DDL非事务，schema删除/历史key撤销另审。
   私钥轮换/撤销必须走正式员工API，提高revision；不删除replay来允许重放。
4. 复核旧无密钥调用、导航、C000001与C000002基线，记录每个版本与安全状态码。

任何未知共享范围、注册绑定/差集/验签/回滚失败，停下报告，不自动重试或扩大授权。


## E1 enterprise 试点送审包（2026-09-26，未执行）

### 第五批来源选择

Gateway 同时要求 `HZY_GATEWAY_ASSERTION_ENABLED=true` 与
`HZY_GATEWAY_ASSERTION_SOURCE_APPS=enterprise`。后者默认空，所有来源走旧路径。
逗号分隔、小写 app code、精确成员匹配；空成员、通配符、畸形配置全部关闭。
仅使用 registry 验证后的 source app，不能从请求体选择。它只控制 rollout，
不替代 Runtime client/grant 授权。非 enterprise 来源保持旧路径，318 行全环境
绑定整理另立后续，不在本次修复中。

### SQL 与环境事实

- Console 实际部署 `wiztek-test-console`，v2.20 seed/verify 已修订；旧 SQL 禁止执行。
- enterprise registry 来源固定为 C000001 / C000001-test-enterprise。
- v2.21 repair 精确限定五个 ID、client、resource/action、source、audience、semanticScope
  与 active 状态，只补不存在或 JSON null 的 tenant/deployment，不修空字符串、错误非空值，
  不改其它语义字段或 revoked；updated_at 按数据库规则记录实际修复时间。预期首轮 5 行、复跑 0 行；verify 两列均为 5。
- 修复前独立备份 grant 表并记录加密备份摘要；修复后对相关 enterprise 旧路径组合签发探测：
  data-runtime/assets:ip-asset:link-product、data-runtime 与 tenant-runtime/console:policy-bundle:read、
  console/console:policy-bundle:read、workflow/workflow:proxy。只记录状态与机器码，全部须 200。
  audience 前缀的 physical policy scope也按 E0 实际选行核对，不绕过选行规则。

### Gateway site 身份（Claude 裁决后的正式模型）

不新增 gateway app/订阅/deployment。只读确认现有 deployment_sites id=1、
site_code=wiztek-test、C000001/test/active、public_url=https://hzy-test.huizhi.yun。
另一行 C000001-test 为 inactive，绝不使用。公钥表 FK site_id；冻结站点 code/tenant/environment。
登记 POST /api/platform/ops/deployment-sites/wiztek-test/gateway-keys；
identity 导出 GET 同站点 /gateway-identity?publicHost=hzy-test.huizhi.yun，严格核对实际站点 host。
既有 claim/头/Runtime gatewayDeployment 字段保留，但承载 wiztek-test 站点代码。
不发生 app/订阅/deployment 写入，因此不影响目录、权益、策略包。
登记时员工会话如已过期，由 Claude 转达企微登录；本包审前不执行。

### dev Platform 候选与回滚计划

1. 审核后提交精确文件；从该提交干净 worktree 构建 node-server，记录 commit、锁文件、
   .output 哈希与入口哈希。仅上传独立 gateway-assertion 候选目录，不覆盖当前 .output。
2. 再核对目标仅 hzy-platform-dev / hzy_platform_dev；记录 PM2 cwd/script/配置的安全摘要。
   当前 cwd=/wiztek/hzy-test/platform-candidates/c4-bedb072e/platform。
   加密全库备份，保存当前 PM2 回滚配置与 .output；不输出 env/凭据。
3. 核对既有 wiztek-test 站点 active、code/tenant/environment/public_url 与只读基线完全一致。
   迁移工具要求该站点已存在且 active，不创建应用、订阅或部署。
   再用 gateway-assertion-migration 工具对 Platform plan，核对 reviewHash 与隔离 MySQL 证据；
   apply 20260926-gateway-service-keys.sql，verify。DDL 非事务，失败不盲目重试；按备份恢复。
4. 只切换 hzy-platform-dev。health、员工后台、C000001/C000002 目录与权益、运行时 manifest
   哈希、策略修订/信封/探测耗时、hzy0 导航与一页 Aims 均与基线比较。
   部署自身不得改变 C000001 revision=27 或 policy hash；C000002 的空策略/部署/权益基线不变。
   任何额外差异立即恢复旧 PM2/.output，保留兼容的新增空表；若数据异常按加密备份恢复。
5. 新端点部署通过后，正式登记/激活公钥。私钥仅 Worker secret；
   Platform 只收公钥。站点绑定不得改变；公钥登记无目录、权益或策略变更。

### 本机 Runtime 计划

候选 0.3.242-test.gateway-assertion.1（执行前确认高于实际运行版本），固定当前实例
c000001-test-tenant-runtime、127.0.0.1:18084、https://hzy-test-runtime.isme.dev。
加密备份本机 Console 库、config、launchd plist 与当前二进制；迁移工具 plan/reviewHash
核对后只应用 replay 表，verify；不改业务数据或 registry 目标。执行 verify-views
必须通过，独立候选探测 listening，替换后 curl 本机/公网连续三次 200+新版本。
失败恢复旧二进制/plist/config，不删除 replay 已用记录。

固定 Platform 公钥/kid、HTTPS keyset endpoint、C000001/test/runtimeCode/
wiztek-test（site_code）精确绑定和私有落盘路径；新鲜验签/单调 revision 通过后才进入 E2。
Gateway、Console、Runtime exchange 开关保持关闭至对应审核步骤。
顺序严格为 Runtime keyset → Runtime exchange → Console 开关 → 最后 Gateway enterprise lane；
回滚先关 Gateway。gateway_exchange_disabled 不回退，签名/replay/授权失败也不回退。
任何新的 grant 差集先报告，不能静默补齐；v2.20 不复活 revoked。

### 已完成验证与未执行事项

Gateway 签名/来源选择 7 项通过；一次性 /tmp MySQL exchange 测试通过，含 v2.20
真实部署绑定校验和五行 repair 正例、幂等、除 updated_at 外非绑定字段不变、revoked/错误绑定不改。
所有库 apply、开发 Platform 切换、公钥/secret 登记与 Worker 开关均未执行。
E1 已改为现有站点身份，无新增 app/订阅/deployment；修订包仍须审查，审前禁止环境写入。
