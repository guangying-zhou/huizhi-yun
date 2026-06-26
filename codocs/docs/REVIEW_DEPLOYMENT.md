# 文档审阅审批功能 - 部署和测试指南

## 一、数据库部署

### 1. 执行数据库迁移脚本

```bash
# 连接到 MySQL 数据库
mysql -h oa.wiztek.cn -u root -p hzy_codocs

# 执行迁移脚本
source server/migrations/create_review_tables.sql
```

### 2. 验证表创建

```sql
-- 检查表是否创建成功
SHOW TABLES LIKE 'review%';
SHOW TABLES LIKE 'document_reviews';

-- 检查 documents 表是否添加了 publish_info 字段
DESC documents;

-- 查看默认模板
SELECT * FROM review_flow_templates;
```

## 二、环境配置

### 1. 确认 .env.dev 配置

确保以下配置正确：

```env
# 企业微信消息服务（已配置）
WECOM_CORPID=wwe3597050c256d8e4
WECOM_CORPSECRET=7aNXQpxOY3DY8Z4rdQiyFPc0nI0ysY2x2mf8BP-QzIw
WECOM_AGENTID=1000007

# Account API（已配置）
HZY_CONSOLE_API_URL=http://localhost:3000
HZY_ACCOUNT_API_KEY=ak_b9051a45ac91ea99faac44fb9316c034
HZY_ACCOUNT_API_SECRET=sk_1d07b9057d1cad11996cb26269802dc0906dcdeba6d3d691f885c16e7def94ee

# 站点 URL（用于企业微信消息中的链接）
NUXT_PUBLIC_SITE_URL=https://codocs.wiztek.cn
```

### 2. 企业微信消息服务

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

## 三、功能测试

### 1. 模板管理测试

```bash
# 1. 获取模板列表
curl http://localhost:3001/api/reviews/templates

# 2. 创建新模板
curl -X POST http://localhost:3001/api/reviews/templates \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=your_uid" \
  -d '{
    "name": "测试审批流程",
    "review_type": "知识库",
    "target_category": "knowledge",
    "nodes": [
      {
        "index": 0,
        "name": "部门审核",
        "role": "dept_manager",
        "pass_type": "any",
        "pass_count": 1
      }
    ],
    "status": 1
  }'

# 3. 更新模板
curl -X PATCH http://localhost:3001/api/reviews/templates/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=your_uid" \
  -d '{
    "status": 0
  }'

# 4. 删除模板
curl -X DELETE http://localhost:3001/api/reviews/templates/1 \
  -H "Cookie: auth_user=your_uid"
```

### 2. 审阅流程测试

```bash
# 1. 提交审阅（普通部门）
curl -X POST http://localhost:3001/api/reviews \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=initiator_uid" \
  -d '{
    "document_uuid": "your-document-uuid",
    "review_type": "知识库",
    "target_category": "knowledge"
  }'

# 1b. 提交审阅（委员会 - 协助审查模式）
curl -X POST http://localhost:3001/api/reviews \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=initiator_uid" \
  -d '{
    "document_uuid": "your-document-uuid",
    "review_type": "投票表决",
    "committee_mode": "assist",
    "committee_pass_count": 2
  }'

# 1c. 提交审阅（委员会 - 会签投票模式）
curl -X POST http://localhost:3001/api/reviews \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=initiator_uid" \
  -d '{
    "document_uuid": "your-document-uuid",
    "review_type": "投票表决",
    "committee_mode": "vote",
    "committee_vote_type": "supermajority"
  }'

# 2. 查询审阅详情
curl http://localhost:3001/api/reviews/1

# 3. 查询我的审阅列表
curl "http://localhost:3001/api/reviews/my?type=initiated" \
  -H "Cookie: auth_user=your_uid"

curl "http://localhost:3001/api/reviews/my?type=pending" \
  -H "Cookie: auth_user=reviewer_uid"

# 4. 审阅通过
curl -X POST http://localhost:3001/api/reviews/1/approve \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=reviewer_uid" \
  -d '{
    "comment": "同意发布"
  }'

# 5. 审阅驳回
curl -X POST http://localhost:3001/api/reviews/1/reject \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=reviewer_uid" \
  -d '{
    "comment": "需要修改格式"
  }'

# 6. 发送提醒
curl -X POST http://localhost:3001/api/reviews/1/remind \
  -H "Cookie: auth_user=initiator_uid"

# 7. 重新提交
curl -X POST http://localhost:3001/api/reviews/1/resubmit \
  -H "Cookie: auth_user=initiator_uid"

# 8. 确认发布（归档路径由后端根据审阅类型自动决定）
curl -X POST http://localhost:3001/api/reviews/1/archive \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_user=initiator_uid" \
  -d '{}'
```

