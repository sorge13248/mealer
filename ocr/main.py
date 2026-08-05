from __future__ import annotations

import importlib
import logging
import os
import shutil
import time
from statistics import mean
from typing import Any, Literal

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

app = FastAPI(title="Mealer OCR Service", version="1.0.0")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mealer-ocr")

_paddle_ocr_instance: Any | None = None
_paddle_ocr_available: bool | None = None


class OcrBase64Request(BaseModel):
    imageBase64: str


@app.middleware("http")
async def log_http_requests(request: Request, call_next):
    # Centralized HTTP logs for every endpoint call with execution time.
    started = time.perf_counter()
    client = request.client.host if request.client else "unknown"
    logger.info("request.start method=%s path=%s client=%s", request.method, request.url.path, client)

    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.exception(
            "request.error method=%s path=%s durationMs=%.2f",
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise

    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "request.end method=%s path=%s status=%s durationMs=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


def can_use_paddle_ocr() -> bool:
    global _paddle_ocr_available
    if _paddle_ocr_available is not None:
        return _paddle_ocr_available

    try:
        importlib.import_module("paddleocr")
        _paddle_ocr_available = True
    except Exception:
        _paddle_ocr_available = False

    return _paddle_ocr_available


def get_paddle_ocr() -> Any:
    global _paddle_ocr_instance
    if _paddle_ocr_instance is None:
        paddle_module = importlib.import_module("paddleocr")
        paddle_ocr_class = getattr(paddle_module, "PaddleOCR")
        # Keep language aligned with the backend parser assumptions.
        _paddle_ocr_instance = paddle_ocr_class(use_angle_cls=True, lang="it")
    return _paddle_ocr_instance


def can_use_tesseract() -> bool:
    try:
        import pytesseract
    except Exception:
        return False

    tesseract_cmd = getattr(pytesseract.pytesseract, "tesseract_cmd", "tesseract")
    return shutil.which(tesseract_cmd) is not None


def resolve_engine() -> Literal["paddle", "tesseract"]:
    preferred_engine = os.getenv("OCR_ENGINE", "auto").strip().lower()

    paddle_available = can_use_paddle_ocr()
    tesseract_available = can_use_tesseract()

    if preferred_engine == "paddle":
        if not paddle_available:
            raise HTTPException(
                status_code=500,
                detail="OCR_ENGINE=paddle ma paddleocr non e disponibile.",
            )
        return "paddle"

    if preferred_engine == "tesseract":
        if not tesseract_available:
            raise HTTPException(
                status_code=500,
                detail="OCR_ENGINE=tesseract ma pytesseract/tesseract non sono disponibili.",
            )
        return "tesseract"

    if paddle_available:
        return "paddle"

    if tesseract_available:
        return "tesseract"

    raise HTTPException(
        status_code=500,
        detail="Nessun engine OCR disponibile. Installa paddleocr oppure tesseract + pytesseract.",
    )


def normalize_ocr_output_text(raw_text: str) -> str:
    return (
        raw_text.replace("\u00a0", " ")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("\ufeff", "")
        .strip()
    )


def compute_ocr_text_quality_score(text: str) -> float:
    if not text:
        return 0.0

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    alpha_count = sum(1 for char in text if char.isalpha())
    digit_count = sum(1 for char in text if char.isdigit())
    garbage_count = sum(
        1 for char in text if not (char.isalnum() or char.isspace() or char in ".,:%-/")
    )

    signal_chars = alpha_count + digit_count
    garbage_ratio = (
        garbage_count / (signal_chars + garbage_count)
        if signal_chars + garbage_count > 0
        else 1.0
    )

    score = 0.0
    score += min(len(lines) / 18.0, 1.0) * 0.28
    score += min(signal_chars / 420.0, 1.0) * 0.32
    score += 0.25 if any(token in text.upper() for token in ["DOCUMENTO", "DESCRIZIONE", "TOTALE", "PAGAMENTO", "IVA"]) else 0.0
    score += max(0.0, 1.0 - garbage_ratio * 2.4) * 0.15

    if len(text) < 40:
        score *= 0.5

    return max(0.0, min(1.0, score))


def preprocess_variants(image: np.ndarray) -> list[np.ndarray]:
    # Multiple preprocessing variants improve OCR robustness on phone photos.
    variants: list[np.ndarray] = [image]

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    variants.append(gray)

    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    variants.append(clahe)

    denoised = cv2.fastNlMeansDenoising(gray, h=12)
    variants.append(denoised)

    adaptive = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        35,
        11,
    )
    variants.append(adaptive)

    return variants


