# APF、WizBiz 迁移与 Collab 生产上线执行方案

状态：**阶段一已获批准；续行窗口失败后已恢复旧生产，最新事实见 §17.5。阶段二仍待批准**。核查日期：2026-10-06（America/Halifax）。目标租户 `C000001`，环境 `prod`，正式入口 `https://aidcp.wiztek.cn`，共享 Platform `https://hzy.wiztek.cn`。

本文件统筹同一发布窗口，不代替逐项批准、安装 plan 或迁移 reviewHash。hzy0 的账号、grant、真实 Vault、期初应收及协作批准均仅限 test，不能沿用为生产授权。生产旧 OA 冷存档不恢复为在线写入源；本轮迁移输入固定为 W0 封存快照。

## 0. 2026-10-06 调整：文档与项目先上线

**本节替代下文原一体化上线顺序。下文 APF/WizBiz 步骤保留为阶段二执行参考，不属于阶段一批准范围。** 用户原则同意尽快上线；生产写入仍逐项批准。

### 0.1 阶段与基线

阶段一在 10/8 前开放 Codocs + Collab 和 Aims：个人/部门文档、项目对象页面、Host 管理员项目页、项目集树与项目文档。Altoc、Finance、People 代码随七件应用发布，但不开放员工入口、人员权限或后台 owner。历史财务接续、应收工作台不验收、不启用。

候选冻结为集成分支 `bf151ebc790f999f387af037ed98ebf0fd6f3f5c`（应用代码最近提交 `877acf1a`，已含 B5-B 和后续修复）。本执行单自身提交不改变该候选；若另加代码，必须重新冻结 SHA、制品摘要和副本证据。正式 Runtime 版本及 release 名仍待分配，使用 stable-prod 精确版本；不沿用 hzy0 测试版本。

阶段二另行批准 APF 安装、W1、WizBiz 主迁移、生产真实 Vault、opening、角色授予与后台 owner。hzy0 的迁移/真实账号/期初应收结果不复制到生产。

### 0.2 APF 安装与迁移取舍

| 方案 | 收益 | 风险 | 建议 |
| --- | --- | --- | --- |
| 阶段一安装全部 APF/W1 并迁移，权限关闭 | 后续开放准备较少 | 扩大 DDL、账号、数据与 Vault 变更；迁移回滚复杂；延长全服务停机；员工尚不使用的数据提前承担维护责任 | 不采用 |
| 阶段一仅装空 APF 表，不迁移 | 部分将来缺表请求避免报错 | 安装 53 张基础表及增量仍需 Registry/配置变更；空表不构成授权隔离；现阶段无业务收益 | 不采用 |
| 阶段二才安装/迁移 APF | 阶段一范围最小、回滚较短 | 再安排一次停机；最新代码在无 APF 域时的启动与拒绝行为必须验证 | **推荐** |

源码依据：`subsets.go` 的 `aims-portfolio-members` 独立返回 `ForAimsPortfolioMembers`；其 `WithAimsPortfolioMembers` 保留现有 Aims 映射，只增加两张表，不要求 APF 基础域。配置 `EnterpriseBinding` 按已登记 domains 构造映射，不因新版含 APF 代码自动安装域。阶段一保持生产原 Registry/domain 集合，仅增量补 Aims；不复制 hzy0 APF profile。副本必须证明新 Runtime 能在此配置启动，文档/项目不间接依赖 APF 缺表；失败时停下修缺口，不默认改成全量安装。

### 0.3 阶段一最小数据与运行范围

1. 只补 `aims-portfolio-members`：`aims_portfolio_members`、`aims_portfolio_doc_repos`，以当前生产映射生成 plan/proposed config/reviewHash，apply → verify；不得先执行空 subset 的 APF 基础安装。
2. 执行受审 `aims/docs/migration_v6.0_milestone_billing_schedule.sql` 及其 verify，仅在列确实缺失时执行；列为最新 Aims schema 配套，即使不开放 Finance 也保留。核对视图与原 Aims 数据不变。
3. Codocs 先完整 schema verify；六表已存在的事实不能代替列/索引核查。只对确认缺失的受审对象执行整文件迁移与 verify。portfolio 文档对账按原执行单正式路径、只审实际差集，不新建无策略行。
4. 保留独立 Workflow 库和现有 Aims/Workflow 调度。APF 三域 wake、到期/死信通知、Directory 投递及历史财务全部关闭；不装 APF scheduler grant。
5. Collab 正式登记、精确 read/publish grant、受保护凭据、快照桶 PASS_BOTH、回环进程/WS 和个人/部门开关按 §8 分项批准。不得开放未批准的 APF 外发合同。

### 0.4 prod 人员权限与失败关闭门禁

不把 manifest 目录发布当作员工授予。阶段一不发布/选用新的 Altoc、Finance、People manifest，不刷新其推荐角色，不新增 APF 分配、scope 或模板。附录 A 的全部 APF 新增动作及角色变化推迟阶段二；**旧 prod39 已有 APF 权限也必须核查**，仅推迟新增不能保证员工无 APF。

签包前通过正式 Platform 读取，按普通员工的直接分配、部门/职位继承、默认模板、app-role 映射、通配及 admin 蕴含计算有效权限。阶段一普通员工对 altoc/finance/people 的应用入口与全部资源动作必须为零；不向普通员工授予租户全局管理覆盖。若存在旧授权，列出准确角色/映射/模板及受影响范围，经单独批准走正式编辑/撤销路径；禁止删 payload 或 SQL 修权限。现有证据不足以断言这项已通过。

39 条验收范围按附录正式退役机制排除，单列批准；租户级退役会影响今后 test 重签，不能伪称仅 prod 生效。生成 prod 包必须严格递增，test 当前 rev47 保持原签包不变。Aims/Codocs 所需权限从现有角色与正式 manifest 差集逐项审，不借 APF 角色授予。

验收必须同时证明：普通员工导航无三域入口；直接访问三域页面无数据；已登录普通员工直接调用代表性读/写 BFF 返回 403，且拒绝发生在领域查询前。`enterpriseAPF.ts` 的 scoped evaluator 与 Runtime permit 复核继续保留，缺表的 500/503 不算权限拒绝。导航隐藏不是安全证据。机器入口无 APF scheduler 授权/开关不能投递；保留旧生产 owner 的非目标行为。

### 0.5 缩减副本彩排与停机预算

macOS 隔离副本只恢复生产统一库、Codocs 及必要 Console/Registry 表，运行同 SHA 工具：基线 verify → Aims 两表 plan/apply/verify → billing 列及视图 verify → Codocs 实际缺失 DDL/verify → Aims/Codocs 读写合同 → 空表逆序 rollback/备份恢复验证。禁止恢复老 OA 暂存、执行 W1/APF、迁移/opening/Vault。已有文档数据不得用 DROP 回滚；须验证保留数据恢复边界。

记录每步耗时和 runner/工具/SQL SHA，正式窗口使用相同 SHA；生产实例绑定与 reviewHash 独立生成。**本次尚未完成缩减彩排，不能声称已 PASS。systemd 停启未彩排**：逐服务桌面核对、全部可执行文件存在且可运行、配置权限/软链/输出完整、启动顺序及恢复命令预检替代；不把 macOS 数据测试当作 Linux 启动证明。

暂按 **60 分钟维护窗口预算（计划值，非实测）**：停写与最终备份 15 分钟、Aims/Codocs 数据增量 10 分钟、成对切换与逐服务预热 15 分钟、健康/权限/协作验收 20 分钟。备份、DDL 或恢复实测超预算则重排窗口，不能压缩 verify。离线构建、导出恢复、权限差异审查、桶检查准备均移到停机前。Runtime 停止连带所有业务服务，需提前告知员工。

### 0.6 阶段一逐项批准清单

下表是待批准动作，尚未执行。可合并回复批准编号，但具体 grant/权限差集、reviewHash 和制品 SHA 未冻结的项不可直接执行。

| 编号 | 待批准写入与边界 | 执行前门禁 / 验证 |
| --- | --- | --- |
| S1-01 | 生产加密 DB/代码/配置备份，建立本次 release 目录 | 解密验证、容量至少 20 GiB 且按备份估算；旧链接/二进制可恢复 |
| S1-02 | 正式退役两个验收角色，排除 39 范围；普通员工旧 APF 授权如存在另列精确撤销子项 | 全编译引用链零引用；源记录保留；不改 test 签包 |
| S1-03 | 只发布/选用所需 Aims/Codocs manifest 和文档/项目人员权限差集 | 完整新增/删除/角色/范围差异审查；APF 员工有效权限零 |
| S1-04 | 正式生成、签发 C000001 prod 包并同步 Console | revision >39，验签/环境正确；test rev47/hash 不变 |
| S1-05 | 登记 Collab 部署/client/凭据及两条精确 grant，必要文档服务差集逐行批准 | tenant/deployment/audience 绑定、真实签发/正反调用；非目标行不变 |
| S1-06 | 停写/停 timer/停止 Runtime 与依赖服务 | 最终备份核验；同 SHA 副本 PASS；工具完整；恢复命令已桌面核对 |
| S1-07 | Aims 两表安装与 Registry/config 更新 | 子集 plan/reviewHash → apply/verify；原映射/数据不变 |
| S1-08 | billing_schedule_code 配套列/视图及 Codocs 缺失 DDL（各实际 SQL 单列） | 整文件、失败即停、每份 verify PASS；不存在缺口不执行 |
| S1-09 | 同 SHA Runtime + 七应用发布与配置切换 | Runtime → Console → Workflow → Aims → Codocs → Collab → Enterprise → Gateway；入口/动态模块/匿名 Service API/稳定 PID |
| S1-10 | 快照桶能力实测所需对象写入及 WS/个人协作启用 | PASS_BOTH、正式绑定、双 Chrome/断线/撤权；不写 Vault |
| S1-11 | 部门协作启用与标记验收数据/清理 | 个人协作先通过；部门 ACL 正反例；不删除权威快照 |
| S1-12 | 解冻业务、恢复既有非 APF timer 与 72 小时观察 | 普通员工 APF 403；文档/项目验收；APF owner 仍关；失败保留证据 |

可合并批准：S1-01/06/09 的版本窗口，S1-02/03/04 的人员策略，S1-05/10/11 的 Collab；Aims 与 Codocs DDL 仍按实际差集列子项。合并只是审批便利，不改变执行顺序。恢复备份覆盖生产、上线后撤回权威快照等不在上述默认回滚授权内。

阶段二原 P08 全部 APF/W1（除已阶段一安装的 Aims 子集）、P10–P13、P15、P21 与 APF 人员发布均推迟。原 7 项推荐角色权限删除也推迟，不能随阶段一静默撤权；阶段一主动收回员工 APF 的实际授权另列 S1-02 差集。

## 1. 原全量方案参考（阶段二按实际重新冻结）

### 1.1 候选基线

| 项目 | 冻结选择 / 要求 |
| --- | --- |
| 代码 | 集成分支 `origin/feat/adr018-enterprise-integration` 已包含的 `bf151ebc790f999f387af037ed98ebf0fd6f3f5c`（阶段一 §0.1） |
| 范围 | 已交付 APF、W3、B5-A、WizBiz 主迁移/期初应收/真实 Vault 工具、Collab、管理员项目树和 Host UI |
| B5-B | 已合入，含历史财务接续后续修复；只随代码发布，业务开放推迟阶段二 |
| Runtime | 必须与上述代码配套构建；正式版本尚未分配，不使用 hzy0 `.29` 测试版本，不发布到旧 `stable` 通道 |
| 应用 | Console、Workflow、Aims、Codocs、Enterprise、Gateway、Collab 七件；Altoc/Finance/People 通过 Enterprise layer 组合，不部署三个独立旧应用 |
| 平台 | 共享 Platform 不随应用包重部署；manifest 选用、角色调整、prod 签包分别审批 |

实际批准前从 GitLab 回读完整 SHA，确认干净 worktree 与代码评审记录，归档 `git rev-parse HEAD`、lockfile SHA、Runtime/安装器/迁移工具/runner 和每件应用包 SHA-256。GitLab 不可达则停止，不切 GitHub。Runtime 历史合同护栏 `f895fb4b` 必须是构建祖先，不能仅按版本字符串推断。

### 1.2 复用的权威说明

- [APF 领域设计](./Enterprise-APF-Domain-Design.md)、[全动作对照](./Enterprise-APF-Action-Matrix.md)、[跨模块合同](./MODULE_CONTRACTS.md)。
- [W0 封存基线](./WizBiz-Migration-W0-Baseline.md)、[W1 模型](./WizBiz-Migration-W1-Model-Design.md)、[W2 工具合同](./WizBiz-Migration-W2-Tool-Contract.md)、[W2 验证规范](./WizBiz-Migration-W2-Verify-Test-Spec.md)。
- [生产文档/资产/项目集执行单](./Go-Live-Document-Asset-Portfolio-Release-Runbook.md)：G1–G3、实际 systemd 单元、配置/Registry 保护、Codocs schema 与对账。
- [自托管数据库执行单](./Go-Live-Self-Hosted-Data-Migration-Runbook.md) §3a、[快照桶测试](./Go-Live-Self-Hosted-Snapshot-Bucket-Test-Plan.md)、[部署 README](../deploy/self-hosted/README.md)：Collab 安装、登记、精确授权、WebSocket 与桶验证。
- [安装器说明](../data-runtime/cmd/hzy-enterprise-add-apf/README.md)：固定子集、生产 profile、依赖、只建/列增量与逆序回滚。

生产安装器已支持受审 profile；阶段一按 §0 仅安装 Aims 必要增量，APF 开放推迟。不能删除冷存档或跳过权限门禁。

## 2. 本轮生产只读核查

本轮仅 SSH 读取状态/固定非敏感配置字段，以及 `hzy_ro_audit` 的 SELECT/SHOW；未运行安装器、迁移工具或 seed，未重启、签包、修改账号/配置/数据。DB 查询使用只读事务，连接秘密只在进程内加载。

| 项目 | 2026-10-06 实测 | 发布影响 |
| --- | --- | --- |
| 内网主机 | `100.64.72.59`；MySQL `8.0.46` | Linux/x86_64 制品必须在匹配环境构建 |
| Runtime | `hzy-data-runtime.service` active/running；`/runtime/health` status=ok；`0.3.225`，commit `5113fa3a68be1eff6cc5c8f2e78a503a0a887d05` | 不是当前 APF 合同版本；必须配套升级 |
| 应用链接 | Console/Workflow=`s4-rc22`；Enterprise/Aims/Codocs=`s4-rc25`；Gateway active | 不能只热同步 Host 页面 |
| Collab | `hzy-collab.service` not-found；无 current 链接、无 `/etc/hzy/collab.env`；Gateway apps 无 collab | 需安装制品、单元、正式登记和配置 |
| 统一库 | `hzy_enterprise` 301 个表/视图；`altoc_`/`finance_`/`people_`/`mig_` 对象 0 | 先基础 APF，再增量和 W1；没有可复用的 hzy0 业务数据 |
| Registry 配置 | instanceId=`1e3c34dd-bb9b-11f1-bf6b-000c293f1086`，schemaVersion=`enterprise.v1`，generation=1；Aims read/write/scheduler=unified，Assets read/write=unified、scheduler=disabled | 窗口前复查实际 Registry 与配置一致；不得复制 hzy0 UUID/hash |
| Aims配套schema | 未发现aims_portfolio_members/aims_portfolio_doc_repos；aims_milestones无billing_schedule_code | 子集18和v6.0配套DDL为当前差集，不可遗漏 |
| Workflow | 现用 DB=`hzy_workflow`；无 workflowLane 配置 | 本批保留独立池与 Node 鉴权链，不顺带执行 Workflow 统一库切换 |
| Codocs | DB=`hzy_codocs`，40 个对象；六张 snapshot/collaboration 表已存在且各0行，`object_key`、`policy/dept_code`、`status/checked_at` 已存在 | 必须逐列/索引/约束 verify，不能重复执行已装 ALTER；表存在不等于协作已启用 |
| Runtime Codocs 开关 | snapshotV2Enabled/collaborationV2Enabled 未配置，collab deployment binding 未配置 | 按默认关闭处理；最后独立批准开启 |
| Console | DB=`hzy_console`，71 个对象；Runtime health vaultKeyConfigured=true | 只证明配置可用，不是生产真实 Vault 写入批准 |
| grant 初查 | 五类 client 148 行；enterprise.runtime active=43，未查到 collab.runtime grant；三域 U/S/P 中只见 `data-runtime:altoc:enterprise-host/execute` active（ID 104437603，prod Enterprise 精确绑定） | 附录授权族逐条形成差集；不能直接整份 seed 重复插行 |
| Platform | prod revision=39，test revision=46；prod baseline bundleId=40 | 只签新的 prod 包；test 保持不变 |
| Gateway 调度 | drain apps=console/workflow/aims，maxWakes=16、concurrency=4、wall=45000ms；policySync=1分钟；无 APF 配置 | APF 单一 owner 尚未启用；签包后正常政策同步不得被关闭 |
| timer | 查询到 `hzy-backup.timer` | 窗口前另核对 Runtime updater、所有自动启动来源，不臆测没有其他来源 |
| 磁盘 | `/` 可用 48,164,532 KiB；`/home` 可用 381,552,832 KiB | 仅观察值；停机前及 apply 前重查，至少20GiB且满足实际备份/暂存/DDL/日志预算 |

