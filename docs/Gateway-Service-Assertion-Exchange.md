# Gateway 断言 exchange（第三批候选）

本批仅代码、测试与待执行 seed/verify。未对现有库 apply、登记公钥、写私钥、部署
或启用开关。前置见 [keyset 合同](Gateway-Service-Assertion-Keyset.md)。Gateway
签名与真实 Worker 接线在第四批；这里提供其必须复用的回退合同，不宣称已上线。

## 路径与两重身份

`POST /v1/console/auth/service-tokens/gateway-exchange`：

1. 现有严格 JWT 认证：Console issuer/JWKS、Runtime audience、service token、
   source_app=console、client_id=console.runtime、sub=client:console.runtime、tenant、
   显式 deployment binding、有效期、credential 与精确 ACTIVE grant。
   独立内部 scope **console:service-token:gateway-exchange**，不加入自动 provision，
   不扩 Platform bootstrap、Console key assertion 或宽 scope。
2. 独立 Gateway Ed25519 断言，由 Runtime 固定根验过的 keyset 验签；Console
   不是断言签发方，不传公钥或“已验证”的布尔结论。Runtime 对照配置中的精确
   source app deployment binding；未登记或不匹配拒绝，绝不用 legacy 命名猜部署。
3. Console 只在 `HZY_CONSOLE_GATEWAY_EXCHANGE_ENABLED=true`、无 client_secret、
   带专用断言头时选择新路径；先用 Foundation 的受信 Gateway helper 校验转发身份，
   再逐字段比较断言与受信 tenant/environment/source app/deployment/Gateway/Runtime
   和原 OAuth client_id/audience/canonical scope。body.app_code 必须匹配，不能作授权来源。
   无断言或默认关闭仍走原路；有断言失败不在 Console 内偷偷切回旧签发。

Runtime `apps.console.gatewayExchangeEnabled` 默认false；keyset同步开关单独设置，
不会隐式开启exchange。Foundation调用使用已有真实console.runtime路径和新精确scope。
Gateway第四批必须剥离浏览器伪造的断言/Gateway部署头，自行从已解析登记事实生成；
并受信传递 `x-hzy-gateway-service-assertion`、`x-hzy-gateway-deployment`、
`x-hzy-data-runtime-code`。本批没有新增可信头白名单或部署Worker。

## 断言与传输合同

JWT header严格 `{alg:"EdDSA",typ:"hzy-gateway-service-assertion+jwt",kid}`。
kid为已登记原始公钥SHA256，key必须active且当前有效，next/revoked/未知均拒绝。
不接受数组、多值、未知字段、重复JSON成员、尾随内容、非canonical base64url。

claims（snake_case）：

- iss/sub=`gateway:{gatewayDeployment}`，aud为精确exchange路径。
- tenant/environment/gateway_deployment/runtime_code：与已验证keyset及本机配置一致。
- source_app/source_deployment/client_id/oauth_audience/scope。
- source_binding=`trusted-gateway`、method=`POST`、path为精确exchange路径。
- iat=nbf、exp>iat、跨度≤60秒，允许±30秒时钟偏差；jti为规范base64url，解码≥16bytes、长度≤64。
- scope去重、排序、单空格连接（与Foundation调用方规范化一致）。

Runtime独立检查签名和所有字段后，才给内部适配器传已验证claims。
传输body只允许 `{assertion,clientId,audience,scope,issuer,ttlSeconds,policyVersion,caps}`，
严格JSON与64KB上限；clientId/audience/scope须与签名claims逐字相等。无app/tenant/
deployment/公钥/secret自报字段。Console是受信issuer/TTL/摘要提供者；Runtime沿既有
签名合同限制issuer绝对HTTP(S)、TTL 30–3600秒，摘要必须与存储version/hash一致。

## 授权、签发、审计、防重放同一事务

在keyset读锁内执行Runtime的同一SQL事务（新鲜keyset撤销不能在签发commit前穿透）：

1. 锁当前 active service client 与其 current active 未过期credential，DB app_code必须
   精确等于已验证签名source app，不用client_code回退选择别的应用。
   保留旧clientId别名（实际ID/code、app、app.runtime），但必须匹配该DB身份。
2. 复用旧授权器校验每条精确ACTIVE scope/目标audience；每条被选择grant都须有
   相同tenant/deployment绑定，并与签名源匹配。没有绑定的旧grant不能静默补齐或降级。
   这比旧trusted-gateway路径更严格，环境启用前须核对真实批次grant差集，缺口先报审。
3. 清理最多100条过期replay，然后插入 `(gateway_deployment_code,jti)`；唯一冲突
   401 gateway_assertion_replayed，缺表503 gateway_replay_storage_unavailable。
