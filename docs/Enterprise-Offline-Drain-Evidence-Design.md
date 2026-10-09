# K2-E：生产离线切换的排空证据链设计

状态：精简方案 B 的本地制品与隔离测试已实现，尚待 S3 现场演练；环境执行另依既有批准点。本文只规定 S3 演练和 S4 切换需要实现、验证的合同，不授权环境写入。生产离线切换只使用 Platform 签发的 `enterprise-external-drain-approval.v1` 和 Go 激活校验；`deploy/test-env/drain` coordinator 与 `enterprise-drain-release.v1` 继续仅用于 C000001/test。参见 [迁移 Runbook](./Go-Live-Self-Hosted-Data-Migration-Runbook.md) C1–C6、[切换协议](./Unified-Enterprise-Cutover-Protocol.md) §9。

## 1. 事实源、角色和封存边界

当前只有测试 coordinator 生成 `enterprise-external-drain.v1` 快照；Platform 的 `approveExternalDrain` 从 `HZY_DRAIN_CONTROL_TOKEN` 验 HMAC，**生产尚无受信的密钥持有者、离线快照生成器和证据采集器**。不能把操作员口述的“M4 完成”直接转为 `ingressDrained=true`。

建议由新主机上的专用 cutover 身份运行一次性离线 CLI。密钥管理员在新主机受保护目录生成**独立于 Gateway 内部令牌和测试 coordinator**的随机 HMAC 密钥。选定 systemd credential：根管理员把同一密钥分别以 systemd 加密凭据交给 cutover CLI 的临时 unit 与生产 Platform unit；两进程仅能读各自的 `$CREDENTIALS_DIRECTORY` 文件，均不在命令行、普通环境变量、日志、浏览器或迁移包中出现。Platform 当前只读 `HZY_DRAIN_CONTROL_TOKEN` 环境变量，实施时改为从 credential 文件读取并拒绝生产环境回退到 env；启动探测只比较不泄密的 key ID。未建立这条分发路径前不签发。密钥仅用于本次窗口，审计记录密钥 ID，窗口结束撤销 unit 凭据并保留加密审计备份。至少两名不同的已认证自然人参与：采集者与材料复核/签发者必须不同，复核者可兼最终签发者；每次操作实时检查既有 `ops.deployments:admin` 人员门槛，服务进程身份不算第二人。不新增角色或账号；若现场只有一名具备权限的员工，则停在环境执行前请用户裁定。用户的 M4/M6 批准仍是独立关口。

CLI 从冻结后的只读材料构建不可变证据清单，每份材料记录 `kind`、tenant/environment、cutoverKey、targetGeneration、采集 UTC 起止时间、采集方式及目标、结果摘要、原始文件 SHA-256。原始材料放 0700 目录，输出快照、报告及清单均为 0600；摘要只证明材料未被替换，**不代替人工判断材料是否充分**。签字 ID 不由 CLI 填写：采集者用自己的 Platform 员工会话将 CLI 产物导入正式 ops 页面，服务端读取、校验并保存原始字节到加密、仅 ops 可读、按 SHA-256 寻址且写后不可变的证据库，返回服务端生成的材料 ID。只接受受控 JSON/UTF-8 文本或固定格式的命令输出，每件上限 32 MiB、每窗口合计上限 128 MiB；拒绝归档内路径、符号链接和任意浏览器路径引用。大于上限、格式不明或含秘密的材料需先审定脱敏与导出格式，不截断后继续。

服务端将材料 ID/逐件摘要、清单 hash、封存 payload hash、report hash、decisions hash、tenant/environment、window ID、generation 组成冻结的 `reviewSetHash`。复核者在服务端按材料 ID 读取实际字节与解析结果并逐项确认；服务端用其当前会话 UID、确认时刻和 `reviewSetHash` 生成不可改的复核记录，拒绝采集者自我复核。签发者可与复核者为同一人，但必须与采集者不同；签发时再从证据库读取同一 hash，实时检查本人权限、复核记录仍有效且内容未变。预览和确认间任一字节或决策变化都需重新复核。浏览器提交的签字 ID、摘要、路径和操作者 UID 只作待比对输入，不作为事实源。撤权后不允许继续复核或签发。

