# 生产 Aims 退役与文档修复发布执行单

状态：待用户逐项批准；本文件不授权执行。2026-10-07 仅完成生产 SELECT 核查，无生产写入。hzy0 本批已全部验收通过（HR002 水印包含本批）；文档45正文保留为生产验收项。

## 1. 冻结基线与范围

最终代码基线已冻结为集成头 `0dddf8017daffffe13f3c89f990e85397183fe60`，包含 Aims R1–R4、文档修复和 HR002 水印。`RELEASE_SHA` 必须取此完整值，不跟随远端新头移动。Runtime 生产递增版本、六件发布版本、Linux 制品清单及各 SHA-256 在 AR01 构建后记录；未构建制品不能冒称已校验。本轮 Runtime 与 Console/Workflow/Codocs/Enterprise/Collab/Gateway 六应用同 SHA，不构建/启动 Aims。

保持 prod39、现有人员权限、Collab 两类开关/精确绑定、现有 schema、所有数据及其它 scheduler 配置。无 Platform manifest 发布/签包、无 APF 安装/迁移或新凭据轮换。文档45生产验收依赖已登记 GitLab integration；仓库权限仍按 owning 核心复核。

## 2. 生产 grant 只读 Verify

核查时间 2026-10-07T22:54:27.674Z；hzy_ro_audit / hzy_console，仅 SELECT。绑定 C000001 / C000001-prod-enterprise；enterprise.runtime 唯一 active。原始受保护证据 `.git/prod-aims-retirement-grant-verify.json`，只读脚本 `.git/verify-prod-aims-retirement.mjs`。

| resource | action | audience | semanticScope | active/总行 | 处置 |
| --- | --- | --- | --- | --- | --- |
| data-runtime:aims:integration_operation | execute | data-runtime | aims:integration_operation:execute | 0/0 | 待批新增 |
| data-runtime:aims:milestone-rollover | execute | data-runtime | aims:milestone-rollover:execute | 0/0 | 待批新增 |
| data-runtime:aims:notifications-due | execute | data-runtime | aims:notifications-due:execute | 0/0 | 待批新增 |
| tenant-runtime:aims:integration_operation | execute | tenant-runtime | aims:integration_operation:execute | 0/0 | 待批新增 |
| tenant-runtime:aims:milestone-rollover | execute | tenant-runtime | aims:milestone-rollover:execute | 0/0 | 待批新增 |
| tenant-runtime:aims:notifications-due | execute | tenant-runtime | aims:notifications-due:execute | 0/0 | 待批新增 |
| workflow:work-item-complete | create | workflow | workflow:work-item-complete:create | 0/0 | 待批新增 |
| workflow:action_defs | sync | workflow | workflow:action_defs:sync | 0/0 | 待批新增 |
| codocs:product-document | create | codocs | codocs:product-document:create | 1/1 | 保留 |
| codocs:company-weekly-summary | publish | codocs | codocs:company-weekly-summary:publish | 1/1 | 保留 |
| notifications | publish | notifications | notifications:publish | 1/1 | 保留 |
| data-runtime:aims:scheduler | execute | data-runtime | aims:scheduler:execute | 1/1 | 保留 |
| tenant-runtime:aims:scheduler | execute | tenant-runtime | aims:scheduler:execute | 0/0 | 待批新增 |

结论：13 tuple，4 已满足、9 缺失；目前没有重复/冲突/撤销行。保留行 ID：notifications 104437608、product-document/create 104437669、company-weekly-summary/publish 104437675、data-runtime callback 104437687。

采用 console/docs/sql/Console-SQL-{Seed,Verify}-aims-host-r1-candidate.sql 与 callback-candidate.sql。从冻结 SHA 取文件，不执行旧 P1 全量 seed。执行环境参数固定为 C000001 / C000001-prod-enterprise，禁止 hzy0 deployment 值。

