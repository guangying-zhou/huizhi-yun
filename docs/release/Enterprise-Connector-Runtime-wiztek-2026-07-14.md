# Enterprise Connector Runtime 0.4.18 — wiztek 生产发布记录

状态：已完成 wiztek 内部验证环境的生产部署、企业微信与钉钉真实通知、企业微信与钉钉真实登录、钉钉 People 真实同步；项目负责人于 2026-07-16 明确不执行停用 Directory 账号的生产演练，该边界保留自动化失败关闭覆盖  
执行日期：2026-07-14 至 2026-07-16  
目标绑定：`C000001 / C000001-console`  
Connector 主机：`gitlab.wiztek.cn`（与 data-runtime 分机部署）

## 执行边界

项目负责人明确授权复用现有发行密钥，并由 Codex 直接执行生产 migration/seed、R2、Cloudflare、独立 Connector 服务器安装与验收。本记录不保存数据库密码、登录 Cookie、enrollment code、service credential、消息内容或供应商凭证。

本次结果仍属于 wiztek 内部验证，不代表已达到付费租户 SLA。

## 发行与 R2

- 产品：`hzy-connector-runtime`
- 版本：`0.4.18`
- 来源标识：`5198853`
- 构建时间：`2026-07-15T23:53:31Z`
- 平台：`linux/amd64`、`linux/arm64`
- Ed25519 keyId：`e1f7cfc0fb174116c305766c2a39d90606e22cc5a3c02d1cf7fc749578bcab82`
- R2 prefix：`packages/hzy-connector-runtime`
- 公网 `latest/version.txt`、manifest、installer、archive、SHA-256 与 detached signature 均已验证。
- `0.4.11` 的 staging 内容摘要为 `ab60d0caec8ed54a26aed5fae5d7f44ed84ad6361c24d79669bc142294826787`，promotion 计划摘要为 `f0a02811638e178ece142933375c9a91b838fa21a470904eeee820359fbd7e42`。
- `0.4.14` 的 staging 内容摘要为 `033ccebbb5839df41b1f53bb17446c05e708495827f8b484481e59385879b788`，promotion 计划摘要为 `b085c52b2de5059b327eae69bee444e5746c04f9cd071669eb1c397a46437630`；该版本只增加钉钉 People 失败时的安全供应商错误码诊断，不回传 access token 或供应商原始错误正文。
- `0.4.15` 的 staging 内容摘要为 `3fda8acd1626010ce6e7a3cd19456aef860ce82481b4496c2293fcd54d45dc9b`，promotion 计划摘要为 `b4062234d7d233d8844d28a01993072b0cdeff78fe29cb376cb2be04ce8885ec`；该版本修正 data-runtime 原始批次回执被按旧 `data` 包装层解析而静默变成 `0/0` 的契约错误，并在回执缺少 `applied/skipped` 时失败关闭，同时将钉钉通讯录权限码映射为具体权限名。
- `0.4.17` 将通知/People 的 `dingtalk.default` 与网页登录专用 `dingtalk.identity` 凭证边界分离。staging 内容摘要为 `e8e91efa8ad7511a16c75f86e96b1dd112f69d5ab0a8482d67182f594f45d78e`，promotion 计划摘要为 `6515231646a8681878ae75a257969b59ef261f0183956603cab04765e6e1c98f`；amd64/arm64 archive SHA-256 分别为 `c2aac4d3bf2191701f04ef2e9f21f08e960fb591a6609126dd1af5adf17a60eb`、`833e91c0ed367ba4fa0a9ffc5f3f66a01f625b5853e0d435417fc04c838e2ce9`，manifest SHA-256 为 `ae239ab15764804a9ff1666404582325b75d688642d018afff76ad3f0a101229`。
- `0.4.18` 为钉钉身份交换增加仅输出稳定安全错误码的服务端诊断，不记录授权码、access token 或供应商原始响应。staging 内容摘要为 `7c0b64ae2ed0cd04d6b6b876e60586f21e7a4c4c9aadc02fd3f2c3fe070bad3b`，promotion 计划摘要为 `9762ea9d03c4c64f6df8104afc115015dc316085804145b25e97bcd209ae6b34`；amd64/arm64 archive SHA-256 分别为 `69eda544b3f8b582b7fd42b2d865c47edb2db58a81628b02dd529417de08515e`、`c24bec27b8524a50026b1363b9e50e6e812314d645b3bb53598ad45146854c29`，manifest SHA-256 为 `6095547679e0b8ae69c5235f82d6e96e23b2ea49cd232440fe915f6c2208d5c6`。首次 promotion 在写入激活指针前遇到 Cloudflare API 临时 `520`，同一已校验计划重试成功，最后写入 `latest/version.txt`，未暴露半激活版本。
- 不覆盖旧不可变版本；`0.4.11` 保留 0.4.6 的 `replayed` 幂等证据和 0.4.7 的结构化快照，并随签名归档安装只读 `verify-slo-window.sh`。0.4.9 先升级 updater，使后续版本能完整预检并原子更新三个 Connector 运维脚本；0.4.10 完成两跳自举，0.4.11 验证后续 updater 可直接更新窗口脚本。

