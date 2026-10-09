# Unified Enterprise Console 批次 C 只读盘点

> **2026-10-01 已被 ADR-018a D8 取代**：Console 保持独立管理控制台，本盘点中迁入 Enterprise 的 Console 管理页及其 BFF 已删除；下文仅作历史记录。

日期：2026-09-26；执行者：Codex-sol2。依据 `.git/codex-brief-console-batch-c.md`。

## 0. 现有秘密回传与泄漏通路（先行送审）

这里区分「源码确定存在的秘密回传」「源码确定的持久化/脱敏缺口」与「实际秘密是否已落入其中尚未验证」。没有读取环境秘密、调用业务接口、查询数据库或打印秘密值；授权揭示不等于越权泄漏。

|编号|发现与证据|确定性 / 影响 / 建议|
|---|---|---|
|C-SEC-01|Vault reveal 返回 `plaintext`：`data-runtime/internal/apps/console/vault.go:346,379`；Console handler `console/server/api/v1/console/vault/secrets/[secretCode]/reveal.post.ts:6,18,20` 要求 credential_vault:admin、reason，并设置 no-store；页面 `console/app/pages/vault.vue:387` 接收并展示。|确定的授权明文回传，属于 (c)，留 Console。不能把 POST 当作天然不缓存，也不能迁入 Host 后沿用 reveal。未证实越权或日志落盘。|
|C-SEC-02|LDAP 创建的生成初始密码在首个响应返回 `initialPassword`：`data-runtime/internal/apps/directory/console_connector_management.go:299-310`；页面 `console/app/pages/directory/users.vue:312,318,659` 存入 ref、展示、允许剪贴板。|确定的一次展示设计，(c)。Runtime 在 finish receipt 后才构建明文响应，receipt 不保存该密码（同文件:290-305）；提供的初始密码不回传，激活模式也不回传密码。用户创建不能整块归 (b)。|
|C-SEC-03|Connector 安装 POST 返回一次性 `enrollmentCode`，并拼入 `installCommand`：`data-runtime/internal/apps/console/connector_runtime.go:148-151`、`console/server/utils/connectorRuntimeEnrollment.ts:97,141-155`。页面把响应写入 `useFetch` 的 metadataData（`console/app/pages/connector-runtime.vue:107,287`）并复制剪贴板 (:304)。该 POST handler 未显式设置 no-store。|确定的 bearer 安装码回传、客户端共享数据状态驻留；HTTP/代理缓存是否发生未验证。一次性/15分钟并不消除 SEC-03。GET metadata 的 command 为空，不能误称初次 SSR 已包含安装码。Runtime receipt 只存 last4/expiry 等非明文结果 (:133-151)。整页 (c) 留 Console；应由 Claude 决定独立整改 no-store/状态生命周期。|
|C-SEC-04|审计写入按键名脱敏，普通字符串原样保留：`data-runtime/internal/apps/console/audit.go:618-677`。例如 `detail/error/message` 字符串内夹带秘密不能被递归键名规则清除；读接口返回 JSON detail (:85,110)，页面 `console/app/pages/admin/logs.vue:300-302` 展示原始 detail。|确定存在文本泄漏通路；未证实现有数据库里有秘密，不能宣称已泄漏。敏感键 password/token/authorization/cookie/dsn 等已遮罩，不能写成完全无脱敏。Host 日志页必须白名单重建，禁止 raw detail/error/attempt payload。|
|C-SEC-05|通用 settings 的 `value/defaultValue` 无秘密类型/遮罩，直接从 JSON 解码返回：`data-runtime/internal/apps/console/settings.go:46-63,327-359`；页面 useFetch `console/app/pages/system-settings.vue:34`。integrations/source 的历史 config 与 lastError 同样直接读出：`data-runtime/internal/apps/console/integrations.go:70,102`、`directory_sources.go:163-192`。|确定的通用回传机制；当前值是否含秘密未验证。integration 新写入有递归秘密字段拒绝 (:1070-1110)，source 有已知秘密键拒绝 (:111-147)，但都不能证明历史数据/任意字符串无秘密。不能整页照搬到 Host。|
|C-SEC-06|未经分类的异常原文可进响应/状态/日志：`console/server/utils/dataRuntimeManagement.ts:142-162,355,416-424`；`platformRuntime.ts:1072-1091` 保存/回传 lastError，:1060 记录 heartbeat error；头像上传 `console/server/api/v1/console/directory/me/avatar.put.ts:55-62` console.error 原始 Error.message。PM2 action 返回 stdout/stderr：`console/server/api/v1/console/runtime/apps/[appCode]/action.post.ts:25-26`。|确定的原文通路，是否夹带 token/URL凭据/环境值未验证。Host 仅输出固定失败类别；Console 现有整改另立任务。integrations connectivity check 已返回固定文本（integrations.go:810-872），不应误报其 provider 原始 error 泄漏。|
|C-SEC-07|激活 token 从 Runtime 首次响应进入 Console，Console 用于向本人投递，正常成对字段路径剥离 token：`console/server/api/v1/console/directory/users/index.post.ts:69-86`。缺 token 或 credentialId 时原样 return operation (:72)，没有始终白名单重建。|当前 Runtime 成功分支同时产生两字段（console_connector_management.go:275-287），未证实缺字段泄漏；属于契约漂移防线缺口。投递邮件含 /set-password?token=，in-app URL 不含 token (:24,34)，外部邮件/访问日志存储需专项核验。|

|C-SEC-08|WeCom测试发送未知异常原样返回（`console/server/utils/integrations.ts:234-274` map仅覆盖几种错误）；`console/server/api/v1/console/notification-runtime/wecom-test.post.ts:70-113,129` 把Error.message放入通知summary/body/metadata与delivery lastError，形成持久副本。|确定的错误文本持久化通路；是否实际包含秘密未验证。其通知可能经既有Host notifications/todos链展示，优先审查。与Runtime integration connectivity check的固定错误映射是不同路径。|

Vault maskedPreview 不是零秘密投影：`vault_crypto.go:219-227` 长值返回前4+后4，短值全遮罩；外部 backendRef 也做部分遮罩 (:154)。目录源 `backendSecretRefMasked` 同理（directory_sources.go:170-178,198）。这是确定的部分回传设计，Host 若要求「无秘密」必须删去这些字段；不能凭「masked」认定 SEC-03 已满足。

## 1. 范围、依据与分类口径

ADR-017 SEC-03：`docs/ADR-017-Console-Tenant-Data-Plane-Separation.md:243`；阶段1与批次 C门禁：`docs/ADR-017-F3-F4-Remediation-Plan.md:134-139`。采用协调者已确认的阶段1完成、Runtime 0.3.248、兼容表清空事实，不重复环境操作。阶段2签名域工作不自动阻塞本次盘点，也不自动授权敏感页迁移。

- **(a)** 仅无秘密的只读投影；原页带写功能时，以下分类只覆盖拆出的只读部分。
- **(b)** 秘密只输入、不回传，Host BFF 仅限单次请求转发；请求体、异常、receipt、SSR、日志/Trace/缓存必须逐层验证。
- **(c)** 揭示秘密/签名材料，或当前投影无法证明无秘密，保守留 Console；并标出「确定 reveal」或「待净化」。非密控制面动作也可因信任边界留 Console，不能强行塞进 (b)。

数据面现有能力通常由 `foundation/server/utils/consoleTenantRuntimeClient.ts` 的受限 `/v1/console/*` 请求到租户 Runtime，再由 Console Runtime adapter 访问业务库，**不是 Host 直连 DB**。批准后的迁移仍仅登记精确 METHOD+路由，Console handler 做最终权限校验；不能改 consoleUserApi/notifications/consoleServiceBinding，也不能扩大 composition.modules。本文只列候选，不新增路由。

## 2. 页面 / API / 权限 / 写入总览

下表路径除特殊说明均以 `/api/v1` 开头；`K` 表示 handler 要求 Idempotency-Key，`无K` 表示没有该门禁。精确 handler 文件及调用证据见 §8/§9，不能以页面按钮替代 handler 权限。

