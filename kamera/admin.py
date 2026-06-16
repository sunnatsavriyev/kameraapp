from django.contrib import admin
from django.utils.safestring import mark_safe
from django.utils.translation import gettext_lazy as _
from .models import MetroLine, Station, Camera, CameraStream, SchemaCamera, MetalDetector, Monitor, Computer, NVR, Switch


# CameraStream inline - Camera admin ichida
class CameraStreamInline(admin.StackedInline):
    model = CameraStream
    extra = 0
    max_num = 1
    can_delete = True
    verbose_name = "Kamera Ulanish Ma'lumotlari"
    verbose_name_plural = "Kamera Stream"
    fieldsets = (
        ('Ulanish', {
            'fields': ('ip_address', 'login', 'password', 'rtsp_port', 'http_port', 'stream_path'),
        }),
        ('Sxemadagi Joylashuvi', {
            'fields': ('pos_x', 'pos_y', 'direction', 'label', 'is_active'),
            'description': 'Bekat sxemasida kameraning joylashuvini foizda kiriting (0-100%)'
        }),
    )

# --- Admin Inlines (Bekat ichida qurilmalarni ko'rsatish uchun) ---
class CameraInline(admin.TabularInline):
    model = Camera
    extra = 1

class MetalDetectorInline(admin.TabularInline):
    model = MetalDetector
    extra = 1

class MonitorInline(admin.TabularInline):
    model = Monitor
    extra = 1

class ComputerInline(admin.TabularInline):
    model = Computer
    extra = 1

class NVRInline(admin.TabularInline):
    model = NVR
    extra = 1

class SwitchInline(admin.TabularInline):
    model = Switch
    extra = 1


@admin.register(MetroLine)
class MetroLineAdmin(admin.ModelAdmin):
    list_display = ['id', 'name']
    search_fields = ['name']


@admin.register(Station)
class StationAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'line', 'schema_image_display']
    list_filter = ['line']
    search_fields = ['name']
    
    # Bekat sahifasiga hamma qurilmalarni qo'shish
    inlines = [CameraInline, MetalDetectorInline, MonitorInline, ComputerInline, NVRInline, SwitchInline]

    def schema_image_display(self, obj):
        if obj.schema_image:
            # Django'ning yangi versiyalarida xavfsizlik uchun mark_safe() ishlatgan yaxshiroq
            return mark_safe(f"<img src='{obj.schema_image.url}' width='100' height='60' style='object-fit:cover;' />")
        return "Yo'q"
    schema_image_display.short_description = "Sxema rasmi"


# Qurilmalarni alohida ham boshqarish imkoniyati (ixtiyoriy, qulaylik uchun)
@admin.register(Camera)
class CameraAdmin(admin.ModelAdmin):
    list_display = ['id', 'brand', 'camera_type', 'quantity', 'station', 'has_stream']
    list_filter = ['station', 'camera_type']
    search_fields = ['brand', 'station__name']
    inlines = [CameraStreamInline]

    def has_stream(self, obj):
        return hasattr(obj, 'stream_info') and obj.stream_info is not None
    has_stream.boolean = True
    has_stream.short_description = "Stream"


@admin.register(CameraStream)
class CameraStreamAdmin(admin.ModelAdmin):
    list_display = ['id', 'get_camera_station', 'get_camera_brand', 'ip_address', 'label', 'pos_x', 'pos_y', 'is_active']
    list_filter = ['is_active', 'camera__station']
    search_fields = ['ip_address', 'label', 'camera__brand', 'camera__station__name']
    readonly_fields = ['created_at', 'updated_at']
    list_editable = ['pos_x', 'pos_y', 'is_active']
    fieldsets = (
        ('Kamera', {
            'fields': ('camera',)
        }),
        ('Ulanish Sozlamalari', {
            'fields': ('ip_address', 'login', 'password', 'rtsp_port', 'http_port', 'stream_path')
        }),
        ("Sxemadagi Joylashuvi", {
            'fields': ('pos_x', 'pos_y', 'direction', 'label', 'is_active'),
            'description': '0-100% oralig\'ida kiriting. (0,0) = chap yuqori burchak'
        }),
        ('Tizim', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )

    def get_camera_station(self, obj):
        return obj.camera.station.name
    get_camera_station.short_description = "Bekat"

    def get_camera_brand(self, obj):
        return obj.camera.brand
    get_camera_brand.short_description = "Kamera brendi"


admin.site.register(MetalDetector)
admin.site.register(Monitor)
admin.site.register(Computer)
admin.site.register(NVR)
admin.site.register(Switch)


@admin.register(SchemaCamera)
class SchemaCameraAdmin(admin.ModelAdmin):
    list_display = ['id', 'station', 'position_number', 'label', 'ip_address', 'pos_x', 'pos_y', 'is_active']
    list_filter = ['is_active', 'station']
    search_fields = ['ip_address', 'label', 'station__name']
    readonly_fields = ['created_at', 'updated_at']
    list_editable = ['pos_x', 'pos_y', 'is_active']
    fieldsets = (
        ('Asosiy', {
            'fields': ('station', 'position_number', 'label')
        }),
        ('Ulanish Sozlamalari', {
            'fields': ('ip_address', 'login', 'password', 'rtsp_port', 'http_port', 'stream_path')
        }),
        ("Sxemadagi Joylashuvi", {
            'fields': ('pos_x', 'pos_y', 'direction', 'is_active'),
            'description': '0-100% oralig\'ida kiriting.'
        }),
        ('Tizim', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )