const API = window.location.origin;
let authToken = '', currentUser = null, currentEvent = null;
let uploadQueue = [], uploadErrors = 0, uploadCancelled = false;
let syncInterval = null;
// Premium feature flags (refreshed from /auth/me when opening an event — 60s grace on toggle)
let featureManualCompression = false;
let featureAlbum = false;
// Album state
let mgrAlbumSet = new Set();
let mgrAlbumPhotos = [];

// ── Notification state — must be declared before boot() to avoid TDZ error ──
let mgrNotifPollInterval = null;
let mgrLastNotifCheck = null;
let mgrNotifFilter = 'all';
let mgrNotifData = [];
let mgrToastTimer = null;

// ── Auth & Access Guard ──
(function boot(){
  authToken = sessionStorage.getItem('authToken');
  const userStr = sessionStorage.getItem('authUser');
  if (!authToken || !userStr) { window.location.href = '/landing'; return; }
  currentUser = JSON.parse(userStr);
  if (currentUser.role !== 'manager' && currentUser.role !== 'admin') { window.location.href = '/landing'; return; }
  document.getElementById('hdr-user').textContent = currentUser.displayName;
  loadEvents();
  startMgrNotifPolling();
})();

function logout(){
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('authUser');
  window.location.href = '/landing';
}

function showAccessRevoked(){
  clearInterval(syncInterval);
  document.getElementById('access-overlay').classList.add('visible');
}

function showSessionExpired(){
  clearInterval(syncInterval);
  const el = document.getElementById('session-expired-overlay');
  if(el) el.classList.add('visible');
}

// Central API fetch with access-revoked guard
// Reads the body once to check for ACCESS_REVOKED; re-attaches parsed body so callers can still .json()
async function apiFetch(path, opts={}){
  const r = await fetch(API+path, {
    ...opts,
    headers:{ 'Authorization':`Bearer ${authToken}`, ...(opts.headers||{}) }
  });
  if (r.status === 401 || r.status === 403 || r.status === 503) {
    // Read body once - do NOT clone (body can only be read once)
    let body = null;
    try { body = await r.json(); } catch(_){}
    if (r.status === 503 && body?.error === 'MAINTENANCE_MODE') { showMaintenanceMode(); throw new Error('MAINTENANCE_MODE'); }
    if (body?.error === 'ACCESS_REVOKED') { showAccessRevoked(); throw new Error('ACCESS_REVOKED'); }
    if (r.status === 401) { showSessionExpired(); throw new Error('SESSION_EXPIRED'); }
    // Re-attach the already-parsed body so callers can use .json() downstream
    const patched = new Response(JSON.stringify(body), { status: r.status, headers: r.headers });
    return patched;
  }
  return r;
}

