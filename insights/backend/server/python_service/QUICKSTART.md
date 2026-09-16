# FastAPI单租户模板 - 快速开始

## 当前状态
✅ 52个API endpoints已完成迁移并通过测试

## 快速启动

### 1. 启动FastAPI服务
```bash
cd server/python_service
./start-dev.sh
```
访问: http://localhost:8000/docs

### 2. 配置Nuxt API Gateway（推荐）

在 `.env.dev` 添加:
```bash
FASTAPI_BASE_URL=http://127.0.0.1:8000
```

在 `nuxt.config.ts` 的 `nitro` 中添加:
```typescript
nitro: {
  routeRules: {
    '/api/dashboard/**': { proxy: 'http://127.0.0.1:8000/api/dashboard/**' },
    '/api/repos/**': { proxy: 'http://127.0.0.1:8000/api/repos/**' },
    '/api/contributors/**': { proxy: 'http://127.0.0.1:8000/api/contributors/**' }
  }
}
```

重启Nuxt:
```bash
rm -rf .nuxt && pnpm dev
```

### 3. 验证
访问前端Dashboard页面查看数据是否正常显示

## 已完成的API

- **Auth**: 6个端点 (login, send-code, verify-code等)
- **Dashboard**: 15个端点 (stats, ranking, trend, tree等)
- **Repos**: 8个管理端点
- **Contributors**: 6个管理端点

## 文档
- 完整文档: `walkthrough.md`
- API测试: `server/python_service/test_integration.py`
- Swagger: http://localhost:8000/docs

## 下一步
1. 配置API Gateway
2. 前端功能测试
3. 继续迁移剩余模块或准备生产部署
