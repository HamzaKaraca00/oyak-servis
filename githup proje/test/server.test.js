const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const serverPath = path.join(__dirname, '..', 'server.js');

async function waitForHealth(port) {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // server is still starting up
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Health endpoint did not respond on port ${port}`);
}

function cookieValue(setCookie, name) {
  const entry = (setCookie || '').split(/, (?=[^;]+?=)/).find((part) => part.trim().startsWith(`${name}=`));
  return entry ? entry.trim().split(';')[0].slice(name.length + 1) : '';
}

async function getCsrf(port) {
  const response = await fetch(`http://localhost:${port}/api/health`);
  const setCookie = response.headers.get('set-cookie') || '';
  const csrf = cookieValue(setCookie, 'payogum_csrf');
  return { cookie: `payogum_csrf=${csrf}`, csrf };
}

async function login(port, sicilNo, password) {
  const initial = await getCsrf(port);
  const response = await fetch(`http://localhost:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: initial.cookie, 'X-CSRF-Token': initial.csrf },
    body: JSON.stringify({ sicilNo, password })
  });
  const data = await response.json();
  const setCookie = response.headers.get('set-cookie') || '';
  const session = cookieValue(setCookie, 'payogum_session');
  const csrf = cookieValue(setCookie, 'payogum_csrf') || initial.csrf;
  return { response, data, cookie: `payogum_session=${session}; payogum_csrf=${csrf}`, csrf };
}

function authHeaders(session, csrf, extra = {}) {
  return { Authorization: '', Cookie: session, 'X-CSRF-Token': csrf, ...extra };
}

test('health endpoint responds successfully', async () => {
  const port = 3456 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const data = await waitForHealth(port);
    assert.equal(data.ok, true);
    assert.equal(data.message, 'Payogum server is running');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});

test('admin can update and delete service entries', async () => {
  const port = 3556 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForHealth(port);

    const admin = await login(port, '0001', 'admin123');
    assert.equal(admin.response.status, 200);

    const listResponse = await fetch(`http://localhost:${port}/api/services`, {
      headers: authHeaders(admin.cookie, admin.csrf)
    });

    const services = await listResponse.json();
    const target = services.find((service) => service.code === '07');
    assert.ok(target, 'target service 07 should exist');

    const updateResponse = await fetch(`http://localhost:${port}/api/services/${target.id}`, {
      method: 'PUT',
      headers: authHeaders(admin.cookie, admin.csrf, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: '07' })
    });

    const updated = await updateResponse.json();
    assert.equal(updateResponse.status, 200);
    assert.equal(updated.code, '07');

    const deleteResponse = await fetch(`http://localhost:${port}/api/services/${target.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin.cookie, admin.csrf)
    });

    const deleteData = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteData.deleted, true);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});

test('users only receive notifications for their own service', async () => {
  const port = 3656 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForHealth(port);

    const admin = await login(port, '0001', 'admin123');
    assert.equal(admin.response.status, 200);

    const since = new Date(Date.now() - 1000).toISOString();

    // Send a notification for service-01.
    const notifyResponse = await fetch(`http://localhost:${port}/api/notify`, {
      method: 'POST',
      headers: authHeaders(admin.cookie, admin.csrf, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        serviceId: 'service-01',
        type: 'test',
        label: 'Test label',
        message: 'Only service 01 should see this',
        senderName: 'Driver 01'
      })
    });
    assert.equal(notifyResponse.status, 201);

    // A client polling service-01 should see it.
    const service01Response = await fetch(
      `http://localhost:${port}/api/services/service-01/notifications?since=${encodeURIComponent(since)}`,
      { headers: authHeaders(admin.cookie, admin.csrf) }
    );
    const service01Logs = await service01Response.json();
    assert.equal(service01Logs.length, 1);
    assert.equal(service01Logs[0].message, 'Only service 01 should see this');

    // A client polling service-02 should not see it.
    const service02Response = await fetch(
      `http://localhost:${port}/api/services/service-02/notifications?since=${encodeURIComponent(since)}`,
      { headers: authHeaders(admin.cookie, admin.csrf) }
    );
    const service02Logs = await service02Response.json();
    assert.equal(service02Logs.length, 0);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});

test('offline staff can retrieve persistent unread notifications after login', async () => {
  const port = 4756 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForHealth(port);
    const uniquePhone = `05${String(Date.now()).slice(-9)}`;
    const initial = await getCsrf(port);
    const registerResponse = await fetch(`http://localhost:${port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: initial.cookie, 'X-CSRF-Token': initial.csrf },
      body: JSON.stringify({ name: 'Offline Personel', phone: uniquePhone, sicilNo: String(Date.now()).slice(-10), password: 'secret123' })
    });
    const staff = await registerResponse.json();
    assert.equal(registerResponse.status, 201);
    const staffSetCookie = registerResponse.headers.get('set-cookie') || '';
    const staffSession = cookieValue(staffSetCookie, 'payogum_session');
    const staffCsrf = cookieValue(staffSetCookie, 'payogum_csrf') || initial.csrf;
    const staffCookie = `payogum_session=${staffSession}; payogum_csrf=${staffCsrf}`;

    const joinResponse = await fetch(`http://localhost:${port}/api/join-service`, {
      method: 'POST',
      headers: authHeaders(staffCookie, staffCsrf, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ serviceId: 'service-01' })
    });
    assert.equal(joinResponse.status, 200);

    const admin = await login(port, '0001', 'admin123');
    const notifyResponse = await fetch(`http://localhost:${port}/api/notify`, {
      method: 'POST',
      headers: authHeaders(admin.cookie, admin.csrf, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        serviceId: 'service-01',
        type: 'departed',
        label: 'Sürücü kalkışı gerçekleştirdi',
        message: '🚌 Sürücü kalkışı gerçekleştirdi.',
        idempotencyKey: `offline-${Date.now()}`
      })
    });
    assert.equal(notifyResponse.status, 201);

    const unreadResponse = await fetch(`http://localhost:${port}/api/notifications`, {
      headers: authHeaders(staffCookie, staffCsrf)
    });
    const unread = await unreadResponse.json();
    assert.equal(unreadResponse.status, 200);
    assert.equal(unread.at(-1).message, '🚌 Sürücü kalkışı gerçekleştirdi.');
    assert.equal(unread.at(-1).userId, staff.user.id);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
});
