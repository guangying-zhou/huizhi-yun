# 项目页面恢复：生产发布执行单

状态：**仅起草，未连接生产、未执行、未提交。所有环境写入需用户逐项批准。**

## 1. 固定基线与边界

- 生产：`self-hosted/s4-rc24` / `1ca2d5c4`，Runtime `0.3.224`。
- 本执行单候选：`5113fa3a68be1eff6cc5c8f2e78a503a0a887d05`。后续提交不得自动带入；变更候选须重算差集并审查。
- 建议 Runtime `0.3.225`、应用 `self-hosted/s4-rc25`；执行前核验版本/标签未占用，不覆盖不可变制品。仓库 VERSION 的 `0.3.220` 不能作为生产目标版本。
- Platform 环境分离（`a776af8e`、`5910d77b`、`3b942faf`）已部署，本轮不重复部署/迁移 Platform。
- 生产实例保持 **pinned**；批准渠道 `stable-prod` 不等于安装，也不改成 tracking。测试环境、日本旧实例、account 与并行文档不在发布范围。
- 依据：`.git/brief-prod-release-project-pages-20261002.md`（含 Claude 2026-10-02 生产只读 grant 核对）；既有流程见 `Go-Live-Aims-Into-Enterprise-P1-Runbook.md`。本文命令均为将来批准后的执行模板。

## 2. rc24 到候选的差异

| 制品 | 变化/处理 |
|---|---|
| Runtime | 必须重建：R1a/b/c 需求、R3 生命周期/模块、R2a/b 成果/质量、R2c 文档规则、项目页签及按项目编辑授权、Console 企业简称；需求任务缺计数行时补齐既有计数行 |
| Enterprise | 必须重建：需求/成果/设置 UI 与 BFF、文档/仓库提示、页签开放/受限页停止请求、菜单及企业简称；readiness 与导航生成物随同提交构建 |
| Aims | 必须同 SHA 重建：owning typed 核心、文档/需求/质量/项目权限；仍以 scheduler-only 方式运行，不重新开放独立用户入口 |
| Codocs | 我的文档页签/页面变化，重建；此差集没有 Codocs server 业务修改，既有独立 Service API 合同保持 |
| Console | 模块源码无差集；本轮企业简称 Runtime 操作不在 Console Node 内。为 Foundation/整包一致性，同 SHA 构建，不宣称有新增 Console 服务逻辑 |
| Workflow | Node 模块源码无差集；共享 Workflow reader 的 Go 变化在 Runtime。为整包一致性同 SHA 构建 |
| Gateway | 生产 Gateway 源码无差集；hzy0 topology/路由修改不能当生产变更。六制品同 SHA 构建，保留生产配置/路由 |
| Platform | 环境分离已上线，本轮仅调用现有 prod 发布批准，不再发布 Platform |
| Collab | 不发布；若其现有单元依赖 Runtime 且此前 active，连带停机后恢复原运行状态 |

主要提交：R1a `d0be1fb1`、R1b `b7588643`、R1c `57e2bd38`、R3 `e7f39d30`、R2a `13e0b68a`、R2b `e8af93b6`、R2c `9e226a32`、org-brand `01b26dee`、页签 `02cd5252`、Altoc verify `571dd58b`、前端清理 `5113fa3a`。以完整 SHA 的实际差集为准。

### 2.1 新增固定 Runtime 操作（33 个）

以下名称均位于 `foundation/server/utils/enterpriseRuntimeClient.ts`。Aims 路径前缀 `/v1/enterprise/aims/`；除最后一行外全部复用 `aims:enterprise-host:execute`，不新增 grant。服务 capability 不能替代人员权限、对象范围、当前经理/审核人等领域判权。

