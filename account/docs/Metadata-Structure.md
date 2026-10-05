# 元数据结构说明（修正版）

## 📋 概述

本文档说明OSS文件元数据的字段含义和使用方式。

## 🏷️ 元数据字段

```typescript
meta: {
  'gitlab-commit-id': string,        // OSS文件基于的GitLab commit ID
  'gitlab-latest-commit-id': string, // GitLab仓库最新commit ID
  'gitlab-latest-size': string,      // GitLab最新版本文件大小（字节）
  'synced-last-modified': string,    // 同步时OSS的lastModified
  'synced-at': string,               // 同步时间（UTC，ISO 8601）
  'conflict-status': '0' | '1',      // 冲突状态
  uid: 0,
  pid: 0
}
```

## 📊 字段详解

### gitlab-commit-id

**含义**：OSS当前文件内容对应的GitLab commit ID

**用途**：
- 标识OSS文件是基于哪个GitLab版本的
- 用于判断GitLab是否有新提交

**示例值**：`"abc123def456..."`

---

### gitlab-latest-commit-id

**含义**：GitLab仓库中该文件的最新commit ID

**用途**：
- 与 `gitlab-commit-id` 对比，判断是否有冲突
- 冲突时，标识GitLab的最新版本

**示例值**：`"xyz789uvw012..."`

**状态判断**：
```typescript
if (gitlab-commit-id === gitlab-latest-commit-id) {
  // 无冲突或已处理
} else {
  // 有冲突（此时conflict-status=1，用于前端简化判断）
}
```

---

### gitlab-latest-size

**含义**：GitLab最新版本的文件大小（字节）

**用途**：
- 前端显示"GitLab有更新 (2048 bytes)"
- 帮助用户判断变更大小

**示例值**：`"2048"`

---

### synced-last-modified

**含义**：同步时OSS文件的 `Last-Modified` 时间

**用途**：
- 判断OSS文件是否被用户修改
- 对比当前的 `Last-Modified`，如果不同说明OSS被编辑过

**示例值**：`"Fri, 24 Jan 2026 10:00:00 GMT"`

**判断逻辑**：
```typescript
const ossFile = await ossClient.head(ossPath)
const savedLastModified = ossFile.meta['synced-last-modified']
const currentLastModified = ossFile.res.headers['last-modified']

if (savedLastModified !== currentLastModified) {
  // OSS文件被用户修改过
}
```

**为什么不直接保存到meta？**
- OSS的 `Last-Modified` 是系统自动维护的，无法手动设置
- 每次上传/覆盖文件，`Last-Modified` 会自动更新
- 所以需要在元数据中保存"同步时的值"，用于后续对比

---

### synced-at

**含义**：最后一次同步的时间

**用途**：
- 显示"最后同步于X分钟前"
- 调试和日志追踪

**示例值**：`"2026-01-24T18:00:00.000Z"`

---

### conflict-status

**含义**：冲突处理状态

**可选值**：
- `'0'` - 无冲突或已处理
- `'1'` - 存在未处理的冲突

**用途**：
- 前端快速判断是否需要显示冲突提示
- 避免每次都对比commit-id

**状态流转**：
```
正常 (0) 
  ↓ GitLab有新提交 + OSS被修改
冲突 (1)
  ↓ 用户操作
已处理 (0)
```

---

## 🔄 状态场景

### 场景1：无冲突（正常状态）

```typescript
meta: {
  'gitlab-commit-id': 'abc123',
  'gitlab-latest-commit-id': 'abc123',  // ✅ 相同
  'gitlab-latest-size': '1024',
  'synced-last-modified': 'Fri, 24 Jan 2026 10:00:00 GMT',
  'synced-at': '2026-01-24T10:00:00Z',
  'conflict-status': '0'  // ✅ 无冲突
}

// OSS文件的lastModified
file.res.headers['last-modified'] = 'Fri, 24 Jan 2026 10:00:00 GMT'  // 与synced一致
```

**说明**：OSS和GitLab都是最新版本，无冲突

---

### 场景2：用户编辑了OSS文件（无冲突）

```typescript
meta: {
  'gitlab-commit-id': 'abc123',
  'gitlab-latest-commit-id': 'abc123',  // ✅ 相同（GitLab未变）
  'gitlab-latest-size': '1024',
  'synced-last-modified': 'Fri, 24 Jan 2026 10:00:00 GMT',
  'synced-at': '2026-01-24T10:00:00Z',
  'conflict-status': '0'
}

// OSS文件的lastModified（用户编辑后变化了）
file.res.headers['last-modified'] = 'Fri, 24 Jan 2026 11:00:00 GMT'  // ❗ 不一致
```

**说明**：
- GitLab未变化（commit-id相同）
- OSS被用户编辑（lastModified变化）
- 不视为冲突（conflict-status保持0）

---

### 场景3：GitLab有更新，OSS未修改（自动更新）

```typescript
// Webhook检测到GitLab有新提交
gitlabLatestCommitId = 'def456'

// 检查OSS
meta['synced-last-modified'] === file.res.headers['last-modified']
// → true，OSS未被修改

// 操作：自动覆盖OSS
// 更新后：
meta: {
  'gitlab-commit-id': 'def456',  // ✅ 已更新
  'gitlab-latest-commit-id': 'def456',
  'gitlab-latest-size': '2048',
  'synced-last-modified': 'Fri, 24 Jan 2026 12:00:00 GMT',  // 新的
  'synced-at': '2026-01-24T12:00:00Z',
  'conflict-status': '0'
}
```

---

### 场景4：双方都修改（冲突）

