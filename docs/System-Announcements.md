# 系统公告实现与发布约定

状态：候选实现；Platform manifest 发布、test 重签、环境迁移与生产发布另行批准。员工指南见 [汇智云使用说明](user-guide/Employee-Guide-Docs-Projects.md)。

## 职责与权限

Console 拥有公告、人员已读与通知投递事实。管理页为 Console 的 `/announcements`；Enterprise 提供 `/enterprise/announcements`、详情页、顶部横幅与弹窗。用户菜单的「使用说明」进入随应用打包的 `/enterprise/help`。Enterprise Host 管理页面不迁入 Host。

Manifest 是人员权限事实源：`console:announcements:view` 允许员工查看本人范围内公告、记录本人已读；`console:announcements:admin` 允许发布、修订、撤回及查看管理列表。推荐角色 `console:admin` 显式登记两项权限，`console:announcement_reader` 仅登记 view。开放前须在 Platform 将阅读角色映射到目标员工基线，不能以本地 SQL 绕过人员授权。授权模拟模式禁止公告写入。

Host 使用现有 `console:enterprise-host:execute` 通道；Console 管理调用使用精确 `console:announcements:view/admin` Runtime grant；后台投递使用无用户的 `console:scheduler:execute`。通道能力不授予人员权限，后台通道拒绝携带用户委托。独立 Console 管理请求保持 Console 来源，Host 请求保持 Enterprise 来源。

## 接口与数据

| 接口 | 用途 |
| --- | --- |
| `GET /enterprise/api/announcements` | 当前有效且本人可见的公告，每页 50 条 |
| `GET /enterprise/api/announcements/surfaces` | 横幅及未读弹窗候选，未读弹窗优先；避免被普通列表第一页遮蔽 |
| `GET /enterprise/api/announcements/:id` | 详情，重新核对范围和有效期 |
| `POST /enterprise/api/announcements/:id/read` | 本人已读，不接收 uid |
| `GET/POST /enterprise/api/announcements/manage` | 管理列表与发布/修订，要求 admin |
| `POST /enterprise/api/announcements/:id/withdraw` | 按 revision 撤回，要求 admin |
| `GET /enterprise/api/announcements/departments` | 管理员选择有效部门 |

Console 同名 BFF 位于 `/api/v1/console/announcements/**`。两端复用 Console public typed 入口 `console/server/public/announcements.ts`，不跨模块自调用 HTTP。Runtime 固定 POST 操作为 `/v1/enterprise/console/announcements:{list,surfaces,detail,read,admin-list,save,withdraw,departments}`；独立 Console 使用 `/v1/console/announcements:{operation}`。浏览器不能选择人员身份、租户、服务来源、许可或 Runtime 操作。

许可使用独立 HMAC，绑定方法、完整路径、幂等键、actor、tenant、deployment、资源/动作/操作、策略版本与修订号、截止时间及完整 JSON 命令字符串。许可期限不超过 14 秒，也不超过策略授权截止时间。Runtime 校验服务身份、委托用户、签名及许可，再查询当前 Directory 范围；TS/Go 共用金向量。401 表示未登录，403 表示权限或范围不符，409 表示版本/幂等/租约冲突，503 表示存储或授权依赖不可用。

Console schema 的四张新表：

- `console_announcements`：标题、Markdown、info/warning、UTC 起止时间、范围、展示与推送开关、发布/撤回、revision、创建/修订人、投递准备状态。
- `console_announcement_departments`：指定部门；精确匹配当前有效成员关系，不自动扩展子部门。
- `console_announcement_reads`：tenant + announcement + uid 唯一。修订不清空已读；关闭弹窗成功写入后不再弹。需要再次提醒时发布新公告。
- `console_announcement_outbox`：每个公告修订、用户和渠道的耐久投递状态、重试次数、租约及完成时间。复用 Console mutation receipts 与 operation logs。

发布和投递准备状态同事务落库；生效时，在锁定公告的事务中按当时有效员工及部门范围建立 outbox，并标记准备完成。之后入职或调入人员可在 Host 阅读公告，但不补发历史群发通知。失效、撤回或范围变更后，未投递项目会在领取时重新判断并取消。已发出的通知不能撤回；通知只带通用提醒和受控链接，不包含公告标题/正文。

Markdown 禁用原始 HTML、危险协议链接和远程图片，避免脚本与跟踪图片。员工响应不包含管理投递统计；所有接口禁用共享缓存。

