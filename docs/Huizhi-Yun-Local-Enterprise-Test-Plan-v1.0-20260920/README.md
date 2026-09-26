# 汇智云本机 Enterprise 测试环境方案包

版本 1.0 / 2026-09-20。

2026-09-20 接手更新：Copilot 已实现 Dev 脚手架并启动本机栈；Codex 已核查运行状态、补进程归属/HTTP/WS/OIDC 核验修正。最新事实见[验收记录](docs/Local-Enterprise-Test-Acceptance-Record.md)，不是下方原始方案包的“仅文档”交付结论。G1 尚未验收，Node/回环传输尚未实现。

`review/VALIDATION.md` 与 `review/SHA256SUMS.txt` 保留原始方案交付证据，不代表接手修改后的文件校验结果。hzy0 单条回源已按用户批准修正，公网登录页及 SSO 跳转已验证，应用会话仍待验。

主要文档：
- [完整实施方案](docs/Local-Enterprise-Test-Environment-Implementation-Plan.md)
- [参数冻结与验收记录模板](docs/Local-Enterprise-Test-Acceptance-Record.md)
- [本次交付校验范围](review/VALIDATION.md)

配置附件：
- `templates/local-enterprise.profile.example.json`：拟新增配置合同，关键身份值保持 null，需要先实现读取器。
- `templates/Caddyfile.hzy0.example`：单站点块示例；先合并审核，不能覆盖当前完整配置。
- `templates/tunnel-hzy0-ingress.fragment.yml`：仅 hzy0 一条 ingress；runtime 域名原配置不变。
- `templates/ecosystem.hzy0.example.cjs`：PM2 结构样例，依赖尚待实现的 runner，缺项会停止加载。
- `templates/strict-test-flags.env.example`：已有 Foundation 安全开关片段，不是完整环境文件。

## 与仓库落地的关系

主方案建议放到仓库 `docs/Local-Enterprise-Test-Environment-Implementation-Plan.md`。
其余模板在实现者确认后放入 `deploy/test-env/local-enterprise/` 或主方案列出的目标路径；当前包的 `templates/` 只是交付附件，不要求在仓库复制第二套部署树。

本文不提供已验证可直接启动全栈的执行程序，也不修改远端仓库。主方案中 `local-enterprise.mjs` 等为需要实现的明确 CLI 合同。实际 Runtime 端口、OIDC 信任、绑定和 Tunnel upstream 没有在本次会话中读取，因此没有伪造这些值。

## 保持不变

现有本机 Runtime/数据库及其进程管理、`hzy-test-runtime.isme.dev` 入口、现有 Cloudflare 测试 Workers、正式认证/权限/幂等边界、统一侧栏与业务导航决策。

本次交付仅为文档与模板，未启动/停止任何用户进程，未调整配置或执行部署/数据库操作。
