# 生产上线：系统公告与全局反馈 G1 执行单

状态：P2b–P5、AN 用户验收通过；AN21 正在保留式收尾（2026-10-08）。批准仅覆盖本单精确范围。核查日期：2026-10-08。

## 1. 范围、依据与阻塞门禁

目标为自托管生产 `100.64.72.59`、租户 `C000001` 的 Console owning 公告与文本反馈 G1。不启用 G2/G3 图片、OSS 或其他业务功能；不重签 test，不更改 APF、Aims 退役、Collab、迁移、opening、Vault 或 scheduler 配置。

依据主仓受保护报告：`report-astra-announcements.md`、`report-announcements-hzy0-review.md`、`report-astra-global-feedback-g0-g1.md`、`report-astra-environment-app-pins.md`。公告以后续 Host 管理裁定为准：不新增公告 scheduler/grant；旧 Console 管理入口返回 410，管理与投递由具备 `announcements:admin` 的当前用户通过 Host 委托完成。

本轮冻结集成 SHA 为 `3c925c0ce463d258db76cc30783a05a2a4e22583`，包括反馈列表打磨、公告/反馈与 Platform pin 路由补丁。Linux 六应用已按同 SHA 构建，Runtime 目标为 `0.3.232`；制品与窗口脚本摘要保存于受保护执行证据，必须通过停机前只读门禁。

### Platform pin 1–5 前置

以下每项取得执行记录及回读证据后，才可批准生产发布：

1. 安装并 verify 环境 pin 的迁移，备份与恢复验证完成。
2. 从当前批准的生产签名包建立历史 manifest/角色权限基线；历史 release 必须可唯一回溯，不能以 latest 替代。
3. 建立 prod 精确 pin，历史基线 release 不进入 latest/test 选择路径；已有手工范围保留。
4. 只叠加 Console 公告/反馈的已审核 manifest 与人员权限，预览差异。People/Altoc/Finance 的资源、动作、角色权限、范围、baseline、蕴含规则与部署绑定逐项差异必须为零；非本次 Console 必要变化同样阻断。
5. 仅重签 `C000001/environment=prod`，回读正式 verified snapshot、版本/hash/租约/绑定，确认 Console 与 Runtime 使用同一正式快照；test 未变化。

P2b–P5 正式执行已完成：prod pin 修订 2，Console release48/manifest65（`console/v0.2.5`），其它九应用 pin 不变；prod bundle55/revision40，摘要 `sha256_c23cd65bb702e1ed618597417cf4f5d48baaab351defdab5dd3504992ee3bf37`。test revision53/hash 未变。P3 现网治理差异经 Astra 完整归因并获准接受；P4 复算 80 个 active 主体无失权，增量仅 Console 3 条员工基线与 14 条管理员授权，APF 0。正式 preview/hash、角色132/133停用与签发证据见 `.git/report-astra-environment-app-pins.md`。

员工公告 view 为全员基线；反馈 view/submit 为 `subject:self`。反馈管理 view/retry/admin、配置 view/edit 要求 `tenant:global`，显式授权；admin 不蕴含 submit/retry。服务投递能力不授予人员角色。不得为满足预览把现有角色或手工范围改掉。

## 2. 生产只读核查结果

2026-10-08 18:55 UTC，通过现有 SSH 隧道，以 `hzy_ro_audit` 在 `hzy_console` 的 READ ONLY 事务查询，结束后 ROLLBACK。只读取结构、聚合及服务绑定，不输出人员、业务正文或凭据。受保护证据：主仓 `.git/announcements-feedback-readonly/schema-grants.json`（0600，目录0700）。

| 项目 | 回读结果 | 上线含义 |
| --- | --- | --- |
| 公告四表 | 全部不存在 | 需逐表批准 DDL |
| 反馈四表 | 全部不存在 | 需逐表批准 DDL |
| `gitlab.default` | active/healthy；当前 credential 元数据 active、未过期、secret_ref 存在 | 不证明目标项目建单权限或实际网络投递 |
| `wecom.default` | 同上 | 不证明管理员能收到通知 |
| Console 物理绑定 | `C000001-console` | 不使用猜测的 prod-console 部署码 |
| Enterprise 物理绑定 | `C000001-prod-enterprise` | grant/签发按此精确绑定 |
| 七服务 | Runtime、Console、Workflow、Codocs、Enterprise、Collab、Gateway 均 active | 本轮未停止或重启 |
| 根盘 | 约46G可用，30%占用 | 构建前再次检查空间 |

`/opt/huizhi-yun/current` 未取得有效链接，不以此猜测发布路径。执行者先用 systemd 的 WorkingDirectory/ExecStart 核对真实制品与回滚目录；不得打印 Environment、DSN 或 secret 文件。