证据保存在本仓 `.git/apf-prod-db-audit.json`、`.git/apf-prod-platform-audit.json`（只含结构和技术条目，不含 token、个人资料或账号明文）。权限清单是直接行投影，尚未证明 grant 真正可签发/消费，也未验证当前 credential 状态；正式授权探针另列批准项。

### 2.1 窗口前必须补齐的只读证据

1. DB 全量 `SHOW CREATE TABLE`、索引/约束/trigger、Registry、实际账号 `SHOW GRANTS`；安装器只读 plan 必须在获批停止事实下运行，当前不能借“只读”绕过停机门槛。
2. 三域与旧独立库的在途 operation、Workflow pending/bind、callback/outbox、通知键、离职撤权阶段，按类型统计，不打印业务内容。不存在旧 APF 统一表不代表旧 People/Finance/Altoc 冷存档或旧 Workflow 无在途命令。
3. 各模块 legacy flags、生产来源 deployment、服务 credential 和 grant 状态；查 revoked、缺绑定、物理别名、重复语义键。不复活 revoked。
4. Codocs 六表完整安装 verify、权威 generation、非空/在途票据数；现用 OSS 版本/条件写、integration 元数据；不读密文/正文。
5. 独立 Workflow schema 012/013/014、版本栅栏 fail/ack 调用方匹配；abandoned、依赖阻塞、callback 数量。若不齐，另行批准迁移，禁止重复安装。
6. 生产四行 Aims `contract_id` 存量悬空引用及所有登记的外部 ID 引用，在生产 plan 自动冻结；不改、不删 Aims 行。

### 2.2 只读连接方法

受保护凭据文件 `~/Library/Application Support/HuizhiYun/prod-readonly.json`（0600）；只在进程内加载。SSH key `~/.ssh/id_ed25519_hzy`。生产 MySQL 仅 `127.0.0.1:3306`；先确认本机33306空闲或已存在隧道归属，再建立独占隧道：

```sh
ssh -i ~/.ssh/id_ed25519_hzy -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -N -L 33306:127.0.0.1:3306 root@100.64.72.59
```

mysql2 连接本机33306，账号必须 hzy_ro_audit，库仅批准的 hzy_enterprise/hzy_console/hzy_codocs；`START TRANSACTION READ ONLY` 后只 SELECT/SHOW，结束 ROLLBACK/close。关闭本次拥有的 SSH 进程，不用模糊 pkill 杀他人的隧道。Platform 通过现有受保护远端连接读取，不复制凭据到本机。不要用生产管理账号代替只读账号。

## 3. 待批准清单与依赖顺序

**每行均为独立生产写入动作，当前均未执行。** 批准须包含本文件版本、最终 SHA、目标 prod、具体差集/plan/reviewHash。批准“上线”不能代替真实 Vault 和业务数据批准。

| 编号 | 待批准动作 | 前置 / 验证 | 回滚边界 |
| --- | --- | --- | --- |
| P01 | 创建加密生产备份、传输并落地已冻结制品 | 备份范围 §5；解密全流校验、恢复彩排 | 保留证据，删除制品仅另批 |
| P02 | Platform 发布/选用 APF 当前 manifest（逐 app） | 附录A差异、完整SHA、无意外删除/降权 | 正式选用原manifest；不能改DB绕过 |
| P03 | Platform 调整 APF 推荐/实际角色、范围及模板（逐差异） | 审定新增角色/人员动作/默认scope；不自动分配用户 | 正式撤回分配；另签更高prod revision |
| P04 | 仅生成/签发 C000001 prod 包，Console 应用新revision | 验签、prod单调递增、test46及非目标摘要不变 | 以原事实签更高prod revision；不倒退39 |
| P05 | 生产 Console 精确 grant 补缺/补事实、服务身份/Collab凭据安全配置 | §4逐行差集，备份/verify/真实签发消费矩阵 | 仅本批行按批准撤销，保留审计；不复活旧行 |
| P06 | 建生产安装/迁移/Directory只读账号及暂存source账号 | 工具闭集 SHOW GRANTS，口令仅0600 | DROP本批账号或REVOKE精确增量；不碰服务身份 |
| P07 | 停用户写入、暂停相关投递/timer，停 Runtime及依赖服务 | 维护页和停止事实；盘点原enable状态 | 恢复原配置/状态；逐个启动服务 |
| P08-00 | 安装APF基础53表及候选映射 | 独立plan/hash，旧Altoc不在活动统一映射 | 空表/未开放写入时原receipt rollback |
| P08-xx | §6每个缺失安装子集逐段apply；每段单独批准 | 原config链、MySQL算法/锁耗时、verify | 实际顺序逆序；非空禁止DROP |
| P09 | Codocs/Workflow缺失DDL（仅已证实差集） | canonical verify和完整文件演练 | 原执行单的数据保护规则 |
| P10 | 在独立回环暂存实例恢复封存快照及配置最小账号 | 全流哈希/字节数与W0一致，source SELECT-only | 删除本批暂存仅另批；保留加密快照 |
| P11 | 主迁移 apply（客户/联系人/合同/法人/账户/余额/台账） | 同SHA副本PASS，production plan无blocker/hash获批 | 工具rollback通过全部栅栏，禁止直改账本 |
| P12 | 真实 Vault 写入或受控 synthetic→real升级 | **生产逐环境批准**，Runtime既有主密钥解析、HMAC证明 | 原upgrade/main工具回滚；保护旧秘密/版本 |
| P13 | 期初应收独立apply | 派生确认集、金额/数量汇总及opening reviewHash获批 | opening-rollback先于主迁移回滚 |
| P14 | 原子切Runtime及七应用、安装Collab单元/配置/登记 | 同SHA制品/生成物/动态模块门禁 | 精确旧链接/二进制/配置；已写数据先评估兼容 |
| P15 | 启用APF写入和后台owner（逐域/通知族） | 原owner已关闭、在途收口、grant/CPU/时延证据 | 先关新owner，保留原键/账本，不自动复活旧owner |
| P16 | OSS快照桶测试及所需生命周期规则 | 独立桶/精确前缀与批准范围 | 清理仅本批测试对象；不删权威快照 |
| P17 | Gateway/nginx WebSocket配置、个人Collab开关 | 登记/绑定/grant/桶PASS_BOTH | 关闭开关但保留权威heads/OSS |
| P18 | 部门Collab第三开关 | 个人协作已验收，部门schema/ACL通过 | 关闭部门开关，保留数据 |
| P20 | Platform正式登记Collab部署 | C000001-collab，冻结prod登记制品和差集 | 正式撤销登记须无在途票据/依赖并另批 |
| P21-xx | Workflow各APF业务flow/角色解析候选seed、Altoc销售阶段初始化（逐文件） | schema已齐；现用独立Workflow库和源app完整元组；旧实例收尾/回调矩阵 | 原回执/事务审计；有实例引用不得删模板或降版本 |
| P19 | 生产标记业务验收数据、解冻用户写入 | §9清单通过；测试数据清理台账 | 正式清理；不可变审批历史保留 |

可由用户明确合并批准 P01+P10 的准备、P02+P03+P04 的平台政策、P07+已审P08/P09/P14 的一次停机窗口；P11/P12/P13仍须各自明确目标和hash。P15通知族、P16–18协作及P19解冻不可因前项完成自动获批。

推荐流程：只读差异审查 → 加密备份 → 冻结制品及副本彩排 → 用户批准所有具体生产写入 → 生产预检 → 维护停机 → schema逐段安装 → 最小账号/full身份预检 → 主迁移 → real Vault → opening → 同SHA配套启动（owner/写入仍冻结） → prod策略同步/业务探针 → 单一owner → Collab → 浏览器验收 → 用户批准解冻。Platform签包时间与停机窗口协调，避免旧运行版本提前消费新权限；可预先发布manifest，但选用/签包留到配套代码ready时。

## 4. 授权与调度上线门禁

### 4.1 服务 grant 差集（不执行）

不能把manifest人员权限当作服务grant。按实际来源 `enterprise.runtime` / source_app=enterprise、tenant=C000001、deployment=C000001-prod-enterprise，目标audience/semanticScope/精确物理key逐行匹配。复用以下 **Seed及配对Verify**，先生成新增/既有正确/缺绑定/revoked/别名/冲突清单：

| 族 | 候选文件（console/docs/sql） | 合同 |
| --- | --- | --- |
| 三域U/S/P | `Console-SQL-Seed-v2.34-apf-channels.sql` | 每域 enterprise-host/scheduler/notification-detail；U按Host实际Runtime audience，不能无条件两套 |
| 三域机器owner | `Console-SQL-Seed-apf18-enterprise-scheduler.sql` | 三域scheduler精确scope，data-runtime与tenant-runtime双aud六行，完整矩阵；不是U能力 |
| People开通/停用 | `Console-SQL-Seed-apf09c2-enterprise-directory.sql` | console audience；directory-identity:reserve、directory-user:provision、directory-employment:sync、directory-offboarding:disable；阶段恢复不能伪造people来源 |
| HR来源 | `Console-SQL-Seed-apf17a-enterprise-hr-source.sql` | 现有HR connector精确合同/用途限制，未批准LDAP/邮箱新合同不一并实现 |
| 知识/资产关联 | `Console-SQL-Seed-apf16e-knowledge-links-candidate.sql` | 只关联已有且有权限对象；不创建/发布正文 |
| 通知与purpose | `Console-SQL-Seed-apf18b1-enterprise-notifications.sql` | 三域P、Console publish与Console→Enterprise的purpose读取；死信复用同合同 |
| P1既有通道 | `Console-SQL-Seed-p1-enterprise-channels-candidate.sql`、`...p1-enterprise-codocs-candidate.sql` | 按已上线实际行核验；不要重授已满足别名，不借aims.read/write |
| GitLab只读 | `Console-SQL-Seed-v2.35-gitlab-repository-read-only-candidate.sql` | 集成账号Reporter及原integrationCodes/usageTypes保留；不扩写权限 |
| Collab | `console/scripts/collab-prod-registration.mjs` 配套注册/verify与G-7已审生产清单 | client=collab.runtime；aud=data-runtime；仅codocs:collaboration-snapshots:read/publish；部署C000001-collab |

v2.34与APF18 scheduler有交集，应按语义键去重；选择唯一受审seed来源，不重复插入。现场存在物理别名或缺绑定时停止，列出具体行/保留字段后另批修复；revoked不能当作缺失重建。禁止新旧宽scope双接受。写前/后所有非目标grant按id排序全字段hash完全一致。

每个目标消费者做正确调用、缺cap、错aud/source/tenant/deployment、过期、撤销、原键重放矩阵；实际token只在内存，报告只状态/claims校验布尔。已批准grant不等于批准机器owner启用。

### 4.2 唯一owner

自托管Gateway的 `gateway/scheduler.mjs` 原生5分钟边界运行 integration-drain；policySync独立1分钟。不是CF cron登记，也不新建并行systemd timer。`scheduler.apf={enabled:false,domains:[],generation:""}` 默认关闭；获批启用才填实际非零generation，三域由Gateway签名wake到 `/enterprise/api/internal/apf/scheduler-inspect`。Enterprise复用 `HZY_ENTERPRISE_APF_SCHEDULER_ENABLED` 与各域开关，Runtime对应scheduler许可必须同事实。

People Directory claim/ack/fail及pending/bind恢复按冻结actor和版本栅栏，不借用户token。到期六族和死信三域默认关闭，分别确认旧任务 **和请求内路径** 已停，再启用新owner；family/flag表见安装器README。保留旧Aims产品反馈投递owner，Enterprise仅新增Altoc接收落点；此次不默认迁APF-16f生产者。People仅assignments/change完整元组转Enterprise，绩效及其它类型保留原目标，未知类型失败关闭。

测CPU/壁钟、每轮处理上限、跳过重叠、下次slot不饥饿；生产当前maxWakes=16不自动证明新三域wake足够，按最终配置重算和实测。审批/通知即时路径按秒级，cron兜底按5分钟单租户窗口验；超时不盲目重复drain，按原键probe/recover。

## 5. 备份、预检与停机影响

P01获批后建立服务器0700目录 `/home/hzy/backups/apf-migration-collab/<UTC批次>/`，证据和defaults/profile均0600。至少：统一库、Console、Codocs、独立Workflow全库；Console service clients/credentials/grants、策略快照/Vault；Platform应用/manifest/角色/范围/策略；Runtime二进制/config/.env/overlay、七应用旧链接/版本、Gateway配置、所有受影响systemd/env和nginx配置。秘密不放普通tar明文，不复制到repo。

沿现有加密备份流程，流式解密验证SHA/字节数、SQL可恢复性；只能在隔离实例做恢复验证。生产MySQL密码从本机受保护defaults或进程内加载，禁止argv/env回显。记录备份密文hash与保留策略，密钥路径仅记录存在性/权限，不读取内容到终端。

停机前检查磁盘至少20GiB，并按加密备份+SQL恢复副本+W1 COPY表重建+日志预算取更大值；apply前再查一次。全身份预检source/metadata/target/directory/profile/Runtime绑定/Vault解析必须一次列全，不到窗口里逐个试权限。

**停止Runtime会连带停止其依赖的Gateway、Console、Workflow、Aims、Codocs、Enterprise以及新增Collab。** 用户登录、审批、文档、通知和服务token消费都受影响。MySQL、共享Platform、nginx/Tailscale不默认停止。冻结 updater/timer与自动重启来源需P07；记录原enable状态，不运行无差别disable。WizBiz工具Linux停止证据要求systemd disabled+inactive及端口拒绝；仅systemctl stop不足。

```sh
# 仅P07获批后，在生产Runtime主机；先按原单元依赖停止业务，再停止Runtime。
systemctl disable --now hzy-data-runtime.service
systemctl show hzy-data-runtime.service --no-pager --property=LoadState,ActiveState,SubState,MainPID
# 安装器须 loaded/inactive/dead/MainPID=0，127.0.0.1:31080明确拒绝连接。
```

Gateway依赖Wants可能拉起其他应用，启动前核对目标单元，不因Runtime恢复自动解冻。生产不运行hzy0 PM2/LaunchAgent脚本，不复制test配置/credential/grant。

## 6. 安装与发布顺序

### 6.1 安装器参数和配置链

使用 `hzy-enterprise-add-apf --profile` 的 `apf-production-install.v1`，具体prod部署、127.0.0.1:31080、hzy_enterprise、instanceId/schemaVersion/generation从现场核对。原configuration、候选配置、profile和每段plan/receipt原字节纳入reviewHash。生产DDL账号权限单独批准，不能套本地hzy_apf_migration。

```sh
# 以下变量均是审定的绝对路径，目录0700、文件0600；口令不在参数中。
common=(--profile "$INSTALL_PROFILE" --config "$PREVIOUS_CONFIG" \
  --migration-db-config "$DDL_CONFIG" --proposed-config "$STEP/proposed.json" \
  --plan "$STEP/plan.json")
# 基础模式另显式带 --altoc-write/--finance-write；优先disabled，后续候选激活另批。
"$INSTALLER" --mode plan --subset "$SUBSET" "${common[@]}"
# STOP：审阅该段ReviewHash并获批P08-xx。
"$INSTALLER" --mode apply --subset "$SUBSET" "${common[@]}" \
  --receipt "$STEP/receipt.json" --review-hash "$APPROVED_HASH"
"$INSTALLER" --mode verify --subset "$SUBSET" "${common[@]}" \
  --receipt "$STEP/receipt.json" --review-hash "$APPROVED_HASH"
```

基础安装不带subset；增量不带write选项。每段成功后下一段PREVIOUS_CONFIG取本段proposed；不能先plan全部再apply。已安装完全匹配对象从本次清单跳过，保留历史receipt/安装器；漂移/半装失败关闭。任何DDL/verify非零立即停止。整份SQL交MySQL服务端解析，带 `--show-warnings`，不在客户端按分号拆分。