4. 只比较policy_bundle_snapshots的version/hash，不拉payload、不从快照授予权限。
5. 复用带密钥P1路径的当前OIDC key检查、claims构造、签名及成功auth_token_events审计。
   audit失败或任何错误全回滚，commit后才返回一枚token。不存在影子第二枚token。

全量claims（除iat/exp时刻）与旧Console `buildServiceAccessTokenClaims` 公开fixture
完全一致；TTL也一致。原带密钥P1入口签名、授权、审计逻辑保持不变并回归测试。

## 有界清理

使用expires_at索引，事务内 `DELETE … WHERE expires_at < now_ms - 30000
ORDER BY expires_at LIMIT 100`，每次成功签发最多一批；不循环全表、不删新鲜行。
事务失败清理也回滚。超过容差的旧断言即使replay行已清理，仍被时间校验拒绝。
case-sensitive主键和并发/跨部署jti约束沿第一批迁移；没有后台全库清理/新cron。

## 专用错误与回退

| 场景 | 响应 | 可回旧路径 |
| --- | --- | --- |
| keyset首次拉取前、缺失、已过期、Runtime未ready | 503 gateway_keyset_unavailable | **仅此码可** |
| keyset坏签名、回滚或落盘失败 | 503 gateway_keyset_invalid | 否 |
| 断言签名/字段错误 | 401 gateway_assertion_invalid | 否 |
| 未知/撤销/next/过期key | 403 gateway_assertion_key_invalid | 否 |
| 已消费jti | 401 gateway_assertion_replayed | 否 |
| grant/client/绑定拒绝、策略摘要不符、audit失败、缺replay表 | 各自4xx/5xx | 否 |
| exchange开关关闭 | 503 gateway_exchange_disabled | 否（Gateway不开新lane） |

Foundation纯合同helper `gatewayExchangeAllowsLegacy(status,code)` 只接受精确
503+gateway_keyset_unavailable。第四批Gateway调用 `gatewayExchangeWithLegacy`
时只发一次exchange；专用码出现才一次去掉断言走原三次调用路径。不重新签断言、
不在Console自动重试、不为签名/replay/授权失败降级；网络错误和泛5xx不回退。
已签发响应丢失时原jti不能再签一枚，调用方只能发新的显式OAuth请求。

## 待执行授权SQL与环境关口

[v2.20 seed](../console/docs/sql/Console-SQL-Seed-v2.20-gateway-service-token-exchange.sql)
与[verify](../console/docs/sql/Console-SQL-Verify-v2.20-gateway-service-token-exchange.sql)
只准备。单条精确console.runtime内部grant以audiences数组覆盖data-runtime/tenant-runtime
（沿已审v2.18模式）；包含C000001/test-console绑定与semanticScope，只插缺失，
已有revoked不复活。seed以org_profiles tenant=C000001约束，verify核对source、
client、status、两audience、semanticScope、tenant/deployment及本机tenant。
环境计划另审后才备份/执行/verify/双audience真实签发。

用户已批准测试环境上线大范围，但每个具体环境步骤仍先经Claude审查；Worker
必须先证明仅测试。生产/main/GitHub不可动。当前测试Console原P1开关和旧版本未改。

## 测试证据范围

- HTTP完整Console JWT门槛、缺scope/错aud/source/tenant/deployment/过期/非服务/错client/
  无效credential拒绝；默认关闭与keyset缺失的专用码。
- Runtime断言签名/字段/用途/方法/路径/时间/JTI/canonical/重复JSON负例；keyset错误
  与absence不同；冻结keyset读锁；旧target paths的所有Go回归。
- SQL mock与/tmp真实MySQL：精确grant、源绑定、重复/并发jti、缺表、审计回滚、
  revoked grant、一次≤100清理和时钟容差保护；v2.20 seed重复不增加行。
- Console受信转发与全字段比对；旧claims公开fixture跨TS/Go核对；Foundation回退矩阵
  证明一次exchange/专用码一次旧调用、成功不调用旧路径、所有安全失败与超时不回退。
- 实际Gateway签名/剥离/Service Binding转发、正式环境端到端与性能对比属第四批及
  审批后的上线计划，本批未执行，不宣称已有真实Gateway token可用。

## 第四批签名调用方

Gateway签名lane、受信头白名单、唯一JS/TS回退合同、默认关闭及强制启用/回滚顺序见 [第四批上线计划](Gateway-Service-Assertion-Rollout.md)。Console收到proof但Gateway exchange开关关闭时返回503 gateway_exchange_disabled，不静默走旧路径；该码不允许回退。正式启用前必须列所有选中业务grant的精确绑定差集，缺口先报告。
