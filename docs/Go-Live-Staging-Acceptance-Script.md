# 10/8 云端预发联合验收执行脚本

状态：待执行。适用窗口为 2026-10-02～10-05，目标为 **C000001 云端预发**及经批准的 C000002 或等效隔离租户。本文件只规定步骤和判定，不记录环境已通过，也不授权部署、授权写入、重启、故障注入、备份恢复或创建测试租户。九项门禁均取自[上线计划 §3](./Go-Live-20261008-Plan.md)；[本机试点结果](./Unified-Enterprise-Pilot-Acceptance-Result-20260927.md)只用于准备样本和反例，不能替代云端证据。执行人 Codex-sol，整合签字 Claude，岗位业务验收由用户完成。

## 0. 执行卡与证据约定

执行前由环境拥有方填写下表；任一必填项空缺，不开始对应写入、授撤权、故障或恢复步骤。所有浏览器/API 操作均经**预发公网 Gateway 正式入口**，在该入口下记录实际请求 METHOD、路径、状态和 correlation ID；Cloudflare Access 的登录 302 不是业务成功，Worker 直连缺 Gateway 上下文的 403 也不是正常入口结果。

| 变量 | 执行前登记的值与约束 |
| --- | --- |
| `RUN_ID`、UTC 起止、执行人 | 唯一标记，例如 `STG-20261002-01`；所有业务样本名称带此标记 |
| `BASE_URL`、`TENANT_A`、`DEPLOYMENT_A` | C000001 云端预发正式入口、实际 tenant/deployment；不得填本机 hzy0 地址 |
| `TENANT_B`、`DEPLOYMENT_B` | C000002 或等效隔离租户的**已批准**预发入口与绑定；没有则门禁 9 阻断 |
| `SOURCE_COMMIT`、六个制品版本/hash、schema/generation | 从最终干净提交重新构建的 manifest 与云端实际回读；`/tmp` 旧 manifest 不可填入 |
| `PM_UID` / 项目经理 | `zhouguangying` 仅在云端当前授权与项目经理关系回读确实匹配时可用；否则登记实际独立账号 |
| `MEMBER_UID` / 成员 | 有目标项目 active 成员关系、仅完成其应做动作的独立账号；`test` 仅在云端基线核实后可用 |
| `APPROVER_UID` / 审批人 | 与发起人不同的独立账号，拥有 `workflow_tasks:approve/reject` 与当前任务指派；不能以项目经理自行审批充数 |
| `DENIED_UID` / 无权账号 | 无本轮目标项目读写及 Workflow 审批权的独立账号；如临时角色轮换，必须先撤上阶段本轮授权并取得拒绝证据 |
| `PROJECT_A`、`MILESTONE_A`、`WORK_ITEM_A` | 可清理的预发项目、用于 W0 直改拒绝的里程碑和可申请完成的事项；记录 ID、版本、成员、经理、审批关系、对象范围与初始状态 |
| `PROJECT_B`、`WORK_ITEM_B` | 另一租户内可安全使用的对象；刻意使用与 A 相同的对象 ID，正文/标题加不同租户标记 |
| `EVIDENCE_ROOT` | 受控证据库的实际 URI，目录约定为 `staging-acceptance/C000001/<RUN_ID>/`；未确定受控位置前不采集含用户信息的 HAR/SQL |
| 环境动作批准记录 | grant、角色、重启、故障注入、备份/恢复及 C000002 样本分别记录批准人、时间、变更号和恢复责任人 |

四岗位分别用真实会话。权限以 Console 当前人员快照、manifest 资源/动作和对象关系为准，不能靠账号名称、UI 按钮、模拟 Header 或切角色冒充。先保存四账号有效角色、范围、来源、有效期和 policy revision；本轮临时 grant 单独登记 ID、审批、授予与撤销 revision，结束逐笔撤销，不改变原有基线。每岗位至少观察 **30 分钟**并覆盖相关策略周期与 drain；完整窗口可与门禁 3 的两小时 CPU 观察重叠，但要有各岗位起止时间。