## 生产数据库

Console 已应用 Connector Runtime 所需 migration/seed，包含：

1. v1.68 enrollment tables
2. v1.69 Connector settings/grant
3. v1.70 external login transactions
4. v1.71 WeCom identity
5. v1.72 DingTalk identity/integration
6. v1.73 People async sync
7. v1.74 heartbeat/diagnostics/revocation
8. v1.75 job control grants
9. v1.76 heartbeat scope
10. v1.77 DingTalk identity integration binding/grants
11. People Connector sync receipt

重复执行验证通过；migration/seed 不包含运行时明文凭证。

## 独立服务器部署

- `hzy-connector-runtime.service`：`active`
- `hzy-connector-runtime-update.timer`：`active`
- 当前版本：`0.4.18`
- 认证：JWT，tenant/deployment 精确绑定
- 存储：SQLite，`/opt/hzy/connector-runtime/data/operations.db`
- Runtime 公网地址：`https://wecom-api.wiztek.cn`
- 健康检查：`status=ok`，`deliveryStore=ready`
- Capability 文档明确声明 `arbitraryHttpProxy=false`；企业微信与钉钉只允许代码审核过的固定 origin。
- 心跳持续成功，最终服务重启计数为 `0`。
- 每 5 分钟向本机 journald 写入一条 `connector_runtime_slo_snapshot`。随包安装的 `verify-slo-window.sh` 已对 11 个快照、2592 秒（约 43 分钟）执行生产验收：版本从 0.4.7 计划升级到 0.4.11，runtimeId/tenant/deployment 全程稳定，快照全部可用，SQLite 保持 65536 字节，delivery 总量从 12 增至 13，People job 为 0，`NRestarts=0`。脚本只消费白名单聚合字段，额外/敏感字段、不可用快照、绑定漂移、总量倒退或重启超限均失败关闭。
- 被吊销身份收到 401/403 后以状态 `78` 退出；systemd 使用 `RestartPreventExitStatus=78`，不会形成凭证失效重启风暴。

SSH 验收期间服务端提示当前连接未使用 post-quantum KEX；不影响本次 TLS/JWT/Ed25519 验收，但应作为服务器 SSH 基线升级项跟踪。

## Notification Runtime 迁移

已显式执行旧 Notification Runtime → Connector Runtime 迁移：

- `hzy-notification-runtime.service`：`inactive`
- `hzy-notification-runtime-update.timer`：`inactive`
- 旧 ledger 保留于 `/opt/hzy/notification-runtime/data/delivery.db`，未删除。
- 新 ledger 为 `/opt/hzy/connector-runtime/data/operations.db`，权限与服务用户已收紧。
- 迁移后健康、capabilities、JWT 和外部 Nginx 路由全部复核通过。

Nginx 只将 `wecom-api.wiztek.cn` 的 upstream 端口从旧 Runtime 切换到 Connector Runtime；切换前配置保存在：

`/etc/nginx/vhost/wecom-api.wiztek.cn.conf.pre-connector-20260715094712`

## Cloudflare Console

生产 Worker：`hzy-console-prod`。

本轮依次修复并部署：