R1 Verify 仅对三项 integration_operation/milestone-rollover/notifications-due 接受枚举别名 aims:<resource> 或标准 audience 前缀；action/status/client/audience/semanticScope/tenant/deployment 全部一致才算满足。Callback Verify 不接受别名。alias 行按语义 tuple 复用，不新建重复行。

7008449 是 hzy0 先例，不是生产 ID，也不是本轮批准自动恢复模板。生产执行前再次 Verify：0/0 可按批准新增；0/>0、重复、revoked、缺绑定等冲突停止。若出现原撤销行，先列精确 ID/撤销原因/完整绑定，用户单独批准仅该行恢复 active；不修改 scope_json、不复活 client、不用 Seed 覆盖。

## 3. 批准清单

| 编号 | 动作与批准范围 |
| --- | --- |
| AR01 | 同 SHA Linux 构建 Runtime + 六应用、上传受审制品；冻结所有路径/版本/hash |
| AR02 | 加密备份 Console grant/client 元数据、相关业务库、Runtime/Gateway/env/unit/制品；解密核验；冻结旧 current/enable/PID/配置 hash |
| AR03 | 仅新增上述 9 个缺失 tuple；保留现有 4 行，禁止其它授权变动；前后非目标行摘要相同 |
| AR04 | 暂停 Gateway Aims wake/旧生产者新增，按旧 owner 和原键收尾旧 outbox；有业务副作用，逐项记录回执 |
| AR05 | 开维护窗口，配套发布 Runtime+六应用；Runtime 重启会连带停所有依赖服务 |
| AR06 | Runtime enterprise.aimsDeliveryWorker 切 Enterprise 精确身份；Gateway scheduler.aimsExecutor=enterprise；两项 Runtime legacy=false |
| AR07 | 关闭 Codocs 旧 aims 来源兼容；同步移除仅 Aims 退役相关的依赖/健康要求；不改其它鉴权 |
| AR08 | stop + disable hzy-aims.service，保留单元、env、旧包及回滚；不删除数据/凭据/grant |
| AR09 | CLAUDE-FIXTURE 管理员/员工/经理与双人 Collab 验收，产生少量标记数据；禁止真实财务写入 |
| AR10 | 恢复原 cron 开关（owner 改 Enterprise），观察及提交执行记录，仅 GitLab |

AR01–03 可合并一次批准；AR04–08 可合并维护窗口批准；AR09–10 可合并验收收尾批准。是否合并由用户决定。生产撤销行恢复若新发现必须另列，不含在 AR03。

## 4. 执行顺序与门禁

