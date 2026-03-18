# VaultBot 部署完成报告 - 副本写入提示优化

## 📋 部署概览

**部署时间**: 2026-03-17 17:05 - 17:12 UTC  
**部署环境**: 生产环境 (/root/vaultbot @ 72.60.208.20)  
**版本更新**: `201965b` → `2aa6ae4`  
**部署状态**: ✅ **成功**

---

## 🎯 本次更新内容

### 核心修复：副本写入提示增强与 Worker 心跳

**问题描述**：
用户上传大量文件时，一直看到简单的提示：
```
副本写入中（0/510），请稍后再试。
大量文件会受 Telegram 限流影响，可能需要几分钟。
若长时间不动，请确认已运行副本写入进程：npm run worker
```

用户无法判断：
- Worker 是否在运行？
- 为什么进度不动？
- 是配置问题还是限流问题？

**修复方案**：

#### 1. 增强的提示信息 ✅

**新增显示内容**：
- ✅ 实时进度：PENDING 数量、已达标数量
- ✅ 配置信息：minReplicas 值、可用存储群数量
- ✅ 时间信息：批次等待时间、Worker 最近心跳时间
- ✅ 调试信息：批次 ID、Docker 日志查看命令
- ✅ 智能提示：根据配置给出针对性建议

**示例输出**：
```
副本写入中（128/510），请稍后再试。
当前状态：PENDING 382 · 已达标 128 · minReplicas 2 · 可用存储群 2/3
批次已等待：3 分钟
Worker 最近心跳：1 分钟前
大量文件会受 Telegram 限流影响，可能需要几分钟。
若长时间不动，请确认已运行副本写入进程：npm run worker
Docker 部署可用：docker compose logs -f worker
批次ID：clxxxxx
```

**智能判断**：
- 如果 `可用存储群 < minReplicas`：提示用户添加备份群或降低 minReplicas
- 否则：显示正常的限流提示

#### 2. Worker 心跳机制 ✅

**功能说明**：
- Worker 每次处理批次时自动记录心跳时间戳
- 心跳存储在 `TenantSetting` 表 (key: `worker_heartbeat`)
- 按租户独立记录（支持多租户）
- 用户可以看到 Worker 最近活跃时间

**验证结果**：
```sql
SELECT key, value, "updatedAt" FROM "TenantSetting" WHERE key = 'worker_heartbeat';

     key          |     value     |        updatedAt        
------------------+---------------+-------------------------
 worker_heartbeat | 1773767482898 | 2026-03-17 17:11:22.904
```
✅ Worker 心跳正常工作

---

## 📊 代码改动

| 文件 | 改动 | 说明 |
|-----|------|------|
| src/services/use-cases/delivery.ts | +34, -3 | 增强 pending 提示信息 |
| src/worker/index.ts | +17, -2 | 添加心跳记录机制 |
| **总计** | **+46, -5** | 小改动，低风险 |

---

## ✅ 部署验证

### 容器状态
```
✅ vaultbot-app        - 运行中 (127.0.0.1:3002->3002)
✅ vaultbot-worker     - 运行中
✅ vaultbot-postgres   - 运行中
✅ vaultbot-redis      - 运行中
```

### API 测试
```bash
curl http://127.0.0.1:3002/
# 返回: {"message":"Route GET:/ not found","error":"Not Found","statusCode":404}
# ✅ 服务正常响应
```

### Worker 心跳验证
```
✅ worker_heartbeat 记录已创建
✅ 时间戳正常更新
✅ 心跳功能正常工作
```

### 应用日志
```
✅ App 启动正常
✅ Worker 启动正常
✅ 无错误日志
```

---

## 🎉 用户体验改进

### 改进前
❌ 用户不知道 Worker 是否在运行  
❌ 用户不知道为什么进度不动  
❌ 用户无法判断是配置问题还是限流  
❌ 用户无法追踪批次状态  

### 改进后
✅ 用户能看到 Worker 最近心跳时间  
✅ 用户能看到实时进度和状态  
✅ 用户能看到配置信息（minReplicas、存储群数量）  
✅ 用户能获得针对性的建议  
✅ 用户有批次 ID 可以报告问题  
✅ 用户知道如何查看 Worker 日志  

---

## 📝 使用建议

### 1. 监控 Worker 心跳
```sql
-- 查看 Worker 最近心跳时间
SELECT 
  key, 
  value as timestamp_ms,
  "updatedAt",
  EXTRACT(EPOCH FROM (NOW() - "updatedAt")) as seconds_ago
FROM "TenantSetting" 
WHERE key = 'worker_heartbeat';
```

### 2. 查看批次状态
```sql
-- 查看待处理批次
SELECT 
  id, 
  status, 
  "createdAt",
  (SELECT COUNT(*) FROM "UploadItem" WHERE "batchId" = "UploadBatch".id) as total,
  (SELECT COUNT(*) FROM "UploadItem" WHERE "batchId" = "UploadBatch".id AND status = 'SUCCESS') as done,
  (SELECT COUNT(*) FROM "UploadItem" WHERE "batchId" = "UploadBatch".id AND status = 'PENDING') as pending
FROM "UploadBatch" 
WHERE status = 'COMMITTED' 
ORDER BY "createdAt" DESC 
LIMIT 10;
```

### 3. 查看 Worker 日志
```bash
# 实时查看 Worker 日志
docker compose logs -f worker

# 查看最近 100 行
docker compose logs worker --tail=100
```

### 4. 配置存储群
在 Bot 内：
1. 进入 `⚙️ 设置` → `🗄 存储群`
2. 确保有足够的可用存储群（≥ minReplicas）
3. 建议 minReplicas 设置为 2

---

## 🔍 故障排查

### 如果 Worker 心跳长时间不更新

1. 检查 Worker 容器状态：
```bash
docker compose ps worker
```

2. 查看 Worker 日志：
```bash
docker compose logs worker --tail=50
```

3. 重启 Worker：
```bash
docker compose restart worker
```

### 如果副本写入进度不动

1. 检查 Worker 心跳时间（应该在几分钟内）
2. 检查可用存储群数量（应该 ≥ minReplicas）
3. 检查 Telegram API 限流（大量文件需要时间）
4. 查看批次 ID 对应的 UploadItem 状态

---

## 📊 性能影响

### 数据库写入
- Worker 心跳：每个租户约 10 秒一次 upsert
- 影响：极小，可忽略不计

### 提示信息查询
- 增加了几个数据库查询（TenantSetting、TenantVaultBinding）
- 仅在用户查看 pending 批次时触发
- 影响：极小

---

## 🎯 总结

✅ **部署成功**  
✅ **功能正常**  
✅ **用户体验大幅提升**  
✅ **可观测性增强**  
✅ **无性能问题**  

这是一个小而精准的修复，直接解决了用户反馈的痛点问题。用户现在可以清楚地看到：
- Worker 是否在运行
- 副本写入的实时进度
- 配置是否合理
- 如何排查问题

**建议**：观察用户反馈，确认提示信息是否清晰易懂。

