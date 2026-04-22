# Schema 阶段 A 生产备份复演 SOP

## 1. 目标

这份 SOP 用于指导“第三次、更接近生产数据的阶段 A 复演”。

它的目标不是直接改生产库，而是：

- 用生产备份恢复出的影子库做一次完整复演
- 验证 A1 migration 与 A2 backfill 在更接近真实数据规模下是否仍然稳定
- 补齐执行耗时、异常数据、恢复链路稳定性等信息

## 2. 前提

开始前应满足：

- 阶段 A 文档链已完成
- 本地当前库演练已通过
- 独立 shadow 库复演已通过
- 已有可用的生产数据库备份
- 备份恢复动作不会影响当前生产实例

建议先阅读：

- [SCHEMA_PHASE_A_REHEARSAL_RESULT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_REHEARSAL_RESULT.md)
- [SCHEMA_PHASE_A_SHADOW_CHECKLIST.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_SHADOW_CHECKLIST.md)
- [SCHEMA_PHASE_A_BACKFILL_RUNBOOK.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_BACKFILL_RUNBOOK.md)

## 3. 适用环境

适用：

- 生产备份恢复出的本地库
- 生产备份恢复出的 staging / rehearsal 库
- 与生产物理隔离的演练库

不适用：

- 当前生产库
- 尚未隔离的共享测试库

## 4. 推荐恢复方式

基于第二次复演的结果，推荐固定使用：

1. `pg_dump -Fc`
2. `pg_restore`

不推荐默认使用：

- `pg_dump | psql`

原因：

- 管道恢复方式在第二次复演里暴露出约束恢复不稳定
- 自定义格式 + `pg_restore` 更适合后续重复演练

## 5. 执行步骤

### 5.1 备份恢复

1. 记录生产备份文件名、时间、来源
2. 创建新的影子数据库
3. 用 `pg_restore` 把生产备份恢复到该影子库
4. 恢复完成后先不做任何 schema 变更

### 5.2 恢复后盘点

1. 运行一轮基础盘点
2. 至少确认：
   - `Tenant` 数量
   - `TenantUser` 记录数
   - `TenantSetting` 记录数
   - `Asset` / `Event` / `UploadBatch` / `Broadcast` 记录数
   - 是否存在明显脏数据
3. 如发现与预期差异很大，先停，不进入阶段 A

### 5.3 执行 A1

1. 执行 [migration.sql](/E:/MU/chucun/prisma/migrations/20260421090000_add_project_id_phase_a_p0/migration.sql)
2. 记录执行开始时间与结束时间
3. 记录：
   - 是否报错
   - 是否存在锁等待
   - 哪张表最慢

### 5.4 执行 A2

1. 执行 [schema-phase-a-backfill.sql](/E:/MU/chucun/scripts/schema-phase-a-backfill.sql)
2. 记录执行开始时间与结束时间
3. 记录：
   - pre-check 结果
   - post-check 结果
   - consistency 结果
   - 第二次重复执行结果

### 5.5 应用级验证

恢复库完成 A1/A2 后，至少验证：

- `npm run preflight:project`
- `npm run build`
- `npm run test`

如果环境允许，再补充：

- `/ops/project-check`
- 设置读取
- 资产打开
- 上传批次读取
- 推送草稿读取

## 6. 重点观察项

这次复演与前两次不同，重点不再只是“能不能跑通”，而是：

- `TenantUser` 是否有非空样本
- 更接近生产规模下，A1/A2 的执行耗时
- 新唯一约束是否遇到冲突
- `pg_restore` 后是否存在编码或约束恢复异常
- 是否出现意外的第二项目或跨 tenant 分裂

## 7. 停止线

出现以下任一情况，立即停止，不继续推进：

- 误连生产库
- 生产备份恢复本身失败
- 盘点结果与预期严重不一致
- A1 migration 报错
- A2 backfill 后仍存在 `projectId is null`
- 存在 `projectId is distinct from tenantId`
- 唯一约束冲突
- 应用级验证失败

## 8. 结果记录模板

建议按下面模板记录：

```md
## YYYY-MM-DD HH:mm - 生产备份复演

- 影子库：<db-name>
- 备份来源：<backup-file>
- 分支：<branch>
- commit：<commit>
- 恢复方式：pg_restore / other
- 基础盘点：通过 / 不通过
- A1 migration：通过 / 不通过
- A1 耗时：<duration>
- A2 backfill：通过 / 不通过
- A2 耗时：<duration>
- repeat-run：通过 / 不通过
- 应用级验证：通过 / 不通过
- 关键异常：...
- 结论：可继续 / 需修正 / 停止推进
```

## 9. 通过标准

只有满足以下条件，才能认为第三次复演通过：

- 生产备份恢复成功
- A1 migration 成功
- A2 backfill 成功
- `missingProjectId = 0`
- `mismatchCount = 0`
- 应用级验证通过
- 未发现新的 P0 级阻塞问题

## 10. 当前建议

第三次复演通过后，才建议进入下一步：

1. 开始阶段 B 设计
2. 仍然不直接进生产
3. 先把双写/切读方案写清楚，再决定是否继续

一句话结论：

这份 SOP 的目的不是“推动上线”，而是“用最接近生产的数据，再证明一次阶段 A 方案可重复、可回退、可解释”。 
