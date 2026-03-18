# 开发计划（Tenant Bot 单入口）

## 1. 目标与范围
- 仅实现租户 Bot 单入口模式
- 完成“上传 → 保存 → 交付”的最小闭环
- 不包含门户 Bot 能力

## 2. 最小闭环交付范围
- 上传批次：收集多条媒体并进入“待保存”
- 保存决策：完成保存/取消保存
- 存储与副本：copyMessage 写入 Vault Group 话题并落库 Replica
- 交付：用户打开请求后校验权限并交付内容

## 3. 目录与职责落位
- bot/tenant：交互入口、命令与回调路由、状态编排
- services/use-cases：上传编排、权限校验、交付选择
- core/domain：Asset、Replica、Permission 最小模型
- infra/telegram：copyMessage 与交付能力适配
- infra/persistence：元数据落库与幂等
- worker：补副本与健康检查任务

## 4. 架构资产落位
- arch/components：组件关系与边界
- arch/flows：关键流程图（上传/交付/检索）
- arch/data-model：核心数据模型与关系
- arch/interfaces：Bot ↔ 服务与服务 ↔ 基础设施契约

## 5. 开发顺序
1) bot/tenant 上传与保存决策
2) services/use-cases 上传编排与交付选择
3) infra/telegram copyMessage 与交付适配
4) core/domain 与 infra/persistence 最小模型落库
5) worker 补副本与健康检查任务

## 6. 本地开发与部署

本地开发：
- 准备 PostgreSQL 与 Redis
- 配置环境变量（参考 `.env.example`）
- 启动：`npm run dev` 与 `npm run worker`

生产部署：
- 使用 `docker-compose.yml` 一键拉起依赖与进程
- 在服务器目录执行：`scripts/deploy-docker.sh /root/vaultbot`