|页面|读取 / 来源|写动作、权限与幂等|SEC-03 / 建议 / 规模|
|---|---|---|---|
|vault|GET console/vault/secrets；Runtime Vault metadata（versions 是相邻 POST 写接口，不是页面 GET）|POST secrets、POST :code/rotate（credential_vault:edit，K）；POST :code/reveal（admin，reason，无K）；GET view|整页(c)，只读列表删 maskedPreview/backendRef 后可(a)；创建/轮换去掉部分回传后才可(b)。留揭示 Console；M/L。|
|service-clients|当前页面没有客户端列表/secret生成，仅本地 repair 结果|POST console/service-clients/repairs/aims-codocs-runtime-read（service_clients:admin，K），Runtime console:service-client:grant 修复 aims.runtime grants|无秘密返回，**信任控制面**留 Console；不能按旧页面假设有 clientSecret 表单。S（迁移收益低）。|
|integrations|GET console/integrations（integration_config:view）；GET console/vault/secrets（credential_vault:view）；Runtime integrations+Vault元数据|POST/PATCH integrations、POST :code/rotate/:code/check（integration_config:edit，K）；凭据创建/轮换另需 credential_vault:edit、K；DingTalk通知测试另由 Console handler 判权|整页(c，待净化)，凭据输入去掉maskedPreview响应后可拆(b)，净化列表可(a)；默认集成/身份配置影响登录、Vault resolve、通知，写留 Console。L。|
|data-runtime|GET console/data-runtime/status、update-status（data_runtime:view）；Console配置+Runtime HTTPhealth/version/capabilities/update|PUT console/settings/values/dataRuntime.{runtimeApiUrl,packageBaseUrl,audience}（dataRuntime前缀仅data_runtime:edit+本人uid门禁，handler K，页面现漏K）；POST console/data-runtime/update（data_runtime:deploy，无K）|token不回传，净化 status可(a)；更新/部署、服务凭据解析属于控制面留 Console。M。|
|connector-runtime|GET console/connector-runtime/install-command metadata（system_settings:view）；GET settings/values；GET diagnostics（system_settings:view）；Runtime connector metadata、服务token访问诊断|POST install-command、revoke（system_settings:admin，K）；POST identity-activation/notification-activation（admin；页面UUID但 handler没有统一requireKey门禁）；WeCom检测K；WeCom/DingTalk测试 integration_config:edit，body.requestKey必需并派生下游稳定Key（不是header K）；PUT runtimeApiUrl（edit，handler K，页面漏K）|安装码(c)；删 command/last4/原始diagnostics/error后的metadata可(a)。注册、撤销、身份/通知开关改变信任，留 Console。L。|
|notification-runtime|页面仅301 navigateTo('/connector-runtime')（:1-3）|无页面写动作；旧 notification-runtime/install-command POST已410|无独立迁移，沿用connector(c)。不要注册重复Host页。XS。|
|system-settings|GET console/settings/values（system_settings:view；允许服务view身份），Runtime setting_catalogs/values|PUT values/:settingKey（普通 system_settings:edit；dataRuntime前缀改用data_runtime:edit+本人身份；K）；expectedRevision CAS|当前整页(c，待净化)，**明确非密key白名单**列表可(a)，非密写另议；不承诺所有value安全。M/L。|
|activation|GET /api/activation/status：Console平台激活缓存与signed policy；no-store|POST /api/activation/retry：激活后system_settings:admin，未激活bootstrap分支；无K；GET未激活时也可能refreshPlatformBundle|仅status无envelope，但有raw lastError，GET不是纯只读。激活/策略控制面留 Console；净化diagnostic摘要另议。M。|
|admin/index|GET /api/activation/status no-store；安装/配置静态入口|页面无写请求，但status GET可触发刷新|不能直接作(a)只读页；共享安全摘要/导航可另做，不迁bootstrap。S。|
|admin/runtime-apps|GET console/runtime/apps（runtime_apps:view）；Console本机PM2聚合状态|POST apps/:appCode/action（runtime_apps:admin，无K）start/stop/restart；返回stdout/stderr|无秘密状态白名单可(a)，运维写留Console，当前输出/error未净化。M。不要把PM2环境/jlist原文发Host。|
|admin/logs|GET /api/user/applications、login-logs、operation-logs、heartbeat/online；audit_logs:view；lifecycle-metrics、authorization-lifecycle/operations/attempts另需authorization_lifecycle:view+audit_logs:view|POST console/authorization-lifecycle/retry（authorization_lifecycle:admin；服务端由operationId/phase派生稳定Key，不是请求头门禁；信任补偿写）|当前(c，待净化)。删detail/自由error/attempt payload后的时间、actor、状态、计数列表可(a)，详情继续Console；M/L。|
|admin/business-domains|GET companies、companies/:companyCode/business-domains（org_profile:view）；Runtime business profile/domain|POST/PATCH/DELETE company domains（system_settings:edit，K）；没有新增secret字段|只读投影(a)优先；域结构写不属秘密，但可能涉及业务权限组织关系，应另行批准。S/M。|
|admin/regions|GET companies、:company/regions、:region/divisions（org_profile:view）；Runtime companies/regions/division关联|POST/PATCH/DELETE region、PUT divisions（system_settings:edit，K）|只读(a)优先；地理/行政绑定写另批。S/M。|
|directory/sources|GET console/directory/sources（directory_sources:view）；Runtime integrations/Vault引用|PUT sources/:provider（directory_sources:edit，K）；POST sources/ldap/test（edit，K）；GET directory/operations/:id自有operation查询|当前(c，待净化)：config、lastError、backendRefMasked。LDAP/WeCom/DingTalk材料输入本身可(b)；去掉partial+原文后的source摘要(a)。影响connector/同步，写暂留Console；L。|
|directory/users 凭据段|GET provisioning/operations（详见证据索引；当前页面未调用UID预留接口）；Runtime directory+connector|POST users（directory_users:edit，K）；LDAP队列/初始密码或activation直接投递；UID预留等现有副作用不自动纳入迁移|LDAP自动密码(c)；手填密码无回传理论(b)，但需单独闭合投递、错误与队列链路；activation留Console。不要扩展已迁只读users页。L。|
|profile 头像/密码段|GET /api/directory/me 已迁只读；GET console/directory/me/password-capability、GET operations/:id（本人身份）|PUT me/avatar multipart（严格Console session；页面有Key，handler未requireKey，Runtime更新链另查）；POST me/password（本人uid，K）；current/newpassword RSA加密入connectoroperation|密码输入(b)，不回传明文；头像非秘密写、可另行批准，但不属(a)读页。当前头像session依赖不等同普通宿主转发兼容。M。|

## 3. 逐字段秘密流向

箭头 Browser→Console→Foundation→Runtime 表示当前调用链；尚未迁 Host。未来(b)经过Host一次请求内存也仍需SEC-03验证。