### 6.2 全部固定子集及建议串联

各独立域按以下单一线性次序冻结baseline；每一行/每个token都是独立P08-xx。最终以source定义实际前置复核为准。

| 顺序 | 子集 | 依赖 / 说明 |
| --- | --- | --- |
| 00 | 基础APF（无subset） | Altoc26业务+4账本、Finance9+4、People6+4=53表；新装声明已含部分W1列，不能再重加 |
| 01–03 | people-private → people-facts → people-offboarding | 私密档案、任职/入职、离职事实；不把Directory写入当DDL安装副作用 |
| 04 | people-hr-source | HR来源与部门映射；既有Directory合同 |
| 05–10 | altoc-sales-B2 → altoc-tenders → altoc-services → altoc-tickets → altoc-renewals → altoc-feedback | 销售、投标、协议、工单、续约、反馈；旧维保/权益只读 |
| 11–14 | finance-B3 → finance-13a → finance-13b → finance-cost | 参数/账户、财务主链/结算、成本域 |
| 15–17 | altoc-due → finance-due → people-due | 源事实先就绪；每域checkpoint/cursor/audit三表，安装不启用通知 |
| 18 | aims-portfolio-members | 若已存在规范映射/两表则不重复安装；原Aims unified保护 |
| 19 | w1-finance-legal-entity | 法人主体 |
| 20–21 | w1-finance-balance-entry → w1-finance-balance-columns | 余额登记与快照列 |
| 22 | finance-bank-account-columns | 账户列/索引；新装已满足时仅确认差集，不重复新增secret_ref |
| 23–25 | w1-altoc-customer-columns → w1-altoc-contact-columns → w1-altoc-customer-snapshot | 客户主联系人FK与联系人等级；全量引用预检 |
| 26–27 | w1-altoc-contract-columns → w1-altoc-contract-snapshot | 历史合同列/CHECK/税率NULL允许及不可变源快照 |
| 28 | w1-migration-ledger | 六表mig_batch/step/source_row/object_map/identity_map/exception |
| 29 | altoc-receivables | 单表altoc_collection_event，B5-A催收事实；与opening计划不是同一操作 |

普通列/索引使用声明INPLACE/NONE；受审FK/CHECK使用COPY/SHARED，不自动降级。记录MySQL实际版本、算法、耗时及metadata锁预算。Registry/mapping_hash不因列子集改变；表定义/列声明独立绑定reviewHash和receipt。generation不手工加一。

### 6.3 配套构建与运行

Linux/x86_64构建机，Node与`.nvmrc`一致（24.18.0），pnpm frozen lock，不传入秘密；使用production `node-server`，**不以Nuxt dev运行生产**。

```sh
node deploy/self-hosted/build.mjs --commit "$RELEASE_SHA" --version "$RELEASE_NAME" \
  --out "$BUILD_OUT" --apps console,workflow,aims,codocs,collab,enterprise,gateway
```

### 6.3a 不属于domaininstall的配套schema/业务初始化

- 本轮生产只读schema清单确认 `aims_milestones.billing_schedule_code` 缺失；必须在Altoc项目履约启用前，单独P09批准 `aims/docs/migration_v6.0_milestone_billing_schedule.sql`，随后配对 `_verify.sql` PASS。它同时刷新管理兼容视图 `milestones`；不能只加物理列遗漏视图。已有payment_term_id不无依据回填。回滚须该列全NULL/索引归属成立，使用配对 `_rollback.sql`，不触碰Aims旧行。
- Workflow业务配置不由domaininstall创建：P21逐份差异审查 `altoc/docs/sql/APF12-Workflow-Seed-candidate.sql`、`people/docs/sql/APF-Assignments-Workflow-Seed-candidate.sql`、`finance/docs/sql/apf11b-workflow-seed-candidate.sql`、`apf13a-workflow-seed-candidate.sql`、`apf13b-workflow-seed-candidate.sql` 及各自配对verify（如有）。保持现用hzy_workflow，不随手迁库；仅任职、报价/合同、已交付Finance闭集，不新增绩效/入职/离职审批。
- Altoc销售阶段 `altoc/docs/migrations/APF-B2-sales-stage-seed-candidate.sql` 是初始化事实，不是只建表；P21单列，先查已有code/版本、无重复/覆盖。其它参数初始值须按实际页面可用性审查，不用合成测试夹具填生产。
- Codocs项目目录/portfolio索引对账、三份20261005→20261006→20261007 schema仅按已有生产执行记录与规范verify判定缺失；重新执行写入或对账apply同样P09/P21单独批准，不因为本文件引用旧runbook自动重跑。

同一SHA构建Runtime、hzy-enterprise-add-apf、hzy-wizbiz-migrate与同SHA runner。verify.mjs/manifest/index包hash、所有相对import、.output入口与动态route/chunk必须完整；无deploy源码遗漏、无macOS @fs路径。不能只用SSR入口3×200作为通过。生产Runtime渠道使用stable-prod与精确版本安装护栏；主机update_mode/timer按审批冻结，测试不受影响。

`release.mjs`会逐app restart，不用于迁移尚未完成的提前发布。P14中按受审停止/启动编排装包、原子current切换，最后才启动：Runtime → Console → Workflow → Aims → Codocs → Collab → Enterprise → Gateway。逐个ready后继续；冷启动预算和动态模块探针来自副本实测，失败停下。

## 7. WizBiz 主迁移、真实Vault与opening

### 7.1 输入、账号及同SHA副本

固定封存 `20261004T173356Z`，SQL字节58,037,313，原SQL SHA=`f3edc77ee322bf5a6ce169acaa28f21cc3cdb98070957a50fc5fdb7dc61e36da`（W0 §2.1）；不要重新读在线OA替换输入。解密参数必须：

```sh
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -d \
  -in "$SEALED_SQL" -pass file:"$PROTECTED_KEY"
```

仅管道到全流SHA/字节数检查或隔离暂存MySQL；`set -euo pipefail`，不得明文落地/日志/OSS。恢复和source账号先在停机前完成。source账号按批次派生、创建前断言不存在；source/metadata同库SELECT-only，目标闭集DML及登记表SELECT，Directory仅ReadDirectory两表SELECT，无schema级DML/DDL/GRANT OPTION。不能把本地248条原样作为生产授权，必须从最终SHA CheckTargetPrivileges闭集派生核对。

生产只读备份恢复到独立回环mysqld（不同端口、`--no-defaults`、非公开绑定），用**与正式窗口完全相同的编排脚本和制品，只替换目标参数**跑W1→两账号→全部身份预检→stage/plan→apply→verify→opening/upgrade→rollback。记录runner、工具、schema、应用包SHA，正式窗口禁止改脚本后沿用PASS。生产profile/sysdb/Registry外部ID快照需要重新plan，不复用hzy0 reviewHash。

副本synthetic/forbidden Vault不能充当real写入证明；real路径用合成账户+隔离测试密钥证明行为。禁止读取生产主密钥内容、生成替代生产密钥或让副本回调生产服务。真实库只在批准窗口写入。

### 7.2 迁移值与ID门禁

保留已裁定无损映射：stars=0→NULL、1..6原值；account_sn=NULL→sort_no=0；跨客户contact关联置NULL并入异常闭集；is_third_party按代码明确语义映射；占位ba_id=0余额不造银行账户；全部源值在mig_source_row保全。未知表/未知值、字段覆盖不足、编码冲突、金额校验、非employee身份事实等仍阻断。

工具编码CU/CN/CT/BA/ENT-W+源主键十进制至少6位，超长不截断。secretRef=`hzybase://vault/finance.bank-account.<账户code>.account-no`。生产新数字ID起点为max(目标表MAX(id),全部登记外部引用MAX)+1，冻结引用快照和分配顺序进入plan/reviewHash，apply前再验。verify证明不与迁移前悬空引用相交；不修改Aims旧行、不改AUTO_INCREMENT。

```sh
base=(--profile "$TOOL_PROFILE" --snapshot-manifest "$SNAPSHOT_MANIFEST" \
  --identity-confirmed "$IDENTITY_CONFIRMED")
"$TOOL" --mode stage-verify "${base[@]}" --out "$RUN/stage.json"
"$TOOL" --mode stage-transform-audit "${base[@]}" --out "$RUN/transform.json"
# 全类别blocker=0后；生产停机/全身份预检PASS；新0600独占输出。
"$TOOL" --mode plan "${base[@]}" --stage-receipt "$RUN/stage.json" --out "$RUN/plan.json"
# P11批准该reviewHash后：
"$TOOL" --mode apply "${base[@]}" --plan "$RUN/plan.json" \
  --review-hash "$MAIN_HASH" --out "$RUN/apply.json"
"$TOOL" --mode verify "${base[@]}" --plan "$RUN/plan.json" \
  --review-hash "$MAIN_HASH" --out "$RUN/verify.json"
```

目标Runtime构建/祖先证据必须包含历史合同护栏；所有门禁错误只脱敏子原因码。确认源stage和transform PASS不代替目标plan。main verify逐对象/字段/金额、24类变异、回放/续行/rollback、黄金向量均须同SHA副本PASS。

### 7.3 真实银行账号

建议主迁移synthetic与real升级拆成独立reviewHash：副本已证明受控vault-upgrade恢复/回滚后，生产先完成主迁移验证，再请求P12批准 **prod/具体批次**。若用户选择主迁移直接real，也必须在profile approval中明确prod/batch，重新plan/彩排，不默认为已获批。

受控命令为 `vault-upgrade-plan/apply/verify/rollback`，输入原main plan、原Runtime配置、受审followup-audit与环境批准记录；不改源台账/原main reviewHash。只对已迁移账户synthetic秘密做受控升级。读取源account_number列的SELECT临时授权单列P06，完成即REVOKE并SHOW GRANTS核对。Vault必须复用Runtime既有配置/env/Keychain解析口径；生产配置已报告vault可用，但工具解析仍须预检，不把hzy0绝对路径复制到生产。

明文只留进程内存，最多报告尾4位；首尾TrimSpace与Console同口径，内部不变；trim_applied仅标记/计数，原值留加密快照。验证使用Runtime密钥派生HMAC冻结，禁止无盐hash。升级失败不手工改secretRef/账本；工具probe/status后按原reviewHash恢复或回滚。

### 7.4 期初应收

用户2026-10-06裁定可替代财务确认，来源闭集 `user_ruling_snapshot` 与原 `finance_confirmation` 并存。**生产apply另需P13**，日期/来源/口径不是生产写入授权。

以封存日为截至日，从老OA事实派生受保护确认集；有效金额不扣税等严格复用W1/W2公式，禁止用旧缓存冒充新经营事实。`OpeningRulesVersion=w1-opening-receivable.v1`；确认集记录快照SHA、manifestSHA、裁定日期、逐合同/客户关系，公开报告仅客户数/合同数/金额汇总。hzy0曾得到139合同/103客户/19,989,184.22，仅作同源参考，不能替代生产身份映射与新reviewHash。

```sh
"$TOOL" --mode opening-derive "${base[@]}" --plan "$RUN/plan.json" \
  --opening-confirmation "$USER_RULING_INPUT" --out "$RUN/opening-confirmation.json"
"$TOOL" --mode opening-plan "${base[@]}" --plan "$RUN/plan.json" \
  --opening-confirmation "$RUN/opening-confirmation.json" --out "$RUN/opening-plan.json"
# P13批准OPENING_HASH后：
"$TOOL" --mode opening-apply "${base[@]}" --plan "$RUN/plan.json" \
  --opening-confirmation "$RUN/opening-confirmation.json" --opening-plan "$RUN/opening-plan.json" \
  --review-hash "$OPENING_HASH" --out "$RUN/opening-apply.json"
"$TOOL" --mode opening-verify "${base[@]}" --plan "$RUN/plan.json" \
  --opening-confirmation "$RUN/opening-confirmation.json" --opening-plan "$RUN/opening-plan.json" \
  --review-hash "$OPENING_HASH" --out "$RUN/opening-verify.json"
```

若main之后已有正式用户变更，先只读归因：用户、时间、正式receipt/audit一致才允许followup基线；无审计差异阻断，不修改hash使其通过。opening/real升级各自计划独立冻结当前基线。

## 8. Collab 启用顺序

本轮只读确认六表和部门列已存在，**不再预设需要执行三份ALTER**。P09只安装canonical verify证实缺失的对象/约束；已装部分需要原安装记录与定义完全一致，否则停下。DDL顺序仍为20260920 document_snapshots →20260924 document_collaboration_sessions →20260929 department_collaboration，完整文件服务端解析，verify PASS才下一步。

复用上述既有Collab执行单：

1. P14/P05：正式Platform登记C000001-collab、Console collab.runtime身份与两条精确grant、受保护credential；部署单元监听127.0.0.1:31007。不得持DB/OSS/Vault秘密，不用旧静态Runtime token。
2. `check-collab-deployment.mjs` 校对Platform/Gateway/G-7/Runtime binding均C000001-collab；登记实际prod身份不借hzy0 test别名。
3. P16：快照桶“版本ID+写一次条件”两项实测PASS_BOTH；必要时copy-staging前缀1天过期也单独列配置批准，不顺带执行。
4. P17：Runtime snapshotV2Enabled/collaborationV2Enabled、Gateway apps.collab/ws与入口nginx，最后Enterprise `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2`、`HZY_ENTERPRISE_CODOCS_COLLABORATION_V2`、`NUXT_PUBLIC_CODOCS_COLLABORATION_V2` 对齐开启。生产运行时public override不可只靠构建时值。
5. 个人协作正式双Chrome验证通过后P18：Runtime departmentCollaborationV2Enabled及Enterprise `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2`、`NUXT_PUBLIC_CODOCS_DEPARTMENT_COLLABORATION_V2` 对齐。
6. 只读metadata核对head/candidate/version、成功发布、断线重连、撤权≤30s续租窗口及90s租约，超出门限不放行。正文/对象key秘密不出报告。

停止/关闭Collab不能删已经生成的权威快照。generation>0后不能回到旧正文覆盖路径；按原执行单兼容停写而不是盲目关闭snapshot权威读取。

## 9. 验收、回滚与观察

### 9.1 验收（标记写入另批P19）

| 族 | 必验 |
| --- | --- |
| 版本/健康 | 七件同SHA、Runtime配套commit；Runtime所有启用域DB健康；匿名service401、合法调用命中固定路由；3×入口与动态模块/chunk、60秒无重启/reload |
| 人员授权 | prod包验签/tenant/env/deployment/revision，三域允许/拒绝scope；view不升级管理、敏感字段白名单，无权限不泄露计数；test环境摘要不变 |
| Altoc | 客户/联系人/线索/商机/报价/合同/履约/工单/续约/知识/反馈/应收；历史合同护栏；B5-A assign/set-due-date/followup及权限反例 |
| Finance | 法人/账户脱敏及独立reveal门槛、余额历史/最新、开票/回款/核销/成本；不把余额当收入、不重复opening |
| People | employee/任职/岗位职级/成本/私密/HR/离职范围；冻结审批恢复同实例、正式回调、不接受浏览器approve；手工候选自动开通失败关闭 |
| WizBiz | 全字段/台账、ID不碰存量引用、异常闭集、合同金额、余额快照、真实Vault和opening分别verify；重放无重复对象 |
| 后台 | Directory实际投递、pending/bind、摘要回写、到期与死信、通知purpose详情；原键恢复、ack/fail版本栅栏，目标端幂等，不并行重复drain |
| Collab | 双Chrome并发编辑、断线、快照/版本、撤权；个人与部门分别验，不影响既有文档ACL |
| UI | 正式生产迁移数据1440/390，客户名称、金额来源、服务器筛选/排序、完整分页/总数/每页数量、紧凑详情和选择器、手动刷新、无chunk404/横溢出/console错误 |

### 9.2 分层回滚

- 未写业务数据：关闭新owner/入口写入，用各段原config/plan/proposed/receipt/hash **实际安装逆序**回滚；不用新版工具认领旧对象。新空表/列默认值/基线不漂移才能DROP；有数据或FK即停。
- 主迁移失败：保持Runtime和投递冻结；若opening/upgrade已执行，按副本验证的补充阶段逆序先撤回，再主rollback。工具审计/台账保留，不直删mig_、不改reviewHash、不补UPDATE“修状态”。
- 应用失败：退回本批原始链接/Runtime二进制/配置与schema兼容版本，不能将已写APF数据配到旧禁用/缺schema路径；旧Runtime0.3.225能否读新增配置须彩排，不保证可以直接启动。
- 政策失败：正式撤回事实并签更高prod revision，Console同步，不能拷旧39包或改快照行绕过单调校验；test保持46事实不变。
- Collab已有权威generation：保留heads/versions/OSS，禁新编辑和票据但不DROP；按已有Runbook恢复兼容读取。不使用数据库全库旧备份覆盖上线后业务。
- 主业务解冻后发生故障：停止相关写入/owner、取新证据，走前向修复或经批准的数据保留恢复。生产备份恢复也是独立写入动作，需用户批准，不“失败即自动覆盖全库”。

