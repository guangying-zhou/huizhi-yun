import type { PivrStage, MilestoneMode, ProjectCategory } from '~/types/aims'

// ============================================================
// PIVR 四阶段定义
// ============================================================

export const pivrPhases: Record<PivrStage, { label: string, description: string, color: string, icon: string }> = {
  P: { label: '初始准备', description: 'Preparation — 锚点确立期', color: 'success', icon: 'i-lucide-compass' },
  I: { label: '关键实施', description: 'Implementation — 价值生产期', color: 'primary', icon: 'i-lucide-hammer' },
  V: { label: '验证交付', description: 'Validation — 质检合规期', color: 'warning', icon: 'i-lucide-shield-check' },
  R: { label: '迭代精进', description: 'Refinement — 二次爬坡期', color: 'info', icon: 'i-lucide-trending-up' }
}

export const pivrStageOptions = Object.entries(pivrPhases).map(([value, cfg]) => ({
  label: `${value} - ${cfg.label}`,
  value
}))

// ============================================================
// 里程碑模式配置
// ============================================================

export const milestoneModeConfig: Record<MilestoneMode, { label: string, description: string }> = {
  strong_constraint: { label: '强约束', description: '必须设置截止日期（政务/大型项目）' },
  rolling_plan: { label: '滚动计划', description: '完成即发布，不设截止日期（SaaS/持续迭代）' },
  periodic: { label: '周期性', description: '支持自动创建月度/周度里程碑（运维/日常）' }
}

export const milestoneModeOptions = Object.entries(milestoneModeConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 里程碑状态配置
// ============================================================

export const milestoneStatusConfig: Record<string, { label: string, color: string }> = {
  planning: { label: '规划中', color: 'neutral' },
  todo: { label: '待开始', color: 'secondary' },
  active: { label: '进行中', color: 'success' },
  completed: { label: '已完成', color: 'primary' },
  cancelled: { label: '已取消', color: 'error' }
}

// ============================================================
// PIVR 场景映射表（按项目类型）
// ============================================================

export const pivrTypeMapping: Record<ProjectCategory, Record<PivrStage, { title: string, description: string }>> = {
  product_dev: {
    P: { title: '规划POC', description: '架构选型与可行性验证' },
    I: { title: '核心MVP', description: '最小可行产品研发' },
    V: { title: '商用MMP', description: '体验打磨与发布' },
    R: { title: '市场PMF', description: '数据驱动迭代' }
  },
  custom_dev: {
    P: { title: '需求确认', description: '方案调研与范围签字' },
    I: { title: '系统构建', description: '代码开发与集成联调' },
    V: { title: '验收 UAT', description: '客户测试与终验' },
    R: { title: '维保移交', description: '知识转移与二期规划' }
  },
  delivery: {
    P: { title: '进场交底', description: '环境勘察与资源到位' },
    I: { title: '部署配置', description: '软件安装与参数调试' },
    V: { title: '试运行', description: '业务跑通与上线确认' },
    R: { title: '项目结项', description: '交付物归档与移交' }
  },
  maintenance: {
    P: { title: '周期规划', description: '本月/季重点任务梳理' },
    I: { title: '任务处理', description: '日常巡检与 Bug 修复' },
    V: { title: '质量抽检', description: '服务指标(SLA)核对' },
    R: { title: '复盘优化', description: 'SOP 更新与效率分析' }
  },
  sales: {
    P: { title: '线索获取', description: '客户画像与初步接触' },
    I: { title: '方案沟通', description: '需求挖掘与多轮演示' },
    V: { title: '商务谈判', description: '报价、合同与签单' },
    R: { title: '客户成功', description: '回款跟进与续费计划' }
  },
  presales: {
    P: { title: '商机分析', description: '背景调研与技术对标' },
    I: { title: '标书制作', description: '技术方案与架构设计' },
    V: { title: '投标演示', description: '讲标、述标与答疑' },
    R: { title: '经验复盘', description: '沉淀案例与标书模版' }
  },
  improvement: {
    P: { title: '缺陷分析', description: '定位瓶颈与改进目标' },
    I: { title: '方案执行', description: '流程优化或代码重构' },
    V: { title: '效果回归', description: '对比改进前后的数据' },
    R: { title: '标准固化', description: '全局推广与规范化' }
  },
  compliance: {
    P: { title: '规章梳理', description: '识别合规标准与差距' },
    I: { title: '自查整改', description: '完善制度与执行留痕' },
    V: { title: '模拟审计', description: '内部核查与资料完备' },
    R: { title: '合规加固', description: '形成常态化监控机制' }
  }
}