def run_ocr_on_variant_paddle(ocr: Any, image: np.ndarray) -> tuple[str, float, int]:
    result: Any = ocr.ocr(image, cls=True)
    lines: list[str] = []
    confidences: list[float] = []

    for page in result or []:
        for row in page or []:
            if len(row) < 2:
                continue
            text = str(row[1][0]).strip()
            confidence = float(row[1][1])
            if not text:
                continue
            lines.append(text)
            confidences.append(confidence)

    merged_text = normalize_ocr_output_text("\n".join(lines))
    mean_confidence = mean(confidences) if confidences else 0.0
    return merged_text, mean_confidence, len(lines)


def run_ocr_on_variant_tesseract(image: np.ndarray) -> tuple[str, float, int]:
    import pytesseract

    output = pytesseract.image_to_data(
        image,
        output_type=pytesseract.Output.DICT,
        lang=os.getenv("OCR_LANG", "ita+eng"),
        config=os.getenv("OCR_TESSERACT_CONFIG", "--psm 6"),
    )

    lines: list[str] = []
    confidences: list[float] = []
    text_tokens = output.get("text", [])
    conf_tokens = output.get("conf", [])

    for idx in range(min(len(text_tokens), len(conf_tokens))):
        token = str(text_tokens[idx]).strip()
        if not token:
            continue

        raw_conf = str(conf_tokens[idx]).strip()
        try:
            conf = float(raw_conf)
        except ValueError:
            conf = -1.0

        lines.append(token)
        if conf >= 0:
            confidences.append(min(max(conf / 100.0, 0.0), 1.0))

    merged_text = normalize_ocr_output_text("\n".join(lines))
    mean_confidence = mean(confidences) if confidences else 0.0
    return merged_text, mean_confidence, len(lines)


@app.get("/health")
def health() -> dict[str, Any]:
    selected_engine = "unavailable"
    try:
        selected_engine = resolve_engine()
    except HTTPException:
        selected_engine = "unavailable"

    payload = {
        "status": "ok",
        "selectedEngine": selected_engine,
        "available": {
            "paddle": can_use_paddle_ocr(),
            "tesseract": can_use_tesseract(),
        },
    }
    logger.info(
        "health.selectedEngine=%s availablePaddle=%s availableTesseract=%s",
        payload["selectedEngine"],
        payload["available"]["paddle"],
        payload["available"]["tesseract"],
    )
    return payload


@app.post("/ocr/receipt")
async def ocr_receipt(file: UploadFile = File(...)) -> dict[str, Any]:
    logger.info("ocr.upload filename=%s contentType=%s", file.filename, file.content_type)
    content = await file.read()
    return run_ocr_pipeline(content)


@app.post("/ocr/receipt/base64")
def ocr_receipt_base64(payload: OcrBase64Request) -> dict[str, Any]:
    import base64

    logger.info("ocr.base64 payloadBytes=%s", len(payload.imageBase64))

    try:
        content = base64.b64decode(payload.imageBase64, validate=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid base64 payload") from error

    return run_ocr_pipeline(content)


def run_ocr_pipeline(content: bytes) -> dict[str, Any]:
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    image_array = np.frombuffer(content, dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Unsupported image/PDF payload")

    engine = resolve_engine()
    ocr = get_paddle_ocr() if engine == "paddle" else None
    logger.info("ocr.pipeline.start engine=%s inputBytes=%s", engine, len(content))

    best_text = ""
    best_score = -1.0
    best_confidence = 0.0
    best_lines = 0
    had_errors = False

    for variant in preprocess_variants(image):
        try:
            if engine == "paddle":
                text, confidence, lines_count = run_ocr_on_variant_paddle(ocr, variant)
            else:
                text, confidence, lines_count = run_ocr_on_variant_tesseract(variant)
        except Exception:
            had_errors = True
            continue

        score = compute_ocr_text_quality_score(text)

        if score > best_score:
            best_text = text
            best_score = score
            best_confidence = confidence
            best_lines = lines_count

        if score >= 0.72:
            break

    if not best_text:
        if had_errors:
            logger.warning("ocr.pipeline.no_text_with_errors engine=%s", engine)
            raise HTTPException(
                status_code=422,
                detail=f"OCR engine '{engine}' non ha prodotto testo utile.",
            )
        logger.warning("ocr.pipeline.no_text engine=%s", engine)
        raise HTTPException(status_code=422, detail="No text recognized")

    result = {
        "engine": engine,
        "text": best_text,
        "meanConfidence": round(best_confidence, 4),
        "score": round(best_score, 4),
        "lines": best_lines,
    }
    logger.info(
        "ocr.pipeline.end engine=%s score=%.4f meanConfidence=%.4f lines=%s textLen=%s",
        result["engine"],
        result["score"],
        result["meanConfidence"],
        result["lines"],
        len(result["text"]),
    )
    return result
