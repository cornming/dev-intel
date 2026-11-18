#!/usr/bin/env bash
# 給「排程任務」用：把 analysis.json 發布到 ai-analysis 分支（網站直接從那裡讀）。
# 用法：bash scripts/ai-publish.sh /tmp/ai/analysis.json
# 只更新那一個檔案，不碰 main；分支不存在時會自動建立。
set -euo pipefail
SRC="${1:?用法: ai-publish.sh <analysis.json>}"
REPO_URL="${REPO_URL:-https://github.com/cornming/dev-intel}"
BRANCH=ai-analysis
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d,dict) and d.get('generatedAt')" "$SRC"

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
cd "$W"
if git ls-remote --exit-code --heads "$REPO_URL" "$BRANCH" >/dev/null 2>&1; then
  git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" repo; cd repo
else
  git clone -q --depth 1 "$REPO_URL" repo; cd repo
  git checkout -q --orphan "$BRANCH"; git rm -rfq .
fi
cp "$SRC" analysis.json
git add analysis.json
if git diff --cached --quiet; then echo "沒有變更，略過。"; exit 0; fi
git -c user.name="dev-intel-ai" -c user.email="noreply@users.noreply.github.com" commit -q -m "chore(ai): 今日重點 $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M') (台北)"
git push -q -u origin "$BRANCH"
echo "已發布到分支 $BRANCH"