| 事实 | 可复核材料与判定 | 签字责任 |
| --- | --- | --- |
| 旧 Cloudflare Gateway 已停用 | 只读 Cloudflare API 回读生产 route、active Worker/version 与入口实际绑定，记录状态和对象 ID；存在可服务的旧入口即失败 | 网关操作员采集，切换复核员确认 |
| 日本 Runtime 和 update timer 已停止 | 日本机 `systemctl show/is-active/is-enabled` 的服务、timer、相关更新触发器状态与时间；有运行进程或定时写路径即失败 | 原主机操作员采集，切换复核员确认 |
| 源库冻结 | 按 C2 对九库逐表两轮 `COUNT(*)`、`CHECKSUM TABLE`，两轮间隔至少五分钟，记录实例 ID、表清单、UTC 时间与逐表结果；不一致、遗漏或业务连接仍在即失败。`CHECKSUM` 的跨版本局限不用于替代 C5 dump 指纹 | 数据操作员采集，独立复核员逐表确认 |
| 新机入口仍关闭 | 新机 nginx 配置及只读 GET 回读均为维护页，Gateway 未向员工开放；与 C8/C10 阶段区分 | 新机操作员采集，切换复核员确认 |

CLI 仅当四组证据完整、绑定一致、两轮冻结比较通过、无未决活动时才构造 `mode=sealed`、`ingressDrained=true`；员工复核在导入后由 Platform 完成。快照仍使用现有 `enterprise-external-drain.v1` 字段：tenant/environment、非零 revision、`seal.cutoverKey/targetGeneration`、两个来源 actor（aims/assets 的 deployment 与制品 SHA-256）、counts/unresolved。证据清单 SHA-256 作为版本化扩展字段随**原始 JSON 字节**一起 HMAC；由 Platform 在导入后生成的 `reviewSetHash` 则绑定封存 payload hash、证据清单与 report/decisions hash，放入最终认可签名，不反写 CLI 快照。Platform 在接受前须验证证据库原始字节、四类材料摘要和服务端复核闭包，不能仅依赖当前 `snapshot.ingressDrained` 布尔值。生产 CLI 不模拟 coordinator 活动表：无相应来源的 counts 必须标明采集依据；未知活动或缺失证据失败关闭。

封存之后到 C6 激活前仍保持旧入口、原 Runtime 和新入口关闭；任何旧系统重启、route 变化、源库行变动、证据文件变化都使本次**窗口**作废。不能仅换 revision、销毁 HMAC 或签新信封：已签出的 Ed25519 信封仍可验签，必须经过下文的持久窗口栅栏撤销。C3–C5 恢复副本的指纹与封存源对应。

## 2. Provider 回执与冷存档

在新机**已恢复的副本**上，以专用只读 MySQL 账号调用现有 `collectProviderReceipts(connection,binding)` 和 `classifyProviderEvidence`；不连接原生产写库。`binding` 从受保护 profile、Platform 登记部署、目标 MySQL `@@server_uuid` 和已审 schema 映射构造，不能由浏览器提交任意库名。现有七项闭包为 aims、assets、finance、altoc、codocs、people、console；aims/assets 同时是两个 source，Console 使用 notification probe，其余 provider 用 receipt probe。报告 schema 为 `enterprise-provider-receipts.v1`，保留探测行/计数/逐行 SHA-256；Go 激活事务会重读目标库并比对。