记录开始/结束、已批准编号、每段reviewHash/receipt/verify数量、耗时、备份SHA、原/新版本与失败阶段。上线后72小时观察owner唯一性、pending最老年龄、attempt/abandoned、依赖阻塞、callback、Directory部分成功、Collab连接/发布/撤权及日志脱敏；callback abandoned造成in_review卡住按有界投递Runbook4小时内处理，破窗使用受审工具单独批准。

## 10. 原全量方案停止关口（阶段一以 §0 为准）

1. 候选推荐角色明确减少 finance:accountant 的bank_accounts:edit、receipts:confirm、reconciliation:confirm，以及people:admin的assignments/cost_snapshots/performance_cycles/standard_costs四项approve；这是职务分离候选变化，不是已经批准的生产撤权。共享租户存在39条验收角色范围，现有编译会将其带入新prod包；签prod前须按附录A.4经正式路径停用验收角色，不能删改payload。用户尚未批准本轮任一生产写入；先审阅附录A人员权限变化，尤其新增角色和默认scope，不能复制hzy0用户分配。
2. 最终Runtime正式版本/应用release名/窗口时长、production迁移profile/runner/账号闭集、各grant精确差集尚待冻结；本文件不是可以直接自动运行的万能脚本。
3. 生产Collab表已装，但完整verify/桶PASS_BOTH、登记/凭据/单元/WS未齐；不能跳过。
4. 人员角色推荐差异与实际租户权限差异分开。当前DB未签变更可能进入下一prod包，必须审批编译结果完整diff；本轮未调用生成API（会写入），不可声称新prod包已预览通过。
5. 不在本轮顺带实施People绩效迁移、LDAP/邮箱新停用合同、APF产品反馈owner迁移、B5-B未审增量或其他新授权口径。

## 附录 A. prod revision39 → 当前候选的 APF/W3/B5 差异清单

本附录 APF 变化全部列入阶段二；阶段一不照此表授予。以下单列推荐角色删除项（非阶段一已执行撤权）：

| 角色 | 删除权限 | 阶段 |
| --- | --- | --- |
| finance:accountant | finance:bank_accounts:edit | 二 |
| finance:accountant | finance:receipts:confirm | 二 |
| finance:accountant | finance:reconciliation:confirm | 二 |
| people:admin | people:assignments:approve | 二 |
| people:admin | people:cost_snapshots:approve | 二 |
| people:admin | people:performance_cycles:approve | 二 |
| people:admin | people:standard_costs:approve | 二 |


数据来源：prod bundleId=40、revision=39、hash=`sha256_f63ae58aec660f29a7e14fb7f4a86d0b7899249790a05afe87d61fbeebbf7c47`；候选三个 `app.manifest.json` 取冻结代码。全部按 app/resource/action、role/permission 集合比较，避免 JSON 排序造成假差异。此附录是**受审候选目录/推荐角色差异**，不是自动赋权；实际签发前另审完整生成包中的有效角色、scope、模板与分配变化。

分类：A=APF业务人员动作；W3=迁移/财务事实；B5=应收办理；S=机器服务动作，不直接加入人员角色；R=新增推荐角色；P=范围或模板变化需单独审。

### A.1 资源/动作全集差异

| 域 | 旧/新资源数 | 旧/新动作数 | 新增/删除动作 |
| --- | --- | --- | --- |
| altoc | 9/17 | 29/66 | +37/−0 |
| finance | 10/16 | 34/52 | +18/−0 |
| people | 13/13 | 39/39 | +0/−0 |

| 域 | 资源 | 新增动作 | 分类 |
| --- | --- | --- | --- |
| altoc | `contract` | `activate-delivery` | A |
| altoc | `contract` | `close` | A |
| altoc | `contract` | `finance-summary:sync` | S |
| altoc | `customer` | `approve` | A |
| altoc | `integration_operation` | `execute` | S |
| altoc | `integration_operations` | `replay` | A |
| altoc | `integration_operations` | `view` | A |
| altoc | `lead` | `activity` | A |
| altoc | `lead` | `assign` | A |
| altoc | `lead` | `convert` | A |
| altoc | `lead` | `disqualify` | A |
| altoc | `maintenance_contract` | `admin` | A |
| altoc | `maintenance_contract` | `edit` | A |
| altoc | `maintenance_contract` | `view` | A |
| altoc | `migration_exceptions` | `resolve` | W3 |
| altoc | `migration_exceptions` | `view` | W3 |
| altoc | `opportunity` | `activity` | A |
| altoc | `opportunity` | `assign` | A |
| altoc | `opportunity` | `transition` | A |
| altoc | `product-feedback` | `update-progress` | S |
| altoc | `product-feedback` | `update-status` | S |
| altoc | `receivable` | `assign` | B5 |
| altoc | `receivable` | `followup` | B5 |
| altoc | `receivable` | `mark-billable` | A |
| altoc | `receivable` | `set-due-date` | B5 |
| altoc | `renewal_opportunity` | `admin` | A |
| altoc | `renewal_opportunity` | `edit` | A |
| altoc | `renewal_opportunity` | `view` | A |
| altoc | `service_entitlement` | `admin` | A |
| altoc | `service_entitlement` | `edit` | A |
| altoc | `service_entitlement` | `view` | A |
| altoc | `service_ticket` | `admin` | A |
| altoc | `service_ticket` | `close` | A |
| altoc | `service_ticket` | `delivery-result:sync` | S |
| altoc | `service_ticket` | `edit` | A |
| altoc | `service_ticket` | `reopen` | A |
| altoc | `service_ticket` | `view` | A |
| finance | `bank_accounts` | `reveal-account-no` | W3 |
| finance | `integration_operations` | `replay` | A |
| finance | `integration_operations` | `view` | A |
| finance | `invoices` | `issue` | A |
| finance | `legal_entities` | `admin` | W3 |
| finance | `legal_entities` | `edit` | W3 |
| finance | `legal_entities` | `view` | W3 |
| finance | `migration_exceptions` | `resolve` | W3 |
| finance | `migration_exceptions` | `view` | W3 |
| finance | `product-cost` | `read` | S |
| finance | `product-cost` | `read-rules` | S |
| finance | `product-cost` | `replace-rules` | S |

三个域无资源/动作删除，**但推荐角色有7项权限删除**（下表），须明确批准，不能按仅新增自动发布。People manifest动作未增加，但审批推荐角色有变化；动作集合不变不等于角色授权不变。服务动作保留目标端精确client/委托/范围检查，不因catalog发布赋予普通用户机器权限。

重新派生基线：`bf151ebc790f999f387af037ed98ebf0fd6f3f5c`；相对 prod39：Altoc +8 资源/+37 动作，Finance +6 资源/+18 动作，People 0；三域动作删除 0，19 个推荐角色变化，推荐权限删除 7。阶段一这些新增/推荐角色变化全部推迟签入。

B5-B 新增六动作：`finance:historical_finance:view/activate`、`finance:receivable_adjustments:view/edit/confirm/reverse`。`finance:manager` 新增 historical_finance:view/activate 与 receivable_adjustments:view/confirm/reverse；`finance:admin` 新增 historical_finance:view 与 receivable_adjustments:view/edit。它们均属阶段二。下表原其余变化继续有效。

### A.2 推荐角色逐项权限变化

| 域 | 角色 | 分类 | 新增人员权限（完整码） | 删除权限 | 候选默认scope |
| --- | --- | --- | --- | --- | --- |
| altoc | `altoc:viewer` | 既有推荐角色 | `altoc:maintenance_contract:view`、`altoc:renewal_opportunity:view`、`altoc:service_entitlement:view`、`altoc:service_ticket:view` | 无 | 未声明（不推导global） |
| altoc | `altoc:sales` | 既有推荐角色 | `altoc:lead:activity`、`altoc:lead:assign`、`altoc:lead:convert`、`altoc:lead:disqualify`、`altoc:opportunity:activity`、`altoc:opportunity:assign`、`altoc:opportunity:transition` | 无 | 未声明（不推导global） |
| altoc | `altoc:customer_success` | R（新增，未分配） | `altoc:contract:view`、`altoc:customer:view`、`altoc:dashboard:view`、`altoc:maintenance_contract:edit`、`altoc:renewal_opportunity:edit`、`altoc:service_entitlement:edit`、`altoc:service_ticket:close`、`altoc:service_ticket:edit`、`altoc:service_ticket:reopen` | 无 | 未声明（不推导global） |
| altoc | `altoc:contract_manager` | 既有推荐角色 | `altoc:contract:activate-delivery`、`altoc:maintenance_contract:edit`、`altoc:receivable:assign`、`altoc:receivable:followup`、`altoc:receivable:set-due-date`、`altoc:renewal_opportunity:view` | 无 | 未声明（不推导global） |
| altoc | `altoc:contract_approver` | 既有推荐角色 | `altoc:customer:approve`、`altoc:customer:view`、`altoc:maintenance_contract:view`、`altoc:renewal_opportunity:view`、`altoc:service_ticket:view` | 无 | 未声明（不推导global） |
| altoc | `altoc:admin` | 既有推荐角色 | `altoc:contract:activate-delivery`、`altoc:contract:close`、`altoc:dashboard:export`、`altoc:integration_operations:replay`、`altoc:integration_operations:view`、`altoc:lead:activity`、`altoc:lead:assign`、`altoc:lead:convert`、`altoc:lead:disqualify`、`altoc:maintenance_contract:admin`、`altoc:migration_exceptions:resolve`、`altoc:migration_exceptions:view`、`altoc:opportunity:activity`、`altoc:opportunity:assign`、`altoc:opportunity:transition`、`altoc:receivable:assign`、`altoc:receivable:confirm`、`altoc:receivable:followup`、`altoc:receivable:set-due-date`、`altoc:renewal_opportunity:admin`、`altoc:service_entitlement:admin`、`altoc:service_ticket:admin`、`altoc:service_ticket:close`、`altoc:service_ticket:reopen` | 无 | 未声明（不推导global） |
| finance | `finance:expense_submitter` | R（新增，未分配） | `finance:dashboard:view`、`finance:expenses:edit`、`finance:expenses:view` | 无 | `[{"scope":"subject:self","resourceCode":"expenses"}]` |
| finance | `finance:ar_accountant` | R（新增，未分配） | `finance:dashboard:view`、`finance:invoices:edit`、`finance:receipts:edit`、`finance:reports:view` | 无 | 未声明（不推导global） |
| finance | `finance:invoice_issuer` | R（新增，未分配） | `finance:dashboard:view`、`finance:invoices:issue`、`finance:invoices:view` | 无 | 未声明（不推导global） |
| finance | `finance:ap_accountant` | R（新增，未分配） | `finance:dashboard:view`、`finance:expenses:edit`、`finance:reports:view` | 无 | 未声明（不推导global） |
| finance | `finance:cashier` | R（新增，未分配） | `finance:bank_accounts:edit`、`finance:bank_accounts:view`、`finance:dashboard:view`、`finance:expenses:confirm`、`finance:expenses:view`、`finance:legal_entities:view`、`finance:receipts:confirm`、`finance:receipts:view` | 无 | 未声明（不推导global） |
| finance | `finance:accountant` | 既有推荐角色 | `finance:bank_accounts:view`、`finance:legal_entities:view`、`finance:reconciliation:edit` | `finance:bank_accounts:edit`、`finance:receipts:confirm`、`finance:reconciliation:confirm` | 未声明（不推导global） |
| finance | `finance:reconciliation_operator` | R（新增，未分配） | `finance:dashboard:view`、`finance:invoices:view`、`finance:receipts:view`、`finance:reconciliation:confirm`、`finance:reconciliation:edit`、`finance:reports:view` | 无 | 未声明（不推导global） |
| finance | `finance:invoice_approver` | R（新增，未分配） | `finance:dashboard:view`、`finance:invoices:approve`、`finance:invoices:view` | 无 | 未声明（不推导global） |
| finance | `finance:manager` | 既有推荐角色 | `finance:dashboard:export`、`finance:legal_entities:admin` | 无 | `["tenant:global"]` |
| finance | `finance:report_viewer` | R（新增，未分配） | `finance:dashboard:export`、`finance:dashboard:view`、`finance:performance:view`、`finance:project_accounting:view`、`finance:reports:export`、`finance:reports:view` | 无 | 未声明（不推导global） |
| finance | `finance:admin` | 既有推荐角色 | `finance:bank_accounts:reveal-account-no`、`finance:dashboard:export`、`finance:integration_operations:replay`、`finance:integration_operations:view`、`finance:legal_entities:admin`、`finance:migration_exceptions:resolve`、`finance:migration_exceptions:view`、`finance:reports:export` | 无 | `["tenant:global"]` |
| people | `people:approver` | 既有推荐角色 | `people:standard_costs:approve`、`people:standard_costs:view` | 无 | 未声明（不推导global） |
| people | `people:admin` | 既有推荐角色 | 无 | `people:assignments:approve`、`people:cost_snapshots:approve`、`people:performance_cycles:approve`、`people:standard_costs:approve` | 未声明（不推导global） |

未发生权限集合增删的推荐角色：`finance:viewer`、`finance:expense_approver`、`people:viewer`、`people:employee`、`people:department_manager`、`people:specialist`、`people:manager`、`people:performance_manager`、`people:compensation_admin`、`people:directory_admin`。

默认scope列只说明候选manifest声明，不说明prod有效scope已改变。尤其 finance:expense_submitter 的 subject:self 和 manager/admin 的 tenant:global，需要对比源推荐模板、override及实际分配，不能用新角色覆盖现有收窄范围。编译前/后 scopeType/scopeValue、角色继承、通配、admin蕴含及模板绑定逐项归档；变化归P类另批。

### A.3 实际租户自定义权限与未签事实

本轮只读，三个域当前 tenant_role_permissions 共19条，prod39中的custom授权共19条；按角色/app/resource/action比较新增0、删除0。没有把后续test签包误认为prod已更新。

| 项目 | 核查结论 / 待审要求 |
| --- | --- |
| 自定义权限 | 当前19条与prod39逐键相同；保留原事实，不以推荐角色替换 |
| 当前三域范围行 | 39条；仍需按实际编译引用链逐项比对，不能从数量推导生效 |
| 后续test政策 | revision46不作为prod新版本号或prod权限来源 |
| 新推荐角色 | 正式发布生成目录与实际授予用户是两件事；新增分配逐项用户批准 |
| 非APF模块 | Platform全量生成可能包含rev39后其它变更；生成前先冻结技术diff，非目标变化须单列，不默认接受 |
| 签包最终门禁 | 若实际prod编译结果包含本表外权限/范围变化或任何意外删除/降权，停止签发/应用；不能仅检查manifest新增数 |

### A.3a 共享租户中的未签范围事实（P类，签prod前停止关口）

prod39的三域roleDefaultScopes为0条，当前三域tenant_role_scopes有39条。它们属于两个验收用角色；**不得根据角色名前缀认定只影响test**。签prod前须按正式编译引用链确认这些事实是否进入prod包、是否有有效人员分配，并由用户裁定保留/排除/清理；本轮不改角色、范围或分配。

| 角色技术码 | 域 | 范围 | 当前状态 | resource:action全集 |
| --- | --- | --- | --- | --- |
| `apf_sod_test_20261003` | altoc | `tenant:global` | active | `contract:approve`、`contract:view`、`customer:approve`、`customer:view`、`dashboard:view`、`maintenance_contract:view`、`quotation:approve`、`quotation:view`、`receivable:view`、`renewal_opportunity:view`、`service_ticket:view` |
| `apf_sod_test_20261003` | finance | `tenant:global` | active | `bank_accounts:view`、`dashboard:view`、`expenses:approve`、`expenses:confirm`、`expenses:view`、`invoices:approve`、`invoices:issue`、`invoices:view`、`receipts:confirm`、`receipts:view` |
| `apf_sod_test_20261003` | people | `tenant:global` | active | `assignments:approve`、`assignments:view`、`cost_snapshots:approve`、`cost_snapshots:view`、`dashboard:view`、`documents:view`、`employees:view`、`offboarding_tasks:view`、`performance_cycles:approve`、`performance_cycles:view`、`standard_costs:approve`、`standard_costs:view` |
| `apf_sod_zhou_reconcile_20261004` | finance | `tenant:global` | active | `dashboard:view`、`invoices:view`、`receipts:view`、`reconciliation:confirm`、`reconciliation:edit`、`reports:view` |

