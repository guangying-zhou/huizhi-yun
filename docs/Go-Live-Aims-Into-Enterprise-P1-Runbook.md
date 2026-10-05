# Aims 入口迁入 Enterprise：P1 生产上线执行单

状态：**候选，待逐项批准；未执行任何环境核对或写入**。代码基线 `56bf0d1ea043143469bd5a05d8a54471234ea010`（P1；执行时核对 GitLab 完整 SHA），依据任务书 §8。本单适用 C000001 自托管生产；不套用 hzy0 的本机标志、测试部署码或 Cloudflare Binding。

## 1. 范围、停止条件与审批

P1 迁移六类项目文档 Host 入口、Aims/Assets 通知详情 purpose 委托、Aims 两类 Workflow 回调。现有 hzy-aims 外投仍运行。**不停止/退役 hzy-aims，不撤旧 grant，不关闭 legacy，不启动 P2/W10 迁移，不安装新 schema，不开启 AA-04。** 停机仅指批准的整栈维护窗口。

| 批准点 | 精确动作 |
| --- | --- |
| P1-N1 | 只读现场核对、加密备份及备份可解密验证；登记回滚版本/配置/水位 |
| P1-N2 | 执行审定的 grant 缺失差集 INSERT 与逐行 verify、真实客户端签发探测；不修既有行、不复活 revoked |
| P1-N3 | 整栈维护窗口，暂停入口/调度/投递，替换 Runtime 并按顺序恢复全部依赖服务 |
| P1-N4 | Codocs/Enterprise/Workflow/Console（及同 SHA Aims）制品与受保护配置发布；Gateway 如需更新仅同 SHA topology，无退役变更 |
| P1-N5 | 用标记数据执行 §7 业务写验收、一次审批/一次投递、正式清理与观察 |
| P1-R | 有故障时整组回滚已批准旧制品/配置；若涉及 grant revoke 或恢复 DB，须另报精确计划获批 |

用户可合并批准 N1+N2、N3+N4、N5+R，也可逐项批准；本单不替用户选择。grant 既有行缺绑定/冲突/revoked、来源部署不一致、issuer/audience 漂移、构建缺依赖、健康 5xx、任何跨项目/自审错误均停止后续步骤。SQL/verify/探针失败不盲重试，不直接改 outbox。

## 2. 现场事实与备份（N1）

从受保护 Runtime config、Platform 登记、各服务 env 与 Gateway 目录核对，而非从本文默认值推断。预计：tenant=C000001；enterprise=C000001-prod-enterprise；workflow=C000001-workflow；console=C000001-console；codocs=C000001-codocs；aims=C000001-aims。来源绑定始终是**签发客户端所属部署**，不能写目标部署。目标 enterprise/codocs 的部署与回环目录另行核验。

Runtime 请求 audience 的优先级见 `foundation/server/utils/tenantRuntimeClient.ts:660`：受信 Gateway 头→HZY_DATA_RUNTIME_AUDIENCE→Runtime config→HZY_TENANT_RUNTIME_AUDIENCE→data-runtime。当前仓库自托管默认 data-runtime，不是生产现场证明。N1 分别确认 Host 和 Codocs 的实际 audience；仅为实用 audience 授权，不自动加双 audience。若现场确实两种都在用，先提交逐调用证据与增行差集再批准；Workflow/Aims 原调度双 audience 的旧授权保持原状。

记录 current 链接、制品 manifest/SHA、Runtime 版本与二进制 SHA、systemd unit/drop-in、env/config 文件 SHA/属主/权限、各 outbox/receipt/operation 水位。Runtime 必须新版本（P1 有 Go 改动），不能只热更新 Host。`internal/version.Version` 源默认 dev，不代表生产版本；N1 记录 CURRENT_RUNTIME，N3 批准一个高于它的明确 RUNTIME_VERSION。未填版本号为停止条件，不猜生产版本、不发布 latest。

受保护备份目录固定为 `/home/hzy/rollouts/aims-enterprise-p1/<UTC-window>/`（0700），文件0600，写审批编号。全量加密备份 Console（至少 service_clients、service_client_credentials、service_client_grants）、Workflow、Aims/统一业务库；另备份 Runtime 二进制/config、上述系统配置。数据库名字取 config，不能照抄 hzy0。沿用已批准的数据库备份工具与加密方式；KEY_PATH 来自受保护配置，不在 argv/日志显示。先把备份在隔离路径解密并验证可恢复/表行数，再允许 grant 写入。保留非目标 grant 的逐字段、按 id 排序 SHA-256 快照（含 updated_at），禁止 SELECT 凭据值/密文到报告。

候选备份命令（N1批准后，目标库名/KEY_PATH由保护配置解析，工具路径按主机核实）：

