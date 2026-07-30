from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .alignment import load_and_align_files
from .audio import analyze_signal, build_dimensions, build_summary
from .models import CompareResponse
from .quality import build_quality_info
from .recommendations import build_adjustment_plan
from .visuals import build_visuals

MAX_FILE_BYTES = 25 * 1024 * 1024
ALLOWED_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg"}

app = FastAPI(title="Tone Lab API", version="1.0.0")

origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


async def _save_upload(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="WAV、MP3、FLAC、OGG形式を使用してください。")

    size = 0
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    path = Path(temp.name)
    try:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="ファイルサイズは25MB以下にしてください。")
            temp.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="空のファイルは解析できません。")
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        temp.close()
        await upload.close()
    return path


@app.post("/api/v1/compare", response_model=CompareResponse)
async def compare(
    reference: UploadFile = File(...),
    current: UploadFile = File(...),
) -> CompareResponse:
    reference_path: Path | None = None
    current_path: Path | None = None
    try:
        reference_path = await _save_upload(reference)
        current_path = await _save_upload(current)
        (
            aligned_reference,
            aligned_current,
            sample_rate,
            alignment,
        ) = load_and_align_files(reference_path, current_path)
        reference_features = analyze_signal(
            aligned_reference,
            sample_rate,
            reference.filename or "reference",
        )
        current_features = analyze_signal(
            aligned_current,
            sample_rate,
            current.filename or "current",
        )
        quality = build_quality_info(
            aligned_reference,
            aligned_current,
            reference_features,
            current_features,
        )
        visuals = build_visuals(aligned_reference, aligned_current, sample_rate)
        dimensions = build_dimensions(reference_features, current_features)
        return CompareResponse(
            alignment=alignment,
            quality=quality,
            reference=reference_features,
            current=current_features,
            visuals=visuals,
            dimensions=dimensions,
            adjustment_plan=build_adjustment_plan(dimensions),
            summary=build_summary(dimensions),
            disclaimer=(
                "この結果は物理特徴から作った初期ルールによる相対評価です。"
                "同じフレーズ・近い録音条件で使用し、唯一の正解設定としてではなく調整方向として扱ってください。"
            ),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        if reference_path:
            reference_path.unlink(missing_ok=True)
        if current_path:
            current_path.unlink(missing_ok=True)
