# Güvenlik ve KVKK Teknik Notları

Bu proje kişisel veri işlediği için production'a alınmadan önce teknik kontrollerin yanı sıra işletmenin gerçek veri işleme süreçleri hukuk/uyum uzmanı tarafından değerlendirilmelidir.

## Production zorunlulukları

1. `NODE_ENV=production` ayarlayın.
2. En az 32 karakterlik rastgele bir `JWT_SECRET` belirleyin.
3. `KV_REST_API_URL` ve `KV_REST_API_TOKEN` ile kalıcı bir production veri deposu kullanın.
4. `ADMIN_INITIAL_PASSWORD` ile ilk yönetici hesabını güvenli bir parola ile oluşturun veya mevcut admin hesabının parolasını `ADMIN_PASSWORD` ile değiştirin.
5. HTTPS kullanın. Production'da session cookie `Secure` olarak işaretlenir.
6. Gerçek `.env` dosyasını Git'e göndermeyin.
7. `data/db.json` içindeki gerçek kişisel verileri production kaynak kodunda tutmayın; `.gitignore` ile engellenmiştir.
8. KVKK aydınlatma metnindeki köşeli parantezli alanları gerçek veri sorumlusu ve süreç bilgileriyle doldurun.

## Uygulanan teknik kontroller

- Şifreler bcrypt ile 12 cost factor kullanılarak hashlenir.
- JWT payload'ından telefon gibi kişisel veriler çıkarıldı.
- Tarayıcı oturumu HttpOnly cookie ile tutulur; localStorage'da token saklanmaz.
- Cookie tabanlı oturumlarda CSRF koruması bulunur.
- Login/kayıt rate limiting uygulanır.
- API body boyutu sınırlandırılır.
- Güvenlik HTTP header'ları eklenir.
- IDOR/BOLA için servis erişim kontrolü yapılır.
- Kullanıcı rolleri backend tarafında doğrulanır.
- Genel kullanıcı kaydıyla admin yetkisi alınamaz.
- Bildirim endpointinde servis üyeliği ve bildirim türü kontrol edilir.
- XSS riskini azaltmak için dinamik frontend çıktıları HTML escape işleminden geçirilir.
- Hassas credential'ların kaynak kodunda hard-code edilmesi kaldırıldı.

## Hukuki kapsam

Bu teknik kontroller tek başına uygulamanın "KVKK uyumlu" olduğunu göstermez. Veri işleme amaçları, hukuki sebepler, saklama süreleri, aktarım/yurt dışı aktarım süreçleri, ilgili kişi başvuruları ve gerekli aydınlatma/rıza metinleri gerçek işletme süreçlerine göre belirlenmeli ve doğrulanmalıdır.


## Production hardening applied

- Production deployments require Upstash Redis (`KV_REST_API_URL` and `KV_REST_API_TOKEN`); the local JSON database is disabled when `NODE_ENV=production`.
- Rate limiting uses Upstash Redis in production so limits are shared across serverless instances.
- API responses are marked `Cache-Control: no-store`.
- Production authentication cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, and `SameSite=Lax`.
- Security headers include CSP, HSTS (production), COOP, CORP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, and X-Permitted-Cross-Domain-Policies.
- A global API rate limit is applied in addition to stricter login/register limits.
- Never commit `.env`, Redis tokens, JWT secrets, or VAPID private keys. Use the hosting provider's encrypted environment variables.