| 批次 | 固定 operation（`aims.` 前缀） | 路径尾部 |
|---|---|---|
| R1a | project-requirement-target-list / project-requirement-spec-view | project-requirements:targets / :spec |
| R1a | project-requirement-create / content-create / import / update / delete | project-requirements:create / :content-create / :import / :update / :delete（content 名称完整为 project-requirement-content-create） |
| R1a | project-requirement-content-update / content-delete / content-restore | project-requirements:content-update / :content-delete / :content-restore |
| R1b | project-requirement-versions / change-diff / change-impact | project-requirements:versions / :change-diff / :change-impact |
| R1b | project-requirement-review-list / review-resolve | project-requirements:review-list / :review-resolve |
| R1b | project-requirement-change-create / task-create | project-requirements:change-create / :task-create |
| R1b | project-requirement-review-create / review-append / review-withdraw | project-requirements:review-create / :review-append / :review-withdraw |
| R1c | project-requirement-review-sync / review-create-tasks | project-requirements:review-sync / :review-create-tasks |
| R3 | project-modules-update / project-lifecycle-request / project-lifecycle-bind | project-modules:update / project-lifecycle:request / :bind |
| R2a | project-output-overview / project-repo-candidates | project-output:view / project-repos:candidates |
| R2b | quality-submission-resume / quality-submission-create / quality-submission-activate / quality-completeness / quality-waiver | deliverable-quality:submission-resume / :submission-create / :submission-activate / :completeness / :waiver |
| Console | `console.org-brand-view` | `/v1/enterprise/console/org-brand:view`，`console:enterprise-host:execute` |

计数：10+10+2+3+2+5+1=33。表内斜杠后的缩写继承同组前缀，不是另一种 operation 字面量。

R2c、页签开放没有新固定操作，修改既有文档 context/写入和项目/嵌套读取。R1c 评审结果及 R3 生命周期结果只能由正式 Workflow 结果驱动，沿用 Enterprise 入站与 `aims:scheduler:execute`；浏览器 onApproved 不写审批状态。reader 统一为接口，一处注入，4xx 保留；在审需求更新/删除冻结，abandoned 按正式 replay 恢复。

## 3. Grant 门禁

### 3.1 已确认事实（直接引用任务书，不推测）

生产 `hzy_console.service_client_grants`，以下均 **active**：

| client | resource/action | 已确认 audience | 本轮用途 |
|---|---|---|---|
| enterprise.runtime | data-runtime:aims:enterprise-host / execute | data-runtime | 全部 32 个新增 Aims 操作、既有文档与页签路径 |
| enterprise.runtime | data-runtime:console:enterprise-host / execute | data-runtime | org-brand |
| enterprise.runtime | data-runtime:aims:scheduler / execute | data-runtime | 已验证 Workflow 回调驱动的评审/生命周期 |
| enterprise.runtime | data-runtime:codocs:enterprise-host、assets:enterprise-host、altoc:enterprise-host / execute | data-runtime | 保留既有域授权，不改 |
| enterprise.runtime | console:authorization-role-holders / read；console:directory-users / read；console:directory-project-access / read；console:business-domain / view；console:policy-bundle / read | 任务书未逐项注明 | 人员/范围快照及目录 |
| workflow.runtime | console:authorization / subject-eligibility；console:authorization-role-holders / read；console:directory-users / read | 任务书未逐项注明 | Workflow 资格/角色/目录 |

**新增固定操作所需 capability 全部被上述清单覆盖。本次没有已证实缺失 grant。** ACTIVE 不等于本文已经核验全部 JSON 绑定/限制；发布前仍比对 tenant、deployment、audience、semanticScope 和原有限制，不覆盖 scope_json。

### 3.2 尚需核验的既有传递依赖（未核验 ≠ 缺失）

按 P1 已有全集逐行复核，不安装整份 seed：

- workflow.runtime → enterprise，`enterprise:workflow-callback/execute`，semanticScope `enterprise:workflow-callback:execute`。
- console.runtime → enterprise，`enterprise:notification-detail/authorize`，semanticScope `enterprise:notification-detail:authorize`。
- enterprise.runtime → workflow，`workflow/proxy`，semanticScope `workflow:proxy`；Workflow 自身 Runtime read/write、通知 publish、scheduler grant 及资格读取保持原精确合同。
- 项目文档现有 Enterprise→Codocs 双来源 Service API、通知 purpose、OSS integration_config:view / credential_vault:resolve 依赖，逐行采用 P1 全集中的既有 audience/限制；不借 personal 身份，不新增宽 aims.read/write。

