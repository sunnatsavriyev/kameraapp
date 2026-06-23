"""
Kamera ulanish va stream logikasi — Django server va Local Agent uchun umumiy.
"""
import re
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import quote


RTSP_PATH_CANDIDATES = [
    '/Streaming/Channels/101',
    '/Streaming/Channels/1',
    '/h264/ch1/main/av_stream',
    '/cam/realmonitor?channel=1&subtype=0',
    '/stream1',
]

COMMON_CAMERA_PORTS = (80, 8000, 8080, 443, 554, 8554, 37777)


def validate_camera_ip(ip):
    parts = ip.split('.')
    if len(parts) == 4 and all(part.isdigit() and 0 <= int(part) <= 255 for part in parts):
        return True
    return bool(re.match(r'^[a-zA-Z0-9.-]+$', ip) and len(ip) <= 253)


def is_private_or_local_ip(ip):
    """Lokal tarmoq IP (serverdan to'g'ridan-to'g'ri ulanmaydi)."""
    parts = (ip or '').strip().split('.')
    if len(parts) != 4:
        return False
    try:
        a, b, c, d = (int(x) for x in parts)
    except ValueError:
        return False
    if a == 10:
        return True
    if a == 11:
        return True
    if a == 22:
        return True
    if a == 127:
        return True
    if a == 192 and b == 168:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    if a == 169 and b == 254:
        return True
    return False


def _try_http_snapshot(ip, port, user, pwd, stream_path, *, timeout=3.0, quick=False):
    auth_failed = False

    def _open(url, method='GET'):
        nonlocal auth_failed
        passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        passman.add_password(None, url, user, pwd)
        opener = urllib.request.build_opener(
            urllib.request.HTTPBasicAuthHandler(passman),
            urllib.request.HTTPDigestAuthHandler(passman),
        )
        req = urllib.request.Request(url, data=b'' if method == 'POST' else None, method=method)
        req.add_header('User-Agent', 'Mozilla/5.0')
        if method == 'POST':
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            req.add_header('Accept', 'image/jpeg,*/*')
        with opener.open(req, timeout=timeout) as resp:
            content = resp.read()
            content_type = resp.headers.get('Content-Type', '')
            if content and (b'\xff\xd8' in content[:4] or 'image' in content_type):
                return True, None
        return False, None

    hik_post_urls = [
        f'http://{ip}:{port}/Streaming/channels/101/picture',
        f'http://{ip}:{port}/Streaming/channels/1/picture',
    ] if quick else [
        f'http://{ip}:{port}/Streaming/channels/101/picture',
        f'http://{ip}:{port}/Streaming/channels/1/picture',
        f'http://{ip}:{port}/ISAPI/Streaming/channels/101/picture',
        f'http://{ip}:{port}/ISAPI/Streaming/channels/1/picture',
    ]
    get_urls = [
        f'http://{ip}:{port}/cgi-bin/snapshot.cgi',
        f'http://{ip}:{port}{stream_path or ""}',
    ] if quick else [
        f'http://{ip}:{port}{stream_path or ""}',
        f'http://{ip}:{port}/cgi-bin/snapshot.cgi',
        f'http://{ip}:{port}/cgi-bin/snapshot.cgi?channel=1&subtype=0',
        f'http://{ip}:{port}/onvif/snapshot',
        f'http://{ip}:{port}/onvif-http/snapshot',
        f'http://{ip}:{port}/snapshot.jpg',
        f'http://{ip}:{port}/image.jpg',
    ]

    hik_got_401 = False
    for url in hik_post_urls:
        try:
            ok, _ = _open(url, method='POST')
            if ok:
                return True, None
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                hik_got_401 = True
        except Exception:
            pass

    for url in get_urls:
        if not url or url.endswith('//') or url == f'http://{ip}:{port}':
            continue
        try:
            ok, _ = _open(url)
            if ok:
                return True, None
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and not quick:
                auth_failed = True
        except Exception:
            pass

    if hik_got_401:
        return False, 'auth_failed'
    if auth_failed:
        return False, 'auth_failed'
    return False, None


def _local_only_result():
    return {
        'ok': True,
        'status': 'local_only',
        'message': "Lokal IP — jonli ko'rinish faqat stansiya kompyuterida (Local Agent)",
        'requires_local_agent': True,
    }


