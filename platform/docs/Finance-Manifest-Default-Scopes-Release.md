# APF 三域角色清单与 Finance 默认范围发布（待批准执行）

本文件只交付步骤，不表示已执行。开发未连接或修改 Platform 环境。hzy0 Finance 当前缺少范围的 403 不应通过解析器把 none 改成 all 解决。

## 发布顺序

1. 取得独立 Platform 发布/迁移审批。记录候选提交、现有部署版本、Altoc、Finance、People 当前 manifest/release、相关角色 permission/scope 行、policy hash/revision 及 C000001 的 test bundle revision；在私有目录备份 Platform 库并验证可恢复。不把凭据写入命令、日志或本文。
2. 使用批准的迁移账号执行 `sql/HZY-Platform-SQL-Migration-finance-manifest-default-scopes-candidate.sql`。这是候选，不可直接纳入本机 hzy0 安装。已有行必须全部为 manual。执行 Verify 候选只读核验列默认值、来源和精确权限关联。MySQL ALTER 隐式提交，失败时停止。
3. 发布包含解析器、materializer 和 manual writer 的 Platform 候选。迁移必须先于新版写入代码。缺列时带 defaultScopes 的 manifest 导入明确 503，事务不得留下部分角色写入。
4. 发布后通过现有 GitLab release/清单导入入口，按 **People → Altoc → Finance** 顺序导入同一已审候选的三个 manifest（`/api/platform/ops/applications/{appCode}/manifests/import-from-gitlab`），逐一回读 catalog/hash/推荐角色后设为有效版本。先预览 diff，再导入；三份全部核验完成才重签，避免中间态策略发放。只导入技术目录，不创建用户角色分配或新增 grant。Finance 是最后一份，因为它依赖新增来源列和默认范围物化；People/Altoc 不修改 defaultScopes。
   - People：管理员移除 assignments/cost_snapshots/performance_cycles/standard_costs 的 approve；人事 approver 显式接收 standard_costs:view/approve，并保留原三项 approve。字典/私密档案和离职交接既有入口不变。
   - Altoc：确认 admin 与 sales 的 lead assign/disqualify/convert/activity、opportunity assign/transition/activity 均存在（仓库此前已登记，旧 Platform 需重新导入）。admin/customer_success 加工单 reopen；admin/contract_manager 显式加 activate-delivery。admin 的客户/报价/合同 approve 移到已有 contract_approver；移除普通 admin 的服务回写 finance-summary:sync、mark-billable、delivery-result:sync。服务 grant/回调闭集不改。
   - Finance：admin 移除 approve/issue/confirm，保留管理与已有 defaultScopes；ar_accountant 移除 issue；新增推荐 invoice_issuer，仅 view/issue，不持有申请 edit。invoice_approver、expense_approver、cashier、reconciliation_operator 各自保留专岗动作。manager/expense_submitter/viewer 的默认范围矩阵不扩展。
   - 新推荐角色不自动映射或分配；开票经办及审批/确认的具体人员角色和 scope，由现有治理按批准的职责配置。不得为让按钮显示而给 admin 补回冲突动作。合并角色依然受领域对象职责校验约束，推荐角色分离不能替代该校验。
5. 核验 admin、manager 的默认范围仅覆盖各自声明的精确资源/动作，expense_submitter 仅 expenses/self，viewer 无默认来源行；其他角色省略字段，原范围保留。已有同 tuple manual 行（即使 inactive）仍原样保留，不被默认同步激活。重复导入内容相同时行 ID、策略 revision 不变。
6. 仅针对已批准的测试租户，在现有 Platform 管理入口重签测试策略：`POST /api/platform/ops/tenants/C000001/bundles`，body `{ "environment": "test", "includePayload": false }`。不得批量重签生产。应用角色目录共享，其他租户影响须纳入发布审查；tenant:global 仍限定于每份已签名租户绑定。
7. 通过现有 Console 策略同步流程获取新 test bundle，检查签名、绑定、revision 和 roleDefaultScopes（只记录数量/布尔结果，禁止日志打印 token、私钥、完整身份策略）。刷新 hzy0 权限快照，确认授权来源为新策略，不采用浏览器伪造 scope。

