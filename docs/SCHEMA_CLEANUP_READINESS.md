# Schema Cleanup Readiness

## 当前结论

现在还不是删除 `Tenant*` / `tenantId` 的执行阶段。

本阶段目标是把删除前门槛量化，确认哪些条件已经满足，哪些仍然阻塞。只有当数据审计、代码依赖、迁移演练三类门槛全部通过后，才可以讨论破坏性 schema migration。

## 新增审计脚本

- `scripts/schema-cleanup-readiness-audit.sql`

用途：

- 只读检查当前数据库是否已经具备 schema cleanup 的数据前提
- 检查已有 `projectId` 兼容字段是否完整
- 检查 `projectId` 与 `tenantId` 是否仍保持一致
- 列出仍依赖 `tenantId` 的表面
- 检查 dangling references
- 检查最近 24h 写入是否仍保持 project 双写

执行方式：

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < scripts/schema-cleanup-readiness-audit.sql
```

或在普通 PostgreSQL 环境中：

```bash
psql -U <user> -d <db> -f scripts/schema-cleanup-readiness-audit.sql
```

## 必须通过的硬门槛

### 1. 数据门槛

以下结果必须满足：

- `Tenant` 只剩当前生产项目，例如 `vault`
- 所有已有 `projectId` 表：
  - `project_id_null_rows = 0`
  - `project_tenant_mismatch_rows = 0`
- 所有 dangling reference 行数为 `0`
- 最近 24h：
  - `recent_project_id_null_rows = 0`
  - `recent_project_tenant_mismatch_rows = 0`

如果任一项不满足，不允许进入删除迁移。

### 2. 代码门槛

删除前必须确认：

- 上层业务代码不再直接依赖 `tenantId`
- `tenant-*` service API 只剩兼容出口
- worker routing、replication、audience 查询已经有 project-first 替代
- discovery、upload、social、stats 的读路径已经 project-first
- `/ops/tenant-check`、`preflight:tenant` 只作为兼容入口存在

建议检查命令：

```bash
git grep -n "tenantId\|TenantVaultBinding\|TenantTopic\|TenantSetting\|TenantUser" -- src prisma scripts
```

这里出现结果不一定都是阻塞，但每一类都必须归入：

- 已有 project-first 替代
- 仅兼容层保留
- 必须先迁移
- 可以删除

### 3. 迁移门槛

生产前必须完成：

- 在本地库演练通过
- 在 shadow 库演练通过
- 在生产备份恢复库演练通过
- 具备回滚脚本或恢复方案
- 迁移后 `npm run build`、`npm run test` 通过
- 旧 `shareCode` 打开链路通过
- 上传、复制、搜索、标签、推送链路通过

## 当前已知阻塞

以下仍是明确阻塞项：

- Prisma schema 中 `Tenant` 仍是大量表的外键根
- `TenantVaultBinding` / `TenantTopic` 仍承载真实存储路由
- `TenantSetting` / `TenantUser` 仍承载真实设置与用户状态
- `Tag`、`AssetTag`、`AssetComment`、`AssetLike` 等表尚无 `projectId`
- 部分 service / worker / stats 代码仍查询 `tenantId`
- 兼容 API 仍保留 `withProjectTenantFallback` 等旧入口

## 推荐下一步

1. 在生产运行 `scripts/schema-cleanup-readiness-audit.sql`，记录结果。
2. 基于审计结果更新 `docs/SCHEMA_CLEANUP_INVENTORY.md`。
3. 继续把剩余 service/worker/discovery/stats 读路径切到 project-first。
4. 为仍无 `projectId` 但长期保留的表设计下一轮 additive migration。
5. 等所有读写路径稳定后，再设计删除 `tenantId` / `Tenant*` 的 rehearsal migration。

## 禁止事项

当前阶段不要执行：

- 删除 `Tenant`
- 删除 `TenantMember`
- 删除 `TenantVaultBinding`
- 删除 `TenantTopic`
- 删除任何业务表的 `tenantId`
- 重命名 Prisma model 并直接部署生产

这些都必须等 readiness 审计和迁移演练通过后再单独决策。
