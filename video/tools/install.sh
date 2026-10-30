#!/bin/bash
# ينزّل أدوات الفيديو بالذكاء الاصطناعي عند الحاجة (خارج المستودع، في ~/video-tools).
# الاستخدام:  video/tools/install.sh <اسم> [<اسم> ...]   أو   video/tools/install.sh list
set -euo pipefail

DEST="${VIDEO_TOOLS_DIR:-$HOME/video-tools}"
mkdir -p "$DEST"
# أغلب هذي الأدوات تبي Python 3.11؛ uv يجيب النسخة المناسبة بدون ما نلمس نسخة النظام
PY=3.11
command -v uv >/dev/null || pip install -q uv
venv() { uv venv -q --allow-existing --python "$PY" "$1/.venv"; }
pipi() { local d="$1"; shift; VIRTUAL_ENV="$d/.venv" uv pip install -q "$@"; }

# الاسم | المستودع | ملاحظة
TOOLS="
comfyui|Comfy-Org/ComfyUI|توليد صور وفيديو — يحتاج كرت شاشة (GPU) عشان يكون عملي
moneyprinter|harry0703/MoneyPrinterTurbo|فيديو كامل من موضوع — يحتاج مفتاح LLM ومفتاح Pexels
hyperframes|heygen-com/hyperframes|فيديو من HTML
postiz|gitroomhq/postiz-app|جدولة النشر في السوشال — يحتاج Docker وقاعدة بيانات
whisperx|m-bain/whisperX|تفريغ الكلام لنص بتوقيت دقيق
pyvideotrans|jianchang512/pyvideotrans|ترجمة ودبلجة الفيديو
opencreator|krillinai/OpenCreator|ترجمة ودبلجة وقص — يحتاج مفاتيح API
narratoai|linyqh/NarratoAI|تعليق صوتي وتلخيص فيديو — يحتاج مفتاح LLM
openshorts|mutonby/openshorts|قص فيديو طويل لمقاطع قصيرة
"

list() {
  echo "$TOOLS" | while IFS='|' read -r name repo note; do
    [ -z "$name" ] && continue
    state="—"; [ -d "$DEST/$name" ] && state="✓ مثبّت"
    printf "%-13s %-28s %-10s %s\n" "$name" "$repo" "$state" "$note"
  done
}

install_one() {
  local name="$1" line repo dir
  line=$(echo "$TOOLS" | grep "^$name|" || true)
  [ -z "$line" ] && { echo "ما أعرف أداة اسمها: $name"; list; exit 1; }
  repo=$(echo "$line" | cut -d'|' -f2)
  dir="$DEST/$name"

  if [ ! -d "$dir/.git" ]; then
    echo "==> تنزيل $repo"
    git clone --depth 1 "https://github.com/$repo" "$dir"
  else
    echo "==> $name موجود، تحديث"
    git -C "$dir" pull --ff-only || true
  fi

  case "$name" in
    whisperx)
      # نسخة PyTorch للمعالج (CPU) أخف بكثير من نسخة CUDA
      venv "$dir"
      pipi "$dir" torch torchaudio --index-url https://download.pytorch.org/whl/cpu
      pipi "$dir" -e "$dir"
      ;;
    hyperframes|postiz)
      (cd "$dir" && { command -v pnpm >/dev/null || npm install -g pnpm >/dev/null; } && pnpm install)
      ;;
    *)
      if [ -f "$dir/requirements.txt" ]; then
        venv "$dir"
        pipi "$dir" -r "$dir/requirements.txt"
      elif [ -f "$dir/pyproject.toml" ]; then
        venv "$dir"
        pipi "$dir" -e "$dir"
      elif [ -f "$dir/package.json" ]; then
        (cd "$dir" && npm install)
      fi
      ;;
  esac
  echo "==> $name جاهز في $dir"
}

case "${1:-list}" in
  list|"") list ;;
  all) for n in $(echo "$TOOLS" | cut -d'|' -f1); do install_one "$n"; done ;;
  *) for n in "$@"; do install_one "$n"; done ;;
esac