function showBanner(msg, type='ok'){
  const el=document.getElementById('alert-banner');
  el.textContent=msg; el.className=`alert alert-${type}`; el.style.display='block';
  setTimeout(()=>{ el.style.display='none'; }, 5000);
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// ── Events ──
async function loadEvents(){
  // Show skeleton
  document.getElementById('events-list').innerHTML = Array(4).fill(
    '<div class="skel-card skeleton"></div>'
  ).join('');
  try{
    const r=await apiFetch('/events/my');
    if(!r.ok) throw new Error();
    const events=await r.json();
    renderEvents(events);
  }catch(e){ if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to load events','err'); }
}

function renderEvents(events){
  const c=document.getElementById('events-list');
  if(!events.length){
    c.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📸</div><div class="empty-title">No events yet</div><div style="font-size:13px;color:var(--muted);margin-top:.5rem">Create your first event to get started.</div></div>`;
    return;
  }
  c.innerHTML=events.map(e=>`
    <div class="event-card" onclick="openEvent('${e.id}')">
      <div class="event-name">${esc(e.name)}</div>
      <div class="event-meta">${e.bucket_name} · ${new Date(e.created_at).toLocaleDateString()}</div>
    </div>
  `).join('');
}

// ── Create Event ──
function openCreateEvent() {
  document.getElementById('create-event-modal').classList.add('open');
  document.getElementById('new-evt-name').value = '';
  document.getElementById('new-evt-bucket').value = '';
  document.getElementById('event-err').style.display = 'none';
}
function closeCreateEvent() {
  document.getElementById('create-event-modal').classList.remove('open');
}
// Auto-populate bucket name from event name
document.getElementById('new-evt-name').addEventListener('input', function(){
  document.getElementById('new-evt-bucket').value = this.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
});
async function submitCreateEvent() {
  const name = document.getElementById('new-evt-name').value.trim();
  const bucketName = document.getElementById('new-evt-bucket').value.trim();
  const errEl = document.getElementById('event-err');
  if (!name || !bucketName) { errEl.textContent='Name and Bucket ID are required.'; errEl.style.display='block'; return; }
  if (!/^[a-z0-9-]+$/.test(bucketName)) { errEl.textContent='Bucket ID must be lowercase alphanumeric with hyphens only.'; errEl.style.display='block'; return; }
  try {
    const res = await apiFetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bucketName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create event');
    closeCreateEvent();
    showBanner('Event created successfully');
    loadEvents();
  } catch (err) {
    if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(err.message)){ errEl.textContent=err.message; errEl.style.display='block'; }
  }
}

// ── Delete Event ──
function openDeleteEvent(){
  if(!currentEvent) return;
  document.getElementById('del-evt-name').textContent = `"${currentEvent.name}" (${currentEvent.bucket_name})`;
  document.getElementById('del-evt-password').value='';
  document.getElementById('delete-event-err').style.display='none';
  document.getElementById('del-evt-confirm-btn').disabled=false;
  document.getElementById('delete-event-modal').classList.add('open');
}
function closeDeleteEvent(){
  document.getElementById('delete-event-modal').classList.remove('open');
}
async function confirmDeleteEvent(){
  const password = document.getElementById('del-evt-password').value;
  const errEl = document.getElementById('delete-event-err');
  if(!password){ errEl.textContent='Password is required.'; errEl.style.display='block'; return; }
  const btn = document.getElementById('del-evt-confirm-btn');
  btn.disabled=true; btn.textContent='Deleting…';
  try {
    const res = await apiFetch(`/events/${currentEvent.id}/manager-delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deletion failed');
    closeDeleteEvent();
    closeDetail();
    showBanner('Event deleted successfully');
    loadEvents();
  } catch(err){
    if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(err.message)){ errEl.textContent=err.message; errEl.style.display='block'; btn.disabled=false; btn.textContent='Delete Everything'; }
  }
}

// ── Event Detail ──
async function openEvent(eventId){
  // Show skeleton immediately — never freeze the UI
  document.getElementById('event-detail').style.display='block';
  document.getElementById('events-list').style.display='none';
  document.querySelector('.section-header').style.display='none';
  document.getElementById('detail-name').textContent='Loading…';
  document.getElementById('detail-bucket').textContent='';
  document.getElementById('stat-total').textContent='—';
  document.getElementById('stat-indexed').textContent='—';
  document.getElementById('stat-general').textContent='—';
  // Show skeleton in upload tab area while loading
  document.getElementById('tab-upload').innerHTML=`<div class="skel-grid" style="margin-top:1rem">${Array(6).fill('<div class="skel-card skeleton" style="height:60px"></div>').join('')}</div>`;
  switchTab('upload');

  try{
    // Refresh feature flags from server (60s max delay per design)
    await refreshUserFlags();

    const r=await apiFetch(`/events/${eventId}/photos`);
    if(!r.ok){
      const d=await r.json().catch(()=>({}));
      throw new Error(d.error||'Failed to load event');
    }
    const data=await r.json();
    currentEvent=data.event;
    document.getElementById('detail-name').textContent=currentEvent.name;
    document.getElementById('detail-bucket').textContent=currentEvent.bucket_name;
    const photos=data.photos||[];
    mgrAllPhotos=photos;
    await loadMgrFavorites();
    const withFaces=photos.filter(p=>p.has_faces).length;
    document.getElementById('stat-total').textContent=photos.length;
    document.getElementById('stat-indexed').textContent=withFaces;
    document.getElementById('stat-general').textContent=photos.length-withFaces;
    // Restore upload tab with compression panel (always shown; grayed when non-premium)
    const qualityValue = currentEvent.jpeg_quality ?? 82;
    const isPremium = featureManualCompression;
    document.getElementById('tab-upload').innerHTML=`
      <div id="compression-panel" style="margin-bottom:1rem;background:var(--bg);border:.5px solid ${isPremium?'var(--border)':'rgba(217,119,6,0.3)'};border-radius:var(--r);padding:1rem;position:relative">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
          <div style="font-size:13px;font-weight:600">🎛️ JPEG Compression Quality ${isPremium?'':'<span style=&quot;font-size:11px;font-weight:600;padding:1px 7px;border-radius:20px;background:rgba(217,119,6,0.12);color:#d97706;border:1px solid rgba(217,119,6,0.3)&quot;>🔒 Premium</span>'}</div>
          <div style="font-size:12px;color:var(--muted)">Next upload takes effect · existing photos unchanged</div>
        </div>
        <div style="${isPremium?'':'opacity:0.4;pointer-events:none;user-select:none'}">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:.5rem">
            <span style="font-size:12px;color:var(--muted);width:32px">Low</span>
            <input type="range" id="quality-slider" min="0" max="100" value="${qualityValue}" step="1"
              style="flex:1;accent-color:var(--accent)"
              oninput="updateQualityDisplay(this.value)">
            <span style="font-size:12px;color:var(--muted);width:40px;text-align:right">High</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <span style="font-size:20px;font-weight:700;color:var(--accent)" id="quality-value">${qualityValue}</span>
              <span style="font-size:12px;color:var(--muted)"> / 100 · Max: </span>
              <span style="font-size:13px;font-weight:600" id="quality-res">${qualityToResLabel(qualityValue)}</span>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm" id="quality-reset-btn" onclick="resetQuality()">Reset to Default</button>
              <button class="btn btn-sm btn-primary" id="quality-save-btn" onclick="saveQuality()">Apply ✔</button>
            </div>
          </div>
          <div id="quality-save-msg" style="font-size:12px;margin-top:.5rem;display:none"></div>
        </div>
        ${isPremium
          ? `<div style="margin-top:.6rem;font-size:12px;color:#d97706;background:rgba(217,119,6,0.08);border-radius:6px;padding:6px 10px">
               ⚠️ <strong>Note:</strong> Quality above 82 increases file size — uploads may be slower and face-search indexing may take longer for visitors.
             </div>`
          : `<div style="margin-top:.6rem;font-size:12px;color:#d97706">
               🔒 Manual compression control is a <strong>premium feature</strong>. Contact your administrator to enable it.
             </div>`
        }
      </div>
      <div class="upload-zone" id="upload-zone">
        <input type="file" id="file-input" multiple accept="image/*" onchange="handleFiles(this.files)">
        <div class="upload-icon">📷</div>
        <div class="upload-title">Drop photos here</div>
        <div class="upload-hint">or tap to browse · JPG, PNG, WEBP · up to 40MB each</div>
      </div>
      <div id="upload-actions" style="display:none;gap:8px;margin-top:1rem;flex-wrap:wrap">
        <button class="btn btn-primary" id="start-btn" onclick="startUpload()">Upload all</button>
        <button class="btn" onclick="clearQueue()">Clear</button>
      </div>
      <div id="upload-queue" class="upload-queue"></div>`;

    // Re-attach drag events
    attachUploadZone();
    renderLibrary(photos);
    // QR renders only when user clicks the QR tab — never block photo loading
    clearInterval(syncInterval);
    syncInterval = setInterval(()=>{ syncFavorites(); syncAlbum(); }, 10000);
  }catch(e){
    if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)){
      showBanner(e.message||'Failed to load event','err');
      closeDetail();
    }
  }
}

function showAccessRevoked() {
  document.getElementById('revoked-modal').style.display='flex';
}

function showMaintenanceMode() {
  let overlay = document.getElementById('maintenance-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'maintenance-overlay';
    // Style directly to blur everything behind it
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;box-sizing:border-box;flex-direction:column;gap:1rem;color:#fff;pointer-events:all;transition:opacity 0.3s';
    overlay.innerHTML = `
      <div style="font-size:3rem">🚧</div>
      <h2 style="margin:0;font-size:1.5rem">Maintenance Mode</h2>
      <p style="margin:0;font-size:1rem;color:#ccc;max-width:400px;line-height:1.5">Currently the application is in maintenance mode, sorry for the inconvenience.</p>
    `;
    document.body.appendChild(overlay);
  }
}

