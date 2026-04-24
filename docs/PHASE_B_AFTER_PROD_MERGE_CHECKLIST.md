# Phase B 执行清单（Prod 归并到 Vault 后）

## 1. 文档定位

本文用于承接 `prod -> vault` 业务数据归并完成后的下一阶段工作。

它不是：

- 最终 schema 清理方案
- 直接删除 `Tenant*` / `tenantId` 的执行单
- 生产观察 runbook 的替代品

它是：

- 归并完成后，进入数据库与代码 Phase B 的执行清单
- 用于明确哪些事可以立即做，哪些要观察后再做，哪些当前仍禁止做

相关文档：

- [PROD_TO_VAULT_MERGE_RUNBOOK.md](/E:/MU/chucun/docs/PROD_TO_VAULT_MERGE_RUNBOOK.md)
- [PRODUCTION_OBSERVATION_RUNBOOK.md](/E:/MU/chucun/docs/PRODUCTION_OBSERVATION_RUNBOOK.md)
- [SCHEMA_PHASE_B_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_PHASE_B_DESIGN.md)
- [DETENANT_EXECUTION_MATRIX.md](/E:/MU/chucun/docs/DETENANT_EXECUTION_MATRIX.md)

## 2. 当前状态快照

截至本轮生产执行完成后，前提已经变化为：

- 当前运行 project/tenant code 命中的是 `vault`
- 历史 `prod` 业务数据已经归并到 `vault`
- `prod` 仍然作为空壳 `Tenant` 记录存在
- `/ops/project-check` 已显示：
  - `prod.assets = 0`
  - `prod.events = 0`
  - `prod.users = 0`
  - `prod.batches = 0`
- 生产 observation 即时检查已显示：
  - 最近写入只命中 `vault`
  - `recent_project_id_null_rows = 0`
  - `recent_project_tenant_mismatch_rows = 0`

因此，当前真实状态不再是：

- “库内存在两个都承载业务数据的 tenant”

而是：

- “库内存在一个有效业务项目 `vault`，以及一个待观察后删除的空壳 `prod`”

## 3. Phase B 的目标

归并完成后，Phase B 的目标应收敛为：

1. 固化“唯一有效运行 project = vault”的生产事实
2. 继续扩大 `project-first` 查询与装配覆盖
3. 继续收缩上层 `tenant` 语义扩散
4. 为后续 schema 清理准备更严格的前置条件

Phase B 当前仍然不是：

- 立即删除 `Tenant*`
- 立即删除全部 `tenantId`
- 立即做不可逆 schema 清理

## 4. 现在可以立即做的事

### P0-A 继续生产观察

必须先完成：

- `24h` 观察
- `72h` 观察

观察标准：

- 最近写入只分布在 `vault`
- `prod` 不再收到新业务写入
- `recent_project_id_null_rows = 0`
- `recent_project_tenant_mismatch_rows = 0`
- 旧 shareCode 可正常打开
- 上传 / 打开 / 搜索 / 推送 / worker 心跳正常

### P0-B 删除 prod 空壳前的准备

现在可以开始准备，但不要立即删：

- 记录 `prod` 当前剩余行数应为 `0` 的业务表清单
- 补一份“删除空壳前校验 SQL”
- 补一份“删除空壳后校验 SQL”
- 明确是否仍有任何运行态逻辑直接依赖 `Tenant(code='prod')`

### P1-A 继续低风险 project-first 收口

仍可继续推进：

- `project` wrapper consolidation
- service assembly cleanup
- worker / upload / discovery 的 project-first 命名与入口清理
- 不删除 fallback 的前提下，继续把上层调用切到 `project-*`

优先建议：

1. `project context` 包装层继续收口
2. `delivery-replica-selection.ts`
3. `worker/helpers.ts`
4. `worker/replication-scheduler.ts`
5. `worker/replication-worker.ts`
6. 诊断 / preflight / deploy 脚本改成 project-first

### P1-B 修正运维与脚本主语

这项现在值得优先做，因为生产事实已经收敛：

- `preflight-project.js` 不应再只是转发到 `preflight-tenant.js`
- `rebuild-tags.js` 应优先支持 `PROJECT_CODE`
- deploy / runbook / README 中的生产主语应从 “双 tenant 兼容期” 更新为 “单有效项目 + 空壳待删”

## 5. 观察后可以做的事

以下动作建议在 `24h / 72h` 观察通过后再做。

### P0-C 删除空壳 prod Tenant

前提：

- `prod` 业务表行数持续为 `0`
- `prod` 不再收到新事件、新设置写入、新心跳写入
- `/ops/project-check` 与 observation audit 连续通过

执行目标：

- 删除空壳 `prod` 的 `Tenant` 记录
- 确认所有分布型检查只剩 `vault`

### P1-C 提高数据库约束显性化

观察通过后可考虑：

- 为“单有效项目”前提增加更严格的巡检 SQL
- 增加“空壳 tenant 不允许再被写入”的预检查
- 评估是否需要对运行态脚本增加防误写保护

## 6. 当前仍然禁止做的事

即使 `prod` 已归并，也仍然禁止：

- 删除 `TenantMember`
- 删除 `TenantVaultBinding`
- 删除 `TenantTopic`
- 删除业务表中的 `tenantId`
- 删除 tenant fallback
- 做不可逆 schema 清理
- 在未完成观察前，把当前状态解释为“已经彻底去租户化”

原因：

- 代码和 schema 仍然广泛依赖 `tenantId`
- worker / upload / vault routing 仍然以 `Tenant*` 结构为真实底层
- 当前只是“数据面收敛”，不是“结构面收敛”

## 7. 推荐执行顺序

### 第一段：观察期内

1. 连续执行 `24h / 72h` observation audit
2. 修正 project-first 运维脚本与 runbook
3. 继续低风险 wrapper / service / worker 收口
4. 准备删除空壳 `prod` 的校验与执行脚本

### 第二段：观察通过后

1. 删除空壳 `prod` Tenant
2. 再次 observation
3. 更新状态文档与 execution matrix
4. 重新评估是否具备进入 schema cleanup design 的下一步

### 第三段：更后面

1. 仅在代码依赖明显下降后
2. 仅在 fallback 可控后
3. 再进入真正的 schema cleanup 评估

## 8. 当前最推荐的下一步

如果只选一个最有价值动作，建议是：

- 先完成 `24h` 观察记录

如果并行推进一个低风险代码方向，建议是：

- 统一 preflight / deploy / tags rebuild 的 project-first 入口

一句话结论：

- `prod -> vault` 归并已经把“两个业务 tenant 并存”的问题解决了
- 当前 Phase B 应从“兼容双业务租户”切换为“单有效项目 + 空壳待删 + 结构仍兼容”
- 真正的数据库去租户化，还需要继续观察和收口，不能立刻跳到最终清理
