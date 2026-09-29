# C000001 云端预发配置准备（只读盘点，2026-09-28）

本单是 [10/8 上线计划](Go-Live-20261008-Plan.md) §2 的 10/1–10/2 准备输入。它没有证明云端现状，也不授权部署或写 grant。环境执行前由 Codex-sol 对 C000001 **云端预发**逐项回读；本机 C000001 测试库和生产 wiztek 均不是此目标。

## 制品与版本

`deploy/build-pilot-artifacts.mjs --out /绝对路径/空目录` 从同一个干净 Git HEAD 本地构建 Linux amd64 Runtime、Enterprise Host、Console、Workflow 的 Cloudflare Nuxt `.output` 包，以及 Gateway `src` 与 Wrangler 配置包。脚本禁用 dev/HMR，不调用 Wrangler、数据库或远端 API；输出 `manifest.json` 记录完整 commit、各版本、文件大小与 SHA-256。构建时不注入凭据，包不包含云端 secret；实际部署时必须将目标环境配置与同一 manifest 绑定。Gateway 包内的 `wrangler.jsonc` 是仓库当前生产模板，**不能原样用于 C000001 预发**。

Enterprise 发布门禁先强制检查组合模块的模板/样式别名及 Host Nitro 直接引用的模块 server 文件和一层依赖，再分别运行 Aims、Assets、Codocs、Altoc 自身的 vue-tsc typecheck；模块内 `~/` 的类型解析由各模块本地 typecheck 负责，不能借 Enterprise 的全局 TS paths 代替。

## 必须先回读的配置差异

| 项目 | 代码事实与预发目标 | 环境负责人须核对/准备 |
| --- | --- | --- |
| 域 grant | `Console-SQL-Seed-v2.27-enterprise-host-domain-grants.sql` 固定 `enterprise.runtime` → `data-runtime` 五项 `aims/assets/codocs/altoc/console:enterprise-host:execute`，scope 绑定 `C000001`、`C000001-test-enterprise`、`audience=data-runtime`、逐域 `semanticScope`；只插缺行，不复活 revoked | 云端 Console 当前 `enterprise.runtime` credential、来源 app、五项现状与真实 Host Runtime audience；若 Host 使用 `tenant-runtime`，现有 v2.27 不覆盖，需先出对应受审 seed/verify，不能改写 SQL 后直接用 |
| grant 校验 | `Console-SQL-Verify-v2.27-enterprise-host-domain-grants.sql` 逐行核 status/audience/semanticScope | 写前备份 `service_client_grants`，写后 verify 五项，真实 client 签发五个 token 均 200，错 aud/旧精确 capability 不应通行；旧 grant 撤销属于另一个 v2.28 批次，不能提前做 |
| 调度精确 grant | 调度不适用五域 Host grant。Aims 三项现代双 audience 候选为 v2.31（integration drain、due、rollover）；旧 v1.92/v2.8/v2.9 的同物理行可能存在但缺 tenant/deployment 绑定，v2.31 只插缺行、不修旧行、不复活 revoked，verify 会把这些行显示为不就绪。Workflow effects 候选为 v2.29 双 audience，维护恢复为独立禁用身份的 v2.30，均未写环境 | 先列出云端将启用的 Aims/Workflow 调度路由、实际 client、audience 和精确 scope，逐物理行列差集。旧不完整行须另审精确 repair，不能靠 seed 覆盖。Workflow 必须先使 v2.29 grant 生效并探测签发/使用，再于同一窗口切换 Runtime 与 Worker；无宽 scope 回退。v2.30 只准备行，不启用维护身份。生产旧调用方清单仍须只读核对，不凭本机源码推断生产 |
| Gateway | 仓库 `deploy/cloudflare/tenant-gateway/wrangler.jsonc` 是生产域名与生产 Service Binding 模板；`HZY_ENTERPRISE_SERVICE` 在代码中用于试点但生产模板未登记，cron 为 5 分钟 | 预发专用 Worker 名、测试 hostname/route、Console/Host/Workflow 及 Aims 等精确 service binding、`HZY_ENTERPRISE_PILOT`/registry、租户白名单、Gateway scheduler registry URL/token、签名密钥须与 C000001 云端登记回读一致；不得把生产 hostname、生产绑定或本机 origin 混入预发 |
| Host / Console / Workflow | Host `enterprise/scripts/render-cloudflare-config.mjs` 仅生成本地 dry-run 模板；Console 与 Workflow 的 render 脚本以生产配置及实际公钥、OIDC、Runtime 绑定为输入，不能以默认值代表预发 | 分别准备预发 Worker 名/路由、Console OIDC issuer/callback、Runtime audience/tenant/deployment、Platform 签名公钥和 Console/Workflow/Host service binding。凭据与共享 HMAC 只进入受控 secret 管理，不写到制品、manifest 或文档 |
| scheduler owner | Gateway 读取 Platform registry 的 `enterpriseScheduler.storage/generation`，仅受信 Gateway 签名唤醒；Runtime scheduler registry 有持久栅栏 | 回读 C000001 Aims/Assets/Workflow 当前 owner 与 generation，确认计划中的唯一 owner、旧 cron 停用顺序及恢复路径。调度 grant 与 owner 切换是两件不同的变更 |

### 四个 owner 与五分钟时延门禁

Gateway 的一个五分钟签名 Aims wake 承担三项 owner：`aims.runtime` 的 integration-operation drain、独立开关控制的到期通知、里程碑 rollover。独立 Workflow wake 由 `workflow.runtime` 处理 notification、lifecycle、callback 三类 outbox。Aims 三项分别要求 `aims:integration_operation:execute`、`aims:notifications-due:execute`、`aims:milestone-rollover:execute`；Workflow effects 要求 `workflow:integration_operation:execute`，均不能借 Enterprise Host 域 capability。调度身份、Runtime audience、tenant/deployment、generation 及签名路径须逐跳验证。四项的回执/水位与 legacy owner skipped/409 都要在预发测试，不能以 Gateway 收到 200 代替。

**C000001 独立测试 Gateway** 的最后只读记录只有每日 policy cron，并无五分钟业务 scheduler；在门禁 5 的审批回调/通知/待办时延验收前，须单独申请批准添加 `*/5 * * * *` trigger、四项 owner 的 Platform scheduler registry/generation 登记、对应精确 grant 与必要 Worker/Runtime 发布。先只读核 Cloudflare 账户 cron 数量、测试 Worker 当前 trigger、租户 eligible 数、Aims/Workflow 旧 owner 与存量队列。拟议测试配置为 shardCount=1、maxWakes=8（仅 C000001 一户）；如 eligible 数不同，重算预算与最坏 wake 间隔并在门禁 3 用同配置测 Cloudflare CPU p50/p95/p99、exceededCpu、积压消退。任何一项未就绪，不声称五分钟时延通过。此段是执行计划，**未执行任何环境写入**。

Workflow 三类 effect 的检查点现在要求 pending 读取时观察到的 `versionNo`。预发切换时先暂停 Workflow 的请求内投递和 Gateway/手动 drain，在**同一个维护窗口**切换 Runtime 与 Workflow Worker，再恢复投递并核对 notification、lifecycle、callback 的 pending→fail/ack 正反例；不能在旧 Worker 与新 Runtime 混跑（旧调用方缺版本将收到 400），也不能先恢复定时唤醒。回滚同样先暂停投递，成对恢复旧 Runtime/Worker 后再恢复调度。该窗口、暂停与回滚均属于待批准的环境动作，本文件不授权执行。

## 需用户批准的具体环境动作

1. 在 **C000001 云端预发 Console 库**备份 grant 表并执行与实际 audience 相符的五域 seed；逐行 verify、真实签发探测。若 audience 非 `data-runtime`，先审补 seed/verify 后另行批准。
2. 对计划启用的 **Aims/Workflow 调度精确 scope**，批准各自 client 的缺失 grant 写入、verify 与真实签发；明确 scope/audience/deployment 清单后执行。不能以“调度 grant”笼统授权未知项。
3. 批准预发 Cloudflare Worker 的发布与各 binding/route/secret 变更（Host、Console、Gateway、Workflow），以及对应 Platform deployment/registry 绑定；发布制品须与同一 manifest 的 commit/hash 一致。
4. 另行批准 scheduler registry owner/generation 切换和旧调度入口停用；另行批准 v2.28 旧精确 grant 撤销。两项不得随五域 seed 暗中执行。
5. 在门禁 5 前，另行批准 C000001 独立测试 Gateway 增加五分钟 cron 和四个 owner 的正式登记；先按上节只读门禁核配额、配置、精确 grant 和旧 owner，再发布并观察一个同步周期与一次手动 drain。不能把生产 Gateway 的五分钟 trigger 视作测试站已配置。

本次只写本地脚本和准备文档；没有运行 `wrangler deploy`、`secret put`，没有连接或修改云端环境。