Finance、People、Altoc 为已决定的冷存档：若未注册活动 deployment，列入 `unconfiguredProviders`，对应条目保持 `manual-required`，不得使用当前分类器中写死 `hzy-test` 路由/Worker 的自动 `not-applicable` 判定。人工决策必须逐项给出 `entryId`、`entrySha256`、`evidenceKind=deployment-inventory`（必要时加 provider-export）、`evidenceSha256`、可查的 `reference`、解释和 `verified-not-sent` 或有充分证据的 `verified-consumer-coverage`；只凭“冷存档”四字不通过。有该 app 的 source target、遗留外发、部署/路由不明时阻断，直到查明逐项结果。Codocs、Console 等仍须按实际已登记的 provider 处理，不能借冷存档跳过。

Webdev 不在固定七项，也不能作为第八项暗加到 K2-P/Go 合同。CLI 额外把 Webdev 与其他部署清单、Cloudflare routes/Service Bindings、Runtime appEnabled、grant 与调度/外发目标清单交叉核对，形成 `coverage:deployed-worker-versions-and-direct-bindings`、`coverage:scheduled-consumers-and-other-app-outboxes` 等人工材料；Webdev 有活动执行者、指向 Webdev 的未结发送或无法证明关闭时停签，须先另审七项闭包合同是否扩展。缺表仅可按 Go 已接受的 `ER_NO_SUCH_TABLE`/`ER_BAD_FIELD_ERROR` 标为人工待决，权限错误不冒充缺表。

`operation:*`、`notification:*` 和历史外发不能用概括性的消费者覆盖结案，需逐条 durable receipt 或 `verified-terminal`/`verified-not-sent` 证据。人工决策与材料文件的摘要、签字一并保存；Platform 重新运行分类器并比对每条 `entrySha256`，Go 再验证手工决策闭包和副本行指纹。

## 3. 签发、激活与重放

1. **CLI 封存**：输入受保护 profile、四组原始材料、源/恢复副本只读连接和 actor 制品清单。输出 `seal.payload` 的固定序列化字节、HMAC-SHA256、证据清单 SHA-256、provider 报告及人工决策草案；不输出密钥、DSN、token、业务正文。输出文件权限 0600，写入用临时文件、`fsync` 与原子改名，并防符号链接/替换。
2. **Platform 审批**：采集者导入原始材料；另一名已认证员工确认冻结的 `reviewSetHash`，可由该复核者在正式 `ops.deployments` 页面签发。当前 K2-P 已验证 HMAC、登记绑定、重新分类，把 `sealPayloadSha256`、完整 report/decisions、actorUid、approvalReference、requestId 放入 Ed25519 payload。实施时再签入窗口 epoch、`reviewSetHash`、签发/失效时间，并在服务端验证至少两人职责分离和材料闭包。
3. **激活前二次复核**：批准签发后，cutover CLI 对旧 Gateway route/active Worker、日本 Runtime 与 timer、源库逐表 COUNT/CHECKSUM 及新 nginx 维护页**重新读取**；源库结果逐表与封存第二轮一致。专用员工复核后，由 Platform 对 `approvalPayloadSha256`、窗口 epoch、`reviewSetHash`、新材料清单 hash、完成时间签发独立的 `enterprise-offline-drain-activation-check.v1` Ed25519 证明。任何差异立即使窗口进入 `invalidated`；副本 probe 相同不能替代旧入口或原库复核。此证明只供 Go 首次激活使用，不改变已签认可字节。
4. **Go 激活**：离线审批与二次复核证明由 profile 中固定的 Platform kid/公钥验签。激活事务锁定下述窗口栅栏、检验 epoch/hash/状态/时效，再由 `SQLApprovedExternalDrains.VerifyExternalDrain` 校验 source/provider 闭包并重读**恢复副本**行。两份签名 payload hash、证据库材料 hash、Platform 复核/审批记录 ID、Go 回执 hash 串成审计链；M8 前不得开放入口。

### 3.1 当前窗口与失效栅栏

