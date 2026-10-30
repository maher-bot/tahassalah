#!/bin/bash
# يجهّز مشروع الفيديو (Remotion + أداة الصوت) تلقائيًا في بداية كل جلسة سحابية.
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

# أداة التعليق الصوتي (edge-tts) في .venv
pyhashes=.venv/.session-start.sha256
if ! sha256sum --check --status "$pyhashes" 2>/dev/null; then
  rm -f "$pyhashes"
  command -v uv >/dev/null || pip install -q uv
  uv venv -q --allow-existing --python 3.11 .venv
  VIRTUAL_ENV=.venv uv pip install -q -r tools/requirements.txt
  sha256sum ../.claude/hooks/session-start.sh tools/requirements.txt > "$pyhashes" || rm -f "$pyhashes"
fi
