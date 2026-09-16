/**
 * 汇智云（HZ-TY-S-002）产品与研发视角示例内容。
 *
 * 内容取自本仓库的平台分层、模块契约和在办事项，用于让产品中心的
 * 功能目录、产品模块、需求池、规划事项、规划周期和产品版本有可评估的真实语料。
 * 这里只描述"写什么"，不包含任何认证、地址或写入逻辑；
 * 实际写入由 seed_product_center_demo.mjs 经用户 API 完成。
 *
 * 「关联项目」页签是按版本聚合的执行视图，由真实项目与工作项派生，
 * 不能靠写产品中心数据造出来，因此不在本文件范围内。
 */

/** 产品模块：两级，对应根 CLAUDE.md 的平台分层 */
export const components = [
  {
    key: 'platform',
    name: '平台控制面',
    description: '管租户、订阅、部署、License、策略包和应用治理，不承载企业业务数据。',
    sortOrder: 10,
    children: [
      { key: 'platform-tenant', name: '租户与订阅', description: '租户开通、订阅套餐、部署实例与生命周期。', sortOrder: 10 },
      { key: 'platform-license', name: 'License 与策略包', description: 'License 签发校验，以及租户授权策略包的编排与发布。', sortOrder: 20 },
      { key: 'platform-app-governance', name: '应用与部署治理', description: '应用清单登记、发布 Tag 识别、部署绑定与灰度治理。', sortOrder: 30 }
    ]
  },
  {
    key: 'console',
    name: '企业基础运行时',
    description: '客户侧基础运行服务：企业配置、目录、认证、凭证与集成，默认内嵌协作运行时。',
    sortOrder: 20,
    children: [
      { key: 'console-directory', name: '目录与认证', description: '企业目录主数据、登录态、OIDC 与上游身份源接入。', sortOrder: 10 },
      { key: 'console-authorization', name: '授权与数据范围', description: '运行时授权快照、企业角色组合、数据范围与授权模拟。', sortOrder: 20 },
      { key: 'console-vault', name: '凭证与集成配置', description: '集成配置与凭证保险箱，业务应用按 integrationCode 消费。', sortOrder: 30 },
      { key: 'workflow', name: '审批流程', description: '通用审批流程定义、流转与终态同步。', sortOrder: 40 },
      { key: 'collab', name: '实时协作运行时', description: '文档实时协作会话与状态同步。', sortOrder: 50 }
    ]
  },
  {
    key: 'apps',
    name: '业务应用',
    description: '面向岗位的业务能力，彼此通过服务 API 与稳定业务键协作，不共享数据库。',
    sortOrder: 30,
    children: [
      { key: 'aims', name: '研发项目管理', description: '项目、需求、迭代、工作项、工时与交付成果。', sortOrder: 10 },
      { key: 'altoc', name: 'LTC 经营管理', description: '客户、商机、合同、回款计划与服务工单。', sortOrder: 20 },
      { key: 'assets', name: '资产与资源管理', description: '实物与资源资产、客户交付资产、环境台账与采购流程。', sortOrder: 30 },
      { key: 'finance', name: '经营财务中台', description: '成本归集、分摊规则与经营核算。', sortOrder: 40 },
      { key: 'people', name: '人员与绩效', description: '人员事实、任职、成本快照与项目贡献。', sortOrder: 50 },
      { key: 'codocs', name: '协作文档', description: '文档编辑、版本、发布与跨应用引用。', sortOrder: 60 },
      { key: 'insights', name: '代码仓库分析', description: '仓库、提交与研发活动分析。', sortOrder: 70 }
    ]
  },
  {
    key: 'foundation',
    name: '共享层与运行时',
    description: '被各应用复用的统一能力与客户侧运行时，不直接面向最终用户。',
    sortOrder: 40,
    children: [
      { key: 'foundation-layer', name: 'Foundation Layer', description: '统一认证、目录、权限、审批与共享 UI／server helper。', sortOrder: 10 },
      { key: 'tenant-runtime', name: 'tenant-runtime 业务 API', description: '部署于客户数据库侧的业务 API Agent，承担全部业务数据读写。', sortOrder: 20 },
      { key: 'webdev', name: '远程开发代理', description: '远程开发代理控制台（ADR-015 PoC）。', sortOrder: 30 }
    ]
  }
]

