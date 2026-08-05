#!/usr/bin/env bash
set -euo pipefail

# Local self-hosted OCR service bootstrap and start script.
# It creates/updates a local venv, installs dependencies when needed,
# and runs the FastAPI app with uvicorn.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
REQ_FILE="$SCRIPT_DIR/requirements.txt"
REQ_HASH_FILE="$VENV_DIR/.requirements.sha256"
CHECK_ONLY="${1:-}"

log() {
  printf '[ocr-local] %s\n' "$1"
}

fail() {
  printf '[ocr-local] ERROR: %s\n' "$1" >&2
  exit 1
}

PYTHON_CANDIDATES=(python3.11 python3.10 python3)
PYTHON_CMD="${OCR_PYTHON_CMD:-}"

if [[ -n "$PYTHON_CMD" ]] && ! command -v "$PYTHON_CMD" >/dev/null 2>&1; then
  fail "OCR_PYTHON_CMD impostato ma non trovato: $PYTHON_CMD"
fi

if [[ -z "$PYTHON_CMD" ]]; then
  for candidate in "${PYTHON_CANDIDATES[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_CMD="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON_CMD" ]]; then
  fail "Nessun interprete Python trovato. Installa Python 3.x."
fi

PY_VER="$($PYTHON_CMD -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
log "Uso interprete Python $PYTHON_CMD (versione $PY_VER)"

if [[ ! -d "$VENV_DIR" ]]; then
  log "Creo virtualenv in $VENV_DIR"
  "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

if [[ -x "$VENV_DIR/bin/python" ]]; then
  VENV_PY_VER="$($VENV_DIR/bin/python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ "$VENV_PY_VER" != "$PY_VER" ]]; then
    log "Ricreo virtualenv: versione corrente $VENV_PY_VER, richiesta $PY_VER"
    rm -rf "$VENV_DIR"
    "$PYTHON_CMD" -m venv "$VENV_DIR"
  fi
fi

PIP_BIN="$VENV_DIR/bin/pip"
PYTHON_BIN="$VENV_DIR/bin/python"

if [[ ! -x "$PIP_BIN" || ! -x "$PYTHON_BIN" ]]; then
  fail "Virtualenv non valido in $VENV_DIR. Elimina la cartella e rilancia."
fi

# Folder renames can leave stale shebang paths inside the venv scripts.
if ! "$PYTHON_BIN" -c 'import sys; print(sys.version)' >/dev/null 2>&1 || ! "$PIP_BIN" --version >/dev/null 2>&1; then
  log "Virtualenv non eseguibile (possibile path obsoleto). Ricreo $VENV_DIR"
  rm -rf "$VENV_DIR"
  "$PYTHON_CMD" -m venv "$VENV_DIR"
  PIP_BIN="$VENV_DIR/bin/pip"
  PYTHON_BIN="$VENV_DIR/bin/python"
fi

REQ_HASH="$(sha256sum "$REQ_FILE" | awk '{print $1}')"
NEED_INSTALL="true"

if [[ -f "$REQ_HASH_FILE" ]]; then
  INSTALLED_HASH="$(cat "$REQ_HASH_FILE")"
  if [[ "$INSTALLED_HASH" == "$REQ_HASH" ]]; then
    NEED_INSTALL="false"
  fi
fi

if [[ "$NEED_INSTALL" == "true" ]]; then
  log "Aggiorno pip e installo dipendenze Python"
  "$PIP_BIN" install --upgrade pip
  if ! "$PIP_BIN" install -r "$REQ_FILE"; then
    fail "Install dipendenze fallita. Verifica toolchain Python e compatibilita wheel PaddlePaddle per la tua architettura."
  fi

  # Best effort: try enabling PaddleOCR when wheels are available for current Python.
  # If this step fails, OCR service still works with pytesseract fallback.
  if [[ "${OCR_SKIP_OPTIONAL_PADDLE:-false}" != "true" ]]; then
    log "Provo install opzionale PaddleOCR (fallback automatico se non disponibile)"
    if ! "$PIP_BIN" install paddleocr paddlepaddle; then
      log "PaddleOCR non disponibile per Python $PY_VER: continuo con engine fallback pytesseract"
    fi
  fi

  printf '%s' "$REQ_HASH" > "$REQ_HASH_FILE"
else
  log "Dipendenze gia allineate a requirements.txt"
fi

AVAILABLE_ENGINE="$($PYTHON_BIN - <<'PY'
import importlib.util
import shutil

paddle_available = importlib.util.find_spec("paddleocr") is not None

try:
    import pytesseract

    tesseract_cmd = getattr(pytesseract.pytesseract, "tesseract_cmd", "tesseract")
    tesseract_available = shutil.which(tesseract_cmd) is not None
except Exception:
    tesseract_available = False

if paddle_available:
    print("paddle")
elif tesseract_available:
    print("tesseract")
else:
    print("none")
PY
)"

if [[ "$AVAILABLE_ENGINE" == "none" ]]; then
  fail "Nessun engine OCR disponibile. Installa tesseract-ocr e language pack ita/eng oppure abilita PaddleOCR."
fi

log "Engine OCR disponibile: $AVAILABLE_ENGINE"

if [[ "$CHECK_ONLY" == "--check" ]]; then
  log "Check completato: ambiente OCR locale pronto."
  exit 0
fi

OCR_HOST="${OCR_HOST:-0.0.0.0}"
OCR_PORT="${OCR_PORT:-8000}"
OCR_RELOAD="${OCR_RELOAD:-false}"

CMD=("$PYTHON_BIN" -m uvicorn main:app --host "$OCR_HOST" --port "$OCR_PORT")
if [[ "$OCR_RELOAD" == "true" ]]; then
  CMD+=(--reload)
fi

log "Avvio OCR service su http://$OCR_HOST:$OCR_PORT"
cd "$SCRIPT_DIR"
exec "${CMD[@]}"