function closeDetail(){
  document.getElementById('event-detail').style.display='none';
  document.getElementById('events-list').style.display='grid';
  document.querySelector('.section-header').style.display='flex';
  currentEvent=null; clearQueue();
  clearInterval(syncInterval);
}

/**
 * Called when manager returns to the Upload tab.
 * Fetches the latest premium flags from /auth/me, then updates the
 * compression panel appearance without rebuilding the whole upload tab.
 * This ensures admin toggle changes take effect immediately on next tab switch.
 */
async function refreshCompressionPanel(){
  if(!currentEvent) return;
  await refreshUserFlags();
  const panel = document.getElementById('compression-panel');
  if(!panel) return;
  const qualityValue = currentEvent.jpeg_quality ?? 82;
  const isPremium = featureManualCompression;
  // Update border colour to reflect gate state
  panel.style.border = `.5px solid ${isPremium ? 'var(--border)' : 'rgba(217,119,6,0.3)'}`;
  // Rebuild the panel's inner HTML cleanly
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
      <div style="font-size:13px;font-weight:600">🎛️ JPEG Compression Quality ${isPremium ? '' : '<span style="font-size:11px;font-weight:600;padding:1px 7px;border-radius:20px;background:rgba(217,119,6,0.12);color:#d97706;border:1px solid rgba(217,119,6,0.3)">\uD83D\uDD12 Premium</span>'}</div>
      <div style="font-size:12px;color:var(--muted)">Next upload takes effect · existing photos unchanged</div>
    </div>
    <div style="${isPremium ? '' : 'opacity:0.4;pointer-events:none;user-select:none'}">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:.5rem">
        <span style="font-size:12px;color:var(--muted);width:32px">Low</span>
        <input type="range" id="quality-slider" min="0" max="100" value="${qualityValue}" step="1"
          style="flex:1;accent-color:var(--accent)" oninput="updateQualityDisplay(this.value)">
        <span style="font-size:12px;color:var(--muted);width:40px;text-align:right">High</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <span style="font-size:20px;font-weight:700;color:var(--accent)" id="quality-value">${qualityValue}</span>
          <span style="font-size:12px;color:var(--muted)"> / 100 · Max: </span>
          <span style="font-size:13px;font-weight:600" id="quality-res">${qualityToResLabel(qualityValue)}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" id="quality-reset-btn" onclick="resetQuality()">Reset to Default</button>
          <button class="btn btn-sm btn-primary" id="quality-save-btn" onclick="saveQuality()">Apply ✔</button>
        </div>
      </div>
      <div id="quality-save-msg" style="font-size:12px;margin-top:.5rem;display:none"></div>
    </div>
    ${isPremium
      ? `<div style="margin-top:.6rem;font-size:12px;color:#d97706;background:rgba(217,119,6,0.08);border-radius:6px;padding:6px 10px">
           ⚠️ <strong>Note:</strong> Quality above 82 increases file size — uploads may be slower and face-search indexing may take longer for visitors.
         </div>`
      : `<div style="margin-top:.6rem;font-size:12px;color:#d97706">
           🔒 Manual compression control is a <strong>premium feature</strong>. Contact your administrator to enable it.
         </div>`
    }`;
}

function switchTab(tab){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  ['upload','library','general','favorites','album','clients','qr'].forEach(t=>{
    const el=document.getElementById('tab-'+t);
    if(el) el.style.display=t===tab?'block':'none';
  });
  if(tab==='upload'&&currentEvent) refreshCompressionPanel(); // re-check flags on every return to Upload
  if(tab==='library'&&currentEvent) { refreshLibrary(); syncFavorites(); syncAlbum(); }
  if(tab==='general'&&currentEvent) loadGeneralPhotos();
  if(tab==='album'&&currentEvent) refreshUserFlags().then(loadMgrAlbum); // refresh before album gate check
  if(tab==='clients'&&currentEvent) checkClient();
  if(tab==='favorites'&&currentEvent) { renderMgrFavorites(); syncFavorites(); }
  if(tab==='qr') renderBrandedQR();
}

// ── General Photos (visitor General tab curation) ──

let generalHiddenExpanded = false;

async function loadGeneralPhotos() {
  if (!currentEvent) return;
  document.getElementById('general-library').innerHTML = `<div class="skel-grid">${Array(8).fill('<div class="skel-thumb skeleton"></div>').join('')}</div>`;
  document.getElementById('general-hidden-library').innerHTML = '';
  try {
    const r = await apiFetch(`/events/${currentEvent.id}/photos/general`);
    if (!r.ok) return;
    const data = await r.json();
    const all = data.photos || [];
    const visible = all.filter(p => p.visible_in_general);
    const hidden  = all.filter(p => !p.visible_in_general);
    // Update header count
    const countEl = document.getElementById('general-count');
    countEl.textContent = `${visible.length} photo${visible.length !== 1 ? 's' : ''} shown to visitors · ${all.length} total faceless photos`;
    // Render visible
    renderGeneralLibrary('general-library', visible, true);
    // Render hidden section
    const hiddenSec = document.getElementById('general-hidden-section');
    const hiddenCountEl = document.getElementById('general-hidden-count');
    if (hidden.length > 0) {
      hiddenSec.style.display = 'block';
      hiddenCountEl.textContent = hidden.length;
      renderGeneralLibrary('general-hidden-library', hidden, false);
    } else {
      hiddenSec.style.display = 'none';
    }
  } catch(e) {
    if (!['ACCESS_REVOKED', 'SESSION_EXPIRED', 'MAINTENANCE_MODE'].includes(e.message))
      showBanner('Failed to load general photos', 'err');
  }
}

function renderGeneralLibrary(containerId, photos, isVisible) {
  const c = document.getElementById(containerId);
  if (!photos.length) {
    c.innerHTML = isVisible
      ? '<div class="empty"><div class="empty-icon">👁</div><div class="empty-title">No general photos visible to visitors</div></div>'
      : '';
    return;
  }
  c.innerHTML = `<div class="photo-grid">${photos.map(p => `
    <div class="photo-thumb" style="position:relative;${isVisible ? '' : 'opacity:0.55'}">
      <img src="${p.thumbUrl}" loading="lazy"
           onerror="this.onerror=null;this.parentElement.innerHTML='<span>${p.rustfs_object_id.slice(0,8)}</span>'">
      ${isVisible
        ? `<button onclick="event.stopPropagation();toggleGeneralVisibility('${p.id}',false)"
            title="Hide from visitor General tab"
            style="position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;
                   background:rgba(239,68,68,0.85);border:none;color:#fff;cursor:pointer;font-size:13px;
                   display:flex;align-items:center;justify-content:center;line-height:1;z-index:2">✕</button>`
        : `<button onclick="event.stopPropagation();toggleGeneralVisibility('${p.id}',true)"
            title="Restore to visitor General tab"
            style="position:absolute;top:6px;right:6px;padding:2px 8px;border-radius:20px;
                   background:rgba(99,102,241,0.9);border:none;color:#fff;cursor:pointer;font-size:11px;
                   font-weight:600;z-index:2">+ Restore</button>`
      }
    </div>`).join('')}</div>`;
}

async function toggleGeneralVisibility(photoId, visible) {
  try {
    const r = await apiFetch(`/events/${currentEvent.id}/photos/${photoId}/general-visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible })
    });
    if (!r.ok) { showBanner('Failed to update photo visibility', 'err'); return; }
    showBanner(visible ? 'Photo restored to visitor General tab' : 'Photo hidden from visitor General tab');
    loadGeneralPhotos(); // reload to reflect change
  } catch(e) {
    if (!['ACCESS_REVOKED', 'SESSION_EXPIRED', 'MAINTENANCE_MODE'].includes(e.message))
      showBanner('Failed to update visibility', 'err');
  }
}

function toggleHiddenSection() {
  generalHiddenExpanded = !generalHiddenExpanded;
  document.getElementById('general-hidden-library').style.display = generalHiddenExpanded ? 'block' : 'none';
  document.getElementById('general-hidden-toggle').textContent =
    (generalHiddenExpanded ? '▼' : '▶') + ' Hidden from visitors';
}

// ── Clients ──
async function checkClient() {
  document.getElementById('client-form-container').style.display = 'none';
  document.getElementById('client-existing').style.display = 'none';
  try {
    const res = await apiFetch(`/events/${currentEvent.id}/clients`);
    if (!res.ok) return;
    const clients = await res.json();
    if (clients.length > 0) {
      currentClientId = clients[0].id;
      currentClientUsername = clients[0].username;
      document.getElementById('exist-user').textContent = clients[0].username;
      document.getElementById('client-existing').style.display = 'block';
    } else {
      document.getElementById('client-form-container').style.display = 'block';
      document.getElementById('client-success').style.display = 'none';
    }
  } catch (err) { if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(err.message)) console.error('Failed to check clients', err); }
}
async function createClient() {
  const cName = document.getElementById('client-name').value.trim();
  const cUser = document.getElementById('client-user').value.toLowerCase().trim();
  const cPass = document.getElementById('client-pass').value;
  const cMobile = document.getElementById('client-mobile').value.trim();
  const cPhone = '';
  const cEmail = document.getElementById('client-email').value.trim();
  const errEl = document.getElementById('client-err');
  const succEl = document.getElementById('client-success');
  if (!cName || !cUser || !cPass) { errEl.textContent='All fields are required'; errEl.style.display='block'; return; }
  if (!cMobile) { errEl.textContent='Mobile is mandatory'; errEl.style.display='block'; return; }
  if (cPass.length < 6) { errEl.textContent='Password minimum 6 characters'; errEl.style.display='block'; return; }
  errEl.style.display='none'; succEl.style.display='none';
  document.getElementById('btn-create-client').disabled = true;
  try {
    const res = await apiFetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cUser, password: cPass, displayName: cName, role: 'user', eventId: currentEvent.id, mobile: cMobile, phone: cPhone, email: cEmail })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create login');
    document.getElementById('succ-user').textContent = cUser;
    succEl.style.display = 'block';
    document.getElementById('client-name').value = '';
    document.getElementById('client-user').value = '';
    document.getElementById('client-pass').value = '';
    document.getElementById('client-mobile').value = '';
    document.getElementById('client-phone').value = '';
    document.getElementById('client-email').value = '';
  } catch (err) {
    if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(err.message)){ errEl.textContent=err.message; errEl.style.display='block'; }
  } finally { document.getElementById('btn-create-client').disabled = false; }
}
let currentClientId = null, currentClientUsername = null;
async function resetClientPw() {
  const newPw = prompt(`Enter new password for client "${currentClientUsername}" (min 6 chars):`);
  if (!newPw || newPw.length < 6) { if (newPw !== null) showBanner('Password must be at least 6 characters', 'err'); return; }
  try {
    const res = await apiFetch(`/users/${currentClientId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPw })
    });
    if (!res.ok) { const d = await res.json(); showBanner(d.error || 'Failed to reset password', 'err'); return; }
    showBanner('Client password reset successfully');
  } catch(e) { if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to reset password', 'err'); }
}