```sh
set -euo pipefail
umask 077
install -d -m 0700 "$ROLL"
# KEY_PATH只传受保护文件路径，不把密钥内容放argv。
for db in "$CONSOLE_DB" "$WORKFLOW_DB" "$ENTERPRISE_DB"; do
  mysqldump --defaults-extra-file=/etc/hzy/ops/backup.cnf --single-transaction \
    --routines --triggers --events --hex-blob "$db" | \
    openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:"$KEY_PATH" -out "$ROLL/$db.sql.enc"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$KEY_PATH" -in "$ROLL/$db.sql.enc" \
    -out "$ROLL/$db.verify.sql"
  # 在批准的隔离恢复库核对表数/行数，绝不导入运行库；明文仍在本0700目录。
  test -s "$ROLL/$db.verify.sql"
  rm -- "$ROLL/$db.verify.sql"
done
```

若Aims物理表另在独立库，该库也加入备份；不能因为ENTERPRISE_DB存在而漏备权威Aims表。可解密/文件非空不等于恢复验证通过，N1仍须记录隔离恢复结果。

## 3. 完整授权集合与代码依据

以下是**运行前必须核对的全集**，不是“全部新插入”。同进程 typed 调用不需 Aims Service API grant；U 通道仍要用户 permit，系统通道不携 actor，purpose 通道仍需签名主体/用途。禁止用 aims.write 或通配替代。

### 3.1 Enterprise → 独立 Codocs：15 条（全部 source=enterprise.runtime，aud=codocs）

绑定统一为 tenant C000001 / deployment C000001-prod-enterprise。下表 resource/action 使用现有 P1 候选的明确物理形态（不能凭最后一个冒号重新切分）。

| resource | action | semanticScope（签发 scope） | 调用/接收依据 |
| --- | --- | --- | --- |
| `codocs:documents` | `write` | `codocs:documents:write` | aims/server/utils/codocsApi.ts:479,530,850 |
| `codocs:product-document` | `read` | `codocs:product-document:read` | aims/server/utils/productDocumentRuntime.ts（产品元数据既有路径） |
| `codocs:product-document` | `create` | `codocs:product-document:create` | aims/server/utils/productDocumentCodocs.ts（产品创建既有路径） |
| `codocs:project-document` | `content:read` | `codocs:project-document:content:read` | aims/server/utils/codocsApi.ts:1010 |
| `codocs:department-documents` | `list` | `codocs:department-documents:list` | aims/server/utils/codocsApi.ts:716 |
| `codocs:project-document` | `version:resolve` | `codocs:project-document:version:resolve` | aims/server/utils/codocsApi.ts:1163 |
| `codocs:project-document` | `review-content:read` | `codocs:project-document:review-content:read` | aims/server/utils/codocsApi.ts:1230 |
| `codocs:project-document` | `review-grant:create` | `codocs:project-document:review-grant:create` | aims/server/utils/codocsApi.ts:1195 |
| `codocs:company-weekly-summary` | `publish` | `codocs:company-weekly-summary:publish` | codocs/server/lib/serviceAuthPolicy.ts:73（双来源接收；当前外投仍 aims.runtime） |
| `codocs:project-document-access` | `read` | `codocs:project-document-access:read` | aims/server/utils/codocsProjectAccessClient.ts:16–29（check/search/policy-read/audit） |
| `codocs:project-document-access` | `manage` | `codocs:project-document-access:manage` | 同文件:16–29（policy-update） |
| `codocs:project-document-access` | `create` | `codocs:project-document-access:create` | 同文件:16–29（create） |
| `codocs:project-cabinet` | `read` | `codocs:project-cabinet:read` | aims/server/utils/codocsApi.ts:595,624 |
| `codocs:project-cabinet` | `upload` | `codocs:project-cabinet:upload` | aims/server/utils/codocsApi.ts:569 |
| `codocs:project-cabinet` | `delete` | `codocs:project-cabinet:delete` | aims/server/utils/codocsApi.ts:650 |

共同接收策略与信封：`codocs/server/lib/serviceAuthPolicy.ts:28–127`、projectDocumentAccessService、productDocumentContentService、projectDocumentQualityService；来源由 `aims/server/utils/codocsCallerSource.ts` 选择 enterprise/runtime 配对。部分产品/部门/公司汇总入口的平移在后批；此15条为已审双来源合同全集，发布本批不宣称这些入口已全部迁移。

候选 seed/verify 已存在：`console/docs/sql/Console-SQL-{Seed,Verify}-p1-enterprise-codocs-candidate.sql`。参数 @p1_tenant、@p1_enterprise_deployment；每 semanticScope 恰一条 active、部署/audience/租户精确。