/** 功能目录：长期能力，独立于项目与版本；module 指向模块 key */
export const features = [
  { module: 'console-directory', title: '企业目录与组织同步', description: '维护部门、人员与任职关系，作为跨应用 uid / dept_code 的事实源。' },
  { module: 'console-directory', title: 'Console OIDC 单点登录', description: '业务应用统一经 Console 完成登录与令牌刷新，上游 CAS／企业微信由 Console 承接。' },
  { module: 'console-authorization', title: '企业角色与应用角色组合', description: '应用角色定义能做什么，企业角色组合应用角色，具体对象不编码进角色名称。' },
  { module: 'console-authorization', title: '数据范围与对象授权', description: '列表、详情、写入、批量与导出分别执行服务端数据范围检查。' },
  { module: 'console-authorization', title: '授权模拟（角色与用户）', description: '由服务端会话控制的显式授权模拟，只计算被模拟主体权限，不继承操作者管理员权限。' },
  { module: 'console-authorization', title: '服务间令牌与精确 capability', description: '跨应用调用签发短期 service token，按 <target-app>:<resource>:<action> 精确授权。' },
  { module: 'console-vault', title: '集成配置与凭证保险箱', description: '外部集成密钥集中保管，业务应用按 integrationCode 解析，不落地明文。' },
  { module: 'workflow', title: '通用审批流程编排', description: '按应用、资源与动作定义审批流，业务应用不自建审批实现。' },
  { module: 'workflow', title: '审批动作定义同步', description: '应用启动时同步可审批动作，保证流程定义与业务动作一致。' },
  { module: 'collab', title: '文档实时协作', description: '多人同时编辑的会话、状态同步与冲突处理。' },
  { module: 'platform-tenant', title: '租户开通与订阅管理', description: '租户建立、套餐订阅、部署实例分配与生命周期。' },
  { module: 'platform-license', title: 'License 与策略包发布', description: 'License 签发校验，以及租户授权策略包的编排、发布与生效。' },
  { module: 'platform-app-governance', title: '应用清单与部署绑定治理', description: '按 manifest 登记应用资源与动作，管理组件发布 Tag 与部署绑定。' },
  { module: 'aims', title: '项目全生命周期（PIVR）', description: '规划、实施、验收、交付四阶段，里程碑与合同回款节点映射。' },
  { module: 'aims', title: '工作项四级层次', description: 'Epic → Story → Task → Sub-task 的分解、看板与状态流转。' },
  { module: 'aims', title: '工时登记与统计', description: '按项目、人员与期间登记工时，作为成本归集与贡献度量的来源。' },
  { module: 'aims', title: 'GitLab 仓库与 Issue 集成', description: '工作项幂等投影为 GitLab Issue，仓库凭证经保险箱执行。' },
  { module: 'aims', title: '产品中心', description: '功能目录、需求池、规划事项与周期、产品版本与发布范围。' },
  { module: 'aims', title: '产品采用视图', description: '按 Assets 交付资产与环境呈现产品当前部署与客户覆盖。' },
  { module: 'aims', title: '项目周报', description: '按周汇总项目进展、风险与下周计划。' },
  { module: 'altoc', title: '客户与商机管理', description: '客户主档、商机阶段推进与售前协同。' },
  { module: 'altoc', title: '合同与回款计划', description: '合同、付款条款与回款节点，验收完成后推进可开票。' },
  { module: 'altoc', title: '服务工单与 SLA', description: '客户服务工单受理、派发与 SLA 结果判定。' },
  { module: 'assets', title: '客户交付资产与环境台账', description: '正式交付资产、环境主档与部署关系，作为交付身份事实源。' },
  { module: 'assets', title: '采购到处置流程', description: '采购、入库、分配、退回与处置的全流程与审批联动。' },
  { module: 'assets', title: '到期与配额预警', description: '资产到期、质保、资源配额与离职未回收的提醒。' },
  { module: 'finance', title: '项目成本归集', description: '按项目与期间汇总人力、外包与其他成本。' },
  { module: 'finance', title: '产品成本分摊规则', description: '按产品维护分摊比例与依据，支撑产品经营结果。' },
  { module: 'people', title: '人员任职与成本快照', description: '任职关系与人力成本单价快照，供成本核算引用。' },
  { module: 'people', title: '项目贡献与绩效', description: '按周期汇总项目贡献事实，形成绩效输入。' },
  { module: 'codocs', title: '文档编辑与版本', description: '结构化文档编辑、历史版本与引用。' },
  { module: 'codocs', title: '文档发布与短链', description: '对外发布已审阅内容并生成稳定短链。' },
  { module: 'insights', title: '代码仓库分析', description: '仓库、分支与提交活动的研发过程分析。' },
  { module: 'foundation-layer', title: '统一认证与授权 helper', description: '业务应用复用统一鉴权判断，不复制策略解析与动作蕴含算法。' },
  { module: 'foundation-layer', title: '共享 UI 与列表规范', description: '确认弹窗、空状态、防抖搜索与服务端分页等统一交互能力。' },
  { module: 'tenant-runtime', title: 'tenant-runtime 业务 API', description: '客户侧运行时承担业务数据读写与领域不变量，应用不直连数据库。' },
  { module: 'tenant-runtime', title: '跨应用可靠投递', description: '冻结命令、幂等键与 receipt 保证跨应用写操作不重复、不丢失。' },
  { module: 'webdev', title: '远程开发代理控制台', description: '远程开发环境的接入与会话管理。' }
]