## 回读与验收

- Verify SQL 的非法来源关联/非法 Finance 默认范围计数为 0。不能把手工授权范围当作违规默认范围删除。
- admin/manager 对已有精确动作返回 all；expense_submitter expenses 返回 self，项目核算及发票不能因此授权；viewer 没有显式范围时保持 none。
- 任职 scope 与默认 scope 交集收紧；过期分配和只读角色模拟不继承管理员范围。人员职责分离、Finance+People 联合工资权限保持原规则。
- C000001 test 用户验证 Finance 列表及允许的操作；test 反例验证无范围/无动作/职责冲突仍拒绝。只在后续明确批准的验收范围内发业务写请求。

## 回滚

停止三域 manifest 同步及治理写入，备份新增状态；执行 Rollback 候选中仅删除 manifest_default 的事务，manual 不动。按回滚审批恢复三域原审定 manifest（Finance 无 defaultScopes），通过现有导入/角色治理流程刷新 policy hash/revision，重签 C000001 test bundle 并同步、回读，确认默认范围已撤销。恢复旧 Platform 代码后，才按单独审批执行候选中注释的 DROP COLUMN。不得仅删列让默认行变成无来源的手工授权，也不得复用旧 revision 掩盖撤权。各阶段失败停止并按备份恢复，DDL 回滚不可当事务回滚处理。

## Host 写入口与敏感动作审计依据

契约测试 `enterprise/test/apf-manifest-role-audit.test.mjs` 遍历三域实际 Host 用户写路由，核对 owning 的精确资源/动作存在且至少一个推荐角色可执行；只允许 view/edit 继承 admin，不把 admin 视为 approve/confirm/issue/assign 等动作。服务入口单列，不分配给推荐人员角色。

| 领域 | 敏感动作 | 推荐归属 |
| --- | --- | --- |
| Altoc lead | assign/disqualify/convert/activity | sales、admin |
| Altoc opportunity | assign/transition/activity | sales、admin |
| Altoc customer/quotation/contract | approve | contract_approver，业务编辑/admin 不兼任 |
| Altoc contract | activate-delivery | contract_manager、admin；APF Host sign/activate/submit 按既有 contract:edit，仍有对象/审批前置条件 |
| Altoc receivable | confirm | contract_manager、admin（Altoc 回款计划动作，不赋予 Finance 到账确认/核销） |
| Altoc service_ticket | close/reopen | customer_success、admin；dispatch/知识/反馈按 edit |
| Altoc tender/service coverage/renewal | 现有 edit，不新增敏感资源 | tender 沿用 opportunity:edit；服务覆盖沿用 contract:edit；renewal_opportunity:edit |
| Altoc integrations/dashboard | replay/export | admin；dashboard export 另有 contract_manager |
| Finance invoices | approve / issue | invoice_approver / invoice_issuer，二者均无申请 edit |
| Finance receipts/expenses | confirm | cashier；expenses approve 为 expense_approver，无制单 edit |
| Finance reconciliation | confirm | reconciliation_operator，无 receipts:confirm |
| Finance dashboard/reports/integrations | export/replay | export 为 manager/report_viewer/admin；replay 为 admin |
| Finance cost/账户/参数 | 现有 admin（非新增 approve） | project_accounting admin 为 manager/admin；银行账户 admin 为 manager/admin；参数 settings admin 为 admin |
| People assignments/cost_snapshots/performance_cycles/standard_costs | approve | approver，无相应编辑/admin |
| People offboarding_tasks | confirm/cancel | confirm 为 employee/department_manager/manager/admin；cancel 为 specialist/manager/admin；保留已有负责人/对象条件，无已裁定的确认与取消互斥规则 |
| People integrations/hr_source_sync | replay/execute | replay 为 directory_admin/admin；execute 为 admin |