**已有物理别名停止关口**：G7 把 `codocs:project-document:content:read` 存作 resource=`codocs:project-document:content`/action=`read`，P1 候选是 resource=`codocs:project-document`/action=`content:read`；两者语义相同。N2 前按(client,audience,semanticScope)联查，再按物理唯一键核对。若现场已有别名行，不能直接运行整份 P1 seed 再插第二条：记录 ID/字段，给用户确认精确跳过该已满足语义行或另案规范化；不改其字段、不复制权限。verify 的物理结果与语义结果须分别记录。

### 3.2 新通道及遗漏的 OSS / Codocs 内层读取：8 组

`R`=Host 实际 Runtime audience，`C`=Codocs 实际 Runtime audience；预计均 data-runtime，待 N1 核实。以下完整补入新的候选 `Console-SQL-{Seed,Verify}-p1-enterprise-channels-candidate.sql`，只插缺失，不修复既有行。

| client | resource | action | audience | semanticScope / 实际请求 | 来源部署 | 依据 |
| --- | --- | --- | --- | --- | --- | --- |
| workflow.runtime | enterprise:workflow-callback | execute | enterprise | enterprise:workflow-callback:execute | C000001-workflow | workflow/server/utils/callbackTarget.ts:3、dataRuntime.ts:212；按 app_code=aims 整组改目标 |
| console.runtime | enterprise:notification-detail | authorize | enterprise | enterprise:notification-detail:authorize | C000001-console | console/server/utils/notificationDetailContract.ts:43–44、notificationDetails.ts:141；aims/assets prepare/finalize |
| enterprise.runtime | R:aims:scheduler | execute | R | aims:scheduler:execute | C000001-prod-enterprise | foundation/server/utils/enterpriseRuntimeChannels.ts:18；两类回调共用，无用户委托 |
| enterprise.runtime | R:aims:notification-detail | authorize | R | aims:notification-detail:authorize | C000001-prod-enterprise | 同文件:30；aims/server/utils/notificationDetailAuthorization.ts:45 |
| enterprise.runtime | R:assets:notification-detail | authorize | R | assets:notification-detail:authorize | C000001-prod-enterprise | 同文件:30；assets/server/utils/notificationDetailAuthorization.ts:33；Console 同次改目标，不能漏 Assets |
| enterprise.runtime | integration_config | view | R | integration_config:view | C000001-prod-enterprise | enterpriseCodocsDocumentContent.ts:14→codocs/oss.ts:183→ossRuntime.ts:37→Foundation integrationConfig.ts:160；Host原生正文读取 |
| enterprise.runtime | credential_vault | resolve | R | credential_vault:resolve | C000001-prod-enterprise | 同链→integrationConfig.ts:177,204；仅oss.default/usageTypes=integration |
| codocs.runtime | C:codocs | read | C | codocs.read；调用时规范化为 C:codocs:read | C000001-codocs | codocs/server/utils/projectDocumentAccessService.ts:44,68；codocsRuntime.ts:86；旧 v1.54 有行但 G7 未列 read |

新增Host OSS两行仅oss.default、usageTypes=integration，与v1.55/v2.11的最小限制一致；不能授全部integration。旧行更宽/缺限制须另报，不由seed覆盖；Verify要求integrationCodes只有oss.default。最后一条不改既有宽 Codocs Runtime 合同；只是 P1 所需内层读取的缺失核对。已有 v1.54 行无 audience/绑定时 seed 不修，verify 不通过→单独请求补事实批准；不能因为已有 write 就假定 read 签发会成功。`mapServiceAudienceScopes` 支持 physical scope 与 semanticScope，真实探针必须覆盖调用的规范化形态。

### 3.3 已有共享依赖：逐条核验，不重复授权

下表每行均要求 active、精确 tenant/deployment/audience/semanticScope；来源部署按 client 所属应用。数据 Runtime 资源用 audience 前缀，业务跨服务资源不加该前缀。G7 已列的不等于现场已装；旧行缺绑定/撤销只报告，不静默修。