## 弹窗和投递语义

「首次登录弹窗」指公告生效后，员工下一次进入已登录 Host 时展示未读公告；已在线员工刷新公告后也会看到。Host 在进入已登录页面、身份范围改变或用户手动刷新时加载公告，不做定时轮询；最多显示 3 条横幅。关闭失败保留弹窗并提供重试；帮助入口始终可从用户菜单打开。列表阅读本身不自动确认已读，员工可在详情标为已读。

Console 复用已验签的 Tenant Gateway integration drain 唤醒入口，只有 `HZY_CONSOLE_ANNOUNCEMENTS_DELIVERY_ENABLED=true` 才投递，默认不启用。已有生命周期操作优先，公告每次最多领取 20 条、预算 20 秒（预留 15 秒给单次外发），不保证群发立即全部送达。后台自有操作为 `/v1/console/announcement-delivery:claim|ack`，单条租约 60 秒，失败 60 秒后可重试；旧租约不能 ack 新领取。

铃铛使用 Console 既有 typed 通知发布函数；企业微信使用 Foundation 独立外部通道函数，复用 Connector/Notification Runtime 的持久幂等账本。两个渠道独立启用、独立完成，不把推送企业微信隐含为创建铃铛通知。投递键包含公告 ID、修订、用户和渠道；提交成功但 ack 丢失时按原键恢复。外部结果不确定时由既有投递账本阻止盲目重发，须由运维核对后恢复；不能把“已发布”解读为“所有人已收到”。测试重定向配置与本机禁止外发规则继续生效。

## 发布顺序与批准点

以下文件是审阅材料，不表示已执行：

1. 发布 Console manifest，审核管理员和员工阅读角色映射；随后为 test 重签、同步策略。这两项单独待批准。
2. 审核 `console/docs/sql/Console-SQL-Migration-v2.40-announcements.sql`，先在隔离库验证，再经批准安装目标环境。全量 schema 与 Runtime schema manifest 已包含四表，**新 Runtime 发布前必须安装 DDL**。
3. 审核 seed/verify SQL 的 tenant、Console deployment、Runtime audience 与既有 grant。种子只新增缺失的服务 grant，不复活撤销项；人员权限只在 Platform 配置。还须核查 Console 既有 `console:notification:publish`，以及实际部署所选的 `connector-runtime:notifications:send` 或 `notification-runtime:send` 授权，并用真实服务身份验证签发；本次未连接目标环境执行这些核查。
4. 安装全员常驻“使用说明”公告：无失效时间，默认不弹窗、不挂横幅、不推送任何渠道；同时发布 Host 帮助页与用户菜单入口。
5. Console、Enterprise、Foundation/Runtime 与相应 Gateway 注册一起发布；确认审批后的调度配置、外部通知目标地址及企业微信测试重定向，再启用投递。生产 DDL、生产切换和首次真实群发分别待批准。
6. 发布静态过渡页时同时上传 `index.html` 与 `employee-guide.html`。两者自包含，无外部样式、脚本、字体或图片依赖；完整指南链接在同目录。不得仅上传入口页导致指南链接失效。

回退先关闭公告投递开关，再撤回或调整公告展示，必要时回退应用；保留四表、已读与投递回执，不删除生产事实，不回收后重新使用同一投递键。生产数据与 hzy0 进程不在本任务写入范围。

员工说明原稿修改后，运行 `node deploy/cloudflare/wiztek-transition/generate.mjs`，同步静态完整说明及 Host 内置文本。反馈群和管理员联系方式仍是待填写占位，发布前由业务负责人补齐。


## 2026-10-07 最终裁定（覆盖此前调度与grant段落）

只新增 announcements:view/admin 人员资源；view进入Platform员工baseline，admin给系统管理员，不逐人分配reader角色。无scheduler资源、无新service grant。管理页为 /enterprise/announcements/manage，Console管理入口仅跳转。读取按当前时间判定生效/失效，无周期轮询。未来生效公告不得启用铃铛/企业微信；仅立即发布在同一用户admin请求内投递。Host所有操作复用console:enterprise-host:execute和admin permit；delivery-claim/ack精确绑定公告ID，无浏览器入口，不冒充机器scheduler。机器drain不投递公告。持久outbox原键与租约保留，剩余/失败由管理页“原键恢复通知”显式恢复，不自动后台重试。
