const state = {
  token: '',
  user: null,
  services: [],
  selectedServiceId: null,
  notifications: [],
  seenNotificationIds: new Set(),
  notificationsEnabled: localStorage.getItem('notificationsEnabled') !== 'false',
  expandedLocationMapIds: new Set(),
  activeLocationMapId: null
};

const globalLoading = document.getElementById('globalLoading');
let loadingStartedAt = Date.now();
let loadingHideTimer = null;

function showGlobalLoading() {
  if (loadingHideTimer) window.clearTimeout(loadingHideTimer);
  loadingStartedAt = Date.now();
  globalLoading.classList.remove('is-hidden');
  globalLoading.setAttribute('aria-busy', 'true');
}

function hideGlobalLoading() {
  const remaining = Math.max(0, 1200 - (Date.now() - loadingStartedAt));
  loadingHideTimer = window.setTimeout(() => {
    globalLoading.classList.add('is-hidden');
    globalLoading.setAttribute('aria-busy', 'false');
  }, remaining);
}

showGlobalLoading();

const authTabs = document.querySelectorAll('.tab-button');
const authForms = document.querySelectorAll('.auth-form');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const registerRoleInput = document.getElementById('registerRole');
const roleTabButtons = document.querySelectorAll('.role-tab-button');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const servicePanel = document.getElementById('servicePanel');
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
const adminServiceHistoryList = document.getElementById('adminServiceHistoryList');
const adminStats = document.getElementById('adminStats');
const adminReportList = document.getElementById('adminReportList');
const adminReportDetails = document.getElementById('adminReportDetails');
const adminReportSearch = document.getElementById('adminReportSearch');
let adminReports = [];
const serviceAdminList = document.getElementById('serviceAdminList');
const serviceCodeInput = document.getElementById('serviceCodeInput');
const addServiceBtn = document.getElementById('addServiceBtn');
const adminMessageForm = document.getElementById('adminMessageForm');
const adminMessageTarget = document.getElementById('adminMessageTarget');
const adminMessageSendBtn = document.getElementById('adminMessageSendBtn');
const adminCleanupBtn = document.getElementById('adminCleanupBtn');
const memberEditModal = document.getElementById('memberEditModal');
const memberEditForm = document.getElementById('memberEditForm');
const memberEditSaveBtn = document.getElementById('memberEditSaveBtn');
const toastContainer = document.getElementById('toastContainer');
const locationModal = document.getElementById('locationModal');
const locationModalMeta = document.getElementById('locationModalMeta');
const locationModalStatus = document.getElementById('locationModalStatus');
const locationMapImage = document.getElementById('locationMapImage');
const locationModalExternalLink = document.getElementById('locationModalExternalLink');
const locationModalCloseBtn = document.getElementById('locationModalCloseBtn');
const shareLocationBtn = document.getElementById('shareLocationBtn');
const requestLocationBtn = document.getElementById('requestLocationBtn');
const driverStatusBox = document.getElementById('driverStatusBox');
const staffStatusBox = document.getElementById('staffStatusBox');
const driverServiceLabel = document.getElementById('driverServiceLabel');
const staffServiceLabel = document.getElementById('staffServiceLabel');
const AUTO_LOGIN_DELAY_MS = 3 * 60 * 1000;
const DRIVER_LOCATION_BROADCAST_MS = 10 * 60 * 1000;
let liveLocationBroadcastTimer = null;
let driverBroadcastServiceId = null;

function stopLiveLocationBroadcast() {
  if (liveLocationBroadcastTimer) {
    clearInterval(liveLocationBroadcastTimer);
    liveLocationBroadcastTimer = null;
  }
  driverBroadcastServiceId = null;
}

// Only (re)arms the repeating timer — does not send a location itself. Kept
// separate from startDriverLocationBroadcast so a manual "Canlı Konum Paylaş"
// send can reset the 10-minute clock without also firing a second, duplicate
// location update in the same moment.
function armLiveLocationInterval() {
  if (liveLocationBroadcastTimer) clearInterval(liveLocationBroadcastTimer);
  liveLocationBroadcastTimer = window.setInterval(() => {
    sendDriverLocationUpdate().catch(() => {});
  }, DRIVER_LOCATION_BROADCAST_MS);
}