|页面 / 字段（逐项）|输入/显示和API方向|响应/持久化边界与剩余风险|
|---|---|---|
|vault `material.plaintext`|create/rotate password输入；POST secrets / :code/rotate Browser→Console→Runtime（vault.vue:324-341,357-364,599,637）|AES-GCM加密存Vault版本；receipt使用materialSupplied而非秘密（vault.go:167-180,215-239,263-320）；返回maskedPreview前后4。页面表单失败时可继续驻留heap。|
|vault `material.backendSecretRef`|env_ref变量名/file_ref路径，输入文本，同上|引用属于定位信息而非实际密码；仍可能误填秘密，maskedPreview部分返回。版本metadata返回边界需按白名单删partial，文件路径不迁Host。|
|vault `plaintext` reveal|POST :code/reveal Runtime→Console→Browser一次揭示，含reason/versionNo/approvalCode请求|plaintext ref、DOM、可复制；已no-store；reason/approvalCode不得任意含秘密；Trace/error捕获是否记录body未验证。|
|vault `secretRef/secretCode/currentVersionNo/revealPolicy`|GET元数据/版本及选择器|引用/编号/策略不是解密材料；maskedPreview、backendRef必须与其区分，不能全部统一称无秘密。|
|integrations GitLab `bot_token`|共用secretMaterial密码输入 → Vault material.plaintext|API绑定传secretCode/versionNo，不把value放config；Vault响应maskedPreview与列表useFetch同样需净化。|
|integrations AI `api_key`|同上|Runtime connectivity通过Authorization Bearer，固定失败文本；provider响应正文未回传页面。|
|integrations WeCom `corpsecret`|同上|Runtime gettoken请求URL携带corpsecret（integrations.go:821），页面不接access_token；HTTP客户端/代理URL日志是否脱敏未验证。|
|integrations DingTalk通知 `app_secret`|同上|凭据值内部resolve；页面仅引用绑定。|
|integrations DingTalk身份 `client_secret`|同上|身份开关影响信任；oauthClientId/appKey为标识，不当作client_secret，但不能让任意config逃逸。|
|integrations OSS `access_key_secret`|同上|OSS accessKeyId、bucket、endpoint为非密配置标识；Secret仅内部签名/鉴权。检查失败固定文本。|
|integrations `backendSecretRef`|env/file输入；Vault create/rotate|页面明确env_ref需变量名（integrations.vue:450-460）；实际resolve在Runtime；引用与部分preview同上。|
|directory/sources LDAP `credential.plaintext` bind_password|密码输入；PUT sources/ldap Browser→Runtime|directory_sources.go:369,418-493 在同事务加密Vault、绑定、metadata receipt；返回backendSecretRefMasked，不回传plaintext。config里的bindDN/searchBase为目录信息。|
|directory/sources WeCom `contact_secret`|同上，PUT sources/wecom|非密corpId/agentId不等于contact_secret。|
|directory/sources DingTalk `app_secret`|同上，PUT sources/dingtalk|非密appKey不等于app_secret。|
|directory/sources `backendSecretRef`|env/file引用文本，PUTcredential|返回masked引用；GET原始config/lastError并非严格白名单。LDAP test排队后的errorMessage来自operation，不能直接Host显示。|
|directory/users `initialPassword`（手填）|password输入，confirmPassword只在浏览器比对，不进入API；POST users→LDAPRuntime|request receipt去initialPassword；RSA public key加密，command仅initialPasswordCiphertext（console_connector_management.go:190,240-250）。手填密码不回传 (:299)。|
|directory/users `initialPassword`（生成）|Runtime生成→首响应→generatedPassword ref/DOM/clipboard|C-SEC-02；不是可重取的receipt，响应丢失不能按同Key再获得明文。禁止Host直接接这个分支。|
|directory/users `activationToken/activationCredentialId`|Runtime→Console私下投递给本人；页面正常响应只activationDelivered/expiry|Runtime receipt不存token；投递URL携带token，inAppURL不含。条件剥离缺口见C-SEC-07。邮件/投递Trace/登录跳转access日志未验证。|
|profile `currentPassword/newPassword`|password输入；POST me/password Browser→Runtime；confirmPassword不发送（profile.vue:192-197）|RSA加密成currentPasswordCiphertext/newPasswordCiphertext入队；mutation仅uid、operationId（console_connector_management.go:334,361-378）；响应operation不含密码，成功清表单(:202-204)。错误/connector执行端需固定类别、不得回传command。|
|profile `avatar`|multipart文件→Console→Runtime OSS；返回avatarPath/contentmetadata|文件非凭据；OSSsecret内部resolve，不经浏览器。上传异常console.error原文见C-SEC-06，且strict session须先确认Host适配。|
|connector `enrollmentCode/installCommand`|POST Runtime签发→Console拼命令→Browser ref/代码框/clipboard|C-SEC-03；GET没有安装码；receipt/数据库hash-only不保存原始code。redeem返回长期服务凭据的服务器安装链不属于Host页面，应继续服务端。|
|connector `enrollmentCodeLast4`|metadata/issue response部分回传|partial identifier仍删出Host无密投影；releaseSigningPublicKey/PEM为验签公钥，不是private signing key（connectorRuntimeEnrollment.ts:52,90）。|
|data-runtime token / connector diagnostics token|服务端 env/trustedgateway/requestServiceAccessToken→Runtime Authorization；非页面输入|dataRuntimeManagement.ts:295-307,377-399；页面只有tokenConfigured boolean (:467)。不透传 Authorization；error/url/Trace未全链核验。|
|activation license token / policy signed envelope / platform service token|Console私有配置、校验license、Platform bundle获取→Console验证缓存（platformRuntime.ts:556-565,644-694,797-843,1020-1050）|status只version/hash/validity等；未发现page响应包含licenseToken、signature、完整envelope或privatekey。服务端缓存属Console控制面设计；Host不得复制。signed envelope是完整性/授权材料，不等同私钥。lastError原文见C-SEC-06。|
|system-settings `value/defaultValue`；logs `detail/error/attempt`|useFetch/GET或$fetch→Browser；编辑settings PUTvalue|内容自由、不能逐个枚举实际secret值；无DB查询故未验证。需要基于目录key/输出字段白名单，不用键名regex当数据分类证明。|

### SEC-03 对日志、SSR、缓存的共同结论

- 本次目标页面源码没有发现显式把秘密写 localStorage/sessionStorage/indexedDB 的语句；这不是全站插件、浏览器扩展、Crash/Trace采集器或HTTP日志已安全的证明，这些均**未验证**。
- GET的 `useFetch` 数据可进入Nuxt SSR payload与共享AsyncData状态：Vault、integrations、settings、source、runtime status/metadata。敏感partial/config/error在投影净化前不能进入Host。这和事件触发 `$fetch` POST自动进入初始SSR不是一回事。
- 密码input type只防旁观显示，不防API/日志/heap驻留。当前错误后保留表单是可用性设计；Host(b)必须禁止持久化草稿，成功/离开清理，异常用固定类别；不要复制未过滤Error.message。
- Console既有加密Vault、hash-only enrollment、RSA connector任务、秘密剔除receipt是正向证据；它们不证明gateway/Host日志或request body Trace安全。本次没有检查运行中的collector、缓存、平台审计库。

## 4. 控制面与数据源边界

1. **Platform activation / license / policy**：activation、admin首页GET可触发bundle刷新；Platform trust envelope验证/缓存、service-keys属于Console。只读摘要需独立无副作用API，不能登记当前GET就宣称纯读。
2. **信任修复/补偿**：service-clients repair改变runtime grant；logs lifecycle retry驱动employment/offboarding Platform补偿。尽管结果无密码，也保持Console。
3. **部署与注册**：data-runtime更新、PM2 actions、connector enrollment/revoke/identity notification enable属于部署控制面。只读health/计数净化可讨论，安装/撤销不迁。
4. **租户业务配置**：domains/regions、明确非密setting、integration/source摘要可走现有Runtime操作。源凭据及绑定操作涉及外部身份、同步和通知，权限/审批须单独决定。
5. **自助密码**：Runtime已提供本人LDAP密码队列，无需新Runtime操作；当前avatar handler显式session，不能仅靠原目录身份转发完成。无CAS不自动沿用B2决定到batch C；settings现有expectedRevision应保留。

## 5. 推荐实施顺序与规模（未获实施授权）

|顺序|范围|规模|前置 / 保留Console链接|
|---|---|---|---|
|C1|business-domains/regions 两页纯读|各S/M，约共享组件+BFF精确GET+manifest导航+契约|权限org_profile:view复用；创建/编辑/删除/division替换回Console；无秘密输入。|
|C2|data-runtime / runtime-apps安全状态摘要|各M|固定字段、固定错误；更新/PM2写回Console；不登记config/action/update。|
|C3|source/integration安全摘要|各M/L|先定config允许key、删除preview/backendref/lastError、控制链接；secret写/Vault/身份默认配置留Console。|
|C4|settings明确非密key列表|M/L|先审catalog允许key、default/value类型、URL无userInfo/query凭据；不做任意key通配路由。|
|C5|logs净化列表|L|只投影事件元数据/计数；原始detail/attempt/补偿留Console，需审全部写入者。|
|另案|profile自助密码(b)、头像写|各M，前者含执行端审计，后者session/OSS验证|先完成no-store/log/Trace门禁；不得复用只读profile授权默认为写批准。|
|保持Console|vault reveal、自动初始密码、activation、connector安装/撤销、grant repair、运维/信任写|不估迁移工期|Host提供权限一致的跳转；不要让secret通过Host重定向query。|

规模S约一页简单只读；M含共享组件/BFF/权限/契约/状态；L含多系统秘密链路审查。不是交付日期承诺。navigation按ADR-019从Console manifest resource/action贡献，个人密码仍个人菜单/Console链接，不在Host手写权限表。

## 6. Claude 需决定的事项

