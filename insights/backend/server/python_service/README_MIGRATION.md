# FastAPI Backend Migration - Quick Start

## 当前进度

✅ **Phase 1: 基础设施** - 完成
✅ **Auth API模块** - 完成 (8个端点)

### 已完成功能

#### 基础架构
- ✅ 模块化目录结构 (`api/`, `models/`, `db/`, `utils/`)
- ✅ 异步数据库连接池 (SQLAlchemy 2.0 + aiomysql)
- ✅ Pydantic数据验证模型
- ✅ CORS中间件配置
- ✅ 安全工具 (SHA256密码哈希，Node.js兼容)
- ✅ Cookie认证中间件

#### Auth API (8个端点)
- ✅ `POST /api/auth/login` - 用户登录
- ✅ `POST /api/auth/send-code` - 发送验证码
- ✅ `POST /api/auth/verify-code` - 验证邮箱验证码
- ✅ `POST /api/auth/set-password` - 设置密码
- ✅ `POST /api/auth/reset-password` - 重置密码
- ✅ `POST /api/auth/check-email` - 检查邮箱是否已注册

## 快速启动

### 1. 安装依赖

```bash
# 确保使用项目虚拟环境
source .venv_ingest/bin/activate

# 安装新的依赖
pip install -r server/python_service/requirements.txt
```

### 2. 配置环境变量

确保 `.env.dev` 文件包含数据库配置：

```bash
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=codeinsightdb
```

### 3. 启动FastAPI服务器

```bash
# 使用开发脚本启动
./server/python_service/start-dev.sh

# 或者直接使用uvicorn
.venv_ingest/bin/uvicorn server.python_service.app:app --reload --port 8000
```

### 4. 访问API文档

服务启动后，访问：

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Health Check**: http://localhost:8000/healthz

## 测试Auth API

### 测试登录

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "your_password",
    "rememberMe": true
  }'
```

### 测试检查邮箱

```bash
curl -X POST http://localhost:8000/api/auth/check-email \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

## 项目结构

```
server/python_service/
├── app.py                  # FastAPI主应用
├── config.py              # 配置管理
├── requirements.txt       # Python依赖
├── start-dev.sh          # 开发服务器启动脚本
├── api/                  # API路由模块
│   ├── __init__.py
│   └── auth.py          # 认证API (✅ 完成)
├── models/              # Pydantic模型
│   ├── __init__.py
│   └── auth.py         # 认证模型
├── db/                 # 数据库工具
│   ├── __init__.py
│   └── connection.py   # 异步连接池
└── utils/              # 工具函数
    ├── __init__.py
    └── security.py     # 安全工具
```

## 下一步

### 待实现模块

1. **Dashboard API** (35个端点) - 优先级最高
   - Contributors统计和趋势
   - Repos统计和趋势
   - 排名、树状图、桑基图

2. **Repos API** (20个端点)
   - 仓库列表和详情
   - 统计信息查询

3. **Contributors API** (15个端点)
   - 贡献者管理
   - 统计查询

4. **其他模块** (~35个端点)
   - Departments, Monitoring, Commits等

## 兼容性说明

- ✅ 密码哈希使用SHA256，与Node.js版本完全兼容
- ✅ Cookie认证机制保持一致 (auth_user, auth_id, auth_role, auth_email, token)
- ✅ API响应格式与Node.js版本一致
- ✅ CORS配置匹配现有Nuxt配置

## 性能优化

- 使用异步数据库驱动 (aiomysql)
- 连接池配置: pool_size=10, max_overflow=20
- 自动预检查连接 (pool_pre_ping=True)
- 连接回收: 3600秒

## 开发建议

1. **逐模块迁移**: 按功能模块逐个迁移，便于测试和回滚
2. **API对比测试**: 使用测试脚本对比Node.js和FastAPI响应是否一致
3. **性能监控**: 迁移后对比响应时间和资源占用