服务专用：Altoc finance-summary:sync、mark-billable、delivery-result:sync、product-feedback:update-status/update-progress、integration_operation:execute，以及 Finance product-cost:read/read-rules/replace-rules，不授予人员推荐角色。对应 service capability、grant、固定通道和受信 actor 规则保持不变；不要求浏览器持有这些动作。

上述撤权是本批角色审计的预期变化，必须包含在一次性 Platform 发布/三清单导入/测试重签审批中。职责依据为领域设计已裁定 D-01/D-02、付款制单与确认、请求与审批分离；不扩大成新的跨资源互斥（如开票与到账确认）。

## 执行清单（2026-10-03 本地准备，等待用户批准）

### 固定候选与本地证据

开始时固定 HEAD **930c5ede7083664353acf871b3e8ef4173c45afd**，已核对包含 8ee33d32（默认范围）和 48f286dc（三域敏感动作）。干净 detached worktree：`/Users/gavinzhou/orca/hzy-candidates/platform-930c5ede`；没有带入主工作区的并行未提交改动。

- Node 24.18.0 / pnpm 11.17.0；Platform test **364/364**，typecheck 通过，Node-server 发布构建通过。
- 构建命令 `pnpm --dir platform exec nuxt build --dotenv /dev/null`，不装载任何环境文件；没有连接数据库、GitLab 主机或 Platform。复用本机现有 node_modules（路径链接），使用 `pnpm_config_verify_deps_before_run=warn` 避免 pnpm 自动安装改写共享依赖；提示 patchedDependencies 状态差异，未执行安装。目标主机批准后仍须核对 Node 24 与产物可运行性。
- 产物目录 `/Users/gavinzhou/orca/hzy-candidates/platform-930c5ede-artifacts/`：
  - `platform-output.tar.gz` SHA256 `4d30c54c2a930278c36b90c8c691fd14066c18d3c24e5791f6b7a2481b714e1c`。
  - `source.tar.gz` SHA256 `23df7f2c0b7e2ec9efdaadd19728af9544c0bec586dbb4d1f3b7287b23fcba77`（git archive 固定提交）。
  - `candidate-artifact.json` SHA256 `7ad0942f47b5902e9436f47c7c3ed1dc9453e8407dea59011f2a3a5dd5c1513c`：固定 commit、Node 版本、完整 .output 每文件 SHA256。入口本身是通用 Nitro loader，**不以入口 hash 单独证明版本**；切换脚本核对整棵产物树。
- 当前构建 .output 没有 `.node` 原生二进制；未在目标 Linux 上实际启动。目标 OS/Node 兼容由切换健康门禁证明，失败自动恢复旧进程。
- 独立补充包 `execution-candidates.tar.gz` SHA256 `78dc736728c60a7a0346845d7786a436afa2a3a47500bfbf03e5f3c6a6e3e127`，含本轮脚本；它不在固定 HEAD 的 source 包内，批准后按目录覆盖解包到 SOURCE，不能漏传。
- 执行脚本目录 `deploy/test-env/candidates/platform-apf-930c5ede/`：`snapshot.mjs`、`database.sh`、`switch.mjs`、`api.mjs`、`roles-plan.json`、`guard.test.mjs`。脚本不含凭据；语法检查通过，未批准拒绝执行与角色清单一致性测试 **6/6**。未演练现场迁移/切换/API，不能将本地门禁测试当现场证据。

### 0. 审批与现场只读核验

执行者必须先取得用户对 **Platform 测试发布、source_type 迁移、三清单导入、C000001/test 角色阶段配置及重签** 的批准。本节是审批材料，不是环境授权。不得修改生产 Platform、其他租户、生产策略或 runtime channel；不借本批处理 APF-18 owner 退役。

沿用 38f8a20b/环境隔离批的方式：干净固定提交、独立发布目录、PM2 单进程切换、保留旧配置、健康失败恢复。**不复用历史硬编码旧 cwd/hash**，现场从现有进程核对；旧制品必须具备 tenant/environment 水位及 mode 守卫。预期目标进程 `hzy-platform-dev`、端口 3011、库 `hzy_platform_dev`、测试域 `hzy.wiztek.cn`，主机 `iZcqwiqyhp9u8rZ`。任一实际绑定不同先停止，不更改脚本白名单强行继续。