1. 是否单列C-SEC-01~08整改任务；授权揭示/一次性生成可保留Console，但 no-store、状态清理、固定异常、activation token白名单防线是否要求先修。
2. 是否批准C1两页只读，是否仅company当前范围、导航分组沿Console manifest；写功能全部Console。
3. 是否批准Runtime状态摘要，哪些version/path/packageURL/port/processName允许披露，是否删除内部ecosystem/diagnostic任意字段。
4. Vault的partial值是否从任何Host投影彻底剔除；Vault创建/轮换如迁移是否新增严格无echo响应，reveal永远Console。
5. integration/source config允许字段、历史脏数据如何处理、provider/LDAP错误类别表；是否先净化读取再考虑(b)凭据输入。
6. settings非密catalog允许key清单；system_settings:view与data_runtime:view联动；expectedRevision保留、URL规范化是否作为前置。
7. logs哪些结构字段允许Host，保留原文Console是否仍可接受；字符串自由文本脱敏和旧日志数据审查由谁负责。
8. profile密码(b)是否允许，activation和自动初始密码(c)是否永远Console；avatar strict-session如何适配，以及异常日志整改。
9. 现有页面漏Key（data-runtime/connector runtime URL设置）是否独立修复；activation/update/PM2无K属于运维契约，不擅自补到Runtime。
10. collector/HTTPcache/request日志/Crash采集实际验证的负责人与验收环境；本文只能给源码证据，不能替代运行验收。

## 7. 本次完成边界

只读取仓库源码与既有文档，写此报告。未修改业务代码、未运行测试、未重启、未查询DB、未调用业务API、未提交报告。committees B2 已先完成独立提交 `9f1edca0` 并推送送审，批次C实施待Claude批准。

以下索引保留当前源码精确行号，方便逐项复核。行号可能随后续协作提交变化；不包含真实秘密值。

## 8. 页面调用与秘密字段证据索引

### `console/app/pages/vault.vue`

```text
28: maskedPreview: string | null
52: plaintext: string
91: const revealResult = ref<RevealResult | null>(null)
100: const canEditVault = computed(() => permissionsLoaded.value && hasPermission('credential_vault', 'edit'))
101: const canAdminVault = computed(() => permissionsLoaded.value && hasPermission('credential_vault', 'admin'))
125: '/api/v1/console/vault/secrets',
184: revealResult.value = null
292: return { plaintext: material }
294: return { backendSecretRef: material }
324: await $fetch<ApiResponse<VaultSecret>>('/api/v1/console/vault/secrets', {
325: method: 'POST',
326: headers: { 'Idempotency-Key': crypto.randomUUID() },
358: `/api/v1/console/vault/secrets/${encodeURIComponent(secret.secretCode)}/rotate`,
360: method: 'POST',
361: headers: { 'Idempotency-Key': crypto.randomUUID() },
388: `/api/v1/console/vault/secrets/${encodeURIComponent(secret.secretCode)}/reveal`,
390: method: 'POST',
397: revealResult.value = response.data
523: {{ row.original.maskedPreview || '-' }}
680: <UFormField v-if="revealResult" label="Plaintext">
683: :model-value="revealResult.plaintext"
692: @click="copyText(revealResult.plaintext)"
```

### `console/app/pages/service-clients.vue`

```text
27: () => permissionsLoaded.value && hasPermission('service_clients', 'admin')
36: '/api/v1/console/service-clients/repairs/aims-codocs-runtime-read',
38: method: 'POST',
39: headers: { 'Idempotency-Key': crypto.randomUUID() },
```

### `console/app/pages/integrations.vue`

```text
51: maskedPreview: string | null
96: secretMaterial: string
255: const canEditIntegrations = computed(() => permissionsLoaded.value && hasPermission('integration_config', 'edit'))
256: const canEditVault = computed(() => permissionsLoaded.value && hasPermission('credential_vault', 'edit'))
266: secretMaterial: '',
282: '/api/v1/console/integrations',
289: '/api/v1/console/vault/secrets',
450: const secretMaterialWarning = computed(() => {
451: const material = activeForm.value.secretMaterial.trim()
458: function secretMaterialBody(value: string) {
463: return { plaintext: value }
465: return { backendSecretRef: value }
473: const material = activeForm.value.secretMaterial.trim()
486: const response = await $fetch<ApiResponse<{ currentVersionNo: number }>>('/api/v1/console/vault/secrets', {
487: method: 'POST',
488: headers: { 'Idempotency-Key': crypto.randomUUID() },
498: material: secretMaterialBody(material)
505: `/api/v1/console/vault/secrets/${encodeURIComponent(activeForm.value.secretCode)}/rotate`,
507: method: 'POST',
508: headers: { 'Idempotency-Key': crypto.randomUUID() },
511: material: secretMaterialBody(material)
547: `/api/v1/console/integrations/${encodeURIComponent(form.integrationCode)}`,
549: method: 'PATCH',
550: headers: { 'Idempotency-Key': crypto.randomUUID() },
557: && (Boolean(form.secretMaterial.trim())
564: await $fetch<ApiResponse<IntegrationItem>>('/api/v1/console/integrations', {
565: method: 'POST',
566: headers: { 'Idempotency-Key': crypto.randomUUID() },
579: form.secretMaterial = ''
611: `/api/v1/console/integrations/${encodeURIComponent(defaultIntegration.integrationCode)}`,
613: method: 'PATCH',
614: headers: { 'Idempotency-Key': crypto.randomUUID() },
622: `/api/v1/console/integrations/${encodeURIComponent(identityIntegration.integrationCode)}`,
624: method: 'PATCH',
625: headers: { 'Idempotency-Key': crypto.randomUUID() },
661: `/api/v1/console/integrations/${encodeURIComponent(activeForm.value.integrationCode)}/rotate`,
663: method: 'POST',
664: headers: { 'Idempotency-Key': crypto.randomUUID() },
695: `/api/v1/console/integrations/${encodeURIComponent(activeForm.value.integrationCode)}/check`,
697: method: 'POST',
698: headers: { 'Idempotency-Key': crypto.randomUUID() }
727: const response = await $fetch<ApiResponse<DingTalkTestResult>>('/api/v1/console/connector-runtime/dingtalk-test', {
728: method: 'POST',
988: v-model="activeForm.secretMaterial"
994: v-if="secretMaterialWarning"
997: {{ secretMaterialWarning }}
```

### `console/app/pages/data-runtime.vue`

```text
110: const canViewDataRuntime = computed(() => permissionsLoaded.value && hasPermission('data_runtime', 'view'))
111: const canEditDataRuntime = computed(() => permissionsLoaded.value && hasPermission('data_runtime', 'edit'))
112: const canDeployDataRuntime = computed(() => permissionsLoaded.value && hasPermission('data_runtime', 'deploy'))
115: '/api/v1/console/data-runtime/status',
266: const response = await $fetch<UpdateStatusResponse>('/api/v1/console/data-runtime/update-status')
300: $fetch('/api/v1/console/settings/values/dataRuntime.runtimeApiUrl', {
301: method: 'PUT',
304: $fetch('/api/v1/console/settings/values/dataRuntime.packageBaseUrl', {
305: method: 'PUT',
308: $fetch('/api/v1/console/settings/values/dataRuntime.audience', {
309: method: 'PUT',
330: const response = await $fetch<UpdateTriggerResponse>('/api/v1/console/data-runtime/update', { method: 'POST' })
```

### `console/app/pages/connector-runtime.vue`

```text
23: installCommand: string
103: installCommand: '',
108: '/api/v1/console/connector-runtime/install-command',
112: '/api/v1/console/settings/values',
121: const result = await $fetch<ApiResponse<ConnectorMetadata>>('/api/v1/console/connector-runtime/install-command')
123: current?.installCommand
133: installCommand: current!.installCommand,
145: const canEdit = computed(() => permissionsLoaded.value && hasPermission('system_settings', 'edit'))
146: const canAdmin = computed(() => permissionsLoaded.value && hasPermission('system_settings', 'admin'))
147: const canTestNotifications = computed(() => permissionsLoaded.value && hasPermission('integration_config', 'edit'))
186: await $fetch('/api/v1/console/connector-runtime/identity-activation', {
187: method: 'POST',
188: headers: { 'Idempotency-Key': crypto.randomUUID() },
232: const response = await $fetch<ApiResponse<WecomConfigCheck>>('/api/v1/console/notification-runtime/wecom-check', {
233: method: 'POST',
234: headers: { 'Idempotency-Key': crypto.randomUUID() },
259: const response = await $fetch<ApiResponse<WecomTestResult>>('/api/v1/console/notification-runtime/wecom-test', {
260: method: 'POST',
288: '/api/v1/console/connector-runtime/install-command',
290: method: 'POST',
291: headers: { 'Idempotency-Key': crypto.randomUUID() }
303: if (!metadata.value.installCommand) return
304: await navigator.clipboard.writeText(metadata.value.installCommand)
311: const result = await $fetch<ApiResponse<Record<string, unknown>>>('/api/v1/console/connector-runtime/diagnostics')
332: await $fetch('/api/v1/console/connector-runtime/revoke', {
333: method: 'POST',
334: headers: { 'Idempotency-Key': crypto.randomUUID() }
349: await $fetch('/api/v1/console/settings/values/connector.runtimeApiUrl', {
350: method: 'PUT',
677: :disabled="!metadata.installCommand"
684: <pre class="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-5 text-highlighted">{{ metadata.installCommand || '点击“生成指令”后显示一次性 curl 安装命令。' }}</pre>
```