async function sendDriverLocationUpdate() {
  if (!state.selectedServiceId || !state.user || state.user.role !== 'driver') return;

  if (!navigator.geolocation) return;

  await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(async (position) => {
      const coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      try {
        const locationLabel = await resolveLocationLabel(coordinates.latitude, coordinates.longitude);
        const message = locationLabel
          ? `Konum paylaşıldı: ${locationLabel}`
          : `Konum paylaşıldı: ${formatCoordinateFallback(coordinates.latitude, coordinates.longitude)}`;

        await sendNotification({
          serviceId: state.selectedServiceId,
          type: 'driver_location',
          label: 'Canlı Konum',
          senderName: state.user?.name || 'Sürücü',
          coordinates,
          locationLabel,
          message
        });
        driverStatusBox.textContent = `Canlı konum paylaşıldı • ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
      } catch (error) {
        // Silent retry on next cycle; avoid spamming the user with repeated failures.
      }
      resolve();
    }, () => {
      resolve();
    }, { enableHighAccuracy: true, timeout: 15000 });
  });
}

async function startDriverLocationBroadcast() {
  if (!state.user || state.user.role !== 'driver' || !navigator.geolocation) return;
  if (!state.selectedServiceId) return;

  // Idempotent: render() can call this many times per session (login, service
  // selection, every poll-triggered re-render, etc). Without this guard, each
  // of those calls would restart the timer AND fire an immediate extra send —
  // which is exactly what caused the duplicate location broadcasts.
  if (liveLocationBroadcastTimer && driverBroadcastServiceId === state.selectedServiceId) return;

  try {
    if (navigator.permissions && navigator.permissions.query) {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state !== 'granted') return;
    }
  } catch (error) {
    // Browsers without permission API should still work when geolocation is otherwise allowed.
  }

  driverBroadcastServiceId = state.selectedServiceId;
  await sendDriverLocationUpdate();
  armLiveLocationInterval();
}

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

async function handleIncomingNotification(payload) {
  if (!state.user) return;
  // Require an exact serviceId match (not just "match when both are set") so
  // a notification can never be shown to someone on a different service —
  // if either side is missing/unknown, treat it as not-a-match rather than
  // letting it through by default.
  if (payload.serviceId !== state.selectedServiceId) return;

  if (payload.type === 'location_request') {
    if (state.user.role === 'driver') {
      driverStatusBox.textContent = `${payload.senderName || 'Personel'} konum istedi. Canlı konum paylaşın.`;
    }
    markNotificationRead(payload.id);
    return;
  }

  const locationLabel = payload.locationLabel || (payload.coordinates ? await resolveLocationLabel(payload.coordinates.latitude, payload.coordinates.longitude) : '');
  const normalized = {
    id: payload.id,
    label: payload.label || 'Servis Bildirimi',
    message: payload.message || 'Yeni bildirim',
    coordinates: payload.coordinates,
    locationLabel,
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
  if (driverStatusBox) driverStatusBox.textContent = message;
  showToast(message, kind === 'success' ? 'success' : 'error');
  window.setTimeout(() => {
    button.classList.remove('is-success', 'is-error');
    button.textContent = button.dataset.feedback;
  }, 1600);
}

function showToast(message, kind = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
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
    showToast(`${successText} başarılı.`);
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
    showToast(error.message || 'İşlem başarısız.', 'error');
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
  showGlobalLoading();
  setAuthTab('login');
  loginForm.elements.sicilNo.focus();
  hideGlobalLoading();
});

function getCookie(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

function authHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  // Try both cookie names to handle environment switching
  const csrfToken = getCookie('payogum_csrf') || getCookie('__Host-payogum_csrf');
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
  state.selectedServiceId = service.id;
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
    await loadServices();
    // Always overwrite (never fall back to whatever was already selected) so
    // a stale selectedServiceId from a previous account on a shared device
    // can never carry over into this session.
    state.selectedServiceId = user.serviceId || null;
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
    adminMessageTarget.innerHTML = '<option value="all">Tüm servisler</option>' +
      services.map((service) => `<option value="${escapeHtml(service.id)}">Servis ${escapeHtml(service.code)}</option>`).join('');
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
        <div class="export-btn-container">
          <button class="export-btn excel-btn" data-export="excel" data-service-id="${escapeHtml(report.serviceId)}" data-service-code="${escapeHtml(report.serviceCode)}">Excel Olarak İndir</button>
          <button class="export-btn pdf-btn" data-export="pdf" data-service-id="${escapeHtml(report.serviceId)}" data-service-code="${escapeHtml(report.serviceCode)}">PDF Olarak İndir</button>
        </div>
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
        ? `<ul>${result.members.map((member) => `<li><div><strong>${escapeHtml(member.phone)}</strong><span>${escapeHtml(member.name)} • ${escapeHtml(member.role)} • Sicil: ${escapeHtml(member.sicilNo || '-')}</span></div><div class="member-actions"><button class="member-edit-btn" data-user-id="${escapeHtml(member.id)}" data-name="${escapeHtml(member.name)}" data-phone="${escapeHtml(member.phone)}" data-sicil-no="${escapeHtml(member.sicilNo || '')}" data-role="${escapeHtml(member.role)}" data-service-id="${escapeHtml(member.serviceId || '')}">Düzenle</button><button class="member-delete-btn" data-user-id="${escapeHtml(member.id)}">Sil</button></div></li>`).join('')}</ul>`
        : '<p>Bu servise bağlı personel yok.</p>'}`
      : `<h5>Okunmamış mesajlar</h5>${result.unreadNotifications.length
        ? `<ul>${result.unreadNotifications.map((entry) => `<li><div><strong>${escapeHtml(entry.label)}</strong><p>${escapeHtml(entry.message)}</p><small>${escapeHtml(new Date(entry.createdAt).toLocaleString('tr-TR'))}</small></div></li>`).join('')}</ul>`
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

function formatCoordinateFallback(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

async function resolveLocationLabel(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lon),
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'tr'
    }).toString();

    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'tr'
      }
    });

    if (!response.ok) return '';
    const data = await response.json();
    const address = data?.address || {};
    const parts = [
      address.neighbourhood,
      address.quarter,
      address.suburb,
      address.district,
      address.city,
      address.town,
      address.village,
      address.county,
      address.province,
      address.state
    ].filter((value) => typeof value === 'string' && value.trim());

    const locationLabel = [...new Set(parts.map((value) => value.trim()))].slice(0, 5).join(', ');
    return locationLabel || data?.display_name?.split(',').slice(0, 3).join(', ') || '';
  } catch (error) {
    return '';
  }
}

function getNotificationLocationText(item) {
  if (!item) return '';
  if (item.locationLabel) return item.locationLabel;
  if (item.coordinates) {
    const fallback = formatCoordinateFallback(item.coordinates.latitude, item.coordinates.longitude);
    return fallback || 'Konum bilgisi';
  }
  const match = String(item.message || '').match(/Konum paylaşıldı:\s*(.+)$/i);
  if (match && match[1]) return match[1].trim();
  return '';
}

// Renders the location as plain <img> map tiles instead of an <iframe> embed.
// Safari (especially in standalone/home-screen PWA mode) and some in-app/WebView
// browsers are unreliable at rendering cross-origin iframes, silently showing a
// blank box with no error — but a plain <img> loads the same way everywhere,
// so this avoids that whole class of browser-specific failures.
const MAP_TILE_SIZE = 256;
const MAP_ZOOM = 16;

function lonLatToWorldPixel(lat, lon, zoom) {
  const scale = MAP_TILE_SIZE * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function renderStaticMap(container, latitude, longitude, zoom = MAP_ZOOM) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!container || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  const width = container.clientWidth || 320;
  const height = container.clientHeight || 220;
  const center = lonLatToWorldPixel(lat, lon, zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const tileCountAxis = Math.pow(2, zoom);

  const tileXStart = Math.floor(originX / MAP_TILE_SIZE);
  const tileXEnd = Math.floor((originX + width) / MAP_TILE_SIZE);
  const tileYStart = Math.floor(originY / MAP_TILE_SIZE);
  const tileYEnd = Math.floor((originY + height) / MAP_TILE_SIZE);

  container.innerHTML = '';
  let expectedTiles = 0;
  let failedTiles = 0;

  for (let ty = tileYStart; ty <= tileYEnd; ty += 1) {
    if (ty < 0 || ty >= tileCountAxis) continue;
    for (let tx = tileXStart; tx <= tileXEnd; tx += 1) {
      const wrappedX = ((tx % tileCountAxis) + tileCountAxis) % tileCountAxis;
      const img = document.createElement('img');
      img.className = 'map-tile';
      img.alt = '';
      img.loading = 'eager';
      img.style.left = `${tx * MAP_TILE_SIZE - originX}px`;
      img.style.top = `${ty * MAP_TILE_SIZE - originY}px`;
      img.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`;
      expectedTiles += 1;
      img.addEventListener('error', () => {
        failedTiles += 1;
        img.style.visibility = 'hidden';
        if (failedTiles >= expectedTiles) {
          setLocationModalStatus('Harita karoları yüklenemedi. Aşağıdaki bağlantıyla açabilirsiniz.');
        }
      });
      container.appendChild(img);
    }
  }

  const marker = document.createElement('div');
  marker.className = 'map-marker';
  marker.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C7.03 0 3 4.03 3 9c0 6.5 9 15 9 15s9-8.5 9-15c0-4.97-4.03-9-9-9z" fill="#e30613"/><circle cx="12" cy="9" r="3.4" fill="#ffffff"/></svg>';
  container.appendChild(marker);

  const attribution = document.createElement('div');
  attribution.className = 'map-attribution';
  attribution.textContent = '© OpenStreetMap katkıda bulunanlar';
  container.appendChild(attribution);

  return true;
}

function renderNotifications() {
  if (!state.notifications.length) {
    notificationList.innerHTML = '<li>Henüz bildirim alınmadı.</li>';
    return;
  }

  notificationList.innerHTML = state.notifications.map((item) => {
    const hasGeocodedLocationMessage = /Konum paylaşıldı:\s*.+/i.test(String(item.message || ''));
    const locationText = hasGeocodedLocationMessage ? '' : getNotificationLocationText(item);
    const hasLocationMap = Boolean(
      item.coordinates
      && Number.isFinite(Number(item.coordinates.latitude))
      && Number.isFinite(Number(item.coordinates.longitude))
    );

    return `
      <li>
        <strong>${escapeHtml(item.label || 'Servis Bildirimi')}</strong>
        <div>${escapeHtml(item.message || 'Güncelleme var.')}</div>
        ${locationText ? `<div>Konum: ${escapeHtml(locationText)}</div>` : ''}
        ${hasLocationMap ? `
          <div class="location-map-actions">
            <button type="button" class="location-map-toggle" data-location-toggle-id="${escapeHtml(item.id)}">
              Konumu Gör
            </button>
          </div>
        ` : ''}
        <small>${escapeHtml(new Date(item.createdAt).toLocaleString('tr-TR'))}</small>
      </li>
    `;
  }).join('');
}

function setLocationModalStatus(message) {
  if (!locationModalStatus) return;
  if (message) {
    locationModalStatus.textContent = message;
    locationModalStatus.hidden = false;
  } else {
    locationModalStatus.textContent = '';
    locationModalStatus.hidden = true;
  }
}

function openLocationMap(item) {
  if (!item || !item.coordinates) {
    showToast('Bu bildirim için konum verisi bulunamadı.', 'error');
    return;
  }
  const { latitude, longitude } = item.coordinates;
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    showToast('Konum verisi geçersiz, harita gösterilemiyor.', 'error');
    return;
  }

  const externalUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;

  state.activeLocationMapId = item.id || null;
  setLocationModalStatus('');
  locationModalExternalLink.href = externalUrl;
  locationModalMeta.textContent = `${item.locationLabel || getNotificationLocationText(item) || 'Konum'} • ${new Date(item.createdAt || Date.now()).toLocaleString('tr-TR')}`;
  locationModal.hidden = false;

  // Wait a frame so the modal has finished laying out before we measure its
  // width/height to size the map tiles — otherwise clientWidth/Height can
  // read as 0 while the element is still display:none.
  window.requestAnimationFrame(() => {
    renderStaticMap(locationMapImage, latitude, longitude);
  });
}

