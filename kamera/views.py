from rest_framework import permissions, viewsets
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from django.core.management import call_command
from django.http import JsonResponse, HttpResponse, StreamingHttpResponse
import urllib.request
import urllib.error
import base64
import socket
import re
import time

from .models import MetroLine, Station, Camera, CameraStream, SchemaCamera, MetalDetector, Monitor, Computer, NVR, Switch, DeviceHistory
from .camera_connection import (
    is_private_or_local_ip,
    test_schema_camera_connection,
    gen_mjpeg_frames,
)
from .pagination import CustomPagination
from .serializers import (
    MetroLineSerializer, StationSerializer, CameraSerializer, CameraStreamSerializer,
    SchemaCameraSerializer,
    MetalDetectorSerializer, MonitorSerializer, ComputerSerializer,
    NVRSerializer, SwitchSerializer, DeviceHistorySerializer
)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_me(request):
    return Response({
        "id": request.user.id,
        "username": request.user.username,
        "is_superuser": request.user.is_superuser,
        "email": request.user.email,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_pull(request):
    """Desktop Local Agent uchun metadata sync."""
    from django.utils import timezone
    stations = Station.objects.select_related('line').all()
    schema_cameras = SchemaCamera.objects.select_related('station').all()
    return Response({
        'synced_at': timezone.now().isoformat(),
        'stations': StationSerializer(stations, many=True, context={'request': request}).data,
        'schema_cameras': SchemaCameraSerializer(schema_cameras, many=True).data,
    })


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def run_migrations(request):
    try:
        call_command('makemigrations', 'kamera')
        call_command('migrate')
        return JsonResponse({"status": "success", "message": "Migrations applied successfully!"})
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)}, status=500)


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def camera_discover_url(request, pk):
    """
    Kamera uchun ishlaydigan snapshot URL manzilini topish.
    GET /api/camera-streams/<pk>/discover/
    Faqat diagnostika uchun - barcha URL manzillarini sinab ko'radi va qaysilari ishlashini qaytaradi.
    """
    try:
        stream = CameraStream.objects.filter(camera_id=pk).first()
        if not stream:
            stream = CameraStream.objects.get(pk=pk)
    except (CameraStream.DoesNotExist, ValueError):
        return JsonResponse({"error": "Camera stream not found"}, status=404)

    ip = stream.ip_address
    port = stream.http_port or 80
    user = stream.login
    pwd = stream.password

    # Comprehensive list of snapshot URL patterns for all major brands
    candidates = [
        f"http://{ip}:{port}/ISAPI/Streaming/channels/101/picture",
        f"http://{ip}:{port}/ISAPI/Streaming/channels/1/picture",
        f"http://{ip}:{port}/Streaming/channels/101/picture",
        f"http://{ip}:{port}/Streaming/channels/1/picture",
        f"http://{ip}:{port}/cgi-bin/snapshot.cgi",
        f"http://{ip}:{port}/cgi-bin/snapshot.cgi?channel=1",
        f"http://{ip}:{port}/cgi-bin/jpeg.cgi",
        f"http://{ip}:{port}/onvif/snapshot",
        f"http://{ip}:{port}/onvif-http/snapshot",
        f"http://{ip}:{port}/axis-cgi/jpg/image.cgi",
        f"http://{ip}:{port}/jpg/image.jpg",
        f"http://{ip}:{port}/snapshot.jpg",
        f"http://{ip}:{port}/image.jpg",
        f"http://{ip}:{port}/snap.jpg",
        f"http://{ip}:{port}/webcam.jpg",
        f"http://{ip}:{port}/video.jpg",
        f"http://{ip}:{port}/cgi/jpg/image.cgi",
    ]

    results = []
    for url in candidates:
        try:
            passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            passman.add_password(None, url, user, pwd)
            basic_handler = urllib.request.HTTPBasicAuthHandler(passman)
            digest_handler = urllib.request.HTTPDigestAuthHandler(passman)
            opener = urllib.request.build_opener(basic_handler, digest_handler)
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0")
            with opener.open(req, timeout=2.0) as resp:
                ct = resp.headers.get("Content-Type", "")
                size = len(resp.read())
                results.append({"url": url, "status": resp.status, "content_type": ct, "size_bytes": size, "works": True})
        except urllib.error.HTTPError as e:
            results.append({"url": url, "status": e.code, "error": str(e), "works": False})
        except Exception as e:
            results.append({"url": url, "status": "timeout/refused", "error": str(e), "works": False})

    working = [r for r in results if r["works"]]
    return JsonResponse({
        "camera_id": pk,
        "ip": ip,
        "port": port,
        "working_urls": working,
        "all_results": results
    })



