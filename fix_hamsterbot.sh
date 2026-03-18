#!/bin/bash
# HamsterBot 生产环境问题诊断和修复脚本

set -e

echo "=========================================="
echo "HamsterBot 生产环境问题诊断"
echo "=========================================="
echo ""

# 连接信息
SERVER="root@72.60.208.20"
PROJECT_PATH="/root/hamsterbot"

echo "🔍 问题诊断结果："
echo ""
echo "1. ❌ 数据库表结构不匹配"
echo "   - 问题：broadcast_queue 表缺少 user_id 列"
echo "   - 现状：数据库表使用 telegram_id，代码模型使用 user_id"
echo "   - 影响：Celery Worker 无法处理广播任务"
echo ""
echo "2. ⚠️  Telegram API 限流"
echo "   - 问题：Flood control exceeded"
echo "   - 原因：用户操作过于频繁触发 Telegram 限流"
echo "   - 影响：Bot 暂时无法发送消息"
echo ""
echo "3. ⚠️  应用层限流"
echo "   - 问题：ResourceExhaustedError"
echo "   - 原因：用户 7905238869 触发应用层限流保护"
echo "   - 影响：该用户暂时无法使用某些功能"
echo ""

echo "=========================================="
echo "修复方案"
echo "=========================================="
echo ""

echo "方案 1: 修改数据库表结构（推荐）"
echo "----------------------------------------"
echo "将 broadcast_queue 表的 telegram_id 列重命名为 user_id"
echo ""
echo "SQL 命令："
cat << 'SQL'
ALTER TABLE broadcast_queue 
CHANGE COLUMN telegram_id user_id INT NULL;

-- 如果需要添加外键约束
ALTER TABLE broadcast_queue 
ADD CONSTRAINT fk_broadcast_queue_user 
FOREIGN KEY (user_id) REFERENCES user(id);
SQL
echo ""

echo "方案 2: 修改代码模型（备选）"
echo "----------------------------------------"
echo "将代码中的 user_id 改为 telegram_id"
echo ""

echo "=========================================="
echo "执行修复"
echo "=========================================="
echo ""

read -p "是否执行方案 1（修改数据库表结构）？(y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "正在连接到服务器..."
    
    # 生成修复 SQL
    cat > /tmp/fix_broadcast_queue.sql << 'EOF'
-- 检查当前表结构
DESCRIBE broadcast_queue;

-- 重命名列
ALTER TABLE broadcast_queue 
CHANGE COLUMN telegram_id user_id INT NULL;

-- 验证修改
DESCRIBE broadcast_queue;

-- 显示修复后的数据
SELECT COUNT(*) as total_records FROM broadcast_queue;
EOF

    echo "上传修复脚本到服务器..."
    scp /tmp/fix_broadcast_queue.sql $SERVER:$PROJECT_PATH/
    
    echo "执行数据库修复..."
    ssh $SERVER "cd $PROJECT_PATH && docker compose exec -T mysql mysql -uhamsterbot -p\$(grep MYSQL_PASSWORD .env | head -1 | cut -d= -f2) hamsterbot < fix_broadcast_queue.sql"
    
    echo ""
    echo "✅ 数据库修复完成！"
    echo ""
    echo "重启服务以应用更改..."
    ssh $SERVER "cd $PROJECT_PATH && docker compose restart celery-worker celery-beat"
    
    echo ""
    echo "✅ 服务已重启！"
    echo ""
    echo "查看日志确认修复："
    echo "  ssh $SERVER 'cd $PROJECT_PATH && docker compose logs -f celery-worker'"
    
else
    echo "取消修复操作"
fi

echo ""
echo "=========================================="
echo "其他建议"
echo "=========================================="
echo ""
echo "1. 监控 Telegram API 限流"
echo "   - 减少消息发送频率"
echo "   - 实现消息队列和延迟发送"
echo ""
echo "2. 调整应用层限流配置"
echo "   - 检查 error_handler.py 中的限流参数"
echo "   - 根据实际情况调整阈值"
echo ""
echo "3. 定期检查日志"
echo "   - docker compose logs -f bot"
echo "   - docker compose logs -f celery-worker"
echo ""

