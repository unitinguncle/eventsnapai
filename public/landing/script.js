const API = window.location.origin;

async function loginManager() {
  const username = document.getElementById('mgr-user').value.trim();
  const password = document.getElementById('mgr-pass').value;
  if (!username || !password) return;
  const errEl = document.getElementById('mgr-err');
  errEl.style.display='none';
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Login failed'; errEl.style.display = 'block'; return; }
    if (data.user.role !== 'manager' && data.user.role !== 'admin') {
      errEl.textContent = 'Access denied — manager account required';
      errEl.style.display = 'block'; return;
    }
    sessionStorage.setItem('authToken', data.token);
    sessionStorage.setItem('authUser', JSON.stringify(data.user));
    window.location.href = '/manager';
  } catch { errEl.textContent = 'Could not reach server'; errEl.style.display = 'block'; }
}

async function loginUser() {
  const username = document.getElementById('usr-user').value.trim();
  const password = document.getElementById('usr-pass').value;
  if (!username || !password) return;
  const errEl = document.getElementById('usr-err');
  errEl.style.display='none';
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Login failed'; errEl.style.display = 'block'; return; }
    sessionStorage.setItem('authToken', data.token);
    sessionStorage.setItem('authUser', JSON.stringify(data.user));
    window.location.href = '/client';
  } catch { errEl.textContent = 'Could not reach server'; errEl.style.display = 'block'; }
}

document.getElementById('mgr-pass').addEventListener('keydown', e => { if (e.key === 'Enter') loginManager(); });
document.getElementById('usr-pass').addEventListener('keydown', e => { if (e.key === 'Enter') loginUser(); });

async function submitContact() {
  const name = document.getElementById('contact-name').value.trim();
  const info = document.getElementById('contact-info').value.trim();
  const msg = document.getElementById('contact-msg').value.trim();
  const errEl = document.getElementById('contact-err');
  const succEl = document.getElementById('contact-succ');
  const btn = document.getElementById('btn-submit-contact');

  if (!name || !info || !msg) { errEl.textContent = 'All fields are required'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none'; succEl.style.display = 'none';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contactInfo: info, message: msg }),
    });
    if (!res.ok) throw new Error();
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-info').value = '';
    document.getElementById('contact-msg').value = '';
    succEl.style.display = 'block';
  } catch(e) { errEl.textContent = 'Failed to submit contact request'; errEl.style.display = 'block'; }
  finally { btn.disabled = false; }
}

const existingToken = sessionStorage.getItem('authToken');
if (existingToken) {
  fetch(`${API}/auth/me`, { headers: { 'Authorization': `Bearer ${existingToken}` } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(user => {
      if (user.role === 'admin') window.location.href = '/admin';
      else if (user.role === 'manager') window.location.href = '/manager';
      else if (user.role === 'user') window.location.href = '/client';
    })
    .catch(() => { sessionStorage.removeItem('authToken'); sessionStorage.removeItem('authUser'); });
}