function closeLocationMap() {
  state.activeLocationMapId = null;
  locationModal.hidden = true;
  locationMapImage.innerHTML = '';
  locationModalMeta.textContent = '';
  setLocationModalStatus('');
}

function toggleLocationMap(notificationId) {
  if (!notificationId) return;
  const item = state.notifications.find((entry) => entry.id === notificationId);
  if (!item) {
    showToast('Bu bildirim artık mevcut değil, sayfayı yenileyip tekrar deneyin.', 'error');
    return;
  }
  if (!locationModal.hidden && state.activeLocationMapId === notificationId) {
    closeLocationMap();
    return;
  }
  openLocationMap(item);
}

// Admin paneli, personel/sürücü tarafındaki 3 saniyelik bildirim polling'inden ayrı olarak
// özet/rapor/geçmiş verilerini kendi başına yenilemiyordu. Sistemin geri kalanıyla tutarlı
// olması için burada da hafif bir otomatik yenileme döngüsü kuruyoruz.
const ADMIN_REFRESH_INTERVAL_MS = 15000;
let adminRefreshTimer = null;

function stopAdminAutoRefresh() {
  if (adminRefreshTimer) {
    clearInterval(adminRefreshTimer);
    adminRefreshTimer = null;
  }
}

function startAdminAutoRefresh() {
  stopAdminAutoRefresh();
  adminRefreshTimer = setInterval(() => {
    if (state.user?.role !== 'admin') return;
    loadAdminSummary();
    loadAdminReports();
    loadAdminServiceHistory();
  }, ADMIN_REFRESH_INTERVAL_MS);
}

