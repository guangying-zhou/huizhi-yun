# 应用菜单生产巡检清单（2026-07-13）

目标：使用生产环境已登录会话，逐个应用、逐个菜单检查页面加载、关键数据与浏览器控制台输出；发现问题后修复、部署并回归。

## 范围

- 环境：`https://wiztek.huizhi.yun`
- 包含：Platform、Console、Codocs、Aims、Altoc、Assets、Finance、People、Workflow
- 暂不处理：Insights、Align
- 本轮暂缓：WebDev（按用户要求，不作为本轮完成条件）
- 不纳入：Account（已退出当前模块边界）
- 判定：页面可用，预期 API 无 4xx/5xx，浏览器控制台无应用错误；权限拒绝必须符合当前用户授权语义。

## 已完成修复

- [x] Platform：Agent 版本漂移只记录升级状态，不再把健康数据面标成不可路由。
- [x] Platform：生产部署 `4104a4e9-d02d-408e-9adf-abd71e5525ef`，租户运行时恢复 `ready`。
- [x] Finance：目录用户接口不再返回 401，发票申请列表恢复真实数据。
- [x] Console：SPA 图标改由本 Worker 本地提供，关闭公共 Iconify 回退。
- [x] Console：生产部署 `a1271769-19ab-47f9-85f6-960b1f0cade9`，数据运行时页无 warning/error。
- [x] Assets：修复跨应用操作状态筛选空值异常，补齐 tenant-runtime 管理 scope；生产部署 `d56d5478-27d4-4431-9378-caffae2e9add`。
- [x] People：当前代码已部署到生产 `90aeeffa-3479-425c-a48a-4b513d13e62a`，补齐离职交接与跨应用操作页面路由。
- [x] Platform：补齐内部策略包刷新入口和 `people:admin` 运维权限，生产部署 `7a35c399-66bd-4944-a44a-e6adfe170c95`，策略包更新到 revision 11。
- [x] Codocs：目录用户、项目、用户项目、用户部门、部门成员与部门访问校验统一使用受限 Console 服务能力；生产部署 Console `840e9d47-b2ff-48e5-8653-4f6b1497751c`、Codocs `f1c2b844-0e7d-44a1-93af-b0efa162f215`。
- [x] Cloudflare 内部信任：统一轮换 Platform、Console、Tenant Gateway 与 8 个业务 Worker 的 `HZY_CLOUDFLARE_INTERNAL_TOKEN`；令牌仅保存在本机 `~/Dev/secure/hzy-cloudflare-internal.token`（0600）。
- [x] Workflow：执行数据库迁移 009/010，补齐 `flow_tasks` 待办投影身份、`flow_actionable_outbox` 与 `service_command_receipt`；Platform 心跳由 `schema_mismatch` 自动恢复 `schema_ready` 并重新向 Gateway 发布 Runtime endpoint。
- [x] data-runtime：发布并公开验证 `0.3.107`；在 `0.3.105` 冒号式 audience scope 兼容基础上，LDAP 全量同步仅响应显式 `sync-now`，启动和周期 tick 不再自动扫描；相同 snapshot hash 可停止后续 Platform 分块提交；root 更新执行器重建日志时继承 Agent UID，避免 0600 日志造成升级死锁。
- [x] Platform：批准版本更新到 `0.3.107`，198/198 测试通过，生产部署 `51c72d85-c903-41ad-8f5d-f85a82942322`；相同健康目录快照在事务前直接返回 unchanged。
- [x] Platform：Agent heartbeat 在 release signing key 不变时自动把历史 runtime 的目标版本校准到当前批准版本；版本漂移不再把健康数据面摘除，signing key 轮换仍要求显式 enrollment；201/201 测试通过，生产部署 `4859223a-4d68-48d7-88a9-9ae25c738908`。生产心跳已于 2026-07-14 00:34:59 将历史目标 `0.3.104` 校准为 `0.3.107`，后续 Agent 已成功升级到 `0.3.107` 并保持 `ready`。
- [x] Finance：目录用户 BFF 传递当前会话上下文；授权监听器首次挂载立即加载，修复跨应用首次进入侧栏为空；生产部署 `1e45179d-15e8-4286-9dbf-67edac3787fa`。
- [x] 历史 Agent 更新兼容：Tenant Gateway 仅从 Platform 注册表注入受信 runtimeCode，Console 以正式 grant 校验后为旧 Agent 签发最小兼容更新 scope；生产部署 Gateway `1ab8d118-9688-4960-adf6-d9f491d61902`、Console `7f0451fb-237b-453f-a2bc-28f8d3c020b5`。
- [x] Tenant Gateway：Platform/Hyperdrive 临时不可用时不再立即中断全部租户路由；注册表采用 5 分钟新鲜缓存和 24 小时旧值兜底，18/18 测试通过，生产部署 `c9c5e8dd-0497-4b26-bfda-24d4da79d0eb`（等待 UTC 00:00 额度重置后首次预热）。
- [x] Console Hyperdrive 降载：session 授权仍逐请求读取 active 状态，但展示用途的 `last_seen_at` 改为每 5 分钟最多写回一次；目录源页面把原“同步间隔”改为“配置刷新间隔”并明确只允许显式同步；298 项测试 297 通过、1 跳过、0 失败，生产部署 `79448e58-8acf-4b6f-bb58-aef597579070`。
- [x] Platform 运营控制台：补齐发票、付款、工单、公告、平台账号、平台角色、Feature Flag、审计日志页面与分页查询 API；213/213 测试、lint、typecheck 通过，生产部署 `3fc3be50-0c3a-47ea-bc17-5f79d595f50e`。
- [x] Finance：项目汇总失败已通过生产诊断日志定位为旧 Agent `0.3.103` 对 Finance → Aims 跨应用 scope 的 deployment 误判；生产部署 `93fc0200-267c-4776-bb99-9365d12ac9d7`，92/92 测试、lint、typecheck 通过，等待 Agent 升级后回归。
- [x] Agent `0.3.107` 生产回归：平台最新版与租户当前版本均为 `0.3.107`，Aims、Altoc、Assets、Codocs、Finance、People、WebDev、Workflow adapter 均显示正常；Finance 项目汇总、审批实例、审计日志与 People 离职交接已恢复。
- [x] 跨应用操作管理：Foundation 支持 Finance 的应用专属 API 基址；Aims、Altoc、Assets、Finance、People BFF 统一兼容 data-runtime `0.3.107` 的直接分页响应。生产部署 Aims `d387eea3-7f79-494c-aadf-e8147194473d`、Altoc `f091fd06-694d-43b6-b91c-139e3a1cc31f`、Assets `14479ee0-66f5-4fe5-bc3e-41501b1a895c`、Finance `a2cb8e0e-7940-4161-870c-da21d78b6fb3`、People `47e1e040-6aef-4b0e-814d-b21fdd83371d`。
- [x] Console runtime grant：生产执行 v1.65 Finance 与 v1.66 Aims/Altoc 最小 `integration_operations:view/replay` 服务授权；Aims、Altoc、Assets、Finance、People 五个生产诊断页均加载脱敏列表且无 `insufficient_scope`、响应结构或浏览器控制台错误。
- [x] Aims 项目文档预览：改为 Aims 验证项目关系后，经 `aims.runtime` 精确 capability 调用 Codocs 正文合同；Codocs 将已验证 service-only 上下文和 `command.actorUid` 完整传入第二跳，data-runtime `0.3.109` 对 active 文档重新执行 Codocs owner/share/relation ACL，不再错误要求历史关联文档必须物理存储为 `project|git-project`。生产部署 Aims `571a0c85-ca3b-4a66-9e41-35417324d083`、Console `f6b8c042-1882-464c-a14c-358dd41e2539`、Platform `9a9e91f6-e863-4074-801d-23ddd2608362`、Codocs `c7038218-909d-4e0b-8d05-b1a83e11788b`；真实项目 33 的《智慧房产产品线项目立项报告》已在 Aims 弹窗完整渲染，Codocs Worker 返回 200。
- [x] 跨应用审批中心：侧栏入口不再等待待办计数后才出现，Workflow proxy 使用租户无关 service origin 与目标 Workflow deployment service token；只读任务查询不再附带 drain actionable lifecycle outbox。生产部署 Aims `971cab73-a7e6-4438-b40b-f113810498af`、Workflow `8649e21b-01a0-47ee-8b68-e30955cb1f82`、Console `4a037a03-6af1-4c0e-98d3-752b5881eb46`、Codocs `3c60e179-5894-49f3-bc09-f86ce4ed6aca`、Altoc `8b443e3c-03ec-4754-b792-5072291e8ae0`、People `41a83ff6-3e24-4654-866e-2a847cc66dd9`、Assets `fb39ef99-1e57-423f-bbad-1acdce1b1f37`、Finance `6f064238-c3c1-4e35-8fbd-0d8e547ac086`；生产 Chrome 已在 Aims、Codocs、Finance 验收，入口约 1.7 秒内随应用首屏出现，无需刷新，真实任务为待办 2/2、已办 10/83、我发起的 10/64。

