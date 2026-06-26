# 文档版本控制方案对比

**创建时间：** 2026-01-25  
**状态：** 方案评估中

## 背景

Codocs 通过 Collab Runtime 提供协同编辑，文档内容存储在阿里云 OSS。需要确定合适的版本控制策略，在功能需求、成本控制、维护复杂度之间找到平衡。

## 核心问题

1. **Collab Runtime 自动保存频率高**
   - 用户编辑时每 2-5 秒触发一次保存
   - 10 分钟编辑可能产生 40-100 次 OSS 写入

2. **OSS 版本控制特性**
   - 版本控制是 Bucket 级别的开关，无法针对单个文件控制
   - 开启后，每次 `put()` 操作都会创建新版本
   - 版本数量会快速增长，导致存储成本上升

3. **需求矛盾**
   - 希望有版本历史追溯能力
   - 不希望产生过多无意义的版本
   - 需要控制存储成本

---

## 方案一：OSS 版本控制 + Redis 缓存 + 每日快照

### 架构
```
用户编辑 → Collab Runtime → Redis 缓存（实时）
                           ↓
                    每日凌晨 2:00 定时任务
                           ↓
                      OSS 存储（产生版本）
```

### 实现要点

1. **首次加载**：Redis → OSS → 缓存到 Redis
2. **编辑中**：所有更改仅保存到 Redis
3. **日终转存**：定时任务将 Redis 内容批量保存到 OSS
4. **手动保存**：提供"保存"按钮立即写入 OSS
5. **安全保障**：
   - Redis 持久化（RDB + AOF）
   - 长时间无编辑（30分钟）自动保存到 OSS
   - 服务器关闭前转存所有缓存

### 优点
- ✅ 每个文档每天最多 1 个版本（成本降低 99%）
- ✅ 协同编辑性能优异（Redis 毫秒级响应）
- ✅ 保留完整的历史版本追溯能力
- ✅ OSS 版本控制作为额外保障

### 缺点
- ❌ 架构复杂，需要维护 Redis 集群
- ❌ Redis 故障风险（需要高可用方案）
- ❌ 定时任务管理（需要监控和告警）
- ❌ 需要处理边界情况（服务器重启、长时间无编辑等）
- ❌ 开发和维护成本高

### 成本估算（100 个活跃文档）
- 直接 OSS 保存：120,000 - 300,000 版本/月
- 每日快照方案：3,000 版本/月
- Redis 内存：约 500MB（假设平均每文档 5MB）

---

## 方案二：关闭 OSS 版本控制 + 每日备份（推荐）⭐

### 架构
```
用户编辑 → Collab Runtime → OSS（直接覆盖，无版本）
                           ↓
                    每日凌晨备份任务
                           ↓
              复制到备份目录（按日期归档）
```

### 实现要点

1. **关闭 OSS Bucket 版本控制**
2. **正常编辑流程**：Collab Runtime 直接保存到 OSS（覆盖写入）
3. **每日备份**：
   ```
   定时任务：凌晨 2:00
   复制文件：docs/{path}/{file}.md 
        → backups/2026-01-25/{path}/{file}.md
   ```
4. **生命周期管理**：
   - 备份目录保留 30 天（或 90 天）
   - 超过期限自动删除旧备份
5. **恢复机制**：通过备份目录查看历史版本

### 目录结构示例
```
codocs/
├── users/
│   └── 123/
│       └── docs/
│           └── document.md          # 当前版本（实时更新）
│           └── document.yjs
└── backups/
    ├── 2026-01-25/
    │   └── users/123/docs/document.md
    ├── 2026-01-24/
    │   └── users/123/docs/document.md
    └── 2026-01-23/
        └── users/123/docs/document.md
```

### 优点
- ✅ **简单可靠**：架构清晰，维护成本低
- ✅ **成本可控**：只保留每日快照，可设置过期策略
- ✅ **无额外依赖**：不需要 Redis，不需要复杂的定时任务协调
- ✅ **版本清晰**：按日期组织，易于理解和查找
- ✅ **性能无损**：Collab Runtime 正常运行，无缓存层复杂度
- ✅ **易于实现**：只需一个简单的定时备份脚本

