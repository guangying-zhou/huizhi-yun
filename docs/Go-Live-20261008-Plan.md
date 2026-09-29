# 2026-10-08 上线计划（wiztek）

状态：用户已确认范围与时间表（2026-09-28）。本文是上线的执行索引，不授权任何环境写入；每个生产或云端动作仍需用户逐项批准。整合负责人：Claude；Codex 调度：Opus 5.5；变更审批与业务验收：用户（加拿大 ADT，国庆期间在岗）。

## 1. 已确认的决定

| 事项 | 决定 |
| --- | --- |
| 10/8 范围 | Enterprise Host 上线 Aims 核心（项目、工作项、里程碑、成果、工时、项目文档只读）以及**依赖 Workflow 的审批闭环**：10/8 只含事项和工作项的完成审批与回调。**里程碑完成审批顺延到第二窗口**（2026-09-28 盘点见 `.git/codex-milestone-completion-gap.md`：governance 事务无法接入回执；Host Workflow 入口和 bind 都缺；legacy 回调在 `payment_term_id` 非空时会生成 Altoc 操作；估算 29–45 工时）。此项待用户确认 |
| 同批升级 | Console（仍为身份与策略权威）、Data Runtime、Gateway、Workflow、Platform release 与策略包 |
| 保持不变 | Codocs 现有生产前端与数据；Console 页面暂不迁入 Host |
| 本期不做 | Altoc、Assets 产品工作台写入、周报试点写入、实时 Collab、Codocs 迁入 Host（第二窗口，约 10/8 后两周另定） |
| Host→Runtime 授权 | 按[能力收敛方案](./Enterprise-Host-Capability-Consolidation.md)收敛为 5 个域 capability，**是上生产的前提**；10/2 仍未完成则 10/8 顺延 |
| Cloudflare 套餐 | 暂不升级。Console CPU 必须靠代码解决，并作为门禁实测 |
| PA-04 D 尾批 | 10/8 启用 GitLab 仓库关联与同步（用户 2026-09-28 直接确认）。**D1**（里程碑新建/编辑/删除、变更目标）和 **D2**（项目仓库关联/解除、GitLab 同步）都要在 10/1 前完成评审并提交，并在收敛批 2 之后 rebase |
| GitLab 上线前提 | 生产 GitLab 凭据放入 Console integration-config 加 credential-vault，不进 env。用户同意从生产库现有凭据迁移：先只读定位来源（表、加密方式、所属集成），迁移本身是生产写入，在演练和暗发布窗口经用户确认后执行。迁移经 Vault 正式写入口或受控命令在客户侧完成，明文不落日志、shell 历史或文件；源数据不改；用 GitLab 只读 API 探测验证，不打印 Token。预发环境不复制生产 Token，改用只授权测试仓库的独立 Token；Host Worker 从 Cloudflare 能访问 wiztek GitLab（diff 内容由 Host 直连）；仓库关联和同步的浏览器正例使用可安全清理的测试仓库 |

## 2. 时间表

| 日期 | 事项 | 负责 |
| --- | --- | --- |
| 9/28–9/29 | 能力收敛批 1 分类；PA-04 B/C；只读核对 wiztek 生产现状（Runtime/Console/Gateway 版本、Cloudflare 账户套餐、Workflow 与 Assets 是否已部署、现有 grant 盘点） | Codex-sol、Codex-sol2；Claude 审 |
| 9/30 | 收敛批 2 代码与完整回归；Workflow 必修项开工（§4） | Codex-sol；Claude 审 |
| 10/1 | 收敛批 3、批 4 本机上线；实测 Token 签发次数与 Console CPU | Codex-sol；用户批准环境写入 |
| 10/1–10/2 | 构建不可变制品（Runtime 二进制，Host/Console/Gateway/Workflow Worker）；按 5 条域 grant 加调度精确 grant 部署云端预发（C000001） | Codex-sol（环境）、Codex-sol2（构建脚本与配置准备） |
| 10/2–10/5 | 预发联合验收（§3 门禁） | Codex-sol 执行，Claude 签字，用户做业务验收 |
| 10/5–10/6 | 在 wiztek 生产数据副本上演练 Console 升级、grant audience 迁移、新建 Aims 统一业务库和 Workflow 库、备份恢复；随后生产暗发布 | Codex-sol；用户批准 |
| 10/7 | Go/No-Go | 用户决定，Claude 提交证据 |
| 10/8 | 为 wiztek 开放 Aims 入口；观察 72 小时 | 全员 |