function logout() {
  stopPolling();
  stopAdminAutoRefresh();
  stopLiveLocationBroadcast();
  localStorage.removeItem('rememberedAppOpenedAt');
  state.user = null;
  state.notifications = [];
  state.seenNotificationIds = new Set();
  // Clear the selected service so the next login on this device (which may
  // be a different person, e.g. a shared driver/personel phone) never
  // inherits this session's service selection.
  state.selectedServiceId = null;
  state.activeLocationMapId = null;
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
  servicePanel.style.display = state.user.role === 'admin' ? 'none' : 'grid';
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
    startDriverLocationBroadcast().catch(() => {});
  }

  if (state.user.role === 'personel') {
    const activeService = state.services.find((service) => service.id === state.selectedServiceId);
    const latestMessage = state.notifications[0];
    staffStatusBox.textContent = activeService
      ? `Bağlı servis: Servis ${activeService.code}${latestMessage ? ` • Son bildirim: ${latestMessage.label}` : ''}`
      : 'Lütfen bir servis seçin.';
  }

  renderNotifications();
  if (state.user.role === 'admin') {
    loadAdminSummary();
    loadAdminServices();
    loadAdminReports();
    loadAdminServiceHistory();
    startAdminAutoRefresh();
  } else {
    stopAdminAutoRefresh();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  showGlobalLoading();
  const button = loginForm.querySelector('button[type="submit"]');
  const formData = new FormData(loginForm);
  const payload = {
    sicilNo: formData.get('sicilNo'),
    password: formData.get('password'),
    rememberMe: formData.get('rememberMe') === 'on'
  };

  button.disabled = true;
  button.classList.add('is-loading');
  try {
    const result = await fetchJson('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    state.token = '';
    state.user = result.user;
    if (payload.rememberMe) localStorage.setItem('rememberedAppOpenedAt', String(Date.now()));
    await loadServices();
    // Always overwrite (not just when truthy) so a stale selectedServiceId
    // from a previous account on a shared device can never leak into this
    // session — e.g. logging in as someone with no service yet must not
    // keep polling whatever service the last logged-in user had selected.
    state.selectedServiceId = state.user.serviceId || null;
    if (state.selectedServiceId) {
      renderServiceOptions();
      startPolling();
    }
    render();
  } catch (error) {
    showToast(error.message || 'Giriş yapılamadı.', 'error');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    hideGlobalLoading();
  }
}

async function handleRegister(event) {
  event.preventDefault();
  showGlobalLoading();
  const button = registerForm.querySelector('button[type="submit"]');
  const formData = new FormData(registerForm);
  const payload = {
    name: formData.get('name'),
    phone: formData.get('phone'),
    sicilNo: formData.get('sicilNo'),
    password: formData.get('password'),
    role: formData.get('role') || 'personel'
  };

  button.disabled = true;
  button.classList.add('is-loading');
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
    showToast(error.message || 'Kayıt başarısız.', 'error');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    hideGlobalLoading();
  }
}

