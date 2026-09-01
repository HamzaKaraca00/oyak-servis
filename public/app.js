const state = {
  token: '',
  user: null,
  services: [],
  selectedServiceId: null,
  notifications: [],
  liveDriverLocation: null,
  locationWatchId: null,
  lastLocationSentAt: 0,
  seenNotificationIds: new Set(),
  notificationsEnabled: localStorage.getItem('notificationsEnabled') !== 'false'
};

const authTabs = document.querySelectorAll('.tab-button');
const authForms = document.querySelectorAll('.auth-form');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const registerRoleInput = document.getElementById('registerRole');
const roleTabButtons = document.querySelectorAll('.role-tab-button');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const serviceSelect = document.getElementById('serviceSelect');
const serviceOptionList = document.getElementById('serviceOptionList');
const joinServiceBtn = document.getElementById('joinServiceBtn');
const logoutBtn = document.getElementById('logoutBtn');
const themeToggle = document.getElementById('themeToggle');
const notificationToggle = document.getElementById('notificationToggle');
const connectionStatus = document.getElementById('connectionStatus');
const driverView = document.getElementById('driverView');
const personelView = document.getElementById('personelView');
const adminView = document.getElementById('adminView');
const adminHistoryPanel = document.getElementById('adminHistoryPanel');
const adminReportPanel = document.getElementById('adminReportPanel');
const authView = document.getElementById('authView');
const dashboardView = document.getElementById('dashboardView');
const userBadge = document.getElementById('userBadge');
const headerTitle = document.getElementById('headerTitle');
const notificationList = document.getElementById('notificationList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const liveMap = document.getElementById('liveMap');
const liveLocationStatus = document.getElementById('liveLocationStatus');
const liveLocationInfo = document.getElementById('liveLocationInfo');
const adminServiceHistoryList = document.getElementById('adminServiceHistoryList');
const adminStats = document.getElementById('adminStats');
const adminReportList = document.getElementById('adminReportList');
const adminReportDetails = document.getElementById('adminReportDetails');
const adminReportSearch = document.getElementById('adminReportSearch');
let adminReports = [];
const serviceAdminList = document.getElementById('serviceAdminList');
const serviceCodeInput = document.getElementById('serviceCodeInput');
const addServiceBtn = document.getElementById('addServiceBtn');
const shareLocationBtn = document.getElementById('shareLocationBtn');
const requestLocationBtn = document.getElementById('requestLocationBtn');
const driverStatusBox = document.getElementById('driverStatusBox');
const staffStatusBox = document.getElementById('staffStatusBox');
const driverServiceLabel = document.getElementById('driverServiceLabel');
const staffServiceLabel = document.getElementById('staffServiceLabel');
const AUTO_LOGIN_DELAY_MS = 3 * 60 * 1000;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === 'dark' ? 'Açık tema' : 'Koyu tema';
  themeToggle.setAttribute('aria-label', `${theme === 'dark' ? 'Açık' : 'Koyu'} temaya geç`);
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  connectionStatus.textContent = online ? 'Çevrimiçi' : 'Bağlantı yok';
  connectionStatus.classList.toggle('offline', !online);
}

function updateNotificationToggle() {
  const supported = 'Notification' in window;
  const enabled = supported && state.notificationsEnabled && Notification.permission !== 'denied';
  notificationToggle.textContent = enabled ? 'Bildirimler açık' : 'Bildirimleri aç';
  notificationToggle.classList.toggle('is-enabled', enabled);
  notificationToggle.disabled = !supported;
  notificationToggle.title = supported ? 'Tarayıcı bildirimlerini yönet' : 'Bu tarayıcı bildirimleri desteklemiyor';
}

applyTheme(localStorage.getItem('theme') || 'dark');
updateConnectionStatus();
updateNotificationToggle();
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', theme);
  applyTheme(theme);
});

notificationToggle.addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  state.notificationsEnabled = Notification.permission === 'granted';
  localStorage.setItem('notificationsEnabled', String(state.notificationsEnabled));
  updateNotificationToggle();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA support is optional and must not block normal app usage.
    });
  });
}