新增新主机控制 schema 的 `enterprise_cutover_windows` 表，**不属于从日本恢复的业务库或演练重建范围**，由 Platform 正式 ops 流程和 Go 激活工具共享；仅受控流程能写。唯一键为 tenant/environment/target instance/targetGeneration，加独立 `windowId`（cutoverKey）、递增 `epoch`、状态、认可 hash、复核 hash、有效期和激活回执 hash。Platform 废止与 Go 激活都在同一 MySQL 实例上 `FOR UPDATE` 锁该行：先提交废止者使旧信封在 Go 处失败；先提交激活者产生唯一激活回执，随后废止不能抹掉该回执。状态缺失、未知、锁/控制 schema 不可用时一律拒绝激活；实施前须确认统一库激活事务可访问控制 schema，权限仅限所需锁读/状态转换，做不到则另审方案。控制 schema 单独备份，业务 dump/恢复绝不覆盖它；若控制库被恢复、目标重建或连续状态无法证明，必须暂停激活并重新建立窗口、采证和审批，**不能直接沿用旧控制库备份、旧 profile 或旧信封**。本方案防受控流程中废止后误用旧认可，不宣称抵御 root/DB 管理员同时回滚整机与信任配置；这种管理员级事件另立安全范围。

允许的状态转换：`draft → sealed → approved → activated`；`draft/sealed/approved → invalidated`；`invalidated` 和 `activated` 无回退边。证据失败或旧入口重开必须先提交 `invalidated` 状态与 epoch 增量；下一窗口用**新 cutoverKey/windowId、增量 epoch**从 `draft` 开始，targetGeneration 在首次成功激活前**保持原值**，只有成功激活才由既有 generation 机制推进。窗口唯一键指向当前 epoch，同时保留旧 epoch 的不可删除历史；旧 profile/旧认可 A 即使签名、未使用副本与原 generation 都匹配，也因当前 epoch/windowId/status/hash 不等而被 Go 拒绝。Platform 不能对相同 windowId/revision 用新 requestId 改签材料；同一认可仅可按既有 payload hash 原样重放。成功激活后同一认可/同一回执 hash 的**只读查询**可幂等返回；不再次执行激活写入，也不把它当作新窗口许可。

### 3.2 时效与再检查

统一以新主机经受管 NTP 的 UTC 时间为裁决时钟；采集器同时记录单调耗时和各来源时钟，Cloudflare 响应时间、原主机时间、MySQL `UTC_TIMESTAMP` 与新机偏差超过候选 30 秒或无法验证则停。所有探测记录**最早必要观测开始时间**、最后完成时间和采集跨度；五分钟冻结间隔按采集器单调时钟测量，不能信任文件内自填时间。签名时间只作上限，绝不重新起算原观测寿命。

| 阶段 | 证据目的与数据位置 | 时效/校验 |
| --- | --- | --- |
| C2 冻结基线 | 原日本九库逐表两轮 COUNT/CHECKSUM，至少间隔 5 分钟；旧 Gateway/Runtime 停止及新 nginx 维护页 | 是**历史基线**，随原始材料和最早观测时间入封存清单，不直接作为 C6 当前状态证明；两轮每表一致 |
| C3–C5 最终 dump/恢复 | 原库停写后的最终 dump 与恢复前副本比对；C5 对应逐表 COUNT/导出指纹 | 证明原库到恢复副本数据对应；schema 升级后不能拿全表 checksum 与原库逐字比较，需依迁移回执、前后数据校验与 source/provider probe 闭包 |
| C6 升级与 provider 采集 | 升级后新机副本的 `collectProviderReceipts`、分类、人工决策 | report 绑定副本 instance/部署/schema 与封存源制品；Go 激活事务再次读取副本 probe；无法证明旧入口仍关闭 |
| 批准前当前状态复核 P | CLI 重读原 Gateway/Runtime/timer、新 nginx 和**原库**逐表 COUNT/CHECKSUM；与 C2 第二轮逐表比较，再签封存/导入复核/批准 | 对最早观测 P.start 及 P.end 计算跨度和截止；不能用 P.end 遮盖早扫的表。候选采集跨度上限 10 分钟、P.start 起有效 30 分钟 |
| 签发后激活前复核 Q | 同样重读四类当前状态，原库逐表结果仍与 C2 一致；形成绑定批准 payload hash 的独立签名证明 | 对最早观测 Q.start 及 Q.end 计算跨度和截止；候选跨度上限 10 分钟、Q.start 起有效 10 分钟，证明签发后候选 2 分钟内激活 |

