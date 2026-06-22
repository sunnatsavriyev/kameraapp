from rest_framework import serializers
from .models import MetroLine, Station, Camera, CameraStream, SchemaCamera, MetalDetector, Monitor, Computer, NVR, Switch, DeviceHistory


class CameraStreamSerializer(serializers.ModelSerializer):
    rtsp_url = serializers.SerializerMethodField()

    class Meta:
        model = CameraStream
        fields = [
            'id', 'camera', 'ip_address', 'login', 'password',
            'rtsp_port', 'http_port', 'stream_path',
            'pos_x', 'pos_y', 'direction', 'label', 'is_active',
            'rtsp_url', 'created_at', 'updated_at'
        ]
        extra_kwargs = {
            'password': {'write_only': False}  # frontend uchun o'qiladi
        }

    def get_rtsp_url(self, obj):
        return obj.get_rtsp_url()


class SchemaCameraSerializer(serializers.ModelSerializer):
    """Bekat sxemasidagi mustaqil kamera serializer"""
    rtsp_url = serializers.SerializerMethodField()

    class Meta:
        model = SchemaCamera
        fields = [
            'id', 'station', 'position_number', 'label',
            'ip_address', 'login', 'password',
            'rtsp_port', 'http_port', 'stream_path',
            'pos_x', 'pos_y', 'direction', 'is_active', 'is_local_only',
            'rtsp_url', 'created_at', 'updated_at'
        ]
        extra_kwargs = {
            'password': {'write_only': False}
        }

    def get_rtsp_url(self, obj):
        return obj.get_rtsp_url()


# --- Qurilmalar Serializerlari ---
class CameraSerializer(serializers.ModelSerializer):
    stream_info = CameraStreamSerializer(read_only=True)

    class Meta:
        model = Camera
        fields = ['id', 'station', 'brand', 'camera_type', 'quantity', 'stream_info']

class MetalDetectorSerializer(serializers.ModelSerializer):
    class Meta:
        model = MetalDetector
        fields = '__all__'

class MonitorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Monitor
        fields = '__all__'

class ComputerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Computer
        fields = '__all__'

class NVRSerializer(serializers.ModelSerializer):
    class Meta:
        model = NVR
        fields = '__all__'

class SwitchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Switch
        fields = '__all__'

class DeviceHistorySerializer(serializers.ModelSerializer):
    station_name = serializers.CharField(source='station.name', read_only=True)

    class Meta:
        model = DeviceHistory
        fields = '__all__'


# --- Asosiy Serializerlar ---
class StationSerializer(serializers.ModelSerializer):
    line_name = serializers.CharField(source='line.name', read_only=True)
    schema_image = serializers.SerializerMethodField()

    # Bekatga kirganda ichidagi hamma narsani ko'rish uchun munosabatlar:
    cameras = CameraSerializer(many=True, read_only=True)
    metal_detectors = MetalDetectorSerializer(many=True, read_only=True)
    monitors = MonitorSerializer(many=True, read_only=True)
    computers = ComputerSerializer(many=True, read_only=True)
    nvrs = NVRSerializer(many=True, read_only=True)
    switches = SwitchSerializer(many=True, read_only=True)
    device_histories = DeviceHistorySerializer(many=True, read_only=True)
    schema_cameras_count = serializers.SerializerMethodField()

    def get_schema_image(self, obj):
        if not obj.schema_image:
            return None
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.schema_image.url)
        # Fallback: return the URL path directly
        return obj.schema_image.url

    def get_schema_cameras_count(self, obj):
        return obj.schema_cameras.count()

    class Meta:
        model = Station
        fields = [
            'id', 'name', 'line', 'line_name', 'schema_image',
            'cameras', 'metal_detectors', 'monitors', 'computers', 'nvrs', 'switches',
            'device_histories', 'schema_cameras_count'
        ]


class MetroLineSerializer(serializers.ModelSerializer):
    # Agar liniya ichida bekatlarni ham chiqarmoqchi bo'lsangiz quyidagidan foydalaning (ixtiyoriy):
    # stations = StationSerializer(many=True, read_only=True)

    class Meta:
        model = MetroLine
        fields = ['id', 'name']