记录现有 release/cwd/完整产物 hash、Node 版本、DB 版本、prod/test/dev 当前签名制品 hash/revision/targets、tenant/environment 水位、三域最新 manifest/release/hash、角色权限/范围/分配及 manual 行摘要；全部原始回读保存在 0700 attempt 中，文件 0600。只输出聚合、hash 和布尔判定，不输出策略正文、签名密钥、cookie、token、DSN。

先确认共享角色目录影响范围：manifest 物化是共享技术目录，不能承诺其他租户目录绝不变化；本批只主动重签 C000001/test，其他租户/环境签名制品不重签。角色分配事实是 tenant 级而非 environment 级，必须核验 `test` 仅用于测试、没有生产身份/生效分配；否则停止，请用户裁定环境隔离方式，不能用仅重签 test 掩盖共享事实影响。

### 1. 现场输入与围栏、备份和恢复验证

批准后把源包、产物包、artifact manifest 及已审候选脚本传到独立私有发布目录，校验上述 hash，解包 source 与 .output；不用主 checkout 构建、不执行 git fetch/push。本文没有传输或连接主机。

执行输入只传**文件路径与非秘密标识**：

```sh
umask 077
export SOURCE=/wiztek/hzy-test/platform-release-930c5ede
export ATTEMPT=/wiztek/hzy-test/backups/apf-platform-930c5ede-APPROVED_TIMESTAMP
mkdir -m 700 "$ATTEMPT"
export APF_RELEASE_APPROVAL=platform-930c5ede-C000001-test
export MYSQL_CNF=/protected/platform-admin.defaults.cnf
export RESTORE_MYSQL_CNF=/protected/isolated-restore.defaults.cnf
export BACKUP_KEY=/protected/platform-backup.key
export APF_RESTORE_APPROVAL=isolated-platform-restore
export CANDIDATE_ARTIFACT_MANIFEST=/protected/candidate-artifact.json
export PLATFORM_SESSION_FILE=/protected/platform-operator-session-headers.json
export APP_REPO_URL=APPROVED_EXISTING_MONOREPO_URL
# defaults、key、session 文件须 0600，使用现有授权连接；不把密码放 argv。
CANDIDATE="$SOURCE/deploy/test-env/candidates/platform-apf-930c5ede"
node "$CANDIDATE/snapshot.mjs"
```

`snapshot.mjs` 保存当前 PM2 状态与原进程配置（包含运行秘密，0600，不回显）。另备份当前 `.output`、进程配置文件和既有 PM2 dump（私有目录）；不要运行 pm2 save 把其他未审状态带入持久化。现场记录旧入口与整树 hash。

围栏：暂停所有 manifest/治理/角色/策略/批准写入，阻止 API/后台自动重签，**只停止 hzy-platform-dev**。其他 PM2 进程不得停止。现场确认无其他写库实例；若旧 Platform timer/API 仍可写则不能进入备份/迁移。随后：

```sh
pm2 stop hzy-platform-dev
bash "$CANDIDATE/database.sh" backup
```

转储使用 `--single-transaction --routines --events --triggers --hex-blob`，加密并做解密校验；恢复到单独已批的隔离 MySQL server（server_uuid 必须不同、event_scheduler 必须 OFF、目标同名库原先不存在），逐表清单和逻辑 CHECKSUM 对比，成功删除隔离副本并写 checkpoint。**不在真实 Platform server 建恢复副本，避免复制的 events/routines 引用真实库。** 完整恢复、对象定义/definer/view/routines/event 数量与权限须现场附加核对，异常停止。失败输出保持脱敏，诊断仅在私有日志，隔离残留仅经核验后清理。

失败处理：迁移尚未执行时恢复旧进程，继续保持治理围栏；备份无效不得迁移。备份恢复测试仅针对隔离库，不自动覆盖现场库。

### 2. source_type 迁移与 verify