### `console/app/pages/notification-runtime.vue`

```text

```

### `console/app/pages/system-settings.vue`

```text
35: '/api/v1/console/settings/values',
109: await $fetch(`/api/v1/console/settings/values/${encodeURIComponent(item.settingKey)}`, {
110: method: 'PUT',
112: 'idempotency-key': `console:setting:${item.settingKey}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
```

### `console/app/pages/activation.vue`

```text
44: const response = await $fetch<ApiEnvelope<ActivationStatus>>('/api/activation/status', {
57: const response = await $fetch<ApiEnvelope<ActivationStatus>>('/api/activation/retry', {
58: method: 'POST',
```

### `console/app/pages/admin/index.vue`

```text
52: const response = await $fetch<ApiEnvelope<ActivationStatus>>('/api/activation/status', {
```

### `console/app/pages/admin/runtime-apps.vue`

```text
50: const canAdminRuntimeApps = computed(() => permissionsLoaded.value && hasPermission('runtime_apps', 'admin'))
53: '/api/v1/console/runtime/apps',
140: await $fetch(`/api/v1/console/runtime/apps/${encodeURIComponent(app.appCode)}/action`, {
141: method: 'POST',
```

### `console/app/pages/admin/logs.vue`

```text
318: permissionsLoaded.value && hasPermission('authorization_lifecycle', 'admin')
433: const res = await $fetch<{ data?: { items?: Array<{ appCode: string, appName: string }> } }>('/api/user/applications')
447: const res = await $fetch<ApiResponse<PagedResponse<LoginLog>>>('/api/v1/login-logs', {
479: const res = await $fetch<ApiResponse<PagedResponse<OperationLog>>>('/api/v1/operation-logs', {
514: const res = await $fetch<ApiResponse<LifecycleMetrics>>('/api/v1/operation-logs/lifecycle-metrics', {
536: const res = await $fetch<ApiResponse<{ items: LifecycleOperation[] }>>('/api/v1/console/authorization-lifecycle/operations', {
558: `/api/v1/console/authorization-lifecycle/operations/${encodeURIComponent(operation.operationId)}/attempts`
571: const res = await $fetch<{ data?: { items?: OnlineUser[] } }>('/api/v1/heartbeat/online')
660: await $fetch('/api/v1/console/authorization-lifecycle/retry', {
661: method: 'POST',
662: headers: { 'Idempotency-Key': crypto.randomUUID() },
```

### `console/app/pages/admin/business-domains.vue`

```text
100: function idempotencyKey(operation: string) {
157: const res = await $fetch<ApiResponse<Company[]>>('/api/v1/companies')
168: const res = await $fetch<ApiResponse<CompanyDomain[]>>(`/api/v1/companies/${code}/business-domains`)
207: await $fetch(`/api/v1/companies/${code}/business-domains`, {
208: method: 'POST',
209: headers: { 'idempotency-key': idempotencyKey('preset-add') },
228: await $fetch(`/api/v1/companies/${code}/business-domains/${encodeURIComponent(domainCode)}`, {
229: method: 'DELETE',
230: headers: { 'idempotency-key': idempotencyKey(`preset-remove:${domainCode}`) },
254: await $fetch(`/api/v1/companies/${code}/business-domains`, {
255: method: 'POST',
256: headers: { 'idempotency-key': idempotencyKey('custom-create') },
279: await $fetch(`/api/v1/companies/${code}/business-domains/${encodeURIComponent(editingDomain.value.domainCode)}`, {
280: method: 'PATCH',
281: headers: { 'idempotency-key': idempotencyKey(`update:${editingDomain.value.domainCode}`) },
306: await $fetch(`/api/v1/companies/${code}/business-domains/${encodeURIComponent(domain.domainCode)}`, {
307: method: 'DELETE',
308: headers: { 'idempotency-key': idempotencyKey(`delete:${domain.domainCode}`) },
```

### `console/app/pages/admin/regions.vue`

```text
53: function idempotencyKey(operation: string) {
101: const res = await $fetch<ApiResponse<Company[]>>('/api/v1/companies')
112: const res = await $fetch<ApiResponse<Region[]>>(`/api/v1/companies/${code}/regions`)
130: await $fetch(`/api/v1/companies/${code}/regions`, {
131: method: 'POST',
132: headers: { 'idempotency-key': idempotencyKey('template') },
158: await $fetch(`/api/v1/companies/${code}/regions`, {
159: method: 'POST',
160: headers: { 'idempotency-key': idempotencyKey('create') },
188: await $fetch(`/api/v1/companies/${code}/regions/${encodeURIComponent(editingRegion.value.regionCode)}`, {
189: method: 'PATCH',
190: headers: { 'idempotency-key': idempotencyKey(`update:${editingRegion.value.regionCode}`) },
214: await $fetch(`/api/v1/companies/${code}/regions/${encodeURIComponent(region.regionCode)}`, {
215: method: 'DELETE',
216: headers: { 'idempotency-key': idempotencyKey(`delete:${region.regionCode}`) },
235: const res = await $fetch<ApiResponse<DivisionMapping[]> & { meta: { revision: number } }>(`/api/v1/companies/${code}/regions/${encodeURIComponent(region.regionCode)}/divisions`)
322: await $fetch(`/api/v1/companies/${code}/regions/${encodeURIComponent(divisionRegion.value.regionCode)}/divisions`, {
323: method: 'PUT',
324: headers: { 'idempotency-key': idempotencyKey(`divisions:${divisionRegion.value.regionCode}`) },
```

### `console/app/pages/directory/sources.vue`

```text
23: backendSecretRefMasked: string | null
55: const canEditSources = computed(() => permissionsLoaded.value && hasPermission('directory_sources', 'edit'))
57: const { data, refresh } = await useFetch<ApiResponse<DirectorySource[]>>('/api/v1/console/directory/sources', {
69: backendSecretRef: string
78: backendSecretRef: '',
104: backendSecretRef: 'WECOM_CONTACT_SECRET',
117: backendSecretRef: 'DINGTALK_APP_SECRET',
150: forms[provider].backendSecretRef = ''
181: await $fetch<ApiResponse<DirectorySource>>(`/api/v1/console/directory/sources/${provider}`, {
182: method: 'PUT',
183: headers: { 'Idempotency-Key': crypto.randomUUID() },
189: credential: form.backendSecretRef
195: ? { plaintext: form.backendSecretRef }
196: : { backendSecretRef: form.backendSecretRef })
235: }>>(`/api/v1/console/directory/operations/${operationId}`)
254: const queued = await $fetch<ApiResponse<{ operationId: string }>>('/api/v1/console/directory/sources/ldap/test', {
255: method: 'POST',
256: headers: { 'Idempotency-Key': crypto.randomUUID() }
384: v-model="forms[activeProvider].backendSecretRef"
```

### `console/app/pages/directory/users.vue`

```text
47: initialPassword?: string
48: initialPasswordGenerated?: boolean
79: initialPassword: '',
91: const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectoryUsersResponse>>('/api/v1/console/directory/users', {
107: '/api/v1/console/directory/departments',
114: '/api/v1/console/directory/provisioning',
197: form.initialPassword = ''
241: initialPassword: modalMode.value === 'create' && form.provisioningTarget === 'ldap' && form.initialPassword
242: ? form.initialPassword
248: const generatedPassword = ref<{ uid: string, password: string } | null>(null)
251: const password = generatedPassword.value?.password
264: `/api/v1/console/directory/operations/${encodeURIComponent(operationId)}`
283: if (form.initialPassword) {
284: if (form.initialPassword.length < 10) {
288: if (form.initialPassword !== form.confirmPassword) {
299: const response = await $fetch<ApiResponse<DirectoryOperation | DirectoryUser>>('/api/v1/console/directory/users', {
300: method: 'POST',
302: 'idempotency-key': `directory:user:create:${globalThis.crypto?.randomUUID?.() || Date.now()}`
307: const generated = 'initialPassword' in response.data ? String(response.data.initialPassword || '') : ''
312: generatedPassword.value = { uid: form.uid.trim(), password: generated }
323: await $fetch(`/api/v1/console/directory/users/${encodeURIComponent(form.uid)}`, {
324: method: 'PATCH',
326: 'idempotency-key': `directory:user:update:${form.uid}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
588: v-model="form.initialPassword"
597: v-if="modalMode === 'create' && form.provisioningTarget === 'ldap' && form.initialPassword"
632: :open="Boolean(generatedPassword)"
635: @update:open="value => { if (!value) generatedPassword = null }"
651: {{ generatedPassword?.uid }}
659: <code class="flex-1 select-all break-all rounded bg-elevated px-3 py-2 font-mono text-sm">{{ generatedPassword?.password }}</code>
674: @click="generatedPassword = null"
```

### `console/app/pages/profile.vue`

```text
15: currentPassword: '',
16: newPassword: '',
37: '/api/directory/me',
122: '/api/v1/console/directory/me/avatar',
124: method: 'PUT',
126: headers: { 'Idempotency-Key': crypto.randomUUID() }
158: '/api/v1/console/directory/me/password-capability',
168: `/api/v1/console/directory/operations/${encodeURIComponent(operationId)}`
178: if (!passwordForm.currentPassword) {
182: if (passwordForm.newPassword.length < 10) {
186: if (passwordForm.newPassword !== passwordForm.confirmPassword) {
192: const response = await $fetch<ApiResponse<DirectoryOperation>>('/api/v1/console/directory/me/password', {
193: method: 'POST',
194: headers: { 'Idempotency-Key': crypto.randomUUID() },
196: currentPassword: passwordForm.currentPassword,
197: newPassword: passwordForm.newPassword
202: passwordForm.currentPassword = ''
203: passwordForm.newPassword = ''
334: v-model="passwordForm.currentPassword"
342: v-model="passwordForm.newPassword"
```

## 9. Handler 权限、幂等与下游操作证据索引

路径后缀对应METHOD；下列 handler 全部为已存在源码。`getConsole* / callConsoleTenantRuntime` 下游为 Foundation tenant Runtime client；runtimeApps为本机PM2，activation为Platform控制面。索引也列出相邻已存在接口，**不表示页面调用了全部接口，不表示批准注册**。

### `console/server/api/activation/bundle-refresh.post.ts`

```text
10: refreshPlatformBundle
19: setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
44: await requirePermission(event, 'system_settings', 'admin', '需要系统运行时管理权限')
65: const result = await refreshPlatformBundle('admin-open-refresh', event)
120: const result = await refreshPlatformBundle('admin-open-refresh', event)
```

### `console/server/api/activation/diagnostics.get.ts`

```text
144: const health = await getConsoleAuthRuntimeHealth(event)
267: setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
```

### `console/server/api/activation/retry.post.ts`

```text
2: import { loadActivationStatus, refreshPlatformBundle } from '~~/server/utils/platformRuntime'
5: setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
11: await requirePermission(event, 'system_settings', 'admin', '需要系统运行时管理权限')
14: const result = await refreshPlatformBundle('manual-retry', event)
```

### `console/server/api/activation/status.get.ts`

```text
1: import { loadActivationStatus, refreshPlatformBundle } from '~~/server/utils/platformRuntime'
4: setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
16: const result = await refreshPlatformBundle('status-auto-refresh', event).catch(() => null)
```

### `console/server/api/v1/companies/[companyCode]/business-domains/[domainCode].delete.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'edit')
8: requireIdempotencyKey(event)
17: return await deleteConsoleBusinessDomain(event, domainCode, await readBody(event))
```

### `console/server/api/v1/companies/[companyCode]/business-domains/[domainCode].patch.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'edit')
8: requireIdempotencyKey(event)
17: return await updateConsoleBusinessDomain(event, domainCode, await readBody(event))
```

### `console/server/api/v1/companies/[companyCode]/business-domains/index.get.ts`

```text
6: await requirePermission(event, 'org_profile', 'view')
11: return await getConsoleBusinessDomains(event, {
```

### `console/server/api/v1/companies/[companyCode]/business-domains/index.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'edit')
8: requireIdempotencyKey(event)
14: return await createConsoleBusinessDomains(event, await readBody(event))
```

### `console/server/api/v1/companies/[companyCode]/index.get.ts`

```text
5: await requirePermission(event, 'org_profile', 'view')
```

### `console/server/api/v1/companies/[companyCode]/index.patch.ts`

```text
5: await requireSystemSettingsAccess(event, 'edit')
```

### `console/server/api/v1/companies/[companyCode]/regions/[regionCode]/divisions.get.ts`

```text
6: await requirePermission(event, 'org_profile', 'view')
12: return await getConsoleRegionDivisions(event, regionCode)
```

### `console/server/api/v1/companies/[companyCode]/regions/[regionCode]/divisions.put.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'edit')
8: requireIdempotencyKey(event)
15: return await replaceConsoleRegionDivisions(event, regionCode, await readBody(event))
```

### `console/server/api/v1/companies/[companyCode]/regions/[regionCode]/index.delete.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'edit')
8: requireIdempotencyKey(event)
15: return await deleteConsoleRegion(event, regionCode, await readBody(event))
```

### `console/server/api/v1/companies/[companyCode]/regions/[regionCode]/index.patch.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'edit')
8: requireIdempotencyKey(event)
15: return await updateConsoleRegion(event, regionCode, await readBody(event))
```

### `console/server/api/v1/companies/[companyCode]/regions/index.get.ts`

```text
6: await requirePermission(event, 'org_profile', 'view')
11: return await getConsoleRegions(event, { companyCode })
```

### `console/server/api/v1/companies/[companyCode]/regions/index.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'edit')
8: requireIdempotencyKey(event)
15: return await createConsoleRegion(
```

### `console/server/api/v1/companies/index.get.ts`

```text
5: await requirePermission(event, 'org_profile', 'view')
```

### `console/server/api/v1/companies/index.post.ts`

```text
5: await requireSystemSettingsAccess(event, 'edit')
```

### `console/server/api/v1/console/authorization-lifecycle/operations/[operationId]/attempts.get.ts`

```text
9: await requirePermission(event, 'authorization_lifecycle', 'view', '需要授权生命周期查看权限')
10: await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')
```

### `console/server/api/v1/console/authorization-lifecycle/operations/index.get.ts`

```text
8: await requirePermission(event, 'authorization_lifecycle', 'view', '需要授权生命周期查看权限')
9: await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')
```

### `console/server/api/v1/console/authorization-lifecycle/retry.post.ts`

```text
22: idempotencyKey: string
34: sessionId: input.idempotencyKey,
41: }, `${input.idempotencyKey}:audit:${input.result}`)
45: await requirePermission(event, 'authorization_lifecycle', 'admin', '需要授权生命周期管理权限')
58: const actorUid = await requireConsoleRequestUid(event)
61: const idempotencyKey = `console:platform-lifecycle:${retrySource.operationId}:manual-${phase}-retry:v1`
72: idempotencyKey,
87: idempotencyKey,
```

### `console/server/api/v1/console/connector-runtime/diagnostics.get.ts`

```text
7: await requireSystemSettingsAccess(event, 'view')
8: setHeader(event, 'Cache-Control', 'no-store')
9: return ok(await readConnectorRuntimeDiagnostics(event))
```

### `console/server/api/v1/console/connector-runtime/dingtalk-test.post.ts`

```text
23: await requireIntegrationAccess(event, 'edit')
```

### `console/server/api/v1/console/connector-runtime/enroll.post.ts`

```text
6: setHeader(event, 'Cache-Control', 'no-store')
7: return await redeemConnectorRuntimeEnrollment(event, body)
```

### `console/server/api/v1/console/connector-runtime/identity-activation.post.ts`

```text
7: const actor = await requireSystemSettingsAccess(event, 'admin')
8: if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
9: throw createError({ statusCode: 400, message: '切换身份能力必须提供 Idempotency-Key。' })
```

### `console/server/api/v1/console/connector-runtime/install-command.get.ts`

```text
6: await requireSystemSettingsAccess(event, 'view')
```

### `console/server/api/v1/console/connector-runtime/install-command.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'admin')
8: requireIdempotencyKey(event, '生成 Connector Runtime 安装指令必须提供 Idempotency-Key。')
9: return ok(await issueConnectorRuntimeEnrollment(event))
```

### `console/server/api/v1/console/connector-runtime/notification-activation.post.ts`

```text
7: const actor = await requireSystemSettingsAccess(event, 'admin')
8: if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
9: throw createError({ statusCode: 400, message: '切换通知能力必须提供 Idempotency-Key。' })
```

### `console/server/api/v1/console/connector-runtime/revoke.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireSystemSettingsAccess(event, 'admin')
8: requireIdempotencyKey(event, '吊销 Connector Runtime 必须提供 Idempotency-Key。')
```

### `console/server/api/v1/console/data-runtime/status.get.ts`

```text
6: await requirePermission(event, 'data_runtime', 'view')
```

### `console/server/api/v1/console/data-runtime/update-status.get.ts`

```text
6: await requirePermission(event, 'data_runtime', 'view')
```

### `console/server/api/v1/console/data-runtime/update.post.ts`

```text
6: await requirePermission(event, 'data_runtime', 'deploy')
7: return ok(await triggerDataRuntimeUpdate(event))
```

### `console/server/api/v1/console/directory/me/avatar.put.ts`

```text
66: const runtime = await updateConsoleDirectoryOwnAvatar(event, {
```

### `console/server/api/v1/console/directory/me/password-capability.get.ts`

```text
5: await requireConsoleRequestUid(event)
6: return await getConsoleDirectoryPasswordCapability(event)
```

### `console/server/api/v1/console/directory/me/password.post.ts`

```text
4: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requireConsoleRequestUid(event)
8: requireIdempotencyKey(event)
10: const operation = await queueConsoleDirectoryPasswordChange(event, body)
```

### `console/server/api/v1/console/directory/meta.get.ts`

```text
5: await requirePermission(event, 'console_overview', 'view')
6: return await getConsoleDirectoryMeta(event)
```

### `console/server/api/v1/console/directory/operations/[operationId].get.ts`

```text
5: await requireConsoleRequestUid(event)
8: return await getConsoleDirectoryConnectorOperation(event, operationId)
```

### `console/server/api/v1/console/directory/sources/[providerCode].get.ts`

```text
5: await requirePermission(event, 'directory_sources', 'view')
9: return await getConsoleDirectorySource(event, providerCode)
```

### `console/server/api/v1/console/directory/sources/[providerCode].put.ts`

```text
4: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requirePermission(event, 'directory_sources', 'edit', '需要目录源配置编辑权限')
8: requireIdempotencyKey(event, '保存目录源必须提供 Idempotency-Key。')
14: return await upsertConsoleDirectorySource(event, providerCode, body)
```

### `console/server/api/v1/console/directory/sources/index.get.ts`

```text
5: await requirePermission(event, 'directory_sources', 'view')
6: return await getConsoleDirectorySources(event)
```

### `console/server/api/v1/console/directory/sources/index.post.ts`

```text
4: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requirePermission(event, 'directory_sources', 'edit', '需要目录源配置编辑权限')
8: requireIdempotencyKey(event, '保存目录源必须提供 Idempotency-Key。')
14: return await upsertConsoleDirectorySource(event, null, body)
```

### `console/server/api/v1/console/directory/sources/ldap/test.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requirePermission(event, 'directory_sources', 'edit', '需要目录源配置编辑权限')
8: await requireConsoleRequestUid(event)
9: requireIdempotencyKey(event)
10: const operation = await queueConsoleDirectoryLDAPTest(event)
```

### `console/server/api/v1/console/directory/users/index.post.ts`

```text
10: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
41: idempotencyKey: `directory:activation:${uid}:${credentialId}`
59: await requirePermission(event, 'directory_users', 'edit', '需要目录用户编辑权限')
60: requireIdempotencyKey(event)
62: await requireConsoleRequestUid(event)
66: const operation = await queueConsoleDirectoryLDAPUserCreate(event, ldapBody as Record<string, unknown>)
89: await createConsoleDirectoryUser(event, directoryBody as Record<string, unknown>)
```

### `console/server/api/v1/console/integrations/[integrationCode]/check.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
8: const actor = await requireIntegrationAccess(event, 'edit')
9: requireIdempotencyKey(event, '检测集成配置必须提供 Idempotency-Key。')
```

### `console/server/api/v1/console/integrations/[integrationCode]/rotate.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
8: await requireIntegrationAccess(event, 'edit')
9: requireIdempotencyKey(event, '轮换集成凭证必须提供 Idempotency-Key。')
```

### `console/server/api/v1/console/integrations/[integrationCode].get.ts`

```text
7: const actor = await requireIntegrationAccess(event, 'view')
```

### `console/server/api/v1/console/integrations/[integrationCode].patch.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
8: await requireIntegrationAccess(event, 'edit')
9: requireIdempotencyKey(event, '更新集成必须提供 Idempotency-Key。')
```

### `console/server/api/v1/console/integrations/index.get.ts`

```text
7: const actor = await requireIntegrationAccess(event, 'view')
```

### `console/server/api/v1/console/integrations/index.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
8: await requireIntegrationAccess(event, 'edit')
9: requireIdempotencyKey(event, '创建集成必须提供 Idempotency-Key。')
```

### `console/server/api/v1/console/notification-runtime/install-command.get.ts`

```text
5: await requireSystemSettingsAccess(event, 'view')
```

### `console/server/api/v1/console/notification-runtime/install-command.post.ts`

```text
5: await requireSystemSettingsAccess(event, 'admin')
```

### `console/server/api/v1/console/notification-runtime/wecom-check.post.ts`

```text
5: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
8: const actor = await requireIntegrationAccess(event, 'edit')
9: requireIdempotencyKey(event, '检测企业微信配置必须提供 Idempotency-Key。')
```

### `console/server/api/v1/console/notification-runtime/wecom-test.post.ts`

```text
36: export function wecomTestResultIdempotencyKey(input: {
94: idempotencyKey: wecomTestResultIdempotencyKey({
147: const actor = await requireIntegrationAccess(event, 'edit')
```

### `console/server/api/v1/console/runtime/apps/[appCode]/action.post.ts`

```text
11: await requirePermission(event, 'runtime_apps', 'admin')
```

### `console/server/api/v1/console/runtime/apps/[appCode]/config.get.ts`

```text
11: refreshPlatformBundle,
170: const refreshed = await refreshPlatformBundle('runtime-config-cache-miss', event).catch(() => null)
```

### `console/server/api/v1/console/runtime/apps/index.get.ts`

```text
5: await requirePermission(event, 'runtime_apps', 'view')
```

### `console/server/api/v1/console/service-clients/repairs/aims-codocs-runtime-read.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
16: await requirePermission(event, 'service_clients', 'admin', '需要服务凭证管理员权限')
17: const idempotencyKey = requireIdempotencyKey(event)
18: await requireConsoleRequestUid(event)
20: return await callConsoleTenantRuntime<RuntimeRepairResult>(
24: scope: 'console:service-client:grant',
25: idempotencyKey,
```

### `console/server/api/v1/console/settings/catalog.get.ts`

```text
6: await requireSystemSettingsAccess(event, 'view')
7: return await getConsoleSettingCatalogs(event, getQuery(event))
```

### `console/server/api/v1/console/settings/values/[settingKey].put.ts`

```text
10: await requirePermission(event, 'data_runtime', 'edit')
12: actorId: await requireConsoleRequestUid(event)
15: return await requireSystemSettingsAccess(event, 'edit')
20: await requireSettingEditAccess(event, settingKey)
21: if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
22: throw createError({ statusCode: 400, message: '保存系统参数必须提供 Idempotency-Key。' })
30: return await updateConsoleSettingValue(event, settingKey, body)
```

### `console/server/api/v1/console/settings/values/index.get.ts`

```text
6: await requireSystemSettingsAccess(event, 'view')
7: return await getConsoleSettingValues(event, getQuery(event))
```

### `console/server/api/v1/console/vault/resolve.post.ts`

```text
5: await requireVaultServiceActor(event)
```

### `console/server/api/v1/console/vault/secrets/[secretCode]/reveal.post.ts`

```text
6: await requirePermission(event, 'credential_vault', 'admin')
18: setHeader(event, 'Cache-Control', 'no-store, max-age=0')
20: return await revealConsoleVaultSecret(event, secretCode, {
```

### `console/server/api/v1/console/vault/secrets/[secretCode]/rotate.post.ts`

```text
4: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requirePermission(event, 'credential_vault', 'edit')
8: requireIdempotencyKey(event)
14: return await addConsoleVaultSecretVersion(event, secretCode, body, 'rotate')
```

### `console/server/api/v1/console/vault/secrets/[secretCode]/versions.post.ts`

```text
4: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requirePermission(event, 'credential_vault', 'edit')
8: requireIdempotencyKey(event)
14: return await addConsoleVaultSecretVersion(event, secretCode, body, 'versions')
```

### `console/server/api/v1/console/vault/secrets/index.get.ts`

```text
6: await requirePermission(event, 'credential_vault', 'view')
7: return await getConsoleVaultSecrets(event, getQuery(event))
```

### `console/server/api/v1/console/vault/secrets/index.post.ts`

```text
4: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
7: await requirePermission(event, 'credential_vault', 'edit')
8: requireIdempotencyKey(event)
10: return await createConsoleVaultSecret(event, body)
```

### `console/server/api/v1/heartbeat/online.get.ts`

```text
5: await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')
```

### `console/server/api/v1/login-logs/index.get.ts`

```text
5: await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')
6: return await getConsoleLoginLogs(event, getQuery(event))
```

### `console/server/api/v1/login-logs/index.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
23: const actor = await requireConsoleServiceActor(event, 'audit', 'audit:write')
24: requireIdempotencyKey(event)
35: return await appendConsoleLoginLog(event, {
```

### `console/server/api/v1/operation-logs/index.get.ts`

```text
5: await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')
6: return await getConsoleOperationLogs(event, getQuery(event))
```

### `console/server/api/v1/operation-logs/index.post.ts`

```text
3: import { requireIdempotencyKey } from '~~/server/utils/idempotency'
24: const actor = await requireConsoleServiceActor(event, 'audit', 'audit:write')
25: requireIdempotencyKey(event)
38: return await appendConsoleOperationLog(event, {
```

### `console/server/api/v1/operation-logs/lifecycle-metrics.get.ts`

```text
7: await requirePermission(event, 'authorization_lifecycle', 'view', '需要授权生命周期查看权限')
8: await requirePermission(event, 'audit_logs', 'view', '需要审计日志查看权限')
10: return await getConsoleLifecycleAuditMetrics(event, getQuery(event))
```


## 10. 访问适配与补充证据

- `console/server/utils/integrationAccess.ts:8-22` 实际资源名 **integration_config**，view允许服务身份fallback，但页面列表 handler `integrations/index.get.ts:8-12` 对服务读返回410；Host应使用已验证用户转发，不能改用普通service身份替代Console用户权限。
- `console/server/utils/systemSettingsAccess.ts:8-22` 实际资源 **system_settings**，仅view允许服务fallback；edit/admin不降级。
- `console/server/api/v1/console/directory/provisioning.get.ts:5-6` 为directory_users:view；`foundation/server/utils/consoleTenantRuntimeClient.ts:173-177` 已有console:directory-connector:view操作。
- `console/server/api/v1/console/authorization-lifecycle/retry.post.ts:61` 基于原operationId/phase生成稳定下游Key，不读取浏览器Idempotency-Key；页面UUID头不改变该事实。
- `console/server/api/v1/console/vault/secrets/[secretCode]/versions.post.ts` 是新增版本写，与rotate相邻；当前页面没有GET versions，不登记不存在的路由。resolve.post是服务鉴权用途，不属于Host页面迁移。
- `data-runtime/internal/apps/console/connector_runtime.go:165-200,278` redeem验证安装机公钥，返回encryptedClientSecret而非明文clientSecret；Vault hash-only与last4 :430-460。安装码和后续加密client secret分别分类，不能误称页面展示长期clientSecret/privateKey。
- `console/server/utils/connectorRuntimeDiagnostics.ts:31-48` 服务token只在Authorization，失败固定文本；但成功仅验证metrics存在后返回整个response.data，Host仍需白名单，不能以UI描述“仅聚合计数”代替输出约束。
- `data-runtime/internal/apps/console/directory_sources.go:312-327` credential为**顶层credential.plaintext/backendSecretRef**，不是credential.material；receipt payload为credentialSupplied、secretCode、storageBackend，排除材料；当前表单用backendSecretRef同一变量按storageBackend映射字段。
- `console/server/utils/dataRuntimeManagement.ts:355-357` update-status包含error/errorCode和自由result；安全只读Host不能透传result或error原文。

## 11. 后续实施拓扑门禁（Claude 2026-09-26 补充）

committees 的9f1edca0遗漏 `enterprise-topology.mjs` 对 `/enterprise/api/directory/committees/:committeeCode` 与 `/:committeeCode/members/:uid` 的覆盖，PATCH出现404；Codex-sol正在补。本盘点不修改该补丁。批次C若获批准，逐条列Console exact route、Enterprise BFF、网关 enterprise-topology METHOD+路径映射，并为每条路径加覆盖测试；只登记Foundation route并不能证明请求可达。提交前仍需既有要求的网关 `/enterprise` 200检查，重载/登录验收由协调者安排。

## 10. Claude 决定（2026-09-26）

**迁入 Host（MVP 只做两项）**
- C1：business-domains、regions 两页只读，限当前公司范围；导航按 Console manifest 贡献；创建/编辑/删除/区划替换全部链接回 Console。
- C2：data-runtime 与 runtime-apps 的安全状态摘要，只允许 version、status、healthy/可用性、lastSeenAt/checkedAt 与固定失败类别；**不披露** path、packageUrl、port、processName、ecosystem/diagnostic 任意字段、lastError 原文；不登记 config/action/update 路由。
- 均按已登记路由表 + 网关拓扑逐 METHOD 核对 + 响应白名单重建实施。

**永久或暂留 Console**：vault 全部（reveal、创建、轮换；partial preview 永不进入 Host 投影）、activation、自动初始密码、connector 安装/撤销、grant repair、运维/信任写入、PM2 action。C3（source/integration 摘要）、C4（settings）、C5（logs）、profile 自助密码与头像写入本轮不做，另案。

**现有通路整改（交 Codex-sol，独立任务，先于 C2 合入）**
- C-SEC-08：WeCom 测试发送的未知异常改为固定文本，不再写入通知 summary/body/metadata 与 delivery lastError（这些通知会在 Host 通知页展示）。
- C-SEC-03：connector 安装 POST 设 `Cache-Control: no-store`，页面在复制/关闭后清除含安装码的响应状态，不经共享 useFetch 状态驻留。
- C-SEC-07：用户创建响应始终白名单重建，缺 token/credentialId 时也不原样返回 operation。
- 另：data-runtime / connector-runtime URL 设置缺 Idempotency-Key 的页面调用补齐（仅页面侧，不改 Runtime 契约）。
- C-SEC-04/05/06 记录为已知限制：Host 不迁对应页面；Console 侧整改另排。

**运行验收**：缓存/请求日志/崩溃采集的实际验证由 Codex-sol 在 C1/C2 与整改的本机验收中执行。

## 11. C1/C2 交付与波次 2 验收输入（2026-09-26）

- C1 提交 `32580a2d`：Host 当前公司 business-domains/regions 只读页；当前公司由服务端解析，区域区划先校验所属公司。三条精确 GET 同时登记 Foundation 路由与 Gateway 拓扑，写操作链接回 Console；导航使用 Console manifest。
- C2 提交 `164019e0`：Host data-runtime/runtime-apps 安全摘要；两条精确 GET，响应仅含 version、status、healthy、available、lastSeenAt、checkedAt、failureCategory。应用状态聚合不输出应用标识/进程信息；缺失源字段为 null，不推测。配置/更新/运维写操作留 Console。
- 代码证据：C1 Enterprise 266 通过、1 跳过，C2 269 通过、1 跳过；两组 typecheck 与定向路由/白名单/Gateway 回归通过。数量分别对应各提交，不累加；本机入口 200 不替代登录业务或缓存/请求日志/崩溃采集验收。
- §10 独立安全整改与认证门禁仍按各自审查、环境证据放行，不以本节功能交付替代。未执行部署、重启、切换或生产合入。
- 下一步为[波次 2 联合验收脚本](./Unified-Enterprise-Pilot-Acceptance-Script.md)，包含 Claude 批准的 §7 本机口径。源码交付、历史验证、本轮待环境与本机不适用分列；本节不勾选 INT-501～507。