- enrollment service token 的 tenant/deployment 从已验证 grant metadata 派生；
- Connector 管理开关使用受控 managed setting 更新；
- 配置检测按实际激活的 Connector target 签发 JWT；
- 服务集成授权同时兼容稳定 `clientCode` 与历史随机 `client_id`，并继续要求精确 `appCode` 与 `integrationCodes` 白名单。
- 企业微信测试卡片的 action URL 只从已验证 Tenant Gateway 上下文生成，避免跳转到缺少 tenant/deployment 的 Console Worker 源站。

当前 Cloudflare Version ID：`0c91e252-60a3-4554-a7df-5852f1d06f15`。

发布门禁通过：lint、typecheck、341 项测试（340 pass、1 个临时 MySQL 环境测试 skip）、Cloudflare config、build、Wrangler dry-run 和正式部署；Connector Go 全量测试、18 项发布脚本测试、签名 R2 发布、独立服务器升级与健康验收全部通过。构建只保留既有 sourcemap 与未启用 scheduled task warning。

Console 的企业微信测试入口在 Connector Runtime 模式下会复用完全相同的请求体和幂等键执行第二次调用；只有第二次响应明确返回 `replayed=true` 才显示“幂等重放已验证”。第一次实际投递成功而第二次证据校验失败时，发送记录仍按真实结果记为已发送，同时验收请求返回失败，避免把证据校验失败误记成供应商投递失败。旧 Notification Runtime 模式不伪造该结论。

身份能力开关增加供应商就绪门禁：启用前先验证固定 integration code、provider/type、active 状态、必需的公开配置，以及集成→绑定→Vault secret→固定版本的完整 active 链路，再验证 Connector Runtime 的精确 capability；校验过程不解密、回传或记录凭证明文。生产复核确认企业微信与钉钉身份交换均为“已启用”。

## 功能验收

- Connector 管理页可正常加载，实例心跳、版本、绑定与脱敏诊断正常。
- 停止 Connector 超过 3 分钟后，Console 无需刷新即显示“心跳过期”；恢复服务后自动回到“运行中”。stale 判定由 MySQL `UTC_TIMESTAMP(3)` 统一计算，避免浏览器时区误判。
- 已完成设备凭证轮换，RSA 设备公钥指纹在轮换前后保持不变，业务服务不中断。
- 已完成吊销演练：下一次心跳收到 401 后进程以状态 `78` 停止，`NRestarts=0`；重新登记后恢复 `active`，升级 timer 正常。
- 一次性恢复指令在 Console 的 30 秒后台刷新后仍保持可复制，直到过期或实例状态变化；使用后不在记录中保留 enrollment code。
- 通知通道已从旧 Notification Runtime 显式切换为 Connector Runtime。
- 企业微信身份交换已启用。
- 企业微信配置检查全部通过：Runtime 可达、JWT、集成、Vault 凭证解析、服务身份和读取授权均为 `pass`。
- 已向测试账号执行真实企业微信消息发送；Connector 日志记录 `notification sent provider=wecom integration=wecom.default`。重新登记后又完成两次独立真实请求，SQLite ledger 记录 10、11 均为 `succeeded` 且 `attempt_count=1`。
- 修复 action URL 后再次发送验收消息成功；新卡片链接为租户入口 `/notification-runtime`，不再使用 `console.huizhi.yun` 源站。
- 2026-07-15 已从生产 Console 受控入口向 `zhouguangying` 执行同请求双调用验收：页面明确返回“已发送至 zhouguangying，幂等重放已验证，通知中心已记录”，且浏览器无 error/warn。Connector journal 只记录一条 `notification sent provider=wecom integration=wecom.default`，随后两次 `/v1/notifications/send` 分别完成实际发送与 ledger 重放；即时脱敏 SLO 快照的 `succeeded` 只从 7 增加到 8，证明供应商只投递一次。Connector 自身服务凭证仍保持最小权限，未为验收临时扩权；服务保持 active，`NRestarts=0`。
- ledger 保留迁移记录和本轮故障排查的失败记录，不包含在本文中展开的消息内容。
- 生产 `dingtalk.default` 已绑定数据库加密 AppSecret，并完成钉钉机器人真实通知验收。应用已开通
  `qyapi_robot_sendmsg`、创建机器人能力并发布应用版本，真实 Robot Code 已回填 Console。生产集成中心
  向 `manager1561` 执行同请求双调用后状态转为“正常”；Connector journal 只记录一条
  `notification sent provider=dingtalk integration=dingtalk.default`，SQLite ledger 仅新增 delivery 23，
  状态 `succeeded`、`attempt_count=1`、无错误码，证明第二次调用命中 durable replay，没有重复投递。
  `POST /api/v1/console/connector-runtime/dingtalk-test` 与 `pnpm run accept:dingtalk-connector` 仍保持显式动作、
  变更号、环境变量会话及预览 SHA-256 门禁；钉钉登录与 People 同步尚未据此宣称完成。
