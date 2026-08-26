document.addEventListener('DOMContentLoaded', async () => {
    let csrfToken = '';

    // 1. Sayfa yüklendiğinde sunucudan güncel CSRF Token'ı al
    async function fetchCsrfToken() {
        try {
            const response = await fetch('/api/csrf-token', {
                credentials: 'include' // Cookie iletimini sağlar
            });
            const data = await response.json();
            csrfToken = data.csrfToken;
        } catch (err) {
            console.error('CSRF token alınamadı:', err);
        }
    }

    await fetchCsrfToken();

    // 2. Örnek Form / API Gönderimi
    const form = document.querySelector('form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(form);
            const payload = Object.fromEntries(formData.entries());

            try {
                const response = await fetch('/api/submit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'CSRF-Token': csrfToken // Token header olarak gönderiliyor
                    },
                    credentials: 'include', // Cookie Vercel'e iletiliyor
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (response.ok) {
                    alert('Başarılı!');
                } else {
                    alert(`Hata: ${result.message || 'İşlem başarısız'}`);
                }
            } catch (err) {
                console.error('İstek hatası:', err);
            }
        });
    }
});