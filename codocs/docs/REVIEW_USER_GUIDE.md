# 文档审阅审批功能 - 用户指南

## 需要您配合的工作

### 一、数据库部署（必须）

请执行以下步骤部署数据库：

```bash
# 1. 连接到数据库
mysql -h oa.wiztek.cn -u root -pWiztek@1902 hzy_codocs

# 2. 执行迁移脚本
source server/migrations/create_review_tables.sql

# 3. 验证表创建
SHOW TABLES LIKE 'review%';
DESC documents;

# 4. 查看预置的审批流程模板
SELECT id, name, review_type, sub_type FROM review_flow_templates;
```

预期结果：

- 创建了 3 张新表：`review_flow_templates`, `document_reviews`, `review_actions`
- `documents` 表新增了 `publish_info` 字段
- 预置了 3 个默认审批流程模板

### 二、环境配置检查（必须）

确认 `.env.dev` 文件中的配置正确：

```env
# 1. 企业微信配置（已有）
WECOM_CORPID=wwe3597050c256d8e4
WECOM_CORPSECRET=7aNXQpxOY3DY8Z4rdQiyFPc0nI0ysY2x2mf8BP-QzIw
WECOM_AGENTID=1000007

# 2. Account API 配置（已有）
HZY_CONSOLE_API_URL=http://localhost:3000
HZY_ACCOUNT_API_KEY=ak_b9051a45ac91ea99faac44fb9316c034
HZY_ACCOUNT_API_SECRET=sk_1d07b9057d1cad11996cb26269802dc0906dcdeba6d3d691f885c16e7def94ee

# 3. 站点 URL（需要添加）
NUXT_PUBLIC_SITE_URL=https://codocs.wiztek.cn
```

如果缺少 `NUXT_PUBLIC_SITE_URL`，请添加它（用于企业微信消息中的链接）。

### 三、企业微信消息服务检查（必须）

确认 `wecomsg.wiztek.cn` 服务正常运行：

```bash
# 测试企业微信消息服务
curl -X POST http://wecomsg.wiztek.cn/send \
  -H "Content-Type: application/json" \
  -d '{
    "touser": "your_uid",
    "msgtype": "text",
    "content": "测试消息"
  }'
```

预期结果：返回成功响应，您的企业微信收到测试消息。

### 四、API 功能测试（建议）

启动开发服务器后，运行测试脚本：

```bash
# 1. 启动开发服务器
npm run dev

# 2. 在另一个终端运行测试脚本
./test-review-api.sh
```

或手动测试关键 API：

```bash
# 获取审批流程模板列表
curl http://localhost:3001/api/reviews/templates

# 创建测试模板
curl -X POST http://localhost:3001/api/reviews/templates \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=your_uid" \
  -d '{
    "name": "测试流程",
    "review_type": "知识库",
    "target_category": "knowledge",
    "nodes": [{
      "index": 0,
      "name": "部门审核",
      "role": "dept_manager",
      "pass_type": "any",
      "pass_count": 1
    }],
    "status": 1
  }'
```

### 五、前端开发（可选，如需完整功能）

当前已完成后端 API，前端页面需要继续开发。如果您需要完整的前端界面，请告知，我可以继续实现：

**待开发的前端页面：**

1. 审批流程模板管理页面 (`/admin/publish`)
2. 审阅中心列表页面 (`/reviews`)
3. 审阅详情页面 (`/reviews/:id`)
4. 提交审阅弹窗组件
5. 在部门文档和项目文档页面添加"提交审阅"入口

**临时解决方案：**
在前端页面完成前，可以通过 API 直接测试完整流程：

```bash
# 1. 提交审阅
curl -X POST http://localhost:3001/api/reviews \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=initiator_uid" \
  -d '{
    "document_uuid": "your-document-uuid",
    "review_type": "知识库",
    "target_category": "knowledge"
  }'

# 2. 审阅通过
curl -X POST http://localhost:3001/api/reviews/1/approve \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=reviewer_uid" \
  -d '{"comment": "同意发布"}'

# 3. 确认发布
curl -X POST http://localhost:3001/api/reviews/1/archive \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=initiator_uid" \
  -d '{"target_category": "knowledge"}'
```

## 功能说明

### 已实现的功能

✅ **后端 API 完整实现**