- 2026-07-15 曾使用该 CLI 对生产执行零凭证只读验收：当时公开登录仍为 OIDC 默认且仅启用
  `oidc,wecom`，`dingtalkConfigured=false`；独立 Runtime 为 `hzy-connector-runtime 0.4.11`，
  tenant/deployment 为 `C000001/C000001-console`，JWT 与 SQLite ready，`arbitraryHttpProxy=false`，
  钉钉 origin 精确为 `api.dingtalk.com`、`oapi.dingtalk.com`，通知、身份和 People 三项类型化能力
  均存在。此次模式为 `read-only`，未带 Cookie、未创建登录事务、未写集成状态、未发送消息、未启动同步。
- data-runtime 维持 `0.3.110`，与 Connector Runtime 分机部署，Connector 不直接连接业务数据库。
- 2026-07-15 钉钉真实登录 start 进入供应商授权页后返回 `900103 应用不存在`，错误发生在
  Console callback 之前。生产请求仍携带已用于通知/People 的 AppKey；用户提供的 `UnifiedAppId`
  页面说明其替代的是 AgentId/三方 AppId，不能据此将它当作 OAuth Client ID。Console 和
  Connector Runtime 已增加显式 `oauthClientId`：登录授权与授权码交换优先使用该值，通知/
  People 仍使用 AppKey，未配置时向后兼容。Connector `0.4.16` 已签名发布、R2 提升并在
  独立服务器升级，健康检查返回 `version=0.4.16/status=ok`；Console Worker
  `bdd39429-e00d-4114-8535-0991dbe191c4` 与 Platform Worker `33187ae3-df55-4ca0-94a6-5eb20e638b39`
  已发布。真实 callback 验收仍等待钉钉后台开通/发布网页登录能力并确认该能力的
  OAuth Client ID，不得将 302 start 或运行时本地测试冒充为登录成功。
- 后续产品化审计确认通知/People 与网页登录可能属于不同钉钉应用，不能强制共享 AppSecret。
  Console 因此新增独立 `dingtalk.identity` 集成和 Vault secret，并将所选 integration code 绑定到
  单次 OAuth transaction；Runtime 身份交换不再要求 Robot Code。没有 active 专用集成的旧租户
  继续回退 `dingtalk.default`。数据库 v1.77 已应用并验证 transaction column 与两个精确 grant；
  Connector 0.4.17 已签名发布并在独立服务器保持 `active/status=ok`，Console 已发布上述 Worker。
  登录入口现对纯数字 AgentId 和 UUID 形式 UnifiedAppId 失败关闭。生产只读探测已明确拒绝当前
  `AgentId=4782742329` 配置，未再向供应商创建无效授权请求。真实 callback 验收仍需把
  `dingtalk.identity` 配置为“凭证与基础信息”中的 OAuth Client ID/AppKey 及匹配 Client Secret，
  并在钉钉后台重新发布包含回调配置的应用版本。
- 上述 `0.4.17` 时点的“仍需真实 callback”结论已被 2026-07-16 的生产证据取代：`dingtalk.identity`
  使用独立 AppKey/Client Secret，Console 授权 scope 收敛为 `openid corpid Contact.User.Read`；用户完成
  企业组织选择和钉钉授权后，Connector `0.4.18` 成功完成授权码交换、当前用户资料读取及企业 userid
  映射，Console 随后完成 `resolveOrBindDirectoryIdentity` 与 session 建立并返回租户工作台。成功请求仅记录
  类型化 `/v1/identity/dingtalk/exchange` 访问日志，没有安全失败码；此前诊断出的
  `dingtalk_identity_profile_failed` 仅用于定位缺少用户资料 scope，未暴露供应商正文或凭证。