async function handleAdminMessage(event) {
  event.preventDefault();
  await runAdminAction(adminMessageSendBtn, async () => {
    const result = await fetchJson('/api/admin/notify', {
      method: 'POST',
      body: JSON.stringify({
        serviceId: adminMessageTarget.value,
        label: document.getElementById('adminMessageLabel').value.trim(),
        message: document.getElementById('adminMessageInput').value.trim()
      })
    });
    document.getElementById('adminMessageInput').value = '';
    showToast(`${result.sent} servise, ${result.recipients} alıcıya bildirim gönderildi.`);
  }, 'Gönderildi');
}

async function joinSelectedService() {
  if (!state.selectedServiceId) {
    showToast('Lütfen bir servis seçin.', 'error');
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
adminMessageForm.addEventListener('submit', handleAdminMessage);
adminCleanupBtn.addEventListener('click', async () => {
  if (!window.confirm('Tüm hareket geçmişi ve bildirimler silinecek. Devam etmek istiyor musunuz?')) return;
  await runAdminAction(adminCleanupBtn, async () => {
    const result = await fetchJson('/api/admin/cleanup', { method: 'POST' });
    showToast(`${result.logsDeleted} hareket ve ${result.notificationsDeleted} bildirim silindi.`);
  }, 'Temizlendi', async () => {
    await Promise.all([loadAdminSummary(), loadAdminReports(), loadAdminServiceHistory()]);
  });
});
joinServiceBtn.addEventListener('click', joinSelectedService);
logoutBtn.addEventListener('click', logout);
serviceSelect.addEventListener('focus', renderServiceOptionList);
serviceSelect.addEventListener('input', renderServiceOptionList);
serviceOptionList.addEventListener('click', (event) => {
  const option = event.target.closest('[data-service-id]');
  if (option) selectService(option.dataset.serviceId);
});

document.addEventListener('click', (event) => {
  const locationToggle = event.target.closest('[data-location-toggle-id]');
  if (locationToggle) {
    toggleLocationMap(locationToggle.dataset.locationToggleId);
    return;
  }

  if (event.target === locationModal) {
    closeLocationMap();
    return;
  }

  if (!event.target.closest('.service-panel')) {
    serviceOptionList.hidden = true;
  }
});

locationModalCloseBtn.addEventListener('click', closeLocationMap);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !locationModal.hidden) {
    closeLocationMap();
  }
});

