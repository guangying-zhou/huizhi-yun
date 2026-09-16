# OSS 配置分离说明

## 概述

将项目文档（Project Docs）的存储从主 OSS bucket (`wiz-rs`) 迁移到专用的项目 bucket (`wiz-projects`)。

## 配置变化

### 新增环境变量（已添加到 `.env.dev`）

```env
# 项目文档专用 OSS Bucket（无版本控制）
ALIYUN_OSS_PROJECTS_BUCKET_NAME=wiz-projects
ALIYUN_OSS_PROJECTS_ENDPOINT=oss-cn-qingdao.aliyuncs.com
```

### 原有配置（其他文档继续使用）

```env
# 主 OSS Bucket（有版本控制）
ALIYUN_OSS_BUCKET_NAME=wiz-rs
ALIYUN_OSS_ENDPOINT=oss-cn-qingdao.aliyuncs.com
```

## 代码修改

### 1. `server/utils/oss.ts`

新增 `useProjectsOSS()` 函数：

```typescript
// 获取项目文档专用 OSS 客户端
export function useProjectsOSS(): OSS {
  // 使用 ALIYUN_OSS_PROJECTS_BUCKET_NAME 配置
}
```

### 2. 修改的 API 文件

以下文件已修改为使用 `useProjectsOSS()`：

- ✅ `server/api/v1/projects/[project_code]/gitlab-submit-docs.post.ts` - 提交文档到 GitLab
- ✅ `server/api/v1/projects/[project_code]/gitlab-sync-docs.get.ts` - 从 GitLab 同步文档
- ✅ `server/api/v1/projects/[project_code]/use-gitlab-version.post.ts` - 使用 GitLab 版本

## 存储分离说明

### wiz-projects bucket（项目文档）
- **路径**: `codocs/projects/{group}/{project}/...`
- **版本控制**: ❌ 无
- **用途**: 项目文档文件
- **特点**: 直接覆盖更新，无历史版本

### wiz-rs bucket（其他文档）
- **路径**: 其他路径
- **版本控制**: ✅ 有
- **用途**: 用户头像、其他文档等
- **特点**: 保留历史版本

## 迁移影响

1. **新文档**: 自动存储到 `wiz-projects`
2. **现有文档**:
   - 如果已在 `wiz-rs` 的 `codocs/projects/` 路径下，需要手动迁移
   - 或者在下次同步/提交时自动迁移到新 bucket

## 测试验证

重启 account 服务后，查看日志应显示：

```
[OSS] Config: { bucket: 'wiz-rs', endpoint: 'oss-cn-qingdao.aliyuncs.com', ... }
[Projects OSS] Config: { bucket: 'wiz-projects', endpoint: 'oss-cn-qingdao.aliyuncs.com', ... }
```

## 注意事项

⚠️ **重要**: 重启 account 服务后才能生效
⚠️ **备份**: 建议先备份 `wiz-rs` 中的 `codocs/projects/` 数据
⚠️ **测试**: 在生产环境部署前，建议先在开发环境充分测试

## 后续工作（可选）

- [ ] 编写数据迁移脚本，将现有项目文档从 `wiz-rs` 迁移到 `wiz-projects`
- [ ] 清理 `wiz-rs` 中的历史项目文档数据
- [ ] 更新监控和报警配置