## Phase 2：OIDC 默认 + 企业微信可选登录（2026-07-15）

- 登录策略将“默认登录方式”和“启用的登录提供方”分离：wiztek 继续以 OIDC 为默认，同时启用企业微信；旧租户没有 `enabledProviders` 时仍只启用原 `mode`，不会被自动扩容。
- Platform、Console、Tenant Gateway 的当前生产 Version ID 分别为 `c099a650-19dc-48b5-a8d5-1a88b2f494ce`、`4e6f1d73-933d-43b7-a88b-cecd582a29e0`、`042413bc-61a7-4d5c-96e6-dd6300b4922a`。
- Tenant Gateway 注册表 Cache API 的缓存键已提升到 v2，确保新增提供方列表不会继续命中旧结构缓存。
- `C000001 / prod` 复用 `wecom.default` 的 Corp ID 与 Agent ID；CorpSecret 仍只由 Vault 与 Connector Runtime 解析，未写入 Platform、Gateway 请求头、策略包响应或本文。
- 已生成策略包 `pv_prod_20260715032650_0077`，schema `policy-bundle.v2`、policy revision `12`、target `9`。
- 外部协议验收：`/api/auth/login-config` 返回 `mode=oidc` 与 `enabledProviders=[oidc,wecom]`；OIDC start 返回 302 到 `sso.wiztek.cn`，企业微信 start 返回 302 到 `open.work.weixin.qq.com/wwopen/sso/qrConnect`，两者均携带一次性 state。
- 多提供方登录页已确认同时展示“企业统一身份登录（默认）”与“企业微信登录”。真实扫码 callback、外部身份绑定及禁用用户失败关闭仍待人工扫码完成后补证，不能以 302 跳转替代。
- 生产 start 已再次确认二维码端点为 `open.work.weixin.qq.com/wwopen/sso/qrConnect`，实际 `redirect_uri` 为 `https://wiztek.huizhi.yun/api/auth/wecom-callback`。实测企业微信后台不接受当前 `wiztek.huizhi.yun` 租户网关域名，因此企业微信登录方向自 2026-07-15 起暂停；后续先为 Tenant Gateway 增加企业微信可接受的租户自定义域名，再以该域名重新生成 callback 并恢复扫码、绑定和禁用用户失败关闭验收。2026-07-15 再次只读核对发现公开登录配置仍为 `enabledProviders=[oidc,wecom]`，说明暂停决策尚未落实到生产入口；因 Platform 管理员会话过期，本次未绕过认证修改数据库，待管理员登录后将其收敛为仅 OIDC。该设置变更不得删除 `wecom.default` 或 Vault 凭证，以确保 Connector Runtime 企业微信通知不受影响。
- 企业微信客户端 UA 已验证跳转 `open.weixin.qq.com/connect/oauth2/authorize`，scope 为 `snsapi_base`；伪造 callback state 在调用 Connector 前返回 400，并记录 `wecom_callback_failed_400` 脱敏审计。
- 根工作区新增 `pnpm run accept:enterprise-login` 验收脚本：默认只读取公开登录配置；`--probe-starts` 显式创建短期事务并校验 OIDC、企业微信桌面/移动官方 host 与 state；`--probe-invalid-state` 需再次显式开启。脚本 5 项单元测试及 wiztek 生产配置/redirect probe 均通过，公开配置无 CorpSecret/AppSecret/ClientSecret 字段。
- 上述首次 Phase 2 验收时钉钉尚未配置、未启用；该历史状态已由下方 Phase 3/4 增量记录取代。
- 后续已通过租户专属 Connector 回调域完成企业微信真实登录，原“暂停”判断已被真实生产证据取代；`wecom-api.wiztek.cn` 是当前 wiztek 租户专属域名，不应被解释为所有租户共用回调域。
- 当前登录策略仍以 OIDC 为默认，同时启用 `oidc,wecom,dingtalk`；策略包已更新为 `pv_prod_20260715182407_0078`。

