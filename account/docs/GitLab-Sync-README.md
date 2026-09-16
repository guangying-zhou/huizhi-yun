# GitLab-OSS文档同步 - 文档索引

## 📚 文档列表

### 🎯 快速开始

1. **[Document-System-Integration.md](./Document-System-Integration.md)** ⭐ 推荐首读
   - 文档系统集成指南
   - 包含完整代码示例
   - 适合前端开发者

### 🔧 技术文档

2. **[GitLab-OSS-Sync-Logic.md](./GitLab-OSS-Sync-Logic.md)**
   - 同步逻辑详解
   - 状态判断矩阵
   - 性能优化说明

3. **[Metadata-Structure.md](./Metadata-Structure.md)**
   - 元数据字段详解
   - 各种场景示例
   - 判断逻辑说明

4. **[GitLab-Webhook-Setup.md](./GitLab-Webhook-Setup.md)**
   - Webhook配置指南
   - 工作流程说明
   - 调试技巧

### 📖 功能说明

5. **[Conflict-Ignore-Feature.md](./Conflict-Ignore-Feature.md)**
   - 冲突忽略功能
   - 状态流转说明
   - API接口文档

6. **[Conflict-Resolution-Comparison.md](./Conflict-Resolution-Comparison.md)**
   - 三种冲突处理方式对比
   - 操作选择建议
   - 实际场景示例

### 📡 API文档

7. **[API.md](./API.md#文档同步工作流程说明)**
   - 完整API接口文档
   - 包含工作流程说明
   - 请求响应示例

---

## 🗺️ 阅读路径

### 路径1：前端开发者

```
1. Document-System-Integration.md
   ↓ 了解如何集成
2. Metadata-Structure.md
   ↓ 理解元数据
3. Conflict-Resolution-Comparison.md
   ↓ 掌握操作选择
4. API.md
   ↓ 查阅接口详情
```

### 路径2：后端开发者

```
1. GitLab-OSS-Sync-Logic.md
   ↓ 理解同步逻辑
2. GitLab-Webhook-Setup.md
   ↓ 配置Webhook
3. Metadata-Structure.md
   ↓ 了解数据结构
4. API.md
   ↓ 实现接口
```

### 路径3：产品经理/测试

```
1. Conflict-Resolution-Comparison.md
   ↓ 理解功能差异
2. Document-System-Integration.md
   ↓ 了解用户体验
3. GitLab-OSS-Sync-Logic.md
   ↓ 理解业务逻辑
```

---

## 🔍 快速查找

### 我想知道...

#### 如何检测冲突？
→ [Document-System-Integration.md#检测冲突](./Document-System-Integration.md#快速开始)

#### 元数据字段含义？
→ [Metadata-Structure.md#元数据字段](./Metadata-Structure.md#元数据字段)

#### 如何配置Webhook？
→ [GitLab-Webhook-Setup.md#配置步骤](./GitLab-Webhook-Setup.md#配置步骤)

#### 忽略和使用GitLab版本有什么区别？
→ [Conflict-Resolution-Comparison.md#详细对比表](./Conflict-Resolution-Comparison.md#详细对比表)

#### 同步逻辑是怎样的？
→ [GitLab-OSS-Sync-Logic.md#同步逻辑流程图](./GitLab-OSS-Sync-Logic.md#同步逻辑流程图)

#### API接口怎么调用？
→ [API.md#文档同步工作流程说明](./API.md)

---

## 📊 文档概览

| 文档                           | 类型     | 受众      | 页数估算 |
| ------------------------------ | -------- | --------- | -------- |
| Document-System-Integration    | 集成指南 | 前端      | 6页      |
| GitLab-OSS-Sync-Logic          | 技术文档 | 全员      | 8页      |
| Metadata-Structure             | 技术文档 | 开发      | 7页      |
| GitLab-Webhook-Setup           | 配置指南 | 后端/运维 | 6页      |
| Conflict-Ignore-Feature        | 功能说明 | 全员      | 7页      |
| Conflict-Resolution-Comparison | 对比说明 | 全员      | 6页      |
| API                            | API文档  | 开发      | 15页+    |

---

## 🎯 核心概念

### 关键术语

- **commit-id**: GitLab提交的唯一标识
- **lastModified**: OSS文件的最后修改时间
- **synced-last-modified**: 同步时保存的lastModified
- **conflict-status**: 冲突状态标记（'0'或'1'）
- **temp目录**: 存储GitLab最新版本的临时目录

### 三种主要状态

1. **无冲突** (nochange/updated)
   - GitLab和OSS版本一致
   - 或GitLab有更新但OSS未修改

2. **有冲突** (conflict)
   - GitLab有更新且OSS被修改
   - 需要用户决策

3. **已处理** (conflict-status='0')
   - 用户已选择处理方式
   - 不再提示冲突

### 四种用户操作

1. **查看差异** - 读取diff文件
2. **使用GitLab版本** - 覆盖OSS
3. **忽略冲突** - 保留OSS
4. **手动合并** - 综合处理

---

## 🔗 相关资源

### 外部依赖

- [GitLab API文档](https://docs.gitlab.com/ee/api/)
- [阿里云OSS文档](https://help.aliyun.com/product/31815.html)
- [Unified Diff格式](https://en.wikipedia.org/wiki/Diff#Unified_format)

### 代码位置

- **Webhook**: `server/api/v1/gitlab/webhook/push.post.ts`
- **使用GitLab版本**: `server/api/v1/projects/[project_code]/use-gitlab-version.post.ts`
- **忽略冲突**: `server/api/v1/projects/[project_code]/ignore-conflict.post.ts`
- **手动同步**: `server/api/v1/projects/[project_code]/gitlab-sync-docs.get.ts`

---

## 📝 更新日志

### 2026-01-24
- ✅ 创建完整文档体系
- ✅ 优化元数据结构（移除oss-last-modified）
- ✅ 新增冲突忽略功能
- ✅ 完善API文档

---

**文档索引版本**: 1.0
**最后更新**: 2026-01-24
**维护者**: 开发团队

## 💬 反馈

如有问题或建议，请联系开发团队。