```sh
bash "$CANDIDATE/database.sh" migrate
bash "$CANDIDATE/database.sh" verify
```

只执行 `HZY-Platform-SQL-Migration-finance-manifest-default-scopes-candidate.sql`，不重做已安装环境隔离迁移。迁移前必须缺 source_type；已有列/半装时脚本拒绝，需要人工核对候选是否已装，不能直接重跑。迁移后原行全部 manual；column 默认 manual、NOT NULL；非法来源权限关联及非法 Finance 默认行计数为 0。补现场比较原 manual 行 ID/tuple/status/hash 完全不变。

DDL 隐式提交，失败先核验实际列状态；旧代码不依赖该列，可先恢复旧进程，列保留。不能直接删列或把新增 defaults 当 manual。只有后续撤销 manifest_default、恢复目录并重签撤权全部通过、无依赖写入时，才另批 DROP COLUMN。

### 3. 单进程切换与自动回滚

```sh
node "$CANDIDATE/switch.mjs"
```

只切 `hzy-platform-dev`，继承原运行 env/日志/解释器/重启参数，DB/端口绑定不变；整树 SHA 与固定 commit 一致才启动。候选健康失败或其他 PM2 PID/status 变化，自动删除候选并按私有 `rollback.config.json` 恢复旧进程、检查旧健康，返回非零并停止后续步骤。迁移列暂留。

健康成功后先保持治理围栏，只给本次执行者开放管理会话。确认测试域诊断、静态文件、登录/授权拒绝路径、现有 prod/test/dev 精确信封读取正常（不生成新非目标包）。不能仅看 `/api/health` 就解除围栏。此时尚不持久化 PM2。

### 4. 三 manifest 预览 → 导入 → 回读

`PLATFORM_SESSION_FILE` 是现场操作员已授权会话 header JSON，含 `x-hzy-tenant-code=C000001` 与既有会话，0600；过期就停止重新授权，不读取或代填密码，不用 internal/service token 绕过 ops RBAC。

```sh
node "$CANDIDATE/api.mjs" preview
# 现场审查三个 *-preview.json 与 *-before.json 的 diff。
# 人工核准后，在私有 ATTEMPT 写 preview-approved.json：{"commit":"930c5ede7083664353acf871b3e8ef4173c45afd"}
node "$CANDIDATE/api.mjs" import
bash "$CANDIDATE/database.sh" verify
# 本处逐 app 回读目录；完整 readback 命令在下方 test 重签之后执行。
```

实际预览 GET `/api/platform/ops/app-manifest-imports/preview`，参数 repoUrl/ref/manifestPath；检查 GitLab 解析 commit 等于固定候选、正文等于本地产物。正式 POST `/api/platform/ops/applications/{appCode}/manifests/import-from-gitlab`，固定 commitSha、manifestPath，候选版本 `v0.0.0-apf-930c5ede`；先检查这个候选版本不存在冲突，发布版本命名需要变更时须统一改执行单后审查。导入顺序 **People → Altoc → Finance**；逐个按 applications.latestManifestId 核对 catalog/release/hash/敏感动作变更；列表 isLatest 同时包含 latest release 的 manifest，不能假定只有一行。此处导入的是技术目录、release 为 draft；不自动升级客户部署/发布 release。本批三域角色预期见前述发布顺序及审计表。

验证：Finance admin/manager 精确动作 global，expense_submitter expenses/self，viewer 无 default；省略字段的旧范围不变；显式 [] 只删 manifest_default；已有同 tuple manual（含 inactive）不删、不激活。重复相同导入行 ID/目录 hash/角色 policy revision 不变化。manual 保存前后摘要一致。不得自动新增 service grant。

失败回滚：API 脚本将可能已提交（含响应丢失）的 app 按逆序通过原正式目录 API 恢复原 manifest；恢复目录注册到 `v0.0.0-apf-rollback-930c5ede` 候选（不重绑已 released 的旧版本）；Finance 回滚对旧角色显式 [] 撤销本次 owned defaults，manual 不动；然后只重签 C000001/test，记录新的撤权制品。任何恢复或重签失败即停止、维持写围栏与兼容新代码，人工核验；**不直接恢复全库/降低 revision，也不盲切旧代码。** 成功后还需 verify、原权限/范围摘要比较、撤权同步回读才能恢复旧兼容代码。

