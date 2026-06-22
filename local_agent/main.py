"""
Local Agent — stansiya kompyuterida lokal kameralar uchun stream proxy.
Ishga tushirish: python -m local_agent.main
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import urllib.request

from kamera.camera_connection import (
    test_schema_camera_connection,
    gen_mjpeg_frames,
    gen_http_snapshot_mjpeg_frames,
    _fetch_http_snapshot_jpeg,
    _open_rtsp_capture,
    camera_ports_to_try,
    is_private_or_local_ip,
)

APP = FastAPI(title="Kamera Local Agent", version="1.0.0")
DATA_DIR = Path(__file__).resolve().parent / "data"
CACHE_FILE = DATA_DIR / "sync_cache.json"

APP.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TestConnectionBody(BaseModel):
    id: Optional[int] = None
    ip_address: Optional[str] = None
    login: str = "admin"
    password: str = ""
    http_port: int = 80
    rtsp_port: int = 554
    stream_path: Optional[str] = "/Streaming/Channels/101"
    quick: bool = False


def _load_cache():
    if not CACHE_FILE.exists():
        return {"schema_cameras": [], "stations": []}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"schema_cameras": [], "stations": []}


def _save_cache(data):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _cam_from_cache(cam_id: int):
    cache = _load_cache()
    for cam in cache.get("schema_cameras", []):
        if cam.get("id") == cam_id:
            return cam
    return None


def _upsert_camera_in_cache(cam: dict):
    """Test yoki sync dan keyin kamera ma'lumotlarini cache ga yozish."""
    cam_id = cam.get("id")
    if not cam_id:
        return
    cache = _load_cache()
    cameras = cache.get("schema_cameras", [])
    keys = (
        "id", "station", "position_number", "label",
        "ip_address", "login", "password",
        "http_port", "rtsp_port", "stream_path", "is_local_only",
    )
    entry = {"id": cam_id}
    for k in keys:
        if k != "id" and k in cam:
            entry[k] = cam[k]
    updated = False
    for i, existing in enumerate(cameras):
        if existing.get("id") == cam_id:
            cameras[i] = {**existing, **entry}
            updated = True
            break
    if not updated:
        cameras.append(entry)
    cache["schema_cameras"] = cameras
    _save_cache(cache)


def _fetch_camera_from_server(cam_id: int, auth: str):
    if not auth:
        return None
    server_url = os.environ.get("SERVER_API_URL", "http://88.88.0.151:8090").rstrip("/")
    req = urllib.request.Request(
        f"{server_url}/api/schema-cameras/{cam_id}/",
        headers={"Authorization": auth, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def _resolve_camera(body: TestConnectionBody, auth: str = ""):
    cam = {}
    if body.id:
        cached = _cam_from_cache(body.id)
        if cached:
            cam.update(cached)
        server_cam = _fetch_camera_from_server(body.id, auth)
        if server_cam:
            cam.update(server_cam)

    data = body.model_dump()
    for key, val in data.items():
        if val is None:
            continue
        if key == "password" and val == "" and cam.get("password"):
            continue
        cam[key] = val

    if not (cam.get("ip_address") or "").strip():
        raise HTTPException(status_code=404, detail="Kamera topilmadi — sync qiling yoki IP kiriting")
    return cam


@APP.get("/health")
def health():
    return {"ok": True, "service": "local-agent", "version": "1.0.0"}


@APP.get("/api/sync/status")
def sync_status():
    cache = _load_cache()
    return {
        "cached_cameras": len(cache.get("schema_cameras", [])),
        "cached_stations": len(cache.get("stations", [])),
        "synced_at": cache.get("synced_at"),
    }


@APP.post("/api/sync/pull-from-server")
def pull_from_server(request: Request):
    """Serverdan metadata yuklab cache ga saqlash."""
    auth = request.headers.get("Authorization", "")
    server_url = os.environ.get("SERVER_API_URL", "http://88.88.0.151:8090").rstrip("/")
    req = urllib.request.Request(
        f"{server_url}/api/sync/pull/",
        headers={"Authorization": auth, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Server sync xatosi: {e}") from e
    _save_cache(data)
    return {"ok": True, "synced_at": data.get("synced_at"), "cameras": len(data.get("schema_cameras", []))}


@APP.post("/api/schema-cameras/test-connection/")
def test_connection(body: TestConnectionBody, request: Request):
    auth = request.headers.get("Authorization", "")
    cam = _resolve_camera(body, auth)
    result = test_schema_camera_connection(
        cam.get("ip_address"),
        cam.get("login", "admin"),
        cam.get("password", ""),
        cam.get("http_port", 80),
        cam.get("rtsp_port", 554),
        cam.get("stream_path"),
        from_local_agent=True,
        quick=body.quick,
    )
    cam_id = body.id or cam.get("id")
    if result.get("ok") and cam_id:
        _upsert_camera_in_cache({**cam, "id": cam_id})
        if result.get("http_port"):
            _upsert_camera_in_cache({**cam, "id": cam_id, "http_port": result["http_port"]})
    return result


@APP.get("/api/schema-cameras/{cam_id}/live/")
def live_stream(
    cam_id: int,
    ip_address: str = None,
    login: str = None,
    password: str = None,
    http_port: int = 80,
    rtsp_port: int = 554,
    stream_path: str = None,
):
    cam = _cam_from_cache(cam_id) or {}
    ip = (ip_address or cam.get("ip_address") or "").strip()
    if not ip:
        raise HTTPException(status_code=400, detail="IP kerak — sync qiling yoki ip_address yuboring")
    user = login or cam.get("login", "admin")
    pwd = password if password is not None else cam.get("password", "")
    hp = int(http_port or cam.get("http_port") or 80)
    rp = int(rtsp_port or cam.get("rtsp_port") or 554)
    path = stream_path or cam.get("stream_path")

    cap, rtsp_url = _open_rtsp_capture(ip, user, pwd, rp, path)
    if cap:
        return StreamingResponse(
            gen_mjpeg_frames(rtsp_url, cap=cap),
            media_type="multipart/x-mixed-replace; boundary=frame",
        )

    for try_port in camera_ports_to_try(hp, rp):
        if _fetch_http_snapshot_jpeg(ip, try_port, user, pwd, path):
            return StreamingResponse(
                gen_http_snapshot_mjpeg_frames(ip, try_port, user, pwd, path),
                media_type="multipart/x-mixed-replace; boundary=frame",
            )

    raise HTTPException(
        status_code=502,
        detail="Kamera video bermayapti — RTSP va HTTP snapshot ishlamadi",
    )


@APP.get("/api/schema-cameras/{cam_id}/snapshot/")
def snapshot(cam_id: int):
    cam = _cam_from_cache(cam_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Kamera cache da yo'q")
    ip = cam["ip_address"]
    port = cam.get("http_port", 80)
    path = cam.get("stream_path") or "/cgi-bin/snapshot.cgi"
    url = f"http://{ip}:{port}{path}"
    passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    passman.add_password(None, url, cam.get("login", "admin"), cam.get("password", ""))
    opener = urllib.request.build_opener(
        urllib.request.HTTPBasicAuthHandler(passman),
        urllib.request.HTTPDigestAuthHandler(passman),
    )
    try:
        with opener.open(urllib.request.Request(url), timeout=5) as resp:
            from fastapi.responses import Response
            return Response(content=resp.read(), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


def main():
    import uvicorn
    port = int(os.environ.get("LOCAL_AGENT_PORT", "8765"))
    uvicorn.run("local_agent.main:APP", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    main()
