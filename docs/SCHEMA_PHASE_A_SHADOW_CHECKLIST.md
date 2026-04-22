# Schema 阶段 A 影子环境验证 Checklist

## 1. 文档定位

本文档用于承接：

- [SCHEMA_PHASE_A_MIGRATION_DRAFT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_MIGRATION_DRAFT.md)
- [SCHEMA_PHASE_A_FIELD_PLAN.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_FIELD_PLAN.md)

目标：

- 为阶段 A 的影子环境演练提供固定步骤
- 把 `A1 migration` 和 `A2 backfill` 的执行顺序写清楚
- 明确什么时候必须停止，不继续推进

它不是生产执行单。

## 2. 适用范围

适用：

- 本地影子库
- 生产备份恢复出来的验证库
- 单独克隆出的 staging / rehearsal 数据库

不适用：

- 直接生产执行
- 阶段 B 双写验证
- 破坏性 schema 清理

## 3. 执行原则

- 一次只验证阶段 A
- 先结构，后数据
- 每完成一步就记录结果
- 遇到高风险异常立即停止
- 默认不修改业务代码读路径

## 4. 验证前准备

### 4.1 环境准备

- 确认影子库来源已记录
- 确认影子库与生产库物理隔离
- 确认当前目标分支已记录
- 确认当前 commit 已记录
- 确认 Prisma schema 基线已记录

### 4.2 数据准备

- 确认已完成一轮盘点
- 确认 `Tenant` 数量已知
- 确认关键业务表 `tenantId` 分布已知
- 确认异常数据已知

### 4.3 风险准备

- 确认影子库允许回退
- 确认 drop 字段 / drop index 回滚方案已准备
- 确认不会误连到生产 `DATABASE_URL`

## 5. A1 Migration 验证

### 5.1 执行目标

验证 P0 表新增 `projectId`、新增索引/唯一约束是否可顺利落地。

### 5.2 执行步骤

1. 在影子环境执行阶段 A 的 DDL 草案
2. 检查所有 P0 表是否成功新增 `projectId`
3. 检查所有新索引/唯一约束是否创建成功
4. 不执行任何主读路径切换

### 5.3 必查项

- `TenantUser.projectId`
- `Asset.projectId`
- `Collection.projectId`
- `Event.projectId`
- `UploadBatch.projectId`
- `UserPreference.projectId`
- `TenantSetting.projectId`
- `Broadcast.projectId`

### 5.4 通过标准

- 所有目标表都新增了 `projectId`
- 所有目标索引/唯一约束都创建成功
- 无锁死、无中断、无约束冲突

### 5.5 失败即停止项

- 任一新增字段失败
- 任一新增唯一约束失败
- DDL 执行时间异常长
- 发现与生产不一致的意外 schema 差异

## 6. A2 Backfill 验证

### 6.1 执行目标

验证 `projectId = tenantId` 的 backfill 是否可重复执行，并保持一致性。

### 6.2 推荐执行顺序

1. 执行基础 backfill SQL
2. 执行缺失检查 SQL
3. 执行一致性检查 SQL
4. 再次执行同一份 backfill SQL
5. 再次执行缺失检查与一致性检查

### 6.3 预期结果

- 第一次 backfill 后，目标表 `projectId` 不再为 `NULL`
- 第二次 backfill 不应产生额外行为变化
- 所有目标表应满足 `projectId = tenantId`

### 6.4 必查 SQL 结果

- `missing_project_id = 0`
- `mismatch_count = 0`

### 6.5 失败即停止项

- 任一表存在 `projectId is null`
- 任一表存在 `projectId is distinct from tenantId`
- 第二次 backfill 结果与第一次不一致
- 出现唯一约束冲突

## 7. 数据级抽检

完成 A1/A2 后，建议抽检以下数据：

- 一条 `TenantSetting`
- 一条 `TenantUser`
- 一条 `Asset`
- 一条 `Collection`
- 一条 `UploadBatch`
- 一条 `Broadcast`

抽检内容：

- `tenantId`
- `projectId`
- 关键业务字段是否保留
- 新索引相关字段是否符合预期

通过标准：

- 样本记录的 `projectId` 与 `tenantId` 一致
- 原记录未被破坏

## 8. 应用级验证

在影子环境连接到修改后的 schema，但仍保持旧读路径的前提下，至少验证：

- `npm run test`
- `npm run build`
- `npm run preflight:project`

如果影子环境可启动服务，再补充：

- `/ops/project-check`
- 设置读取
- 资产打开
- 上传批次查询
- 推送草稿查询

通过标准：

- 应用可正常工作
- 旧读路径不受新增字段影响

## 9. 停止线

出现以下任一情况，必须停止，不进入下一步：

- A1 migration 失败
- A2 backfill 不可重复
- 新唯一约束出现冲突
- 应用级验证失败
- 发现影子环境数据与盘点结果明显不一致

## 10. 结果记录模板

建议按下面模板记录每次演练：

```md
## YYYY-MM-DD HH:mm - Schema 阶段 A 影子验证

- 环境：<shadow-db>
- 分支：<branch>
- commit：<commit>
- 执行人：<name>
- A1 migration：通过 / 不通过
- A2 backfill：通过 / 不通过
- 缺失检查：通过 / 不通过
- 一致性检查：通过 / 不通过
- 应用级验证：通过 / 不通过
- 结论：可继续 / 需修正后重试 / 停止推进
- 备注：...
```

## 11. 当前建议的下一步

在这份 checklist 之后，最合理的后续是：

1. 把 A2 backfill SQL 单独整理成脚本草案
2. 把 A1 DDL 草案压成 Prisma migration 变更清单
3. 真正执行前，先确认影子库来源和回滚路径

一句话结论：

阶段 A 的正确推进方式不是“先改 schema 再说”，而是“先在影子环境证明新增字段、索引和 backfill 都稳定可重复”。 
