import type { ProjectCategory, PivrStage } from '~/types/aims'

// ============================================================
// 交付物模板类型
// ============================================================

export type DeliverableType = 'document' | 'code' | 'artifact' | 'task'

export type ReviewLevel = 0 | 1 | 2 | 3 | 4

export interface DeliverableTemplate {
  name: string
  description?: string
  acceptanceCriteria: string
  deliverableType: DeliverableType
  required: boolean
  /** 对应工作项的评审级别: 0=免评审, 1=一般, 2=重要, 3=重大, 4=关键 */
  reviewLevel?: ReviewLevel
}

// ============================================================
// 里程碑交付物模板（按项目类型 + PIVR 阶段）
// 创建里程碑时根据项目类型和 PIVR 阶段自动填充
// ============================================================

export const milestoneDeliverableTemplates: Partial<Record<ProjectCategory, Partial<Record<PivrStage, DeliverableTemplate[]>>>> = {
  product_dev: {
    P: [
      { name: '《项目计划书》', deliverableType: 'document', required: true, acceptanceCriteria: '包含项目目标、范围、时间计划、资源分配、风险评估，经项目负责人审批', reviewLevel: 2 },
      { name: '《需求规格说明书》', deliverableType: 'document', required: true, acceptanceCriteria: '需求完整无歧义，含功能需求和非功能需求，经产品经理和技术负责人评审通过', reviewLevel: 2 },
      { name: '《架构设计方案》', deliverableType: 'document', required: false, acceptanceCriteria: '架构设计方案经评审通过，满足系统非功能需求' },
      { name: '《技术可行性评估》', deliverableType: 'document', required: false, acceptanceCriteria: '核心技术路径验证通过，输出 POC 结论和技术选型建议' }
    ],
    I: [
      { name: '需求分解', deliverableType: 'task', required: true, acceptanceCriteria: '需求拆分到任务级别，明确责任人和完成时间' },
      { name: '《MVP测试报告》', deliverableType: 'document', required: true, acceptanceCriteria: '测试覆盖率 ≥ 80%，所有测试用例执行完毕，P0/P1 缺陷清零', reviewLevel: 2 },
      { name: '《MVP验收报告》', deliverableType: 'document', required: true, acceptanceCriteria: '核心业务闭环可跑通，无 P0/P1 缺陷，经产品验收确认', reviewLevel: 2 },
      { name: '《接口文档》', deliverableType: 'document', required: false, acceptanceCriteria: 'API 文档与实际接口一致，示例可运行' },
      { name: '代码审查', deliverableType: 'task', required: false, acceptanceCriteria: '核心模块经 Code Review，无严重安全和性能问题' }
    ],
    V: [
      { name: '《用户验收报告》', deliverableType: 'document', required: true, acceptanceCriteria: 'UAT 测试全部通过，产品/客户签字确认', reviewLevel: 3 },
      { name: '《上线方案》', deliverableType: 'document', required: true, acceptanceCriteria: '含部署步骤、回滚方案、监控告警项、值班安排', reviewLevel: 2 },
      { name: '上线部署', deliverableType: 'artifact', required: true, acceptanceCriteria: '生产环境部署完成，核心链路验证通过，监控正常', reviewLevel: 3 }
    ],
    R: [
      { name: '《迭代总结》', deliverableType: 'document', required: true, acceptanceCriteria: '含数据指标对比、问题复盘、改进计划，经团队评审' },
      { name: '《用户反馈分析》', deliverableType: 'document', required: false, acceptanceCriteria: '收集 ≥ 10 条用户反馈，分类整理，输出优化建议' }
    ]
  },
  custom_dev: {
    P: [
      { name: '《需求规格说明书》', deliverableType: 'document', required: true, acceptanceCriteria: '客户签字确认，需求范围和边界清晰，含验收标准', reviewLevel: 2 },
      { name: '《项目计划书》', deliverableType: 'document', required: true, acceptanceCriteria: '含 WBS 分解、里程碑节点、资源计划、风险清单', reviewLevel: 2 },
      { name: '合同/SOW确认', deliverableType: 'task', required: true, acceptanceCriteria: '合同条款与需求范围一致，商务条件已确认', reviewLevel: 3 }
    ],
    I: [
      { name: '《系统设计文档》', deliverableType: 'document', required: true, acceptanceCriteria: '架构方案经评审通过，接口定义完整，数据库设计合理', reviewLevel: 2 },
      { name: '《联调报告》', deliverableType: 'document', required: false, acceptanceCriteria: '所有接口联调通过，数据流转正确，异常场景已覆盖' },
      { name: '阶段演示', deliverableType: 'task', required: false, acceptanceCriteria: '向客户演示已完成功能，收集反馈并记录' }
    ],
    V: [
      { name: '《UAT测试报告》', deliverableType: 'document', required: true, acceptanceCriteria: '客户验收测试全部通过，缺陷清零', reviewLevel: 2 },
      { name: '《终验确认单》', deliverableType: 'document', required: true, acceptanceCriteria: '客户签字盖章，项目范围内功能全部交付', reviewLevel: 3 },
      { name: '生产环境部署', deliverableType: 'artifact', required: true, acceptanceCriteria: '生产环境部署完成，数据迁移验证通过', reviewLevel: 3 }
    ],
    R: [
      { name: '知识文档转移', deliverableType: 'artifact', required: true, acceptanceCriteria: '运维手册、FAQ、培训材料齐全，客户运维人员培训完成' },
      { name: '维保交接', deliverableType: 'task', required: true, acceptanceCriteria: '维保合同签订，技术支持联系方式交接，SLA 确认', reviewLevel: 2 }
    ]
  },
  delivery: {
    P: [
      { name: '《实施方案》', deliverableType: 'document', required: true, acceptanceCriteria: '含环境要求、部署架构、实施步骤、时间计划' },
      { name: '《环境检查报告》', deliverableType: 'document', required: true, acceptanceCriteria: '硬件、网络、操作系统等基础环境满足要求' }
    ],
    I: [
      { name: '《部署记录》', deliverableType: 'document', required: true, acceptanceCriteria: '安装步骤、配置参数、版本号完整记录' },
      { name: '《集成测试报告》', deliverableType: 'document', required: true, acceptanceCriteria: '各系统间对接验证通过，数据交换正常' }
    ],
    V: [
      { name: '《试运行报告》', deliverableType: 'document', required: true, acceptanceCriteria: '业务流程跑通，性能满足要求，运行 ≥ 5 个工作日无重大问题' },
      { name: '《上线确认单》', deliverableType: 'document', required: false, acceptanceCriteria: '客户确认上线，各方签字' }
    ],
    R: [
      { name: '《交付物清单》', deliverableType: 'document', required: true, acceptanceCriteria: '所有交付物归档完整，版本号一致' },
      { name: '《移交确认单》', deliverableType: 'document', required: true, acceptanceCriteria: '客户签字确认接收' }
    ]
  },
  maintenance: {
    P: [
      { name: '《维护计划》', deliverableType: 'document', required: true, acceptanceCriteria: '本周期重点任务清晰，优先级已排序' }
    ],
    I: [
      { name: '工单处理记录', deliverableType: 'task', required: true, acceptanceCriteria: '所有工单按 SLA 时效处理，无超时未处理' },
      { name: '《巡检报告》', deliverableType: 'document', required: false, acceptanceCriteria: '系统健康状态检查，异常项已标注处理方案' }
    ],
    V: [
      { name: '《SLA达成报告》', deliverableType: 'document', required: true, acceptanceCriteria: '服务指标达标率 ≥ 95%，未达标项有说明' }
    ],
    R: [
      { name: '《周期复盘报告》', deliverableType: 'document', required: true, acceptanceCriteria: '含问题统计、趋势分析、SOP 优化建议' }
    ]
  },
  sales: {
    P: [
      { name: '《客户画像》', deliverableType: 'document', required: true, acceptanceCriteria: '客户基本信息、业务痛点、决策链完整' }
    ],
    I: [
      { name: '《解决方案》', deliverableType: 'document', required: true, acceptanceCriteria: '针对客户痛点的方案，含产品演示材料' }
    ],
    V: [
      { name: '《报价单/合同》', deliverableType: 'document', required: true, acceptanceCriteria: '商务条款确认，法务审核通过' }
    ],
    R: [
      { name: '《客户成功计划》', deliverableType: 'document', required: false, acceptanceCriteria: '含回款计划、续费策略、客户满意度跟踪' }
    ]
  },
  presales: {
    P: [
      { name: '《商机分析报告》', deliverableType: 'document', required: true, acceptanceCriteria: '竞品分析、技术对标、我方优劣势评估' }
    ],
    I: [
      { name: '《技术方案/标书》', deliverableType: 'document', required: true, acceptanceCriteria: '方案完整、架构合理、响应招标要求' }
    ],
    V: [
      { name: '《讲标材料》', deliverableType: 'document', required: true, acceptanceCriteria: '演示流畅、答疑准备充分' }
    ],
    R: [
      { name: '《投标复盘》', deliverableType: 'document', required: true, acceptanceCriteria: '中标/未中标原因分析，经验沉淀为模板' }
    ]
  },
  improvement: {
    P: [
      { name: '《改进分析报告》', deliverableType: 'document', required: true, acceptanceCriteria: '瓶颈定位准确，改进目标量化' }
    ],
    I: [
      { name: '《改进执行记录》', deliverableType: 'task', required: true, acceptanceCriteria: '改进措施已执行，变更记录完整' }
    ],
    V: [
      { name: '《效果评估报告》', deliverableType: 'document', required: true, acceptanceCriteria: '改进前后数据对比，效果量化' }
    ],
    R: [
      { name: '《规范化文档》', deliverableType: 'document', required: true, acceptanceCriteria: '改进成果固化为标准流程/规范，可推广' }
    ]
  },
  compliance: {
    P: [
      { name: '《合规差距分析》', deliverableType: 'document', required: true, acceptanceCriteria: '合规标准与现状对比，差距清单完整' }
    ],
    I: [
      { name: '《整改记录》', deliverableType: 'document', required: true, acceptanceCriteria: '每项差距有对应整改措施和完成时间' }
    ],
    V: [
      { name: '《内审报告》', deliverableType: 'document', required: true, acceptanceCriteria: '模拟审计通过，审计资料完备' }
    ],
    R: [
      { name: '《合规监控方案》', deliverableType: 'document', required: true, acceptanceCriteria: '常态化监控机制建立，定期检查计划确定' }
    ]
  }
}

