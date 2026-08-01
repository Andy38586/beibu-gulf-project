#!/usr/bin/env bash
# d044: git 历史清理脚本（users.json 明文测试/探针账号）
#
# ⚠️ 不可逆操作！执行前必须：
#   1. git clone --mirror <repo-url> backup.git  （完整备份）
#   2. 通知所有协作者（rewrite 后需重新 clone）
#   3. 确认 CI/CD 无硬编码旧 commit hash
#
# 用法（确认上述前置后手动执行）：
#   bash tools/git-clean-history.sh
#
# 依赖：pip install git-filter-repo

set -euo pipefail

echo "=== d044: git 历史清理 ==="
echo "目标：从全部历史中移除 backend/data/users.json 的明文账号痕迹"
echo ""

# 前置检查
if ! command -v git-filter-repo &> /dev/null; then
  echo "❌ 未安装 git-filter-repo，请先执行: pip install git-filter-repo"
  exit 1
fi

if [ ! -d ".git" ]; then
  echo "❌ 当前目录非 git 仓库根目录"
  exit 1
fi

# 确认用户意图
read -p "⚠️  此操作将重写 git 历史且不可逆。已做好 mirror 备份？(yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "已取消。"
  exit 0
fi

# 执行清理
echo "→ 正在从历史中移除 backend/data/users.json ..."
git filter-repo --path backend/data/users.json --invert-paths --force

echo ""
echo "✅ 清理完成。后续步骤："
echo "  1. git remote add origin <repo-url>"
echo "  2. git push --force --all"
echo "  3. git push --force --tags"
echo "  4. 通知协作者重新 clone"
echo "  5. 到 GitHub/GitLab 设置中触发 GC（或等待自动 GC）"
