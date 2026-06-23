# Kameraapp — Desktop (Local Agent)

Toshkent Metropoliteni kameralar nazorat tizimi — **stansiya kompyuterida** ishlaydigan versiya.

- **88.88.x.x** kameralar — online server orqali (`http://88.88.0.151:8090`)
- **192.168.x.x** va boshqa lokal IP — **Local Agent** orqali (faqat kamera bilan bir tarmoqda)

## Rejimlar

| Rejim | Ishga tushirish | 88.88.x.x | 192.168.x.x |
|-------|-----------------|-----------|-------------|
| **Desktop** | `start-desktop.bat` | Server orqali (proxy) | Local Agent (bir tarmoq) |
| **Online** | Server brauzeri | Server to'g'ridan | Faqat "lokal" deb ko'rsatiladi |

## Tez boshlash (Windows)

```powershell
git clone https://github.com/sunnatsavriyev/kameraapp.git
cd kameraapp
pip install -r requirements.txt
copy frontend\.env.example frontend\.env
.\start-desktop.bat
```

Brauzer: **http://localhost:5173**

Batafsil: [DESKTOP.md](DESKTOP.md)

## Repo farqi

| Repo | Maqsad |
|------|--------|
| [kameraapp](https://github.com/sunnatsavriyev/kameraapp) | Desktop + Local Agent (stansiya PC) |
| [kamerapp](https://github.com/sunnatsavriyev/kamerapp) | Online server + brauzer versiyasi |