| client | resource | action | audience | semanticScope/请求 scope | 来源部署 | 代码/现有制品依据 |
| --- | --- | --- | --- | --- | --- | --- |
| enterprise.runtime | R:aims:enterprise-host | execute | R | aims:enterprise-host:execute | Enterprise | enterpriseRuntimeClient.ts:294,423；8固定文档 U 操作、成员/完成等既有 U |
| enterprise.runtime | R:codocs:enterprise-host | execute | R | codocs:enterprise-host:execute | Enterprise | enterpriseCodocsDocumentContent.ts；原生 open 的 Codocs ACL/正文桥 |
| enterprise.runtime | R:console:policy-bundle | read | R | console:policy-bundle:read | Enterprise | foundation/server/utils/enterprisePolicyReader.ts:10 |
| console.runtime | data-runtime:console:policy-bundle | read | data-runtime | console:policy-bundle:read | Console | consolePolicyStore.ts:24 / G7 探针既有正例 |
| enterprise.runtime | console:authorization-role-holders | read | console | console:authorization-role-holders:read | Enterprise | G7 catalog；project_director 的既有 roleCodes 限定须保留 |
| enterprise.runtime | console:directory-users | read | console | console:directory-users:read | Enterprise | G7 externalServicePolicies、Directory 参与者核验 |
| enterprise.runtime | console:directory-project-access | read | console | console:directory-project-access:read | Enterprise | G7 externalServicePolicies（保持非 P1 数据门槛） |
| enterprise.runtime | console:business-domain | view | console | console:business-domain:view | Enterprise | G7 externalServicePolicies（保持共享路径） |
| enterprise.runtime | workflow | proxy | workflow | workflow:proxy | Enterprise | Foundation Workflow 代理 / G7 catalog；发起申请仍走原链 |
| enterprise.runtime | notifications | publish | notifications | notifications:publish | Enterprise | foundation/server/utils/notifications.ts:329 等 / G7 catalog |
| workflow.runtime | notifications | publish | notifications | notifications:publish | Workflow | runtimeActionableLifecycles.ts:79，创建通知/关闭生命周期 |
| workflow.runtime | console:authorization | subject-eligibility | console | console:authorization:subject-eligibility | Workflow | foundation/server/utils/subjectEligibility.ts:48–49；v1.97 保留 registeredPurposes/endpoints |
| codocs.runtime | C:codocs | write | C | codocs.write；实际 C:codocs:write | Codocs | codocsRuntime.ts:86；v1.54/G7 write 行 |
| codocs.runtime | integration_config | view | C | integration_config:view | Codocs | foundation/server/utils/integrationConfig.ts:160，console-integration 格式不加前缀 |
| codocs.runtime | credential_vault | resolve | C | credential_vault:resolve | Codocs | 同文件:177；保留 integrationCodes/usageTypes 等既有 OSS 限制 |

subject-eligibility 使用 v1.97 的明确物理 resource=`console:authorization`/action=`subject-eligibility`，不能按本单其他 scope 的最后冒号规则生成。保留 registeredPurposes/endpoints 与真实绑定。旧独立 `getCodocsDocumentContent` 的 codocs:documents:read 在新6类文档图中没有调用，不追加该scope；不得按整个工具文件的scope字面量盲目扩权。人员页面授权快照由登录态 Console token 路径读取（platformBundleAuthorization.ts:382/725），不是凭空增加 enterprise→console subject-scoped grant。六类旧 Aims HTTP 服务的 subject-scoped helper 不在新 typed 传递图中，因此不把它们的 scope 当作本批新依赖。

### 3.4 保留的外投/过渡授权（不撤销）

| client | resource / action | audience | semanticScope | 来源部署 | 依据 |
| --- | --- | --- | --- | --- | --- |
| aims.runtime | A:aims:integration_operation / execute | A∈既有data-runtime,tenant-runtime | aims:integration_operation:execute | Aims | tenantRuntimeClient.ts:19；v2.31/G7，外投认领/成功/失败 |
| aims.runtime | A:aims:milestone-rollover / execute | A∈既有两 audience | aims:milestone-rollover:execute | Aims | tenantRuntimeClient.ts:20；v2.31/G7；P1不改owner |
| workflow.runtime | A:workflow:integration_operation / execute | A∈既有两 audience | workflow:integration_operation:execute | Workflow | v2.29/G7，三类 outbox drain/fail/ack 版本栅栏 |
| aims.runtime | codocs:company-weekly-summary / publish | codocs | codocs:company-weekly-summary:publish | Aims | G7；现外投保留，P1不切公司汇总owner |
| aims.runtime | aims:work-item-completion-callback / execute | data-runtime | aims:work-item-completion-callback:execute | Aims | v2.17 旧回调Runtime grant；原物理未加前缀，P1不改该旧行 |
| workflow.runtime | workflow / callback | aims | workflow:callback | Workflow | v2.7；滚动切换及回退保留旧目标 |
| aims.runtime | workflow:work-item-complete / create | workflow | workflow:work-item-complete:create | Aims | workItemCompletionTransport.ts:66；v2.6，真正外投创建能力 |
| workflow.runtime | A:workflow:work-item-complete / create | A=实际Runtime audience | workflow:work-item-complete:create（调用方可能加A前缀） | Workflow | service/aims-work-item-completion-approval.post.ts:42；v2.7 |
| workflow.runtime | A:workflow / read | A=实际Runtime audience | workflow.read；请求A:workflow:read | Workflow | workflow/server/middleware/data-runtime.ts:91；审批查询 |
| workflow.runtime | A:workflow / write | A=实际Runtime audience | workflow.write；请求A:workflow:write | Workflow | 同文件:91；审批决策不改鉴权 |
| workflow.runtime | console:directory-users / read | console | console:directory-users:read | Workflow | v1.96；Workflow审批人Directory解析 |
| console.runtime | workflow:notification-details / authorize | workflow | workflow:notification-details:authorize | Console | notificationDetailContract.ts:46，Workflow通知详情保持原目标 |


