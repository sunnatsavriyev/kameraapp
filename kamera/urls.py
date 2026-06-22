from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)

from .views import (
    MetroLineViewSet, StationViewSet, CameraViewSet,
    MetalDetectorViewSet, MonitorViewSet, ComputerViewSet,
    NVRViewSet, SwitchViewSet, DeviceHistoryViewSet, Stationimage, get_me, run_migrations,
    CameraStreamViewSet, camera_live_snapshot, camera_discover_url,
    SchemaCameraViewSet, schema_camera_live_snapshot, sync_pull
)

router = DefaultRouter()
router.register(r'metro-lines', MetroLineViewSet, basename='metro-line')
router.register(r'stations', StationViewSet, basename='station')
router.register(r'cameras', CameraViewSet, basename='camera')
router.register(r'camera-streams', CameraStreamViewSet, basename='camera-stream')
router.register(r'schema-cameras', SchemaCameraViewSet, basename='schema-camera')
router.register(r'metal-detectors', MetalDetectorViewSet, basename='metal-detector')
router.register(r'monitors', MonitorViewSet, basename='monitor')
router.register(r'computers', ComputerViewSet, basename='computer')
router.register(r'nvrs', NVRViewSet, basename='nvr')
router.register(r'switches', SwitchViewSet, basename='switch')
router.register(r'device-histories', DeviceHistoryViewSet, basename='device-history')

urlpatterns = [
    path('api/get-me/', get_me, name='get_me'),
    path('api/sync/pull/', sync_pull, name='sync_pull'),
    path('api/migrate/', run_migrations, name='run_migrations'),
    path('api/camera-streams/<int:pk>/live/', camera_live_snapshot, name='camera_live_snapshot'),
    path('api/camera-streams/<int:pk>/discover/', camera_discover_url, name='camera_discover_url'),
    path('api/schema-cameras/<int:pk>/live/', schema_camera_live_snapshot, name='schema_camera_live_snapshot'),

    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/stations/<int:pk>/upload-image/', Stationimage.as_view(), name='station-image'),
    path('api/', include(router.urls)),
]