adminReportSearch.addEventListener('input', renderAdminReports);

adminReportDetails.addEventListener('click', async (event) => {
  const editButton = event.target.closest('.member-edit-btn');
  const deleteButton = event.target.closest('.member-delete-btn');
  const userId = editButton?.dataset.userId || deleteButton?.dataset.userId;
  if (!userId) return;

  if (deleteButton) {
    if (!window.confirm('Bu üye silinecek. Devam etmek istiyor musunuz?')) return;
    await runAdminAction(deleteButton, async () => {
      await fetchJson(`/api/admin/users/${userId}`, { method: 'DELETE' });
    }, 'Silindi', async () => {
      await Promise.all([loadAdminReportDetails(state.selectedServiceId, 'members'), loadAdminReports(), loadAdminSummary()]);
    });
    return;
  }
  const member = {
    id: editButton.dataset.userId,
    name: editButton.dataset.name,
    phone: editButton.dataset.phone,
    sicilNo: editButton.dataset.sicilNo,
    role: editButton.dataset.role,
    serviceId: editButton.dataset.serviceId
  };
  document.getElementById('memberEditId').value = member.id;
  document.getElementById('memberEditName').value = member.name;
  document.getElementById('memberEditPhone').value = member.phone;
  document.getElementById('memberEditSicilNo').value = member.sicilNo || '';
  document.getElementById('memberEditRole').value = member.role;
  document.getElementById('memberEditService').innerHTML = state.services.map((service) =>
    `<option value="${escapeHtml(service.id)}">${escapeHtml(service.code)}</option>`).join('');
  document.getElementById('memberEditService').value = member.serviceId || state.selectedServiceId;
  document.getElementById('memberEditPassword').value = '';
  memberEditModal.hidden = false;
});

memberEditForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runAdminAction(memberEditSaveBtn, async () => {
    await fetchJson(`/api/admin/users/${document.getElementById('memberEditId').value}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: document.getElementById('memberEditName').value.trim(),
        phone: document.getElementById('memberEditPhone').value.trim(),
        sicilNo: document.getElementById('memberEditSicilNo').value.trim(),
        role: document.getElementById('memberEditRole').value,
        serviceId: document.getElementById('memberEditService').value,
        password: document.getElementById('memberEditPassword').value
      })
    });
  }, 'Güncellendi', async () => {
    memberEditModal.hidden = true;
    await Promise.all([loadAdminReportDetails(state.selectedServiceId, 'members'), loadAdminReports(), loadAdminSummary()]);
  });
});

document.getElementById('memberEditCancelBtn').addEventListener('click', () => {
  memberEditModal.hidden = true;
});


document.querySelectorAll('.action-button').forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.id === 'shareLocationBtn' || button.id === 'adminCleanupBtn') return;
    const serviceId = state.selectedServiceId;
    if (!serviceId) {
      showToast('Önce servis seçin.', 'error');
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
    showToast('Önce servis seçin.', 'error');
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');
  await runAdminAction(button, async () => {
    await sendNotification({
      serviceId,
      type: 'message',
      label: 'Özel Mesaj',
      message: text,
      senderName: state.user?.name || 'Sürücü'
    });
    messageInput.value = '';
    showToast('Özel mesaj gönderildi.');
  }, 'Gönderildi');
});

requestLocationBtn.addEventListener('click', async () => {
  const serviceId = state.selectedServiceId;
  if (!serviceId) {
    showToast('Önce servis seçin.', 'error');
    return;
  }

  await runAdminAction(requestLocationBtn, async () => {
    await sendNotification({
      serviceId,
      type: 'location_request',
      label: 'Servisim Nerede?',
      message: `${state.user?.name || 'Personel'} konum talebinde bulundu.`,
      senderName: state.user?.name || 'Personel'
    });
    staffStatusBox.textContent = 'Servisim nerede? Konum talebi gönderildi.';
    showToast('Konum talebi gönderildi.');
  }, 'Gönderildi');
});

async function handleCleanupLogs(button) {
  if (!state.selectedServiceId) {
    showToast('Önce servis seçin.', 'error');
    return;
  }

  const defaultText = button.textContent;
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = 'Temizleniyor...';

  try {
    const result = await fetchJson('/api/cleanup-logs', { method: 'POST' });
    
    button.classList.remove('is-loading');
    button.classList.add('is-success');
    button.textContent = `✓ ${result.logsDeleted} log silindi`;
    
    const statusBox = state.user?.role === 'driver' ? driverStatusBox : staffStatusBox;
    statusBox.textContent = `Geçmiş temizlendi: ${result.logsDeleted} log, ${result.notificationsDeleted} bildirim silindi.`;
    
    setTimeout(() => {
      button.classList.remove('is-success');
      button.textContent = defaultText;
      button.disabled = false;
    }, 3000);
  } catch (error) {
    button.classList.remove('is-loading');
    button.classList.add('is-error');
    button.textContent = 'Tekrar Dene';
    
    setTimeout(() => {
      button.classList.remove('is-error');
      button.textContent = defaultText;
      button.disabled = false;
    }, 2000);
    
    showToast(error.message || 'Geçmiş temizlenirken hata oluştu.', 'error');
  }
}

// NOT: app.js, index.html'in en altında defer/async OLMADAN yükleniyor; bu noktada DOM zaten
// hazır ve 'DOMContentLoaded' olayı çoktan ateşlenmiş oluyor. O yüzden bu olayı beklemek yerine
// doğrudan wire ediyoruz (dosyanın geri kalanındaki diğer tüm element referansları da aynı şekilde).
const cleanupLogsBtnDriver = document.getElementById('cleanupLogsBtnDriver');
const cleanupLogsBtnPersonel = document.getElementById('cleanupLogsBtnPersonel');

if (cleanupLogsBtnDriver) {
  cleanupLogsBtnDriver.addEventListener('click', () => handleCleanupLogs(cleanupLogsBtnDriver));
}

if (cleanupLogsBtnPersonel) {
  cleanupLogsBtnPersonel.addEventListener('click', () => handleCleanupLogs(cleanupLogsBtnPersonel));
}

shareLocationBtn.addEventListener('click', () => {
  if (!state.selectedServiceId) {
    showToast('Önce servis seçin.', 'error');
    return;
  }

  if (!navigator.geolocation) {
    shareLocationBtn.disabled = true;
    shareLocationBtn.classList.add('is-loading');
    sendNotification({
      serviceId: state.selectedServiceId,
      type: 'driver_location',
      label: 'Canlı Konum',
      senderName: state.user?.name || 'Sürücü',
      message: 'Konum bilgisi cihaz tarafından desteklenmiyor.'
    }).then(() => showToast('Konum bilgisi gönderildi.')).catch((error) => showToast(error.message, 'error'))
      .finally(() => {
        shareLocationBtn.disabled = false;
        shareLocationBtn.classList.remove('is-loading');
      });
    return;
  }

  shareLocationBtn.disabled = true;
  shareLocationBtn.classList.add('is-loading');
  navigator.geolocation.getCurrentPosition(async (position) => {
    const coordinates = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };

    try {
      const locationLabel = await resolveLocationLabel(coordinates.latitude, coordinates.longitude);
      const message = locationLabel
        ? `Konum paylaşıldı: ${locationLabel}`
        : `Konum paylaşıldı: ${formatCoordinateFallback(coordinates.latitude, coordinates.longitude)}`;

      await sendNotification({
        serviceId: state.selectedServiceId,
        type: 'driver_location',
        label: 'Canlı Konum',
        senderName: state.user?.name || 'Sürücü',
        coordinates,
        locationLabel,
        message
      });
      driverStatusBox.textContent = `Canlı konum paylaşıldı • ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
      // Reset the periodic broadcast's clock without sending a second,
      // duplicate location update — we already just sent one above.
      driverBroadcastServiceId = state.selectedServiceId;
      armLiveLocationInterval();
      showToast('Konum bilgisi gönderildi.');
    } catch (error) {
      showToast(error.message || 'Konum gönderilemedi.', 'error');
    } finally {
      shareLocationBtn.disabled = false;
      shareLocationBtn.classList.remove('is-loading');
    }
  }, async () => {
    try {
      await sendNotification({
        serviceId: state.selectedServiceId,
        type: 'driver_location',
        label: 'Canlı Konum',
        senderName: state.user?.name || 'Sürücü',
        message: 'Konum bilgisi alınamadı.'
      });
      driverStatusBox.textContent = 'Konum bilgisi alınamadı.';
      showToast('Konum alınamadı; durum bildirimi gönderildi.', 'error');
    } catch (error) {
      showToast(error.message || 'Bildirim gönderilemedi.', 'error');
    } finally {
      shareLocationBtn.disabled = false;
      shareLocationBtn.classList.remove('is-loading');
    }
  }, { enableHighAccuracy: true, timeout: 15000 });
});