G7 的原 enterprise→aims 六项 project-documents/read/write/download、project-document-sources/read、project-document-access/read/manage 与其余已装域 grant 全部保持不动；新 Host 六入口不应再请求这些 Aims HTTP scope。Codocs OSS 既有6物理行（raw/data-runtime/tenant-runtime × integration_config/view、credential_vault/resolve）保留非目标限制，实际 P1只用上表 raw+C，但不清理其它4。更多现网消费者必须从现场只读日志核对，本文不表示可撤其授权。

## 4. grant 执行、签发与回退（N2）

### 4.1 先审差集

SQL 在 Console 库执行，不能在统一业务库误写。使用保护 mysql cnf，不把密码放 argv。预计新增上限15+8=23行，实际只按缺失差集批准。先绑定参数文件（0600、不含凭据），示例：

```sql
SET @p1_tenant='C000001';
SET @p1_enterprise_deployment='C000001-prod-enterprise';
SET @p1_workflow_deployment='C000001-workflow';
SET @p1_console_deployment='C000001-console';
SET @p1_codocs_deployment='C000001-codocs';
SET @p1_runtime_audience='data-runtime';
SET @p1_codocs_runtime_audience='data-runtime';
```

用同一个 mysql 会话 source 参数和 SQL（拆会话变量会丢失）。例如：

```sh
set -euo pipefail
umask 077
# CONSOLE_DB/ROLL/SQL_ROOT/参数文件路径先由 N1 固定；不含密码。
mysql --defaults-extra-file=/etc/hzy/ops/console.cnf --show-warnings "$CONSOLE_DB" <<SQL
SOURCE $ROLL/p1-parameters.sql;
SOURCE $SQL_ROOT/Console-SQL-Verify-p1-enterprise-codocs-candidate.sql;
SOURCE $SQL_ROOT/Console-SQL-Verify-p1-enterprise-channels-candidate.sql;
SQL
```

写前 verify 用于形成缺失/已就绪/缺绑定/revoked/物理别名差集，不能因输出有行就认为通过。先人工确认无冲突；批准具体缺失 ID 键之后，依次 source 两份 Seed，再 source 两份 Verify。每份非零立即停止；每个目标行 exact_active=1、present=1、revoked=0，来源客户端唯一 active；语义别名不得重复。seed 新增行数必须等于审定差集，再次运行应0（是否重跑也记录动作）。写前/写后所有非目标行按 id 排序全字段 hash 相同，已存在目标行逐字段不变。

候选 SQL 仅 INSERT、不 DELETE/UPDATE；既有 key（包括 revoked）不触碰。别名阻止新通道 seed 重复插入，但 verify 将提示对应物理key缺失，需要审定别名处理。历史行 source 不强制换成 candidate；只检查其授权事实，原 integrationCodes/usageTypes/roleCodes 不能丢。

### 4.2 真实令牌探测（只输出状态/claims 摘要）

N2批准包含真实服务客户端签发；从各0600 secret文件内存读取，不能使用服务账号替代用户业务验收。按上述全集中的**实际请求字符串**逐条发 `POST <已批准 Console origin>/oauth/token`：JSON `grant_type=client_credentials, client_id, audience, scope, source_binding=service-client-policy`，Basic 使用对应 client/secret；认证上下文决定 tenant/deployment，不依赖请求体自报。禁止 curl verbose、set -x、输出 response body/token；记录 UTC、client、audience、scope、HTTP状态，在内存检查 token_use=service、aud、scope、source_app、tenant、deployment、签发issuer与exp/TTL。Codocs read/write 要请求规范化 C:codocs:read|write；系统/purpose业务 scope 不加前缀。仅 JWT decode 不证明验签，N4/N5还需接收端实际验签/使用。

已有 `node deploy/self-hosted/probe-prod-service-tokens.mjs --config <0600文件>` **不能直接作为本批完整探针**：矩阵尚无新通道，且含“Enterprise公司汇总 scope拒绝”的旧负例，与本批15条授权冲突。执行前需审查一份针对本文清单的探针矩阵/只读运维调用器；不能直接照搬该 helper、宣称它覆盖P1。这是执行准备门禁，不在本轮修改其代码。

新通道每scope至少一200正例；错aud/错部署/错来源的反例403；错误不得fallback到旧身份。Runtime system/purpose 的错通道反例以已审隔离测试加一次无副作用接收探针验证；body必须是已审无效体且400证明到handler，不用真实callback重复推进业务。生产开关仍true时不能要求旧Aims来源403，它仍是允许的回滚lane。