预期来源部署：Enterprise `C000001-prod-enterprise`、Workflow `C000001-workflow`、Console `C000001-console`、Codocs `C000001-codocs`、Aims `C000001-aims`。以生产登记和受保护配置再次精确核验，不能把本机 `*-test-*` seed 直接执行生产。

只读查询（在用户提供/批准的既有只读通道执行，不输出凭据）：

```sql
SELECT sc.client_code,sc.app_code,g.id,g.resource_code,g.action,g.status,
 JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')) AS audience,
 JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')) AS semanticScope,
 JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')) AS tenantCode,
 JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')) AS deploymentCode
FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
WHERE sc.client_code IN ('enterprise.runtime','workflow.runtime','console.runtime','codocs.runtime','aims.runtime')
ORDER BY sc.client_code,g.resource_code,g.action,g.id;
```

另在受保护文件内对照 scope_json 的 integrationCodes/usageTypes 等限制，只报告是否一致，不打印秘密。对同键 revoked、绑定冲突、多行、无法确认语义：停止，不修复或复活。

### 3.3 真实签发与使用

**N3 需用户逐项批准**：签发会写审计，不算纯读取。用真实客户端，从 0600 文件内存读 secret，向批准的 Console `/oauth/token` 请求 client_credentials，指定实际 audience/scope 和 `source_binding=service-client-policy`；不把 secret 放 argv/环境日志，不输出 token/body。不用服务客户端替代用户业务验收。

至少测 Enterprise 的 aims/console 域及 aims:scheduler、Workflow callback/proxy 等实际传递组合。内存验签核对 issuer、service token、aud、scope、source_app、tenant、deployment、TTL，再经正式接收端读取使用，记录状态与脱敏 claims 摘要。系统 scope 不用来访问用户 U 操作；回调不为探针伪造业务决策。无 grant/错 aud/cap/部署反例用隔离证据或批准的无副作用请求。

`probe-prod-service-tokens.mjs` 的旧矩阵不能宣称覆盖本批（P1 执行单已指出其旧负例冲突）；执行前先审定准确探针矩阵。任何拒绝停止，不连续试错。

若实际发现缺口：**N4 单独批准精确行**，先加密全表备份并验证可解密，计划列出 client/resource/action/audience/semanticScope/tenant/deployment 和原有限制、唯一键现状、逐行 verify。仅插缺失；已有 revoked 停止。记录插入 ID、非目标行摘要不变；回滚按这些新 ID 条件置 revoked（不删除、不撤销既有行）。不在本执行单预造推测的 seed 或授权写入。

## 4. Schema 与策略版本

rc24..候选没有新增 Aims/Workflow/Codocs/Console 业务 DDL 或视图映射。无需 apply 业务迁移，也不重建生产视图。需求生成任务的计数补齐使用已有 project_counters 表，是业务写入，不是 schema 迁移。

Platform 新表/列及环境策略回填已随环境分离部署，不重跑。prod/test 各自 revision 单调；不得复制 test 的版本/策略到 prod。保留生产当时当前 revision/hash，不把历史版本 38 当本次固定值。

verify-views 仅新增 separately-installed Altoc 的接受逻辑：仅绑定包含 Altoc 时加入其非同名视图，定义仍精确校验。发布前记录生产绑定 domains、generation、mapping hash、profile/install-artifact 和视图数。无 Altoc 则新增集合为空；不安装 Altoc。视图总数与生产基线比对，**不能套用 hzy0 的 156**。任何未知表/视图/代际差异停止。

## 5. 批准点与准备