### 缺点
- ⚠️ 版本粒度较粗（每天一个版本）
- ⚠️ 无法追踪一天内的多次变更
- ⚠️ 恢复时只能恢复到某天凌晨的状态

### 成本估算（100 个活跃文档，保留 30 天）
- 每日备份：100 × 30 = 3,000 个备份文件
- 存储空间：假设平均每文档 100KB，约 300MB
- **远低于方案一的 Redis 内存成本**

### 实现代码示例

```typescript
// scripts/daily-backup.ts
import OSS from 'ali-oss'
import cron from 'node-cron'

const ossClient = new OSS({
  bucket: process.env.OSS_BUCKET_NAME,
  // ... 其他配置
})

// 每天凌晨 2:00 执行备份
cron.schedule('0 2 * * *', async () => {
  const today = new Date().toISOString().split('T')[0] // 2026-01-25
  
  console.log(`📦 Starting daily backup for ${today}...`)
  
  // 列出所有需要备份的文件
  const files = await listAllDocuments()
  
  for (const file of files) {
    const sourcePath = file.path // 例如：codocs/users/123/docs/doc.md
    const backupPath = sourcePath.replace(
      /^codocs\//, 
      `codocs/backups/${today}/`
    )
    
    try {
      // 复制文件
      await ossClient.copy(backupPath, sourcePath)
      console.log(`✅ Backed up: ${sourcePath}`)
    } catch (error) {
      console.error(`❌ Failed to backup: ${sourcePath}`, error)
    }
  }
  
  console.log(`📦 Daily backup completed`)
  
  // 清理过期备份（保留 30 天）
  await cleanupOldBackups(30)
})

async function cleanupOldBackups(retentionDays: number) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  
  // 删除早于 cutoffDate 的备份目录
  // ...
}
```

---

## 方案三：混合方案

结合方案一和方案二的优点：

1. **关闭 OSS 版本控制**（避免频繁版本）
2. **Collab Runtime 正常保存**（直接写 OSS）
3. **每日备份**（长期归档）
4. **关键时刻额外保存**：
   - 用户点击"保存"按钮 → 创建时间戳快照
   - 文档发布前 → 创建里程碑版本
   - 重要修改 → 手动标记版本

### 版本分类
```
codocs/
├── users/123/docs/
│   └── document.md              # 当前版本
├── backups/
│   └── 2026-01-25/              # 每日自动备份
│       └── users/123/docs/document.md
└── snapshots/
    └── users/123/docs/
        ├── document-20260125-143022.md    # 手动保存
        ├── document-20260124-091544.md    # 发布版本
        └── document-milestone-v1.0.md     # 里程碑版本
```

---

## 建议

### 短期（推荐）：**方案二**
- 实施简单，立即可用
- 满足基本的版本追溯需求
- 成本低，维护简单

### 长期（可选）：**方案三**
- 在方案二基础上增加关键时刻的精细化版本控制
- 按需实施，不增加太多复杂度

### 不推荐：**方案一**
- 维护成本过高
- 风险点较多（Redis 故障、定时任务失败等）
- 收益与复杂度不成正比

---

## 决策矩阵

| 维度 | 方案一 | 方案二 ⭐ | 方案三 |
|------|-------|----------|--------|
| 实现复杂度 | 高 | 低 | 中 |
| 维护成本 | 高 | 低 | 中 |
| 存储成本 | 中 | 低 | 中 |
| 版本粒度 | 天级 | 天级 | 天级+关键时刻 |
| 可靠性 | 中（依赖 Redis） | 高 | 高 |
| 性能 | 高（Redis） | 高（OSS 直写） | 高 |
| 扩展性 | 低 | 高 | 高 |

---

## 下一步

1. **确认选择方案二或方案三**
2. 实现每日备份定时任务
3. 设置 OSS 生命周期规则（清理过期备份）
4. 可选：实现版本查看和恢复 UI
5. 可选：增加手动快照功能（方案三）

---

## 参考资料

- [阿里云 OSS 版本控制文档](https://help.aliyun.com/zh/oss/user-guide/overview-78/)
- [Collab Runtime 内部 provider（Hocuspocus）参考](https://tiptap.dev/hocuspocus/introduction)
- [Y.js 协议说明](https://github.com/yjs/yjs)