1. 冻结 SHA 后在 Linux 干净 worktree：`node deploy/self-hosted/build.mjs --commit "$RELEASE_SHA" --version "$RELEASE_VERSION" --out "$ARTIFACT_DIR" --apps console,workflow,codocs,enterprise,collab,gateway --aims-retired`。同 worktree 构建 Runtime 与窗口内全部工具（含 verify-views）。禁止运行时联网安装。校验 lockfile、manifest、归档 hash、所有工具 --help/verify 及可执行权限、六应用输出入口与动态路由完整性；所有参数必须在开窗前展开并记录，不允许占位符进入窗口。
2. AR02：按已有生产加密备份流程，新建专用时间戳目录，备份配置/current symlink、systemd unit/drop-in、Console 授权表和业务库；受保护密钥仅进程读取。全流解密 bytes/hash 一致，空间预算通过；备份失败不开窗。记录系统当前 hzy-aims enable/active 和依赖，不输出 EnvironmentFile 内容。
3. AR03：再次 SELECT Verify；备份 service_client_grants 全表，按批准最小 Seed 插入 9 条，记录 inserted ID；13 tuple 全为1/1且client=1，整表非目标 hash 不变。真实 Enterprise client 逐13 tuple签发并核对 audience/semanticScope/source/tenant/deployment，只记状态及技术摘要，不打印 token。
4. AR04：只暂停精确 Aims wake 与新旧相关生产者，不停其它业务 scheduler。记录旧 outbox 的原 deployment/key/hash/版本受保护摘要，按正式 probe/recover/drain 原键收尾；不 SQL 改状态、不改 deployment、不创建替代 operation。包括九类可靠网络任务、旧 callback、反馈/成本/贡献/可开票/工单等已舍弃族的旧命令；未知/死信/partial_unknown 不算零。独立 Workflow owning 队列若 hzy_ro_audit 无权限，使用正式诊断端点，不扩大账号授权。未收尾则不退役 Aims，报告阻塞。
5. 停机前通知协调者。AR05：冻结更新 timer 与自动启动源（保留原值）；按已审维护流程停止依赖与 Runtime，切精确 current 指针及配置。`release.mjs` 会逐应用重启，不能直接用来制造新旧混跑；维护 runner 必须按六件统一窗口装配后再逐层启动，runner SHA冻结。
6. AR06：Runtime `enterprise.aimsDeliveryWorker={"deployment":"C000001-prod-enterprise","serviceClientId":"enterprise.runtime"}`；`allowLegacyAimsCallbacks=false`、`allowLegacyNotificationDetails=false`；Gateway `scheduler.aimsExecutor="enterprise"`。保持 generation、schema、其它 flags 和 grant 不变。旧 owner 不再 claim；不得临时开双 owner。
7. AR07：Codocs 设置 `HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED=false`；实际 EnvironmentFile 路径从现网 unit 读取并冻结，不猜测路径。构建参数 `--aims-retired` 与六应用清单必须一致（index 不序列化该布尔字段，核验 packages 精确集合）；Gateway `drain.apps` 保留逻辑 aims，由 `scheduler.aimsExecutor=enterprise` 改投 Host，不能移除该项导致停调度。开窗前生成精确 diff 并审定。扫描 systemd Wants/Requires/PartOf 与健康脚本，不能停止 Aims 又让 Gateway 每次重启拉起它，或将其缺席误判健康失败。仅修改 Aims 相关引用，`systemd-analyze verify` 后 daemon-reload。
8. AR08：`systemctl disable --now hzy-aims.service`；回读 `systemctl is-enabled hzy-aims.service` 为 disabled、`systemctl is-active hzy-aims.service` 为 inactive，确认原监听端口关闭。不要 mask/delete。Runtime→Console→Workflow/Codocs/Enterprise/Collab→Gateway 依次启动并健康；Runtime 重启自动恢复依赖机制仍应有效，但不得自动复活 Aims。
9. AR09：下节矩阵通过，AR10 才恢复原精确 Aims cron 开关（Executor Enterprise）及更新 timer；连续三轮本机/公网健康、60秒 PID稳定、142视图或冻结映射实际数量一致，无新 legacy 拒绝/5xx；记录本次所有前后值、包hash、grant ID和回执。通知用户复验。

## 5. 验证矩阵

- machine wake：正确 Gateway 签名/Enterprise部署/tenant/generation通过；匿名、伪造、错tenant/deployment、旧worker、过期签名/凭据、缺精确scope均失败关闭；claim/ack/fail fencing、原键重放、不双投。
- callback：两条精确 owning入口、正式 Workflow completed_at 载荷和重放通过；未知字段/业务类型/错误身份拒绝；旧 source lane 关闭，正式历史 app_code 与原键不篡改。生产队列与回执实际计数另记，不套用hzy0的31/34。
- 通知：站内/企业微信绝对链接、详情purpose、action-def同步；仅测试收件人，禁止群发。
- 员工/经理：Host项目与项目集树、部门文档直接active成员/leader写，非部门/停用/只读/回收/撤权拒绝；普通员工无APF权限，prod39不变。
- 文档：sent从document_shares读取；项目257文档45（若生产该ID仍存在且同归属）access-check与原生repository-read成功；开放部门选择器；同部门与个人双Chrome协作，撤权断开；无跨项目/跨部门泄露。生产实际对象须先核归属，不假定hzy0 ID就是生产验收对象。
- GitLab生产核查：2026-10-07T22:52:31Z，hzy_console中gitlab.default唯一gitlab集成且active，primary绑定/secret/version均存在active；未读密文/账号、未调GitLab，因此凭据有效性与仓库可读性需正式文档读取验证。禁止复制生产token到hzy0。
- HR002水印已在hzy0真实登录验收通过，本批包含修复。hzy0本批整体验收已获用户确认；文档45正文仅在生产验证，不将 hzy0 缺 GitLab 集成的失败当作代码验收通过。生产真实浏览器仍待本窗口用户验收。

