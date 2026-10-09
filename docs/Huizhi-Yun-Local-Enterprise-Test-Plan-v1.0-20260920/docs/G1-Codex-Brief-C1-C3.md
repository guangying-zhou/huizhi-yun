# Codex 任务书：G1 收口 C1～C3（2026-09-23）

派发：Claude（总体安排）。执行：Codex。提交：完成后把文件清单交 MiMo，不自行推送 GitHub。评审：ChatGPT-6-Pro。

先读：根 `CLAUDE.md`、`deploy/test-env/LOCAL_RUNTIME.md`、`docs/Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/docs/G1-Closeout-Tracker.md`（并行边界一节是硬约束）、实施方案 §LE-A 表（`Local-Enterprise-Test-Environment-Implementation-Plan.md` 第 695 行起）。

按 C1 → C2 → C3 顺序做；每项独立可交付。

## 共同约束

- 只改任务列出的文件。`policy-sync.mjs`、`console-facade.mjs`、`console-egress.mjs`、`gateway.mjs` 以及 Foundation/Console/Platform/data-runtime 的授权与策略代码归 Claude，不要修改；需要改时在回执里说明原因，由 Claude 处理。
- 不打印、不写入文件任何 token、Cookie、密码、私钥或完整环境 dump。读取凭据只能在进程内使用。
- 可以重启 hzy0 本栈进程（`node deploy/test-env/local-enterprise.mjs restart --profile $HOME/.config/huizhi-yun/hzy0/profile.json --mode dev --app <app>`），做匿名或只读的公网探测。不得改动 Runtime LaunchAgent、Caddy/Tunnel、云端 Workers、开发 Platform，也不得写业务数据或 grant。
- 不要创建 `~/.config/huizhi-yun/hzy0/policy-sync-fault`（验收故障开关，归 Claude）。
- 测试从仓库根目录运行：`node --test deploy/test-env/local-enterprise/test/*.test.mjs`（当前 76 项全过，保持全过）。
- 证据写进 `G1-Closeout-Tracker.md` 末尾“回执”节，格式：任务号、改动文件、运行的命令与结果（计数/状态码）、未完成项。不要改验收记录第 3 节表格（Claude 合并）。

## C1：CLI 与进程矩阵（LE-A01/A02/A03）

目标：把三项从“部分通过”推进到有实跑证据。

1. LE-A01：对 `local-enterprise.mjs`（plan/doctor/up/restart 等现有子命令）用临时 profile 副本（放 `$TMPDIR`，不改真实 profile）实跑：未知字段、空身份、`environment=prod`、端口冲突、非默认 gatewayInternal 端口。期望：启动前拒绝并列出缺项，无进程启动、无外部请求、无文件写入真实目录。能自动化的补成测试。
2. LE-A02：构造含 `DB_*`、Vault 主密钥、`*_BYPASS`/`dev bypass` 类变量的旧 `.env.dev` 与 shell 环境，证明 runner 不导入、子进程实际环境中不存在或 bypass 为 false（用进程环境键名核对，不打印值）。
3. LE-A03：实跑一次完整 `down` → `up` 和一次全栈 `restart`（事先告知用户窗口，约数分钟页面不可用）。前后记录 Runtime LaunchAgent PID、Caddy PID、hzy0 以外 PM2 进程 PID，证明不变；hzy0 进程恢复 online，`/runtime/health` 版本不变，策略同步恢复 `ready: true`。

可改：`deploy/test-env/local-enterprise.mjs`、`deploy/test-env/local-enterprise/{config,process-ownership,run-process}.mjs` 及对应测试（`run-process.mjs` 中 R1 服务密钥那段保持原样）。

## C2：暴露面与路由矩阵（LE-A05/A06/A11）

目标：一个可重复运行的只读探测脚本 `deploy/test-env/local-enterprise/probe-exposure.mjs`（新增）加测试，输出脱敏表格。

1. LE-A05：从公网入口（`https://hzy0.isme.dev`）及本机非回环地址探测内部监听（23100 Console、23121 Gateway 私有出口、Enterprise dev 端口、Runtime 18084）、`/console/api/internal/**`、drain、调试与 Nuxt devtools 路径。期望：不可达，或按合同 401/403/404。回环本身可达是设计，要区分记录。
2. LE-A06：未认证访问 `/enterprise/_nuxt/**`、HMR WS、Codocs 编辑器静态资源、`/console/_nuxt/**`。记录外层保护（Access）与应用登录各自是否生效，保护不能替代应用登录。
3. LE-A11：列出 Host 已注册页面与 API（以 Enterprise 路由注册与 `composition/business-api-surface.mjs` 为准），逐条验证 method/path：未注册路径与错误 method 的状态码；API 路径永不返回 200 HTML；兼容重定向只对 GET/HEAD。

只允许 GET/HEAD/OPTIONS 以及已知会被拒绝的匿名请求；不要用登录态，不要触发写。

## C3：页面导航的上游失败改为安全 HTML（体验缺口）

现状：`gateway-transport.mjs` 在上游失败时经 `error-contract.mjs` 的 `safeError` 一律输出 JSON。用户直接打开页面时看到原始 `{"statusCode":503,...,"code":"hzy0_upstream_error"}`。