addServiceBtn.addEventListener('click', async () => {
  if (state.user?.role !== 'admin') {
    showToast('Yalnızca yönetici servis ekleyebilir.', 'error');
    return;
  }

  const value = serviceCodeInput.value.trim();
  if (!value) {
    showToast('Servis numarası girin.', 'error');
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

adminReportList.addEventListener('click', async (event) => {
  const detailButton = event.target.closest('.report-detail-btn');
  if (detailButton) {
    loadAdminReportDetails(detailButton.dataset.serviceId, detailButton.dataset.detail);
    return;
  }

  const exportButton = event.target.closest('.export-btn');
  if (!exportButton) return;

  const { serviceId, serviceCode, export: exportType } = exportButton.dataset;
  if (!serviceId || !exportType) return;

  const defaultText = exportButton.textContent;
  exportButton.disabled = true;
  exportButton.classList.add('is-loading');
  exportButton.textContent = 'Hazırlanıyor...';

  try {
    const response = await fetch(`/api/admin/reports/service/${serviceId}/export/${exportType}`, {
      headers: authHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Dosya indirilemedi.');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const extension = exportType === 'excel' ? 'xlsx' : 'pdf';
    a.download = `Oyak_Servis_Raporu_${serviceCode}_${dateStr}.${extension}`;
    
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    exportButton.classList.remove('is-loading');
    exportButton.classList.add('is-success');
    exportButton.textContent = '✓ İndirildi';
    
    setTimeout(() => {
      exportButton.classList.remove('is-success');
      exportButton.textContent = defaultText;
      exportButton.disabled = false;
    }, 2000);
  } catch (error) {
    exportButton.classList.remove('is-loading');
    exportButton.classList.add('is-error');
    exportButton.textContent = 'Tekrar Dene';
    
    setTimeout(() => {
      exportButton.classList.remove('is-error');
      exportButton.textContent = defaultText;
      exportButton.disabled = false;
    }, 2000);
    
    showToast(error.message || 'Dosya indirilemedi. Lütfen tekrar deneyin.', 'error');
  }
});

async function init() {
  setAuthTab('login');

  try {
    const rememberedAt = Number(localStorage.getItem('rememberedAppOpenedAt') || 0);
    const canAutoLogin = rememberedAt && Date.now() - rememberedAt >= AUTO_LOGIN_DELAY_MS;
    if (canAutoLogin) {
      // loadCurrentUser() loads the service list itself once it confirms the session is valid.
      await loadCurrentUser();
    }
    render();
  } catch (error) {
    state.user = null;
    render();
  } finally {
    hideGlobalLoading();
  }
}

init();

window.addEventListener('beforeunload', showGlobalLoading);