### 4.3 grant 回退

本批成功后可保留新行用于回滚修复，旧制品不会因多出grant自动调用新路径。若用户要求撤销新增行，只针对N2记录的新ID、client/resource/action/完整scope_json再次比对后，经单独批准 `UPDATE service_client_grants SET status='revoked' WHERE id IN (<本批新ID>) AND status='active'`；核对影响行数与非目标hash。不整表恢复、不删除行、不复活历史revoked、不动原G7/调度/OSS授权。

## 5. 构建、配置与发布制品

从 GitLab 固定完整SHA，至少包含56bf0d1e；后续代码合入需重审差异。不含任何主checkout未提交内容。构建机 Node v24.18.0/锁定pnpm、Linux与目标架构一致。审批记录填APP_VERSION、RUNTIME_VERSION、完整SHA和制品SHA。

| 应用 | 重建/发布 | 原因 |
| --- | --- | --- |
| Runtime | 必须新版本 | 新U文档操作、双来源system/purpose校验、source默认修复 |
| Codocs | 必须 | 15能力双来源、信封、来源审计；旧Aims窗口仍开 |
| Enterprise | 必须 | 6typed文档桥、新回调/通知详情入站与ready目录；同包包含Aims/Assets owning核心 |
| Workflow | 必须 | app_code=aims整组回调映射Enterprise；其它app保持原回调 |
| Console | 必须 | aims/assets通知详情改Enterprise purpose目标 |
| Aims | 同SHA重建保留运行 | Foundation与共享代码一致，仍持有aims.runtime外投；不迁移调度owner |
| Gateway | 生成目录若随P1变化则同SHA重建 | 必须能到Enterprise新服务路由；不改cron/旧Aims目标/退役规则 |
| Platform/Collab | P1不发布 | 不涉及其运行代码/权限release/协作协议 |

构建示例（批准后才执行）：

```sh
node deploy/self-hosted/build.mjs --commit "$COMMIT" --version "$APP_VERSION"   --apps codocs,enterprise,workflow,console,aims,gateway --out "$ARTIFACTS"
# 独立干净源码目录里：
(cd "$BUILD_DIR/data-runtime" && CGO_ENABLED=0 GOOS=linux GOARCH="$TARGET_ARCH" go build -trimpath  -ldflags "-X github.com/huizhi-yun/data-runtime/internal/version.Version=$RUNTIME_VERSION -X github.com/huizhi-yun/data-runtime/internal/version.Commit=$COMMIT -X github.com/huizhi-yun/data-runtime/internal/version.BuiltAt=$BUILT_AT"  -o "$ARTIFACTS/hzy-data-runtime" ./cmd/data-runtime)
```

检查每包manifest/index/hash、全部本地相对import完整、Aims Node包不引用deploy源码、生产无hzy0标志/测试地址/secret。全量Go/TS与P1隔离 suite证据随包，不在生产跑写测试。迁移布局/视图映射无变化；运行前按已装artifact/profile做 `hzy-enterprise-verify-views --config <config> --profile <profile> --install-artifact <artifact>`，不安装/重建视图。

配置：Runtime `enterprise.allowLegacyAimsCallbacks=true`、`allowLegacyNotificationDetails=true`（代码缺省true，生产明确写true方便审计）；Codocs `HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED=true`（缺省true）；AA-04 `enterprise.enableMilestoneReceivable=false`；部署绑定含Enterprise以及原Aims/Workflow/Console/Codocs不删除。保持现有lane/scheduler/generation，不因P1新增开关。自托管各服务 `HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON` 必须含正确Enterprise/Codocs/Console回环，Console=127.0.0.1:31001；Runtime规范endpoint与dial=127.0.0.1:31080按既有合同，不能用hzy0 route/dial机制。clientSecret只在受保护env/凭据入口，不在包内。Gateway目录中的Enterprise目标deployment须与Runtime登记一致。`--aims-retired` renderer检查本阶段不使用；留到P2/P4全部旧消费者退役后再关闭三开关并验证。

## 6. 按依赖切换与观察（N3/N4）

1. **N2已通过**，入口切维护页，暂停cron/请求驱动/手工投递，记录暂停水位；不能在窗口内进行审批或create。确认现网无写入后备份最终配置。外投暂停必须覆盖Aims、Workflow与Gateway，不只是禁止运维手工drain。
2. **Runtime切换（N3）**：systemctl stop hzy-data-runtime 会通过Requires连带停止Gateway及全部应用！不要把它当只影响Go的重启。保护旧二进制/配置，安装已审新版本、verify-views通过、启动Runtime，核对回环health=200且版本/SHA/issuer/bindings正确。未达listening保持维护页，不启动写验收。
Runtime替换的精确动作模板（N3维护窗口内，RUNTIME_BIN取当前unit的已核实绝对ExecStart二进制路径，OWNER/GROUP/MODE按原文件记录；不得指向config/脚本）：