这是当前表事实与旧包的候选差异，不能据此断言全部39条必然会生效。新增scope、模板/推荐角色扩展、人员分配与服务grant分别审，不把“prod只增revision”误解成“可以复制test权限”。

### A.4 审批回执应包含的技术数据

- 各app发布前/后manifestId、releaseId、commitSha和语义hash；推荐目录新增与实际租户授予分开。
- 每个新增角色/permission/scope的审批编号；非APF差异明示保持/拒绝/另审。
- prod旧revision39及新revision、bundleHash、各部署验签/应用状态；test46及其包/非目标行摘要不变。
- 用户有效快照通过Foundation唯一scoped evaluator复核；角色名存在不代表动作可用。

## 11. 本轮回执

只新增本执行方案；生产SSH/DB均只读，未签包、未写库/grant/Vault、未停服务或启用Collab。未连接hzy0数据库或切换hzy0，B5-B与其它候选切换保持独立协调。技术证据只记录数量、结构/角色动作码及hash，无客户名、个人信息、银行账号或凭据。

文档校验：相对链接、29个安装子集与源码闭集、显式工具/SQL路径、CLI模式/参数及git diff --check通过；未运行会写生产的plan/verify/签发探针，不以文档检查代替副本/生产验收。


### A.4 39 条验收范围的编译引用链与正式排除方案

2026-10-06 只读核查：租户 `C000001` 的角色 `132 / apf_sod_test_20261003` 为 active、可分配，存储范围 33 条；角色 `133 / apf_sod_zhou_reconcile_20261004` 为 active、可分配，存储范围 6 条。prod 当前 revision=39，test=46。下述方案尚未执行。

`buildPolicyBundlePayload`（`platform/server/utils/policyBundle.ts:965`）按环境选择部署，但角色及授权集合仅按租户收集。`collectTenantRoleScopes:573` 通过 active 角色连接收集自定义范围及应用角色映射范围；`buildPolicyBundleV2CompatFields`（`platform/server/utils/policyBundleV2.ts:185`）将其投影为 `roleDefaultScopes`。因此不能认为 test 验收角色天然不会进入 prod。

| 编译入口（policyBundle.ts） | active 角色过滤及关联 |
| --- | --- |
| `collectTenantRoles:508`、`collectRoleHolderRevisions:522` | 角色和角色持有人版本 |
| `collectTenantRolePermissions:539`、`collectTenantRoleScopes:573` | 自定义权限/范围，以及 app-role 映射的两个 UNION 分支 |
| `collectTenantRoleAppRoleMaps:611` | 应用角色映射 |
| `collectSubjectRoles:631`、`collectSubjectRoleScopes:656` | 人员分配与分配级范围 |
| `collectTemplateRoles:705`、`collectTemplateOverrides:747` | 模板角色和模板覆写；保留的模板绑定不再连到被停用角色 |

**待批准 P03-R132、P03-R133：正式退役两个验收角色。** 由租户 owner 在已登录 Platform 会话经 `PATCH /api/platform/tenant-admin/roles/132`、`/133` 各提交 `{ "status": "disabled", "isAssignable": false }`。该处理器使用 `requireTenantOwnerForTenantAdmin`，核对角色属于当前租户；不使用 SQL 修改，不删除范围/权限/分配记录，也不在签发后过滤正文。

执行前后通过正式读取核对角色、范围/权限/分配/模板关联技术摘要，保存请求回执及操作者审批关联记录。角色 PATCH 本身不签新包：随后经 P04 的正式 `generatePolicyBundle(environment=prod)` 编译。新的授权事实摘要改变，使旧已签正文不满足复用条件；新 prod revision 必须严格递增。签名前检查上述两个角色在 roles、rolePermissionGrants、roleDefaultScopes、roleAssignments、assignmentScopes、templateRoles、templateOverrides、roleAppRoleMaps 中均为零引用；39 条原始范围记录继续保留。

**影响与回滚：** 这是租户级角色退役，不是环境级过滤。今后重新生成 test 包也会排除它们；已签 test=46 不在本步骤重新签发。测试是否需要替代正式角色由用户另行决定，不能为保留验收角色而改写 prod payload。回滚须经相同正式 PATCH 恢复原状态和可分配性，再根据影响环境签更高版本；不能将 prod revision 倒退，也不能在生成 prod 前偷偷恢复角色。

测试：`node platform/scripts/test-acceptance-role-exclusion-mysql.mjs` 在一次性回环 MySQL 中执行 AST 抽取的真实收集 SQL和真实 owner PATCH 处理器；覆盖未授权/跨租户拒绝、39 范围排除、custom/app-role/assignment/template 全链过滤、正常角色保留、源记录不删除、prod/test V2 投影无泄漏、系统继承刷新不复活停用角色及旧正文复用失效。未替换编译 SQL、未增加业务过滤开关。

## 11. 原全量准备跟踪（历史状态；阶段一以 §0/§13 为准）

本轮原则同意上线不等于批准生产写入。完成以下关口后，再提交 P01–P21 的最终批准表与具体 hash：

| 准备项 | 当前状态 |
| --- | --- |
| 39 条验收范围 | 正式退役方案与隔离 MySQL 回归已完成，角色未修改 |
| B5-B 基线 | 等待 sol2 合入；当前附录仍是 §1 的旧冻结候选，不能用于最终签包 |
| 生产副本输入 | hzy_ro_audit 表/视图加密导出中；不具备 TRIGGER 权限，不能冒称含 trigger/routine/event 的全量灾备 |
| 同 SHA 全链彩排 | 尚未执行；按 2026-10-06 用户裁定，在 macOS 独立 MySQL 副本完成全部数据层步骤，不安装 VM。systemd 停启未彩排，改为执行单逐条桌面核对；生产停止证据护栏保持不变 |
| 逆序回滚 | opening → 主迁移 → 安装子集逆序；迁移保留不可变台账，非空时安装器禁止 DROP。须在彩排中记录正式回滚与备份恢复的边界，不能手动删账本以让回滚通过 |
| 停机时长 | 暂无完整实测，不按既有 hzy0 或合成测试耗时估算生产窗口 |
| 回归风险 | 已按用户裁定同步 B5-A assign/set-due-date/followup 严格断言，Platform 全量 364/364、改动 ESLint 通过；提交 `1cb8ebd1`，仅测试变更，manifest/seed/实际权限未改 |

候选新增测试的 ESLint 通过；策略投影、环境版本和角色复制相关测试 13/13 通过。执行制品与 runner SHA、导出 hash、各阶段耗时、最终新增/删除/角色差异及所有 P08/P21 子项将在 B5-B 基线冻结、macOS 数据层副本彩排与 systemd 桌面核对完成后补齐。


## 12. 阶段二原逐项批准草案（不在阶段一执行）

本节目前用于准备，**尚未请求执行批准**。§3 的 P01–P21 全部保留；P08、P03 和 P12 进一步拆成下列子项。B5-B 合入后须重新核对源码闭集，写入完整 SHA、每项 reviewHash、实际差集与副本耗时，不用占位 hash 获得批准。

### 12.1 安装子集

各项先正式 plan，再按受审 reviewHash apply/verify；定义已完整存在的子集标记“只读核验，无需写入”，不重复 apply。`P08-00` 为基础 APF 53 表；以下 29 项逐项批准，不能以“全部安装”代替具体范围。每项实际修改列/表/约束由该项 plan 附件列出。

| 批准号 | 固定 subset |
| --- | --- |
| P08-01 | `people-private` |
| P08-02 | `people-facts` |
| P08-03 | `people-offboarding` |
| P08-04 | `people-hr-source` |
| P08-05 | `altoc-sales-B2` |
| P08-06 | `altoc-tenders` |
| P08-07 | `altoc-services` |
| P08-08 | `altoc-tickets` |
| P08-09 | `altoc-renewals` |
| P08-10 | `altoc-feedback` |
| P08-11 | `finance-B3` |
| P08-12 | `finance-13a` |
| P08-13 | `finance-13b` |
| P08-14 | `finance-cost` |
| P08-15 | `altoc-due` |
| P08-16 | `finance-due` |
| P08-17 | `people-due` |
| P08-18 | `aims-portfolio-members` |
| P08-19 | `w1-finance-legal-entity` |
| P08-20 | `w1-finance-balance-entry` |
| P08-21 | `w1-finance-balance-columns` |
| P08-22 | `finance-bank-account-columns` |
| P08-23 | `w1-altoc-customer-columns` |
| P08-24 | `w1-altoc-contact-columns` |
| P08-25 | `w1-altoc-customer-snapshot` |
| P08-26 | `w1-altoc-contract-columns` |
| P08-27 | `w1-altoc-contract-snapshot` |
| P08-28 | `w1-migration-ledger` |
| P08-29 | `altoc-receivables` |

### 12.2 七项推荐角色权限删除

以下是 prod39 与候选 manifest 推荐角色的差异，不代表已经修改生产租户角色或撤权。每项必须明确“发布推荐定义”及其是否影响现有实际角色/模板引用；不能自动删除独立 tenant custom grant。正式编译后的实际撤权范围另附技术差异。

| 批准号 | 推荐角色 | 删除的 permission |
| --- | --- | --- |
| P03-D01 | `finance:accountant` | `finance:bank_accounts:edit` |
| P03-D02 | `finance:accountant` | `finance:receipts:confirm` |
| P03-D03 | `finance:accountant` | `finance:reconciliation:confirm` |
| P03-D04 | `people:admin` | `people:assignments:approve` |
| P03-D05 | `people:admin` | `people:cost_snapshots:approve` |
| P03-D06 | `people:admin` | `people:performance_cycles:approve` |
| P03-D07 | `people:admin` | `people:standard_costs:approve` |

验收角色正式停用另批 `P03-R132/P03-R133`，不合并计入上述七项推荐权限删除。新增资源/动作、推荐角色增量及实际租户变化仍逐项附在 P02/P03，不按以上七项推断全部差异。

### 12.3 生产真实 Vault

`P12-R` 单独批准：租户 C000001、environment=prod、冻结主迁移批次、Vault 升级 reviewHash、账户数量和 trim_applied 计数、既有 Runtime 主密钥解析口径及受控升级工具 SHA。源明文仅在进程内存；不输出完整账号、主密钥或无盐账号 hash，不写 OSS/Platform。先 synthetic 副本证明完整升级/验证/回滚；本次 synthetic 主链彩排不声称证明真实主密钥解密。

暂存 source 的 account_number 列 SELECT 权限作为 P06 子项另列，real 升级完成后立即撤回并 SHOW GRANTS 核对。hzy0 的逐环境批准不覆盖生产。若生产已有 synthetic 数据须冻结实际受审业务变更基线，不覆盖经审计的修改。

### 12.4 彩排与停机预算附件要求

最终回执须逐步记录开始/结束、耗时、status、工具/runner SHA、安装 reviewHash、主迁移/opening reviewHash、verify 计数与逆序回滚结论。仅输出技术计数与金额汇总，不输出客户名、个人信息或银行账号。冷导出/源快照恢复尽可能在窗口前完成；停机预算的数据部分按副本实测的安装、账号/门禁、plan、apply/verify 合计；启动与动态模块 smoke 仅列预算和安全余量，不记为 systemd 实测。生产写入与回滚批准均限定同 SHA 制品；不得以 Mac 合成安装测试替代 Linux 真实停止证明。


### 12.5 副本逆序回滚的账本边界

主迁移 `ExecuteRollback`（`data-runtime/internal/migrations/wizbiztool/rollback.go:22`）明确保留账本/映射历史；安装器不允许删除非空 ledger。彩排不得以手工 DELETE 或 force 参数清空台账。

拟采用两层回滚证据：安装完成、迁移 apply 前先创建加密 checkpoint；完成 opening/main verify 后，依次执行正式 opening-rollback/main-rollback，验证业务对象和 Vault 回滚、账本历史仍在；再保全回滚后副本的加密证据。仅在隔离副本上恢复该 pre-apply checkpoint，核对安装定义/Registry/配置摘要和空表状态，然后用原 receipt/reviewHash 逐子集逆序 rollback，最后回滚基础 APF。两层耗时分别记录，不能将 checkpoint 恢复称为主迁移工具删除账本。

这是分阶段数据层彩排方案，尚待 macOS 隔离副本落地验证。生产失败恢复仍按 P01/P07 的完整受审备份执行，是否使用任何中间 checkpoint 须单独审批；开用户写入后不能照此恢复，以免覆盖经审计的新业务变更。


### 12.6 systemd 桌面核对与未彩排风险（2026-10-06 用户裁定）

**systemd 停启未彩排。** 不安装 Linux VM，不执行生产停机、重启或回滚。macOS 数据层彩排不能证明 Linux 单元、ExecStart、权限、软链接和依赖传播正确，也不能提供生产安装工具要求的 systemd 停止证明。生产 CLI 的停止护栏不改；隔离测试注入仅证明副本无 Runtime 访问，不能用于生产。

逐条桌面核对须记录冻结制品与现网只读配置的匹配结果，未核对项仍为发布阻断项：

| 核对项 | 风险缓解与上线关口 | 证据边界 |
| --- | --- | --- |
| 停止与自动启动来源 | 列出 Runtime、Gateway、Console、Workflow、Aims、Codocs、Enterprise、Collab 的实际单元及 timer/updater，核对依赖传播；维护窗口逐项确认 disabled/inactive 与端口拒绝，保持 MySQL、Platform、nginx、Tailscale运行 | 桌面检查不记为停机 PASS |
| 逐服务启动顺序 | MySQL 可用 → Runtime 健康与绑定 → Console健康及精确签发 → Workflow/Aims/Codocs/Enterprise各自健康 → Collab健康 → Gateway最后对外；按实际依赖核对单元，不仅依赖 systemctl 返回成功 | 生产启动时逐项执行，失败不继续开放流量 |
| 应用健康门禁 | 核对每个监听地址、路径、所需受信上下文、超时和错误语义；检查 Node入口、Worker装配、软链接解析、受保护配置权限；执行入口及动态模块 smoke，不以首页200替代 | 不能用 macOS 开发进程证明 Linux 制品启动成功 |
| 完整备份恢复命令 | 预检 MySQL/openssl版本与参数、解密全流hash、整文件SQL执行方式、失败即停、目标库列表、defaults/profile权限；列出已加密备份所含及未含 trigger/routine/event | SELECT-only导出不称为完整灾备，正式P01需完整备份 |
| 回滚顺序 | 先冻结用户/机器写入并停应用，再按批准方案恢复数据、配置、链接和Runtime；核对旧版本兼容性，再按依赖顺序启动并检查健康 | 数据层逆序回滚已测与systemd未测分别记录 |

最终批准清单同时附桌面核对结果、未彩排风险、预计启动/回滚余量；不得把停启耗时写成测量值。B5-B 合入后重新冻结同 SHA runner/制品，汇总 P01–P21、安装子集、七项权限删除及生产真实 Vault 的逐项批准表。

## 13. 两阶段修订回执（2026-10-06）

本次只修改执行单并从冻结 SHA 重算权限技术差异，未连接生产、未签包、未改角色、未执行安装/迁移或切换。阶段一批准清单见 §0.6；未完成的短清单为：普通员工有效 APF 权限全链核查、Aims/Codocs 完整权限差集、缩减副本彩排、制品/runner SHA 与实测耗时。上述未通过前不进入生产窗口。

## 14. 获批后的阶段一门禁结果：权限差集停止项

2026-10-06 用户批准 S1-01～S1-12 后，先通过共享 Platform 的只读事务核对已签 prod39 正文；未生成新包、未修改角色、未停生产、未执行 DDL/grant。

- `baselineGrants` 中 Altoc/Finance/People 为 0 项。此事实只证明全员基础授权不包含 APF，不证明所有员工合并授权为零。
- `project_manager` 在 prod39 的 `rolePermissionGrants` 有 6 项 Finance view：`dashboard`、`expenses`、`invoices`、`project_accounting`、`receipts`、`reports`。
- 对应正式映射 `project_manager → finance:viewer` 已存在。项目经理作为面向员工的项目角色，不能因为阶段一保留项目能力就忽略这条 APF 授权。
- prod39 三个 APF moduleAvailability 均为 not-deployed。不能只用这个旧部署状态当作新 Enterprise 组合路径的有效权限零证明。

**停止原因：** 若「普通员工」包括项目经理，阶段一要求 APF 零有效权限将涉及旧 `project_manager → finance:viewer` 映射收窄，至少影响上述 6 项读取；这是新发现的存量降权，按本轮纪律须先报告。它不是附录中阶段二的 7 项推荐角色权限删除，二者不能混为一项。未擅自撤销映射，也未用 payload 过滤、导航隐藏或缺表错误绕过。

