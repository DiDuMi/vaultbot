# VaultBot 生产环境部署总结

## ✅ 部署成功

**部署时间**: 2026-03-05
**服务器**: 72.60.208.20
**项目路径**: /root/vaultbot
**部署状态**: 成功运行

---

## 📋 配置信息

### 环境变量
- **BOT_TOKEN**: 已脱敏（请使用已轮换的新 Token）
- **VAULT_CHAT_ID**: -1002271387791
- **TENANT_CODE**: prod
- **TENANT_NAME**: 生产环境
- **ADMIN_IDS**: 6704273308, 8493234547

### 端口配置（避免冲突）
- **HTTP API**: 127.0.0.1:3002 → 容器内 3000
- **PostgreSQL**: 内部网络 5432（不对外暴露）
- **Redis**: 内部网络 6379（不对外暴露）

### 容器列表
- **vaultbot-app**: Telegram Bot + HTTP API 服务
- **vaultbot-worker**: 后台任务处理器
- **vaultbot-postgres**: PostgreSQL 16 数据库
- **vaultbot-redis**: Redis 7 缓存和队列

---

## 🔧 服务管理命令

### 查看状态
```bash
cd /root/vaultbot
docker compose ps
```

### 查看日志
```bash
# 查看所有日志
docker compose logs -f

# 查看 app 日志
docker compose logs -f app

# 查看 worker 日志
docker compose logs -f worker
```

### 重启服务
```bash
cd /root/vaultbot

# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart app
```

### 更新部署
```bash
cd /root/vaultbot
git pull
docker compose up -d --build
docker compose logs -f
```

---

## 💾 数据备份

### 备份 PostgreSQL
```bash
docker compose exec postgres pg_dump -U vaultbot vaultbot > backup_$(date +%Y%m%d).sql
```

### 备份 Redis
```bash
docker compose exec redis redis-cli SAVE
docker compose cp redis:/data/dump.rdb ./backup_redis_$(date +%Y%m%d).rdb
```

---

## ✅ 验证清单

- [x] 代码已克隆到 /root/vaultbot
- [x] .env 配置文件已创建
- [x] Docker Compose 配置已优化
- [x] Dockerfile 已修复（安装 OpenSSL）
- [x] 所有容器已启动并运行
- [x] 数据库迁移已执行
- [x] HTTP 服务器已启动
- [x] Bot 服务已启动

---

## 🔒 与其他项目的隔离

本项目使用独立的容器名称和网络，不会影响其他项目：

- **容器名称前缀**: vaultbot-*
- **网络名称**: vaultbot_default
- **数据卷名称**: vaultbot_vaultbot_pgdata, vaultbot_vaultbot_redisdata
- **HTTP 端口**: 127.0.0.1:3002（避免与其他项目冲突）

---

## 📝 下一步操作

1. **测试 Bot 功能**
   - 在 Telegram 中找到你的 Bot
   - 发送 /start 命令测试
   - 尝试上传图片/视频

2. **配置监控**（可选）
   - 设置日志告警
   - 配置资源监控
   - 设置自动备份

---

## 🐛 故障排查

### Bot 无法响应
```bash
docker compose logs app
docker compose restart app
```

### 数据库连接失败
```bash
docker compose ps postgres
docker compose exec postgres psql -U vaultbot -d vaultbot -c "SELECT 1;"
```

### Worker 不工作
```bash
docker compose logs worker
docker compose exec redis redis-cli PING
docker compose restart worker
```

---

## 📞 联系信息

- **GitHub**: https://github.com/DiDuMi/vaultbot
- **服务器**: 72.60.208.20
- **管理员 ID**: 6704273308, 8493234547