// --- Polling ------------------------------------------------------------
// Vercel's serverless functions can't hold a persistent WebSocket connection open,
// so instead of Socket.io we poll a lightweight endpoint every few seconds for new
// notifications on the selected service. This works the same on any host.
const POLL_INTERVAL_MS = 3000;
let pollTimer = null;
let lastPollTime = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function stopLocationSharing() {
    if (state.locationWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.locationWatchId);
    }
    state.locationWatchId = null;
    if (shareLocationBtn) {
      shareLocationBtn.textContent = 'Canlı Konumu Başlat';
      shareLocationBtn.classList.remove('is-success');
    }
  }

  async function publishDriverLocation(position) {
    const now = Date.now();
    if (state.lastLocationSentAt && now - state.lastLocationSentAt < 5000) return;
    const coordinates = {
      latitude: Number(position.coords.latitude.toFixed(6)),
      longitude: Number(position.coords.longitude.toFixed(6))
    };

    await sendNotification({
      serviceId: state.selectedServiceId,
      type: 'driver_location',
      label: 'Canlı Konum',
      coordinates,
      message: 'Sürücü konumu güncellendi.'
    });
    state.lastLocationSentAt = now;
    driverStatusBox.textContent = `Canlı konum paylaşılıyor • ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function startLocationSharing() {
    if (!state.selectedServiceId) {
      window.alert('Önce servis seçin.');
      return;
    }
    if (!navigator.geolocation) {
      window.alert('Bu cihaz konum bilgisini desteklemiyor.');
      return;
    }
    if (state.locationWatchId !== null) return;

    shareLocationBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await publishDriverLocation(position);
          state.locationWatchId = navigator.geolocation.watchPosition(
            (nextPosition) => {
              publishDriverLocation(nextPosition).catch((error) => {
                driverStatusBox.textContent = error.message || 'Konum güncellenemedi.';
              });
            },
            (error) => {
              driverStatusBox.textContent = `Konum takibi durdu: ${error.message}`;
              stopLocationSharing();
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
          );
          shareLocationBtn.textContent = 'Canlı Konumu Durdur';
          shareLocationBtn.classList.add('is-success');
        } catch (error) {
          driverStatusBox.textContent = error.message || 'Konum paylaşımı başlatılamadı.';
        } finally {
          shareLocationBtn.disabled = false;
        }
      },
      (error) => {
        shareLocationBtn.disabled = false;
        driverStatusBox.textContent = `Konum izni gerekli: ${error.message}`;
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }
}

function startPolling() {
  stopPolling();
  if (!state.selectedServiceId || !state.user) return;
  lastPollTime = new Date().toISOString();
  syncStoredNotifications();
  pollTimer = setInterval(pollForUpdates, POLL_INTERVAL_MS);
}

async function syncStoredNotifications() {
  try {
    const entries = await fetchJson('/api/notifications');
    entries.forEach(handleIncomingNotification);
    if (entries.length) {
      lastPollTime = entries[entries.length - 1].createdAt;
    }
  } catch (error) {
    // The regular poll will retry after a temporary connection failure.
  }
}

async function pollForUpdates() {
  if (!state.selectedServiceId || !state.user) return;

  try {
    const url = `/api/services/${state.selectedServiceId}/notifications?since=${encodeURIComponent(lastPollTime)}`;
    const entries = await fetchJson(url);
    if (entries.length) {
      lastPollTime = entries[entries.length - 1].createdAt;
      entries.forEach(handleIncomingNotification);
    }
  } catch (error) {
    // Transient network hiccups shouldn't spam the user with alerts; just skip this cycle.
  }
}

function handleIncomingNotification(payload) {
  if (!state.user) return;
  if (payload.serviceId && state.selectedServiceId && payload.serviceId !== state.selectedServiceId) return;

  if (payload.type === 'location_request') {
    if (state.user.role === 'driver') {
      driverStatusBox.textContent = `${payload.senderName || 'Personel'} konum istedi. Canlı konum paylaşın.`;
    }
    markNotificationRead(payload.id);
    return;
  }

  if (payload.type === 'driver_location' && payload.coordinates) {
    state.liveDriverLocation = payload.coordinates;
    renderLiveMap();
    if (state.user.role === 'personel') {
      const locationText = `Sürücü konumu güncellendi • ${payload.coordinates.latitude.toFixed(4)}, ${payload.coordinates.longitude.toFixed(4)}`;
      staffStatusBox.textContent = locationText;
      liveLocationInfo.textContent = `Son konum: ${payload.coordinates.latitude.toFixed(4)}, ${payload.coordinates.longitude.toFixed(4)}`;
    }
    markNotificationRead(payload.id);
    return;
  }

  const normalized = {
    id: payload.id,
    type: payload.type,
    label: payload.label || 'Servis Bildirimi',
    message: payload.message || 'Yeni bildirim',
    coordinates: payload.coordinates,
    createdAt: payload.createdAt || new Date().toISOString()
  };

  if (!normalized.id || state.seenNotificationIds.has(normalized.id)) return;
  state.seenNotificationIds.add(normalized.id);

  state.notifications = [normalized, ...state.notifications].slice(0, 8);
  renderNotifications();
  markNotificationRead(normalized.id);

  if (state.user.role === 'personel' && state.notificationsEnabled && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(normalized.label, { body: normalized.message });
  }

  if (state.user.role === 'personel') {
    const activeService = state.services.find((service) => service.id === state.selectedServiceId);
    staffStatusBox.textContent = activeService
      ? `Bağlı servis: Servis ${activeService.code} • Son bildirim: ${normalized.label}`
      : 'Bildirim alındı.';
  }
}

async function markNotificationRead(notificationId) {
  if (!notificationId) return;
  try {
    await fetchJson(`/api/notifications/${notificationId}/read`, { method: 'PATCH' });
  } catch (error) {
    // A read marker can be retried on the next sync without affecting delivery.
  }
}

async function sendNotification(payload) {
  try {
    return await fetchJson('/api/notify', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw error;
  }
}

function playFeedbackSound(success) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = success ? 660 : 180;
    gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  } catch (error) {
    // Audio is optional and must never block an action.
  }
}

function setActionFeedback(button, message, kind) {
  button.classList.remove('is-success', 'is-error');
  button.classList.add(kind === 'success' ? 'is-success' : 'is-error');
  button.dataset.feedback = button.textContent;
  button.textContent = kind === 'success' ? '✓ Gönderildi' : 'Tekrar Dene';
  driverStatusBox.textContent = message;
  window.setTimeout(() => {
    button.classList.remove('is-success', 'is-error');
    button.textContent = button.dataset.feedback;
  }, 1600);
}

async function runAdminAction(button, action, successText, afterSuccess) {
  const defaultText = button.dataset.defaultText || button.textContent;
  button.dataset.defaultText = defaultText;
  button.disabled = true;
  button.classList.add('is-loading');
  try {
    await action();
    button.classList.remove('is-loading');
    button.classList.add('is-success');
    button.textContent = `✓ ${successText}`;
    window.setTimeout(() => {
      if (afterSuccess) Promise.resolve(afterSuccess()).catch(() => {});
      button.classList.remove('is-success');
      button.textContent = defaultText;
      button.disabled = false;
    }, 1400);
  } catch (error) {
    button.classList.remove('is-loading');
    button.classList.add('is-error');
    button.textContent = 'Tekrar Dene';
    window.alert(error.message || 'İşlem başarısız.');
    window.setTimeout(() => {
      button.classList.remove('is-error');
      button.textContent = defaultText;
      button.disabled = false;
    }, 1600);
  }
}

// --- UI wiring ------------------------------------------------------------

function setAuthTab(target) {
  authTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === target));
  authForms.forEach((form) => form.classList.toggle('active', form.id === `${target}Form`));
}

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => setAuthTab(tab.dataset.tab));
});

adminLoginBtn.addEventListener('click', () => {
  setAuthTab('login');
  loginForm.elements.sicilNo.focus();
});

function getCookie(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

function authHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  const csrfToken = getCookie('payogum_csrf');
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

function updateSelectedServiceLabel() {
  const current = state.services.find((service) => service.id === state.selectedServiceId);
  const label = current ? `Servis ${current.code}` : 'Seçilmemiş';
  driverServiceLabel.textContent = label;
  staffServiceLabel.textContent = label;
}

function renderServiceOptions() {
  if (!state.services.length) {
    serviceSelect.value = '';
    serviceOptionList.innerHTML = '<span>Servis bulunmuyor</span>';
    return;
  }

  if (!state.selectedServiceId && state.user?.role === 'admin' && state.services[0]) {
    state.selectedServiceId = state.services[0].id;
  }

  const current = state.services.find((service) => service.id === state.selectedServiceId);
  serviceSelect.value = current ? `Servis ${current.code}` : '';
  renderServiceOptionList();
  updateSelectedServiceLabel();
}

function renderServiceOptionList() {
  const query = serviceSelect.value.replace(/^Servis\s*/i, '').trim().toLowerCase();
  const matches = state.services.filter((service) => String(service.code).toLowerCase().includes(query));
  serviceOptionList.innerHTML = matches.length
    ? matches.map((service) => `<button type="button" data-service-id="${escapeHtml(service.id)}">Servis ${escapeHtml(service.code)}</button>`).join('')
    : '<span>Servis bulunamadı</span>';
  serviceOptionList.hidden = false;
}

function selectService(serviceId) {
  const service = state.services.find((entry) => entry.id === serviceId);
  if (!service) return;
  if (state.selectedServiceId !== service.id) {
    stopLocationSharing();
  }
  state.selectedServiceId = service.id;
  state.liveDriverLocation = null;
  state.lastLocationSentAt = 0;
  serviceSelect.value = `Servis ${escapeHtml(service.code)}`;
  serviceOptionList.hidden = true;
  updateSelectedServiceLabel();
  startPolling();
  if (state.user?.role === 'admin') {
    renderAdminReports();
    loadAdminServiceHistory();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: authHeaders(),
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

async function loadServices() {
  const services = await fetchJson('/api/services');
  state.services = services;
  renderServiceOptions();
}

async function loadCurrentUser() {
  try {
    const user = await fetchJson('/api/me');
    state.user = user;
    state.selectedServiceId = user.serviceId || state.selectedServiceId;
    renderServiceOptions();
    if (state.selectedServiceId) {
      startPolling();
    }
  } catch (error) {
    logout();
  }
}

async function loadAdminSummary() {
  try {
    const summary = await fetchJson('/api/admin/summary');
    adminStats.innerHTML = `
      <div class="stat-card"><small>Toplam Kullanıcı</small><strong>${escapeHtml(summary.totalUsers)}</strong></div>
      <div class="stat-card"><small>Sürücü</small><strong>${escapeHtml(summary.totalDrivers)}</strong></div>
      <div class="stat-card"><small>Personel</small><strong>${escapeHtml(summary.totalStaff)}</strong></div>
      <div class="stat-card"><small>Servis</small><strong>${escapeHtml(summary.totalServices)}</strong></div>
      <div class="stat-card"><small>Bildirim</small><strong>${escapeHtml(summary.totalNotifications)}</strong></div>
    `;
  } catch (error) {
    adminStats.innerHTML = '<p>Kullanıcı yönetimi bilgisi alınamadı.</p>';
  }
}

async function loadAdminServiceHistory() {
  if (!state.selectedServiceId) {
    adminServiceHistoryList.innerHTML = '<li>Önce bir servis seçin.</li>';
    return;
  }

  try {
    const result = await fetchJson(`/api/admin/services/${state.selectedServiceId}/history`);
    renderLogs(result.history, adminServiceHistoryList);
  } catch (error) {
    adminServiceHistoryList.innerHTML = '<li>Servis geçmişi alınamadı.</li>';
  }
}

async function loadAdminServices() {
  if (state.user?.role !== 'admin') {
    serviceAdminList.innerHTML = '';
    return;
  }

  try {
    const services = await fetchJson('/api/services');
    serviceAdminList.innerHTML = services.map((service) => `
      <li class="service-row">
        <strong>Servis ${escapeHtml(service.code)}</strong>
        <div class="service-row-actions">
          <button class="refresh-btn" data-service-id="${escapeHtml(service.id)}" data-code="${escapeHtml(service.code)}">Yenile</button>
          <button class="delete-btn" data-service-id="${escapeHtml(service.id)}">Sil</button>
        </div>
      </li>
    `).join('');
  } catch (error) {
    serviceAdminList.innerHTML = '<li>Servis listesi yüklenemedi.</li>';
  }
}

async function loadAdminReports() {
  try {
    const { reports } = await fetchJson('/api/admin/reports');
    adminReports = reports;
    renderAdminReports();
  } catch (error) {
    adminReportList.innerHTML = '<p>Raporlar alınamadı.</p>';
  }
}

function renderAdminReports() {
  const query = adminReportSearch.value.trim().toLowerCase();
  const selectedReport = adminReports.find((report) => report.serviceId === state.selectedServiceId);
  const reports = query
    ? adminReports.filter((report) => String(report.serviceCode).toLowerCase().includes(query))
    : selectedReport ? [selectedReport] : [];

  adminReportList.innerHTML = reports.length ? reports.map((report) => `
      <div class="report-row">
        <strong>Servis ${escapeHtml(report.serviceCode)}</strong>
        <span>${escapeHtml(report.notificationCount)} bildirim</span>
        <button class="report-detail-btn" data-detail="unread" data-service-id="${escapeHtml(report.serviceId)}">${escapeHtml(report.unreadCount)} okunmamış</button>
        <button class="report-detail-btn" data-detail="members" data-service-id="${escapeHtml(report.serviceId)}">${escapeHtml(report.memberCount)} üye</button>
        <small>${report.lastNotificationAt ? escapeHtml(new Date(report.lastNotificationAt).toLocaleString('tr-TR')) : 'Henüz bildirim yok'}</small>
      </div>
    `).join('') : '<p>Seçilen servis için rapor bulunamadı.</p>';
}

async function loadAdminReportDetails(serviceId, detailType) {
  try {
    const result = await fetchJson(`/api/admin/services/${serviceId}/details`);
    adminReportDetails.dataset.serviceId = serviceId;
    const content = detailType === 'members'
      ? `<h5>Servis ${escapeHtml(result.service.code)} personelleri</h5>${result.members.length
        ? `<ul>${result.members.map((member) => `<li><strong>${escapeHtml(member.phone)}</strong><span>${escapeHtml(member.name)}</span></li>`).join('')}</ul>`
        : '<p>Bu servise bağlı personel yok.</p>'}`
      : `<h5>Okunmamış mesajlar</h5>${result.unreadNotifications.length
        ? `<ul>${result.unreadNotifications.map((entry) => `<li><div><strong>${escapeHtml(entry.label)}</strong><p>${escapeHtml(entry.message)}</p><small>${escapeHtml(new Date(entry.createdAt).toLocaleString('tr-TR'))}</small></div><button class="mark-admin-read" data-notification-id="${escapeHtml(entry.id)}">Okundu</button></li>`).join('')}</ul>`
        : '<p>Okunmamış mesaj yok.</p>'}`;
    adminReportDetails.innerHTML = content;
    adminReportDetails.hidden = false;
  } catch (error) {
    adminReportDetails.textContent = 'Servis detayları alınamadı.';
    adminReportDetails.hidden = false;
  }
}

function renderLogs(logs, listElement) {
  if (!logs || !logs.length) {
    listElement.innerHTML = '<li>Henüz bildirim kaydı yok.</li>';
    return;
  }

  listElement.innerHTML = logs.map((log) => `
    <li>
      <strong>${escapeHtml(log.label || 'Bildirim')} - ${escapeHtml(log.senderName || 'Sistem')}</strong>
      <div>${escapeHtml(log.message || 'Açıklama yok.')}</div>
      <small>${escapeHtml(new Date(log.createdAt).toLocaleString('tr-TR'))}</small>
    </li>
  `).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderLiveMap() {
  if (!liveMap || !state.user || state.user.role !== 'personel') {
    return;
  }

  if (!state.liveDriverLocation) {
    liveMap.innerHTML = '<div class="map-placeholder">Konum bekleniyor</div>';
    liveLocationStatus.textContent = 'Bekleniyor';
    liveLocationInfo.textContent = 'Sürücü konumu henüz paylaşılmadı.';
    return;
  }

  const lat = Number(state.liveDriverLocation.latitude);
  const lng = Number(state.liveDriverLocation.longitude);
  const x = ((lng + 180) / 360) * 100;
  const y = ((90 - lat) / 180) * 100;
  const safeX = Math.max(6, Math.min(94, x));
  const safeY = Math.max(8, Math.min(92, y));

  liveMap.innerHTML = `
    <div class="map-grid"></div>
    <div class="map-pin" style="left:${safeX}%; top:${safeY}%" title="Sürücü konumu">🚐</div>
  `;
  liveLocationStatus.textContent = 'Canlı';
  liveLocationInfo.textContent = `Son konum: ${lat.toFixed(4)} / ${lng.toFixed(4)}`;
}

function renderNotifications() {
  if (!state.notifications.length) {
    notificationList.innerHTML = '<li>Henüz bildirim alınmadı.</li>';
    return;
  }

  const visibleNotifications = state.notifications.filter((item) => item.type !== 'driver_location');
  if (!visibleNotifications.length) {
    notificationList.innerHTML = '<li>Henüz bildirim alınmadı.</li>';
    return;
  }

  notificationList.innerHTML = visibleNotifications.map((item) => `
    <li>
      <strong>${escapeHtml(item.label || 'Servis Bildirimi')}</strong>
      <div>${escapeHtml(item.message || 'Güncelleme var.')}</div>
      ${item.coordinates ? `<div>Konum: ${escapeHtml(item.coordinates.latitude.toFixed(4))}, ${escapeHtml(item.coordinates.longitude.toFixed(4))}</div>` : ''}
      <small>${escapeHtml(new Date(item.createdAt).toLocaleString('tr-TR'))}</small>
    </li>
  `).join('');
}

async function clearNotificationHistory() {
  if (!state.user) return;

  try {
    await fetchJson('/api/notifications/clear', { method: 'POST' });
    state.notifications = [];
    renderNotifications();
    staffStatusBox.textContent = 'Geçmiş temizlendi.';
  } catch (error) {
    window.alert(error.message || 'Geçmiş temizlenemedi.');
  }
}

function logout() {
  stopLocationSharing();
  stopPolling();
  localStorage.removeItem('rememberedAppOpenedAt');
  state.user = null;
  state.notifications = [];
  state.liveDriverLocation = null;
  state.lastLocationSentAt = 0;
  state.seenNotificationIds = new Set();
  fetchJson('/api/logout', { method: 'POST' }).catch(() => {});
  state.token = '';
  render();
}

function render() {
  const isLoggedIn = Boolean(state.user);

  authView.classList.toggle('active', !isLoggedIn);
  dashboardView.classList.toggle('active', isLoggedIn);

  if (!isLoggedIn) {
    return;
  }

  userBadge.textContent = `${state.user.role.toUpperCase()} • ${state.user.name}`;
  headerTitle.textContent = state.user.role === 'driver' ? 'Sürücü Kontrol Paneli' : state.user.role === 'admin' ? 'Admin Yönetim Paneli' : 'Personel Durum Paneli';

  driverView.style.display = state.user.role === 'driver' ? 'block' : 'none';
  personelView.style.display = state.user.role === 'personel' ? 'block' : 'none';
  adminView.style.display = state.user.role === 'admin' ? 'block' : 'none';
  adminHistoryPanel.style.display = state.user.role === 'admin' ? 'block' : 'none';
  adminReportPanel.style.display = state.user.role === 'admin' ? 'block' : 'none';

  if (state.user.role === 'driver') {
    if (!state.selectedServiceId) {
      driverStatusBox.textContent = 'Lütfen bir servis seçin.';
    } else {
      const activeService = state.services.find((s) => s.id === state.selectedServiceId);
      driverStatusBox.textContent = `Aktif servis: Servis ${activeService?.code || '00'}`;
    }
  }

  if (state.user.role === 'personel') {
    const activeService = state.services.find((service) => service.id === state.selectedServiceId);
    const latestMessage = state.notifications[0];
    if (!state.liveDriverLocation) {
      staffStatusBox.textContent = activeService
        ? `Bağlı servis: Servis ${activeService.code}${latestMessage ? ` • Son bildirim: ${latestMessage.label}` : ''}`
        : 'Lütfen bir servis seçin.';
    }
    renderLiveMap();
  }

  renderNotifications();
  if (state.user.role === 'admin') {
    loadAdminSummary();
    loadAdminServices();
    loadAdminReports();
    loadAdminServiceHistory();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const payload = {
    sicilNo: formData.get('sicilNo'),
    password: formData.get('password'),
    rememberMe: formData.get('rememberMe') === 'on'
  };

  try {
    const result = await fetchJson('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    state.token = '';
    state.user = result.user;
    if (payload.rememberMe) localStorage.setItem('rememberedAppOpenedAt', String(Date.now()));
    await loadServices();
    if (state.user.serviceId) {
      state.selectedServiceId = state.user.serviceId;
      renderServiceOptions();
    }
    if (state.selectedServiceId) {
      startPolling();
    }
    render();
  } catch (error) {
    window.alert(error.message || 'Giriş yapılamadı.');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const formData = new FormData(registerForm);
  const payload = {
    name: formData.get('name'),
    phone: formData.get('phone'),
    sicilNo: formData.get('sicilNo'),
    password: formData.get('password'),
    role: formData.get('role') || 'personel'
  };

  try {
    const result = await fetchJson('/api/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    state.token = '';
    state.user = result.user;
    await loadServices();
    render();
    setAuthTab('login');
  } catch (error) {
    window.alert(error.message || 'Kayıt başarısız.');
  }
}

async function joinSelectedService() {
  if (!state.selectedServiceId) {
    window.alert('Lütfen bir servis seçin.');
    return;
  }

  await runAdminAction(joinServiceBtn, async () => {
    const result = await fetchJson('/api/join-service', {
      method: 'POST',
      body: JSON.stringify({ serviceId: state.selectedServiceId })
    });

    state.user = result.user;
    startPolling();
    render();
  }, 'Bağlandı');
}

roleTabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    roleTabButtons.forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    });
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    registerRoleInput.value = button.dataset.role;
  });
});

loginForm.addEventListener('submit', handleLogin);
registerForm.addEventListener('submit', handleRegister);
joinServiceBtn.addEventListener('click', joinSelectedService);
logoutBtn.addEventListener('click', logout);
serviceSelect.addEventListener('focus', renderServiceOptionList);
serviceSelect.addEventListener('input', renderServiceOptionList);
serviceOptionList.addEventListener('click', (event) => {
  const option = event.target.closest('[data-service-id]');
  if (option) selectService(option.dataset.serviceId);
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.service-panel')) {
    serviceOptionList.hidden = true;
  }
});

adminReportSearch.addEventListener('input', renderAdminReports);


document.querySelectorAll('.action-button').forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.id === 'shareLocationBtn') return;
    const serviceId = state.selectedServiceId;
    if (!serviceId) {
      window.alert('Önce servis seçin.');
      return;
    }

    const payload = {
      serviceId,
      type: button.dataset.alert,
      label: button.dataset.label,
      message: button.dataset.message || button.dataset.label,
      senderName: state.user?.name || 'Sürücü',
      idempotencyKey: `${serviceId}:${button.dataset.alert}:${Date.now()}`
    };

    button.disabled = true;
    button.classList.add('is-loading');
    try {
      await sendNotification(payload);
      setActionFeedback(button, `${payload.label} • ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`, 'success');
      playFeedbackSound(true);
    } catch (error) {
      setActionFeedback(button, error.message || 'Bildirim gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.', 'error');
      playFeedbackSound(false);
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  });
});

document.getElementById('messageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const messageInput = document.getElementById('messageInput');
  const text = messageInput.value.trim();
  if (!text) return;

  const serviceId = state.selectedServiceId;
  if (!serviceId) {
    window.alert('Önce servis seçin.');
    return;
  }

  await sendNotification({
    serviceId,
    type: 'message',
    label: 'Özel Mesaj',
    message: text,
    senderName: state.user?.name || 'Sürücü'
  });

  messageInput.value = '';
});

requestLocationBtn.addEventListener('click', async () => {
  const serviceId = state.selectedServiceId;
  if (!serviceId) {
    window.alert('Önce servis seçin.');
    return;
  }

  await sendNotification({
    serviceId,
    type: 'location_request',
    label: 'Servisim Nerede?',
    message: `${state.user?.name || 'Personel'} konum talebinde bulundu.`,
    senderName: state.user?.name || 'Personel'
  });

  staffStatusBox.textContent = 'Servisim nerede? Konum talebi gönderildi.';
});

clearHistoryBtn.addEventListener('click', clearNotificationHistory);
shareLocationBtn.addEventListener('click', () => {
  if (state.locationWatchId === null) {
    startLocationSharing();
  } else {
    stopLocationSharing();
    driverStatusBox.textContent = 'Canlı konum paylaşımı durduruldu.';
  }
});

addServiceBtn.addEventListener('click', async () => {
  if (state.user?.role !== 'admin') {
    window.alert('Yalnızca yönetici servis ekleyebilir.');
    return;
  }

  const value = serviceCodeInput.value.trim();
  if (!value) {
    window.alert('Servis numarası girin.');
    return;
  }

  await runAdminAction(addServiceBtn, async () => {
    await fetchJson('/api/services', {
      method: 'POST',
      body: JSON.stringify({ code: value })
    });
    serviceCodeInput.value = '';
  }, 'Eklendi', async () => {
    await loadServices();
    await loadAdminServices();
    await loadAdminSummary();
  });
});

serviceAdminList.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;

  const { serviceId, code } = target.dataset;
  if (!serviceId) return;

  if (target.classList.contains('delete-btn')) {
    await runAdminAction(target, async () => {
      await fetchJson(`/api/services/${serviceId}`, { method: 'DELETE' });
    }, 'Silindi', async () => {
      await loadServices();
      await loadAdminServices();
      await loadAdminSummary();
    });
    return;
  }

  if (target.classList.contains('refresh-btn')) {
    const nextCode = window.prompt('Yeni servis numarası girin (01-99):', code || '');
    if (nextCode === null) return;

    await runAdminAction(target, async () => {
      await fetchJson(`/api/services/${serviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ code: nextCode })
      });
    }, 'Güncellendi', async () => {
      await loadServices();
      await loadAdminServices();
      await loadAdminSummary();
    });
  }
});

adminReportList.addEventListener('click', (event) => {
  const button = event.target.closest('.report-detail-btn');
  if (!button) return;
  loadAdminReportDetails(button.dataset.serviceId, button.dataset.detail);
});

adminReportDetails.addEventListener('click', async (event) => {
  const button = event.target.closest('.mark-admin-read');
  if (!button) return;
  await runAdminAction(button, async () => {
    await fetchJson(`/api/admin/notifications/${button.dataset.notificationId}/read`, { method: 'PATCH' });
    await loadAdminReports();
    await loadAdminReportDetails(button.closest('.report-details')?.dataset.serviceId || state.selectedServiceId, 'unread');
  }, 'Okundu');
});

async function init() {
  await loadServices();
  setAuthTab('login');

  try {
    const rememberedAt = Number(localStorage.getItem('rememberedAppOpenedAt') || 0);
    const canAutoLogin = rememberedAt && Date.now() - rememberedAt >= AUTO_LOGIN_DELAY_MS;
    if (canAutoLogin) await loadCurrentUser();
    await loadServices();
    render();
  } catch (error) {
    state.user = null;
    render();
  }
}

init();