```sh
systemctl stop hzy-data-runtime
cp --preserve=all -- "$RUNTIME_BIN" "$ROLL/runtime.previous"
cp --preserve=all -- /etc/hzy-data-runtime/config.json "$ROLL/runtime.config.previous.json"
install -o "$RUNTIME_OWNER" -g "$RUNTIME_GROUP" -m "$RUNTIME_MODE" \
  "$ARTIFACTS/hzy-data-runtime" "$RUNTIME_BIN.next"
mv -f -- "$RUNTIME_BIN.next" "$RUNTIME_BIN"
# 已装 profile/install-artifact 路径必须来自N1记录；只读校验不重建视图。
"$VERIFY_VIEWS_BIN" --config /etc/hzy-data-runtime/config.json --profile "$PROFILE" --install-artifact "$INSTALL_ARTIFACT"
systemctl start hzy-data-runtime
curl --fail --silent --output /dev/null http://127.0.0.1:31080/runtime/health
```

若部署采用签名包installer而非原路径替换，则先审定其固定版本安装命令，本模板不得绕过发行签名校验。回滚停止Runtime、把 `$ROLL/runtime.previous` 安装回相同路径并恢复备份config，然后执行下文整栈启动与公网校验。

3. **Codocs先就绪**（N4），采用校验过的包切current，保留legacy=true；127.0.0.1:31005编辑器入口可响应，匿名Service API401；有效Enterprise凭据+已审无效命令到业务校验400，错source/aud/deployment403，不能因内省依赖故障503继续。
4. **Enterprise再就绪**：新入口由Host owning core处理；页面/login/route目录与Nuxt chunks完整。callback入站来源Workflow固定client；通知入站来源Console固定purpose，不能把入站token转发Runtime。
5. **Workflow/Console最后切新调用方**：先确认它们对应新grant可签发，新接收端可达。Aims发布同SHA包但owner/外投配置不变。Gateway如需发布目录，核对原Tailscale来源白名单/入口/current引用；不改变scheduler间隔。
6. **每次Runtime停止/重启后，必须显式启动并核验整栈**：

```sh
systemctl start hzy-data-runtime
# Runtime health/版本通过后；包按上面接收端顺序已切完
systemctl start hzy-console hzy-codocs hzy-enterprise hzy-aims hzy-workflow
systemctl start hzy-tenant-gateway
systemctl is-active hzy-data-runtime hzy-console hzy-workflow hzy-codocs hzy-enterprise hzy-aims hzy-tenant-gateway
curl --fail --silent --output /dev/null http://127.0.0.1:31080/runtime/health
curl --fail --silent --output /dev/null http://127.0.0.1:8781/readyz
curl --silent --output /dev/null --write-out '%{http_code}\n' https://aidcp.wiztek.cn/enterprise/
```

Requires停止后，不会因为Runtime恢复就自动把已停应用全部复活。Collab若在现场也Requires Runtime，同样启动并核对；不借此次改变它的开关。公网允许已登录200/未登录受控302，不接受5xx或循环。每个回环监听/公网入口连续3次通过，才退出维护页。
7. 自托管release工具默认排序Console→Workflow→Aims→Codocs→Enterprise，与本单接收端优先不同；**不得不加控制地一键publish整份index并开放流量**。由审定的分段index或停机维护中的显式分段发布先Runtime→Codocs→Enterprise，再恢复调用方；record每次current旧/新值。仓库Aims health脚本直连managed-cloud drain会503（release.mjs:76），不能拿它当空队列GET或反复drain。N4先核实现网已审health override；缺失则停下报告，不新增生产旁路、不用返回200的假端点代替。
8. 退出维护前先只读导航/列表/详情，检查Codocs来源审计事件 `codocs-service-source.enterprise`，固定字段 event/source/client/scope/branch，不记录正文/token。N5完成后恢复原cron/外投，保留hzy-aims在线。
9. 观察至少30分钟并覆盖一次原调度周期与相关正常drain。记录回调时延、outbox version/attempt、非预期401/403/503、重复receipt/通知、来源legacy/enterprise计数；至少72小时持续观察abandoned及依赖阻塞。旧scope请求出现属于过渡记录，不能本批撤销。

回滚：先维护页与暂停投递，恢复Workflow/Console旧目标调用包，再恢复Enterprise/Codocs/Aims/Gateway旧包、Runtime旧二进制/config（确保schema兼容，无本批DDL）。每个Runtime停止之后重复第6步整栈启动。旧来源legacy窗口始终true；核对health/公网/回执/水位后才恢复旧调度。新审批不可重新提交，新effect始终原key走正式重试/对账，不直接UPDATE outbox。失败现场和新包保留。

