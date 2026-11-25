# Backend

NestJS API cho Chicken Guy. Chạy ở `http://localhost:4002` (development) hoặc origin Render (production).

## Biến môi trường bắt buộc

| Biến | Development | Production | Dùng cho |
| --- | --- | --- | --- |
| `FRONT` | `http://localhost:3002` | `https://chicken-hospital-gamma.vercel.app` | Origin frontend duy nhất: CORS, trusted Origin và redirect sau OAuth. Không có path. |
| `GOOGLE_CALLBACK_URL` | `http://localhost:4002/auth/google/callback` | `https://chicken-hospital-gamma.vercel.app/api/auth/google/callback` | Đường Google trả về; production phải là route `/api/...` trên Vercel để Next rewrite sang backend. |
| `BACKEND_URL` (frontend) | `http://localhost:4002` | origin backend | Next rewrite `/api/*` → backend. |

Các biến khác (`DB_*`, `*_TOKEN_SECRET`, `GOOGLE_CLIENT_*`, `S3_*`, `UPSTASH_*`, `AI_*`) phải khai báo đầy đủ;
production bắt `FRONT` + `AI_*`, secret dài tối thiểu 32 ký tự và `ACCESS_TOKEN_SECRET` ≠ `REFRESH_TOKEN_SECRET`.

## Luồng Google OAuth — Proxy (Plan A)

- Frontend mở `/api/auth/google?locale=vi|en` **trên chính origin Next.js**.
- Google redirect về **`${FRONT}/api/auth/google/callback`**; Next rewrite sang backend `/auth/google/callback`.
- Backend đặt cookie `refreshToken` (httpOnly) và `role` (đọc bởi `frontend/proxy.ts`) với `sameSite=lax`, rồi
  redirect về `${FRONT}/${locale}/${role}?auth=success`.
- Vì cùng site nên không cần `sameSite=none`. CORS/trusted origin chỉ chấp nhận `FRONT`.

> Cấu hình Google Cloud Console: authorized redirect URI = `https://chicken-hospital-gamma.vercel.app/api/auth/google/callback`.

## Lệnh

```bash
pnpm build
pnpm lint
pnpm test        # unit (vitest)
pnpm test:e2e    # cần DB/Redis
```