## Phase 3/4 增量验收（2026-07-15 至 2026-07-16）

- Platform 已保存钉钉公开登录参数并保持 AppSecret 只在 Console Vault；生产默认登录仍为 OIDC，启用提供方为 OIDC、企业微信和钉钉。
- `accept:enterprise-login --probe-starts` 已验证 OIDC、企业微信与钉钉 start 均落到各自官方域名并携带一次性 state；公开配置没有供应商 secret。钉钉真实用户 callback、Directory identity binding 与 Console session 已完成生产验收；项目负责人明确不执行禁用用户生产演练，自动化失败关闭测试继续作为该边界的验收证据。
- `accept:dingtalk-connector` 已在自动升级后再次验证 Connector `0.4.14` 的 JWT、SQLite、tenant/deployment、`arbitraryHttpProxy=false`、两个固定钉钉官方 origin 及通知、身份、People 三项类型化能力；生产二进制随后自动升级到 `0.4.15`，服务保持 `active`。
- Console Connector 管理页为固定“反馈”按钮增加底部安全区；生产真实点击“开始同步”已创建任务，失败任务可生成带 `retryOfJobId` 的新任务，证明 Console→Runtime→SQLite job/poll/retry 链路可用。
- 首次同步和 `0.4.14` 重试均在部门读取阶段失败；重试页面只显示安全错误 `provider code 88`。服务器侧受控诊断确认 access token 正常，钉钉返回 `subcode=60011`，缺少 `qyapi_get_department_list`；对人员列表的独立只读探测还确认缺少 `qyapi_get_department_member`。
- 两项权限开通后，`0.4.14` 已成功读取 10 个部门和 79 名用户，但因 Connector 误按旧包装层解析 data-runtime 原始回执，任务摘要被错误记录为 `applied=0/skipped=0`。`0.4.15` 修复后重新执行生产任务 `crj_hnrybpYTtlYFQ5BxRmAl3O8f`，约 6 秒完成：部门 10、人员 79、写入 77、跳过 2、批次 3。
- data-runtime 生产回执逐批核对为：批次 1 `0/0`（组织批次）、批次 2 `77/2`（人员批次）、批次 3 `0/0 final`；三条状态均为 `success`。`hzy_people.people_employees` 中 `metadata.source_app=connector-runtime` 的实际行数为 77，与任务回执一致。两名未绑定或未激活的供应商 subject 按契约安全跳过，不创建孤立 People 员工。
- 失败任务 `crj__Fy2C-p7HkfCo-9-OBySMhKI` 的生产重试已生成独立 `retryOfJobId` 任务并成功完成，证明失败记录不被覆盖。data-runtime 回执以 `job_id + batch_number + batch_hash` 持久化，重复内容返回原计数、内容漂移返回冲突；对应自动化测试与全量 Go 测试通过。本轮生产不为制造重放证据再次调用钉钉，避免无业务必要的供应商读取。
- 钉钉真实登录最终验收使用 Console Worker `0c91e252-60a3-4554-a7df-5852f1d06f15` 与 Connector Runtime `0.4.18`。登录完成后浏览器返回 `https://wiztek.huizhi.yun/` 并显示已登录工作台；callback 只有在 Directory 外部身份解析/绑定与 Console session 创建均成功后才执行该跳转，因此该结果同时构成 callback、身份绑定和会话建立证据。自动化测试已覆盖 inactive external identity 与 disabled Directory user 失败关闭；项目负责人于 2026-07-16 明确不再执行对应生产账号演练，未修改任何停用账号或当前管理员状态。

## 回滚

如需回滚通知链路：

1. 在 Console 停用 Connector 通知通道；
2. 恢复上述 Nginx 备份并执行 `nginx -t` 后 reload；
3. 停止 Connector service/timer；
4. 恢复旧 Notification Runtime service/timer；
5. 保留两套 SQLite ledger，禁止相互覆盖后再核对幂等键与最终状态。

Connector 身份轮换或吊销必须通过 Console 管理页执行，不直接编辑服务端 client secret。