待裁定：是否正式移除项目经理的 Finance viewer 映射（保留其 Aims/Workflow/Codocs 等项目职责），或明确阶段一保留这类既有读取的例外。选择保留例外将改变 §0.4 的零有效权限门禁，须重新审阅范围；选择收窄须在正式 Platform 路径冻结实际角色/映射差集及 test 后续影响，再继续完整员工继承链核查。

同 SHA 缩减副本彩排、工具/DDL/grant 冻结尚未完成，不记 PASS。生产窗口未开始；无备份恢复或回滚动作需要执行。

## 15. 快速续行裁定与构建停止记录

协调者确认：保留 `project_manager → finance:viewer` 既有授权；APF 零权限门禁仅检查普通员工 baseline。复用 hzy0 已验证路径，允许跳过缩减副本彩排；加密备份、同 SHA 制品、凭据保护与失败即停仍保留。此前 §14 项目经理停止项已解除，未执行降权。

本轮固定制品源码 `d7f789e5fb95eb284a551a4a9ae9217b61bcc525`，应用 release 候选名 `s4-rc26`。Platform prod39 只读核对：APF baseline grants=0；Aims 人员动作 185→185、Codocs 41→41，新增/删除均 0。未刷新 APF manifest，不签 test。

生产现状只读核对：Runtime 与五个既有应用、tenant Gateway 均运行；Node 24.18.0；根卷可用 48,075,812 KiB、home 可用 380,570,044 KiB。尚未进行生产停机前最终备份或切换。

Linux 构建在共享构建主机的独立 `/wiztek/hzy-test/stage1-20261007/source` 干净检出执行；没有改 Platform 运行目录。`build.mjs` 的离线 frozen-lockfile 安装失败：`ERR_PNPM_NO_OFFLINE_TARBALL`，缺少 `@iconify-json/lucide@1.2.101`。构建 exit=1，未生成可发布的七件同 SHA 制品。日志 `/wiztek/hzy-test/stage1-20261007/build.log`，本地无凭据输出。

按实际失败停止并通知协调者。最小修复：构建机通过锁定 lockfile 补齐所需依赖缓存，再重新运行原同 SHA/offline 构建；不能替换依赖版本或使用 macOS 包发布 Linux。未进入维护窗口，无生产回滚需要；生产 schema/grant/config/链接/二进制均未变。DDL/grant 冻结与全部工具门禁尚未完成，不记 PASS。

## 16. 阶段一续行准备与正式 Collab 登记（2026-10-07）

- 同 lockfile `pnpm fetch --frozen-lockfile` 后哈希一致。构建机 `/wiztek` 与 `/tmp` 分属不同文件系统，pnpm 使用不同 store；将 `TMPDIR` 放到 `/wiztek/hzy-test/stage1-20261007/tmp` 后离线依赖安装通过。Console、Workflow、Aims 已打包；Enterprise 构建发现 People 页面 `~host` 别名缺口，停止制品发布，由 sol2 修复后与凭据命令共同冻结新 SHA。生产尚未停机，不发布半套制品。
- Platform 主机无 `mysqldump`，首次备份未通过，未据此写入。随后使用 mysql2 一致性只读事务逻辑导出（含表/视图定义、完整行），直接加密，解密重算 SHA 并核对结构：104 表/视图、40,895 行、56,823,651 字节，明文流 SHA-256 `dadf6a60d962bc0feaa7f2fc913151bb133ae108ab564e88ae4c18730c994218`。受保护目录 `/wiztek/hzy-test/stage1-20261007/platform-logical-backup`，目录 0700，密钥/加密备份/证据 0600。该逻辑快照不作为可直接交 MySQL 执行的 SQL 文件，恢复须按保留的表定义和类型化行进行，先恢复核验再继续；禁止打印内容。
- 核验备份后，用户已登录 Platform 会话经正式 API：`POST /api/platform/ops/applications/from-manifest` 注册 Collab（`collab/app.manifest.json`、`collab/`、`bundleEnabled=false`），200，applicationId=186、manifestId=61、releaseId=46；来源提交 `7f34502d` 的 manifest。该 manifest 与冻结候选相同，不增加人员推荐角色。
- 同一会话正式 `POST /api/platform/ops/subscriptions` 创建 C000001 prod Collab 订阅与部署，200，deploymentId=22、deploymentCode=`C000001-collab`。正式订阅路径同时按现有套餐生成该应用 license；不同于 G9 仅登记工具，本次保留正式 API 的 license 行并纳入前后差集。未生成 test 包；prod 策略包也尚未重签。
- 生产只读 OSS 元数据核验：`oss.default` active，`bucketName=wiz-rs`。快照键由统一 Runtime 实现派生为 `codocs/snapshots/<tenant+deployment摘要>/<uuid>/<candidate>/...`。依据用户 2026-10-07 裁定，复用 hzy0 同桶、同快照前缀策略、条件写入与双 Chrome 验收，不要求新的生产 proof AK。残余风险：生产 deployment 的摘要子目录和生产服务身份首次调用尚需正式启用探针验证；不将 hzy0 证据声称为生产首次消费已通过。
- 初始凭据命令 `7f34502d` 已经协调者审查通过。执行时使用同最终 SHA 构建的 `hzy-service-credential-initial`，按其 README 指定 root 0700 目录、原子 0600 文件与 Runtime/Collab 双 `EnvironmentFile`。DB 仅 env_ref 与 secret 哈希，禁止借用 OSS 或其他服务凭据。命令、Go 全量及隔离 MySQL 初始装配矩阵通过；截至本节记录尚未在生产执行。

## 17. 2026-10-07 最终冻结与签包差集门禁

### 17.1 制品冻结

生产构建源固定为 `e1b8bcd5be825c4c87096db5be69a95480255730`，含已审 `7f34502d` 初始 Collab 服务凭据工具及两处 Linux Host wrapper 路径修复。已发布集成历史曾先合入旧基线修复分支，随后以非强推合并保留最终冻结提交；集成头为 `3e2ebaaefcc9619ba3a04a3cfbbb2c68a078ed72`。**制品用 e1b8bcd5，不用旧 a8e46519 或中间合并头**。本机 Linux/amd64 Runtime `0.3.226` 与四个窗口工具已构建完成，Linux 七应用构建中。

### 17.2 正式编译器只读预览：签包停止关口

从正在运行的 Platform `platform-release-996a2a1b` 源码调用 `buildPolicyBundlePayload`，数据库连接使用只读事务，适配器只接受 SELECT；写事务与签名函数均禁用。此步骤没有生成或签发策略包。与 prod39 比较时，先去除 manifest/action ID 变化，再按角色、应用、资源、动作、来源类型与 app-role 做语义比较，避免把 manifest 换版误计为删除。

- 普通员工 `baselineGrants` 对 Altoc/Finance/People 的条目数为 **0**。
- 当前草稿仍含两个验收角色；尚未执行正式退役。本次不通过删除 payload 排除角色。
- Manifest 动作语义无删除，但会带入已在 test 发布的 APF 新动作。全局 latest manifest 与 app-role 编译使“本次不发布 APF manifest”不足以阻止 prod 重签带入这些事实。
- `appRolePermissions` 存在下列 **7 项真实删除**，不是 ID 换版差异：

| 角色 | 资源 | 动作 |
| --- | --- | --- |
| finance:accountant | bank_accounts | edit |
| finance:accountant | receipts | confirm |
| finance:accountant | reconciliation | confirm |
| people:admin | assignments | approve |
| people:admin | cost_snapshots | approve |
| people:admin | performance_cycles | approve |
| people:admin | standard_costs | approve |

其中 `people_admin → people:admin` 的上述四项还直接表现为 `rolePermissionGrants` 删除。草稿也有 APF 新权限及非验收角色映射变化，完整技术条目保存在构建机受保护证据：`/wiztek/hzy-test/stage1-20261007/platform-logical-backup/policy-preview-diff.json` 与 `policy-semantic-diff.json`（0600），没有主体姓名、Token 或凭据。

**按用户“任何删除/降权或超出 S1-03 的新增先停下报告”纪律，停止 prod 签包与生产切换，交协调者裁定正式保留阶段一事实的路径。不得手工裁剪 payload、直接 SQL 修角色，或把阶段二权限变化随 prod 签包带入。** Linux 制品构建可完成并封存；生产服务仍维持原版本，尚未停机，未执行生产 DDL、grant、凭据或配置写入。Platform 已批准的 Collab 应用/部署登记与已核验备份保留（§16）。

### 17.3 协调者续行裁定：阶段一保留 prod39

2026-10-07 裁定：阶段一不重新生成或签发 prod 包，正式事实继续使用 prod39；**S1-02 与 S1-04 本阶段跳过**。两个验收角色及 39 条范围不在已签 prod39 中，保留原包不会把它们带入生产。S1-03 不发布/选用 APF manifest，不执行推荐角色变化及上述 7 项删除。test 包同样不签。

依赖核对：Aims/Codocs 当前 manifest 与 prod39 的资源动作集合各自新增/删除均为 0；项目管理树与例行项目写入复用 `admin:admin`，项目/项目集文档与成员使用既有资源动作和当前对象关系。Aims 两表与 billing 列属于数据安装，安装器不生成或消费人员策略。Collab 的个人/部门会话仍由 Codocs 既有文档/部门编辑权限和当前 ACL 复核，机器读/发布使用 `collab.runtime` 精确 grant，不要求人员新增 Collab 权限。Collab `bundleEnabled=false`；Platform Gateway resolve 从环境下 active deployments 读取 Collab 登记，未按已签人员包是否含 Collab 过滤。因此上述阶段一功能无新 prod 包依赖，可保留 prod39 继续其余顺序。原 §17.2 差集仍作为阶段二正式重签的门禁证据，不执行其权限变化。

后续 verify 同时记录 prod revision/hash 保持 39 原值、test revision/hash 保持原值；不调用任何 bundle 生成或签发 API。若运行时出现新包实际依赖，停止并报告，不绕过策略验签。

### 17.4 首次生产窗口：已恢复旧版本，未执行安装

2026-10-07，冻结源码 `e1b8bcd5be825c4c87096db5be69a95480255730`，Linux 七件 `s4-rc26` 和 Runtime `0.3.226` 已构建并完成包摘要、完整文件清单及入口语法核验。新 release 目录已装配，current 链接未切换。

停机前通知协调者，send 返回 accepted。停止 Gateway、六应用及 Runtime、暂停备份 timer 后，四库备份与代码/配置归档完成加密和解密核验；受保护目录 `/home/hzy/backups/stage1-20261007-stopped`，摘要清单 `SHA256SUMS`。未输出数据库内容、密钥或凭据。

用户批准迁移账号仅在安装期间临时解锁。已冻结前后 `SHOW GRANTS` 摘要；失败路径执行 `ACCOUNT LOCK`，最终 `account_locked=Y`，前后摘要完全相同，无授权新增。

Aims 两表 plan 成功，reviewHash `4cb4bad0a18029b5054dc6fda4eb5eae5c5651aa7b8e96211586fd139091252d`。apply 在写入之前失败：编排读取了不存在的小写 `reviewHash`，实际安装器 JSON 字段为 `ReviewHash`，传入无效摘要被 `validatePlan` 拒绝。已只读核对无安装 receipt、两目标表均不存在。编排修正为精确字段，并在调用前要求 64 位十六进制摘要；不修改工具审核门禁。

后续 billing/Codocs SQL、Console client/grant/凭据、配置及二进制/链接切换均未执行。已恢复原 Runtime `0.3.225/5113fa3a`、六应用、Gateway 和原备份 timer；七服务 active，Gateway readyz 与 Enterprise 入口均 200。prod39、test 包和原数据保持不变。窗口结束已通知协调者，send 返回 accepted。待协调续行，下一窗口必须重新备份，不复用本次停写快照作为新窗口基线。

### 17.5 续行窗口：安装通过，配置失败，旧生产已恢复

停机前已跑在线只读预检：七件包摘要和完整文件清单、五工具、配置 dry-run、DDL 路径、账号锁定/授权摘要、正式 `PlanInstall` 核心的只读事务、plan/apply/verify/rollback 参数解析及 64 位摘要校验均 PASS。未伪造 Runtime 停止证明；正式 plan 仍在停机后重跑。停机通知返回 accepted。新停写备份位于 `/home/hzy/backups/stage1-20261007-stopped-r2`，四库和代码/配置归档加密、解密核验全部 PASS。

本轮正式 plan 的 reviewHash 仍为 `4cb4bad0a18029b5054dc6fda4eb5eae5c5651aa7b8e96211586fd139091252d`。Aims 两表 apply/verify PASS；billing 与 Codocs 三份整文件 SQL 成功，逐文件耗时为 1/0/0/1 秒（秒级计时，不代表每条 ALTER 的独立耗时；未显式指定 ALGORITHM）。迁移账号随即 LOCK，最终 Y，前后 SHOW GRANTS 摘要相同。

配置阶段失败：编排将 Runtime 属组写死为 `hzy-runtime`，实际账号主组为 `hzy`。此前 dry-run 没有验证主机用户/属组存在性。后续 Console client/grant/初始凭据、Runtime 二进制和应用 current 链接均未执行；`collab.runtime` 当前 0 行。修正为从 `id -gn hzy-runtime` 读取实际组名，并在下次在线预检验证全部 chown 用户/属组及既有配置 UID/GID/mode。

旧配置恢复后，Runtime 启动又因 `milestones` 视图失败关闭：原视图为 `ALGORITHM=MERGE SQL SECURITY INVOKER`，billing SQL 的 `CREATE OR REPLACE VIEW` 将其改成默认 DEFINER；原 verify 只检查列/索引，未覆盖 Runtime 视图安全合同。确认新增列非 NULL 行数为 0 后执行受审 rollback，并从本轮备份恢复该视图原定义，未覆盖任何业务行。billing 列已撤回（0 列），原视图 INVOKER，Runtime 全量视图校验 **142/142 PASS**。

最终原 Runtime `0.3.225/5113fa3a`、Console/Workflow/Aims/Codocs/Enterprise/Gateway 均 active，备份 timer active，回环 Gateway/Enterprise 200，公网 Enterprise 302（正常匿名登录跳转）。Runtime 配置属主/组/权限已恢复为 `hzy-runtime:hzy:0600`。窗口结束通知返回 accepted。

已安装的 `aims_portfolio_members`、`aims_portfolio_doc_repos` 两表保留且均 0 行；Codocs 三迁移保留，新增目录两表均 0 行。Runtime 仍用旧映射，未激活新两表。下次窗口须先核对既有安装 receipt，再走 **verify 已装两表**，不可再次 plan/apply 创建；Codocs 已装对象 verify 后跳过，不重复 ALTER。billing 使用修正候选重新冻结 SQL hash。新备份、实际用户/组校验、完整视图合同是再次停机的前置。

修复候选：billing forward/rollback 均显式 `ALGORITHM=MERGE SQL SECURITY INVOKER`；verify 增加 INVOKER/updatable/check-option 校验。隔离 MySQL 用 Runtime 的 `VerifyCompatibilityViews` 验证迁移后的视图，并补默认 DEFINER 同时被 Runtime 与 migration verify 拒绝的反例。本次未再次重开窗口，prod39/test 包、APF、迁移、scheduler 和服务 grant 保持不变。

### 17.6 第三窗口：Collab systemd 启动失败，旧生产已恢复

新停写备份 `/home/hzy/backups/stage1-20261007-stopped-r3` 四库与代码/配置归档解密核验 PASS。既有 Aims receipt verify、Codocs 已装对象 verify、修正 billing SQL 与完整兼容视图校验均 PASS；迁移账号 LOCK 且授权摘要不变。Collab 正式登记/两条精确 grant、初始凭据生成与只读 verify 成功，凭据不输出。目录登记已执行；随后切换启动到 Collab 时失败。

根因是 Linux systemd `RestrictAddressFamilies` 未允许 AF_NETLINK，Node/libuv 的 `uv_interface_addresses` 报 errno 97。本轮已自动恢复原配置、原 current 链接及 Runtime `0.3.225/5113fa3a`；七既有服务 active，Enterprise 回环 200、公网 302，Gateway healthz 200，迁移账号 LOCK。恢复通知 accepted。新增列/已装对象、受审 Collab client/grant/凭据保留，Collab 停止，不重复签发。