## 6. 失败回滚

任一步失败即停止认领/新增，记录已完成外部副作用，禁止自动倒回业务库掩盖回执。恢复加密备份中的旧 Runtime/Gateway owner 与legacy/env、旧current包与unit/drop-in；daemon-reload；恢复原Aims enable状态并启动旧owner，确认新owner不能领取且只有一个执行者。按原服务启动顺序恢复健康，Aims监听/六件/Collab均核对，恢复原scheduler/timer开关。新增grant仅在核验无后续依赖后按 inserted ID + 全tuple谓词删除；既有4行不动，单独获批恢复的撤销行恢复原状态。已交付业务结果和原回执保留，非本次DDL无需库全量恢复；若确需库恢复必须先处理窗口内已提交业务，另报告。

恢复后通知协调者，附旧版本/配置hash/单owner与健康证据。本轮不删旧Aims包/env/unit，保证回滚路径。执行记录只推GitLab。


## 7. 最终批准摘要（0dddf801）

用户可回复“批准 AR01–AR10”，或按编号逐项批准。本轮申请精确范围：

1. **AR01 构建与上传**：冻结 SHA 的 Runtime + 六应用，Linux 同 SHA，所有窗口工具预检；不含 Aims 包、不涉及 Platform。
2. **AR02 备份**：生产受影响库/授权/配置/unit/现有包加密备份并解密核验；记录完整回滚基线。
3. **AR03 授权**：仅表中9条缺失 grant；4条已有效保持原样；无新增 capability/人员权限、无 rev39 重签。执行前再次 Verify，任何冲突/撤销行另报，不自动恢复。
4. **AR04 原键收尾**：暂停精确 Aims 新增/唤醒，旧 owner 正式路径收尾旧 outbox；未收尾不得停 Aims。
5. **AR05 发布窗口**：同 SHA Runtime+六应用配套更新，包含连带停机；失败恢复旧版本并验证健康。
6. **AR06 切单 owner**：Runtime worker 精确切 enterprise.runtime/C000001-prod-enterprise，Gateway executor=enterprise，两项 Runtime legacy=false。
7. **AR07 收口旧来源与依赖**：关闭 Codocs 旧 Aims 来源，仅移除 Aims 退役相关 systemd/健康依赖；其它鉴权、Collab和scheduler不扩大。
8. **AR08 停进程**：stop+disable生产hzy-aims，保留旧unit/env/包，验证不会被依赖自动拉起。
9. **AR09 生产验收**：标记测试对象、员工/经理、双Chrome Collab、文档45原生正文与HR002水印；通知仅测试收件人。
10. **AR10 恢复与记录**：恢复原定时调度开关与更新timer（Aims executor改Enterprise），观察单owner/健康/稳定，提交执行记录到GitLab。

仍待执行前生成的技术附件：同 SHA Linux 包hash、实际生产版本号、AR06/07精确配置/unit diff、维护runner hash与工具预检。它们不得引入新授权、DB schema或范围变化；若超出上述范围则停止报告。生产 grant 现状仅为2026-10-07只读快照，执行前必须重验。


## 8. 每项前置条件、通过标准与回滚边界

