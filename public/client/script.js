const API = window.location.origin;
let authToken = '', currentUser = null, currentEvent = null;
let allPhotos = [], favSet = new Set(), currentLbUrl = null, currentLbPhotoId = null;
let syncInterval = null;
let videoStream = null;
let currentClientQRUrl = '';
// Premium feature flags (refreshed from /auth/me per event open)
let cliFeatureAlbum = false;
let cliAlbumSet = new Set();
let cliAlbumPhotos = [];

// ── Notification state — must be declared before boot() to avoid TDZ error ──
let cliNotifPollInterval = null;
let cliLastNotifCheck = null;
let cliNotifFilter = 'all';
let cliNotifData = [];
let cliToastTimer = null;

// ── Auth ──
(function boot(){
  authToken = sessionStorage.getItem('authToken');
  const userStr = sessionStorage.getItem('authUser');
  if (!authToken || !userStr) { window.location.href = '/landing'; return; }
  currentUser = JSON.parse(userStr);
  if (currentUser.role !== 'user' && currentUser.role !== 'admin' && currentUser.role !== 'manager') { window.location.href = '/landing'; return; }
  document.getElementById('hdr-user').textContent = currentUser.displayName;
  loadEvents();
  startCliNotifPolling();
})();

function logout(){
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('authUser');
  window.location.href = '/landing';
}

// ── Access Revoked overlay (NEW: Stage 5.0) ──
function showAccessRevoked(msg){
  if(msg) document.getElementById('access-msg').textContent = msg;
  clearInterval(syncInterval);
  document.getElementById('access-overlay').classList.add('visible');
}

function showSessionExpired(){
  clearInterval(syncInterval);
  const el = document.getElementById('session-expired-overlay');
  if(el) el.classList.add('visible');
}

// ── API fetch with ACCESS_REVOKED guard (NEW: Stage 5.0) ──
async function apiFetch(path, opts={}){
  const r = await fetch(API+path, {
    ...opts,
    headers:{ 'Authorization':`Bearer ${authToken}`, ...(opts.headers||{}) }
  });
  if (r.status === 401 || r.status === 403 || r.status === 503) {
    let body = null;
    try { body = await r.json(); } catch(_){}
    if (r.status === 503 && body?.error === 'MAINTENANCE_MODE') { showMaintenanceMode(); throw new Error('MAINTENANCE_MODE'); }
    if (body?.error === 'ACCESS_REVOKED') {
      showAccessRevoked('Access to this event has been disabled by the administrator. Please contact the event manager for assistance.');
      throw new Error('ACCESS_REVOKED');
    }
    if (r.status === 401) {
      showSessionExpired();
      throw new Error('SESSION_EXPIRED');
    }
    // Re-wrap so callers can still .json()
    return new Response(JSON.stringify(body), { status: r.status, headers: r.headers });
  }
  return r;
}