认可候选最长从 `approvedAt` 起 15 分钟；Go 首次激活的实际截止时间是 `min(P.start+30m, Q.start+10m, approvedAt+15m, activationCheck.signedAt+2m)`，同时要求 P/Q 各自采集跨度不超过候选 10 分钟。未来时间超过候选 30 秒、两轮冻结间隔不足、任一证据或认可超期均拒绝。10/15/2 分钟、30 秒及 P 的 30 分钟**均为待 S3 演练验证的设计候选**，并非现有生产测量；实施可用经审查的固定配置与不可越过的严格上界，浏览器请求不得放宽。隔离开发与测试可先用合成时钟验证规则；真实 S3 测出全库扫描更久时，先修订时限/操作顺序并重新审查，不能现场私自延长。

Q 证明签出后如旧入口、Runtime 或新入口重开，必须立即作废窗口；因此还需控制面变更冻结和激活事务前的受信当前状态回读。当前 Go 仅重读恢复副本、不能感知 Cloudflare/旧主机：实施必须由 CLI 在 Go 事务开启前采集 Q，并由 Platform 签名；Go 在事务内检验 Q 的原始观测年龄和窗口栅栏。**这只证明观测时刻的状态，不是对随后外部管理员变更的自动防护**；切换窗口禁止其他管理员修改旧入口与服务。若无法落实变更冻结或受信 Q，就不得激活。激活完成后、M8 开口前再次回读四组状态，变化即保持维护页并启动事故处置，不用旧认可继续操作。

## 4. 威胁与拦截点

| 威胁 | 拦截 |
| --- | --- |
| 伪造停机或自填 `ingressDrained` | 只读回读、两轮冻结、双人复核、证据清单闭包、CLI HMAC；Platform 不采信裸布尔值 |
| HMAC 泄漏或拿测试密钥生产签发 | 独立生产一次性密钥、限定主机/身份/文件、与 Gateway token 比较拒绝、事后销毁和签发审计 |
| 旧快照复用、同键换材料 | tenant/env/cutoverKey/generation/revision/instance/actor 制品绑定；Platform 唯一键与独立控制 schema 当前窗口行；Go 事务内拒绝已废止 epoch。管理员级整机回滚不在本轮保证内 |
| 篡改报告、手工决策或证据文件 | 固定 report/probe 行 hash、entrySha256/evidenceSha256、原子 0600 文件、Platform Ed25519 签名、Go 事务重读；文件摘要不匹配即停 |
| 错租户、错环境或错部署 | profile、Platform 登记事实、MySQL instanceId、签名 payload 与 Go verifier 逐层精确相等；不把客户端字段当登记事实 |
| 封存后写入、外部发送结果不明 | 持续关闭旧/新入口，C5 数据指纹与 Go 源/provider 行重读；未知外发为 manual-required/blocked，不能由时间推断成功 |

## 5. 最小实现与 S3 验证

