# 文档审阅审批功能 - 实现总结

## 已完成的工作

### 一、数据库设计与迁移 ✅

**文件：** `server/migrations/create_review_tables.sql`

创建了3张新表：

1. `review_flow_templates` - 审批流程模板表
2. `document_reviews` - 文档审阅记录表
3. `review_actions` - 审阅操作记录表

扩展了 `documents` 表：

- 新增 `publish_info` 字段用于标记已发布文档

预置了3个默认审批流程模板：

- 对外发文审批流程
- 公司制度审批流程
- 知识库审批流程

### 二、后端工具函数 ✅

**1. 审批引擎** (`server/utils/reviewEngine.ts`)

- `checkNodePassCondition()` - 检查节点通过条件
- `getCurrentNodeReviewers()` - 获取当前节点审阅人
- `isCurrentNodeReviewer()` - 检查是否是审阅人
- `hasUserActedOnNode()` - 检查是否已操作
- `getNextNode()` - 计算下一节点

**2. 企业微信通知** (`server/utils/reviewNotify.ts`)

- `sendReviewNotification()` - 发送 textcard 消息
- `notifyReviewers()` - 通知审阅人
- `notifyApproved()` - 通知审批通过
- `notifyRejected()` - 通知审批驳回
- `sendReminder()` - 发送提醒

### 三、后端 API ✅

**1. 审批流程模板管理**

- `GET /api/reviews/templates` - 获取模板列表
- `POST /api/reviews/templates` - 创建模板
- `PATCH /api/reviews/templates/:id` - 更新模板
- `DELETE /api/reviews/templates/:id` - 删除模板

**2. 审阅提交与查询**

- `POST /api/reviews` - 提交审阅
- `GET /api/reviews/:id` - 获取审阅详情
- `GET /api/reviews/by-document/:uuid` - 按文档查询审阅
- `GET /api/reviews/my?type=initiated|pending|completed` - 我的审阅列表

**3. 审阅操作**

- `POST /api/reviews/:id/approve` - 审阅通过
- `POST /api/reviews/:id/reject` - 审阅驳回
- `POST /api/reviews/:id/remind` - 发送提醒
- `POST /api/reviews/:id/resubmit` - 重新提交
- `POST /api/reviews/:id/archive` - 确认发布

### 四、核心功能实现 ✅

1. **角色解析**
   - 支持 dept_manager（部门经理）
   - 支持 supervisor（分管领导）
   - 支持 admin（管理员）
   - 支持 committee_members（委员会成员）
   - 支持 committee:xxx（指定委员会成员）

2. **通过条件**
   - all（会签）：需要指定人数通过
   - any（或签）：任一人通过即可
   - ratio（比例）：按比例通过

3. **委员会内审模式**
   - 协助审查（assist）：随机选取指定人数审查，全部通过后进入下一环节
   - 会签投票（vote）：全体成员投票，支持一般表决（1/2）和2/3表决

4. **流程控制**
   - 提交后文档自动只读
   - 驳回后自动解除只读
   - 支持重新提交（重置流程）
   - 归档后复制文档到目标栏目
   - 无预设模板时自动生成默认审批流程（逐级领导审批）

4. **企业微信通知**
   - 提交时通知首节点审阅人
   - 节点推进时通知下一节点审阅人
   - 驳回时通知发起人
   - 最终通过时通知发起人
   - 支持手动发送提醒

## 待完成的工作

### 一、前端页面和组件 ⏳

需要创建以下文件：

**1. 管理页面**

- `app/pages/admin/publish.vue` - 审批流程模板管理界面

**2. 审阅中心**

- `app/pages/reviews/index.vue` - 审阅列表（3个Tab）
- `app/pages/reviews/[id].vue` - 审阅详情页面

**3. 组件**

- `app/components/review/SubmitReviewModal.vue` - 提交审阅弹窗
- `app/components/review/ReviewFlowChart.vue` - Mermaid 流程图
- `app/components/review/ReviewTimeline.vue` - 操作记录时间线
- `app/components/review/ArchiveConfirmModal.vue` - 归档确认弹窗

**4. 修改现有页面**

