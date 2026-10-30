#!/bin/bash
# يجهّز مشروع الفيديو (Remotion) تلقائيًا في بداية كل جلسة سحابية.
# باقي أدوات الذكاء الاصطناعي تنزل عند الحاجة: video/tools/install.sh <اسم>
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}/video"

# Run the install only if a listed file has changed since the install last succeeded
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  # Delete the old hashes first, so a failed install runs again next time
  rm -f "$hashes"

  npm install --no-audit --no-fund

  sha256sum ../.claude/hooks/session-start.sh package.json package-lock.json 2>/dev/null > "$hashes" || rm -f "$hashes"
fi
