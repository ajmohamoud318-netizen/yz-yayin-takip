# YZ Yayın Takip — Frontend (UI)

İlk aşama: yalnızca arayüz. Backend henüz yok; Login ve Panel ekranları
`src/api.js` içindeki **mock** veri katmanı ile çalışır.

## Çalıştırma

```bash
cd client
npm install
npm run dev      # http://localhost:5173
```

## Demo hesapları (şifre: `123456`)

| E-posta                     | Rol           |
|-----------------------------|---------------|
| aysenur@yukselenzeka.com    | Takım Lideri  |
| elif@yukselenzeka.com       | Tasarımcı     |
| oktay@yukselenzeka.com      | Matbaa        |

## Şu an hazır olan ekranlar

- **Login** (`src/pages/Login.jsx`) — Türkçe arayüz, mock kimlik doğrulama, hata durumları.
- **Dashboard / Panel** (`src/pages/Dashboard.jsx`) — aylık zaman çizelgesi, proje kartları
  (aşama, atanan tasarımcı, ilerleme %), CLAUDE.md durum renkleri, Yeni/Devam Eden gruplama ve filtreler.

## Backend'e geçiş

`src/api.js` içindeki `USE_MOCK = false` yapıldığında aynı fonksiyonlar
CLAUDE.md'de tanımlı `/api/*` uçlarına gider — UI değişmeden.

> Dosya yapısı CLAUDE.md'deki yapıya birebir uygundur.
> İş kuralları CLAUDE.md'de tanımlıdır; burada hiçbir varsayım yapılmamıştır.