| 编号 | 需用户逐项批准的写入 | 前置/失败停止 |
|---|---|---|
| N1 | 加密备份、候选构建/上传及 GitLab 发布标签 | SHA/版本空闲、受保护密钥、Linux 架构一致；不生成新真实密钥 |
| N2 | Runtime R2 stage + Platform prod sync/approve | 仅 stable-prod；日本/其它实例影响盘点通过；绝不 promote latest |
| N3 | 真实客户端签发与使用探针 | 精确矩阵审定，凭据安全，拒绝即停 |
| N4 | 可选精确 grant 缺口修复 | 仅实际缺失另案批准；当前无已知缺口 |
| N5 | 维护窗口、停服务、离线安装、publish-nostart、切换链接 | 备份可恢复、六制品验签、停机范围确认 |
| N6 | 依赖启动/恢复后台处理 | 同候选、视图验证、保留配置/运行状态；失败走批准回滚 |
| N7 | 带标记业务写冒烟、正式清理 | 样本/对象/动作先确认，审批历史不可硬删 |
| N8 | 可选回滚、恢复入口 | 回滚条件/对象明确；新业务数据不盲目覆盖 |

用户可选择合并 N1/N2（制品）、N5/N6/N8（窗口及回滚）、N3/N7（探针和业务样本），但本执行单不代用户合并批准。N4 永远以实际差集另列。

N1 批准后备份目录建议 `/home/hzy-backup/project-pages-20261002/`（0700），加密文件0600。使用既有受保护数据库/备份密钥配置，备份 Console grant 表与生产统一库/实际各域库（含 Workflow/Aims/Codocs）；不在命令行写数据库密码，不持久化明文 dump。完整性检查解密到管道/内存，核对 exit/hash/结构，不打印数据。

另备份 Runtime 二进制为上述目录 `hzy-data-runtime.before`、配置/env/unit/drop-in、各应用 current 的真实目标、Gateway 配置、生产 profile/artifact、更新 timer/path enabled/active 状态、进程/端口与策略 revision/hash。加密含凭据的文件；发布目录配置仍为原属主和受保护权限。MySQL、Platform、网络隧道不在停机范围。

## 6. 构建与发布（N1/N2，需批准）

以下路径为本次拟定，执行前填入已批准绝对路径，不照抄未确认主机布局。

```sh
set -euo pipefail
RELEASE_COMMIT=5113fa3a68be1eff6cc5c8f2e78a503a0a887d05
# 独立干净 worktree；不打包工作区脏改。
git worktree add --detach /home/hzy-build/project-pages-rc25 "$RELEASE_COMMIT"
cd /home/hzy-build/project-pages-rc25
export HZY_DATA_RUNTIME_COMMIT="$RELEASE_COMMIT"
export HZY_DATA_RUNTIME_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export HZY_DATA_RUNTIME_PACKAGE_DIR=/home/hzy-build/runtime-packages
export HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE=/etc/hzy/release-signing-private.pem
./data-runtime/scripts/package-release.sh 0.3.225
./data-runtime/scripts/upload-r2.sh 0.3.225 --stage
# 上一步 preview hash 经审定后，N2 才可执行：
./data-runtime/scripts/upload-r2.sh 0.3.225 --stage --execute --confirm '<已审 preview hash>'
node deploy/self-hosted/build.mjs --commit "$RELEASE_COMMIT" --version s4-rc25 \
 --apps console,workflow,aims,codocs,enterprise,gateway --out /home/hzy-build/project-pages-artifacts
```

Linux 构建 Node 必须 `v24.18.0`，pnpm 冻结 lock；确认六包 index 的完整 SHA/版本/OS/arch/hash。Git bundle 可用于离线送入批准的构建主机；传输也是 N1 写入。不要运行会 promote latest 的 update_dr.sh。独立构建同 SHA 的 `hzy-enterprise-verify-views` 工具（Linux 目标架构），校验 hash 后随制品传输，不假设 Runtime 包含此工具。