// ============================================================
// 项目级交付物模板（项目完成/归档时需要的交付物）
// ============================================================

export const projectDeliverableTemplates: Partial<Record<ProjectCategory, DeliverableTemplate[]>> = {
  product_dev: [
    { name: '《项目结项报告》', deliverableType: 'document', required: true, acceptanceCriteria: '含项目总结、目标达成情况、经验教训、数据指标' }
  ],
  custom_dev: [
    { name: '《项目结项报告》', deliverableType: 'document', required: true, acceptanceCriteria: '含项目总结、交付物清单、客户满意度' },
    { name: '《终验确认单》', deliverableType: 'document', required: true, acceptanceCriteria: '客户签字盖章的项目终验文件' }
  ],
  delivery: [
    { name: '《项目结项报告》', deliverableType: 'document', required: true, acceptanceCriteria: '交付物清单核对完毕，客户签收' }
  ]
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取里程碑交付物模板
 */
export function getMilestoneDeliverables(category: ProjectCategory, stage: PivrStage): DeliverableTemplate[] {
  return milestoneDeliverableTemplates[category]?.[stage] || []
}

/**
 * 获取项目级交付物模板
 */
export function getProjectDeliverables(category: ProjectCategory): DeliverableTemplate[] {
  return projectDeliverableTemplates[category] || []
}