// ── Library ──
function renderLibrary(photos){
  const lib=document.getElementById('photo-library');
  if(!photos.length){ lib.innerHTML='<div class="empty"><div class="empty-icon">📷</div><div class="empty-title">No photos uploaded yet</div></div>'; return; }
  lib.innerHTML=`<div class="photo-grid">${photos.map(p=>`
    <div class="photo-thumb" style="position:relative">
      <img src="${p.thumbUrl}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<span>${p.rustfs_object_id.slice(0,8)}</span>'">
      <button class="fav-btn ${mgrFavSet.has(p.id)?'active':''}" data-fav-id="${p.id}" onclick="event.stopPropagation();toggleMgrFav('${p.id}')">${mgrFavSet.has(p.id)?'♥':'♡'}</button>
      ${featureAlbum?`<button class="fav-btn ${mgrAlbumSet.has(p.id)?'active':''}" data-album-id="${p.id}" onclick="event.stopPropagation();toggleMgrAlbum('${p.id}')" style="bottom:8px;top:auto;right:auto;left:8px;background:${mgrAlbumSet.has(p.id)?'rgba(217,119,6,0.9)':'rgba(30,30,46,0.75)'}" title="${mgrAlbumSet.has(p.id)?'Remove from album':'Add to album'}">${mgrAlbumSet.has(p.id)?'📚':'📖'}</button>`:''}
      <button class="del-btn" onclick="event.stopPropagation();deletePhoto('${p.id}','${esc(p.rustfs_object_id)}')" title="Delete photo">✕</button>
    </div>
  `).join('')}</div>`;
}