## 7. 业务验收与正式清理（N5）

管理员/项目经理账号与非成员审批账号由用户提供；客户端grant探针不能代替用户。仅标记项目/文档/事项，操作前登记原值与ID，任何偏差停止。下列HTTP成功是对应既有路由200；固定业务错误码/409属专门反例，不能用“页面能打开”替代使用验证。

| 用例 | 正式步骤 | 后台核对与清理 |
| --- | --- | --- |
| 项目文档列表/详情/accessible | 登录Host→标记项目文档页→翻页/详情/可访问文档→打开正文 | COUNT/分页一致，项目目录父链合法文档可见；portfolio-only不漏入，范围外/无Codocs ACL403/404。原生open先关系核UUID再Codocs ACL，无Aims HTTP跳 |
| 目录与Markdown | 新建带标记目录（真实UI含uuid/parentId/isFolder）→同意图重试；新建Markdown并预览 | Runtime source=codocs非NULL，UUID同键只一行，Codocs命令receipt/OSS对象元数据存在，内容不输出；失败可同键恢复；测试文件/目录用正式删除清理 |
| 附件上传/ACL/预览/下载 | 上传小标记允许类型文件→预览/下载→经理修改只读/策略并恢复 | repo/cabinet索引路径/UUID/receipt绑定一致；署名Enterprise信封，Codocs edit/view/download双门槛；非经理/缺edit权限403，跨项目拒绝且无写；恢复策略原值并删除附件 |
| 工作项完成审批 | 准备证据与小标记工时→提交一次→现hzy-aims正式外投一次→非本人同意/驳回一次 | Workflow实例/冻结hash唯一，app_code仍aims但transport target=enterprise；Runtime走enterprise系统scope，callback原key回执唯一，批准completed/驳回in_progress，自审拒绝；通知与pending投影不重复，按正式归档；有不可变审批历史的测试事项记录保留 |
| 里程碑完成回调 | 选符合原合同样本、仅既有普通完成申请→非本人审批一次→现外投/回调 | 原callback相对path不变、目标Enterprise；Runtime状态/receipt同键，无第二次推进。AA-04应保持关闭，涉及应收协同的样本必须明确503/固定拒绝，不借此开lane；无合适样本记缺口不造库数据 |
| 通知详情 | 打开一条Aims通知，再打开一条Assets通知（含prepare/finalize） | Console→Enterprise enterprise:notification-detail:authorize；Enterprise→Runtime对应domain单数notification-detail:authorize；viewer/purpose/challenge/id绑定、读取前后复核；错viewer/过期/跨domain403，无跨人正文，legacy关闭反例只用隔离证据，本阶段不改开关 |
| 审批及依赖回归 | 查看其它app既有审批与一条旧Aims消费者请求 | 其它app仍原audience/workflow:callback映射；旧Aims来源在过渡窗允许，不被新source误拒；关闭/创建顺序、version fail栅栏/幂等目标、abandoned不自动领取保持 |

验收记录：每项UTC、操作者uid/测试对象ID、requestId仅关联线索、HTTP/机器码、当前制品版本、grant行ID、receipt/operation/notification/projection ID、OSS仅元数据(hash/size/version)与来源审计枚举。可信归属依据credentialId与批准记录，不靠调用方requestId。禁止输出正文、JWT、secret、SQL凭据或签名原文。恢复原ACL与删除无历史测试对象；审批历史按台账永久标记，不硬删。

## 8. 本单完成条件及未授权后续

所有grant实际scope签发200且接收端使用验证、各入口双门槛正反例、整栈重启与公网登录、上述业务receipt/OSS/state对账均通过，才记P1生产通过。任何无样本/缺正式入口/未跑探针的项标未完成并报审批人。

本轮只准备执行单与候选SQL；尚缺现场版本/实际audience/授权差集/完整新探针矩阵/分段发布与Aims健康override的审批事实，不能据文档直接发布。P2/P4另案处理hzy-aims退役、legacy三开关收回、旧grant撤销与owner切换；停止Runtime的整栈恢复要求同样适用后续每一步。


## 9. 本轮交付与静态核验

只新增本执行单及 `console/docs/sql/Console-SQL-Seed-p1-enterprise-channels-candidate.sql`、对应 Verify。现有15条Codocs seed/verify原样复用，不修改应用代码。新增候选逐行8组，source标记 candidate、只插缺失、不创建凭据、无UPDATE/DELETE；OSS两行限制oss.default。静态核对八个scope、实际audience参数及保护元数据通过；git diff --check通过。**没有连接MySQL，没有执行候选SQL，没有签发令牌，没有构建或重启进程。** 新候选SQL的隔离MySQL验证须在执行审批前补跑，本轮不声称已验证SQL执行。
