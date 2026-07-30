from io import BytesIO

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import app


def wav_bytes(frequency: float, sample_rate: int = 44_100) -> bytes:
    time = np.arange(sample_rate) / sample_rate
    signal = (0.2 * np.sin(2 * np.pi * frequency * time)).astype(np.float32)
    buffer = BytesIO()
    sf.write(buffer, signal, sample_rate, format="WAV")
    return buffer.getvalue()


def test_health() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_compare_endpoint() -> None:
    response = TestClient(app).post(
        "/api/v1/compare",
        files={
            "reference": ("reference.wav", wav_bytes(220), "audio/wav"),
            "current": ("current.wav", wav_bytes(1760), "audio/wav"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    brightness = next(item for item in payload["dimensions"] if item["key"] == "brightness")
    assert brightness["difference"] > 0
