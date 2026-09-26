# Enterprise 测试初始凭据

`data-runtime/cmd/enterprise-test-credential` 默认仅打印计划，不连接数据库。工具只允许当前 Mac 的 C000001 测试 Runtime 配置、固定 Console 数据库和 server UUID、Console deployment 及所有 active Enterprise grants 的精确测试 tenant/deployment。Vault 主密钥读取当前 LaunchAgent 实际使用的受保护 `test-runtime/vault-key`；不读取 Worker secret、不输出密钥、明文凭据或 token。

在 `data-runtime/` 执行：

```sh
go run ./cmd/enterprise-test-credential --plan
go run ./cmd/enterprise-test-credential --apply
go run ./cmd/enterprise-test-credential --verify
```

`--apply` 仅初始化已登记 active `enterprise.runtime`。领域函数复用正式 Console AES-256-GCM 实现，在同一事务锁定 service client 并写 Vault secret/version、credential、current pointer 和 Vault audit。已有有效凭据只验证，不轮换；撤销、无效、遗留孤立 credential/Vault 所有权均拒绝，不重建。工具不创建或修改 grants。

`--verify` 只读事务核对当前所有权、状态、有效期、解密及内容 hash。它不是 JWT 签发证据。

正式 Gateway/Console 取得 `aims:products:view` token 后，可通过受保护文件重定向给 `go run ./cmd/enterprise-test-credential --verify-token` 的 stdin。不要把 token 放进命令参数或粘贴日志。该模式只查询现有公钥、当前凭据和精确测试范围 grant，验证 EdDSA、kid 有效期、issuer、唯一 audience、sub/azp/client、source/target、tenant/deployment、token_use、expiry、scope 及凭据撤销；成功仅输出布尔结论。固定期望是 `https://hzy-test.huizhi.yun`、`data-runtime`、`enterprise.runtime`、`C000001`、`C000001-test-enterprise`、`aims:products:view`，其他 scope 必须另立明确验证契约。工具不会自己签 token。

验证：`node data-runtime/scripts/test-initial-credential-mysql.mjs` 使用 disposable `/tmp/hzy-test-mysql-*` MySQL，canonical Console DDL，race 测试通过（1.587s），结束自动清理。覆盖最终 audit 失败全回滚、首次加密、重复操作、错误主密钥、撤销不恢复、真实测试签名正例及逐项错误身份/expiry/scope/grant/credential 反例。测试签名仅使用隔离 fixture key；不代表真实 Gateway 已签发。Console 单测通过。

2026-09-13 主代理审阅目标绑定与事务代码后，在实际本机 C000001 Console 测试库依次执行 `--plan`、`--apply`、`--verify`。首次返回 `created:true, credentialId:8, vaultVerified:true`，独立只读复验返回 `created:false, credentialId:8, vaultVerified:true`；注册脚本复验 current credential 指针为 true。未输出或导出秘密，未执行 JWT 签发验证，未部署或切换业务路径。

## 正式 OAuth 探针

`node deploy/test-env/verify-enterprise-oauth.mjs --plan` 展示固定测试目标；`--execute` 读取现有受保护 Gateway 凭据与登记，向真实公网 `/oauth/token` 发起 credential-less app identity 的 `client_credentials` 请求，将真实响应 token 直接通过子进程 stdin 交给只读验签工具。无本地签名或 token 文件。该探针会产生正式 Console OAuth/凭据使用审计，配置不变。

当前本地 Gateway registry 未登记 `apps.enterprise`，探针明确 `REGISTRY_BINDING_MISMATCH`、未发请求。所需唯一登记是 `domains['hzy-test.huizhi.yun'].apps.enterprise={deploymentCode:'C000001-test-enterprise'}`。Registry 在 Cloudflare secret 中，不能仅根据本地副本整体覆盖；须先核对远端权威状态。此处尚无成功签发证据。

### Registry 远端核验与最小合并

测试 Gateway wrapper 新增仅 POST、固定测试域、内部 token 保护的 `/__test/registry-digest`。它只返回递归键排序后的完整 Registry SHA256 及测试 Enterprise deployment，不返回 Registry/SSO/秘密。先按既有发布流程仅更新测试 Gateway 代码并保留所有 secrets。

`enterprise-registry-merge.mjs --prepare` 读取该真实远端摘要，比对本地完整 Registry，严格相等才生成 `.cloudflare-workers/gateway/enterprise-source.secret-patch.json` 和 receipt（0600、不可覆盖已有文件）。补丁仅包含 Registry 一个 secret，JSON 内仅增加 Enterprise deployment key。其他应用、SSO、Runtime endpoint 均原样保存。已有不同 Enterprise 对象拒绝。

写入前必须执行 `--recheck-before`，以既有 Worker secret 更新流程仅发布该 patch；完成后执行 `--verify-after`，再运行 `verify-enterprise-oauth.mjs --execute`。Cloudflare secret PUT 没有原子 CAS，摘要检查不是数据库原子比较写入；操作期间应串行管理配置，任何漂移都重新获取权威状态，不能强行继续。工具本身不发布、不覆盖本地旧 secrets 文件。新摘要及原 wrapper 三测试通过。

正式 OAuth 首轮到达真实 Gateway/Console 后返回 `invalid_scope: scope does not match audience`。查明原 Runtime 语义 scope 算法要求每条跨 app grant 的 `scope_json.audience='data-runtime'` 与 `semanticScope=<精确cap>`；仅登记 tenant/deployment 不足。`enterprise-registration` 已补全部 32 项：仅对 active 且缺字段的记录使用 JSON_SET，保留其他 metadata；任何已有不同值、撤销或部署冲突拒绝。verify 将语义字段缺失列为 missingCapabilities，不写数据。测试试点发行 audience 已收敛为唯一 `data-runtime`，不再宣称 `tenant-runtime` 可发行；全局旧兼容未改。

真实隔离验证覆盖 32 项原 `authorizeServiceClientScopes` 授权及逐项拒绝未登记 audience。Console 基础 DDL snapshot 缺少现有 usage tracking 依赖的 `service_client_grants.last_used_at`，fixture 显式增加该列，不以 warning 当作已验证写入。registration 缺字段补全/metadata保留/冲突与撤销回滚测试通过，preflight 唯一实际 audience 六测试通过。

### 全部实际 capability 的正式签发证据

`enterprise-oauth-live-evidence.json` 保存 32 项当前 Foundation 精确 capability 的真实 CF Gateway → Console service binding → 本机 Runtime 签发及只读验签成功，以及未登记 `tenant-runtime` audience、未知 scope 的正式拒绝。Foundation `callEnterpriseRuntime` 使用 `scope: route.capability`，实际组合 scope 列表为空；未申请人为组合的全权限 token。只读 CLI 新增 `--verify-token --scope <固定 allowlist 项>`，不接受任意或组合 scope。探针与当前 Foundation capability 集合一致才运行。

该次成功运行仅记录整轮完成时间，没有逐项时间，不追溯编造。首次运行在至少 16 项成功后遇到一次 503，当时缺少逐项 checkpoint；一次重跑全 32 项及两个反例成功。此后工具已增加逐项去敏结果/时间 checkpoint，遇错后 `--resume-all` 只续未完成项，要求同一 Registry digest、capability 集合及 10 分钟窗口，不再次循环已成功项。证据只代表服务 token 链，尚非 Host 部署或浏览器验收。
