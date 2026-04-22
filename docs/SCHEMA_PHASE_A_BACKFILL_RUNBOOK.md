# Schema 阶段 A Backfill Runbook

## 1. 文档定位

本文档用于说明如何在影子环境中使用 [schema-phase-a-backfill.sql](/E:/MU/chucun/scripts/schema-phase-a-backfill.sql)。

它承接：

- [SCHEMA_PHASE_A_MIGRATION_DRAFT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_MIGRATION_DRAFT.md)
- [SCHEMA_PHASE_A_SHADOW_CHECKLIST.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_SHADOW_CHECKLIST.md)

## 2. 前置条件

- 已完成 A1 migration
- P0 表都已存在可空 `projectId`
- 当前环境是影子库，不是生产库
- 已准备好影子环境回滚方式

## 3. 执行顺序

1. 先运行 [schema-phase-a-backfill.sql](/E:/MU/chucun/scripts/schema-phase-a-backfill.sql) 的 pre-check 结果
2. 确认缺失量与盘点预期一致
3. 执行同一脚本中的 backfill 更新
4. 检查 post-check 结果是否全部为 `0`
5. 检查 consistency 结果是否全部为 `0`
6. 抽检脚本末尾的样本输出
7. 再次执行同一脚本，确认可重复执行

## 4. 通过标准

- 所有 `missing_project_id = 0`
- 所有 `mismatch_count = 0`
- 第二次执行结果与第一次一致
- 影子环境应用级验证通过

## 5. 停止线

出现以下任一情况，立即停止：

- 发现误连生产库
- 任一表 backfill 后仍存在 `projectId is null`
- 任一表存在 `projectId is distinct from tenantId`
- 第二次执行结果不一致
- 应用级验证失败

## 6. 结果记录模板

```md
## YYYY-MM-DD HH:mm - A2 Backfill 演练

- 环境：<shadow-db>
- 分支：<branch>
- commit：<commit>
- pre-check：通过 / 不通过
- backfill：通过 / 不通过
- post-check：通过 / 不通过
- consistency：通过 / 不通过
- repeat-run：通过 / 不通过
- 结论：可继续 / 需修正 / 停止推进
- 备注：...
```

## 7. 当前建议的下一步

这份 runbook 之后，最合理的下一步是：

1. 把 A1 DDL 草案压成真正的 Prisma migration 变更清单
2. 准备影子环境数据库来源
3. 再决定是否创建真实 migration 文件