设计审过后另派实现，预期分四批：①生产离线 CLI、证据 schema/固定序列化与受控 systemd credential（建议 `deploy/self-hosted/cutover/`）、材料格式测试；②Platform 证据导入/不可变存储、双人复核、`enterpriseExternalDrainApproval.ts` 的控制 schema 窗口状态、签名与二次复核 BFF/UI；③Go `cutoverprofile/profile.go`、`unified/external_drain_contract.go`、`external_drain_verifier.go` 增加窗口 epoch、两份签名/观测时效校验和事务内状态转换，不放松七项闭包；④S3 全链演练、Runbook/切换协议与失败回退说明。`enterpriseProviderReceipts.mjs` 复用分类器，但把测试环境硬编码的未配置判定改为登记事实驱动。移除新硬件/broker 后，预计代码/合同与隔离测试约 **6–9 人日**，S3 两轮演练与故障注入另需 **2–3 人日**；跨 schema 可用性、员工 UI 材料量和全库复核耗时须实测，超出则重新估算，不压缩安全关口。具体文件名与角色权限在实现审查时冻结。

测试至少包括：隔离 MySQL 中 source/receipt/notification 多状态及事务重读、窗口锁/废止与激活并发线性化、控制行缺失/未知/控制库恢复后拒绝；TS 封存/HMAC/Platform 两份签名 → Go `VerifyEnvelope` + `VerifyExternalDrain` 跨语言夹具；签发 A→旧入口重开→废止→B→旧 A 激活失败，以及已激活原回执只读重放；四类停写材料缺一、两轮间隔不足、最早观测超龄但完成/重签时间新鲜、签发后旧入口/原库变化但副本 hash 不变、超期/未来时间、wrong tenant/env/instance、文件替换、同键换 report、自我复核/伪造签字/跨窗口签字/撤权、预览后改报告、人工决策不完整、Webdev 活动路径、冷存档伪自动通过均失败。S3 在**生产数据的已恢复演练副本**上走完整 CLI → 两名员工身份导入/复核 → 测试密钥/测试 Platform 签发 → 二次复核 → Go 隔离激活演练，记录耗时、文件 hash、停止/恢复步骤；S4 使用新密钥和新证据重新采集，不复用 S3 材料。任何 S3/S4 云端、生产或新主机写入仍需对应 M 项用户批准。

## 6. 用户决定（2026-09-29）：采用精简实现 B

一次性离线切换、单一企业、旧系统切换时完全停写，故采用精简实现：
- **保留**：①离线证据 CLI（`a150b370`）；证据摘要经 Platform 现有审阅页导入并由有 `ops.deployments` 权限的员工审阅；K2-P 签发 `enterprise-external-drain-approval.v1` + Go `VerifyEnvelope` 与激活事务内七项闭包复核（不放松）。
- **省略**：双人复核 UI、Go 端窗口 epoch 与二次签名时效状态机（§3.1–3.2 中的多窗口并发部分）。
- **补偿控制**：S4 使用全新 Platform 签名密钥并在 profile 中登记其指纹；每个 cutoverKey/generation 仅签发一次，S3 材料不复用；证据文件 0600 并记录 SHA-256 于执行回执；签发与激活在同一维护窗口内完成，窗口外撤销签名密钥；全过程逐步记入 runbook。
- 实现后仍须 Claude 安全审查与 S3 全链演练。


**精简方案 B 实现边界（2026-09-29）**：`deploy/self-hosted/cutover/provider-report-cli.mjs` 从恢复副本只读采集 provider 回执；`seal-cli.mjs` 从 0600 的 P 阶段材料、profile、actor 清单及四份冷存档人工材料生成封存证据与请求。Platform 在既有 `ops.deployments` 审阅页按原始字节 SHA-256、M4 闭包、provider 分类、四项冷存档人工确认、profile kid/公钥指纹复核；数据库按 `(tenant,environment,cutoverKey,targetGeneration)` 唯一保存签名制品，同请求只回放原签名。Go `VerifyEnvelope` 和激活事务七项复核未改动。原 §§1–5 中双人复核 UI、窗口 epoch、二次签名时效状态机为未实施的较强方案，不作为精简方案 B 的执行步骤。现场仍须验证原始采证来源、观察窗口与生产 Platform systemd credential，不能用合成观测文件作为实际停写证明。