Platform 已有正式 ops 页面/API：sync `/api/platform/ops/runtime-releases/sync` `{version:"0.3.225"}`；approve `/api/platform/ops/runtime-releases/approve` `{environment:"prod",version:"0.3.225",confirmRollback:false,note:<审批记录>}`。确认列表为 prod/stable-prod，不调用 test/dev 批准。批准前盘点所有同密钥 prod tracking 实例；如批准会影响非本次目标，停止请用户决定。目标保持 pinned。

日本旧实例：核对其登记/渠道/更新模式与 timer；记录前后 desired/实际版本不变。本轮不更新 latest，不改其配置、timer 或凭据。不能证明影响隔离时停止 N2，不凭“共享密钥”推测安全。

仅批准标签发布时：核对 origin 为 GitLab，标签未占用，给完整候选 SHA 建 annotated `self-hosted/s4-rc25` 并 `git push origin refs/tags/self-hosted/s4-rc25`。不推 GitHub。

## 7. 停机、安装与成对切换（N5/N6）

### 7.1 前置与暂停

读取实际 `systemctl cat`，记录全部 Requires/Wants/After、工作目录/env/current 链接。Runtime 停止会连带 Gateway、Console、Enterprise、Workflow、Aims、Codocs，以及此前启用的 Collab；restart Runtime 不会自动恢复它们。Gateway Wants 可能拉起其它应用，不能把启动 Gateway 当隔离启动。

先维护入口，暂停外部 scheduler/cron/手动 drain 和业务写入；随后停止 Gateway 与实际应用，再停 Runtime。暂停/恢复 scheduler 配置是 N5/N6 写入，须列出实际来源与回滚，不假设有通用 pause API。Runtime 停止时进程内任务停止；Runtime/Workflow/Aims 启动可能恢复后台写入，N6 明确覆盖此事，窗口内禁止混用新旧应用。记录待投递数量/attempt、水位，不改 outbox 行。

```sh
sudo systemctl stop hzy-gateway hzy-enterprise hzy-aims hzy-codocs hzy-workflow hzy-console
# Collab 仅此前 active 且依赖 Runtime 时停止，收尾恢复原状态。
sudo systemctl stop hzy-data-runtime
```

### 7.2 离线 Runtime

先验 install.sh 签名和包 hash/signature，再执行：

```sh
sudo bash /home/hzy-backup/runtime-release/0.3.225/install.sh \
 --base-url file:///home/hzy-backup/runtime-release --version 0.3.225 \
 --release-public-key /etc/hzy/release-signing-public.pem \
 --user hzy-runtime --group hzy --no-auto-update --no-start
sudo /home/hzy/tools/hzy-enterprise-verify-views \
 --config /etc/hzy-data-runtime/config.json \
 --profile '<生产受保护 profile 绝对路径>' \
 --install-artifact '<生产 install-artifact 绝对路径>'
```

`--no-start` 仍会写安装目录/unit；不可视为只读。保留 `HZY_DATA_RUNTIME_CONFIG` 及原 config/env/drop-in，不重新 enroll。安装器可能重新 enable update-request.path，立即按记录恢复批准前 timer/path 状态，不能仅相信 --no-auto-update；不启动自动更新。每步非零退出立即停止，verify 不是 PASS 不启动。

### 7.3 应用 publish-nostart

`release.mjs` CLI 没有 --no-start，禁止直接普通发布自动重启。使用其已验证导出，在匹配的 Linux 架构上：

```sh
PUBLISH_INDEX=/home/hzy-build/project-pages-artifacts/index.json \
PUBLISH_ROOT=/home/hzy/apps node --input-type=module <<'JS'
import { publishIndex } from './deploy/self-hosted/release.mjs'
await publishIndex({indexPath:process.env.PUBLISH_INDEX,root:process.env.PUBLISH_ROOT,
 restart:async()=>{},health:async()=>{},keep:99999})
JS
for app in console workflow aims codocs enterprise gateway; do
 node deploy/self-hosted/verify.mjs --dir "/home/hzy/apps/$app/releases/s4-rc25" --app "$app"
done
```