证据树在 `EVIDENCE_ROOT` 下固定为 `00-freeze/`、`01-artifacts/`、`02-grants/`、`03-cpu/`、`04-roles/`、`05-workflow/`、`06-faults/`、`07-codocs/`、`08-restore/`、`09-tenants/`、`10-cleanup-signoff/`。每步保存 `step.json`（UTC 时间、岗位/uid 摘要、tenant/deployment、制品 hash、对象 ID/版本、METHOD+路径、状态、correlation ID、预期/实际、证据相对路径、结论）；截图命名 `<步骤>-<岗位>-<UTC>.png`，日志/查询命名 `<步骤>-<来源>-<UTC>.json|txt`。HAR、日志、查询和截图先去除 Cookie、Authorization、service token、幂等键原值、密码、私钥、GitLab Token、文档正文与不必要的个人资料；幂等键仅存摘要，必要的原键留在执行人的受控会话中。仓库只保存脱敏索引与签字结论，不提交原始证据或备份。

若出现跨租户数据、越权、重复写/送达、丢更新、双 owner、版本/水位漂移，立即停止后续写入和注入，留存现状并通知 Claude；由环境拥有方按批准的恢复方案处置，不能直接改权威库掩盖失败。以下九项任一失败或无证据，均为 **No-Go**，不得用本机结果或隔离测试降级放行。

## 1. 门禁 1：同提交不可变制品

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| A1 环境拥有方 | 冻结最终干净 `SOURCE_COMMIT`；运行受审构建脚本并核对 dirty-tree 拒绝、无 `-dirty`、无 dev/HMR；登记 Runtime、Host、Console、Gateway、Workflow、私有 Aims 调度 Worker 六制品的 commit、版本、SHA256、大小。 | `01-artifacts/build.log`、`manifest.json`、`source-status.txt`；不上传私有 env。 | 六项同一完整 commit，manifest 均有 SHA256；构建日志为 production Worker/Go 构建。 |
| A2 环境拥有方 | 通过受控发布记录回读六个**云端实际运行**的版本/hash、Worker 版本 ID、Runtime 二进制 hash 与启动时间，逐项对 A1 manifest；在 `BASE_URL` 下用 PM 登录打开 `/aims/projects` 和项目详情，刷新并请求静态 JS chunk。 | `01-artifacts/deployment-readback.json`、`pm-project.png`、脱敏 network/Worker 日志。 | 六项实际 hash 与冻结 manifest 完全一致；页面及 chunk 可加载，无 `dynamic_import_failed`、HMR/dev 端点或混合版本。 |
| A3 环境拥有方 | 对 `hzy-test-aims` 在**获批部署前和部署后**各做一次 Cloudflare 只读回读：列出 active routes、custom domains、workers.dev/Preview URLs 状态及 Gateway `HZY_AIMS_SERVICE` 绑定目标；记录 Worker 版本 ID。 | `01-artifacts/hzy-test-aims-ingress-before.json`、`hzy-test-aims-ingress-after.json` 和控制台截图；不读 secret 值。 | 私有调度 Worker 无公网 route/custom domain、`workers_dev=false`、Preview URLs 关闭，Gateway Binding 仍指向 `hzy-test-aims`。省略 `route/routes` 不自动删除 Dashboard 旧路由；若部署后仍有入口，停止并申请独立批准清理，清理后再次回读。 |

