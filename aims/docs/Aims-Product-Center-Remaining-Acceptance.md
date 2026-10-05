# 产品中心剩余验收执行清单

2026-09-09 核对。本文集中下一步工作，不替代实施计划全部 PC/AC 条目，也不将未列出的条目标记完成。历史细节见 [实施记录](Aims-Product-Center-Implementation-Status.md)，完整标准见 [实施计划](Aims-Product-Center-Implementation-Plan.md)。

## 执行顺序

| 顺序 | 工作 | 可执行步骤及通过证据 | 当前状态 |
| --- | --- | --- | --- |
| 1 | 优先级完整操作链（AC21–28） | 在同一产品周期完成需求转候选、明确缺失估计、固定模型/RICE评估、容量不足解释、记录例外、最终调序、转交项目；改变范围后核对旧评估保留及复评提示。保存每步输入、当前修订、命令回执和界面证据。 | 核心计算测试已通过；整链验收未完成 |
| 2 | 路线与发布键盘操作（AC19、26） | 1440/390 下仅使用键盘完成路线移动及发布确认；确认焦点可见、顺序合理、失败保留输入、无不可达控件。以实际页面测试为依据，不能以纯函数测试替代。 | 调序跨页及发布组件1440/390键盘证据已补；路线时间窗口与真实环境仍待验收 |
| 3 | 真实授权链（AC01、02、12、16） | 固定 tenant/deployment 和组件版本，验证产品经理、参与项目成员、验收人、独立发布人及无权限用户；撤员/过期后重试读写。记录授权范围、结果码和来源，不保存令牌明文。 | 目标环境与试点信息待明确；本地权限测试不替代 |
| 4 | 跨应用与后台任务（PC16–18） | 文档真实 OSS/ACL；反馈冻结命令投递、失败重试、乱序及撤销；Assets 已部署版本与 AIMS 发布版本分别核对；Finance 按币种与期间核对分摊、来源修订及未就绪结果。 | 受控测试已有，真实链路未完成 |
| 5 | 迁移与回退（AC17、18、20） | 目标库先只读 precheck，隔离恢复副本演练 dry-run/apply/重跑和目录刷新中断；确认旧 ID 不变、无重复；关闭入口后旧项目版本可读，新数据仍保留，发布保护不退回旧逻辑。 | 不得由临时空库测试推断存量环境通过 |
| 6 | 两产品试点（PC12） | 一产品覆盖完整规划到发布，另一产品覆盖多项目拆分、优先级插单和采用反馈；逐项对照全部28条AC并绑定证据，记录遗留问题和复验结论。 | 未完成 |

## 当前已复核的规则证据

2026-09-09 定向执行 `go test ./internal/apps/aims/productcenter -run 'TestAssessment|TestRICE|TestQueueMove|TestCapacity|TestUnknownEffort|TestDecisionCannot|TestDeliveredSelected' -count=1`（工作目录 data-runtime）通过，耗时0.367秒。这证明对应测试覆盖的计算、缺失/无效输入、队列锚点与跨页保留、容量及已交付消耗规则；不证明真实权限、页面操作或数据库事务整链。

Finance 币种录入、存储、产品快照解析、列表返回和结构检查已分别验证；表单1440/390验证使用实际组件及模拟提交。真实 Finance POST 与真实会话仍需第4项完成。

## 等待业务决策

产品收入的正式确认口径尚未确定。当前 Finance 已有到账和开票事实，没有找到正式收入确认台账；不能直接代替产品收入。已询问本期是否新增 Finance 收入确认台账，或暂保留收入/毛利未就绪。答复前不修改该语义，也不将完整方案标记完成。成本与其他验收继续推进。

## 联调环境核对（2026-09-09）

已检查 AIMS、Finance、Assets、Console 根目录的 `.env.dev/.env.local/.env` 是否存在及相关配置键名；只有 Console `.env.dev` 存在上述文件并声明运行时连接键。没有读取或输出凭证值。此检查不排除平台托管配置或其他启动方式，不能证明服务不存在，但不足以选定产品中心本次验收的 tenant/deployment、真实用户及服务授权。

进入真实验收前仍需绑定明确的测试租户/部署、访问入口、两试点产品和验收角色；不能根据默认 Console 配置自行把某业务环境视为试点。已有环境问题待答复，不重复请求或自动执行迁移、grant安装及发布。

成本摘要核对：`aggregateProductProjectCost` 对直接费用及分摊合计与摘要分别比对，不一致时清空结果并返回未就绪；来源修订包含币种和逐条事实。现有规则无需重复实现。真实环境验收需验证更正前后金额、币种及来源修订，而非仅打开成本页面。

## 用户指定测试租户后的复核

用户已明确测试租户为 **C000001**，不再等待租户选择。新增 AIMS、Assets `.env.dev` 和 Cloudflare 生成配置已发现；两应用本地 Runtime 均指向 `http://127.0.0.1:18080`，Console 本地配置也指向同一地址。只读 GET `/runtime/healthz` 连接失败，尚不能读取实际 tenant/deployment 或 schema status。

工作区未找到 `data-runtime/.env`、实际 config JSON 或默认系统配置目录；不能仅凭应用连接 Token 拼装一个未知数据库绑定的 Runtime。已询问现有 C000001 Runtime 地址或本地启动配置路径。Finance `.env.dev` 本次仍未发现。未输出凭证值，未执行迁移、grant安装或部署。

## C000001 SSH 实机核对

已获用户授权 SSH root@gitlab.wiztek.cn。18080 实为 Keycloak 容器的回环映射，非 tenant-runtime；实际服务为 hzy-test-data-runtime，监听127.0.0.1:18084，健康返回 tenant=C000001、deployment=c000001-test-tenant-runtime、version=0.3.215-test.4。SSH 本地转发127.0.0.1:18084已建立，AIMS/Assets/Console本地.env.dev改用该转发入口；无需开放远端端口。

实际配置 /wiztek/hzy-test/runtime/config.json 仅启用Console/Directory/People，数据库分别为hzy_console_test_20260905与hzy_people_test_20260905；deploymentBindings仅console=wiztek-test-console、people=C000001-test-people。AIMS/Assets/Codocs/Altoc未配置，Finance关闭。未修改远端服务、配置或数据库。

AIMS与Assets现有.env.dev Runtime Token调用只读schema/status均返回401 invalid_jwt（格式不是JWT）；该Runtime采用JWT模式，不能把这些静态Token作为真实授权验收。需配置产品中心相关测试应用数据库与deployment绑定，并通过Console取得相应精确grant的JWT，再执行结构验收。Console.env.dev未提供有效Runtime Token。所有凭证值均未输出。
