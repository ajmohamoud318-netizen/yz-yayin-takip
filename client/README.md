# YZ Yayın Takip — Frontend (SPA)

React + Vite SPA talking to the Fastify backend (see `../server/`). No
in-browser data layer — every action goes through the API.

## Çalıştırma

```bash
cd client
npm install
npm run dev      # http://localhost:5173  (Vite proxies /api → :4000)
```

Start the backend in another terminal:

```bash
docker compose up --build      # postgres + api on :4000
```

## Demo hesapları

Demo users are seeded by the backend on first boot (`server/db/seed/users.js`).
Default password is `123456` for every seeded account.

## Ekranlar

- **Login** (`src/pages/Login.jsx`) — email + password against `/api/auth/login`.
- **Dashboard / Panel** (`src/pages/Dashboard.jsx`) — aylık zaman çizelgesi,
  proje kartları (aşama, atanan tasarımcı, ilerleme %), CLAUDE.md durum
  renkleri, Yeni/Devam Eden gruplama ve filtreler.

> Dosya yapısı CLAUDE.md'deki yapıya birebir uygundur.
> İş kuralları CLAUDE.md'de tanımlıdır; burada hiçbir varsayım yapılmamıştır.