## 2. 门禁 2：服务授权与 grant

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| U1 Console 授权管理员、环境拥有方 | 回读实际 `enterprise.runtime`、Aims/Workflow 调度 service client 的 source、audience、tenant/deployment、active grant、`semanticScope`；按[预发配置准备单](./Go-Live-C000001-Staging-Preparation.md)逐条登记 `aims:enterprise-host:execute`、`assets:enterprise-host:execute`、`codocs:enterprise-host:execute`、`altoc:enterprise-host:execute`、`console:enterprise-host:execute` 及本次实际启用的调度精确 scope。对两种 audience 分别列出计划组合并执行 Console seed/verify 的**已批准**版本。 | `02-grants/clients-redacted.json`、`grant-matrix.csv`、`seed-verify-redacted.txt`；只含 grant ID/状态/绑定，无 Token。 | 五域与各调度 scope 的 client、audience、semanticScope、tenant/deployment、状态逐条匹配；全部组合 scope 的 verify 无缺口。 |
| U2 环境拥有方 | 用实际 service client 通过 Console 正式签发接口探测五域和每个调度组合（`data-runtime` 与合同要求的 `tenant-runtime` audience 分开）；调用对应只读或无副作用 probe，记录签发 HTTP 状态与受众、scope 摘要。 | `02-grants/issuance-matrix.json`、脱敏 Console/Runtime correlation 日志。 | 每个合法组合签发 200 且目标接受；不能以 seed 成功代替真实签发。**签发与使用两步都必须证明**：用签出的 Token 以业务代码实际使用的同一 helper 形态（不得手工拼 scope）调用 Workflow effect `pending`（空队列）与 Aims 调度端点，均 200；2026-09-28 本机曾出现签发 200 而 Runtime 因 scope 带 audience 前缀 403（`e89b2a9f` 修复），只测签发不作为通过证据。 |
| U3 环境拥有方 | 对同一 client 请求旧精确 Host scope、错误 audience、错误 source、错 tenant/deployment、缺 semanticScope 的受控反例；核对无业务 SQL/回执变化。 | `02-grants/negative-matrix.json`、Runtime 拒绝日志、目标对象前后查询。 | 旧精确 Host scope 不再签发或不能使用；其余反例拒绝（按合同 401/403），无宽权限兜底。依赖故障须标 503，不能误记成缺权。 |

## 3. 门禁 3：Cloudflare CPU 两小时

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| C1 四岗位真实会话；环境拥有方采指标 | 冻结不少于连续 120 分钟的 UTC 窗口、六制品版本与流量/请求数。循环执行正式登录/refresh、PM 项目列表和详情、MEMBER 工作项详情及合法写、APPROVER 待办/审批、完成回调后的详情回读；无权账号穿插读写反例。每轮记请求和 correlation ID，覆盖至少一个实际 Workflow drain 周期。 | `03-cpu/window.json`、逐轮 `journey.csv`、Console 与 Host Worker Cloudflare CPU/error/请求量导出、抽样脱敏日志。 | 窗口真实连续 ≥2 小时、四岗位各 ≥30 分钟；Console 与 Host **均无** `exceededCpu`，无请求因 CPU 限制失败，关键链行为正常。指标缺失或中途换版则重开窗口；超限为 No-Go，需重新讨论套餐。 |

## 4. 门禁 4：四岗位链与撤权

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| R1 PM | 从 `/aims/projects` 打开 `PROJECT_A`、详情、成员、工作项、里程碑和项目文档只读页；在准许的测试对象做一笔经理写入，并刷新权威列表。 | `04-roles/pm-*.png`、脱敏网络、项目/回执/成员关系查询。 | 有权对象与写入成功，范围外项目不列入 total/详情；写入仅一条业务事实和回执。 |
| R2 MEMBER | 在独立会话打开同项目和本人工作项，执行获准的事项更新/完成发起；尝试经理专属操作。 | `04-roles/member-*.png`、200/403 网络证据、对象前后查询。 | 允许的成员动作成功；经理专属动作被服务端拒绝，不能仅以隐藏按钮通过。 |
| R3 APPROVER | 打开 `/enterprise/todos` 及 Workflow pending（实际 `GET /api/workflow-proxy/tasks/pending`），进入分配给自己的任务；执行门禁 5 的批准/驳回；尝试非分配任务。 | `04-roles/approver-*.png`、任务指派/结果查询。 | 指派任务可处理；非指派任务不可处理，发起人不能审批自己的待办。 |
| R4 DENIED | 经导航和直达 URL 分别请求项目详情、工作项、成员/里程碑写、`GET /api/workflow-proxy/tasks/pending` 与某个未授权 `POST /api/workflow-proxy/tasks/:id/approve`。 | `04-roles/denied-*.png`、脱敏 401/403/404 网络、对象/回执未变化查询。 | 无目标对象正文、范围外计数或写入；服务端拒绝，菜单不可见不单独算通过。 |
| R5 授撤管理员 + 被撤岗位 | 为受控测试岗位记录授予 `t_grant` 和 policy revision；在多标签中观察服务与 `/enterprise/api/navigation`。撤销本轮 grant 于 `t_revoke`，不清 cookie/本地缓存伪造；分别在 `t_revoke+5m` 前重复详情/写请求，在 `t_revoke+10m` 前刷新菜单和直达 URL，并观察迟到响应是否重新露出对象。 | `04-roles/revocation-ledger.csv`（每次请求 UTC、revision、status）、两标签截图、Console 授撤审计、服务/菜单网络。 | 按既定 G05 口径：**服务侧 ≤5 分钟、菜单 ≤10 分钟**生效；已撤权限的新请求被拒，旧响应不复活页面敏感内容；原基线授权未误删。超过任一上限为失败，不能靠重新登录缩短计时。 |