| 批准点 | 前置条件 | 通过标准 | 失败处置 / 回滚 |
| --- | --- | --- | --- |
| AR01 | 冻结完整 SHA；Linux Node 与 lockfile 匹配 | Runtime commit、六包 manifest commit 均等于 0dddf801；构建 --aims-retired 且 packages 无 aims；工具全部可运行；动态入口完整 | 不进入窗口；重建同 SHA，不改线上 |
| AR02 | 受保护备份目录；空间满足备份、制品和日志预算，至少 20 GiB | 配置与库全流解密 hash/字节数一致；旧 symlink/unit enable/active 已冻结 | 不停机、不写 grant；保留现状 |
| AR03 | 新备份；实时 Verify 与 §2 无冲突；用户批准九条 | R1 seed ROW_COUNT=8、callback seed ROW_COUNT=1；13 tuple 全满足；非目标全字段排序摘要不变；全部 scope 真实签发通过 | 停止；仅精确撤销本轮 inserted ID，保留原四行；不得修改任何原撤销行 |
| AR04 | AR03 通过；精确暂停入口清单与旧 owner 已核对 | 已登记每个可靠命令族与 callback 的待投/租约/partial_unknown/死信均清零；外部回执确认 | 恢复原暂停开关与旧 owner；未知状态报告，不直接改库 |
| AR05 | 全套 plan-only、路径、UID/GID、工具与备份通过；通知已发送 | 同 SHA 装配；无新旧混跑；按依赖顺序启动 | 恢复旧包/current 与 Runtime；按 §6 恢复健康并通知 |
| AR06 | 旧队列清零；新 grant 与新二进制就绪 | 只存在 Enterprise owner；Gateway executor、两项 legacy 实值准确 | 停新 owner；恢复原配置后才恢复旧 owner，禁止并行 |
| AR07 | 冻结 Codocs env 与 Aims 专属 unit/健康 diff | 新 Enterprise 来源通过、旧 Aims 来源拒绝；systemd 验证通过；无隐式 Aims 拉起 | 恢复原 env/unit/drop-in 与健康配置；daemon-reload |
| AR08 | 新 owner 的正反探测通过；依赖已收口 | Aims disabled/inactive、原端口关闭，重启依赖服务不复活 Aims | 恢复备份的 enable 状态与旧 owner；先停止新 owner |
| AR09 | 技术门禁通过；真实用户登录；标记对象归属已核对 | §5 人员/机器/文档/协作矩阵通过；通知只到测试收件人 | 停验收写入；保留回执与已完成结果；按失败范围回滚代码/配置 |
| AR10 | AR09 通过 | 原调度恢复但唯一执行者为 Enterprise；三轮健康与 60 秒稳定；执行记录完整 | 再暂停精确 wake；恢复旧 owner 配置与服务，不放宽 scope |

授权 SQL 必须整文件交 MySQL 服务端解析。设置 `@r1_tenant='C000001'`、`@r1_enterprise_deployment='C000001-prod-enterprise'` 后分别运行冻结 Seed；不得客户端按分号拆分。ROW_COUNT 与预期不符立即停止，即使文件内 COMMIT 已完成，也只能按备份差集和 inserted ID 精确恢复。新增行回滚谓词须同时限定 ID、enterprise.runtime client、resource/action 与四个绑定字段；不能仅按 resource 删除。

本轮不增加 schema。Aims 两表与 billing 列等既有安装结果只读 verify，不重跑已完成 DDL；公告四表、公告 manifest/test49 不属于此生产基线。本轮保留 prod39，不签 prod/test。

## 9. 交付与批准方式

执行单已具备申请批准所需的范围、只读 Verify、精确九条新增授权集合、单 owner 配置合同、顺序、验收和回滚。构建产物版本/hash、现网配置路径与维护 runner 是执行准备附件，须在停机前冻结并通过只读预检；当前未生成，不能宣称已完成生产发布准备或已经上线。

