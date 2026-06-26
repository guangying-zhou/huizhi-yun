# Bookmark Fetcher Service 使用指南

## 服务说明

这是一个 FastAPI 服务，用于处理 X/Twitter 书签并转换为 Markdown 文档存储到 OSS。

- **端口**: 8001
- **日志**: `/tmp/fetcher.log`

## 快速启动

### 查看服务状态
```bash
./status.sh
```

### 启动服务
```bash
./start.sh
```
注意：启动需要约 5-10 秒。

### 停止服务
```bash
./stop.sh
```

### 查看日志
```bash
tail -f /tmp/fetcher.log
```

### 检查 API
```bash
curl http://localhost:8001/status
```

## 手动启动（开发模式）

```bash
source venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

## 故障排查

### 服务无法启动
1. 检查端口是否被占用：
   ```bash
   lsof -i :8001
   ```

2. 查看日志：
   ```bash
   tail -50 /tmp/fetcher.log
   ```

3. 检查 tenant-runtime 连接：
   确保 `.env` 文件中的 `HZY_TENANT_RUNTIME_URL` 和 `HZY_TENANT_RUNTIME_TOKEN` 配置正确，且 data-runtime 已启动。

### Codocs 提示"连接抓取服务失败"
1. 确认服务正在运行：
   ```bash
   curl http://localhost:8001/status
   ```

2. 如果服务未运行，执行：
   ```bash
   ./start.sh
   ```

## 开发环境配置

确保 `.env` 文件包含以下配置：

```env
# Tenant Runtime
HZY_TENANT_RUNTIME_URL=http://127.0.0.1:18080
HZY_TENANT_RUNTIME_TOKEN=xxx

# OSS
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
OSS_ENDPOINT=oss-cn-qingdao.aliyuncs.com
OSS_BUCKET_NAME=wiz-rs

# App
API_PORT=8001
```

## API 端点

- `GET /status` - 服务状态
- `POST /sync` - 手动触发同步
- `POST /process` - 处理书签