### 5. C000001/test 精确角色阶段清单（发布顺序第 6 步的准备）

`roles-plan.json` 从本候选 manifest 生成，列出每个角色的精确权限与建议 manual tenant/global tuples；**仅审批材料，不执行赋权**。不要用 finance:admin 配额借给专岗，推荐专岗本身没有 defaultScopes；必须为 C000001 的测试专用租户角色建立精确 manual 范围，并保持权限/范围同一来源链。禁止修改共享 app-role/system-role 默认范围来给 test 临时赋权。

|阶段|test 所需 manifest app-role|精确敏感动作|与 zhouguangying 的分离|
|---|---|---|---|
|开票|finance:invoice_issuer|invoices:issue（另有 view）|zhou 作为申请人；test 不创建/编辑申请、不审批本人申请；申请人=开票人仍应拒绝|
|审批|finance:invoice_approver、finance:expense_approver|invoices:approve、expenses:approve|zhou 制单/申请，test 审批；不把审批结果写入浏览器接口|
|到账/付款确认|finance:cashier|receipts:confirm、expenses:confirm（以及各自 view）|zhou 制单/经办，test 确认；制单人/经办人自己付款仍拒绝|
|核销|finance:reconciliation_operator|reconciliation:edit/confirm；invoices/receipts:view|本阶段撤销 cashier；只核销由另一实际 UID 确认的到账；曾由 test 确认的到账仍必须拒绝 test 核销，撤角色不改变 actor 事实|
|经营审批|altoc:contract_approver|customer/quotation/contract:approve|zhou 编辑/提交，test 承接报价/合同；客户审批未承接的缺口不因赋权开放|
|人事审批|people:approver|assignments/cost_snapshots/performance_cycles/standard_costs:approve|zhou 维护事实/申请，test 审批；不赋对应 edit/admin|
|Workflow 任务|workflow:approver|以 workflow manifest 既有任务动作及任务分配为准|已配置流程审批人 UID=test；角色不绕过真实 task-assignee、业务元组或自审批校验|

默认按阶段逐项配置，不把上表一次性全部叠加。正例核销若没有“其他 UID 已确认”的允许数据，需要单独批准第二个测试确认主体/数据准备；不能让同一 test 为正例越过 D-02。角色恢复/切换后每阶段只重签 test，并刷新权限；旧制品失效前不得开始下一阶段写验收。三域 admin 导入后的敏感撤权必须同时核验 zhou 合并角色（不假设其现有分配），不得留旧角色来源让 admin 仍 approve/issue/confirm。

治理路径（批准后，先读后写，精确匹配 tenant/subject，保存新行 ID）：

1. GET tenant-admin subjects、subject-roles、assignable-roles（分页读全），核验 active `C000001/test` 及继承角色/范围；读 zhou 的事实供职责比较，不更改其授权。
2. 复用只属于 C000001 且只分配 test 的专岗租户角色；没有则 POST `/api/platform/tenant-admin/roles` 创建 custom role（tenantCode、roleCode、roleName、isAssignable、status），不新建 manifest app-role。
3. PUT `/api/platform/tenant-admin/roles/{id}/app-roles?tenantCode=C000001`，body `{"appRoles":[{"appRoleCode":"finance:invoice_issuer"}]}`（按阶段角色替换）。保存并核对返回映射，不能删除无关旧映射。
4. 通过 **ops** `/api/platform/ops/roles/{id}/scopes` GET/PUT 为该精确 C000001 角色写 `roles-plan.json` 中 tuples，并保留原无关 scopes。当前 tenant-admin scopes 路由仅操作 Console 资源，**不能拿它给 Finance/Altoc/People 范围**；不改此路由边界。ops 现场核验 roleId 的 tenant 是 C000001 后才写，不操作共享 system role。source 为租户 custom/manual，不是 manifest_default。
5. POST `/api/platform/tenant-admin/subject-roles`，body tenantCode=C000001、subjectType=user、subjectCode=test、roleId=现场核验 ID、sourceType=manual、assignmentKind=temporary、status=active、reason=已批准阶段、expiredAt=审批确定的截止时间。新增之前读同 tuple 避免重复；响应丢失先回读，禁止另造来源重复赋权。
6. 反向撤销只对本次新增 ID 调用 DELETE `/api/platform/tenant-admin/subject-roles/{id}`；恢复修改过的角色 mapping/scopes 原快照。已有分配不盲删。保留记录与审计，只在 C000001 范围撤销，不删除历史 actor。