建议协调者将 §7 的 AR01–AR10 原样提交用户，可逐项回复「批准 AR03」等，也可明确批准组合。AR03 不包含任何现有 revoked 行恢复；新发现的撤销行或授权冲突单列请示。所有生产写入等待批准，本次交付没有生产写入。


执行前源码核对更正：逻辑 scheduler.drain.apps 的 aims 必须保留，只有物理服务依赖移除；build index 没有 aimsRetired 字段，以参数与六包集合核验。两项不改变批准范围。

续行工具口径：队列核对优先使用主机已有 `mysql` 客户端和受保护只读 defaults 文件，固定 SQL 放在独立工具目录；`START TRANSACTION READ ONLY` 后仅执行 SELECT/SHOW，结束 ROLLBACK。临时 defaults 权限 0600、所在目录 0700，用后删除；凭据不进 argv/输出。无需向线上 Console 包安装 mysql2。若确需 Node 工具，则独立目录按冻结 lockfile 装配依赖，不修改运行包。

## 10. 2026-10-07 已批准执行回执

用户批准 AR01–AR10 后执行。部署源码为 `0dddf8017daffffe13f3c89f990e85397183fe60`，Runtime `0.3.229`；Console、Workflow、Codocs、Enterprise、Collab、Gateway 六包均为同 SHA Linux 构建。

| 项目 | 实际结果 |
| --- | --- |
| AR01 制品/工具 | 六包 hash/manifest/入口通过；2435 编译文件、16527 相对导入、2083 动态导入目标完整；窗口内工具可运行 |
| AR02 备份 | `/home/hzy/backups/aims-retirement-20261008T012928Z`；四库及配置、unit、旧制品加密备份，全流解密 hash 与归档完整性通过（目录时间为 UTC） |
| AR03 grant | 新增 9 行：104437710–104437717、104437725；原4行不变，13 tuple Verify 通过，非目标全字段摘要不变；单 scope 与同 audience 组合真实签发均通过 |
| AR04 在途 | Aims operation 无在途；Workflow Aims callback 仅1条 success，无待收尾；其它 Console 死信保持原样，未触发 drain/replay |
| AR05–AR07 | 六包同候选；Runtime worker 为 enterprise.runtime/C000001-prod-enterprise，Gateway aimsExecutor=enterprise，逻辑 drain.apps 的 aims 保留；两项 Runtime legacy 与 Codocs legacy 来源关闭 |
| AR08 | hzy-aims disabled/inactive，31004 关闭；保留原 unit/env/制品及回滚备份 |
| 技术健康 | 1028 个实际 HTTP 编译模块通过（Console89、Workflow44、Codocs296、Enterprise599）；视图工具通过；本机三轮健康、60秒 PID/重启计数稳定；公网 readyz 通过 |
| AR09 | **待用户真实员工/经理及双 Chrome 验收**：sent、项目257文档45正文、HR002水印、个人/部门协作；未声明业务验收通过 |
| AR10 | 原 scheduler 保留，执行者为 Enterprise；备份 timer 恢复。业务验收完成后补最终结论 |

首窗因 HTTP smoke 假设 Enterprise 静态目录为 `public/_nuxt` 而失败；实际为 `public/enterprise/_nuxt`。自动恢复旧 .228/f446c748、原8服务、配置/二进制 hash 与健康，本轮首批9行精确删除。修正 smoke 并增加冻结候选目录 plan 检查后，重新备份、授权和执行，第二窗成功。此根因发生1次。

既有 Runtime recovery drop-in 的无后缀 Wants 项有 systemd 无效依赖警告；本轮仅移除 Aims 项，按明确服务顺序启动并验证健康，未扩大 unit 修订。Collab、prod39、业务数据、schema、其它调度保持；没有 APF 安装、迁移、签包或凭据轮换。

停机开始、首窗恢复、第二窗开始与技术窗口结束均已通知协调者，send 返回 accepted=true。原 §9 描述为批准前交付状态，以本节实际执行回执为准；AR09 尚待完成。