function showBanner(msg, type='ok'){
  const el=document.getElementById('alert-banner');
  el.textContent=msg; el.className=`alert alert-${type}`; el.style.display='block';
  setTimeout(()=>{ el.style.display='none'; }, 4000);
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// ── Events ──
let allEvents = [];
async function loadEvents(){
  // Show skeleton while loading (NEW: Stage 5.0)
  document.getElementById('events-list').innerHTML = Array(3).fill(
    '<div class="skel-card skeleton"></div>'
  ).join('');
  try{
    const r=await apiFetch('/events/my');
    if(!r.ok) throw new Error();
    allEvents=await r.json();
    if(allEvents.length===1){
      // Auto-open single event
      document.getElementById('events-view').style.display='none';
      openEvent(allEvents[0].id);
    } else if(allEvents.length===0){
      document.getElementById('events-list').innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📸</div><div class="empty-title">No events assigned</div><div style="font-size:13px;color:var(--muted);margin-top:.5rem">Contact your event manager to get access.</div></div>`;
    } else {
      renderEvents(allEvents);
    }
  }catch(e){
    if(!['ACCESS_REVOKED', 'SESSION_EXPIRED', 'MAINTENANCE_MODE'].includes(e.message)) showBanner('Failed to load events','err');
  }
}

function renderEvents(events){
  document.getElementById('events-list').innerHTML=events.map(e=>`
    <div class="event-card" onclick="openEvent('${e.id}')">
      <div class="event-name">${esc(e.name)}</div>
      <div class="event-meta">${e.bucket_name} · ${new Date(e.created_at).toLocaleDateString()}</div>
    </div>
  `).join('');
}

// ── Event Detail ──
async function openEvent(eventId){
  // Show skeleton immediately (NEW: Stage 5.0)
  document.getElementById('event-detail').style.display='block';
  document.getElementById('detail-name').textContent='Loading…';
  document.getElementById('detail-bucket').textContent='';
  document.getElementById('stat-total').textContent='—';
  document.getElementById('stat-faces').textContent='—';
  document.getElementById('stat-favs').textContent='—';
  document.getElementById('photo-library').innerHTML=`<div class="skel-grid">${Array(12).fill('<div class="skel-thumb skeleton"></div>').join('')}</div>`;
  if(allEvents.length>1){
    document.getElementById('events-view').style.display='none';
    document.getElementById('back-btn').style.display='inline-flex';
  }
  switchTab('library');

  try{
    // Refresh premium flags (60s max delay by design)
    await refreshCliUserFlags();

    const r=await apiFetch(`/events/${eventId}/photos`);
    if(!r.ok){
      const d=await r.json().catch(()=>({}));
      throw new Error(d.error||'Failed to load event');
    }
    const data=await r.json();
    currentEvent=data.event;
    allPhotos=data.photos||[];

    document.getElementById('detail-name').textContent=currentEvent.name;
    document.getElementById('detail-bucket').textContent=currentEvent.bucket_name;

    const withFaces=allPhotos.filter(p=>p.has_faces).length;
    document.getElementById('stat-total').textContent=allPhotos.length;
    document.getElementById('stat-faces').textContent=withFaces;

    // Load favorites
    await loadFavorites();
    document.getElementById('stat-favs').textContent=favSet.size;

    // Also load album IDs (for bookmark states in library)
    await loadCliAlbumIds();

    renderLibrary(allPhotos);

    clearInterval(syncInterval);
    syncInterval = setInterval(()=>{ syncFavorites(); syncCliAlbum(); }, 10000);
  }catch(e){
    if(!['ACCESS_REVOKED', 'SESSION_EXPIRED', 'MAINTENANCE_MODE'].includes(e.message)){
      console.error(e);
      showBanner(e.message||'Failed to load event','err');
      closeDetail();
    }
  }
}

function closeDetail(){
  document.getElementById('event-detail').style.display='none';
  document.getElementById('events-view').style.display='block';
  currentEvent=null; allPhotos=[]; favSet.clear();
  clearInterval(syncInterval);
}

function showMaintenanceMode() {
  let overlay = document.getElementById('maintenance-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'maintenance-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;box-sizing:border-box;flex-direction:column;gap:1rem;color:#fff;pointer-events:all;transition:opacity 0.3s';
    overlay.innerHTML = `
      <div style="font-size:3rem">🚧</div>
      <h2 style="margin:0;font-size:1.5rem">Maintenance Mode</h2>
      <p style="margin:0;font-size:1rem;color:#ccc;max-width:400px;line-height:1.5">Currently the application is in maintenance mode, sorry for the inconvenience.</p>
    `;
    document.body.appendChild(overlay);
  }
}

function switchTab(tab){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  ['library','favorites','album','qrsearch','share'].forEach(t=>{
    const el=document.getElementById('tab-'+t);
    if(el) el.style.display=t===tab?'block':'none';
  });
  if(tab==='favorites') { renderFavorites(); if(currentEvent) syncFavorites(); }
  if(tab==='library' && currentEvent) { syncFavorites(); syncCliAlbum(); }
  if(tab==='album' && currentEvent) refreshCliUserFlags().then(loadCliAlbum); // re-check flag before gate
  if(tab==='share') loadClientQR();
}

// ── Favorites ──
async function loadFavorites(){
  favSet.clear();
  if(!currentEvent) return;
  try{
    const r=await apiFetch(`/favorites/${currentEvent.id}`);
    if(!r.ok) return;
    const favs=await r.json();
    favs.forEach(f=>favSet.add(f.photo_id));
  }catch(e){console.error('Load favs error',e);}
}

async function toggleFav(photoId, e){
  if(e) e.stopPropagation();
  if(!currentEvent) return;
  const isFav=favSet.has(photoId);
  const btns=document.querySelectorAll(`[data-fav-id="${photoId}"]`);
  btns.forEach(btn => {
    btn.classList.add('pop-anim');
    setTimeout(()=>btn.classList.remove('pop-anim'), 300);
    btn.classList.toggle('active', !isFav);
    btn.textContent = !isFav ? '♥' : '♡';
  });

  try{
    if(isFav){
      await apiFetch(`/favorites/${currentEvent.id}/${photoId}`,{method:'DELETE'});
      favSet.delete(photoId);
    } else {
      await apiFetch(`/favorites/${currentEvent.id}/${photoId}`,{method:'POST'});
      favSet.add(photoId);
    }
    document.getElementById('stat-favs').textContent=favSet.size;
    if (document.querySelector('.tab.active')?.dataset.tab === 'favorites') {
      setTimeout(() => {
        if (!favSet.has(photoId) && document.querySelector('.tab.active')?.dataset.tab === 'favorites') {
          renderFavorites();
        }
      }, 4000);
    }
  }catch(e){
    btns.forEach(btn => {
      btn.classList.toggle('active', isFav);
      btn.textContent = isFav ? '♥' : '♡';
    });
    console.error('Toggle fav error',e);
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
    if (newFavSet.size !== favSet.size) changed = true;
    else { for (let id of newFavSet) if (!favSet.has(id)) { changed = true; break; } }

    if (changed) {
      favSet = newFavSet;
      document.getElementById('stat-favs').textContent = favSet.size;
      document.querySelectorAll('.fav-btn').forEach(btn => {
        const id = btn.dataset.favId;
        if(id) {
          const act = favSet.has(id);
          btn.classList.toggle('active', act);
          btn.textContent = act ? '♥' : '♡';
        }
      });
      if (document.querySelector('.tab.active')?.dataset.tab === 'favorites') {
        renderFavorites();
      }
    }
  } catch(e) {}
}

function toggleLbFav(){
  if (!currentLbPhotoId) return;
  // Compute the target state from favSet BEFORE calling toggleFav
  // (toggleFav is async — favSet won't be updated until the API call resolves)
  const willBeFav = !favSet.has(currentLbPhotoId);
  // Apply optimistic UI to lb button immediately
  _applyLbFavBtn(willBeFav);
  // Now fire the actual toggle — handles grid buttons + API + favSet mutation
  toggleFav(currentLbPhotoId);
}

// Called on navigation (lbNavigate) — reads from favSet which is always up-to-date at that point
function updateLbFavBtn(){
  _applyLbFavBtn(favSet.has(currentLbPhotoId));
}

// Internal: sets the lb fav button appearance to a given state
function _applyLbFavBtn(isFav){
  const btn = document.getElementById('lb-fav-btn');
  if (!btn) return;
  btn.textContent  = isFav ? '♥ Favorited' : '♡ Favorite';
  btn.style.background  = isFav ? 'var(--fav)' : 'rgba(255,255,255,.1)';
  btn.style.borderColor = isFav ? 'var(--fav)' : 'rgba(255,255,255,.25)';
}

// ── Library rendering ──
function renderLibrary(photos){
  const lib=document.getElementById('photo-library');
  if(!photos.length){ lib.innerHTML='<div class="empty"><div class="empty-icon">📷</div><div class="empty-title">No photos yet</div></div>'; return; }
  // Capture array ref for closure
  const arr = photos;
  lib.innerHTML=`<div class="photo-grid">${arr.map((p,i)=>`
    <div class="photo-thumb" onclick="openLb('${p.thumbUrl.replace(/'/g,"\\'")}','${p.fullUrl}','${p.id}',cliOpenArr,${i})">
      <img src="${p.thumbUrl}" loading="lazy" onerror="this.parentElement.style.display='none'">
      <button class="fav-btn ${favSet.has(p.id)?'active':''}" data-fav-id="${p.id}" onclick="toggleFav('${p.id}',event)">${favSet.has(p.id)?'♥':'♡'}</button>
      ${cliFeatureAlbum?`<button class="fav-btn ${cliAlbumSet.has(p.id)?'active':''}" data-album-id="${p.id}" onclick="event.stopPropagation();toggleCliAlbum('${p.id}')" style="right:36px;background:rgba(217,119,6,0.85)" title="${cliAlbumSet.has(p.id)?'Remove from album':'Add to album'}">${cliAlbumSet.has(p.id)?'📚':'📖'}</button>`:''}
    </div>
  `).join('')}</div>`;
  // Expose array globally so inline onclick can reference it
  window.cliOpenArr = arr;
}

async function renderFavorites(){
  const lib=document.getElementById('fav-library');
  const countEl=document.getElementById('fav-count');
  const dlBtn=document.getElementById('dl-all-favs');

  if(favSet.size===0){
    lib.innerHTML='<div class="empty"><div class="empty-icon">♡</div><div class="empty-title">No favorites yet</div><div style="font-size:13px;color:var(--muted);margin-top:.5rem">Tap the heart on any photo to add it to your favorites.</div></div>';
    countEl.textContent='';
    dlBtn.style.display='none';
    return;
  }

  countEl.textContent=`${favSet.size} favorite${favSet.size!==1?'s':''}`;
  dlBtn.style.display='inline-flex';

  // Filter from allPhotos
  const favPhotos = allPhotos.filter(p => favSet.has(p.id));
  window.cliFavArr = favPhotos;
  lib.innerHTML=`<div class="photo-grid">${favPhotos.map((p,i)=>`
    <div class="photo-thumb" onclick="openLb('${p.thumbUrl.replace(/'/g,"\\'")}','${p.fullUrl}','${p.id}',cliFavArr,${i})">
      <img src="${p.thumbUrl}" loading="lazy" onerror="this.parentElement.style.display='none'">
      <button class="fav-btn active" data-fav-id="${p.id}" onclick="toggleFav('${p.id}',event)">♥</button>
    </div>
  `).join('')}</div>`;
}

async function downloadAllFavs(){
  const favPhotos=allPhotos.filter(p=>favSet.has(p.id));
  for(let i=0;i<favPhotos.length;i++){
    await downloadUrl(favPhotos[i].fullUrl, `favorite-${i+1}.jpg`);
    await new Promise(r=>setTimeout(r,400));
  }
}

// ── Lightbox ──
let lbPhotos = [];  // current photo array open in lightbox
let lbIndex  = -1;  // index within lbPhotos

function openLb(thumbUrl, fullUrl, photoId, photosArr, index){
  // Accept context arrays so prev/next can navigate
  lbPhotos = photosArr || [];
  lbIndex  = (index !== undefined) ? index : -1;
  currentLbUrl = fullUrl;
  currentLbPhotoId = photoId;
  document.getElementById('lb-img').src = fullUrl;
  document.getElementById('lb').classList.add('open');
  document.getElementById('lb-fav-btn').style.display = 'inline-flex';
  updateLbFavBtn();
  updateLbNav();
}

function closeLb(){
  document.getElementById('lb').classList.remove('open');
  document.getElementById('lb-img').src = '';
  lbPhotos = []; lbIndex = -1;
}

function lbNavigate(delta){
  if (!lbPhotos.length || lbIndex < 0) return;
  const next = lbIndex + delta;
  if (next < 0 || next >= lbPhotos.length) return;
  const p = lbPhotos[next];
  lbIndex = next;
  currentLbUrl = p.fullUrl;
  currentLbPhotoId = p.id;
  document.getElementById('lb-img').src = p.fullUrl;
  updateLbFavBtn();
  updateLbNav();
}

function updateLbNav(){
  const prevBtn = document.getElementById('lb-prev');
  const nextBtn = document.getElementById('lb-next');
  if (!prevBtn || !nextBtn) return;
  prevBtn.style.display = (lbPhotos.length > 1 && lbIndex > 0) ? 'flex' : 'none';
  nextBtn.style.display = (lbPhotos.length > 1 && lbIndex < lbPhotos.length - 1) ? 'flex' : 'none';
}

document.getElementById('lb').addEventListener('click', function(e){
  if (e.target === this) closeLb();
});

// Keyboard navigation
document.addEventListener('keydown', e => {
  if (!document.getElementById('lb').classList.contains('open')) return;
  if (e.key === 'Escape')      closeLb();
  if (e.key === 'ArrowRight')  lbNavigate(1);
  if (e.key === 'ArrowLeft')   lbNavigate(-1);
});

// Touch swipe navigation
(function attachSwipe(){
  const lb = document.getElementById('lb');
  let startX = 0;
  lb.addEventListener('touchstart', e => { startX = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].clientX - startX;
    if (Math.abs(diff) > 50) lbNavigate(diff < 0 ? 1 : -1);
  }, { passive: true });
})();

async function downloadUrl(url, filename){
  try {
    const res=await fetch(url);
    const blob=await res.blob();
    const blobUrl=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=blobUrl; a.download=filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(blobUrl),10000);
  } catch(e) { window.open(url,'_blank'); }
}

// ── QR Share (img-based, no CDN library — NEW: Stage 5.0) ──
function loadClientQR(){
  if(!currentEvent) return;
  const url=`${window.location.origin}/e/${currentEvent.id}`;
  currentClientQRUrl = url;
  const encoded = encodeURIComponent(url);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}&bgcolor=ffffff&color=1a1a18&margin=10&ecc=M`;
  const img = document.getElementById('share-qr-img');
  if(img) img.src = src;
  const nameEl = document.getElementById('share-qr-event-name');
  if(nameEl) nameEl.textContent = currentEvent.name;
}
function downloadClientQR(){
  if(!currentClientQRUrl) return;
  const img = document.getElementById('share-qr-img');
  if(!img || !img.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = `qr-${currentEvent?.bucket_name||'event'}.png`;
  a.target = '_blank';
  a.click();
}
function copyClientQR(){
  navigator.clipboard.writeText(currentClientQRUrl).then(()=>showBanner('Link copied!'));
}
async function shareClientQR(){
  if(!currentEvent) return;
  const shareText = `🎉 Visit the album and find key photos and your own photos!\n${currentEvent.name} — RaidCloud EventSnapAI`;
  if(navigator.share){
    try{
      await navigator.share({ title:`${currentEvent.name} — EventSnapAI`, text:shareText, url:currentClientQRUrl });
    }catch(e){ if(e.name!=='AbortError') copyClientQR(); }
  } else {
    copyClientQR();
    showBanner('Link copied! (Share not supported on this browser)');
  }
}

// ── QR Search (inline camera + face search) ──
function startCamera(){
  document.getElementById('qr-welcome').style.display='none';
  document.getElementById('qr-camera').style.display='flex';
  document.getElementById('qr-results').style.display='none';
  document.getElementById('qr-processing').style.display='none';
  navigator.mediaDevices.getUserMedia({
    video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false
  }).then(stream=>{
    videoStream=stream;
    document.getElementById('video').srcObject=stream;
  }).catch(()=>{
    cancelCamera();
    alert('Camera access denied. Please allow camera in your browser settings.');
  });
}

function stopStream(){
  if(videoStream){videoStream.getTracks().forEach(t=>t.stop());videoStream=null;}
}
function cancelCamera(){
  stopStream();
  document.getElementById('qr-camera').style.display='none';
  document.getElementById('qr-welcome').style.display='flex';
}

function capturePhoto(){
  const video=document.getElementById('video');
  const canvas=document.getElementById('cap-canvas');
  canvas.width=video.videoWidth;
  canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  stopStream();
  document.getElementById('qr-camera').style.display='none';
  document.getElementById('qr-processing').style.display='block';
  canvas.toBlob(blob=>{
    if(!blob){resetSearch();alert('Failed to capture photo');return;}
    searchFace(blob);
  },'image/jpeg',0.9);
}

async function searchFace(blob){
  try{
    // Get visitor token for event
    const tr=await fetch(`${API}/events/${currentEvent.id}/token`);
    if(!tr.ok) throw new Error();
    const td=await tr.json();

    const form=new FormData();
    form.append('selfie',blob,'selfie.jpg');
    const r=await fetch(`${API}/search`,{
      method:'POST',
      headers:{'Authorization':`Bearer ${td.token}`},
      body:form
    });
    if(!r.ok) throw new Error();
    const data=await r.json();
    showSearchResults(data);
  }catch(e){
    console.error('Search error',e);
    showBanner('Face search failed. Please try again.','err');
    resetSearch();
  }
}

function showSearchResults(data){
  document.getElementById('qr-processing').style.display='none';
  document.getElementById('qr-results').style.display='block';

  const myPhotos=data.myPhotos||[];
  const countEl=document.getElementById('qr-result-count');
  const grid=document.getElementById('qr-result-grid');
  const emptyEl=document.getElementById('qr-result-empty');

  if(myPhotos.length===0){
    grid.innerHTML='';
    emptyEl.style.display='block';
    countEl.textContent='No matches found';
    return;
  }

  emptyEl.style.display='none';
  countEl.textContent=`Found ${myPhotos.length} photo${myPhotos.length!==1?'s':''} of you!`;
  grid.innerHTML=myPhotos.map(p=>{
    const thumb = p.thumbUrl || p.url;
    const full  = p.fullUrl  || p.url;
    return `
    <div class="photo-thumb" onclick="openLbDirect('${full.replace(/'/g,"\\'")}')">
      <img src="${thumb}" loading="lazy" onerror="this.parentElement.style.display='none'">
    </div>`;
  }).join('');
}

function openLbDirect(url){
  currentLbUrl=url;
  currentLbPhotoId=null;
  document.getElementById('lb-img').src=url;
  document.getElementById('lb-fav-btn').style.display='none';
  document.getElementById('lb').classList.add('open');
}

function resetSearch(){
  document.getElementById('qr-camera').style.display='none';
  document.getElementById('qr-processing').style.display='none';
  document.getElementById('qr-results').style.display='none';
  document.getElementById('qr-welcome').style.display='flex';
  document.getElementById('lb-fav-btn').style.display='inline-flex';
}

// Notification polling functions
function startCliNotifPolling() {
  cliLastNotifCheck = new Date().toISOString();
  pollCliNotifications();
  cliNotifPollInterval = setInterval(pollCliNotifications, 30_000);
}

async function pollCliNotifications() {
  try {
    const [countR, listR] = await Promise.all([
      apiFetch('/notifications/my/unread-count'),
      apiFetch('/notifications/my'),
    ]);
    if (!countR.ok || !listR.ok) return;

    const { count } = await countR.json();
    cliNotifData = await listR.json();

    const badge = document.getElementById('cli-notif-badge');
    if (badge) badge.style.display = count > 0 ? 'block' : 'none';

    const newOnes = cliNotifData.filter(n =>
      !n.is_read && new Date(n.created_at) > new Date(cliLastNotifCheck)
    );
    if (newOnes.length > 0) showCliToast(newOnes[0]);

    cliLastNotifCheck = new Date().toISOString();
    renderCliNotifList();
  } catch(_) {}
}

function showCliToast(notif) {
  document.getElementById('cli-toast-title').textContent = notif.title;
  document.getElementById('cli-toast-body').textContent = notif.body;
  const toast = document.getElementById('cli-notif-toast');
  toast.style.display = 'block';
  clearTimeout(cliToastTimer);
  cliToastTimer = setTimeout(closeCliToast, 4000);
}

function closeCliToast() {
  document.getElementById('cli-notif-toast').style.display = 'none';
}

function toggleCliNotifPanel() {
  const panel = document.getElementById('cli-notif-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') renderCliNotifList();
}

function filterCliNotif(f) {
  cliNotifFilter = f;
  ['all','unread','pinned'].forEach(x => {
    document.getElementById(`cn-filter-${x}`)?.classList.toggle('btn-primary', x === f);
  });
  renderCliNotifList();
}

function renderCliNotifList() {
  const el = document.getElementById('cli-notif-list');
  if (!el) return;
  let items = cliNotifData;
  if (cliNotifFilter === 'unread') items = items.filter(n => !n.is_read);
  if (cliNotifFilter === 'pinned') items = items.filter(n => n.is_pinned);

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
          ${n.is_read ? '' : `<button class="btn btn-sm btn-primary" onclick="markCliNotifRead('${n.id}')" style="font-size:11px;padding:3px 8px">Read</button>`}
          <button class="btn btn-sm" onclick="pinCliNotif('${n.id}')" title="${n.is_pinned?'Unpin':'Pin'}" style="font-size:11px;padding:3px 8px">${n.is_pinned?'📌':'📍'}</button>
          <button class="btn btn-sm" onclick="discardCliNotif('${n.id}')" title="Discard" style="font-size:11px;padding:3px 8px;color:var(--err)">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function markCliNotifRead(id) {
  await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
  pollCliNotifications();
}
async function pinCliNotif(id) {
  await apiFetch(`/notifications/${id}/pin`, { method: 'PATCH' });
  pollCliNotifications();
}
async function discardCliNotif(id) {
  await apiFetch(`/notifications/${id}/discard`, { method: 'PATCH' });
  pollCliNotifications();
}

// ── Premium Feature Flags (Client) ──
async function refreshCliUserFlags(){
  try{
    const r = await apiFetch('/auth/me');
    if(!r.ok) return;
    const me = await r.json();
    cliFeatureAlbum = !!me.featureAlbum;
  }catch(_){}
}

// ── Album (Client — read/write per feature flag) ──
async function loadCliAlbumIds(){
  if(!currentEvent) return;
  try{
    const r = await apiFetch(`/album/${currentEvent.id}`);
    if(r.ok) cliAlbumSet = new Set((await r.json()).map(row=>row.photo_id));
  }catch(_){}
}

async function loadCliAlbum(){
  if(!currentEvent) return;
  const gateEl    = document.getElementById('cli-album-gate');
  const contentEl = document.getElementById('cli-album-content');
  const libEl     = document.getElementById('cli-album-library');
  const countEl   = document.getElementById('cli-album-count');
  const dlBtn     = document.getElementById('dl-cli-album');

  if(!cliFeatureAlbum){
    if(gateEl) gateEl.style.display='block';
    if(contentEl) contentEl.style.display='none';
    return;
  }
  if(gateEl) gateEl.style.display='none';
  if(contentEl) contentEl.style.display='block';
  if(libEl) libEl.innerHTML=`<div class="skel-grid">${Array(8).fill('<div class="skel-thumb skeleton"></div>').join('')}</div>`;

  try{
    const r = await apiFetch(`/album/${currentEvent.id}/photos`);
    if(!r.ok){ if(libEl) libEl.innerHTML='<div class="empty"><div class="empty-icon">📚</div><div class="empty-title">Could not load album</div></div>'; return; }
    cliAlbumPhotos = await r.json();
    cliAlbumSet = new Set(cliAlbumPhotos.map(p=>p.id));

    if(countEl) countEl.textContent = `${cliAlbumPhotos.length} photo${cliAlbumPhotos.length!==1?'s':''} in album`;
    if(dlBtn) dlBtn.style.display = cliAlbumPhotos.length ? 'inline-flex' : 'none';

    if(!cliAlbumPhotos.length){
      if(libEl) libEl.innerHTML='<div class="empty"><div class="empty-icon">📚</div><div class="empty-title">No photos in album yet</div><div style="font-size:13px;color:var(--muted);margin-top:.5rem">The event manager adds photos to the album.</div></div>';
      return;
    }

    if(libEl) libEl.innerHTML=`<div class="photo-grid">${cliAlbumPhotos.map(p=>`
      <div class="photo-thumb" onclick="openLb('${p.thumbUrl.replace(/'/g,"\\'")}','${p.fullUrl}','${p.id}')">
        <img src="${p.thumbUrl}" loading="lazy" onerror="this.parentElement.style.display='none'">
        <button class="fav-btn active" data-album-id="${p.id}" onclick="event.stopPropagation();toggleCliAlbum('${p.id}')" style="background:rgba(217,119,6,0.85)" title="Remove from album">📚</button>
      </div>`).join('')}</div>`;
  }catch(e){ if(!['ACCESS_REVOKED','SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to load album','err'); }
}

async function toggleCliAlbum(photoId){
  if(!currentEvent||!cliFeatureAlbum) return;
  try{
    if(cliAlbumSet.has(photoId)){
      await apiFetch(`/album/${currentEvent.id}/${photoId}`,{method:'DELETE'});
      cliAlbumSet.delete(photoId);
    } else {
      const r = await apiFetch(`/album/${currentEvent.id}/${photoId}`,{method:'POST'});
      if(!r.ok){ const d=await r.json().catch(()=>({})); showBanner(d.error||'Failed to update album','err'); return; }
      cliAlbumSet.add(photoId);
    }
    // Update buttons in library
    document.querySelectorAll(`[data-album-id="${photoId}"]`).forEach(btn=>{
      const inSet = cliAlbumSet.has(photoId);
      btn.classList.toggle('active', inSet);
      btn.textContent = inSet ? '📚' : '📖';
    });
    // Re-render album tab if currently viewed
    if(document.querySelector('.tab.active')?.dataset.tab === 'album'){
      setTimeout(()=>loadCliAlbum(), 300);
    }
  }catch(e){ if(!['ACCESS_REVOKED','SESSION_EXPIRED'].includes(e.message)) showBanner('Failed to update album','err'); }
}

async function downloadCliAlbum(){
  if(!cliAlbumPhotos.length) return;
  showBanner('Downloading album photos…');
  for(const p of cliAlbumPhotos){
    try{
      await downloadUrl(p.fullUrl, p.rustfs_object_id||'photo.jpg');
      await new Promise(res=>setTimeout(res,400));
    }catch(_){}
  }
}

// ── Album Sync (runs every 10s alongside syncFavorites) ──
/**
 * Polls /album/:eventId to get the latest album photo IDs.
 * Diffs against cliAlbumSet and updates bookmark buttons in the library grid.
 * If the album tab is currently visible, reload it fully to stay in sync with manager curation.
 */
async function syncCliAlbum(){
  if(!currentEvent || !cliFeatureAlbum) return;
  try{
    const r = await apiFetch(`/album/${currentEvent.id}`);
    if(!r.ok) return;
    const rows = await r.json();
    const newSet = new Set(rows.map(row=>row.photo_id));

    let changed = false;
    if(newSet.size !== cliAlbumSet.size) changed = true;
    else { for(const id of newSet) if(!cliAlbumSet.has(id)){ changed=true; break; } }

    if(changed){
      cliAlbumSet = newSet;
      // Update bookmark buttons in library
      document.querySelectorAll('[data-album-id]').forEach(btn=>{
        const inSet = cliAlbumSet.has(btn.dataset.albumId);
        btn.classList.toggle('active', inSet);
        btn.textContent = inSet ? '📚' : '📖';
      });
      // Reload album tab if visible (manager may have added/removed photos)
      if(document.querySelector('.tab.active')?.dataset.tab === 'album'){
        loadCliAlbum();
      }
    }
  }catch(_){}
}