要求：
- 只对文档导航（GET/HEAD，`Sec-Fetch-Mode: navigate` 或 `Accept` 以 `text/html` 为首选，且不是 `/api/`、`/_nuxt/` 等资源路径）返回最小静态 HTML：中文说明（服务暂时不可用或无权限，按状态分 401/403/409/503 与其他），“重试”按钮（重新加载当前地址），可选“返回首页”，显示 `correlationId`（如有）。不引用外部资源，内联少量 CSS，`Cache-Control: no-store`，状态码保持原样，`Content-Type: text/html; charset=utf-8`，支持暗色（`prefers-color-scheme`）。
- 错误文案只用已核对的固定文案（沿用 `codes` 表），不回显上游正文或诊断；`Retry-After` 与 Cookie 清理规则与现有 `safeErrorHeaders` 一致。
- API/资源请求保持现有 JSON 行为不变（现有测试必须仍过）。
- 补测试：导航得到 HTML、API 得到 JSON、未知码降级、无诊断泄露、HEAD 无正文、暗色样式存在。
- 实测：在 hzy0 用 `curl -H 'Sec-Fetch-Mode: navigate' -H 'Accept: text/html'` 对一个会失败的受控路径验证（不要为此制造真实故障；用测试服务器或已知 401 路径）。

可改：`deploy/test-env/local-enterprise/{gateway-transport,error-contract}.mjs` 及测试。

## 完成标准

- 本地测试全过；新增测试覆盖上述行为。
- `G1-Closeout-Tracker.md` 回执节有 C1/C2/C3 各自证据与未完成项。
- 交给 MiMo 的文件清单（只含本任务文件）。

## C4：开发 Platform 策略接口性能（阻塞 LE-A09 角色矩阵）

现状（2026-09-23 实测）：
- 在服务器本机直连 `127.0.0.1:3011`，`GET /api/platform/internal/console/tenants/C000001/bundle?environment=test&deploymentCode=wiztek-test-console&format=hzy-policy-revision.v1` 需 **36.7 秒**；`format=hzy-policy-envelope.v1`（约 727 KB）需 37.9 秒。经公网链路常 504，hzy0 同步一轮 100～125 秒。
- 同一查询（`findCurrentPolicyEnvelopeRow` 的 SQL）单独执行只需约 1.5 秒（14 行 policy_bundles，约 6 MB payload），`/api/health` 为毫秒级。时间主要消耗在 Node 进程内，首要怀疑对象是 `stableStringify(parsePolicyBundlePayload(...))` 与 `policyPayloadHash` 对约 512 KB 载荷的处理，或该路由上的其他同步计算。
- 策略发布（`generatePolicyBundle`）超过 120 秒。

要求：
1. 先定位：在本地用与线上同规模的载荷（可用 `platform/test` 夹具构造约 500 KB 的 bundle，或用 Node `--cpu-prof` 对本地 Platform 跑同一路由）找到耗时点，给出数据，不要猜。
2. 修复，并保持行为不变：修订查询和信封的字段、`payloadHash`（签名内容的逐字节一致性是硬约束，任何规范化输出必须与现有实现逐字节相同）、拒绝码、鉴权。优先：修订查询不需要重新序列化整份载荷（`bundle_hash` 已存库，可用于比对，需说明完整性检查如何保持）；信封对同一 bundle 行缓存规范化载荷（按 bundle id + hash，进程内、有界）。
3. 若 `generatePolicyBundle` 慢在同一处，一并处理；否则只报告瓶颈。
4. 测试：现有 `platform/test/policyEnvelope*.test.ts`、`consoleServiceKeys.test.ts` 全过；新增用例证明修订查询、信封与修改前逐字节一致，并给出本地前后耗时。
5. 不部署。交付后由 Claude 审阅并在用户批准后按 `deploy/test-env/platform-console-service-key-release.mjs` 的流程发布到开发 Platform。

C4 是对“共同约束”中“Platform 策略代码归 Claude”的明确授权例外，仅限下列文件。

可改：`platform/server/utils/{policyEnvelopeDelivery,currentPolicyEnvelope,policyBundle}.ts`、`platform/server/api/platform/internal/console/tenants/[tenantCode]/bundle.get.ts` 与对应测试。不改 authz-core 的信封格式与校验规则。

## C5：旧 Shell 链接跳转状态码对齐（C3 完成后，同一文件）

`gateway-transport.mjs` 对 `resolveEnterprisePilotPath` 返回的 `kind: 'redirect'` 一律回 308。对 `/shell/{app}` 旧书签，云端 Gateway（`deploy/cloudflare/tenant-gateway/src/index.js` 的 `proxyToEnterprisePilot`）刻意回 **307** + `Cache-Control: no-store`（试点可回退，不能声明永久）；其他 redirect（如 `/enterprise`→`/aims/`）云端为 308。要求：hzy0 与云端逐条一致，只改 `/shell/` 这一类；补测试（`/shell/aims` 为 307 且 no-store、Location 不变，`/enterprise` 行为不变）。可改：`deploy/test-env/local-enterprise/gateway-transport.mjs` 及其测试。