async function refreshLibrary(){
  if(!currentEvent)return;
  // Show skeleton while loading
  document.getElementById('photo-library').innerHTML=`<div class="skel-grid">${Array(12).fill('<div class="skel-thumb skeleton"></div>').join('')}</div>`;
  try{
    const r=await apiFetch(`/events/${currentEvent.id}/photos`);
    if(!r.ok)return;
    const data=await r.json();
    const photos=data.photos||[];
    mgrAllPhotos=photos;
    const withFaces=photos.filter(p=>p.has_faces).length;
    document.getElementById('stat-total').textContent=photos.length;
    document.getElementById('stat-indexed').textContent=withFaces;
    document.getElementById('stat-general').textContent=photos.length-withFaces;
    renderLibrary(photos);
  }catch(e){if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message))console.error(e);}
}

async function deletePhoto(photoId, objectId){
  if(!confirm(`Delete photo ${objectId.slice(0,8)}? This removes it from storage and face recognition. Cannot be undone.`))return;
  try{
    const r=await apiFetch(`/events/${currentEvent.id}/photos/${photoId}`,{method:'DELETE'});
    if(!r.ok){ const d=await r.json(); showBanner(d.error||'Delete failed','err'); return; }
    showBanner('Photo deleted');
    refreshLibrary();
  }catch(e){ if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to delete photo','err'); }
}

// ── Upload ──
function handleFiles(files){
  for(const f of files){
    if(!f.type.startsWith('image/')||f.size>40*1024*1024)continue;
    if(uploadQueue.some(q=>q.file.name===f.name&&q.file.size===f.size))continue;
    uploadQueue.push({file:f,status:'pending'});
  }
  renderQueue();
  document.getElementById('upload-actions').style.display=uploadQueue.length?'flex':'none';
  document.getElementById('file-input').value='';
}

function renderQueue(){
  const c=document.getElementById('upload-queue');
  c.innerHTML=uploadQueue.map((q,i)=>`
    <div class="queue-item">
      <div class="queue-item-name">${esc(q.file.name)}</div>
      <div class="queue-status s-${q.status}">
        ${q.status==='uploading'?'Uploading…':
          q.status==='ok'?(q.faces!==undefined&&q.faces!==null?q.faces+' face'+(q.faces!==1?'s':''):'✓ Done'):
          q.status==='skipped'?'Duplicate':
          q.status==='error'?'✕ Error':
          q.status}
      </div>
    </div>
  `).join('');
}

async function startUpload(){
  if(!currentEvent||!uploadQueue.length)return;
  uploadCancelled=false;
  document.getElementById('start-btn').disabled=true;
  const progBar = document.getElementById('progress-bar');
  progBar.classList.add('visible');
  let done=0;
  const total=uploadQueue.length;
  uploadErrors=0;
  const batchSize=5;
  for(let i=0;i<total;i+=batchSize){
    if(uploadCancelled)break;
    const batch=uploadQueue.slice(i,i+batchSize);
    const pendingBatch = batch.filter(q=>q.status==='pending');
    if(!pendingBatch.length) continue;
    const fd=new FormData();
    batch.forEach((q)=>{
      if(q.status==='pending') { fd.append('files',q.file); q.status='uploading'; }
    });
    renderQueue();
    try{
      const res=await apiFetch(`/upload/${currentEvent.id}`,{method:'POST',body:fd});
      if(!res.ok){
        batch.forEach(q => { if(q.status==='uploading') { q.status='error'; uploadErrors++; } });
      } else {
        const data=await res.json();
        let resultIdx = 0;
        batch.forEach(q => {
          if(q.status === 'uploading') {
            const result=data.results?.[resultIdx++];
            if (result?.status==='ok') { q.status='ok'; q.faces=result.facesIndexed; }
            else if (result?.status==='skipped') { q.status='skipped'; }
            else { q.status='error'; uploadErrors++; }
          }
        });
      }
    }catch(e){
      if(['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)) break;
      batch.forEach(q => { if(q.status==='uploading') { q.status='error'; uploadErrors++; } });
    }
    done += batch.length;
    if(done>total) done=total;
    const pct=Math.round((done/total)*100);
    document.getElementById('progress-fill').style.width=pct+'%';
    document.getElementById('progress-text').textContent=`${done} / ${total} (${pct}%)`;
    renderQueue();
  }
  document.getElementById('start-btn').disabled=false;
  setTimeout(()=>progBar.classList.remove('visible'), 3000);

  if(!uploadCancelled){
    const ok=uploadQueue.filter(q=>q.status==='ok').length;
    const skip=uploadQueue.filter(q=>q.status==='skipped').length;
    const errs=uploadQueue.filter(q=>q.status==='error').length;
    // Show completion modal
    document.getElementById('upload-done-summary').textContent =
      `${ok} photo${ok!==1?'s':''} uploaded successfully` +
      (skip ? `, ${skip} duplicate${skip!==1?'s':''}` : '') +
      (errs ? `, ${errs} error${errs!==1?'s':''}` : '');
    document.getElementById('upload-done-modal').classList.add('open');
  }
}

function cancelUpload(){ uploadCancelled=true; showBanner('Upload cancelled','warn'); }
function clearQueue(){ uploadQueue=[]; uploadErrors=0; renderQueue(); document.getElementById('upload-actions').style.display='none'; document.getElementById('progress-bar').classList.remove('visible'); }
function closeUploadDone(){ document.getElementById('upload-done-modal').classList.remove('open'); }

function attachUploadZone(){
  const uz=document.getElementById('upload-zone');
  if(!uz) return;
  uz.addEventListener('dragover',e=>{e.preventDefault();uz.classList.add('drag-over');});
  uz.addEventListener('dragleave',()=>uz.classList.remove('drag-over'));
  uz.addEventListener('drop',e=>{e.preventDefault();uz.classList.remove('drag-over');handleFiles(e.dataTransfer.files);});
  const fi=document.getElementById('file-input');
  if(fi) fi.addEventListener('change',function(){handleFiles(this.files);});
}
attachUploadZone();

// ── QR (img-based, no CDN library) ──
let currentQRUrl = '';
function renderBrandedQR(){
  if(!currentEvent) return;
  const url = `${window.location.origin}/e/${currentEvent.id}`;
  currentQRUrl = url;
  const encoded = encodeURIComponent(url);
  // White background QR — no JS library, no CDN, always works
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}&bgcolor=ffffff&color=1a1a18&margin=10&ecc=M`;
  const img = document.getElementById('qr-img');
  if(img) img.src = src;
  const nameEl = document.getElementById('qr-event-name');
  if(nameEl) nameEl.textContent = currentEvent.name;
}

function copyQR(){
  navigator.clipboard.writeText(currentQRUrl).then(()=>showBanner('Link copied!'));
}
async function shareQR(){
  if(!currentEvent) return;
  const shareText = `🎉 Visit the album and find key photos and your own photos!\n${currentEvent.name} — RaidCloud EventSnapAI`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `${currentEvent.name} — EventSnapAI`, text: shareText, url: currentQRUrl });
    } catch(e) { if(e.name !== 'AbortError') copyQR(); }
  } else {
    copyQR();
    showBanner('Link copied! (Share not supported on this browser)');
  }
}

async function downloadQR(){
  if(!currentQRUrl) return;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(currentQRUrl)}&color=000000&bgcolor=ffffff&margin=0`;
  try {
    const res = await fetch(qrImgUrl);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `QR_${currentEvent.name}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } catch(e) {
    window.open(qrImgUrl, '_blank');
  }
}

// ── Manager Favorites ──
let mgrFavSet = new Set();
let mgrAllPhotos = [];
async function loadMgrFavorites(){
  mgrFavSet.clear();
  if(!currentEvent) return;
  try{
    const r=await apiFetch(`/favorites/${currentEvent.id}`);
    if(!r.ok) return;
    const favs=await r.json();
    favs.forEach(f=>mgrFavSet.add(f.photo_id));
  }catch(e){if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message))console.error('Load mgr favs error',e);}
}

async function toggleMgrFav(photoId){
  if(!currentEvent) return;
  const isFav=mgrFavSet.has(photoId);
  const btns = document.querySelectorAll(`[data-fav-id="${photoId}"]`);
  btns.forEach(btn => {
    btn.classList.add('pop-anim');
    setTimeout(()=>btn.classList.remove('pop-anim'), 300);
    btn.classList.toggle('active', !isFav);
    btn.textContent = !isFav ? '♥' : '♡';
  });
  try{
    if(isFav){
      await apiFetch(`/favorites/${currentEvent.id}/${photoId}`,{method:'DELETE'});
      mgrFavSet.delete(photoId);
    } else {
      await apiFetch(`/favorites/${currentEvent.id}/${photoId}`,{method:'POST'});
      mgrFavSet.add(photoId);
    }
    if (document.querySelector('.tab.active')?.dataset.tab === 'favorites') {
      setTimeout(() => {
        if (!mgrFavSet.has(photoId) && document.querySelector('.tab.active')?.dataset.tab === 'favorites') {
          renderMgrFavorites();
        }
      }, 4000);
    }
  }catch(e){
    if(!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)){
      btns.forEach(btn => {
        btn.classList.toggle('active', isFav);
        btn.textContent = isFav ? '♥' : '♡';
      });
    }
  }
}

async function syncFavorites() {
  if(!currentEvent) return;
  try {
    const r = await apiFetch(`/favorites/${currentEvent.id}`);
    if(!r.ok) return;
    const favs = await r.json();
    const newFavSet = new Set(favs.map(f => f.photo_id));
    let changed = false;
    if (newFavSet.size !== mgrFavSet.size) changed = true;
    else { for (let id of newFavSet) if (!mgrFavSet.has(id)) { changed = true; break; } }
    if (changed) {
      mgrFavSet = newFavSet;
      document.querySelectorAll('.fav-btn').forEach(btn => {
        const id = btn.dataset.favId;
        if(id) {
          const act = mgrFavSet.has(id);
          btn.classList.toggle('active', act);
          btn.textContent = act ? '♥' : '♡';
        }
      });
      if (document.querySelector('.tab.active')?.dataset.tab === 'favorites') renderMgrFavorites();
    }
  } catch(e) {}
}

function renderMgrFavorites(){
  const lib=document.getElementById('mgr-fav-library');
  const countEl=document.getElementById('mgr-fav-count');
  const dlBtn=document.getElementById('dl-mgr-favs');
  if(mgrFavSet.size===0){
    lib.innerHTML='<div class="empty"><div class="empty-icon">♡</div><div class="empty-title">No favorites yet</div><div style="font-size:13px;color:var(--muted);margin-top:.5rem">Tap the heart on any photo in Library to add it to favorites.</div></div>';
    countEl.textContent=''; dlBtn.style.display='none'; return;
  }
  countEl.textContent=`${mgrFavSet.size} favorite${mgrFavSet.size!==1?'s':''}`;
  dlBtn.style.display='inline-flex';
  const favPhotos=mgrAllPhotos.filter(p=>mgrFavSet.has(p.id));
  lib.innerHTML=`<div class="photo-grid">${favPhotos.map(p=>`
    <div class="photo-thumb">
      <img src="${p.thumbUrl}" loading="lazy">
      <button class="fav-btn active" data-fav-id="${p.id}" onclick="event.stopPropagation();toggleMgrFav('${p.id}')">♥</button>
    </div>
  `).join('')}</div>`;
}

async function downloadMgrFavs(){
  const favPhotos=mgrAllPhotos.filter(p=>mgrFavSet.has(p.id));
  for(let i=0;i<favPhotos.length;i++){
    try{
      const res=await fetch(favPhotos[i].thumbUrl);
      const blob=await res.blob();
      const blobUrl=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=blobUrl; a.download=`favorite-${i+1}.jpg`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(blobUrl),10000);
    }catch{}
    await new Promise(r=>setTimeout(r,400));
  }
}
function startMgrNotifPolling() {
  mgrLastNotifCheck = new Date().toISOString();
  pollMgrNotifications();
  mgrNotifPollInterval = setInterval(pollMgrNotifications, 30_000);
}

async function pollMgrNotifications() {
  try {
    const [countR, listR] = await Promise.all([
      apiFetch('/notifications/my/unread-count'),
      apiFetch('/notifications/my'),
    ]);
    if (!countR.ok || !listR.ok) return;

    const { count } = await countR.json();
    mgrNotifData = await listR.json();

    const badge = document.getElementById('mgr-notif-badge');
    if (badge) badge.style.display = count > 0 ? 'block' : 'none';

    const newOnes = mgrNotifData.filter(n =>
      !n.is_read && new Date(n.created_at) > new Date(mgrLastNotifCheck)
    );
    if (newOnes.length > 0) showMgrToast(newOnes[0]);

    mgrLastNotifCheck = new Date().toISOString();
    renderMgrNotifList();
  } catch(_) {}
}

function showMgrToast(notif) {
  document.getElementById('mgr-toast-title').textContent = notif.title;
  document.getElementById('mgr-toast-body').textContent = notif.body;
  const toast = document.getElementById('mgr-notif-toast');
  toast.style.display = 'block';
  clearTimeout(mgrToastTimer);
  mgrToastTimer = setTimeout(closeMgrToast, 4000);
}

function closeMgrToast() {
  document.getElementById('mgr-notif-toast').style.display = 'none';
}

function toggleMgrNotifPanel() {
  const panel = document.getElementById('mgr-notif-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') renderMgrNotifList();
}

function filterMgrNotif(f) {
  mgrNotifFilter = f;
  ['all','unread','pinned'].forEach(x => {
    document.getElementById(`mn-filter-${x}`)?.classList.toggle('btn-primary', x === f);
  });
  renderMgrNotifList();
}

function renderMgrNotifList() {
  const el = document.getElementById('mgr-notif-list');
  if (!el) return;
  let items = mgrNotifData;
  if (mgrNotifFilter === 'unread') items = items.filter(n => !n.is_read);
  if (mgrNotifFilter === 'pinned') items = items.filter(n => n.is_pinned);

  if (!items.length) { el.innerHTML = '<p style="color:var(--hint);text-align:center;margin-top:32px">No notifications</p>'; return; }

  el.innerHTML = items.map(n => `
    <div style="
      background:${n.is_read?'transparent':'rgba(99,102,241,0.08)'};
      border:1px solid ${n.is_pinned?'#f59e0b':n.is_read?'var(--border)':'rgba(99,102,241,0.3)'};
      border-radius:10px; padding:14px; margin-bottom:10px;
    ">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(n.title)}</div>
      <div style="font-size:13px;color:var(--hint);white-space:pre-wrap;margin-bottom:8px">${esc(n.body)}</div>
      <div style="font-size:11px;color:var(--hint);display:flex;align-items:center;justify-content:space-between">
        <span>${n.sender_name ? `From: ${esc(n.sender_name)}` : 'From: Admin'} · ${new Date(n.created_at).toLocaleString('en-IN')}</span>
        <div style="display:flex;gap:6px">
          ${n.is_read ? '' : `<button class="btn btn-sm btn-primary" onclick="markMgrNotifRead('${n.id}')" style="font-size:11px;padding:3px 8px">Read</button>`}
          <button class="btn btn-sm" onclick="pinMgrNotif('${n.id}')" title="${n.is_pinned?'Unpin':'Pin'}" style="font-size:11px;padding:3px 8px">${n.is_pinned?'📌':'📍'}</button>
          <button class="btn btn-sm" onclick="discardMgrNotif('${n.id}')" title="Discard" style="font-size:11px;padding:3px 8px;color:var(--err)">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function markMgrNotifRead(id) {
  await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
  pollMgrNotifications();
}
async function pinMgrNotif(id) {
  await apiFetch(`/notifications/${id}/pin`, { method: 'PATCH' });
  pollMgrNotifications();
}
async function discardMgrNotif(id) {
  await apiFetch(`/notifications/${id}/discard`, { method: 'PATCH' });
  pollMgrNotifications();
}

// ── Premium Feature Flags ──
/**
 * Fetches the latest feature flags from /auth/me.
 * Called once per event-open (60s max refresh window by design).
 * Does NOT force re-login on failure \u2014 silently leaves flags at their last known value.
 */
async function refreshUserFlags(){
  try{
    const r = await apiFetch('/auth/me');
    if(!r.ok) return;
    const me = await r.json();
    featureManualCompression = !!me.featureManualCompression;
    featureAlbum = !!me.featureAlbum;
  }catch(_){ /* non-critical \u2014 flags keep their last value */ }
}

// ── Compression Panel (Premium) ──
/**
 * Maps JPEG quality (0\u2013100) to a human-readable max resolution label.
 * Mirrors the server-side qualityToMaxResolution in src/services/imageUtils.js.
 * Keep in sync if calibration changes.
 */
function qualityToResLabel(q){
  q = Math.max(0, Math.min(100, parseInt(q,10)));
  let px;
  if(q >= 92) px = Math.round(2500 + ((q-92)/8)*1500);
  else if(q >= 82) px = Math.round(1920 + ((q-82)/10)*580);
  else px = 1920;
  return `\u2248 ${px.toLocaleString()}px`;
}

function updateQualityDisplay(value){
  const qEl = document.getElementById('quality-value');
  const rEl = document.getElementById('quality-res');
  if(qEl) qEl.textContent = value;
  if(rEl) rEl.textContent = qualityToResLabel(value);
}

async function saveQuality(){
  if(!currentEvent) return;
  const slider = document.getElementById('quality-slider');
  const msgEl  = document.getElementById('quality-save-msg');
  const btn    = document.getElementById('quality-save-btn');
  if(!slider) return;
  const q = parseInt(slider.value, 10);
  btn.disabled = true;
  try{
    const r = await apiFetch(`/events/${currentEvent.id}/quality`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({quality:q})
    });
    if(!r.ok){
      const d = await r.json().catch(()=>({}));
      if(d.upgradeRequired){
        if(msgEl){ msgEl.textContent='\ud83d\udd12 Premium feature not enabled.'; msgEl.style.color='#d97706'; msgEl.style.display='block'; }
        return;
      }
      showBanner(d.error||'Failed to save quality','err');
      return;
    }
    currentEvent.jpeg_quality = q;
    if(msgEl){ msgEl.textContent=`\u2714 Quality set to ${q}. Takes effect on next upload.`; msgEl.style.color='var(--ok)'; msgEl.style.display='block'; }
    setTimeout(()=>{ if(msgEl) msgEl.style.display='none'; }, 4000);
  }catch(e){ if(!['ACCESS_REVOKED','SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to save quality','err'); }
  finally{ btn.disabled=false; }
}

async function resetQuality(){
  if(!currentEvent) return;
  try{
    const r = await apiFetch(`/events/${currentEvent.id}/quality`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({quality:null})
    });
    if(!r.ok){ const d=await r.json().catch(()=>({})); showBanner(d.error||'Failed to reset','err'); return; }
    currentEvent.jpeg_quality = null;
    const slider = document.getElementById('quality-slider');
    if(slider){ slider.value=82; updateQualityDisplay(82); }
    const msgEl = document.getElementById('quality-save-msg');
    if(msgEl){ msgEl.textContent='\u2714 Reset to system default (82).'; msgEl.style.color='var(--ok)'; msgEl.style.display='block'; }
    setTimeout(()=>{ if(msgEl) msgEl.style.display='none'; }, 4000);
  }catch(e){ if(!['ACCESS_REVOKED','SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to reset quality','err'); }
}

// ── Album (Premium) ──
async function loadMgrAlbum(){
  if(!currentEvent) return;
  const gateEl    = document.getElementById('mgr-album-gate');
  const contentEl = document.getElementById('mgr-album-content');
  const libEl     = document.getElementById('mgr-album-library');
  const countEl   = document.getElementById('mgr-album-count');
  const dlBtn     = document.getElementById('dl-mgr-album');

  if(!featureAlbum){
    if(gateEl) gateEl.style.display='block';
    if(contentEl) contentEl.style.display='none';
    return;
  }
  if(gateEl) gateEl.style.display='none';
  if(contentEl) contentEl.style.display='block';
  if(libEl) libEl.innerHTML=`<div class="skel-grid">${Array(8).fill('<div class="skel-thumb skeleton"></div>').join('')}</div>`;

  try{
    // Load album photo IDs (for bookmark states)
    const idR = await apiFetch(`/album/${currentEvent.id}`);
    if(idR.ok) mgrAlbumSet = new Set((await idR.json()).map(r=>r.photo_id));

    // Load full album photos with presigned URLs
    const r = await apiFetch(`/album/${currentEvent.id}/photos`);
    if(!r.ok){ if(libEl) libEl.innerHTML='<div class="empty"><div class="empty-icon">\ud83d\udcda</div><div class="empty-title">Could not load album</div></div>'; return; }
    mgrAlbumPhotos = await r.json();

    if(countEl) countEl.textContent = `${mgrAlbumPhotos.length} photo${mgrAlbumPhotos.length!==1?'s':''} in album`;
    if(dlBtn) dlBtn.style.display=mgrAlbumPhotos.length?'inline-flex':'none';

    if(!mgrAlbumPhotos.length){
      if(libEl) libEl.innerHTML='<div class="empty"><div class="empty-icon">\ud83d\udcda</div><div class="empty-title">No photos in album yet</div><div style="font-size:13px;color:var(--muted);margin-top:.5rem">Bookmark photos from the Library tab to add them here.</div></div>';
      return;
    }

    if(libEl) libEl.innerHTML=`<div class="photo-grid">${mgrAlbumPhotos.map(p=>`
      <div class="photo-thumb" style="position:relative">
        <img src="${p.thumbUrl}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<span>Error</span>'">
        <button class="fav-btn active" onclick="event.stopPropagation();toggleMgrAlbum('${p.id}')" title="Remove from album">📚</button>
      </div>`).join('')}</div>`;
  }catch(e){ if(!['ACCESS_REVOKED','SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to load album','err'); }
}

async function syncAlbum(){
  if(!currentEvent || !featureAlbum) return;
  try{
    const r = await apiFetch(`/album/${currentEvent.id}`);
    if(r.ok){
      mgrAlbumSet = new Set((await r.json()).map(r=>r.photo_id));
      document.querySelectorAll(`[data-album-id]`).forEach(btn=>{
        const pid = btn.dataset.albumId;
        const inSet = mgrAlbumSet.has(pid);
        btn.classList.toggle('active', inSet);
        btn.textContent = inSet ? '📚' : '📖';
        btn.style.background = inSet ? 'rgba(217,119,6,0.9)' : 'rgba(30,30,46,0.75)';
      });
    }
  }catch(_){}
}

async function toggleMgrAlbum(photoId){
  if(!currentEvent||!featureAlbum) return;
  try{
    if(mgrAlbumSet.has(photoId)){
      await apiFetch(`/album/${currentEvent.id}/${photoId}`,{method:'DELETE'});
      mgrAlbumSet.delete(photoId);
    } else {
      const r = await apiFetch(`/album/${currentEvent.id}/${photoId}`,{method:'POST'});
      if(!r.ok){ const d=await r.json().catch(()=>({})); showBanner(d.error||'Failed to add to album','err'); return; }
      mgrAlbumSet.add(photoId);
    }
    // Update bookmark buttons immediately in all visible tabs
    document.querySelectorAll(`[data-album-id="${photoId}"]`).forEach(btn=>{
      const inSet = mgrAlbumSet.has(photoId);
      btn.classList.toggle('active', inSet);
      btn.textContent = inSet ? '📚' : '📖';
      btn.style.background = inSet ? 'rgba(217,119,6,0.9)' : 'rgba(30,30,46,0.75)';
    });
    // If album tab is active, re-render it to reflect removal
    if(document.querySelector('.tab.active')?.dataset.tab === 'album'){
      setTimeout(()=>loadMgrAlbum(), 300);
    }
  }catch(e){ if(!['ACCESS_REVOKED','SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to update album','err'); }
}

async function downloadMgrAlbum(){
  if(!mgrAlbumPhotos.length) return;
  showBanner('Downloading album photos\u2026');
  for(const p of mgrAlbumPhotos){
    try{
      const a=document.createElement('a');
      a.href=p.fullUrl; a.download=p.rustfs_object_id||'photo.jpg';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      await new Promise(res=>setTimeout(res,400)); // brief delay to avoid browser throttling
    }catch(_){}
  }
}