## 3. 上线门禁（全部在云端预发取得证据，本机证据不算）

1. **制品**：Host、Runtime、Console、Gateway、Workflow，以及只供调度使用的 hzy-aims Worker（无公网 route，workers_dev 关闭，只接受 Gateway 通过 Service Binding 发来的签名唤醒），共 6 件，固定为同一提交构建的不可变制品，版本与 hash 登记在案；不使用 dev/HMR。
2. **授权**：
   - 5 条域 grant 和调度精确 grant 由实际 service client 签发探测通过（200）；
   - 旧精确 scope 签发失败；
   - 全部组合 scope 已做 Console grant verify。
3. **CPU**：在真实会话下（登录、项目详情、工作项、审批、回调）观察至少 2 小时，Console 与 Host Worker 无 `exceededCpu`。未达标即 No-Go，届时需要重新讨论套餐。
   Gateway 调度 cron 的 CPU 必须用生产 registry 的实际租户数 N 和实际配置实测（`84dc2f73`：shard=1，每次最多唤醒 8 次；N=2 时唤醒上限调到 28；N≥3 需要改公平设计，10/8 前不支持）。
4. **岗位链**：项目经理、成员、审批人、无权账号四个岗位的正常链与反例；撤权后服务侧 ≤5 分钟、菜单 ≤10 分钟生效（G05 口径）。
5. **Workflow 闭环**：
   - 时延：请求触发的即时 drain 是主路径，审批结果和通知通常应在秒级送达；cron 只兜底，最坏为 5N 分钟加处理时间（wiztek 单租户约 5 分钟）。验收要分别记录这两种情况的实测值。
   - 里程碑与事项完成：发起 → 审批 → 回调 → 状态落定；
   - 驳回回调；
   - 通知与待办各送达一次，无重复；
   - 定时 drain 由唯一 owner 执行（§4）。
6. **故障与恢复**：
   - Runtime、Console、Workflow 各重启一次后恢复；
   - 写请求丢响应后，用同一个键重放不产生重复；
   - 旧版本编辑冲突返回 409。
7. **回归**：现有 Codocs 登录、目录、文档读写与共享在预发和演练中行为不变。
8. **恢复演练**：在隔离副本上从加密备份恢复 Console、Aims 与 Workflow 库并核对。
9. **两租户**：C000002 或等效隔离租户同 ID 对象互不可见，缓存与回执不串租户。

## 4. Workflow 纳入范围后的必修项

纳入审批闭环后，以下已知问题从“后续改进”升级为上线前必修：

- **通知/待办投影先于生命周期关闭**：审批完成时，生命周期关闭可能早于站内通知投影创建，导致 `404 actionable_not_found` 反复重试。需要改成“创建先于关闭”的依赖，或经审查的墓碑方案。
- **outbox 终态与重试上限**：`flow_actionable_outbox` 与相关 lifecycle outbox 需要有 abandoned 终态、重试上限和审计，避免失败项无限重试。
- **云端定时 owner**：测试环境目前处于“零定时 owner”状态。生产必须为 Aims integration drain、通知到期提醒、里程碑 rollover、Workflow 回调 drain 各登记唯一 owner，要求如下：
  - 按根 `CLAUDE.md` 交付 worker 调用代码；
  - Data Runtime 精确 scope 校验；
  - `data-runtime` 与 `tenant-runtime` 双 audience 的 grant seed/verify；
  - 契约测试。

  这些调度路由**不在**能力收敛范围内，继续使用精确 scope。
- **人工恢复通道（workflow.maintenance）**：10/8 不登记这个身份，也不执行 v2.30 grant seed。若出现 abandoned，按[破窗 Runbook](Workflow-Bounded-Delivery-Runbook.md)针对具体事件另次请求用户批准；已由 huizhiyun-fa 审查的 `workflow-breakglass` 工具（`9957ad71`）提供 prepare→activate→retire 受控步骤，尚未在环境执行。v2.30 seed 本身只安装恢复 grant，不等于身份登记或凭据签发。三类 abandoned、依赖阻塞及维护身份 active 超过 15 分钟/未吊销凭据均纳入上线后 72 小时观察；callback abandoned 导致事项停在 `in_review` 时 4 小时内处理。10/8 后改进为凭据仅在同一进程内存中使用。
- **Workflow 生产升级**：生产已有 `hzy-workflow` Worker（2026-09-22 版本，100% 流量），但业务健康和租户绑定尚未核实。上线属于升级而非新建：要核对生产 Workflow 库的 schema 版本，演练中执行到 012 的迁移，配置审批路由并验证。