修复 `cd4e5427` 只为 Collab 单元增加 AF_NETLINK，保留空 CapabilityBoundingSet 和回环监听；打包/真实 bundle 启动测试 10/10 PASS。生产以相同 User 与地址族限制运行只读 Node 接口枚举，PASS。下轮在线预检新增该探针；核验既有 Collab receipt/零 plan 变更及初始凭据，跳过已安装 billing/Codocs DDL。Runtime/应用仍冻结 e1b8bcd5，billing SQL 冻结 0f57d6af，systemd 单元冻结 cd4e5427，各制品和编排脚本分别记录 SHA-256。prod39 保持，不装 APF、不迁移、不签包。

### 17.7 第四窗口：Collab 健康，Gateway 打包缺项，旧生产已恢复

`stopped-r4` 新备份全部解密核验 PASS，既有对象/授权/凭据验证成功。Collab 经修正单元启动、healthz 200。Gateway 因其传递导入的 `enterprise/composition/business-api-routes.generated.mjs` 未被打包而失败。已停新版本并恢复旧七服务，Gateway healthz / Enterprise 回环 200、公网 302；恢复通知 accepted。

恢复过程中发现新 Runtime 已生成的 deployment-bindings overlay 被通用文件恢复路径写成 root:0600；已恢复 `hzy-runtime:hzy:0600`，旧 Runtime 重新健康。重试脚本增加 overlay 属主恢复，在线预检核对其 UID/GID/mode。Gateway 打包提取共用 payload 函数，补入生成路由文件；测试使用该真实函数在隔离目录复制并导入 Gateway server，验证完整传递 import 图。release 测试 11/11 PASS，修复为 `08795a32`。下一轮 Runtime/五工具/七件全部从该 SHA 重建并冻结，不沿用缺项包。

原 Aims 安装 receipt 的整库基线在后续获批 billing DDL/目录登记后失效，不能改写原 receipt 或重新 apply。续行只读核对 receipt 与原 plan 一致、两个 Created 对象闭集及 SHOW CREATE 的规范化摘要逐一相等，并单独核对实例/租户/环境/部署/schema/generation 绑定；已通过。未修改安装器 strict verify，也不把变化后的库伪装成原冻结基线。

### 17.8 第五窗口：服务启动成功，探针路径不正确，已保守恢复

`stopped-r5` 新备份全部解密核验 PASS；同 SHA `08795a32` 的 Runtime `0.3.226`、七件 `s4-rc27` 全部启动成功。142/142 视图核验 PASS。签发探针却直连 Console 31001：managed-cloud 的正式 Console 信任合同要求已验证 Gateway 上下文，故返回 503 / `verified_console_context_missing`，不能据此放宽鉴权。真实 Collab env 的 token URL 是 `https://aidcp.wiztek.cn/console/oauth/token`，下一轮改按该配置调用。

动态模块探针也误用了不含应用 basePath 的 URL。只读对比证明 Console 同一模块根路径 302、`/console/` 前缀 200。修正后旧五应用的全部可见模块 HTTP 200，整体只读预检 PASS；旧 Aims 的独立页面入口 404 是原状态，按裁定保留，项目页面验收在 Host 进行。未把独立 Aims 404 报成新 Host 页面可用。

已恢复旧 Runtime 与七既有服务，Gateway / Enterprise 回环 200、公网 302；恢复通知 accepted。没有业务验收或 OSS 写入。下一轮同 SHA 制品不重建，只重新冻结修正后的探针和编排 SHA，重新备份后按真实公网 Gateway token 路径验证。若该路径仍因同一上下文根因失败，按用户规则停止并报告，不盲重试。

### 17.9 第六窗口：模块全通过，Collab 签发授权依赖缺失，已恢复

`stopped-r6` 新备份全部解密核验 PASS。同 SHA `08795a32` 的 Runtime/七件全部启动；142/142 视图 PASS，动态模块 1,269 项全部 200（Console 89、Workflow 44、Aims 241、Codocs 296、Enterprise 599），Collab/Gateway 本机健康通过。

真实配置的公网 token URL 签发返回 403，故停止、恢复旧生产。七既有服务 active，Gateway/Enterprise 回环 200、公网 302；迁移账号 LOCK，备份 timer 恢复。恢复通知 accepted。没有 OSS 写入或业务验收。prod39 保持，不装 APF、不迁移、不签包。

只读核对发现生产 `HZY_CONSOLE_SERVICE_TOKEN_EXCHANGE_ENABLED` 未启用；`console.runtime` 仅有既有 `console:service-token/issue`，`exchange` 为 0 行。关闭 exchange 时 Console 走旧 credential consume + signer；`console/server/utils/oidc.ts` 的 `signServiceAccessJwt` 对受信 Gateway 部署与 credential grant 部署要求相等。公网 Console 上下文归属 `C000001-console`，Collab grant 归属 `C000001-collab`，该检查会拒绝（源码路径推导，不据此放宽检查）。已有原子 exchange 路径按已验证凭据/精确 grant 冻结来源，适用于该场景；Runtime 路由又严格要求 `console.runtime` JWT 与 `console:service-token:exchange`。

**新增批准点 S1-05-E（未执行）**：一行 `console.runtime → console:service-token/ exchange`，scope `console:service-token:exchange`，仅实际使用的 audience `data-runtime`，tenant `C000001`、source deployment `C000001-console`，active；不得复活 revoked，不授 tenant-runtime 或宽 scope。依据受审 v2.18 seed/verify，但生产候选补齐绑定且缩到单 audience。配套启用 Console 既有 exchange 开关。此行超出此前已冻结的 Collab 两行，按 S1-05“必要文档服务差集逐行批准”停下等待明确批准，不执行 grant。

候选执行纪律：先加密 grants/config 备份并解密核验；同键任何既有行即停止；插入 ROW_COUNT=1、canonical verify=1、所有非目标 grant 全字段摘要不变；仅启用上述已有开关，随后按同 SHA 新窗口验证真实签发/消费。回滚恢复 Console env，新增 grant 仅按 inserted ID 置 revoked、保留审计，不删除或改其他行。生产 ordinary employee 权限/prod39 不变。

### 17.10 2026-10-07 r7：S1-05-E 已批准执行，签发失败后恢复

- 用户批准仅新增 `console.runtime → console:service-token:exchange`，audience 仅 `data-runtime`，绑定 `C000001 / C000001-console`，并启用既有 Console exchange 开关。
- 停机前完整只读预检 PASS：七件制品、五个工具、真实 UID/GID、已有安装结果、142 视图、配置 dry-run、旧应用动态模块。制品保持 `08795a32a728f0f6dada5c64fe042fbd1baacc3d`，Runtime 候选 `0.3.226`。
- 新备份 `/home/hzy/backups/stage1-20261007-stopped-r7`：四库及代码/配置/应用目录加密备份，解密校验全部 PASS。脚本、SQL、工具与制品冻结摘要位于受保护 `evidence/r7-freeze.sha256`。
- 同事务新增 grant ID `104437693`，总行数 `552 → 553`，非目标全部字段摘要不变；精确 JSON 绑定与 active 状态核验通过，COMMIT。回执为受保护 `console-exchange-receipt.json`。
- 新 Runtime 与七件服务均成功启动。实际公共 Gateway token 路径的 Collab snapshots read 签发仍为 `403`，未继续 publish 探针或业务验收，未写 OSS 对象。
- 立即回滚：新增 grant 按记录 ID 置为 `revoked`，Console 开关及配置恢复，旧 Runtime `0.3.225 / 5113fa3a`、七个既有服务全部 active，Gateway 与 Enterprise 回环健康均 `200`；migrator 最终 LOCK。保留已批准安装结果和 Collab 初始凭据，不重建、不轮换。
- 停机及恢复通知均已向 Claude 终端发送，返回 `accepted=true`。签发拒绝阶段仍需只读定位；不能把本次未完成的签发或 Collab 业务验收记为通过。已撤销的 grant 不由幂等脚本自动复活。
- 受保护日志只作诊断证据，报告不包含令牌、密钥、账号明文或个人信息。`prod39` 未变化；未安装 APF、未迁移、未签任何包。

### 17.11 2026-10-07 组合续行：先发布非实时文档与项目

用户批准 D1/D2/D3，但顺序明确分开：先发布不含 Collab 的阶段一；D2 由 sol2 交付后审查部署 Platform；最后单独开启个人协作，部门仍关闭。保持 prod39，不签包、不装 APF、不迁移。

r7 403 已定位为 Console 自身 exchange Token 的 `insufficient_scope`：行 104437693 只有 `audiences`、缺映射器读取的单值 `audience`。该行回滚后 revoked；后续只补 `audience=data-runtime` 并恢复该精确行，不新增 audience 或 grant。另一独立问题是 Platform binding 闭集未含 Collab，正式 heartbeat 会移除静态 Collab 绑定并触发 Runtime 重启；必须采用 binding-only 登记，不加入业务 schema adapter，不轮换凭据。候选 Console 还需 `CONSOLE_COLLAB_MODE=external`。以上三项不得以削弱鉴权代替。

本次非 Collab 窗口使用同 SHA `08795a32` Runtime `0.3.226` 与既有六应用 `s4-rc27`，Collab 包不启用；Runtime、Enterprise 个人/部门 snapshot/collaboration 全关；Console mode=disabled、exchange=false；Gateway 不登记 Collab。D1 行保持 revoked，全部 grant 全字段摘要应与窗口前一致。已安装 Aims/Codocs 对象保留。

停机前制品/工具/只读 plan/config dry-run/动态模块预检通过；再查五类协作对象总数为 0（物理表名均带 `document_` 前缀）。首条预检查错表名被 MySQL 拒绝时尚未停机或修改配置，改为 information_schema 确认的物理名后重新通过，不把该失败记为生产停服。

员工保留既有非实时文档编辑与分享、Host 项目管理和项目文档；暂无共同编辑、在线光标与实时同步，需手动刷新和协调编辑。后续个人协作窗口必须先确认正式 heartbeat 保留绑定、服务至少一轮 heartbeat 后 PID 稳定、精确 Token 正反例通过，再请用户双账号验收。

r8 执行结果：新备份 `/home/hzy/backups/stage1-20261007-stopped-r8-no-collab` 四库与文件归档解密核验全部 PASS；142/142 视图通过。Runtime 已运行 `0.3.226 / 08795a32`，Console/Workflow/Aims/Codocs/Enterprise/Gateway 全部 `s4-rc27`。动态模块 1,269 项全部 200；七服务及 backup timer active，跨 60 秒 PID 不变，Gateway/Host 回环 200、公网 Host 302（登录跳转）。Collab inactive、全开关 false、全部 grant 摘要不变、migrator LOCK。已通知协调者恢复，`accepted=true`。保留新版本，不回滚；真实账号项目/文档验收由用户进行。

在线运行后的 grant 全字段摘要会随正常签发变化：r8 后与新加密备份逐行比对，553 行数量和全部授权事实不变，14 行仅 `last_used_at/updated_at` 变化，来源为 Runtime 的正式 grant 使用记录更新。窗口内的零变更证明保留；不能把在线正常使用时间变化误报授权新增，也不能忽略 resource/action/scope/status 等事实变化。受保护证据 `evidence/r8-grant-usage-comparison.json`。

### 17.12 D2 Platform 发布

D2 `364e4f35087e4a3661d2d1e973cbb007bf9de9d5` 已审查并快进合入集成；Platform 全量复跑 374/374。Platform 主机新逻辑全库备份为 `/wiztek/hzy-test/stage1-20261007/platform-d2-logical-backup`，104 个表/视图、41,158 行，57,034,102 字节，解密 hash 核验通过；代码/构建/配置归档亦解密通过。生产凭据仅留主机受保护文件，不进入源码包。

正式构建来自该 SHA，锁文件未变。缩减源码包先漏了既有 cutover 相对导入，构建失败时原 Platform 未切换；补齐同 SHA `deploy/self-hosted/cutover` 闭包后完整 Node/Nitro 构建 PASS。新 PM2 工作目录 `/wiztek/hzy-test/platform-release-364e4f35/platform`；原进程定义加密备份旁的受保护 rollback-process.json 可用于恢复。切换后数据库/签名 diagnostics 200，prod/test 共用服务健康；两环境正式 Console deployment active/license active，prod Collab 正式部署 active。不签任何包、不修改授权、不轮换凭据。此时等待原实例正常 heartbeat 产生 binding，不以静态补项宣称通过。

D2 正式 heartbeat 已在 `2026-10-07T13:16:57Z` 观察到 overlay 的 `C000001-collab`，共七项；Platform 实例行 Collab 为 active/not_applicable，无 last_error_code。原 control 凭据未轮换。Runtime 按现有设计重启；Gateway 的依赖使其停下而未自动重启，已立即通过 systemctl start 恢复，七服务 active、回环 Gateway/Host 200。该联动须纳入未来任何 control binding 变化窗口的健康复核，不把一次预期绑定重启后的 Gateway inactive 漏掉。

### 17.13 r9 个人协作窗口与回滚

新加密备份 `/home/hzy/backups/stage1-20261007-stopped-r9-personal-collab` 四库与文件归档全部解密 PASS。D1 仅修复 104437693（单值 audience=data-runtime、active），553 行计数及非目标完整行摘要不变；D3 external/exchange 与个人开关生效，部门关闭。八服务启动及 1,269 动态模块通过，但首个 read scope 签发返回 503，未执行 publish 探针或业务对象写入。脚本立即回滚 D1 原 JSON/revoked 与全部运行配置，Collab 停止，七服务、backup timer、Gateway/Host 健康恢复；migrator 最终 LOCK。D2 正式 binding 保留。停机与恢复通知 accepted=true。

精确 requestId 对应 `verified-policy-invalid / verified_console_policy_receipt_invalid`。主机内解密 r9 备份仅输出技术时间：prod39 租约 issuedAt=`2026-10-07T13:16:00.332Z`、expiresAt=`2026-10-07T13:21:00.332Z`；首探针 `13:21:18.109Z` 已晚于到期 18 秒。恢复后正式续租仍为 prod39、renewal=ok。下一窗口增加只读就绪门禁：复用原 `verifyPolicyEnvelope` Ed25519 验签/正文与绑定校验，要求 C000001/prod/C000001-console、revision39、active、renewal=ok、租约余量至少120秒；最长等待6分钟正常续租，失败走原回滚。该门禁不签新人员包、不改策略行或授权、不放宽过期校验。当前在线原租约验签与门禁已 PASS。

### 17.14 r10 续行：exchange 的旧策略摘要依赖（已回滚）

新备份 `/home/hzy/backups/stage1-20261007-stopped-r10-personal-collab` 四库与文件解密全部 PASS；窗口脚本/制品 hash 冻结于 `evidence/r10-freeze.sha256`。D1 精确单行/非目标摘要、142 视图、1,269 动态模块通过。新增策略门禁复用原验签器，prod39/精确绑定/active/renewal=ok、租约剩余296秒通过，排除了本次租约到期原因。

首 read scope 探针仍为503，正式审计码 `console_exchange_policy_mismatch`。Runtime `data-runtime/internal/apps/console/auth_service_token_exchange.go` 的 exchange 在事务内读取旧 `policy_bundle_snapshots` 摘要，与 Console 从 `verified_policy_snapshots` 取得的正式摘要比较。只读事实：正式 revision39/version=`pv_prod_20261003004946_0008`；旧摘要 version=`pv_prod_20260903034046_0095`，两者 version/hash 都不同。因此当前失败是新旧策略存储取源不一致，不是授权缺行或需要新签prod包。

停止后立即自动回滚 D1 为原 JSON/revoked、恢复 r8 配置/二进制/应用；Collab stopped、个人/部门开关关闭，七服务与 backup timer active，Gateway `/healthz`200、Host200、公网302、migrator LOCK。D2 正式 Collab binding 保留。未执行 publish 探针或业务验收写入，没有新增授权、签包或轮换凭据。

最小修复提案（待协调者审定，不执行）：exchange 必须与 Console 读取同一正式 verified snapshot，复用 Runtime 已有验签、tenant/environment/deployment、有效期与回执校验；不得手写旧摘要表、跳过比较或双接受新旧摘要。补正式摘要匹配、旧摘要不同但正式匹配、正式摘要不匹配、过期/绑定错误的反例；通过后冻结新代码、补只读预检，再安排独立窗口。当前保留健康非协作生产，等待代码任务。

### 17.15 r11：正式策略 exchange 修复与停机前证据

协调者安全审查通过 `d4d3a71e24c0a906129bbe2154bd340e8be4374f`，已快进合入集成，仅推 GitLab。Runtime 冻结 `0.3.227 / d4d3a71e`，四个窗口工具亦从该 SHA 构建；应用保留已验证的 `08795a32 / s4-rc27` 原制品（本修复仅 Runtime Go 与合同文档，不重新标称应用 SHA）。Linux 二进制归档 SHA-256=`74bca173be9c3a1c74c82c78b95a54ed9e0059c76245953b7e3a19d55e888bcc`，传输后核验一致。

