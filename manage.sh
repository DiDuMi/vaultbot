#!/bin/bash
# VaultBot 生产环境快速管理脚本
# 使用方法: ./manage.sh [command]

PROJECT_DIR="/root/vaultbot"

case "$1" in
  status)
    echo "=== VaultBot 服务状态 ==="
    cd $PROJECT_DIR && docker compose ps
    ;;
    
  logs)
    echo "=== VaultBot 实时日志 ==="
    cd $PROJECT_DIR && docker compose logs -f
    ;;
    
  logs-app)
    echo "=== VaultBot App 日志 ==="
    cd $PROJECT_DIR && docker compose logs -f app
    ;;
    
  logs-worker)
    echo "=== VaultBot Worker 日志 ==="
    cd $PROJECT_DIR && docker compose logs -f worker
    ;;
    
  restart)
    echo "=== 重启 VaultBot 服务 ==="
    cd $PROJECT_DIR && docker compose restart
    echo "✅ 服务已重启"
    ;;
    
  restart-app)
    echo "=== 重启 VaultBot App ==="
    cd $PROJECT_DIR && docker compose restart app
    echo "✅ App 已重启"
    ;;
    
  restart-worker)
    echo "=== 重启 VaultBot Worker ==="
    cd $PROJECT_DIR && docker compose restart worker
    echo "✅ Worker 已重启"
    ;;
    
  stop)
    echo "=== 停止 VaultBot 服务 ==="
    cd $PROJECT_DIR && docker compose down
    echo "✅ 服务已停止"
    ;;
    
  start)
    echo "=== 启动 VaultBot 服务 ==="
    cd $PROJECT_DIR && docker compose up -d
    echo "✅ 服务已启动"
    ;;
    
  update)
    echo "=== 更新 VaultBot ==="
    cd $PROJECT_DIR
    echo "1. 拉取最新代码..."
    git pull
    if command -v node >/dev/null 2>&1 && [ -f "scripts/preflight-tenant.js" ] && [ -d "node_modules/@prisma/client" ]; then
      echo "2. 执行租户一致性预检..."
      node scripts/preflight-tenant.js
      echo "3. 重新构建并启动..."
    else
      echo "2. 重新构建并启动..."
    fi
    docker compose up -d --build
    echo "✅ 更新完成"
    ;;
    
  backup-db)
    echo "=== 备份数据库 ==="
    BACKUP_FILE="$PROJECT_DIR/backup_$(date +%Y%m%d_%H%M%S).sql"
    cd $PROJECT_DIR && docker compose exec -T postgres pg_dump -U vaultbot vaultbot > $BACKUP_FILE
    echo "✅ 数据库已备份到: $BACKUP_FILE"
    ;;
    
  *)
    echo "VaultBot 生产环境管理脚本"
    echo ""
    echo "使用方法: $0 [command]"
    echo ""
    echo "可用命令:"
    echo "  status        - 查看服务状态"
    echo "  logs          - 查看所有日志"
    echo "  logs-app      - 查看 App 日志"
    echo "  logs-worker   - 查看 Worker 日志"
    echo "  restart       - 重启所有服务"
    echo "  restart-app   - 重启 App"
    echo "  restart-worker- 重启 Worker"
    echo "  stop          - 停止服务"
    echo "  start         - 启动服务"
    echo "  update        - 更新部署"
    echo "  backup-db     - 备份数据库"
    echo ""
    ;;
esac