## 四、前端集成（待完成）

以下前端组件和页面需要继续实现：

### 已创建的后端 API

✅ 审批流程模板管理 API

- GET /api/reviews/templates
- POST /api/reviews/templates
- PATCH /api/reviews/templates/:id
- DELETE /api/reviews/templates/:id

✅ 审阅提交和查询 API

- POST /api/reviews
- GET /api/reviews/:id
- GET /api/reviews/by-document/:uuid
- GET /api/reviews/my

✅ 审阅操作 API

- POST /api/reviews/:id/approve
- POST /api/reviews/:id/reject
- POST /api/reviews/:id/remind
- POST /api/reviews/:id/resubmit
- POST /api/reviews/:id/archive

### 待创建的前端组件

需要创建以下前端文件：

1. **管理页面**
   - `app/pages/admin/publish.vue` - 审批流程模板管理

2. **审阅中心**
   - `app/pages/reviews/index.vue` - 审阅列表（我发起的/待我审阅的/已完成的）
   - `app/pages/reviews/[id].vue` - 审阅详情页面

3. **组件**
   - `app/components/review/SubmitReviewModal.vue` - 提交审阅弹窗
   - `app/components/review/ReviewFlowChart.vue` - Mermaid 流程图
   - `app/components/review/ReviewTimeline.vue` - 操作记录时间线
   - `app/components/review/ArchiveConfirmModal.vue` - 归档确认弹窗

4. **修改现有页面**
   - `app/pages/departments/coworks.vue` - 添加"提交审阅"菜单项
   - `app/pages/projects/index.vue` - 添加"提交审阅"菜单项
   - `app/pages/documents/[uuid].vue` - 显示 publish_info 标记
   - `app/config/permissions.ts` - 添加审阅中心菜单

5. **归档栏目页面**
   - `app/pages/company/rules.vue` - 对接归档文档
   - `app/pages/company/outsides.vue` - 对接归档文档
   - `app/pages/company/knowledge.vue` - 对接归档文档

## 五、注意事项

### 1. 权限控制

- 审批流程模板管理需要管理员权限
- 审阅操作需要验证用户是否是当前节点的审阅人
- 归档操作只能由发起人执行

### 2. 企业微信通知

- 确保 wecomsg 服务正常运行
- 通知失败不应影响审阅流程
- 所有通知操作都有 try-catch 保护

### 3. 数据一致性

- 文档提交审阅后自动设为只读
- 驳回后自动解除只读
- 归档后原文档标记 publish_info

### 4. 角色解析

当前实现中，角色解析逻辑：

- `dept_manager`: 从 Account API 获取部门的 managerId
- `supervisor`: 从 Account API 获取部门的 leaderId
- `admin`: 硬编码为 'admin'（可根据实际需求调整）
- `committee_members`: 获取当前部门全部委员会成员（协助审查模式下随机选取指定人数）
- `committee:xxx`: 获取指定委员会（xxx 为部门代码）的全部成员

> **注意：** Account API 的 `/api/departments/members` 接口使用数字主键 `id` 作为 `deptCode` 参数，而非字符串部门代码 `deptCode`。codocs 通过 `/api/v1/departments` 的 flat 列表中的 `id` 字段进行转换。

### 5. 测试建议

1. 先测试模板管理功能
2. 创建测试文档并提交审阅
3. 使用不同用户测试审阅通过/驳回
4. 测试重新提交流程
5. 测试归档功能
6. 验证企业微信通知是否正常发送

## 六、故障排查

### 1. 数据库连接失败

检查 .env.dev 中的数据库配置是否正确。

### 2. 企业微信通知失败

- 检查 wecomsg 服务是否运行
- 检查用户 UID 是否正确
- 查看服务器日志中的错误信息

### 3. 角色解析失败

- 检查 Account API 是否正常
- 验证 API Key 和 Secret 是否正确
- 确认文档的 dept_code 或 project_code 是否存在

### 4. 文档只读状态异常

检查 documents 表的 readonly_flag 字段：

- 提交审阅后应为 1
- 驳回后应为 0
- 可手动修复：`UPDATE documents SET readonly_flag = 0 WHERE uuid = 'xxx'`

## 七、下一步工作

1. 实现前端管理页面（审批流程模板配置）
2. 实现审阅中心列表页面
3. 实现审阅详情页面（含 Mermaid 流程图）
4. 在部门文档和项目文档页面添加"提交审阅"入口
5. 实现归档栏目页面的文档展示
6. 添加权限控制到 permissions.ts
7. 完整的端到端测试

## 八、API 文档

详细的 API 文档请参考设计文档 `docs/review-design.md`。