def camera_ports_to_try(http_port, rtsp_port):
    ports = []
    for p in (http_port, rtsp_port, *COMMON_CAMERA_PORTS):
        try:
            p = int(p or 0)
        except (TypeError, ValueError):
            continue
        if 0 < p < 65536 and p not in ports:
            ports.append(p)
    return ports


def probe_tcp_ports(ip, ports, timeout=2.0):
    tried = []
    for port in ports:
        tried.append(port)
        try:
            with socket.create_connection((ip, port), timeout=timeout):
                return True, port, tried
        except ConnectionRefusedError:
            return True, port, tried
        except OSError:
            continue
    return False, None, tried


def _test_rtsp_live(ip, user, pwd, rtsp_port, path):
    try:
        import cv2
        import os
        os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'rtsp_transport;tcp'
        for rtsp_path in rtsp_path_candidates(path):
            rtsp_url = get_rtsp_url(ip, user, pwd, rtsp_port, rtsp_path)
            cap = cv2.VideoCapture(rtsp_url)
            if not cap.isOpened():
                cap.release()
                continue
            ret = False
            for _ in range(15):
                ret, frame = cap.read()
                if ret and frame is not None:
                    cap.release()
                    return {
                        'ok': True,
                        'status': 'live',
                        'message': 'Kamera onlayn — jonli video mavjud',
                    }
                time.sleep(0.05)
            cap.release()
    except ImportError:
        pass
    except Exception:
        pass
    return None


def _test_http_live(ip, user, pwd, ports, path):
    auth_failed = False
    for try_port in ports:
        http_ok, http_err = _try_http_snapshot(ip, try_port, user, pwd, path)
        if http_ok:
            msg = 'Kamera onlayn — snapshot olinadi'
            return {
                'ok': True,
                'status': 'live',
                'message': msg,
                'http_port': try_port,
            }
        if http_err == 'auth_failed':
            auth_failed = True
    if auth_failed:
        return {
            'ok': False,
            'status': 'auth_failed',
            'message': "Login yoki parol noto'g'ri",
        }
    return None


def _quick_camera_check(ip, user, pwd, http_port, rtsp_port, stream_path, *, from_local_agent, is_local_ip):
    """Ro'yxat uchun tez tekshiruv — ~8 soniya ichida."""
    port = int(http_port or 80)
    rtsp_port = int(rtsp_port or 554)
    path = stream_path or '/Streaming/Channels/101'

    if not from_local_agent and is_local_ip:
        return _local_only_result()

    # RTSP — Hikvision/Dahua uchun eng ishonchli tez test
    rtsp_result = _test_rtsp_live(ip, user, pwd, rtsp_port, path)
    if rtsp_result:
        return rtsp_result

    ports = [port, rtsp_port, 8000, 8080] if from_local_agent else [port, rtsp_port]
    seen = []
    for p in ports:
        if p and p not in seen:
            seen.append(int(p))

    reachable, open_port, tried = probe_tcp_ports(ip, seen, timeout=1.5)
    if not reachable:
        ports_str = ', '.join(str(p) for p in tried)
        return {
            'ok': False,
            'status': 'unreachable',
            'message': f"Kamera javob bermayapti (portlar: {ports_str})",
        }

    snap_port = open_port if open_port in (port, 8000, 8080, 80, 443) else port
    http_ok, http_err = _try_http_snapshot(
        ip, snap_port, user, pwd, path, timeout=2.0, quick=True,
    )
    if http_ok:
        return {'ok': True, 'status': 'live', 'message': 'Kamera onlayn'}
    if http_err == 'auth_failed':
        return {'ok': False, 'status': 'auth_failed', 'message': "Login yoki parol noto'g'ri"}

    return {
        'ok': False,
        'status': 'offline',
        'message': 'Port ochiq, lekin video olinmadi',
    }