## 5. 门禁 5：Workflow 事项完成闭环

用户已于 2026-09-28 选定 D1=B：10/8 不开放 Host 里程碑完成审批，第二窗口交付。本门禁只验收事项/工作项完成闭环；里程碑完成**本期不验**，改由 W0 证明 Host 没有可绕过审批的里程碑完成入口。D3=保持 5 分钟 cron、D4=不启用到期提醒：本期调度 owner 为 Aims 集成 drain、里程碑 rollover、Workflow 回调 drain 三项。

执行前环境拥有方在 `05-workflow/route-map.csv` 登记本版 Host 实际可达的事项完成发起路径（当前为 `POST /aims/api/v1/work-items/:id/completion`）、Workflow `GET /api/workflow-proxy/tasks/pending`、`POST /api/workflow-proxy/tasks/:id/approve|reject`，以及对应 Workflow 定义、审批人和回调关联。

时延口径：审批决定、回调落定和给发起人的通知在请求内同步投递，按**秒级**记录；“发起→审批人收到待办”依赖 Aims 调度 drain，按**最坏 5N 分钟加处理时间**判定（N 为 registry 稳定租户数），两类分别记录，不合并。

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| W0 PM（里程碑本期不验） | 在 Host 计划页查看里程碑：确认显示“里程碑完成审批将于下一版本开放”，标题不跳转未注册详情页，无“发起完成”入口；以 PM 身份用编辑接口提交 `status=completed` 或等效关闭字段。 | `05-workflow/milestone-deferred.png`、脱敏网络。 | 提示可见且无 404 入口；状态直改被拒（`milestone_completion_workflow_required`），里程碑状态不变。 |
| W1 MEMBER 发起，APPROVER 审批 | 在 `WORK_ITEM_A` 使用 Host 完成按钮或 `POST /aims/api/v1/work-items/:id/completion` 发起；审批人批准；按 `GET /api/workflow-proxy/instances/by-biz`、工作项详情/请求与审计回读。 | `05-workflow/item-approve-timeline.json`、两岗位截图、请求/实例/回调/工作项状态查询。 | 发起→审批→回调→事项最终状态四段各有同一关联 ID，仅一条有效终态；记录发起→待办时延与审批→回调→通知时延。 |
| W2 新的测试副本，APPROVER 驳回 | 对另一可清理事项副本发起；审批人填写理由并走 `POST /api/workflow-proxy/tasks/:id/reject`；等待回调，发起人刷新。 | `05-workflow/reject-timeline.json`、脱敏原因摘要、申请/实例/对象状态与审计。 | 驳回回调只落一次，对象回到合同定义的可修订状态，不误标已完成；理由不进入无权视图。事项至少一次批准、一次驳回。 |
| W3 MEMBER/APPROVER | 对 W1～W2 中一笔实际事件，分别核对 `/enterprise/notifications` 和 `/enterprise/todos`；记录通知行、待办投影、actionable key、outbox/投递 ID。重新唤醒既有唯一调度一次并回读。 | `05-workflow/delivery-once.json`、两入口截图、通知/待办/投递/lease 查询。 | 通知和待办**各送达一次且无重复**；关闭不先于其所依赖的创建投影；重复唤醒无新行/重复外部效果。空队列或只有单次手工 drain 不通过。 |
| W4 环境拥有方 | 回读 Platform scheduler registry、Workflow/Runtime owner、generation、lease、执行日志和精确 grant；覆盖实际周期及一次重复唤醒。 | `05-workflow/owner-cycle.json`、registry/lease/水位查询与日志。 | 同一任务同一时刻唯一 owner；旧 generation 不能领取或生效，pending/abandoned 可对账，无隐形积压。 |