```typescript
// Webhook检测到
gitlabLatestCommitId = 'def456'  // GitLab有新提交
meta['synced-last-modified'] !== file.res.headers['last-modified']  // OSS被修改

// 更新元数据（不覆盖OSS文件）
meta: {
  'gitlab-commit-id': 'abc123',  // ❗ 保持不变（OSS基于的版本）
  'gitlab-latest-commit-id': 'def456',  // ❗ 不同（GitLab最新版本）
  'gitlab-latest-size': '2048',
  'synced-last-modified': 'Fri, 24 Jan 2026 10:00:00 GMT',  // 保持原值
  'synced-at': '2026-01-24T12:00:00Z',
  'conflict-status': '1'  // ❗ 标记冲突
}

// 同时创建
// temp/README.md - GitLab最新版本
// temp/README.md.diff - 差异文件
```

---

### 场景5：用户忽略冲突

```typescript
// 调用 ignore-conflict 接口或自行实现

// 更新前
meta: {
  'gitlab-commit-id': 'abc123',  // OSS基于的版本
  'gitlab-latest-commit-id': 'def456',  // GitLab最新版本
  'conflict-status': '1'
}

// 更新后
meta: {
  'gitlab-commit-id': 'def456',  // ✅ 更新为latest（表示已忽略）
  'gitlab-latest-commit-id': 'def456',  // ✅ 相同
  'gitlab-latest-size': '2048',
  'synced-last-modified': 'Fri, 24 Jan 2026 11:00:00 GMT',  // 当前OSS的
  'synced-at': '2026-01-24T12:05:00Z',
  'conflict-status': '0'  // ✅ 已处理
}

// temp文件被删除
```

**关键**：通过将 `gitlab-commit-id` 更新为 `latest`，下次GitLab如果没有新提交，就不会再报冲突。

---

### 场景6：用户使用GitLab版本

```typescript
// 调用 use-gitlab-version 接口或自行实现

// 更新前（冲突状态）
meta: {
  'gitlab-commit-id': 'abc123',  // OSS基于的版本
  'gitlab-latest-commit-id': 'def456',  // GitLab最新版本
  'conflict-status': '1'
}

// OSS文件
file.res.headers['last-modified'] = 'Fri, 24 Jan 2026 11:00:00 GMT'

// 操作：
// 1. 复制 temp/README.md 到 README.md（覆盖）
// 2. 删除 temp/README.md 和 temp/README.md.diff

// 更新后
meta: {
  'gitlab-commit-id': 'def456',  // ✅ 更新为GitLab版本
  'gitlab-latest-commit-id': 'def456',  // ✅ 相同
  'gitlab-latest-size': '2048',
  'synced-last-modified': 'Fri, 24 Jan 2026 12:05:00 GMT',  // 新文件的lastModified
  'synced-at': '2026-01-24T12:05:00Z',
  'conflict-status': '0'  // ✅ 已处理
}

// OSS文件（已被覆盖）
file.res.headers['last-modified'] = 'Fri, 24 Jan 2026 12:05:00 GMT'  // 与synced一致
```

**说明**：
- OSS文件内容被GitLab版本完全覆盖
- `gitlab-commit-id` 更新为最新版本
- `synced-last-modified` 保存新的lastModified
- 下次检测不会再有冲突

**与"忽略"的区别**：
- **使用GitLab版本**：OSS文件内容改变（被覆盖）
- **忽略冲突**：OSS文件内容不变（保留原内容）
- 两者都会将 `gitlab-commit-id` 更新为 `latest`

---

### 场景7：忽略后GitLab又有新提交

```typescript
// 当前状态（已忽略）
meta: {
  'gitlab-commit-id': 'def456',
  'gitlab-latest-commit-id': 'def456',
  'synced-last-modified': 'Fri, 24 Jan 2026 11:00:00 GMT',
  'conflict-status': '0'
}

// Webhook检测到新提交
gitlabLatestCommitId = 'xyz789'

// 判断
meta['synced-last-modified'] !== file.res.headers['last-modified']
// → OSS还是被修改过的状态

// 重新标记冲突
meta: {
  'gitlab-commit-id': 'def456',  // 保持（OSS基于的）
  'gitlab-latest-commit-id': 'xyz789',  // 新的commit
  'conflict-status': '1'  // 重新标记
}
```

---

## 💡 前端使用示例

### 检测冲突

```typescript
const file = await ossClient.head(ossPath)
const meta = file.meta

// 方法1：通过conflict-status（推荐）
if (meta['conflict-status'] === '1') {
  showConflictBanner()
}

// 方法2：通过commit-id对比（兼容）
if (meta['gitlab-commit-id'] !== meta['gitlab-latest-commit-id']) {
  // 可能有冲突
  if (meta['conflict-status'] === '1') {
    showConflictBanner()
  }
}
```

### 显示信息

```typescript
const meta = file.meta

console.log(`OSS版本：基于 commit ${meta['gitlab-commit-id']}`)
console.log(`GitLab最新版本：commit ${meta['gitlab-latest-commit-id']}`)
console.log(`GitLab版本大小：${meta['gitlab-latest-size']} bytes`)
console.log(`最后同步时间：${meta['synced-at']}`)

if (meta['conflict-status'] === '1') {
  console.log('⚠️ 存在冲突')
}
```

---

## ⚠️ 注意事项

1. **不要手动设置 `Last-Modified`**
   - 这是OSS系统字段，无法手动修改
   - 使用 `synced-last-modified` 保存同步时的值

2. **忽略≠永久忽略**
   - 忽略只是将两个commit-id设为相同
   - GitLab再有新提交时会重新检测

3. **conflict-status是辅助字段**
   - 主要通过commit-id判断
   - conflict-status只是快速标记

4. **时区处理**
   - `synced-at` 使用UTC时间
   - `synced-last-modified` 使用GMT时间（OSS格式）

---

**文档版本**: 2.0  
**最后更新**: 2026-01-24  
**维护者**: 开发团队