在干净构建仓库目录执行该相对 import。此操作写 release/current 链接，N5 批准后才能运行；高 keep 避免顺带清理其它历史制品。保留 rc24 路径，检查配置装配与 permissions，不从开发 secret 覆盖生产 env。六包都校验成功才启动。

### 7.4 启动与硬门禁

顺序：Runtime → Console → Workflow → Aims → Codocs →（原 active Collab）→ Enterprise → Gateway 最后；各步等待 readiness，失败停止后续。Platform 不重启。启动前确认 Gateway Wants 不意外激活此前 disabled 服务。

- Runtime 31080 `/runtime/health` 连续3次200；实际二进制版本0.3.225、配置tenant/environment/generation不变。
- Console31001、Workflow31003、Aims31004、Codocs31005、Enterprise31002：实际监听、对应页面/安全只读入口与鉴权结果；无模块加载/reload循环、无缺配置。
- Codocs editor GET200；匿名精确 Service API POST须401，不误触有效写操作。
- **不能使用匿名直连 Aims drain 当健康探针**：managed-cloud 无 Gateway 头会失败，且 POST drain 有副作用。保留生产已审 health/drop-in；若当前 ExecStartPost 仍依赖该错误探针，先停止并另审最小修法，不能绕过鉴权。Aims scheduler-only 不验独立用户页面。
- Gateway8781 `/readyz`、8780对外入口；用户页面首轮预热连续3次200且60秒无reload后开验收。302只证明跳转，不证明登录业务健康。
- 回调实际路径 `/enterprise/api/v1/service/workflow/callback` 与通知 Service API 采用 Gateway catalog 的 `/enterprise/` basePath，不能探进程根 `/api/v1/service/*` 后宣称通过。

记录实际生产入口域名与端口后本机/公网各3次只读请求；不输出Cookie/token。恢复后台调度和入口前核对 pending/abandoned/错误率，失败依 N8 回滚。

## 8. 验收与停止规则

先只读、后 N7 批准的标记业务写；不改人员角色/授权。

| 项目 | 必须证据 |
|---|---|
| 总览/列表/分页 | 已登录zhou，COUNT/页数一致；概览不因编辑授权失败而消失；单一页签，无横滚/JS错误 |
| 需求 | 规格书、内容、历史差异/影响、评审列表；N7 小样本内容写/生成任务；正式 Workflow 决策才更新结果，浏览器不能伪造approve |
| 成果 | 立项书/规格书卡片、交付表/统计/仓库；送检/完整性/豁免分别判权；不混制品，分页真实服务端 |
| 设置 | 基本信息、成员、关联产品、状态、模块、暂停/结项；保留访问控制；completed 状态；N7批准对象的编辑/replay/409版本冲突 |
| 项目文档 | 列表/打开/仓库预览；GitLab多段路径/%2F；固定commit并提示“有更新版本”；100MB前后端一致；非空目录拒删；删除仅引用，不回收独立Codocs分享/正文/附件 |
| 我的文档/企业简称 | 页签与项目空间可加载；org-brand200，白名单字段；无敏感storage/日志 |
| test非成员 | 生产角色已清理；仅成员+管理的看板/项目目标等403且不发受限后台请求；company公开读仍按设计可见，不要求所有项目页都403；其它项目经理不能看当前项目全部工时 |
| 服务链 | 正确签发+读取200；回调/通知基路径正确；原outbox幂等与水位不异常；不重放生产审批决策做探针 |

1440×900/390×844记录页头/页签/分页/错误请求路径+状态；截图不含秘密。每个业务写记录对象ID、稳定键、原值、正式清理或永久审批历史保留台账。附件边界用隔离测试为主，生产大文件上传另批；不为了验收造审批/角色。

任一未批准写入需求、错tenant/deployment/audience、越权成功、COUNT/范围异常、视图不一致、匿名写成功、模块500/动态导入稳定失败、重复receipt/通知、原对象被误改，立即停写；保存脱敏证据并报告，不连续drain/重试。

## 9. 回滚（N8，需批准）

