# 环境配置说明

## 测试环境配置

### 端口配置

- **Account API**: `http://localhost:3000`
- **本项目 (Codocs)**: `http://localhost:3001`

### 当前配置检查

在 `.env.dev` 中，配置应该为：

```env
# ✅ 正确配置
HZY_CONSOLE_API_URL=http://localhost:3000
HZY_ACCOUNT_API_KEY=ak_b9051a45ac91ea99faac44fb9316c034
HZY_ACCOUNT_API_SECRET=sk_1d07b9057d1cad11996cb26269802dc0906dcdeba6d3d691f885c16e7def94ee
```

### 常见错误

#### 错误 1: 路径包含 `/api/v1` 后缀

```env
# ❌ 错误配置
HZY_CONSOLE_API_URL=http://localhost:3000/api/v1
```

**问题**: 代码中已经自动添加 `/api/v1`，导致路径变成 `/api/v1/api/v1/users`

**解决**: 移除 `/api/v1` 后缀
```env
# ✅ 正确配置
HZY_CONSOLE_API_URL=http://localhost:3000
```

### 启动项目

项目已配置为固定使用 3001 端口：

```bash
pnpm dev
# 自动在 http://localhost:3001 启动
```

### 测试连接

```bash
# 测试 Account API
curl http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer ${API_KEY}:${API_SECRET}"

# 测试本项目的代理 API
curl http://localhost:3001/api/account/users

# 测试配置检查
curl http://localhost:3001/api/account/config-check
```

### 验证配置

访问测试页面：
```
http://localhost:3001/account-test
```

应该看到：
- ✅ API 配置正常
- ✅ API URL: http://localhost:3000

### 生产环境配置

在生产环境中，Account API 地址为：
```env
HZY_CONSOLE_API_URL=https://account.wiztek.cn
```

### 故障排除

如果仍然无法获取数据：

1. **检查 Account API 是否运行**
   ```bash
   curl http://localhost:3000/api/v1/users
   ```
   应该返回用户数据

2. **检查本项目端口**
   ```bash
   lsof -i :3001
   ```
   应该看到 node 进程

3. **查看浏览器控制台**
   - 打开 DevTools (F12)
   - 查看 Network 标签
   - 检查 API 请求的 URL 和响应

4. **查看服务器日志**
   终端应该显示 API 调用日志和任何错误信息

### 环境变量说明

| 变量                   | 说明             | 测试环境              | 生产环境                  |
| ---------------------- | ---------------- | --------------------- | ------------------------- |
| HZY_CONSOLE_API_URL    | Account API 地址 | http://localhost:3000 | https://account.wiztek.cn |
| HZY_ACCOUNT_API_KEY    | API 密钥         | 配置的 Key            | 配置的 Key                |
| HZY_ACCOUNT_API_SECRET | API 密钥         | 配置的 Secret         | 配置的 Secret             |