def test_schema_camera_connection(
    ip_address,
    login,
    password,
    http_port=80,
    rtsp_port=554,
    stream_path=None,
    *,
    from_local_agent=False,
    quick=False,
):
    """
    Kamera ulanishini tekshirish.
    from_local_agent=True bo'lsa to'liq mahalliy test; aks holda server rejimi (lokal IP uchun local_only).
    """
    ip = (ip_address or '').strip()
    if not ip:
        return {'ok': False, 'status': 'no_ip', 'message': 'IP manzil kiritilmagan'}

    if not validate_camera_ip(ip):
        return {
            'ok': False,
            'status': 'invalid_ip',
            'message': "IP manzil noto'g'ri — to'g'ri format: 192.168.1.100",
        }

    if not (password or '').strip():
        return {'ok': False, 'status': 'auth_failed', 'message': 'Parol kiritilmagan'}

    is_local_ip = is_private_or_local_ip(ip)
    port = int(http_port or 80)
    rtsp_port = int(rtsp_port or 554)
    user = (login or 'admin').strip()
    pwd = password or ''
    path = stream_path or '/Streaming/Channels/101'
    ports_to_try = camera_ports_to_try(port, rtsp_port)

    if quick:
        return _quick_camera_check(
            ip, user, pwd, port, rtsp_port, path,
            from_local_agent=from_local_agent,
            is_local_ip=is_local_ip,
        )

    # Local Agent: RTSP + HTTP ni ko'p portda sinash (TCP oldindan to'sib qo'ymaydi)
    if from_local_agent:
        rtsp_result = _test_rtsp_live(ip, user, pwd, rtsp_port, path)
        if rtsp_result:
            return rtsp_result
        http_result = _test_http_live(ip, user, pwd, ports_to_try, path)
        if http_result:
            return http_result
        reachable, _, tried = probe_tcp_ports(ip, ports_to_try)
        ports_str = ', '.join(str(p) for p in tried)
        if not reachable:
            return {
                'ok': False,
                'status': 'unreachable',
                'message': (
                    f"Kamera javob bermayapti (sinangan portlar: {ports_str}). "
                    "PC va kamera bir xil tarmoqda (masalan 192.168.25.x) ekanini tekshiring."
                ),
                'tried_ports': tried,
            }
        return {
            'ok': False,
            'status': 'offline',
            'message': "Kamera ishlamayapti — ulanish bor, lekin video olinmadi (login/parol yoki stream path ni tekshiring)",
        }

    reachable = False
    network_unreachable = False

    for check_port in {port, rtsp_port}:
        try:
            with socket.create_connection((ip, check_port), timeout=3.0):
                reachable = True
                break
        except socket.timeout:
            continue
        except ConnectionRefusedError:
            reachable = True
            break
        except OSError as e:
            err_low = str(e).lower()
            if 'unreachable' in err_low or 'no route' in err_low or 'network is unreachable' in err_low:
                network_unreachable = True
            continue

    if not from_local_agent and is_local_ip and (network_unreachable or not reachable):
        return _local_only_result()

    if not reachable:
        if not from_local_agent and is_local_ip:
            return _local_only_result()
        return {
            'ok': False,
            'status': 'unreachable',
            'message': "Kamera javob bermayapti — IP manzil mavjud emas yoki ishlamayapti",
        }

    rtsp_result = _test_rtsp_live(ip, user, pwd, rtsp_port, path)
    if rtsp_result:
        return rtsp_result

    http_result = _test_http_live(ip, user, pwd, [port], path)
    if http_result:
        return http_result

    if is_local_ip:
        return _local_only_result()

    return {
        'ok': False,
        'status': 'offline',
        'message': "Kamera ishlamayapti — ulanish bor, lekin video olinmadi (LIVE emas)",
    }


def get_rtsp_url(ip, login, password, rtsp_port=554, stream_path=None):
    path = stream_path or '/Streaming/Channels/101'
    user = quote((login or 'admin').strip(), safe='')
    pwd = quote(password or '', safe='')
    return f'rtsp://{user}:{pwd}@{ip}:{int(rtsp_port or 554)}{path}'


def rtsp_path_candidates(stream_path=None):
    """RTSP yo'llar — HTTP snapshot path larni chiqarib tashlaydi."""
    candidates = []
    path = (stream_path or '').strip()
    if path and path.startswith('/'):
        low = path.lower()
        if 'snapshot' not in low and 'picture' not in low and '.jpg' not in low:
            candidates.append(path)
    for p in RTSP_PATH_CANDIDATES:
        if p not in candidates:
            candidates.append(p)
    return candidates