只读复核可执行：

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema=DATABASE() AND table_name IN
('console_announcements','console_announcement_departments','console_announcement_reads','console_announcement_outbox',
 'console_feedback_settings','console_feedback','console_feedback_events','console_feedback_delivery');
SELECT table_name,column_name,column_type,is_nullable,column_default
FROM information_schema.columns WHERE table_schema=DATABASE()
AND table_name IN ('console_announcements','console_announcement_departments','console_announcement_reads','console_announcement_outbox',
'console_feedback_settings','console_feedback','console_feedback_events','console_feedback_delivery')
ORDER BY table_name,ordinal_position;
```

执行时再次核对 integration 与当前 credential 的状态/有效期，只记录布尔结果，不解密打印。grant Verify 必须匹配 client、resource、action、semanticScope、audience、tenant、deployment、有效状态及有效 credential；仅 resource/action 命中不算通过。

## 3. 精确服务 grant 与签发 Verify

G1 seed/verify 的权威候选：上述 G1 SHA 的 `console/docs/sql/Console-SQL-{Seed,Verify}-v2.41-feedback-grants.sql`。冻结后从最终候选提取并核对，不对旧 seed 整包盲跑。

每行两种 audience 分别展开：`data-runtime`、`tenant-runtime`。resource 为 `<audience>:console:<resource>`，action 如表；semanticScope 为 `console:<resource>:<action>`，tenant=`C000001`。

| client / deployment | resource / action | data-runtime 现状 | tenant-runtime 现状 |
| --- | --- | --- | --- |
| console.runtime / C000001-console | feedback / view | 缺失 | 缺失 |
| 同上 | feedback / retry | 缺失 | 缺失 |
| 同上 | feedback / admin | 缺失 | 缺失 |
| 同上 | feedback-settings / view | 缺失 | 缺失 |
| 同上 | feedback-settings / edit | 缺失 | 缺失 |
| 同上 | feedback-delivery / execute | 缺失 | 缺失 |
| enterprise.runtime / C000001-prod-enterprise | enterprise-host / execute | active，原行104437604 | 缺失 |

共14精确 tuple，现有1、缺13。只补经批准的缺项，已有行语义复用；revoked、重复或 scope 不同均停止，不恢复、不覆盖。记录新增 ID、前后值与 seed hash，回滚只能处理本轮新增行。

公告不需要额外公告调度 grant。既有 Enterprise `notifications:publish` 原行104437608、目录 users 原行104437619、role-holders 原行104437606 已 active；仍须实际签发与消费 Verify。G1 Console 的站内通知走 owning typed publish，不因此新增远程 publish grant。

外发通知必须复核当前实际 adapter：connector 模式只用 `connector-runtime:notifications:send`，notification 模式只用 `notification-runtime:send`，不同时盲授两套。生产 `console.runtime` 原行6102 的 connector grant active，但 scope 中 tenant/deployment 为空；不能把它计为精确绑定已通过。Enterprise 原行104437635 为精确绑定，但不能借 Enterprise 身份替 Console 反馈投递。执行前确认当前认证合同是否明确接受该既有形状；真实精确签发不通过则停止，另交精准 seed 候选批准，不擅改6102。公告初次上线不使用外发 grant。

签发探测只记录 HTTP、错误码、aud/target_app/source_app/scope/tenant/deployment/租约逐项布尔值，token 只在内存消费，不落盘。覆盖双 audience；缺能力、错来源、错 audience、错 tenant/deployment、过期应拒绝。人员 permit 同时检查资源动作和数据范围，服务 grant 不代替人员权限。

## 4. 逐项待批执行顺序

每项独立登记批准人/时间、执行者/时间、前后值、证据路径、结果；未获批不执行。任一步 Verify 失败停止，先按§8恢复安全状态，不继续试探写入。

| 编号 | 待批动作 | Verify / 停止点 |
| --- | --- | --- |
| AN01 | 冻结最终 SHA、Linux构建 Runtime与六应用，完成相关全量测试/typecheck/lint、制品 hash | 含审核 G1/pin；无夹带未上线功能；同SHA可追溯 |
| AN02 | 按 pin 1–5 执行已独立批准的 Platform 流程，仅 prod | APF零变化；test未重签；非预期diff立即停 |
| AN03 | 备份 Console库、服务定义、制品、配置与受保护密钥引用；隔离恢复验证 | 加密备份可解密恢复；凭据不进argv/log |
| AN04 | 停写/维护；停止Runtime及依赖服务 | 停机影响全站；先记录每个PID/版本和恢复顺序 |
| AN05 | 创建 console_announcements | §9 SQL第一表；SHOW CREATE一致 |
| AN06 | 创建 console_announcement_departments | 第二表；外键一致 |
| AN07 | 创建 console_announcement_reads | 第三表；外键一致 |
| AN08 | 创建 console_announcement_outbox | 第四表；状态/通道约束一致 |
| AN09 | 创建 console_feedback_settings | §10第一表；结构一致 |
| AN10 | 创建 console_feedback | 第二表；结构一致 |
| AN11 | 创建 console_feedback_events | 第三表；结构一致 |
| AN12 | 创建 console_feedback_delivery | 第四表；结构一致 |
| AN13 | Seed已批准的13个缺失精确tuple；外发缺口若需修复另行逐tuple批准 | 不新增重复/不复活撤销；签发Verify失败停 |
| AN14 | 切同SHA Runtime与Console/Workflow/Codocs/Enterprise/Collab/Gateway六应用 | Linux正式包；逐个启动、Gateway最后；Aims仍停 |
| AN15 | 启用 Host公告 UI，保存初次公告的站内通道配置 | push_wecom=false；无公告后台scheduler |
| AN16 | 保存G1固定项目/集成/生产origin/管理员目标设置，先enabled=false | revision/CAS/Idempotency-Key；配置回读一致 |
| AN17 | 启用Console反馈投递worker与反馈接收 | Verify全过后enabled=true；仅既有受信drain |
| AN18 | 管理员发布一条批准的验收公告，员工查看/关闭/读回执 | 限定批准受众；站内，不发企业微信 |
| AN19 | 员工提交一条CLAUDE-FIXTURE文本反馈，创建固定项目Issue | 原键；最终IID/link；真实外部写入须批准 |
| AN20 | 对同一反馈投递站内与企业微信管理员通知 | 接收人active+当前global view；不可广播员工 |
| AN21 | 对已批准验收记录撤回/关闭或保留，记录处理方式 | Issue/通知不能靠回库撤销；不擅删外部Issue |

DDL可逐表执行，不使用整库 schema.sql；不得借本次安装 APF 表。每表 IF NOT EXISTS 不能代替结构检查，已存在但不一致即停。公告旧 v2.40 Verify 仍包含已取消 scheduler 断言及正文输出，不整文件直接执行；采用本单结构/精确grant回读。

备份用私有0700目录和0600 defaults 文件，数据库密码不进命令行；single-transaction、routines、events、triggers、hex-blob，转储加密后验证。隔离恢复必须确认目标非生产，事件调度状态按单独授权处理，不擅改全局变量。保留配置/服务定义原件与 hash，不输出内容。备份工具和恢复命令从生产现有批准的发布流程选取，不猜容器/库账号。

## 5. 配置、发布与回读

六应用为 Console、Workflow、Codocs、Enterprise、Collab、Gateway；Runtime配套同SHA构建，Linux构建不能复用hzy0/macOS包。保留已批准的生产Collab、R1单owner、精确绑定和部署开关。先启动Runtime验证视图/正式策略，再按服务依赖逐个启动，Gateway最后；检查六应用制品SHA、Runtime版本、监听绑定、匿名拒绝、动态模块、WebSocket、连续三轮本机/公网health与60秒PID稳定。

公告开启 `HZY_ENTERPRISE_ANNOUNCEMENTS_ENABLED=true`，生产默认关闭guard仅在AN15获批后改变。inAppOnly落实为每条公告 `push_wecom=false`、站内横幅/可选铃铛；不设置 `HZY0_LOCAL_ENTERPRISE`，不借hzy0全局仅站内开关抑制生产通知。反馈需要企业微信，因此也不能把全局通知一律关闭。若要求服务端不可被管理员改为WeCom，当前逐公告字段不足以提供硬禁令，须先交代码guard审查，不以文档冒充已实现。

公告管理 `/enterprise/announcements/manage`，员工列表/详情 `/enterprise/announcements`。当前active直接部门匹配，不自动含下级；撤权立即不可读。未来生效公告按读时生效，不承诺无用户定时推送。可选系统指南seed不纳入本次默认执行，需单列受众与发布批准。

G1在Console `/admin/feedback` 使用正式管理接口保存，固定：

- integrationCode=`gitlab.default`，project=`huizhi-yun/huizhiyun`；仅文本bug/feature/suggestion，标签候选另核验。
- publicUrl=既有批准的生产HTTPS根origin，与 `HZY_DEPLOYMENT_PUBLIC_URL` / deploymentPublicUrl 完全一致；不得猜域名或接收浏览器自传跳转地址。
- wecomIntegrationCode=`wecom.default`；recipientRoleCodes默认system_admin，recipientUids仅批准名单。UID/角色并集去重，Directory active与当前全局feedback:view在解析和发送前双检。
- 保存带当前revision与稳定Idempotency-Key，先settings.enabled=false；不会改变历史反馈冻结的目标/接收策略。
- `HZY_CONSOLE_FEEDBACK_DELIVERY_ENABLED=true`只控制既有受信worker；Verify完成才settings.enabled=true。无新无用户公开HTTP/宽cron。

GitLab权限核验只访问固定项目的必要API，不打印token；具备建Issue与按稳定marker读回能力。投递结果unknown须先marker查询/对账，至少遵守现有5分钟恢复门槛，不直接再次POST。202仅表示受理，不能报Issue创建成功。通知按每事件/接收人/通道独立回执，不因企业微信失败重复建Issue。

## 6. 验收矩阵（1440 / 390）

| 场景 | 成功证据 | 反例/限制 |
| --- | --- | --- |
| 管理员发公告/修改/撤回 | 标题、时间、部门、revision/receipt正确；站内回读 | 无admin拒绝；旧版409保留草稿；重复键不重复 |
| 普通员工横幅/关闭/详情 | 顶栏摘要、390图标；标题滚出后合理共存；关闭按用户+版本保留；可从铃铛/列表查看 | 另一用户不继承关闭；新版本重新提示；无范围/过期/撤回不显示 |
| 部门公告 | 当前直属部门员工可读 | 非成员/停用员工拒绝；不泄露正文 |
| 反馈三类型提交 | self列表/详情、稳定key、最终固定项目IID/link | 他人记录403；admin不隐含submit；匿名拒绝 |
| GitLab失败/响应丢失 | 阶段/状态/错误码脱敏，unknown按marker恢复 | 不在生产改凭据造故障；故障注入用本地夹具 |
| 管理员通知 | 批准管理员收到铃铛和企业微信，链接为生产origin | 停用/撤权/无global view跳过；员工不广播 |
| 部分通知成功/重试 | 同一反馈、Issue与原通知键续行 | 无重复Issue/重复站内记录；不强制重试unknown |
| 既有功能回归 | 文档分享/Collab、项目管理/审批/通知正常 | APF入口/角色/范围不变化；Aims不恢复 |

真实GitLab Issue与企业微信属于AN19/AN20外部写入，需获批后才验收。hzy0人工公告验收与G1模拟测试不能冒充生产双端通过。记录状态和数量，不记录员工姓名、反馈正文、token或策略正文。

## 7. 证据与完成条件

每AN项登记：批准状态、时间、执行者、前后配置hash/版本或布尔值、SQL/hash、新增grant ID、签发逐项断言、回执与验证结果。证据0700/0600受保护保存；仓库仅保存脱敏汇总。未完成pin、精确外发签发、真实Issue或管理员WeCom任一项，报告对应未完成，不标整组上线成功。

## 8. 回滚与停机影响

1. 先关闭反馈接收与worker、关闭公告UI；冻结在途但保留原键/lease/receipt，不删除unknown记录。
2. 停Gateway，按依赖停服务；Runtime停止导致全部依赖不可用。恢复旧Runtime/同一旧SHA六应用与原配置，逐个启动、Gateway最后，三轮health和60秒稳定。
3. 公告/反馈新表有任何生产记录时优先保留加性schema，不DROP；旧包兼容性须在候选彩排验证。需要恢复库须另确认停写窗口及所有新增记录保全，不能直接回库丢弃已产生Issue/通知。
4. 仅撤销本轮新增grant，保留原行104437604和6102等；依然消费在途的权限不得先撤。回滚pin/正式prod签名按批准的Platform流程，保持APF零变化，不重签test。
5. 只有八表均空且无receipt/外发关联，获批后才能反向删除：feedback_delivery/events/feedback/settings，再announcement_outbox/reads/departments/announcements；外键顺序以最终DDL为准。
6. GitLab Issue和企业微信已投递不能靠DB恢复撤销。记录外部副作用，按获准AN21处理，不擅自删除Issue或发送撤回广播。

## 9. 公告精确 DDL

来源：集成基线 `console/docs/sql/Console-SQL-Migration-v2.40-announcements.sql`；按AN05–AN08逐表。未执行。

```sql
-- CANDIDATE: approval required before production execution. Console-owned schema.
-- Additive, no automatic startup DDL. Requires existing Console receipts/audit/directory.
CREATE TABLE IF NOT EXISTS `console_announcements` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `body_markdown` MEDIUMTEXT NOT NULL,
  `level` VARCHAR(16) NOT NULL,
  `starts_at` DATETIME(3) NOT NULL,
  `ends_at` DATETIME(3) NULL,
  `audience` VARCHAR(16) NOT NULL,
  `show_popup` BOOLEAN NOT NULL DEFAULT FALSE,
  `show_banner` BOOLEAN NOT NULL DEFAULT TRUE,
  `push_bell` BOOLEAN NOT NULL DEFAULT FALSE,
  `push_wecom` BOOLEAN NOT NULL DEFAULT FALSE,
  `delivery_prepared` BOOLEAN NOT NULL DEFAULT FALSE,
  `status` VARCHAR(16) NOT NULL DEFAULT 'published',
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` VARCHAR(128) NOT NULL,
  `updated_by` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code, announcement_id),
  KEY `idx_announcement_due` (tenant_code,status,starts_at),
  CONSTRAINT `chk_announcement_level` CHECK (level IN ('info','warning')),
  CONSTRAINT `chk_announcement_audience` CHECK (audience IN ('all','departments')),
  CONSTRAINT `chk_announcement_status` CHECK (status IN ('published','withdrawn')),
  CONSTRAINT `chk_announcement_dates` CHECK (ends_at IS NULL OR ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_announcement_departments` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `dept_code` VARCHAR(64) NOT NULL,
  PRIMARY KEY (tenant_code,announcement_id,dept_code),
  FOREIGN KEY (tenant_code,announcement_id) REFERENCES console_announcements(tenant_code,announcement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_announcement_reads` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `uid` VARCHAR(128) NOT NULL,
  `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code,announcement_id,uid),
  FOREIGN KEY (tenant_code,announcement_id) REFERENCES console_announcements(tenant_code,announcement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_announcement_outbox` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `uid` VARCHAR(128) NOT NULL,
  `channel` VARCHAR(16) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `lease_token` VARCHAR(36) NULL,
  `lease_until` DATETIME(3) NULL,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `delivered_at` DATETIME(3) NULL,
  PRIMARY KEY (tenant_code,announcement_id,revision,uid,channel),
  KEY `idx_announcement_outbox_due` (tenant_code,state,next_attempt_at),
  FOREIGN KEY (tenant_code,announcement_id) REFERENCES console_announcements(tenant_code,announcement_id),
  CONSTRAINT `chk_announcement_channel` CHECK (channel IN ('in_app','wecom')),
  CONSTRAINT `chk_announcement_delivery` CHECK (state IN ('pending','delivered','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

## 10. 反馈 G1 精确 DDL

来源：G1候选 `e13196b90414fa978057e34a821935fc7397dc18` 的 `console/docs/sql/Console-SQL-Migration-v2.41-feedback.sql`；按AN09–AN12逐表。正式执行须确认最终SHA中此SQL未变化。未执行。

```sql
-- G0+G1 only. Apply to the Console schema; hzy0 installation requires approval.
CREATE TABLE IF NOT EXISTS `console_feedback_settings` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
 `revision` BIGINT NOT NULL,
 `settings_json` JSON NOT NULL,
 `updated_at` DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_feedback` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `feedback_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `reporter_uid` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
 `reporter_name` VARCHAR(255) NOT NULL,
 `text_json` JSON NOT NULL,
 `settings_json` JSON NOT NULL,
 `status` VARCHAR(24) NOT NULL,
 `issue_iid` BIGINT NOT NULL DEFAULT 0,
 `issue_url` VARCHAR(2048) NOT NULL DEFAULT '',
 `generation` BIGINT NOT NULL DEFAULT 0,
 `attempt` BIGINT NOT NULL DEFAULT 0,
 `lease_until` DATETIME(3) NULL,
 `next_attempt_at` DATETIME(3) NOT NULL,
 `created_at` DATETIME(3) NOT NULL,
 `updated_at` DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_code,feedback_id),
 KEY `idx_feedback_owner`(tenant_code,reporter_uid,created_at),
 KEY `idx_feedback_pending`(tenant_code,status,next_attempt_at),
 CONSTRAINT `ck_feedback_status` CHECK (status IN ('draft','pending','dispatching','submitted','failed','unknown','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_feedback_events` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `event_id` VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 `feedback_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `event_type` VARCHAR(24) NOT NULL,
 `recipient_policy_json` JSON NOT NULL,
 `recipient_uids_json` JSON NULL,
 `resolve_after` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `created_at` DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_code,event_id),
 KEY `idx_feedback_event`(tenant_code,feedback_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_feedback_delivery` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `event_id` VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 `recipient_uid` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
 `channel` VARCHAR(16) NOT NULL,
 `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
 `attempt` BIGINT NOT NULL DEFAULT 0,
 `lease_until` DATETIME(3) NULL,
 `updated_at` DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_code,event_id,recipient_uid,channel),
 KEY `idx_feedback_delivery`(tenant_code,status,lease_until),
 CONSTRAINT `ck_feedback_channel` CHECK (channel IN ('in_app','wecom')),
 CONSTRAINT `ck_feedback_delivery_status` CHECK (status IN ('pending','sending','sent','skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

DDL SHA256：

- 公告：`daf7a11f7529d6e4b70513dc7f769dd7a972e1d7e8566b21a6f3fedea58fe47e`。
- 反馈：`3654a22ab4e30d5217294d81b67ce678b7108def6ceaa507b9704e1ef53dcda3`。


## 11. 本轮执行记录（2026-10-08）

### 11.1 Platform 与生产发布

- P2b–P5 完成。P3 保存前 reviewHash `7cedffa02800012617702eae496e19ae0f14e9ac6c011207925cc5417582590a` 与受审归因一致；保存后 pin revision=1。
- 132/133 通过正式接口停用，保留历史记录。P4 仅 Console 升级为 `console/v0.2.5`（release 48 / manifest 65），其余九应用保持；80 个 active 技术主体无失权，增量仅公告/反馈员工基线三动作与管理员十四项，APF 零增量。保存后 pin revision=2。
- P5 仅签 prod：revision=40、bundle=55、hash=`sha256_c23cd65bb702e1ed618597417cf4f5d48baaab351defdab5dd3504992ee3bf37`；Console 正式同步与续租通过，test53/hash 未变。
- AN01–AN15 技术发布完成，应用冻结 SHA `3c925c0ce463d258db76cc30783a05a2a4e22583`，Runtime `.232` 同 SHA。六应用生产构建、2480 文件/16877 相对边/2179 动态导入静态检查通过；实际 1045 动态资源请求、142 视图、三轮本机与公网健康、60 秒 PID/重启计数稳定均通过。
- 首次停机前发现 Runtime 缺构建版本（dev/unknown），未停机、未写库，补同 SHA 显式 ldflags 后预检通过。正确 Runtime 二进制 SHA256 为 `e7b6f65078274aab82f9882db52ee98e999ee147a07e5ef8fc930f1c62504c36`。
- AN03 加密备份 `/home/hzy/backups/ann-feedback-20261009T000412Z`：四库与代码/配置均解密摘要及结构核验通过。
- 公告四表、反馈四表安装及定义核验完成。新增十三条缺失精确服务 grant；既有一条保留，十四 tuple 验证与真实双 audience 签发全部通过。无其它授权、APF、迁移、opening、Vault、Collab 或 scheduler 变更；Aims 保持停用。
- 外发服务探针使用正式公网 Gateway→Console 路径，200 且 scope/audience/tenant/deployment 匹配；缺 Gateway 上下文的直连结果不作为扩权依据。
- Console 开启 `HZY_CONSOLE_FEEDBACK_DELIVERY_ENABLED` 与 `NUXT_FEEDBACK_DELIVERY_ENABLED`；Host 开启 `HZY_ENTERPRISE_ANNOUNCEMENTS_ENABLED` 与 `NUXT_PUBLIC_ANNOUNCEMENTS_ENABLED`。其它配置摘要不变。

### 11.2 正式页面验收与 AN20 修复

- AN16/AN17：通过正式 Console 配置页面保存，revision=2、enabled=true；GitLab 项目固定 `huizhi-yun/huizhiyun`，测试标签 `hzy-feedback-test`，通知仅一个测试管理员 UID，角色广播为空。未使用 SQL 改配置。
- AN18：CLAUDE-FIXTURE 公告 ID `340508aa-ae85-4f42-9ac8-92aa2c98c64f`，仅 GMO、不含子部门，横幅与弹窗开启，铃铛/企业微信关闭。真实管理员弹窗已显示并正式确认阅读，reads=1。普通员工与范围外账号的生产人工验收仍待确认，不冒充通过。
- AN19：CLAUDE-FIXTURE 反馈 ID `e7103281-81ff-408b-9be0-cffb9bef5c46`，正式页面提交一次，状态 submitted、attempt=1，真实 GitLab 测试 Issue [#6](https://gitlab.wiztek.cn/huizhi-yun/huizhiyun/-/issues/6) 创建一次，页面显示已建单。未重复建单。
- AN20 首次通知未实际投递：delivery=0，收件人 active，冻结策略包含唯一测试管理员。只读核查发现 `resolve_after` 默认 DATETIME 按数据库本地时区生成，比显式 UTC `created_at` 晚 28800 秒，worker 因未到期正确未认领。
- UTC 写入修复 SHA `4c95458facb90f91a2f8daaa2d392807f91a7f15`：显式写入 UTC `resolve_after`，不改全局连接时区；Go 全量与强制 `+08:00` 会话的隔离 MySQL 回归通过。Runtime `.233` 热更新完成，142 视图、1045 动态资源、三轮健康与 60 秒稳定通过，应用制品保持现状。
- 协调者批准唯一测试事件恢复：先加密备份该行，按 tenant/event/feedback 精确标识、原时间值、28800 秒差、未冻结、CLAUDE-FIXTURE 标题与固定来源校验；仅将 resolve_after 改为 created_at，ROW_COUNT 必须=1，否则回滚。部署与恢复完成后，现有 worker 自然投递；用户已确认铃铛与企业微信各收到一次。
- AN21：测试公告通过正式页面撤回，status=withdrawn、revision=2；测试反馈留存。用户已手动关闭 GitLab Issue #6，保留记录、不删除；自动只读回查状态与标签等待登录会话。新表已有验收记录，回滚不得按空表路径删除记录或外部 Issue。
- 原始签名正文受保护离线核验后已删除 raw 文件；报告只引用摘要。执行证据保存在 `.git/p3-live-attribution/` 与 `.git/announcements-feedback-release/`，不得提交正文、凭据或个人信息。

### 11.3 AN20 唯一事件恢复与通知适配配置

- 唯一事件已按受批条件恢复，ROW_COUNT=1，时间差 28800→0 秒；加密行备份 `/home/hzy/backups/an20-event-20261009T011019Z` 解密摘要一致。未修改其它反馈或重建 Issue。
- 现有五分钟 worker 自然投递后，站内 delivery 为 sent 一条；企业微信为 pending。Console 读取 Connector 开关时，可选 `system_settings:view` 签发返回 403，失败后错误选择旧 notification adapter。Console 当前数据库已有 Connector 启用与公网 URL 设置。
- 复用这两项既有非秘密配置装配 Console 受保护环境：`HZY_CONNECTOR_RUNTIME_NOTIFICATIONS_ENABLED`、`HZY_CONNECTOR_RUNTIME_API_URL`。未新增 grant、未借用其它身份；配置加密备份 `/home/hzy/backups/an20-connector-20261009T013222Z` 核验通过，仅重启 Console，入口健康通过。原键自然重试成功：in_app sent=1、wecom sent=1；后者 attempt=3，前两次未送达，用户确认铃铛与企业微信各收到一条。未手动重复投递。
- 同类公告立即通知 outbox 默认本地时区问题已补显式 UTC，SHA `4b7d69edbf99fce0180b8df39aff5f549fceee1f`；Go 全量与强制 `+08:00` 隔离公告回归通过，`.234` 同 SHA 制品已上线；142 视图、1045 动态资源、三轮健康与 60 秒稳定通过。六应用链接及配置摘要未变，Aims 保持停止/禁用。
- 用户已确认铃铛与企业微信各一条，AN 全部验收通过。Chrome 重连后公告正式撤回成功；用户已报告 Issue #6 关闭；只读复核仍需 GitLab 登录会话。

### 11.4 用户验收确认与收尾

- 用户确认 AN 全部验收通过，包括铃铛与企业微信各一条。反馈固定事件无重复收件人/channel 行，GitLab 仅 Issue #6，一次建单。
- 测试公告正式撤回，历史与已读记录保留。反馈 fixture、通知、Issue 均保留，禁止用空表回滚删除。
- Runtime `.233` 备份 `/home/hzy/backups/an20-utc-20261009T010816Z`；两项 Connector 环境配置来自 Console 当前既有设置，未扩大服务权限。

- 公告 UTC `.234` 窗口加密备份 `/home/hzy/backups/an20-announcement-utc-20261009T013713Z`，解密 SHA 与 gzip 核验通过。制品 SHA256 `b7053c05db01c656be439df9421a29930befa90524b00c37184bb3b18c116e6c`；六应用仍为 `3c925c0c`，未重建无关应用。
- 运行记忆已同步：生产 Aims 不得作为恢复步骤启动；Runtime 停启后只恢复 Console/Workflow/Codocs/Enterprise/Collab/Gateway 六服务，并核对动态资源与稳定性。

- 用户另已保存项目“Require authentication to view media files”。这不替代 G2/G3 的同图片登录/匿名成对 HTTP 验证，生产图片开关仍未启用。

## 12. G2/G3 图片与截图扩展（2026-10-09）

用户已批准同 SHA 上线图片与截图反馈。冻结候选为 `db5bdf7d3164cb1149002115a2dae5803b308e3e`，含 AN UTC 修复、反馈列表及员工 QA。无新增 manifest、capability 或服务 grant；不再签策略包。

### 12.1 已完成门禁

- 用户在固定私有项目的同一无敏感图片上验证：登录可见，无痕拒绝或跳转登录。未保留上传直链。此项为人工证据，不冒充自动 HTTP 状态采集。
- Runtime 每次图片投递仍检查固定项目 `private` 与 `enforce_auth_checks_on_uploads=true`；人工验收不替代运行时检查。
- Astra 最终回归：Enterprise 736 PASS、1 既有 skip；Foundation 890+27、Console 644，Go、隔离 MySQL、typecheck、lint 及 1440/390 合成界面通过。
- hzy0 已切 Runtime `0.3.295-test.feedback-media.44` 与六应用同候选。Console v2.42 附件表 13 列、私有 MEDIUMBLOB；23 动态模块×3、142 视图、三轮健康、匿名附件 401、60 秒 PID 稳定通过。首次缺候选 Gateway 配置已失败回滚；补齐原配置并增加逐文件字节门禁后重试通过。Aims 保持停用。

### 12.2 生产执行顺序

1. 同 SHA Linux Runtime `.235` 与六应用构建；校验包、可执行工具、入口及动态资源，窗口脚本先跑 `--plan`。
2. 备份四库、制品、配置和链接；加密后解密比对 SHA-256 并校验 gzip/tar。保留现有 Collab、迁移、opening、real Vault、策略与授权。
3. 通知停机；停止入口、确认反馈无有效投递租约，再停止 Runtime 与依赖服务。
4. 整文件执行 `Console-SQL-Migration-v2.42-feedback-media.sql`，核对 13 列和 MEDIUMBLOB。仅新增该表，不写 grant。
5. Runtime 环境仅开启 `HZY_CONSOLE_FEEDBACK_MEDIA_ENABLED` 与设置 `HZY_CONSOLE_FEEDBACK_MEDIA_VERIFIED_AT`。后者以人工媒体鉴权证据的保守日期登记，七天后失败关闭；不得把部署时间当成新的媒体验收证据。
6. 切同候选 Runtime 与六应用；Aims 不启动。三轮健康、全部动态资源、142 视图、60 秒稳定及配置差集通过后通知恢复。
7. 用户登录提交一条无敏感内容的 CLAUDE-FIXTURE 图片反馈；验证 Issue 图片可见、匿名直链拒绝、管理员铃铛与企业微信各一次。完整图片直链、秘密值不写终端、报告或日志。

### 12.3 失败与留存

失败立即恢复旧 Runtime、应用链接和媒体环境配置，再核验旧服务健康。新增附件表如已存在图片或回执，保留该增量表，禁止为回滚删除用户图片；旧二进制不读取此表。上传结果未知不得重新上传，按冻结回执与原键恢复；外部上传清理不自动执行。

草稿/取消图片 24 小时，成功提交图片 7 天，失败或结果未知图片 30 天；UTC 显式写入，保留外部回执和未知结果证据。hzy0 没有 GitLab 集成，技术门禁不冒充真实建单或企业微信验收。

生产技术窗口已完成：Runtime `.235` 与六应用同 `db5bdf7d`；附件表、两媒体环境键、1046 个动态资源 HTTP、142 视图、三轮健康和 60 秒稳定通过。Aims 保持停用，未写 grant/manifest/策略包。加密备份 `/home/hzy/backups/feedback-media-20261009T021050Z`。真实带图反馈/匿名媒体/双渠道通知验收待用户操作，尚未记为通过。


### G2/G3 带图验收只读核对（2026-10-09）

用户确认 GitLab Issue #7 与图片可见。匿名图片请求返回 302，Location 为 GitLab 登录页；完整直链仅在进程内存使用，未保存或输出。附件 1 个、uploaded，130892 字节，unknown=0。

通知初报未收到时，核对发现事件于 03:05:01 UTC 创建，worker 于 03:10:02 UTC 自然完成投递。接收人冻结为 1 人；站内通知 1 行、接收人 1 行；反馈 delivery 的 in_app/wecom 各 1 条 sent，企业微信 attempt=1。未手动重试、恢复或写库。独立 portal_notification_deliveries 无对应行，外部成功依据为反馈 worker 的成功回执；用户实际收件确认仍待补记，不把回执等同于用户已读。

`.235/db5bdf7d` 包含既有事件 UTC 修复；事件 resolve_after 为 UTC，随后 5 分钟 claim 延后是正常恢复租约，非 +08 时区偏移。当前未发现通知故障，约五分钟等待与后台自然投递吻合，无需热更新或精确恢复。

用户待办：复查铃铛与企业微信；在 GitLab 将测试 Issue #7 加 test 标签并关闭、保留记录。本次没有可用的受控 GitLab 登录会话，未执行该写入。