角色赋权的静态互斥/max-active/holder 限制如返回冲突即停止，不解除约束。首次阶段赋权的回读通过后，私有 `roles-readback-approved.json` 记录 `{"tenant":"C000001","environment":"test"}`；脚本据此才开放 test 重签。

### 6. 只重签 test 与最终回读

```sh
node "$CANDIDATE/api.mjs" resign
node "$CANDIDATE/api.mjs" readback
bash "$CANDIDATE/database.sh" verify
```

只 POST `/api/platform/ops/tenants/C000001/bundles`，body `{"environment":"test","includePayload":false}`；禁用批量/默认 prod 重签，禁止签指定历史 revision。Console 通过既有同步流程取得新包，核验签名/issuer、tenant/environment/deployment/targets、revision 单调与内容 hash；记录布尔和计数，原始策略不进日志。

现场必核：policy bundle `roleDefaultScopes` 有 admin/manager global、submitter self，viewer 不新增；manual tuples 原样；test 专岗 permissions + scopes 同源；zhou 无遗漏旧敏感来源；Enterprise all/self/none 正例及无动作/无范围/过期/模拟/对象职责反例。项目核算个人工资仍须 Finance 管理且 People standard_costs:view，不能让 approver/viewer 联合误取得工资明细。

对 prod/dev/其他租户保存前后制品 hash/revision/targets 比较，不主动改变它们。C000001/prod 与 test 同 key 的当前签名验证均正常，test 新修订不覆盖 prod 制品；如共享目录变化导致非目标信封异常则停止，按原环境隔离 runbook 处理，不偷偷重签生产。只在用户另外批准业务验收后发业务写请求。

最终三轮本机与测试公网 health/诊断，匿名管理拒绝、ops 会话失效拒绝、六应用及旧进程 PID/配置不受影响。保留私有 receipt、备份与 rollback 配置，人工核对 PM2 dump 仅本目标变更后才按已有发布方式持久化，不能直接 pm2 save 所有脏进程。解除治理围栏需全部回读通过。

### 7. 停止与回滚清单

- 任一步失败返回非零即停止，不继续下一步。未安装迁移：恢复原进程；已安装但尚未导入：留兼容列，自动/手动恢复原进程。
- 导入/角色配置之后：维持写围栏，恢复原三清单、撤销仅本批分配/范围变更，verify，**新 revision 重签 test 并同步撤权**；核验后才切旧兼容代码。失败则保持可诊断的安全停止状态，不能用旧包覆盖新水位。
- 全库备份恢复仅为灾难恢复候选：先围栏所有 writer、备份故障后增量、核验最新已发布各环境水位并制定不降低水位的恢复/补偿方案，再单独批准；本候选不自动向真实库 restore。DDL DROP COLUMN 和整库恢复均不自动执行。
- 角色阶段切换/撤销不取消旧业务记录的制单/申请/确认 UID；职责反例必须持续拒绝。
- 上述恢复依赖现场授权会话与旧制品有效性；缺会话、旧目录/hash不符、备份失败、静态角色冲突或 prod 影响未明时停止交协调者，不扩大权限或跳过检查。

本次仅本地构建、校验及候选文件准备，未连接发布主机/Platform 数据库，未执行迁移、清单导入、角色分配、重签、切换、提交或推送。
