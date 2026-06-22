# Desktop / Local Agent — qo'llanma

Stansiya kompyuterida **192.168**, **10.x**, **11.x**, **22.x** kabi lokal IP li kameralarni ko'rish uchun.

## Arxitektura

| Qism | Vazifa |
|------|--------|
| **Online server** (Django) | `http://88.88.0.151:8090` — metadata, 88.x kameralar |
| **Local Agent** (`127.0.0.1:8765`) | Lokal kameralarga RTSP/HTTP ulanish |
| **Frontend** (brauzer/desktop) | UI — avtomatik agent/server tanlaydi |

## 1. O'rnatish

```powershell
cd d:\Sunnat\projects\kameraapp
pip install -r requirements.txt
python manage.py migrate
```

## 2. Local Agent ishga tushirish

```powershell
.\scripts\start-local-agent.ps1
```

Yoki qo'lda:

```powershell
$env:SERVER_API_URL = "http://YOUR-SERVER:8000"
python -m local_agent.main
```

Health: http://127.0.0.1:8765/health

## 3. Desktop rejim (Agent + Frontend)

```powershell
.\scripts\start-desktop.ps1
```

Bu:
1. Local Agent ni ishga tushiradi
2. Frontend ni `VITE_APP_MODE=desktop` bilan ochadi

## 4. Server bilan sync

1. Online serverga login qiling (brauzer)
2. Local Agent ishlayotgan bo'lsa, yuqorida **"Local Agent faol"** ko'rinadi
3. **Serverdan sync** tugmasini bosing — kameralar cache ga yuklanadi

Offline: cache dagi kameralar agent orqali ishlaydi.

## 5. Frontend `.env` (ixtiyoriy)

```
VITE_API_BASE_URL=http://88.88.0.151:8090
VITE_LOCAL_AGENT_URL=http://127.0.0.1:8765
VITE_SERVER_API_URL=http://88.88.0.151:8090
VITE_APP_MODE=desktop
```

## 6. IP qoidalari

- **Lokal IP** (192.168, 10, 11, 22, 172.16–31): server `local_only` status qaytaradi, saqlash mumkin
- **Live stream**: faqat Local Agent yoki brauzer directConnect (HTTP snapshot)
- **Ommaviy IP** (masalan 88.x): server to'g'ridan stream qiladi

## 7. To'liq offline (faqat lokal Django)

Agar internet bo'lmasa, bir PC da:

```powershell
python manage.py runserver 0.0.0.0:8000
cd frontend
npm run dev
```

Kameralar va stansiyalar shu lokal bazada bo'ladi.

## Muammolar

| Muammo | Yechim |
|--------|--------|
| Local Agent yo'q | `start-local-agent.ps1` ishga tushiring |
| Lokal kamera LIVE emas | PC kamera bilan bir tarmoqda ekanini tekshiring |
| Sync xato | Token va SERVER_API_URL to'g'riligini tekshiring |
| OpenCV xato | `pip install opencv-python-headless` |