def _open_rtsp_capture(ip, login, password, rtsp_port, stream_path=None):
    """RTSP ulanish — birinchi ishlaydigan yo'lni qaytaradi."""
    try:
        import cv2
        import os
    except ImportError:
        return None, None

    os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'rtsp_transport;tcp'
    for path in rtsp_path_candidates(stream_path):
        rtsp_url = get_rtsp_url(ip, login, password, rtsp_port, path)
        cap = cv2.VideoCapture(rtsp_url)
        if not cap.isOpened():
            cap.release()
            continue
        for _ in range(15):
            ret, frame = cap.read()
            if ret and frame is not None:
                return cap, rtsp_url
            time.sleep(0.05)
        cap.release()
    return None, None


def gen_mjpeg_frames(rtsp_url, cap=None):
    """RTSP dan MJPEG generator."""
    import cv2
    import os

    own_cap = cap is None
    if own_cap:
        os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'rtsp_transport;tcp'
        cap = cv2.VideoCapture(rtsp_url)
        if not cap.isOpened():
            return

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.01)
                continue
            ret, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if not ret:
                continue
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n\r\n'
            )
            time.sleep(0.04)
    except GeneratorExit:
        pass
    finally:
        if own_cap:
            cap.release()


def _fetch_http_snapshot_jpeg(ip, port, user, pwd, stream_path=None):
    """HTTP snapshot — birinchi muvaffaqiyatli JPEG."""
    passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()

    def _open(url, method='GET'):
        passman.add_password(None, url, user, pwd)
        opener = urllib.request.build_opener(
            urllib.request.HTTPBasicAuthHandler(passman),
            urllib.request.HTTPDigestAuthHandler(passman),
        )
        req = urllib.request.Request(url, data=b'' if method == 'POST' else None, method=method)
        req.add_header('User-Agent', 'Mozilla/5.0')
        if method == 'POST':
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')
            req.add_header('Accept', 'image/jpeg,*/*')
        with opener.open(req, timeout=3.0) as resp:
            content = resp.read()
            content_type = resp.headers.get('Content-Type', '')
            if content and (b'\xff\xd8' in content[:4] or 'image' in content_type):
                return content
        return None

    hik_post_urls = [
        f'http://{ip}:{port}/Streaming/channels/101/picture',
        f'http://{ip}:{port}/Streaming/channels/1/picture',
        f'http://{ip}:{port}/ISAPI/Streaming/channels/101/picture',
        f'http://{ip}:{port}/ISAPI/Streaming/channels/1/picture',
    ]
    get_urls = [
        f'http://{ip}:{port}{stream_path or ""}',
        f'http://{ip}:{port}/cgi-bin/snapshot.cgi',
        f'http://{ip}:{port}/cgi-bin/snapshot.cgi?channel=1&subtype=0',
        f'http://{ip}:{port}/onvif/snapshot',
        f'http://{ip}:{port}/snapshot.jpg',
        f'http://{ip}:{port}/image.jpg',
    ]

    for url in hik_post_urls:
        try:
            jpeg = _open(url, method='POST')
            if jpeg:
                return jpeg
        except Exception:
            pass

    for url in get_urls:
        if not url or url.endswith('//') or url == f'http://{ip}:{port}':
            continue
        try:
            jpeg = _open(url)
            if jpeg:
                return jpeg
        except Exception:
            pass
    return None


def gen_http_snapshot_mjpeg_frames(ip, port, user, pwd, stream_path=None, interval=0.5):
    """HTTP snapshot polling orqali MJPEG."""
    while True:
        jpeg = _fetch_http_snapshot_jpeg(ip, port, user, pwd, stream_path)
        if jpeg:
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' + jpeg + b'\r\n\r\n'
            )
        time.sleep(interval)


def gen_camera_live_frames(ip, login, password, http_port=80, rtsp_port=554, stream_path=None):
    """RTSP yoki HTTP snapshot orqali jonli MJPEG."""
    cap, rtsp_url = _open_rtsp_capture(ip, login, password, rtsp_port, stream_path)
    if cap:
        yield from gen_mjpeg_frames(rtsp_url, cap=cap)
        return
    yield from gen_http_snapshot_mjpeg_frames(
        ip, int(http_port or 80), login, password, stream_path
    )
