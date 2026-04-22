# Schema 阶段 A 演练结果

## 1. 文档定位

本文档用于记录阶段 A 在本地/影子环境中的真实执行结果。

它承接：

- [SCHEMA_CLEANUP_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_DESIGN.md)
- [SCHEMA_CLEANUP_INVENTORY.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_INVENTORY.md)
- [SCHEMA_PHASE_A_FIELD_PLAN.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_FIELD_PLAN.md)
- [SCHEMA_PHASE_A_MIGRATION_DRAFT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_MIGRATION_DRAFT.md)
- [SCHEMA_PHASE_A_SHADOW_CHECKLIST.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_SHADOW_CHECKLIST.md)
- [SCHEMA_PHASE_A_BACKFILL_RUNBOOK.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_BACKFILL_RUNBOOK.md)

目标：

- 固定本轮演练的真实执行结果
- 说明哪些步骤已经跑通
- 给下一轮影子环境复演或阶段 B 设计提供依据

## 2. 演练 1 元信息

- 演练日期：`2026-04-21`
- 演练环境：本地演练库
- 数据库：`postgresql://postgres:postgres@localhost:5432/chucun`
- 分支：`codex-simplify-single-owner`
- 执行人：Codex
- 演练范围：阶段 A P0 表

## 3. 本轮执行内容

本轮已实际执行的内容：

1. 修改 [schema.prisma](/E:/MU/chucun/prisma/schema.prisma)，为 P0 表新增 nullable `projectId`
2. 生成影子环境演练用 migration 文件：
   - [migration.sql](/E:/MU/chucun/prisma/migrations/20260421090000_add_project_id_phase_a_p0/migration.sql)
3. 执行 A1 migration
4. 执行 A2 backfill：
   - [schema-phase-a-backfill.sql](/E:/MU/chucun/scripts/schema-phase-a-backfill.sql)
5. 重新生成 Prisma Client
6. 执行数据库校验与最小应用级验证

## 4. 本轮覆盖的表

本轮实际覆盖的 P0 表：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

本轮未覆盖：

- `TenantMember`
- `TenantVaultBinding`
- `TenantTopic`
- `PermissionRule`
- `VaultGroup`
- `Tag`
- `AssetTag`
- `AssetComment`
- `AssetCommentLike`
- `AssetLike`

## 5. 演练结果

### 5.1 A1 Migration

结果：通过

结论：

- P0 表的 `projectId` 字段已成功加到本地演练库
- 相关索引和唯一约束已成功创建
- migration 内容没有超出 P0 范围

### 5.2 A2 Backfill

结果：通过

结论：

- `projectId = tenantId` 的 backfill 已成功执行
- 脚本可在本地演练库顺利运行

### 5.3 缺失值检查

结果：全部通过

以下表的 `missingProjectId` 均为 `0`：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

### 5.4 一致性检查

结果：全部通过

以下表的 `mismatchCount` 均为 `0`：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

## 6. 样本抽检结果

本轮抽检了以下数据：

- `TenantSetting`
- `Asset`
- `UploadBatch`
- `Broadcast`

结论：

- 抽检样本均满足 `projectId = tenantId`
- 原有业务字段未出现丢失
- 当前本地库的单项目兼容态与阶段 A 设计一致

补充观察：

- `TenantUser` 当前样本为空，但这不影响本轮 migration/backfill 通过

## 7. 应用级验证

### 已通过

- `prisma validate`
- `prisma format`
- `npm run preflight:project`
- `npm run build`
- `npm run test`

### 验证结果

- `preflight:project` 通过
- `build` 通过
- `test` 通过，结果为 `102/102 passed`

## 8. 本轮遇到的非业务性阻碍

这些问题不属于 schema 设计错误，但需要记录：

- PowerShell 默认执行策略会拦住 `npx.ps1` / `npm.ps1`
- `prisma migrate dev --create-only` 在当前非交互环境下不可直接使用
- 本轮采用 `prisma migrate diff` 生成 SQL，再落成标准 migration 文件
- Prisma Client 需要在 schema 改动后重新生成，否则应用层看不到 `projectId`