class AuthenticatedCRUDPermission(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated


# Helper function to create log entries
def log_history(station, device_type, device_id, device_brand, action, quantity_change, comment, user_name):
    DeviceHistory.objects.create(
        station=station,
        device_type=device_type,
        device_id=device_id,
        device_brand=device_brand,
        action=action,
        quantity_change=quantity_change,
        comment=comment,
        user_name=user_name
    )


# Base ViewSet to automatically log history records on CRUD
class HistoryLoggedViewSet(viewsets.ModelViewSet):
    def get_comment_and_user(self):
        comment = self.request.data.get('comment') or self.request.query_params.get('comment') or "Izoh qoldirilmadi"
        user_name = self.request.user.username if self.request.user and self.request.user.is_authenticated else "Anonim"
        return comment, user_name

    def find_matching_device(self, model, station, data):
        filter_kwargs = {'station': station}
        if model == Camera:
            filter_kwargs['brand__iexact'] = (data.get('brand') or '').strip()
            filter_kwargs['camera_type__iexact'] = (data.get('camera_type') or '').strip()
        elif model == MetalDetector:
            filter_kwargs['brand__iexact'] = (data.get('brand') or '').strip()
        elif model == Monitor:
            filter_kwargs['brand__iexact'] = (data.get('brand') or '').strip()
            filter_kwargs['size__iexact'] = (data.get('size') or '').strip()
        elif model == Computer:
            filter_kwargs['brand__iexact'] = (data.get('brand') or '').strip()
        elif model == NVR:
            filter_kwargs['brand__iexact'] = (data.get('brand') or '').strip()
            filter_kwargs['model_name__iexact'] = (data.get('model_name') or '').strip()
            filter_kwargs['ports_count'] = data.get('ports_count')
        elif model == Switch:
            filter_kwargs['switch_type__iexact'] = (data.get('switch_type') or '').strip()
            filter_kwargs['ports_count'] = data.get('ports_count')
        else:
            return None
        
        qs = model.objects.filter(**filter_kwargs)
        return qs.first()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        model = self.queryset.model
        station = serializer.validated_data.get('station')
        
        matching_device = self.find_matching_device(model, station, serializer.validated_data)
        if matching_device:
            added_quantity = serializer.validated_data.get('quantity', 1)
            matching_device.quantity += added_quantity
            matching_device.save()
            
            comment, user_name = self.get_comment_and_user()
            brand = getattr(matching_device, 'brand', getattr(matching_device, 'switch_type', 'Noma\'lum'))
            log_history(
                station=station,
                device_type=self.get_device_type(matching_device),
                device_id=matching_device.id,
                device_brand=brand,
                action="Qo'shildi (Birlashtirildi)",
                quantity_change=added_quantity,
                comment=comment,
                user_name=user_name
            )
            
            return Response(self.get_serializer(matching_device).data, status=201)
        
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        target_station = serializer.validated_data.get('station', instance.station)

        data = {}
        for field in ['brand', 'camera_type', 'size', 'model_name', 'ports_count', 'switch_type']:
            if hasattr(instance, field):
                data[field] = serializer.validated_data.get(field, getattr(instance, field))

        station_changed = (target_station.id != instance.station.id)
        fields_changed = any(
            field in serializer.validated_data and serializer.validated_data[field] != getattr(instance, field)
            for field in data
        )

        if station_changed or fields_changed:
            model = self.queryset.model
            matching_device = self.find_matching_device(model, target_station, data)

            if matching_device and matching_device.id != instance.id:
                old_quantity = instance.quantity
                new_quantity = serializer.validated_data.get('quantity', old_quantity)

                matching_device.quantity += new_quantity
                matching_device.save()

                comment, user_name = self.get_comment_and_user()
                brand = getattr(instance, 'brand', getattr(instance, 'switch_type', 'Noma\'lum'))
                device_type = self.get_device_type(instance)

                if station_changed:
                    log_history(
                        station=instance.station,
                        device_type=device_type,
                        device_id=instance.id,
                        device_brand=brand,
                        action="Ko'chirildi (Yuborildi)",
                        quantity_change=-old_quantity,
                        comment=f"{target_station.name} bekatiga ko'chirildi (Birlashtirildi). Izoh: {comment}",
                        user_name=user_name
                    )
                    log_history(
                        station=target_station,
                        device_type=device_type,
                        device_id=matching_device.id,
                        device_brand=brand,
                        action="Ko'chirildi (Qabul qilindi - Birlashtirildi)",
                        quantity_change=new_quantity,
                        comment=f"{instance.station.name} bekatidan ko'chirildi (Birlashtirildi). Izoh: {comment}",
                        user_name=user_name
                    )
                else:
                    log_history(
                        station=instance.station,
                        device_type=device_type,
                        device_id=matching_device.id,
                        device_brand=brand,
                        action="Tahrirlandi (Birlashtirildi)",
                        quantity_change=new_quantity,
                        comment=f"Nomi o'zgartirilishi natijasida birlashtirildi. Izoh: {comment}",
                        user_name=user_name
                    )
                    log_history(
                        station=instance.station,
                        device_type=device_type,
                        device_id=instance.id,
                        device_brand=brand,
                        action="O'chirildi (Birlashtirildi)",
                        quantity_change=-old_quantity,
                        comment=f"Nomi o'zgartirilishi natijasida birlashib ketdi. Izoh: {comment}",
                        user_name=user_name
                    )

                instance.delete()
                return Response(self.get_serializer(matching_device).data, status=200)

        # Save and call perform_update manually to keep partial flag
        self.perform_update(serializer)
        if getattr(instance, '_prefetched_objects_cache', None):
            instance._prefetched_objects_cache = {}
        return Response(serializer.data)

    def perform_create(self, serializer):
        instance = serializer.save()
        comment, user_name = self.get_comment_and_user()
        quantity = getattr(instance, 'quantity', 1)
        brand = getattr(instance, 'brand', getattr(instance, 'switch_type', 'Noma\'lum'))
        
        log_history(
            station=instance.station,
            device_type=self.get_device_type(instance),
            device_id=instance.id,
            device_brand=brand,
            action="Qo'shildi",
            quantity_change=quantity,
            comment=comment,
            user_name=user_name
        )

    def perform_update(self, serializer):
        old_instance = self.get_object()
        old_quantity = getattr(old_instance, 'quantity', 1)
        old_station = old_instance.station
        
        instance = serializer.save()
        new_quantity = getattr(instance, 'quantity', 1)
        new_station = instance.station
        
        comment, user_name = self.get_comment_and_user()
        brand = getattr(instance, 'brand', getattr(instance, 'switch_type', 'Noma\'lum'))
        device_type = self.get_device_type(instance)
        
        if old_station.id != new_station.id:
            # Item moved to another station
            log_history(
                station=old_station,
                device_type=device_type,
                device_id=instance.id,
                device_brand=brand,
                action="Ko'chirildi (Yuborildi)",
                quantity_change=-old_quantity,
                comment=f"{new_station.name} bekatiga ko'chirildi. Izoh: {comment}",
                user_name=user_name
            )
            log_history(
                station=new_station,
                device_type=device_type,
                device_id=instance.id,
                device_brand=brand,
                action="Ko'chirildi (Qabul qilindi)",
                quantity_change=new_quantity,
                comment=f"{old_station.name} bekatidan ko'chirildi. Izoh: {comment}",
                user_name=user_name
            )
        else:
            # Simple edit (quantity or brand details changed)
            qty_diff = new_quantity - old_quantity
            log_history(
                station=instance.station,
                device_type=device_type,
                device_id=instance.id,
                device_brand=brand,
                action="Tahrirlandi",
                quantity_change=qty_diff,
                comment=comment,
                user_name=user_name
            )

    def perform_destroy(self, instance):
        old_quantity = getattr(instance, 'quantity', 1)
        old_station = instance.station
        comment, user_name = self.get_comment_and_user()
        brand = getattr(instance, 'brand', getattr(instance, 'switch_type', 'Noma\'lum'))
        device_type = self.get_device_type(instance)
        
        log_history(
            station=old_station,
            device_type=device_type,
            device_id=instance.id,
            device_brand=brand,
            action="O'chirildi",
            quantity_change=-old_quantity,
            comment=comment,
            user_name=user_name
        )
        instance.delete()

    def get_device_type(self, instance):
        return instance.__class__.__name__.lower()


class MetroLineViewSet(viewsets.ModelViewSet):
    queryset = MetroLine.objects.all()
    serializer_class = MetroLineSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    pagination_class = CustomPagination


class StationViewSet(viewsets.ModelViewSet):
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['line']
    queryset = Station.objects.all()
    serializer_class = StationSerializer
    permission_classes = [AuthenticatedCRUDPermission]


class CameraViewSet(HistoryLoggedViewSet):
    queryset = Camera.objects.all()
    serializer_class = CameraSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station']


class MetalDetectorViewSet(HistoryLoggedViewSet):
    queryset = MetalDetector.objects.all()
    serializer_class = MetalDetectorSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station']


class MonitorViewSet(HistoryLoggedViewSet):
    queryset = Monitor.objects.all()
    serializer_class = MonitorSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station']


class ComputerViewSet(HistoryLoggedViewSet):
    queryset = Computer.objects.all()
    serializer_class = ComputerSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station']


class NVRViewSet(HistoryLoggedViewSet):
    queryset = NVR.objects.all()
    serializer_class = NVRSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station']


class SwitchViewSet(HistoryLoggedViewSet):
    queryset = Switch.objects.all()
    serializer_class = SwitchSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station']


class DeviceHistoryViewSet(viewsets.ModelViewSet):
    queryset = DeviceHistory.objects.all().order_by('-created_at')
    serializer_class = DeviceHistorySerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station', 'device_type']


class Stationimage(APIView):
    permission_classes = [IsAuthenticated]
    
    def put(self, request, pk):
        try:
            station = Station.objects.get(pk=pk)
        except Station.DoesNotExist:
            return Response({"error": "Bunday bekat topilmadi"}, status=404)

        image = request.FILES.get("schema_image")
        if not image:
            return Response({"error": "Rasm yuborilmadi"}, status=400)

        station.schema_image = image
        station.save()
        return Response({"message": "Rasm yangilandi", "id": station.id})


class CameraStreamViewSet(viewsets.ModelViewSet):
    """
    Kamera IP/login/parol va sxemadagi joylashuv ma'lumotlarini boshqarish.
    GET /api/camera-streams/?camera=<camera_id>  - kamera bo'yicha filter
    GET /api/camera-streams/?station=<station_id> - bekat bo'yicha barcha kamera stream lari
    """
    queryset = CameraStream.objects.select_related('camera__station').all()
    serializer_class = CameraStreamSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['camera', 'is_active']

    def get_queryset(self):
        qs = super().get_queryset()
        # Bekat bo'yicha filter qo'llab-quvvatlash
        station_id = self.request.query_params.get('station')
        if station_id:
            qs = qs.filter(camera__station_id=station_id)
        return qs


class SchemaCameraViewSet(viewsets.ModelViewSet):
    """
    Bekat sxemasidagi mustaqil kameralar.
    Camera modeliga bog'liq EMAS — alohida tizim.
    GET /api/schema-cameras/?station=<station_id>
    """
    queryset = SchemaCamera.objects.select_related('station').all()
    serializer_class = SchemaCameraSerializer
    permission_classes = [AuthenticatedCRUDPermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['station', 'is_active']

    def get_queryset(self):
        qs = super().get_queryset()
        station_id = self.request.query_params.get('station')
        if station_id:
            qs = qs.filter(station_id=station_id)
        return qs

    def perform_create(self, serializer):
        ip = (serializer.validated_data.get('ip_address') or '').strip()
        serializer.save(is_local_only=is_private_or_local_ip(ip) if ip else False)

    def perform_update(self, serializer):
        ip = (
            serializer.validated_data.get('ip_address')
            or serializer.instance.ip_address
            or ''
        ).strip()
        serializer.save(is_local_only=is_private_or_local_ip(ip) if ip else False)

    @action(detail=False, methods=['post'], url_path='test-connection')
    def test_connection(self, request):
        """
        Kamera ulanishini tekshirish.
        POST /api/schema-cameras/test-connection/
        Body: { id } yoki { ip_address, login, password, http_port, rtsp_port, stream_path }
        """
        data = request.data
        ip = (data.get('ip_address') or '').strip()

        if not ip and data.get('id'):
            try:
                cam = SchemaCamera.objects.get(pk=data['id'])
            except SchemaCamera.DoesNotExist:
                return Response(
                    {'ok': False, 'status': 'not_found', 'message': 'Kamera topilmadi'},
                    status=404,
                )
            ip = cam.ip_address
            login = data.get('login', cam.login)
            password = data.get('password', cam.password)
            http_port = data.get('http_port', cam.http_port)
            rtsp_port = data.get('rtsp_port', cam.rtsp_port)
            stream_path = data.get('stream_path', cam.stream_path)
        else:
            login = data.get('login', 'admin')
            password = data.get('password', '')
            http_port = data.get('http_port', 80)
            rtsp_port = data.get('rtsp_port', 554)
            stream_path = data.get('stream_path')

        result = test_schema_camera_connection(
            ip, login, password, http_port, rtsp_port, stream_path,
            quick=bool(data.get('quick')),
        )
        return Response(result)


def gen_frames(stream):
    import cv2
    import time
    import os
    
    rtsp_url = stream.get_rtsp_url()
    print(f"DEBUG: Starting MJPEG live stream for {rtsp_url}")
    
    # TCP transport is much more stable than UDP
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
    
    cap = cv2.VideoCapture(rtsp_url)
    if not cap.isOpened():
        print(f"DEBUG: OpenCV VideoCapture failed to open RTSP: {rtsp_url}")
        return

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.01)
                continue
            
            # Encode frame as JPEG with 70% quality to optimize network bandwidth
            ret, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            if not ret:
                continue
                
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n\r\n')
            
            # 25 FPS stream speed
            time.sleep(0.04)
    except GeneratorExit:
        print("DEBUG: Client disconnected from live stream generator.")
    except Exception as e:
        print(f"DEBUG: Exception in live stream generator: {e}")
    finally:
        cap.release()
        print("DEBUG: Released VideoCapture for stream.")


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def camera_live_snapshot(request, pk):
    """
    Kamera IP/login/paroli orqali jonli snapshot olib frontendga yuborish.
    Urinish tartibi:
      1. OpenCV (RTSP stream'dan multipart video oqimi) — real-time ko'rish uchun
      2. Hikvision POST snapshot (ISAPI / Streaming) — 405 javob berganlar uchun
      3. HTTP GET fallbacks — Dahua, ONVIF, generic
    """
    # --- Token auth ---
    user_authenticated = request.user and request.user.is_authenticated
    if not user_authenticated:
        token_str = request.GET.get('token')
        if token_str:
            from rest_framework_simplejwt.tokens import AccessToken
            try:
                AccessToken(token_str)
                user_authenticated = True
            except Exception:
                pass
    if not user_authenticated:
        return HttpResponse("Unauthorized", status=401)

    # --- Load stream config ---
    try:
        stream = CameraStream.objects.filter(camera_id=pk).first()
        if not stream:
            stream = CameraStream.objects.get(pk=pk)
    except (CameraStream.DoesNotExist, ValueError):
        return HttpResponse("Camera stream not found", status=404)

    ip   = stream.ip_address
    port = stream.http_port or 80
    rtsp_port = stream.rtsp_port or 554
    user = stream.login
    pwd  = stream.password

    # ──────────────────────────────────────────────────
    # 1. OpenCV — RTSP frame stream (if installed)
    # ──────────────────────────────────────────────────
    try:
        import cv2
        import os
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        rtsp_url = stream.get_rtsp_url()
        print(f"DEBUG: Pre-checking OpenCV RTSP connection: {rtsp_url}")
        cap = cv2.VideoCapture(rtsp_url)
        if cap.isOpened():
            import time
            ret = False
            for _ in range(20):
                ret, frame = cap.read()
                if ret and frame is not None:
                    break
                time.sleep(0.05)
            cap.release()
            if ret:
                print("DEBUG: RTSP pre-check succeeded. Starting StreamingHttpResponse.")
                return StreamingHttpResponse(gen_frames(stream), content_type='multipart/x-mixed-replace; boundary=frame')
            else:
                print("DEBUG: OpenCV opened RTSP but failed to read frame. Falling back.")
        else:
            print("DEBUG: OpenCV VideoCapture failed to open RTSP stream. Falling back.")
    except ImportError:
        print("DEBUG: OpenCV not installed. Falling back to HTTP snapshot.")
    except Exception as e:
        print(f"DEBUG: OpenCV streaming check error: {e}")

    # ──────────────────────────────────────────────────
    # 3. Hikvision POST snapshot (discovery showed 405 → URL exists, needs POST)
    # ──────────────────────────────────────────────────
    hik_post_urls = [
        f"http://{ip}:{port}/Streaming/channels/101/picture",
        f"http://{ip}:{port}/Streaming/channels/1/picture",
        f"http://{ip}:{port}/ISAPI/Streaming/channels/101/picture",
        f"http://{ip}:{port}/ISAPI/Streaming/channels/1/picture",
    ]
    auth_b64 = base64.b64encode(f"{user}:{pwd}".encode()).decode()

    for url in hik_post_urls:
        print(f"DEBUG: Hikvision POST snapshot: {url}")
        try:
            # First do a basic GET to trigger Digest challenge
            passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            passman.add_password(None, url, user, pwd)
            basic_h  = urllib.request.HTTPBasicAuthHandler(passman)
            digest_h = urllib.request.HTTPDigestAuthHandler(passman)
            opener   = urllib.request.build_opener(basic_h, digest_h)

            req = urllib.request.Request(url, data=b"", method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            req.add_header("Accept", "image/jpeg,*/*")
            req.add_header("User-Agent", "Mozilla/5.0")

            with opener.open(req, timeout=3.0) as resp:
                content_type = resp.headers.get("Content-Type", "")
                content = resp.read()
                print(f"DEBUG: Hikvision POST success from {url}. CT={content_type}, size={len(content)}")
                # If camera returned an image (even wrong content-type), return it
                if content and (b'\xff\xd8' in content[:4] or "image" in content_type):
                    return HttpResponse(content, content_type="image/jpeg")
        except urllib.error.HTTPError as e:
            print(f"DEBUG: Hikvision POST {url} → HTTP {e.code}: {e.reason}")
        except Exception as e:
            print(f"DEBUG: Hikvision POST {url} failed: {e}")

    # ──────────────────────────────────────────────────
    # 4. HTTP GET snapshot — try common paths
    # ──────────────────────────────────────────────────
    get_urls = [
        # Custom path stored in DB
        f"http://{ip}:{port}{stream.stream_path or ''}",
        # Dahua
        f"http://{ip}:{port}/cgi-bin/snapshot.cgi",
        f"http://{ip}:{port}/cgi-bin/snapshot.cgi?channel=1&subtype=0",
        # ONVIF
        f"http://{ip}:{port}/onvif/snapshot",
        f"http://{ip}:{port}/onvif-http/snapshot",
        # Generic
        f"http://{ip}:{port}/snapshot.jpg",
        f"http://{ip}:{port}/image.jpg",
    ]

    last_error = "all methods failed"
    for url in get_urls:
        if not url or url.endswith("//") or url == f"http://{ip}:{port}":
            continue
        print(f"DEBUG: GET snapshot: {url}")
        try:
            passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            passman.add_password(None, url, user, pwd)
            opener = urllib.request.build_opener(
                urllib.request.HTTPBasicAuthHandler(passman),
                urllib.request.HTTPDigestAuthHandler(passman),
            )
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0")
            with opener.open(req, timeout=2.5) as resp:
                content = resp.read()
                print(f"DEBUG: GET success from {url}. Size={len(content)}")
                return HttpResponse(content, content_type="image/jpeg")
        except Exception as e:
            last_error = str(e)
            print(f"DEBUG: GET {url} failed: {last_error}")

    print(f"FINAL: All methods failed for camera {pk}. Last: {last_error}")
    return HttpResponse(f"Connection failed: {last_error}", status=502)


def gen_frames_schema(stream):
    """SchemaCamera uchun MJPEG stream generator"""
    import cv2
    import time
    import os

    rtsp_url = stream.get_rtsp_url()
    print(f"DEBUG SchemaCamera: Starting MJPEG live stream for {rtsp_url}")

    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

    cap = cv2.VideoCapture(rtsp_url)
    if not cap.isOpened():
        print(f"DEBUG SchemaCamera: OpenCV VideoCapture failed to open RTSP: {rtsp_url}")
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

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n\r\n')
            time.sleep(0.04)
    except GeneratorExit:
        print("DEBUG SchemaCamera: Client disconnected from live stream generator.")
    except Exception as e:
        print(f"DEBUG SchemaCamera: Exception in live stream generator: {e}")
    finally:
        cap.release()
        print("DEBUG SchemaCamera: Released VideoCapture for stream.")


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def schema_camera_live_snapshot(request, pk):
    """
    SchemaCamera uchun jonli snapshot.
    GET /api/schema-cameras/<pk>/live/?token=<jwt>
    """
    # --- Token auth ---
    user_authenticated = request.user and request.user.is_authenticated
    if not user_authenticated:
        token_str = request.GET.get('token')
        if token_str:
            from rest_framework_simplejwt.tokens import AccessToken
            try:
                AccessToken(token_str)
                user_authenticated = True
            except Exception:
                pass
    if not user_authenticated:
        return HttpResponse("Unauthorized", status=401)

    try:
        stream = SchemaCamera.objects.get(pk=pk)
    except SchemaCamera.DoesNotExist:
        return HttpResponse("Schema camera not found", status=404)

    ip = stream.ip_address
    port = stream.http_port or 80
    user = stream.login
    pwd = stream.password

    # 1. OpenCV RTSP stream
    try:
        import cv2
        import os
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        rtsp_url = stream.get_rtsp_url()
        cap = cv2.VideoCapture(rtsp_url)
        if cap.isOpened():
            import time
            ret = False
            for _ in range(20):
                ret, frame = cap.read()
                if ret and frame is not None:
                    break
                time.sleep(0.05)
            cap.release()
            if ret:
                return StreamingHttpResponse(gen_frames_schema(stream), content_type='multipart/x-mixed-replace; boundary=frame')
    except ImportError:
        pass
    except Exception as e:
        print(f"DEBUG SchemaCamera: OpenCV error: {e}")

    # 2. Hikvision POST snapshot
    hik_post_urls = [
        f"http://{ip}:{port}/Streaming/channels/101/picture",
        f"http://{ip}:{port}/Streaming/channels/1/picture",
        f"http://{ip}:{port}/ISAPI/Streaming/channels/101/picture",
        f"http://{ip}:{port}/ISAPI/Streaming/channels/1/picture",
    ]
    auth_b64 = base64.b64encode(f"{user}:{pwd}".encode()).decode()

    for url in hik_post_urls:
        try:
            passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            passman.add_password(None, url, user, pwd)
            opener = urllib.request.build_opener(
                urllib.request.HTTPBasicAuthHandler(passman),
                urllib.request.HTTPDigestAuthHandler(passman)
            )
            req = urllib.request.Request(url, data=b"", method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            req.add_header("Accept", "image/jpeg,*/*")
            req.add_header("User-Agent", "Mozilla/5.0")
            with opener.open(req, timeout=3.0) as resp:
                content_type = resp.headers.get("Content-Type", "")
                content = resp.read()
                if content and (b'\xff\xd8' in content[:4] or "image" in content_type):
                    return HttpResponse(content, content_type="image/jpeg")
        except Exception:
            pass

    # 3. HTTP GET snapshot
    get_urls = [
        f"http://{ip}:{port}{stream.stream_path or ''}",
        f"http://{ip}:{port}/cgi-bin/snapshot.cgi",
        f"http://{ip}:{port}/onvif/snapshot",
        f"http://{ip}:{port}/snapshot.jpg",
        f"http://{ip}:{port}/image.jpg",
    ]
    for url in get_urls:
        if not url or url.endswith("//") or url == f"http://{ip}:{port}":
            continue
        try:
            passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            passman.add_password(None, url, user, pwd)
            opener = urllib.request.build_opener(
                urllib.request.HTTPBasicAuthHandler(passman),
                urllib.request.HTTPDigestAuthHandler(passman),
            )
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0")
            with opener.open(req, timeout=2.5) as resp:
                content = resp.read()
                return HttpResponse(content, content_type="image/jpeg")
        except Exception:
            pass

    return HttpResponse("Connection failed: all methods failed", status=502)
