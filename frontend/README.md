# Frontend

Next.js 16 + next-intl. Mọi request API từ trình duyệt đều đi qua rewrite `/api/*` của Next.js
(`next.config.ts`) tới backend, nên frontend và API **cùng một site** — cookie `refreshToken`/`role`
dùng `sameSite=lax`, không cần `none`.

## Biến môi trường

| Biến | Development | Production (Vercel) | Dùng cho |
| --- | --- | --- | --- |
| `BACKEND_URL` | `http://localhost:4002` | origin backend, vd `https://chicken-hospital.onrender.com` | rewrite `/api/:path*` → `BACKEND_URL/:path*` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3002` | `https://chicken-hospital-gamma.vercel.app` | hiển thị/điều hướng trong client |

`BACKEND_URL` phải là **origin**, không có đường dẫn `/api` (Next tự thêm `/api` khi rewrite).

## Luồng đăng nhập Google (Proxy — Plan A)

1. Trình duyệt mở `/api/auth/google?locale=vi|en` trên chính origin Vercel.
2. Google đăng nhập xong trả về **`https://chicken-hospital-gamma.vercel.app/api/auth/google/callback`**
   (đăng ký đúng đường dẫn này trong Google Cloud Console và đặt `GOOGLE_CALLBACK_URL` ở backend).
3. Next rewrite callback sang backend `/auth/google/callback`; backend đặt cookie, redirect về
   `${FRONT}/${locale}/${role}?auth=success`.
4. `AuthSyncProvider` thấy `auth=success` thì invalidate session query; mọi API gọi tiếp theo dùng `/api`.

Không gọi `/api/auth/google` bằng `fetch` — phải điều hướng cả trang (`authService.loginWithGoogle()`).

## Lệnh

```bash
pnpm dev     # http://localhost:3002
pnpm build
pnpm lint
```
