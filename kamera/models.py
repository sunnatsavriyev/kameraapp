from django.db import models
from django.core.validators import FileExtensionValidator


# Create your models here.
class MetroLine(models.Model):
    name = models.CharField(max_length=100, unique=True,null=True)

    def __str__(self):
        return str(self.name or "No name")

 

class Station(models.Model):
    name = models.CharField(max_length=100,null=True,blank=True)
    line = models.ForeignKey(MetroLine, on_delete=models.SET_NULL, related_name='stations', null=True, blank=True)
    schema_image = models.FileField(
        upload_to='station_schemas/',
        validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png', 'pdf'])],
        null=True,
        blank=True,
        help_text="Bekat sxemasi (rasm yoki PDF)"
    )
    def __str__(self):
        return f"{self.name} ({self.line.name})" if self.line and self.line.name else self.name or "No name"
    
    
    
    
    
class Camera(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='cameras')
    brand = models.CharField(max_length=100, verbose_name="Brendi")
    camera_type = models.CharField(max_length=100, verbose_name="Turi (IP, Analog va h.k.)")
    quantity = models.PositiveIntegerField(default=0, verbose_name="Soni")

    def __str__(self):
        return f"Kamera: {self.brand} - {self.station.name}"


class CameraStream(models.Model):
    """Kamera ulanish ma'lumotlari va sxemadagi pozitsiyasi"""
    camera = models.OneToOneField(
        Camera,
        on_delete=models.CASCADE,
        related_name='stream_info',
        verbose_name="Kamera"
    )
    ip_address = models.CharField(
        max_length=255,
        verbose_name="IP manzil",
        help_text="Masalan: 192.168.1.100 yoki rtsp://192.168.1.100:554/stream"
    )
    login = models.CharField(
        max_length=100,
        verbose_name="Login",
        default="admin"
    )
    password = models.CharField(
        max_length=100,
        verbose_name="Parol"
    )
    rtsp_port = models.IntegerField(
        default=554,
        verbose_name="RTSP Port"
    )
    http_port = models.IntegerField(
        default=80,
        verbose_name="HTTP Port"
    )
    stream_path = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        default="/Streaming/Channels/101",
        verbose_name="Stream yo'li",
        help_text="Masalan: /stream1 yoki /video/ch0_0"
    )
    # Bekat sxemasidagi pozitsiya (foiz, 0-100)
    pos_x = models.FloatField(
        default=50.0,
        verbose_name="X pozitsiya (%)",
        help_text="Sxema rasmida kameraning gorizontal joyi (0-100%)"
    )
    pos_y = models.FloatField(
        default=50.0,
        verbose_name="Y pozitsiya (%)",
        help_text="Sxema rasmida kameraning vertikal joyi (0-100%)"
    )
    # Kamera ko'rish burchagi (gradus)
    direction = models.IntegerField(
        default=0,
        verbose_name="Yo'nalish (gradus)",
        help_text="0=o'ng, 90=quyi, 180=chap, 270=yuqori"
    )
    label = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        verbose_name="Yorliq",
        help_text="Kamera uchun qisqa nom (masalan: Kirish, Platforma-1)"
    )
    is_active = models.BooleanField(
        default=True,
        verbose_name="Faol"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def get_rtsp_url(self):
        path = self.stream_path or '/Streaming/Channels/101'
        return f"rtsp://{self.login}:{self.password}@{self.ip_address}:{self.rtsp_port}{path}"

    def get_http_snapshot_url(self):
        return f"http://{self.ip_address}:{self.http_port}/snapshot.jpg"

    def __str__(self):
        return f"Stream: {self.camera.brand} @ {self.ip_address} ({self.camera.station.name})"


class SchemaCamera(models.Model):
    """
    Bekat sxemasiga qo'yiladigan kamera.
    Bu model umumiy Camera modelidan BUTUNLAY MUSTAQIL.
    Umumiy kameralar (Camera) inventar uchun — soni, brendi.
    SchemaCamera esa sxemadagi aniq kamera — IP, joy raqami, pozitsiya.
    """
    station = models.ForeignKey(
        Station,
        on_delete=models.CASCADE,
        related_name='schema_cameras',
        verbose_name="Bekat"
    )
    position_number = models.IntegerField(
        verbose_name="Joy raqami",
        help_text="Sxemadagi kameraning tartib raqami (masalan: 1, 2, 3...)"
    )
    label = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        verbose_name="Yorliq/Nomi",
        help_text="Kamera uchun qisqa nom (masalan: Kirish, Platforma-1)"
    )
    ip_address = models.CharField(
        max_length=255,
        verbose_name="IP manzil",
        help_text="Masalan: 192.168.1.100"
    )
    login = models.CharField(
        max_length=100,
        verbose_name="Login",
        default="admin"
    )
    password = models.CharField(
        max_length=100,
        verbose_name="Parol"
    )
    rtsp_port = models.IntegerField(
        default=554,
        verbose_name="RTSP Port"
    )
    http_port = models.IntegerField(
        default=80,
        verbose_name="HTTP Port"
    )
    stream_path = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        default="/Streaming/Channels/101",
        verbose_name="Stream yo'li"
    )
    # Bekat sxemasidagi pozitsiya (foiz, 0-100)
    pos_x = models.FloatField(
        default=50.0,
        verbose_name="X pozitsiya (%)"
    )
    pos_y = models.FloatField(
        default=50.0,
        verbose_name="Y pozitsiya (%)"
    )
    direction = models.IntegerField(
        default=0,
        verbose_name="Yo'nalish (gradus)"
    )
    is_active = models.BooleanField(
        default=True,
        verbose_name="Faol"
    )
    is_local_only = models.BooleanField(
        default=False,
        verbose_name="Faqat lokal tarmoq",
        help_text="Lokal IP — stream stansiya PC (Local Agent) orqali"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def get_rtsp_url(self):
        path = self.stream_path or '/Streaming/Channels/101'
        return f"rtsp://{self.login}:{self.password}@{self.ip_address}:{self.rtsp_port}{path}"

    def get_http_snapshot_url(self):
        return f"http://{self.ip_address}:{self.http_port}/snapshot.jpg"

    def __str__(self):
        return f"SchemaCamera #{self.position_number} @ {self.ip_address} ({self.station.name})"

    class Meta:
        ordering = ['position_number']
        verbose_name = "Sxema Kamerasi"
        verbose_name_plural = "Sxema Kameralari"


class MetalDetector(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='metal_detectors')
    brand = models.CharField(max_length=100, null=True, blank=True, verbose_name="Brendi")
    quantity = models.PositiveIntegerField(default=0, verbose_name="Soni")

    def __str__(self):
        return f"Metallodetektor - {self.station.name}"


class Monitor(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='monitors')
    brand = models.CharField(max_length=100, verbose_name="Markasi/Brendi")
    size = models.CharField(max_length=50, verbose_name="O'lchami (dyuym)")
    quantity = models.PositiveIntegerField(default=0, verbose_name="Soni")

    def __str__(self):
        return f"Monitor: {self.brand} ({self.size}) - {self.station.name}"


class Computer(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='computers')
    brand = models.CharField(max_length=100, null=True, blank=True, verbose_name="Brendi/Modeli")
    quantity = models.PositiveIntegerField(default=0, verbose_name="Soni")

    def __str__(self):
        return f"Kompyuter - {self.station.name}"


class NVR(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='nvrs')
    brand = models.CharField(max_length=100, verbose_name="Brendi")
    model_name = models.CharField(max_length=100, verbose_name="Modeli")
    ports_count = models.PositiveIntegerField(verbose_name="Portlar soni")
    quantity = models.PositiveIntegerField(default=0, verbose_name="Soni")

    def __str__(self):
        return f"NVR: {self.brand} ({self.ports_count} ports) - {self.station.name}"


class Switch(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='switches')
    switch_type = models.CharField(max_length=100, verbose_name="Turi (PoE, Oddiy va h.k.)")
    ports_count = models.PositiveIntegerField(verbose_name="Portlar soni")
    features = models.TextField(null=True, blank=True, verbose_name="Xususiyati/Tavsifi")
    quantity = models.PositiveIntegerField(default=0, verbose_name="Soni")

    def __str__(self):
        return f"Switch: {self.switch_type} ({self.ports_count} ports) - {self.station.name}"


class DeviceHistory(models.Model):
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name='device_histories')
    device_type = models.CharField(max_length=50, verbose_name="Qurilma turi") # camera, monitor, computer, nvr, switch, metal_detector
    device_id = models.IntegerField(null=True, blank=True, verbose_name="Qurilma ID")
    device_brand = models.CharField(max_length=100, null=True, blank=True, verbose_name="Qurilma brendi")
    action = models.CharField(max_length=50, verbose_name="Harakat turi") # 'Qo\'shildi', 'O\'chirildi', 'Tahrirlandi', 'Ko\'chirildi'
    quantity_change = models.IntegerField(default=0, verbose_name="Soni o'zgarishi")
    comment = models.TextField(null=True, blank=True, verbose_name="Izoh/Komentariya")
    user_name = models.CharField(max_length=150, null=True, blank=True, verbose_name="Foydalanuvchi")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Vaqti")

    def __str__(self):
        return f"{self.station.name} - {self.device_type} - {self.action} ({self.created_at})"