1. 维护入口并暂停投递；停止Gateway/应用/Runtime，防止新旧混合运行。
2. 恢复备份 `.before` Runtime 二进制、原配置/unit/drop-in及timer/path状态；对照hash/版本0.3.224。不要依赖安装器自动备份，也不触发latest更新。
3. 六应用current分别原子切回记录的rc24真实release目标，恢复配置；不回退Platform环境分离、policy revision，不回写低版本到Platform渠道。pinned实例离线回退仍按批准记录，若控制面另需降版批准单列。
4. 原verify工具/生产profile验证基线视图，按§7顺序启动与探测，恢复此前active服务，不启动额外域。
5. 本轮没有业务DDL，通常无需DB回滚。已发生的业务写/审批/OSS对象先逐条对账并走正式恢复；禁止整库restore抹掉窗口内他人写入和审计。只有另批完整停写/数据恢复计划才允许恢复加密库备份。
6. 仅N4新插行需要撤销时按记录ID置revoked；不撤销原已存在域grant。业务测试数据按台账清理，receipt和不可变审批历史保留。

收尾回执：候选SHA/版本、制品hash、批准编号、备份可恢复证明、grant/视图/generation、实例渠道与日本核验、各入口状态、验收截图/对象清理台账、停机起止、剩余缺口。缺真实样本者记缺口，不能用隔离证据宣称生产浏览器通过。

## 10. 执行记录（2026-10-03 北京时间，用户批准全部执行）

- **N1 备份**：生产 6 个库（console/enterprise/workflow/codocs/aims_src/assets_src）、配置和 Runtime 二进制做了加密备份并校验，目录 `/home/hzy-backup/project-pages-20261002T*`（以 `/home/hzy-backup/project-pages-current` 指向为准）。
- **N1 Runtime 构建**：Runtime 0.3.225 从干净的 `5113fa3a` 在本机签名打包。
- **N1 应用构建**：Enterprise、Aims、Codocs 在生产构建机上构建，`build.mjs` 使用 `TMPDIR=/home/hzy/build/tmp`。构建前先用镜像源在临时 worktree 中联网补齐 pnpm store，再离线构建；三个包 verify 均通过。
- **Console、Workflow 未重建**：源码相对 rc24 没有差异，仍为 rc22。
- **Gateway**：rc23 在业务验收中发现缺少 `/enterprise/api/org-brand` 拓扑（返回 503 `Enterprise test binding unavailable`），随即同 SHA 重建为 rc25，只重启了 Gateway。
- **N2**：R2 只做 stage，latest 未改动。Platform 上 `stable-prod` 批准 0.3.225 尚未执行（需要运维登录）；生产实例为 pinned，不影响运行。
- **N5/N6 停机窗口**：23:32:35Z 开始，约 2 分钟。
  - 先停应用和 Gateway，再停 Runtime。
  - 离线安装 0.3.225（`--no-start`），unit 未变化；安装器重新启用了 update-request.path，已恢复为 disabled。
  - verify-views 142/142 通过。
  - 按顺序启动 Runtime、Console、Workflow、Aims、Codocs、Enterprise、Gateway。
  - Runtime health 200、版本 0.3.225；3 个新 POST 匿名访问均为 401；Platform 心跳 0.3.225 ready；生产策略续签 ok（revision 38）。
- **标签**：`self-hosted/s4-rc25` 已推送到 GitLab。
- **业务验收（zhouguangying，1440）**：以下项目通过——
  - 首页简称“汇智科技”、项目卡片字段完整；
  - 项目总览无分页（共 10 个项目集）；
  - 成果页交付文档与统计，无重复页签条；
  - 我的文档 5 个页签及“最近使用”数据正常；
  - 菜单四组加“设置”；
  - 需求/规格/评审/目标/成果接口 200。
- **发现（与本次发布无关）**：Workflow 待办列表返回 409 `role_holder_missing`。原因是项目总监角色当前没有持有人：`test` 的角色清理后，该角色无人担任。此问题在窗口前就已出现。
