#!/bin/bash
# git-health-check.sh — git 仓库健康检查（08-08 三次事故后建立）
# 用法：bash tools/git-health-check.sh
# 检查：①对象库完整性 ②refs/HEAD 解析 ③index.lock ④工作树 vs HEAD 一致性
# 任一项失败 = 停止操作，先报告（勿自行激进修复）

set -u
cd "$(dirname "$0")/.."
FAIL=0

echo "═══ git 健康检查 ═══"

# ① 对象库完整性
echo "[1/4] 对象库 fsck..."
if git fsck --full 2>&1 | grep -qiE "missing|bad object|broken"; then
  echo "  ❌ 对象库有缺失/损坏："
  git fsck --full 2>&1 | grep -iE "missing|bad object|broken" | head -5
  FAIL=1
else
  echo "  ✅ 对象库完整"
fi

# ② refs/HEAD 解析
echo "[2/4] refs 完整性..."
if [ ! -f .git/refs/heads/main ] && ! grep -q "refs/heads/main" .git/packed-refs 2>/dev/null; then
  echo "  ❌ refs/heads/main 不存在（refs/ 目录可能丢失）"
  FAIL=1
else
  HEAD_HASH=$(git rev-parse HEAD 2>&1)
  if [ "$HEAD_HASH" = "HEAD" ] || echo "$HEAD_HASH" | grep -q "unknown revision"; then
    echo "  ❌ HEAD 无法解析：$HEAD_HASH"
    FAIL=1
  else
    echo "  ✅ HEAD 可解析：${HEAD_HASH:0:8}"
  fi
fi

# ③ index.lock
echo "[3/4] index.lock..."
if [ -f .git/index.lock ]; then
  echo "  ❌ index.lock 存在（有 git 进程被杀/卡死残留）——先确认无 git 在跑再处理"
  FAIL=1
else
  echo "  ✅ 无 lock 残留"
fi

# ④ 工作树 vs HEAD（仅看有没有异常数量的修改——健康时除未跟踪外应为空或少量）
echo "[4/4] 工作树一致性..."
CHANGED=$(git status --short | grep -v "^??" | wc -l)
if [ "$CHANGED" -gt 20 ]; then
  echo "  ⚠️ 工作树有 $CHANGED 个改动（>20，检查是否预期）"
else
  echo "  ✅ 工作树干净（改动 $CHANGED 个）"
fi

echo "═══ 结果：$([ $FAIL -eq 0 ] && echo '✅ 健康，可继续操作' || echo '❌ 有问题，先报告勿激进修复') ═══"
exit $FAIL