## Finance

- [x] 仪表盘
- [x] 发票、发票申请、回款、核销
- [x] 费用报销、项目费用、项目费用审批、付款申请
- [x] 银行账户、余额、余额变动
- [x] 项目核算：分摊、员工成本
- [x] 项目核算：项目汇总
- [x] 绩效结果、贡献、绩效规则、快照、报表
- [x] 科目、核算对象、科目映射、收入类型、费用类型、人员成本参数
- [x] 审批实例、审计日志、跨应用操作

## Console

- [x] 管理概览
- [x] 企业资料
- [x] 目录管理：部门、用户、代码仓库、目录源配置、目录同步
- [x] 系统参数
- [x] 节假日管理
- [x] 集成中心
- [x] 运行时管理：数据运行时、通知运行时
- [x] 数据运行时（租户当前版本与平台最新版均为 `0.3.109`）
- [x] 凭证库
- [x] 服务凭证
- [x] 系统管理：日志管理、业务领域、区域管理、应用运行管理

## 其余应用

- [x] Platform：企业控制台已实际点击企业工作台、部署管理、订阅计划、访问观测、应用管理、角色授权、成员权限、岗位职责目录、主体目录、成员资料；运营控制台已实际点击工作台、应用、订阅计划、企业角色、应用权限角色、租户、订单、发票、付款、工单、公告、平台账号、平台角色、Feature Flag、审计日志；页面均正确加载且无新增 warning/error。
- [x] Codocs：按导航配置重新实际点击全部 32 个内部菜单：文档中心；个人文档下我的文档、日志周报、协同文档、演示文稿、文件柜、收藏夹、回收站；项目文档下项目组文档、代码库文档；部门文档下协同文档、日志周报、会议记录、对外发文、部门规章、文件柜；组织资产下公司制度、通知公告、法务合规、企业文化、技术规范、产品资料、公司知识库、部门开放文档、文档模板；资讯中心下前沿资讯、推荐文章；系统管理下发文流程、模板管理、管理资讯书签、归档文档、图片清理。全部页面无可见失败提示、无新增控制台错误
- [x] Aims：工作台、项目、工时、项目文档、周报、项目资源、项目/产品/项目模板管理、集成操作全部主菜单已逐页检查；另进入真实项目 `40`，实际点击概览、里程碑、需求、版本、目标、任务、文档、成果、工时、周报、度量、设置全部项目级菜单，页面均正常、无可见失败提示且无新增控制台错误；目录请求上下文修复后生产部署 `29f4be33-914a-4c3d-905d-675f82008f66`
- [x] Altoc：首页、线索、客户、商机、报价、投标、合同、回款、经营看板、跨应用操作、基础配置、团队管理、个人设置全部可见菜单已逐页检查；共享目录会话修复后生产部署 `cbf66165-2976-48c8-a9bd-3b3b555ad7ab`，页面、Worker 请求与新增控制台日志均无应用错误
- [x] Assets：工作台、资产台账、产品、知识产权、数字资产、资源、环境、客户交付、供应商、采购订单、采购入库、资产操作、离职回收、预警、报表、分类、字典、跨应用操作
- [x] Assets：从 Finance 实际点击切入，首次加载不再误报“当前企业角色没有资产管理权限”，无需刷新
- [x] Assets：修复“资产总览”和“环境视图”共同指向 `/environments`；资产总览现为独立 `/assets/overview` 页面并复用真实资产汇总，环境视图保持 `/assets/environments`。生产部署 `4ec3e8de-32e8-464f-80bd-fcb166adccc6`；桌面及 390px 视口验证无横向溢出、无页面错误日志。
- [x] People：工作台、员工、任职变更、离职交接、职级设置、成本快照、绩效周期、岗位字典、职级字典、跨应用操作均已通过；从 Finance 实际点击 HR 首次进入时侧栏立即显示，无需刷新，页面和控制台无应用错误
- [x] Workflow：工作台、我的待办、我发起的、流程定义、表单定义、审批业务、路由规则全部可见菜单已逐页检查，页面与新增控制台日志均无应用错误
- [ ] WebDev：按用户要求本轮暂不检查；既有 Dev Agent/cloudflared 502 记录保留到后续专项处理，不计入本轮完成条件

## 最终回归

- [x] 从其他应用首次切入 Codocs、Aims、Altoc、People、Assets、Finance、Workflow 和工作台，所有应用侧栏均无需刷新立即显示；本轮再次从 Finance 实际点击进入 People，首屏菜单与业务数据均正常。
- [x] 应用导航保存路径正确，实际恢复 Codocs 图片清理、Aims 项目文档、Altoc 个人资料、People/Assets 跨应用操作、Finance 项目核算、Workflow 路由规则等最近访问页面；未出现错误落到 profile 或无权限历史页面。
- [x] 本轮范围内生产浏览器控制台无遗留应用错误。
- [x] Aims、Codocs、Finance 的审批中心均可在首次进入时读取真实任务；接口失败会显示错误与重试，不再伪装为 0 条记录。
- [x] 本轮范围内所有修复均完成模块级门禁与生产部署验证；WebDev、Insights、Align 按约定排除。
