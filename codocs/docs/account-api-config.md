# 浏览器目录兼容路径配置说明

> `/api/account/**` 是历史浏览器路径名称，不是 Codocs 到 legacy Account 的新调用面。当前实现通过 Foundation Console Directory adapter 读取 Console；不得为这些路径配置 `HZY_ACCOUNT_API_KEY`、`HZY_ACCOUNT_API_SECRET` 或其他静态 API 凭据。

## 测试环境配置

### 端口配置

- **Console Directory API**: `http://localhost:3000`
- **本项目 (Codocs)**: `http://localhost:3001`

### 当前配置检查

在 `.env.dev` 中，配置应该为：

```env
# 仅本地开发的 Console 地址覆盖；生产由 Console runtime 配置解析
HZY_CONSOLE_API_URL=http://localhost:3000
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
# 测试本项目在已登录会话下的兼容 BFF；匿名或跨主体请求应失败
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

在生产环境中，Console 地址由运行时配置解析；不要在业务应用配置 legacy Account 地址或凭据。
```env
# 仅在受控环境需要覆盖时设置
HZY_CONSOLE_API_URL=https://console.example.com
```

### 故障排除

如果仍然无法获取数据：

1. **检查 Console Directory API 是否运行且当前用户会话有效**
   ```bash
   curl http://localhost:3000/api/v1/console/directory/meta
   ```
   未认证请求应返回 401；不能回退到 Account。

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

| 变量 | 说明 | 本地开发 | 生产环境 |
| --- | --- | --- | --- |
| `HZY_CONSOLE_API_URL` | Console Directory 地址覆盖 | `http://localhost:3000` | 通常由 Console runtime 解析 |
| `HZY_ACCOUNT_API_KEY` / `HZY_ACCOUNT_API_SECRET` | 历史静态 Account 凭据 | 不用于当前 Codocs 目录路径 | 不得配置为新主路径 |