/** 需求池：来自实际反馈与治理事项 */
export const requests = [
  { title: '产品中心入口过多，按岗位重排', problemStatement: '产品详情页平铺十余个同等权重入口，研发、销售与经营岗位都要在同一堆入口里找自己关心的内容，新同事上手需要有人带。希望围绕岗位关注点收敛为少数几个工作视角。', sourceType: 'internal', urgencyLevel: 'P1' },
  { title: '产品采用打不开时看不出要补什么权限', problemStatement: '产品采用页返回 403 但只显示"访问权限不足"，无法判断缺的是本应用产品权限还是 Assets 的交付资产／环境数据范围，排查要翻代码和日志。', sourceType: 'engineering', urgencyLevel: 'P1' },
  { title: 'Console 授权快照偶发不可用', problemStatement: '业务应用读取权限快照偶发 503，页面菜单与操作按钮短时间全部消失，刷新后恢复，怀疑与策略包缓存冷启动有关。', sourceType: 'engineering', urgencyLevel: 'P0' },
  { title: '跨应用切换需要重新确认身份', problemStatement: '从项目管理跳到资产或财务时偶尔回到登录页，用户以为掉线。希望同源应用统一走企业 Shell，保持登录态与返回路径。', sourceType: 'customer', urgencyLevel: 'P1' },
  { title: '合同回款节点与项目里程碑手工对齐', problemStatement: '合同签订后要人工在项目里再建一遍里程碑，节点变更两边容易不一致，验收完成也要手工通知财务开票。', sourceType: 'customer', urgencyLevel: 'P1' },
  { title: '工时需要按部门批量导入', problemStatement: '部分部门仍在用表格记录工时，逐条补录成本高，希望支持按模板批量导入并保留校验与审核。', sourceType: 'internal', urgencyLevel: 'P2' },
  { title: '资产到期提醒提前量不可配置', problemStatement: '资产与资源到期提醒的提前天数固定，采购周期长的客户希望提前更久收到提醒，短周期的又觉得太吵。', sourceType: 'customer', urgencyLevel: 'P2' },
  { title: '策略包发布缺少回滚入口', problemStatement: '策略包发布后如果授权范围配置有误，只能重新编排再发一次，缺少回到上一个已知良好版本的显式入口。', sourceType: 'engineering', urgencyLevel: 'P1' },
  { title: '希望在手机上填写项目周报', problemStatement: '项目经理经常在客户现场，周五提交周报时只有手机。当前页面在窄屏下表单拥挤，填写困难。', sourceType: 'customer', urgencyLevel: 'P2' },
  { title: '交付文档缺少模板库', problemStatement: '每个项目的方案、验收报告都从空白开始写，格式与口径不一致，希望沉淀可复用的文档模板。', sourceType: 'internal', urgencyLevel: 'P3' }
]