这些问题不影响本轮结论，但说明：

- 真正进入持续演练时，最好固定一套命令入口
- 影子环境执行流程应继续沿用当前文档链，而不是临场重拼命令

## 9. 演练 1 结论

本轮本地演练的结论是：

- 阶段 A 的 P0 结构设计在本地演练库上可执行
- A1 migration 可落地
- A2 backfill 可落地
- backfill 后数据一致性良好
- 最小应用级验证未发现回归

因此，当前可以认为：

- 阶段 A 已通过第一次本地影子演练
- 但这仍不等于可以直接进入生产执行

## 10. 演练 2 元信息

- 演练日期：`2026-04-21`
- 演练环境：独立本地 shadow 库
- 数据库：`postgresql://postgres:postgres@localhost:5432/chucun_shadow_20260421_075654`
- 分支：`codex-simplify-single-owner`
- 执行人：Codex
- 演练范围：阶段 A P0 表

## 11. 演练 2 执行内容

本轮做了更接近真实影子环境的复演：

1. 先从本地 `chucun` 库克隆出独立 shadow 库 `chucun_shadow_20260421_075654`
2. 发现普通 `pg_dump | psql` 管道恢复方式在 tag 唯一约束上不稳定
3. 改用 `pg_dump -Fc` + `pg_restore` 完成稳定克隆
4. 因源库已完成阶段 A，本轮先在 shadow 库回退 P0 的 `projectId` 列与索引
5. 在回退后的 shadow 库重新执行 A1 migration
6. 在该 shadow 库重新执行 A2 backfill
7. 对 shadow 库执行 `preflight:project` 与数据校验

## 12. 演练 2 结果

### 12.1 A1 Migration

结果：通过

### 12.2 A2 Backfill

结果：通过

### 12.3 缺失值检查

结果：全部通过

以下表的 `missingProjectId` 均为 `0`：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

### 12.4 一致性检查

结果：全部通过

以下表的 `mismatchCount` 均为 `0`：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

### 12.5 Shadow 库应用级验证

结果：通过

已验证：

- shadow 库 `preflight:project` 通过
- shadow 库计数与演练预期一致：
  - `assets=10`
  - `events=191`
  - `users=0`
  - `batches=10`

## 13. 演练 2 新发现

本轮新增的重要发现：

- 直接用普通 `pg_dump | psql` 管道恢复本地 shadow 库时，可能出现约束恢复不稳定
- 改用 `pg_dump -Fc` + `pg_restore` 后，本地 shadow 克隆过程稳定
- 这说明后续如果要继续做更接近生产的演练，影子库克隆方式应固定为：
  - `pg_dump -Fc`
  - `pg_restore`

这个发现不影响阶段 A 方案本身，但会影响后续 rehearsal SOP。

## 14. 演练 3 元信息

- 演练日期：`2026-04-21`
- 演练环境：生产备份恢复库
- 数据库：`postgresql://postgres:postgres@localhost:5432/vaultbot_prod_rehearsal_20260421_162442`
- 分支：`codex-simplify-single-owner`
- 执行人：Codex
- 备份来源：`/root/vaultbot/backups/prod_db_backup_20260421_162442.dump`
- 演练范围：阶段 A P0 表

## 15. 演练 3 执行内容

本轮做了真正接近生产数据的复演：

1. 在生产机 `72.60.208.20` 上确认备份现状
2. 发现项目目录内原有数据库 SQL 备份主要停留在 `2026-04-14` / `2026-04-15`
3. 新生成一份生产数据库自定义格式备份：
   - `/root/vaultbot/backups/prod_db_backup_20260421_162442.dump`