## 5. 回滚

- **开放 Aims 前**（暗发布阶段）：Host 不开放导航；Console、Runtime、Gateway 可回退到上一版制品，Codocs 不受影响。
- **开放 Aims 后**：先隐藏 Aims 入口，保留 Aims 与 Workflow 的新数据，不回退业务库；Console、Runtime 问题按制品回退处理，但 grant audience 迁移不可回滚，演练时需确认新旧 Console 都能在迁移后的 grant 数据上正常运行。
- 任一门禁失败：按 §1 规则顺延，不降级放行。

## 6. 已知风险

- Codex-sol 同时承担授权核心改造和全部环境操作，是关键路径上的单点。不需要动环境的准备工作优先分给 Codex-sol2。
- Console 生产升级影响现网 Codocs 用户的登录；演练必须覆盖 refresh、离职撤销与现有 OIDC 客户端。
- 测试环境仍有 216 条旧 grant 缺 `semanticScope`，另有 322 条缺绑定；生产盘点结果出来前，不能假设生产没有同类问题。

## 7. 生产只读核对结论与待办（2026-09-28）

详见 [wiztek 生产只读核对](./Wiztek-Production-Read-Only-Check-20260928.md)。

- **已核实**：Runtime `0.3.219`；Gateway、Console、Workflow、Assets 的 Worker 都有 100% 生效版本；本机无凭据访问 `gitlab.wiztek.cn` 返回 401，说明入口是公网可达的。
- **制品来源**：生产 Runtime 是从有未提交改动的工作树构建的（提交 `c11c7c66-dirty`）。10/8 的全部制品必须从干净提交构建，并登记提交号和 hash；回滚点也要写清楚，回滚到的是这个 dirty 版本。
- **GitLab 凭据**：仓库里的初始化脚本采用 `env_ref` 方案（`GITLAB_BOT_TOKEN`）。如果生产现状确实如此，那么迁移就是“从 env 引用迁入 credential-vault”，而不是在库与库之间复制密文。迁移方式等元数据核对后由 Claude 确定。

**需要用户提供或批准：**

1. 生产库的只读连接，用于盘点 grant 并核对 GitLab 凭据的元数据；
2. Cloudflare 账单的只读权限，用于确认套餐；
3. 批准部署一个受控测试 Worker（属于云端写入），只做一次无凭据的 GET，确认 Host Worker 能访问 GitLab；
4. 批准在 wiztek GitLab 的测试命名空间新建私有仓库 `hzy-pilot-aims-gitlab-20261008`，并为预发环境签发只授权该仓库的 Token。
5. 批准在预发 C000001 的 Gateway 配置 5 分钟 cron 及四个 owner，并在生产 Platform 的 scheduler registry 登记 wiztek 四项定时任务的唯一 owner，并为 Aims、Workflow 调度写入精确的双 audience grant（在演练和暗发布窗口执行）。
6. 批准生产操作：在 wiztek Console 创建 `aims.runtime` 服务客户端和凭据，并写入 Aims 调度的精确双 audience grant；部署只供调度使用的 hzy-aims Worker；阻断 Gateway 公网的 `/aims` 代理。执行前须只读证明：hzy-aims 当前的 route 与 workers_dev 状态已查明，近 30 天没有非内部流量。
7. 确认“发起完成到审批人收到待办”这段时延：**推荐保持 5 分钟 cron，最坏约 5 分钟**。改为每分钟需要新增 Gateway 的 minuteSlot 分频和 Workflow outbox 的 claim lease，10/8 前不做，放到第二窗口，与即时触发一起设计。审批决定、回调和通知本身都是秒级。
8. 决定 10/8 是否启用 Aims 到期提醒（调度 Worker 当前配置 `HZY_AIMS_DUE_NOTIFICATIONS_ENABLED=false`）。**推荐不启用**：10/8 的 owner 为 Aims 集成 drain、里程碑 rollover、Workflow 回调 drain 三项，到期提醒放到第二窗口。如果启用，必须先在预发单独验证。