停机前生产只读快照比对 PASS：在生产主机内仅 SELECT 正式 snapshot/renewal 与旧摘要作对照，不输出正文或用户信息；诊断进程复用正在运行 Runtime 的配置解析与信任配置，将真实数据装入 mock caller-Tx，执行本次新增 exchange 校验函数。两例分别证明“正式匹配而旧摘要不同仍成功”和“错误正式摘要拒绝”，生产无 DML/签发。受保护输入与日志仅留主机 `evidence/r11-offline-input.json`、`evidence/r11-offline-policy.log`，权限0600。诊断二进制含临时测试，仅作离线验证，不安装到 Runtime 服务。

七包/五工具、账号锁态/授权摘要、配置 dry-run、精确 installer/registration reviewHash、动态模块、prod39 原验签租约与新 exchange 离线校验的完整只读预检 PASS，脚本/工具 SHA 冻结于 `evidence/r11-freeze.sha256`。已向协调者发停机通知（accepted=true）；r11 新备份窗口继续，部门协作关闭，结果以下续记。


r11 结果：新备份 `/home/hzy/backups/stage1-20261007-stopped-r11-personal-collab` 四库/文件解密全部 PASS；142视图、1,269动态模块、prod39原签名/租约门禁通过。read scope 签发200，说明本次正式策略取源修复已生效；消费探针403，脚本立即回滚，生产七服务/backup timer恢复active、Gateway/Host200、公网302、migrator LOCK，D1恢复原JSON/revoked、个人/部门关闭，D2保留。

只读日志精确码为 `collaboration_identity_invalid`，来自 owning `ResolveCollaborationSessionInfo` 对空 sessionId 的拒绝；旧探针发送 `{}` 却要求400，是探针合同错误，不是服务授权失效。消费路由在调用该领域函数前已完成服务JWT、严格来源/绑定/能力与实时credential/grant检查。r12只调整受保护探针：发送 `[]` 并要求400且嵌套 `error.code=invalid_json`；JSON对象解析位于上述授权核验后、session查询与写入前，不把403当成功，也不修改业务校验。隔离mock探针全矩阵通过，另证明消费403仍导致整体失败。重新跑完整只读预检和离线正式策略比对后再冻结脚本、重新备份续行；已通知协调者恢复（accepted=true）。

### 17.16 r12 个人协作开启成功（待双账号业务验收）

仅修正无副作用探针后，完整只读预检、正式策略离线比对、两个隔离probe测试再次 PASS。脚本与原同 SHA Runtime/工具冻结于 `evidence/r12-freeze.sha256`；新备份 `/home/hzy/backups/stage1-20261007-stopped-r12-personal-collab` 四库与文件归档全部解密核验 PASS。

执行成功：D1 仅 104437693 补单值 audience=data-runtime 并 active，D3 Console external/exchange=true；Runtime `0.3.227 / d4d3a71e`，既有六应用与 Collab 均 rc27。142/142 视图、1,269 动态模块通过。prod39 验签租约门禁通过；snapshots read/publish 两 scope 签发200，Runtime两次消费均400且 `error.code=invalid_json`，证明严格服务身份/绑定/实时credential/grant门槛已通过，并在对象JSON解析处无副作用停止。错audience与缺capability签发403；伪造source/tenant/deployment未改变凭据冻结身份。未打印令牌或凭据。

最终八服务和backup timer active，最短连续运行144秒；Gateway health/ready、Collab/Host回环200，公网Host302；migrator LOCK。实际 overlay 保留 C000001-collab，个人开关true、部门false、APF三域false，prod39保持。对553条grant与新备份逐行核对，除已批准D1之外授权事实全部不变；7行变化只涉及批准D1的scope/status及正常使用时间，受保护证据 `evidence/r12-grant-usage-comparison.json`。五类协作业务对象仍0，探针没有创建文档/会话/快照或写OSS。

停机与恢复通知已发送协调者；保留当前运行状态，不回滚。个人协作的用户双Chrome标记对象验收尚未执行，须由协调者安排两生产账号；部门协作不得据此开启。回滚仍使用r12原备份、rollback目录、runtime.previous与previous-link清单；若用户验收后已有V2正文，不得直接关闭/回退导致正文不可读，先核对现有恢复兼容路径。

### 17.17 阶段一最终状态与共享热更新（2026-10-07）

r12 后已发布 Console `1ea5435ae597e491fbd0835d171991c2ecabd792`，修复 service directory 的有效状态投影；用户确认人员选择器可选择员工。随后 Enterprise 更新为 `8ae458f98e4cab589251d1bcd1af7a9c078b8eca`，包含组合 Codocs 页面及有效共享 ACL 的协作连接修复。Runtime 保持 `0.3.227 / d4d3a71e`，其他应用保持 rc27。两次均由同提交 Linux x64 / Node24 制品发布，未变更 Runtime、DB、grant、Platform 或开关。

| 制品 | SHA-256 | 已核验加密备份 |
| --- | --- | --- |
| Console（4,349,798 bytes） | `4090962478f847a5e4829ba5ead1f4201843166cb93cb70be7b037dadcfbcc00` | `/home/hzy/backups/console-share-20261007T143245Z` |
| Enterprise（12,416,598 bytes） | `1a01cb5cc654161eac227f63a8bb392d9624d5a4c5ed0e4dec8d3de25001a693` | `/home/hzy/backups/enterprise-share-20261007T150502Z` |

Enterprise 发布先通过 hzy0 十模块 prepare、真实文档页/共享弹窗/Nuxt 动态入口连续三轮200、正式smoke及60秒稳定检查。生产各次应用热更新均完成三轮健康；其它服务 PID 与目标 env hash 前后不变，八服务 active，公网匿名 Host302（登录跳转）。未冒充双账号协作验收。个人协作开启、部门关闭；prod39保留、APF不安装不开放、不执行WizBiz迁移或opening、无7项权限删除、未签test/prod包。本文件§16～17.16保留各次失败、回滚、重新冻结与r12成功的完整过程，不以最终成功覆盖失败记录。

### 17.18 Runtime 重启依赖恢复（2026-10-07 用户批准）

原生产 Console/Enterprise/Workflow/Aims/Codocs/Collab/Gateway 均 `Requires=hzy-data-runtime.service`，Runtime 停止会使依赖停止，但原图不保证重新拉起。采用最小增量：保持 Requires/After、健康检查及 Restart=on-failure；七个依赖增加 `PartOf=hzy-data-runtime.service`，Runtime 增加 Wants 七依赖。PartOf 传播显式重启，Wants 在 Runtime 新启动事务中拉起已停止依赖；After 保持原顺序。Runtime 原 Restart=always/3秒未改。该关系也意味着 Runtime 维护重启会中断个人实时协作连接，客户端须重新连接。

生产以 `zz-runtime-recovery.conf` drop-in 实施，先备份完整 unit 树并校验归档可列举与SHA，`systemd-analyze verify`通过后 daemon-reload；实测一次仅 `systemctl restart hzy-data-runtime`，未手动启动任何依赖，八服务自动active、Gateway ready与Collab health通过，公网Host健康。备份：`/home/hzy/backups/runtime-dependency-20261007T151602Z`，含unit归档、前后PID/状态、verify与健康证据。unit不含凭据正文；未读取EnvironmentFile。回滚：删除八个本次drop-in→daemon-reload→重启Runtime→显式启动原七依赖→健康复核。仓库模板同步，专用依赖契约测试通过。该实测覆盖显式Runtime重启，未做进程kill/机器重启故障注入。

### 17.19 共享通知503精确诊断（只读，无重试写入）

8ae458f9发布后用户新共享请求的闭集日志为 `stage=notification_in_app, httpStatus=302, errorCode=unknown`；共享已持久化且新版名单正常显示。日志不含文档/收件人标识，不能以它绑定唯一UUID；本时段仅捕获这一条失败诊断，与用户报告相符。未捕获外部通知失败，不能归因企业微信或新增grant。

只读、无Bearer的路由探测：Console回环 `/api/v1/console/notifications/publish` POST返回302，Location为 `/console/api/v1/console/notifications/publish`；带 `/console` POST返回401，证明进入鉴权。Foundation `fetchConsoleServiceJson` 使用 self-hosted binding；`normalizeConsoleServiceBindingUrl` 对该binding只保留传入路径、不补缺失前缀，回环 `redirect:manual` 在302失败关闭。根因是通知URL缺少自托管Console basePath，发生在服务令牌消费鉴权前；未证明现有grant不足。

最小修复提案：在Foundation自托管Console路径规范化处，对缺 `/console` 的受信目标加一次前缀，已含前缀保持不变；CF继续去前缀、hzy0路径保持原样。补通知publish与既有token/introspection路径矩阵、双前缀防护及重定向失败关闭测试后，仅构建Enterprise同SHA更新。不跟随302，不放宽身份/grant，不自动重试共享写入。本轮仅提交诊断；通知路径代码修复尚未实施。共享写入成功不等于通知成功，用户需在修复后按原意图键续行通知。

### 17.20 已批准通知前缀修复与五应用更新

2026-10-07 用户批准 Foundation 最小修法。冻结 `66400997f485ae45edcb7af5ed8f0916a3449f97`，仅真实 self-hosted Console binding 在缺 `/console` 时补一次，已有前缀保留；CF/hzy0原行为与manual redirect失败关闭保持。不从请求头推导、不放宽认证或grant。Foundation865+27、Enterprise698+1既有skip、Codocs336、Foundation typecheck/lint通过。

hzy0先备份并解密核验（`domain-backups/notify-prefix-20261007T152044Z/runtime-config-profile-pm2.tar.enc`）、十模块prepare、Codocs Worker/静态装配，五应用同SHA切换、四动态入口连续三轮200、正式smoke与60秒稳定通过，Gateway/Collab/Runtime不变。

生产同SHA Linux五包构建与逐包hash/manifest verify通过；Console/Workflow/Aims/Codocs/Enterprise均指向 `releases/notification-prefix-66400997`。首次Aims错误探针404、第二次Enterprise未完成监听即探测，均立即回滚并核对旧生产八服务健康；分别对照旧rc27同路径与补有界连续3次预热，未改业务代码或放宽状态门槛。第三次从新加密备份续行成功：`/home/hzy/backups/notification-prefix-20261007T153609Z`，完整解密核验通过，五应用预热及三轮健康通过、八服务active、公网Host302。Runtime/Gateway/Collab PID与五env hash不变，无DB/grant/开关变更。

生产五包SHA按console/workflow/aims/codocs/enterprise依次为：`6d6b91dd8885db43dec2bb635712439b938b9756b4651bc20ea1b95bfadad940`、`682110a52f78c48d15f478eae45812874028989d650b56116be04318fff4cb5f`、`eb3d04eedf4c8098ec40386756a949afd65f1af79ebba360189bfef9d81bf240`、`30342c54a761636466947c0ac45d5f98e38e40e7d869b5df713d00764d3a2c7a`、`889cb5d8576e1ee6bda0c4df61e6c93e1a3d24544d0100766f398fb9d671856e`。

通知业务验收仍需原意图键续行与新CLAUDE-FIXTURE共享。部署后只读基线share113=write、notificationCount=0，未替用户重复写入。浏览器控制不可用，用户保留test会话/原弹窗，已发出部署完成后的单次重试请求；记录真实回复与只读通知计数后再标记业务验收完成。

2026-10-07 用户验收补录：原键重试后铃铛与企业微信均收到，66400997 通知修复验收通过。只读证据：本次 cf21f128 前缀文档的 share114 有1条站内通知；此前 share113 仍为0，不将不同意图混记为成功。外部消息链接仍是相对路径，另批修复。

### 17.21 外部通知绝对链接（2026-10-07）

冻结 `4f7b43ad12f740ed51bb9c4cb9ef338aaa1fbb40`。外部通知相对路径由受保护部署公网入口拼接，生产只读确认五应用配置为 `https://aidcp.wiztek.cn`；不从请求头推导host。站内相对路径不变；已有绝对URL保留原字节，非法URL或缺配置失败关闭。Console测试通知也复用该构造器。业务通知现有企业微信/钉钉适配器均覆盖，通用函数预留邮件复用，未新增邮件通道。

Foundation870+27、Console629、Codocs336、Enterprise698 PASS+1既有skip，0失败；两模块typecheck及改动lint通过。hzy0新加密备份 `external-link-20261007T155105Z` 解密核验通过；十模块prepare、Codocs Worker装配、四动态模块三轮200、正式smoke与60秒稳定通过。

同SHA Linux五包校验后生产仅更新Console/Workflow/Aims/Codocs/Enterprise；备份 `/home/hzy/backups/external-link-20261007T160348Z` 加密解密核验通过，五应用预热及三轮健康通过。Runtime/Gateway/Collab PID、五env hash不变，无DB/grant/开关变更。各包hash保存在受保护制品index。已成功投递旧消息不重复发送；新CLAUDE-FIXTURE共享通知的绝对链接点击验收待用户回复。

2026-10-07 外部绝对链接验收补录：用户确认企业微信链接可直接打开，4f7b43ad 外部链接验收通过。

### 17.22 S1-11 部门文档协作启用（2026-10-07）

用户裁定复用hzy0隔离正反例与组件测试，不等待hzy0人工验收。hzy0 Runtime/profile个人与部门开关已为true；部门隔离MySQL完整场景通过（ACL、跨部门/leader/parent拒绝、成员/经理/分享变化撤权、迟到publish拒绝），Collab31/31、Host合同11/11通过。生产只读确认四列、三索引和CHECK齐备，部门会话0，未重复DDL。

新备份 `/home/hzy/backups/department-collab-20261007T161300Z` 加密及全流解密逐文件hash核验通过，配置前置hash防覆盖并行变化。精确修改Runtime `apps.codocs.departmentCollaborationV2Enabled` 与Enterprise `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2`、`NUXT_PUBLIC_CODOCS_DEPARTMENT_COLLABORATION_V2`，三项false→true；个人开关、绑定与配置权限不变。Runtime0.3.227/d4d3a71e原二进制不换。

Runtime重启通过已批准systemd关系带动依赖恢复；连续三轮健康及60秒PID/重启计数稳定通过。未改DDL、业务库、grant、Platform或制品。回滚为解密恢复两个配置并核对原hash→重启Runtime/依赖→健康，本轮未触发。用户生产双账号CLAUDE-FIXTURE部门文档正反例验收待安排，不能将开关/健康通过记作双人业务验收通过。

### 2026-10-07 部门成员与负责人默认可写：生产执行记录

经用户授权与协调者安全审查，冻结 `f446c74873232402d7182e832a3f4e35d13b6812`，包含成员默认正文协作与直接 active leader 的 CanWrite；CanManage 不扩大。同 SHA Linux Enterprise 构建通过（约 169 秒），归档 SHA-256 `e5c23735d3729bf816d363dada5effbf065b773b1d51787d6613aa3e2d2c9367`；Runtime 从干净同 SHA 构建，版本 `0.3.228`。两项传输后 hash、完整来源 SHA、Enterprise manifest 均核验通过。

备份 `/home/hzy/backups/department-leader-20261007T193128Z/before.tar.enc` 包含旧 Runtime 二进制、原 Enterprise release、两项配置及两个 systemd unit；AES-256-CBC/PBKDF2/200000 加密，全流解密与原二进制/配置逐文件 hash 核验通过。旧 Enterprise release 保留 `external-link-4f7b43ad`，旧 Runtime 为 `0.3.227/d4d3a71e`。失败回滚脚本已准备，恢复两项旧制品后重启 Runtime 并等待全服务健康；本次未触发回滚。

生产切换 Runtime 与 Enterprise，Runtime 重启按既有 PartOf 依赖恢复八个服务。三轮健康 PASS、60 秒 MainPID/NRestarts/ActiveState 完全一致，公网 Enterprise 匿名入口 302。Runtime 最终 `0.3.228/f446c748`，Enterprise 最终 `/home/hzy/apps/enterprise/releases/department-leader-f446c748`。配置 hash、uid/gid/mode 不变，个人/部门协作开关均保持启用；其余服务制品不变。未写 DB/grant、未改 Platform/策略包，未连接或切换 hzy0（由 sol2 独占 Aims R1）。

本次仅完成制品与服务验证，真实部门成员/负责人双账号协作由用户复验；parent/none、停用/离部门及文档 readonly/回收的拒绝已在隔离测试覆盖，不能据此声称生产浏览器反例已验收。执行证据见受保护报告 `.git/report-department-collab-20261007-leader.md` 与 `.git/department-leader-prod-window.log`。