4. 将该备份下载到本地
5. 恢复成独立本地 rehearsal 库 `vaultbot_prod_rehearsal_20260421_162442`
6. 在该恢复库上执行 A1 migration
7. 在该恢复库上执行 A2 backfill
8. 执行 `preflight:project`、`build`、`test`

## 16. 演练 3 基线盘点结果

这次复演首次拿到了更接近真实生产的数据事实：

- 恢复库中的 `Tenant` 数量：`2`
- 当前生产 `.env` 命中的 `TENANT_CODE`：`vault`
- 两个 tenant 分别是：
  - `prod`
  - `vault`

关键分布：

- `Asset`
  - `vault`: `611`
  - `prod`: `225`
- `Event`
  - `vault`: `95205`
  - `prod`: `17691`
- `TenantUser`
  - `vault`: `2864`
  - `prod`: `388`
- `UploadBatch`
  - `vault`: `611`
  - `prod`: `225`
- `TenantSetting`
  - `vault`: `8`
  - `prod`: `8`
- `Broadcast`
  - `vault`: `1`

这说明：

- 生产数据现实不是“只有 1 个 tenant”
- 当前运行时确实固定命中 `vault`
- `prod` 仍然是数据库中的真实历史 tenant，不应在阶段 A/B 设计中被忽略

## 17. 演练 3 结果

### 17.1 A1 Migration

结果：通过

### 17.2 A2 Backfill

结果：通过

### 17.3 缺失值检查

结果：全部通过

以下表的 `missingProjectId` 均为 `0`：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

### 17.4 一致性检查

结果：全部通过

以下表的 `mismatchCount` 均为 `0`：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

### 17.5 应用级验证

结果：通过

已验证：

- `preflight:project` 通过
- `build` 通过
- `test` 通过，结果为 `102/102 passed`

同时，`preflight:project` 在恢复库上命中的当前项目是：

- `vault | assets=611 events=95205 users=2864 batches=611`

## 18. 演练 3 新发现

这次复演新增了两个关键结论：

### 18.1 阶段 A 的 P0 方案在生产备份恢复库上也能跑通

这说明当前的 P0 设计不只是本地样本成立，而是已经通过了更接近生产数据的验证。

### 18.2 “生产只有 1 个 tenant”这个前提不成立

这会直接影响后续阶段判断：

- 阶段 A 仍然成立，因为它只是新增 `projectId` 并令其等于当前行的 `tenantId`
- 但阶段 B 以后，不能再简单按“物理单项目态”设计
- 后续任何双写、切读、清旧表方案，都必须明确：
  - 是围绕“当前运行 tenant = vault”推进
  - 还是要兼顾数据库中的 `prod` 历史数据

## 19. 当前结论

截至当前，阶段 A 已完成三轮正向验证：

1. 本地当前库直接演练通过
2. 独立 shadow 库从“回退到 pre-A1 状态后重跑”也通过
3. 生产备份恢复库复演也通过

因此，当前可以更有把握地判断：

- 阶段 A 的 P0 方案不是偶然通过
- A1/A2 至少在三轮环境里都可重复执行
- 当前没有发现 P0 级别的结构设计阻塞
- 但生产数据库现实仍然是“多 tenant 兼容内核”，不能误判为物理单项目态

## 20. 建议的下一步

最合理的后续顺序是：

1. 立即开始阶段 B 设计，但前提改为：
   - 运行命中 `vault`
   - 数据库内仍存在 `prod`
2. 阶段 B 首先要回答：
   - 双写是否只覆盖当前运行 tenant
   - 历史 `prod` 数据如何保持可读
   - 哪些表可以先切读，哪些仍要保留 tenant 兼容查询
3. 在阶段 B 设计完成前，不建议进入任何清旧字段/旧表动作

一句话结论：

阶段 A 的 P0 方案已经从“设计可行”推进到了“本地、独立 shadow、生产备份恢复库三轮复演可行”，下一步不该直接上生产清理，而应该基于“当前运行 tenant = vault、库内仍有 prod”的真实前提进入阶段 B 设计。