## 6. 门禁 6：故障、同键重放和旧版本

所有重启/故障只由获批准的环境拥有方操作；先保存制品 hash、备份/回退引用、待处理任务水位与健康基线。每次单独注入，恢复健康并确认无双 owner 后才进行下一次。不得直接修改真实业务库制造响应丢失。

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| F1 环境拥有方 + PM | 按 Runtime→Console→Workflow 顺序，各**重启一次**，每个服务在已批准窗口内分别记录停前、不可用期、恢复后三组正式 Gateway 请求与健康；PM/审批人分别刷新项目与待办，查看本次申请/回调水位。 | `06-faults/{runtime,console,workflow}-restart.json`、部署/进程日志、HTTP 时间线、队列/owner/业务行前后查询。 | 不可用期明确失败且不泄露对象或伪成功；恢复后正式入口 200/合法业务状态，任务续行无重复、generation/lease 正确；三份独立证据齐全。 |
| F2 PM 或 MEMBER | 对本轮可回滚的 Host 写命令，保存**用户意图键**摘要；经批准代理在服务器成功提交后丢弃响应，先 GET/receipt 回读，再以**原键原载荷**重试，最后同键异载荷负例。 | `06-faults/idempotency.json`、代理时间线、首次/重放状态与 receipt ID、业务/审计/回执行数查询。 | 原键同载荷重放返回同一执行且不重复业务副作用；异载荷固定 409；前端保留原键，刷新失败不生成新意图盲重试。 |
| F3 PM/成员双标签 | 在两个标签读取同一有版本保护的项目/工作项，标签 A 成功编辑后，用标签 B 的旧 `expectedVersion` 提交。 | `06-faults/stale-version.json`、两个标签截图、请求/响应、权威行前后版本/内容查询。 | 标签 B 返回 **409**，不覆盖 A，草稿可恢复；不以无 CAS 的 Console 目录编辑充当此反例。 |

## 7. 门禁 7：Codocs 现有生产链回归

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| D1 Codocs 当前有权用户（可与四岗位之一重合） | 经原 Codocs 正式入口登录/refresh；查当前目录、打开原文档、在本轮可清理副本编辑并保存、重新打开正文；对该副本按现有界面分享给 MEMBER，MEMBER 正向读取，DENIED 直达拒绝。 | `07-codocs/login-directory-document-share/` 的截图、脱敏网络、ACL/文档版本/分享关系查询；记录原 Worker 和新版 Console/网关 hash。 | 登录、目录、文档读写与共享在预发均保持既有语义；无正文越权、双写或权限漂移。 |
| D2 环境拥有方 | 在生产数据**隔离演练副本**执行同一最小链，并与升级前冻结的同账号/对象行为对照；不得在生产原库跑写回归。 | `07-codocs/rehearsal-comparison.json`、副本来源和清理记录。 | 预发及演练副本两套证据均通过；只在预发通过不足以放行门禁 7。 |

