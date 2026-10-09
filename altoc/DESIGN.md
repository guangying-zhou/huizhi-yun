# Design System — 汇智云经营 (Altoc)

## Product Context
- **What this is:** 面向 ToB/ToG 项目型销售的 LTC（Lead to Cash）经营平台
- **Who it's for:** 中小型 IT 服务商/系统集成商的销售团队和经营管理层
- **Space/industry:** B2B CRM / 销售管理 / 经营分析
- **Project type:** Web App / Dashboard
- **Platform:** 汇智云（huizhi-yun）monorepo 的一个模块，与 account/codocs/workflow 共享品牌

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian — 功能至上，数据密度适中，专业可信赖
- **Decoration level:** Minimal — 排版和留白做主角，不加装饰性元素
- **Mood:** 高效、可信、专业。用户每天使用 4-8 小时，追求"用起来顺手"而非"看起来花哨"。最高评价是"我没注意到设计，但什么都找得到"。

## Typography
- **Display/Hero:** Geist 700 — 利落、现代、有辨识度。用于页面标题、KPI 大数字
- **Body:** Geist 400/500 — 同字族保持一致性。CJK 回退到系统字体（苹方/微软雅黑）
- **UI/Labels:** Geist 500 — 同 body 字族
- **Data/Tables:** Geist (tabular-nums) — 数字对齐是金融类工具的基本要求
- **Code:** Geist Mono — 业务编号（OP-000001）用等宽字体
- **Loading:** Google Fonts CDN `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500`
- **Scale:**
  - 3xl: 48px/700 (KPI 大数字)
  - 2xl: 32px/700 (页面主标题)
  - xl: 24px/600 (区域标题)
  - lg: 20px/600 (卡片标题)
  - base: 15px/400 (正文)
  - sm: 13px/400 (辅助文字、标签)
  - xs: 11px/400 (极小标签、时间戳)

## Color
- **Approach:** Restrained — 颜色稀少，每次出现都有意义
- **Platform alignment:** 与汇智云所有模块（account/codocs/workflow）保持一致

### Nuxt UI Color Tokens
```
primary: 'orange'     // 主操作、品牌色、导航高亮
secondary: 'blue'     // 辅助操作、信息展示
neutral: 'zinc'       // 中性色、背景、边框、次要文字
```

### Semantic Colors (Tailwind/Nuxt UI 内置)
```
success: emerald      // 赢单、已到账、已签署、正向趋势
warning: amber        // 待审批、即将到期、需要关注
error: red            // 逾期、输单、异常指标、危险操作
info: blue            // 信息提示（与 secondary 一致）
```

### 颜色使用规则
- 默认状态用 neutral（灰色系），颜色只在"需要注意"时出现
- KPI 卡片：正向趋势用 success，负向趋势用 error，需关注用 warning
- 状态徽章：进行中=primary，赢单=success，输单=error，待审批=warning
- 不使用渐变、彩色图标、花哨的状态指示器

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — 不是 Bloomberg 那种密不透风，也不是消费品那种大面积留白
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)
- **Table row height:** 48px
- **Card padding:** 16-24px
- **Section gap:** 24-32px

## Layout
- **Approach:** Grid-disciplined — 严格栅格，可预测的对齐
- **Grid:** Nuxt UI Dashboard 默认栅格
- **Sidebar:** 固定侧边栏（可折叠），分组导航
- **Max content width:** 无限制（Dashboard 全宽）
- **Border radius:** sm:4px, md:8px, lg:12px, full:9999px (Nuxt UI 默认)

### Navigation Structure (分组导航)
```
首页

销售管理
  客户 / 线索 / 商机

商务管理
  报价 / 合同 / 回款

数据分析
  看板

──────
设置（底部）
```

## Motion
- **Approach:** Minimal-functional — 只在状态变化时用过渡动画
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms)
- **场景:** 页面切换、Toast 弹出、Kanban 拖拽反馈、侧边栏折叠
- **不做:** 入场动画、滚动动画、装饰性动效

## Page Patterns

### 列表页通用结构
```
筛选栏 (状态/负责人/日期范围) → 数据表 (UTable) → 分页
※ 商机列表额外支持列表/Kanban 视图切换
```

### 详情页通用结构
```
① 头部摘要 (名称 + 状态徽章 + 负责人 + 金额 + 操作按钮)
② 主信息区 (左侧: 基础字段 + 业务字段)
③ 时间线区 (右侧: 活动记录 + 状态流转)
④ 关联对象 (底部 tabs: 下游实体列表)
```

### 首页角色化
- **管理层:** 经营健康度评分 → KPI 卡片行 → 风险商机列表 → 逾期回款列表
- **销售:** 待办列表 → 今日跟进任务 → 我的商机概览 → 待审批项

### 空状态
- 每个空列表显示友好文案 + 主行动按钮（"创建第一个 XX"）
- KPI 无数据时显示 "--" 而非 0
- 新用户首页显示简单引导卡片

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-21 | 初始设计系统创建 | 由 /design-consultation 创建，基于产品定位和平台一致性 |
| 2026-03-21 | 色彩对齐平台 | 与 account/codocs/workflow 保持 orange+blue+zinc 一致 |
| 2026-03-21 | 选择 Geist 字族 | 替代 Inter/Roboto，更利落有辨识度，tabular-nums 支持好 |
| 2026-03-21 | 分组导航 | 9 个一级项按业务逻辑分为销售管理/商务管理/数据分析三组 |
| 2026-03-21 | Minimal-functional motion | 工具类产品追求响应速度，不做装饰性动效 |
