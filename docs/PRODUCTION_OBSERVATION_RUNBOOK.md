# 生产观察期 Runbook

## 1. 目标

这份 runbook 用于在生产库完成 Phase A backfill 后，持续观察：

- 新写入是否继续双写到 `projectId`
- 新写入是否继续满足 `projectId = tenantId`
- 当前运行主路径是否仍稳定命中预期 project

它不是一次性的 backfill 文档，而是 backfill 完成后的稳定性观察模板。

## 2. 适用场景

适用：

- 生产库已完成 Phase A backfill
- 当前代码已经处于 `project-first + tenant fallback` 兼容期
- 需要在未来几天持续确认新写入没有漂移

不适用：

- 尚未完成 `projectId` 回填的环境
- 破坏性 schema 清理执行前的最终割接

## 3. 推荐观察窗口

建议至少观察：

- 发布后 `24` 小时
- 发布后 `72` 小时
- 第一周结束时

如果中间有再次部署或配置变更，建议重新开始观察窗口。

## 4. 执行文件

使用：

- [project-observation-audit.sql](/E:/MU/chucun/scripts/project-observation-audit.sql)

建议在生产机执行：

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/project-observation-audit.sql
```

## 5. 重点检查项

### 5.1 最近 24 小时写入

关注这些表：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

核心判断：

- `recent_project_id_null_rows = 0`
- `recent_project_tenant_mismatch_rows = 0`

### 5.2 最近 24 小时 project 分布

重点看：

- `Asset.recent project distribution`
- `UploadBatch.recent project distribution`
- `Event.recent project distribution`
- `TenantUser.recent project distribution`

目标不是强行要求只有一个 project，而是确认：

- 当前新增写入的 project 分布符合预期
- 没有出现异常新 project
- 没有写到错误 tenant/project

### 5.3 样本抽查

抽查：

- `TenantSetting recent sample`
- `TenantUser recent sample`
- `Asset recent sample`
- `UploadBatch recent sample`
- `Event recent sample`

检查是否满足：

- `projectId` 非空
- `projectId = tenantId`
- 样本记录归属合理

## 6. 通过标准

满足以下条件，才可认为观察期通过：

- 所有目标表 `recent_project_id_null_rows = 0`
- 所有目标表 `recent_project_tenant_mismatch_rows = 0`
- 没有出现异常 project 分布
- 业务人工验收链路仍正常

## 7. 停止线

出现以下任一情况，停止继续推进数据库清理：

- 最近写入再次出现 `projectId is null`
- 最近写入出现 `projectId <> tenantId`
- 出现未知 project / tenant 分布
- `/ops/project-check` 命中异常 project
- 用户侧出现“设置像被重置”“新上传打不开”“广播异常”等现象

## 8. 结果记录模板

```md
## YYYY-MM-DD HH:mm - 生产观察巡检

- 环境：production
- 版本：<commit>
- 观察窗口：24h / 72h / 7d
- recent projectId null：通过 / 不通过
- recent projectId mismatch：通过 / 不通过
- project 分布：正常 / 异常
- 业务人工验收：通过 / 不通过
- 结论：继续观察 / 可以进入下一阶段 / 停止推进
- 备注：...
```

## 9. 下一阶段建议

只有当这份观察期巡检连续通过后，才建议进入：

- 更大范围的 `project-first` 读路径收口
- schema 物理清理前的最终评估

在观察期没有通过前，不建议：

- 删除 `Tenant*`
- 删除业务表中的 `tenantId`
- 去掉 tenant fallback