## 8. 门禁 8：三库加密备份恢复

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| B1 环境拥有方 | 在获批隔离副本中，分别为 Console、Aims、Workflow 建加密备份，记录源 schema/migration、时间、水位、密文 SHA256、加密算法与密钥**引用**；校验备份可读取，禁止把密钥或明文业务数据放入证据包。 | `08-restore/backup-manifest.json`、三库备份作业日志和密文 hash。 | 三库备份完整，范围/时间/密钥引用可追踪。只有“备份成功”还不算恢复通过。 |
| B2 环境拥有方 | 将三份备份恢复到**另一个隔离目标**，执行 schema/迁移 verify；比对角色/grant/策略 revision、Aims 项目与回执、Workflow 实例/outbox/水位的行数与标记对象摘要；经隔离入口做 PM 项目读、审批待办读，记录恢复耗时。 | `08-restore/restore-log.txt`、`verify-{console,aims,workflow}.json`、源/目标摘要对照、恢复只读请求状态。 | 三库恢复后均可启动并读取，同一时间点的跨库关联对得上；无缺表、丢回执、重放副作用或明文泄漏；恢复失败或只恢复单库为 No-Go。 |

## 9. 门禁 9：两租户同 ID 隔离

| 步骤 / 执行身份 | 操作 | 预期及证据位置 | 通过标准 |
| --- | --- | --- | --- |
| T1 两租户各自的 PM/成员 | 在 C000001 和 C000002（或批准的等效隔离租户）确认同一数值对象 ID、不同 tenant 标记与内容；分别登录读项目/工作项列表、详情、`/enterprise/api/navigation`，切换标签、刷新并制造受控迟到响应。 | `09-tenants/object-map.json`、两租户截图、脱敏网络/缓存键/对象查询。 | A、B 均只能见本租户内容、计数、权限与页面缓存；迟到响应不能覆盖当前租户。若无法准备同 ID 对象，则本门禁未完成。 |
| T2 环境拥有方 + 两租户操作人 | 用 A 身份请求 B 的对象及错 tenant/deployment 的受控内部请求；在两租户各用同一幂等键摘要提交独立测试意图，再在 A 重放其键，回读双方 receipt 与业务行。 | `09-tenants/cross-request.json`、`receipt-separation.json`、Runtime/Host correlation 日志与双库/租户查询。 | 跨租户请求拒绝且不泄露 B 内容；同 ID、同键在 A/B 各自命名空间独立，A 重放不触达 B，缓存、任务与回执均不串租户。 |

## 10. 收尾、结论与签字

逐笔撤销本轮四岗位临时 grant/关系，依 R5 口径验证撤权；清理或归档标记业务副本，保留合法审计/回执历史而不手改；回读六制品、scheduler owner/generation、policy revision、队列水位与初始基线差异。`10-cleanup-signoff/` 保存清理台账、未清理对象责任人、各门禁证据索引和补验清单。Cloudflare 指标、备份和日志按受控保留策略归档；不把原始凭据、HAR 或备份放进 Git。

| 门禁 | 结果（通过/失败/阻断） | 证据索引 | 执行人/UTC | Claude 签字/UTC | 用户业务确认/UTC |
| --- | --- | --- | --- | --- | --- |
| 1 制品 | 待执行 | `01-artifacts/` |  |  |  |
| 2 授权 | 待执行 | `02-grants/` |  |  |  |
| 3 CPU | 待执行 | `03-cpu/` |  |  |  |
| 4 岗位链 | 待执行 | `04-roles/` |  |  |  |
| 5 Workflow | 待执行 | `05-workflow/` |  |  |  |
| 6 故障恢复 | 待执行 | `06-faults/` |  |  |  |
| 7 Codocs | 待执行 | `07-codocs/` |  |  |  |
| 8 备份恢复 | 待执行 | `08-restore/` |  |  |  |
| 9 两租户 | 待执行 | `09-tenants/` |  |  |  |

九项均有本次**同制品、同云端预发**证据且通过、清理已核对、Claude 和用户完成相应签字后，才可在 10/7 Go/No-Go 材料中建议 Go。任何“待执行/阻断/失败”均不得勾为通过。