- 审批流程模板管理（增删改查）
- 审阅提交与查询
- 审阅操作（通过/驳回/提醒/重新提交/归档）
- 企业微信消息通知
- 角色自动解析（部门经理/分管领导）
- 流程自动推进
- 文档只读状态管理

✅ **数据库设计**

- 3 张新表完整设计
- 预置默认审批流程模板
- 支持流程快照机制

✅ **核心功能**

- 多节点审批流程（最多5个节点）
- 3种通过条件（会签/或签/比例）
- 驳回后重新提交
- 审批通过后归档
- 完整的操作记录

### 待实现的功能

⏳ **前端界面**

- 审批流程模板管理界面
- 审阅中心（我发起的/待我审阅的/已完成的）
- 审阅详情页面（文档预览+批注+流程图+操作面板）
- 提交审阅弹窗
- 归档栏目页面对接

⏳ **权限配置**

- 在 `permissions.ts` 中添加审阅中心菜单
- 配置路由权限规则

## 使用流程示例

### 场景：提交知识库文档审阅

**1. 发起人提交审阅**

```bash
POST /api/reviews
{
  "document_uuid": "abc-123",
  "review_type": "知识库",
  "target_category": "knowledge"
}
```

- 系统自动查找"知识库"审批流程模板
- 解析审批节点的审阅人（如部门经理）
- 文档设为只读
- 发送企业微信通知给第一节点审阅人

**2. 审阅人审阅**

```bash
POST /api/reviews/1/approve
{
  "comment": "内容准确，同意发布"
}
```

- 记录审阅操作
- 检查是否满足通过条件
- 如满足，推进到下一节点或完成
- 发送企业微信通知

**3. 发起人归档**

```bash
POST /api/reviews/1/archive
{
  "target_category": "knowledge"
}
```

- 复制文档到知识库栏目
- 原文档标记"已发布为知识库"
- 审阅状态更新为已归档

## 故障排查

### 问题1：数据库连接失败

**症状：** API 返回 500 错误，日志显示数据库连接失败

**解决：**

1. 检查 `.env.dev` 中的数据库配置
2. 确认数据库服务正常运行
3. 测试数据库连接：`mysql -h oa.wiztek.cn -u root -p`

### 问题2：企业微信通知未收到

**症状：** 审阅操作成功，但未收到企业微信消息

**解决：**

1. 检查 wecomsg 服务是否运行：`curl http://wecomsg.wiztek.cn/health`
2. 检查用户 UID 是否正确
3. 查看服务器日志中的通知错误
4. 注意：通知失败不会影响审阅流程

### 问题3：角色解析失败

**症状：** 提交审阅时报错"无法找到审阅人"

**解决：**

1. 确认 Account API 正常运行
2. 检查文档的 `dept_code` 是否存在
3. 确认部门有配置 `managerId` 或 `leaderId`
4. 查看 Account API 的响应日志

### 问题4：文档只读状态异常

**症状：** 文档应该只读但可以编辑，或相反

**解决：**

```sql
-- 查看文档只读状态
SELECT uuid, title, readonly_flag FROM documents WHERE uuid = 'xxx';

-- 手动修复（如需要）
UPDATE documents SET readonly_flag = 0 WHERE uuid = 'xxx';
```

## 技术支持

如遇到问题，请提供以下信息：

1. 错误信息或异常行为描述
2. 相关的 API 请求和响应
3. 服务器日志（特别是 `[Review]` 开头的日志）
4. 数据库中相关记录的状态

## 下一步计划

1. **短期（1-2天）**
   - 完成前端管理页面
   - 实现审阅中心列表
   - 实现审阅详情页面

2. **中期（3-5天）**
   - 集成到现有页面
   - 完整的端到端测试
   - 用户培训文档

3. **长期（1-2周）**
   - 委员会支持
   - 统计报表
   - 移动端优化

## 相关文档

- **设计文档：** `docs/review-design.md` - 完整的功能设计
- **部署指南：** `docs/REVIEW_DEPLOYMENT.md` - 详细的部署步骤和 API 测试
- **实现总结：** `docs/REVIEW_IMPLEMENTATION_SUMMARY.md` - 已完成和待完成的工作

---

**最后更新：** 2026-03-09
**版本：** 1.0