- `app/pages/departments/coworks.vue` - 添加"提交审阅"菜单
- `app/pages/projects/index.vue` - 添加"提交审阅"菜单
- `app/pages/documents/[uuid].vue` - 显示 publish_info
- `app/config/permissions.ts` - 添加审阅中心菜单

**5. 归档栏目页面**

- `app/pages/company/rules.vue` - 展示归档的公司制度
- `app/pages/company/outsides.vue` - 展示归档的对外发文
- `app/pages/company/knowledge.vue` - 展示归档的知识库文档

### 二、权限配置 ⏳

在 `app/config/permissions.ts` 中添加：

- 审阅中心资源定义
- 审阅中心菜单项
- 路由权限规则

### 三、测试 ⏳

1. 单元测试
2. 集成测试
3. 端到端测试
4. 企业微信通知测试

## 技术亮点

1. **模块化设计**
   - 审批引擎独立封装
   - 通知逻辑独立封装
   - 易于维护和扩展

2. **灵活的流程配置**
   - 支持最多5个审批节点
   - 支持3种通过条件
   - 支持多种角色类型

3. **完善的错误处理**
   - 所有 API 都有 try-catch
   - 通知失败不影响流程
   - 详细的错误日志

4. **数据一致性保证**
   - 文档只读状态自动管理
   - 流程快照保证审批不受模板变更影响
   - 操作记录完整可追溯

5. **企业微信集成**
   - 实时消息通知
   - 支持 textcard 格式
   - 包含直达链接

## 部署步骤

### 1. 数据库迁移

```bash
mysql -h oa.wiztek.cn -u root -p hzy_codocs < server/migrations/create_review_tables.sql
```

### 2. 验证配置

检查 `.env.dev` 中的配置：

- 数据库连接
- Account API 配置
- 企业微信配置
- 站点 URL

### 3. 启动服务

```bash
npm run dev
```

### 4. 测试 API

参考 `docs/REVIEW_DEPLOYMENT.md` 中的测试命令。

## 使用流程

### 发起人视角

1. 在部门文档或项目文档页面，点击"提交审阅"
2. 选择审阅类型（如"知识库"）
3. 系统自动加载预设流程并解析审阅人
4. 确认提交，文档变为只读
5. 等待审阅，可发送提醒
6. 如被驳回，修改后重新提交
7. 审批通过后，确认归档到目标栏目

### 审阅人视角

1. 收到企业微信通知
2. 点击链接进入审阅页面
3. 查看文档内容，可添加批注
4. 查看流程图和操作记录
5. 选择通过或驳回（驳回需填写原因）
6. 提交后等待其他审阅人或流程推进

### 管理员视角

1. 进入"系统管理 > 发文流程"
2. 配置审批流程模板
3. 设置审阅类型、归档栏目
4. 配置审批节点（角色、通过条件）
5. 启用/禁用模板

## 注意事项

1. **角色解析依赖 Account API**
   - 确保 Account API 正常运行
   - 确保文档有正确的 dept_code 或 project_code

2. **企业微信通知**
   - 确保 wecomsg 服务正常
   - 通知失败不会阻塞流程
   - 查看日志排查问题

3. **文档只读状态**
   - 提交审阅后自动只读
   - 驳回后自动解除
   - 可手动修复异常状态

4. **流程快照**
   - 提交时生成快照
   - 后续模板变更不影响进行中的审阅
   - 保证流程稳定性

5. **归档操作**
   - 只有审批通过后才能归档
   - 归档会复制文档到新位置
   - 原文档标记 publish_info

## 扩展建议

1. **批注增强**
   - 审阅人批注高亮显示
   - 批注与审阅操作关联

3. **流程可视化增强**
   - 实时更新流程图
   - 显示每个节点的审阅人和状态

4. **统计报表**
   - 审阅效率统计
   - 驳回率分析
   - 审阅人工作量统计

5. **移动端支持**
   - 响应式设计
   - 企业微信小程序

## 相关文档

- 设计文档：`docs/review-design.md`
- 部署指南：`docs/REVIEW_DEPLOYMENT.md`
- API 测试：参考部署指南中的 curl 命令

## 联系方式

如有问题，请联系开发团队。