/** 规划事项：本次准备建设的范围，投入类别为 reliability / usability / growth */
export const planningItems = [
  { title: '产品工作台三视角信息架构', scopeSummary: '围绕产品与研发、销售与交付、经营与管理三个岗位视角重排产品中心页签，概览页按视角呈现面向岗位、优先内容与关键计数，空间维护移入设置页。', investmentCategory: 'usability', urgencyLevel: 'P1' },
  { title: '跨应用授权失败归类与可执行提示', scopeSummary: '目标应用在授权失败时返回稳定原因码，调用方据此区分"用户缺数据范围"与"服务授权或部署绑定异常"，只有前者提示用户补权限，后者保持可重试且不外泄诊断信息。', investmentCategory: 'reliability', urgencyLevel: 'P1' },
  { title: 'Console 授权快照持久缓存', scopeSummary: '把策略包缓存从进程内存改为可持久、可跨实例共享的后端，冷启动不再回源控制面重新取包验签，并保留缓存未命中时的失败关闭行为。', investmentCategory: 'reliability', urgencyLevel: 'P0' },
  { title: '企业 Shell 统一跨应用切换', scopeSummary: '同源业务应用统一经企业 Shell 进入，集中处理登录态、应用目录与返回路径；业务模块不再自建入口或信任未校验的消息。', investmentCategory: 'usability', urgencyLevel: 'P1' },
  { title: '合同—里程碑—回款闭环增强', scopeSummary: '合同生效后按付款条款同步生成项目里程碑，验收通过后由服务端可靠推进回款计划可开票，两侧以幂等命令与回执对齐，不做人工二次录入。', investmentCategory: 'growth', urgencyLevel: 'P1' },
  { title: '集成可靠投递运维可视化', scopeSummary: '为跨应用可靠投递提供受控的诊断与重放界面，展示命令状态、重试次数与死信原因，支持按权限脱敏查看。', investmentCategory: 'reliability', urgencyLevel: 'P2' },
  { title: '统一通知中心', scopeSummary: '把资产到期、审批待办、工单与周报提醒收敛到统一通知入口，按收件资格校验后投递，避免各应用各自广播。', investmentCategory: 'usability', urgencyLevel: 'P2' }
]

/** 规划周期：季度节奏 */
export const cycles = [
  { title: '2026 Q3 规划周期', startsOn: '2026-07-01', endsOn: '2026-09-30', goalSummary: '完成产品中心信息架构收敛与跨应用授权失败归类，降低新用户上手成本与线上排查成本。', reviewIntervalDays: 14 },
  { title: '2026 Q4 规划周期', startsOn: '2026-10-01', endsOn: '2026-12-31', goalSummary: '加固授权与可观测性，打通合同到回款的闭环，并把跨应用可靠投递的运维能力交付到可自助处理。', reviewIntervalDays: 14 }
]

/** 产品版本：新建版本进入规划中状态，发布与验收走各自命令 */
export const versions = [
  { versionCode: '2026.09', name: '产品中心与三视角工作台', description: '产品中心按岗位重排为三个工作视角，概览页呈现关键计数与视角入口，产品空间维护移入设置页。', plannedReleaseDate: '2026-09-30' },
  { versionCode: '2026.10', name: '授权与可观测性加固', description: '跨应用授权失败归类、授权快照持久缓存，以及可靠投递的诊断与重放能力。', plannedReleaseDate: '2026-10-31' },
  { versionCode: '2026.12', name: '一体化经营闭环增强', description: '合同、里程碑与回款的服务端闭环，产品成本分摊与经营结果口径对齐。', plannedReleaseDate: '2026-12-31' },
  { versionCode: '2027.03', name: '平台治理与多租户运维', description: '策略包回滚、部署绑定治理与租户级运维能力。', plannedReleaseDate: '2027-03-31' }
]

/** 模块 key → 展平后的定义，便于校验 module 引用 */
export function flatComponents() {
  const flat = []
  for (const root of components) {
    flat.push({ ...root, parentKey: null, children: undefined })
    for (const child of root.children || []) flat.push({ ...child, parentKey: root.key })
  }
  return flat
}
