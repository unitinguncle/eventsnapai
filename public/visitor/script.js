const API = window.location.origin;
let eventId=null, eventData=null, token=null, videoStream=null;
let myPhotos=[], generalPhotos=[], favPhotos=[];
let currentBlob = null;
let lastRefreshTime = 0;
let isRefreshing = false;
let selectMode=null, selected=new Set();
let currentLbUrl=null;

// ─── Member Portal State ────────────────────────────────────────────────────
let memberToken  = null;
let memberInfo   = null;  // { id, username, displayName, eventId, canUpload }
let mAllPhotos   = [];    // all photos for All Photos tab
let mMinePhotos  = [];    // selfie search results
let mPersonalFavIds = new Set();
let mGroupFavIds    = new Set();
let mUploadQueue = []; let mUploadCancelled = false;
let mVideoStream = null;
let mLbPhotos    = []; let mLbIdx = 0; let mLbContext = null; // 'all','mine','personal-favs','group-favs'
let mSyncInterval = null;
let mPersonalFavPhotos = [];
let mGroupFavPhotos = [];

// ── Screens ──
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showError(msg){
  document.getElementById('error-msg').textContent=msg;
  show('error-screen');
}

// Duplicate boot function removed
// ── Camera ──
async function startCamera(){
  show('camera-screen');
  try{
    videoStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false
    });
    document.getElementById('video').srcObject=videoStream;
  }catch(e){
    stopStream();
    show('welcome-screen');
    alert('Camera access denied. Please allow camera access in your browser settings and try again.');
  }
}

function stopStream(){
  if(videoStream){videoStream.getTracks().forEach(t=>t.stop());videoStream=null;}
}

function cancelCamera(){stopStream();show('welcome-screen');}

function capturePhoto(){
  const video=document.getElementById('video');
  const canvas=document.getElementById('cap-canvas');
  canvas.width=video.videoWidth;
  canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  stopStream();
  show('processing-screen');
  canvas.toBlob(blob=>{
    if(!blob){show('welcome-screen');alert('Failed to capture. Please try again.');return;}
    searchFace(blob);
  },'image/jpeg',0.9);
}

// ── Search ──
async function searchFace(blob){
  currentBlob = blob;
  try{
    const form=new FormData();
    form.append('selfie',blob,'selfie.jpg');
    const r=await fetch(`${API}/search`,{
      method:'POST',
      headers:{'Authorization':`Bearer ${token}`},
      body:form
    });
    if(!r.ok){
      const err=await r.json().catch(()=>({}));
      if (r.status === 503 && err.error === 'MAINTENANCE_MODE') { showMaintenanceMode(); return; }
      showError(err.error||'Search failed. Please try again.');
      return;
    }
    const data=await r.json();
    myPhotos=data.myPhotos||[];
    generalPhotos=data.generalPhotos||[];
    favPhotos=data.favoritePhotos||[];
    renderResults();
  }catch(e){
    showError('Network error during search. Please check your connection.');
  }
}

// ── Render results ──
function renderResults(){
  show('results-screen');
  selected.clear(); selectMode=null;
  document.getElementById('sel-bar').classList.remove('visible');

  // Badge counts
  document.getElementById('badge-mine').textContent=myPhotos.length?`(${myPhotos.length})`:'';
  document.getElementById('badge-general').textContent=generalPhotos.length?`(${generalPhotos.length})`:'';
  document.getElementById('badge-favs').textContent=favPhotos.length?`(${favPhotos.length})`:'';

  renderPanel('mine', myPhotos);
  renderPanel('general', generalPhotos);
  renderPanel('favs', favPhotos);
}

function renderPanel(key, photos){
  const grid=document.getElementById('grid-'+key);
  const empty=document.getElementById('empty-'+key);
  const count=document.getElementById('count-'+key);
  const btnSelect=document.getElementById('btn-select-'+key);
  const btnDlAll=document.getElementById('btn-dl-all-'+key);

  if(!photos.length){
    grid.innerHTML=''; empty.style.display='block';
    count.textContent=''; btnSelect.style.display='none'; btnDlAll.style.display='none';
    return;
  }
  empty.style.display='none';
  count.textContent=`${photos.length} photo${photos.length!==1?'s':''}`;
  btnSelect.style.display='inline-flex';
  btnDlAll.style.display='inline-flex';

  grid.innerHTML=photos.map((p,i)=>{
    const thumb = p.thumbUrl || p.url;
    const full  = p.fullUrl  || p.url;
    return `
    <div class="photo-card" id="card-${key}-${i}" onclick="cardClick('${key}',${i})" data-full="${full.replace(/"/g,'&quot;')}">
      <img src="${thumb}" alt="Photo" loading="lazy"
           onerror="this.parentElement.style.display='none'"
           onload="this.removeAttribute('data-loading')"
           data-loading="1">
      <div class="photo-sel">✓</div>
    </div>`;
  }).join('');
}

// ── Tabs ──
function switchVTab(btn, panelId){
  document.querySelectorAll('.vtab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(panelId).classList.add('active');

  if (!isRefreshing && Date.now() - lastRefreshTime > 10000) {
    silentRefresh();
  }
}

async function silentRefresh() {
  if (!currentBlob || !token) return;
  isRefreshing = true;
  lastRefreshTime = Date.now();
  try {
    const form = new FormData();
    form.append('selfie', currentBlob, 'selfie.jpg');
    const r = await fetch(`${API}/search`, {
      method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:form
    });
    if (r.status === 503) {
      const err = await r.json().catch(()=>({}));
      if (err.error === 'MAINTENANCE_MODE') { showMaintenanceMode(); return; }
    }
    if (r.ok) {
      const data = await r.json();
      const newMy = data.myPhotos||[];
      const newGen = data.generalPhotos||[];
      const newFav = data.favoritePhotos||[];
      
      // If server photo sizes differ from local state, apply dynamic update
      if (newMy.length !== myPhotos.length || newGen.length !== generalPhotos.length || newFav.length !== favPhotos.length) {
        myPhotos = newMy; generalPhotos = newGen; favPhotos = newFav;
        clearSelection(); // avoid referencing shifted array indices
        
        document.getElementById('badge-mine').textContent=myPhotos.length?`(${myPhotos.length})`:'';
        document.getElementById('badge-general').textContent=generalPhotos.length?`(${generalPhotos.length})`:'';
        document.getElementById('badge-favs').textContent=favPhotos.length?`(${favPhotos.length})`:'';
        
        renderPanel('mine', myPhotos);
        renderPanel('general', generalPhotos);
        renderPanel('favs', favPhotos);
      }
    }
  } catch(e) {}
  isRefreshing = false;
}

// ── Select mode ──
function toggleSelectMode(key){
  if(selectMode===key){
    selectMode=null; selected.clear(); updateSelBar();
    document.querySelectorAll('.photo-card').forEach(c=>c.classList.remove('selected'));
    document.getElementById('btn-select-'+key).textContent='Select';
  } else {
    selectMode=key; selected.clear(); updateSelBar();
    document.getElementById('btn-select-mine').textContent=key==='mine'?'Cancel':'Select';
    document.getElementById('btn-select-general').textContent=key==='general'?'Cancel':'Select';
  }
}

function cardClick(key, idx){
  if(selectMode===key){
    const id=`${key}-${idx}`;
    const card=document.getElementById(`card-${key}-${idx}`);
    if(selected.has(id)){selected.delete(id);card.classList.remove('selected');}
    else{selected.add(id);card.classList.add('selected');}
    updateSelBar();
  } else {
    const photos=key==='mine'?myPhotos:key==='favs'?favPhotos:generalPhotos;
    openLb(photos[idx].fullUrl || photos[idx].url, photos, idx);
  }
}

function updateSelBar(){
  const bar=document.getElementById('sel-bar');
  document.getElementById('sel-count').textContent=selected.size;
  if(selected.size>0) bar.classList.add('visible');
  else bar.classList.remove('visible');
}

function clearSelection(){
  selected.clear();
  document.querySelectorAll('.photo-card.selected').forEach(c=>c.classList.remove('selected'));
  updateSelBar();
}

// ── Downloads ──
async function downloadAll(key){
  const photos=key==='mine'?myPhotos:key==='favs'?favPhotos:generalPhotos;
  for(let i=0;i<photos.length;i++){
    await downloadUrl(photos[i].fullUrl || photos[i].url, `photo-${i+1}.jpg`);
    await new Promise(r=>setTimeout(r,300)); // small delay between downloads
  }
}

async function downloadSelected(){
  const toDownload=[];
  selected.forEach(id=>{
    const [key,idx]=id.split('-');
    const photos=key==='mine'?myPhotos:key==='favs'?favPhotos:generalPhotos;
    const p = photos[parseInt(idx)];
    if(p) toDownload.push(p.fullUrl || p.url);
  });
  for(let i=0;i<toDownload.length;i++){
    await downloadUrl(toDownload[i],`photo-${i+1}.jpg`);
    await new Promise(r=>setTimeout(r,300));
  }
}

async function downloadUrl(url, filename){
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } catch(e) {
    window.open(url, '_blank');
  }
}

// ── Lightbox ──
let lbArr = [];  // current photo array
let lbIdx = -1;  // current index

function openLb(url, photosArr, index){
  lbArr = photosArr || [];
  lbIdx = (index !== undefined) ? index : -1;
  currentLbUrl = url;
  document.getElementById('lb-img').src = url;
  document.getElementById('lb').classList.add('open');
  updateLbNav();
}

function closeLb(){
  document.getElementById('lb').classList.remove('open');
  document.getElementById('lb-img').src = '';
  lbArr = []; lbIdx = -1;
}

function lbNavigate(delta){
  if (!lbArr.length || lbIdx < 0) return;
  const next = lbIdx + delta;
  if (next < 0 || next >= lbArr.length) return;
  lbIdx = next;
  const p = lbArr[lbIdx];
  currentLbUrl = p.fullUrl || p.url;
  document.getElementById('lb-img').src = currentLbUrl;
  updateLbNav();
}

function updateLbNav(){
  const prevBtn = document.getElementById('lb-prev');
  const nextBtn = document.getElementById('lb-next');
  if (!prevBtn || !nextBtn) return;
  prevBtn.style.display = (lbArr.length > 1 && lbIdx > 0) ? 'flex' : 'none';
  nextBtn.style.display = (lbArr.length > 1 && lbIdx < lbArr.length - 1) ? 'flex' : 'none';
}

document.getElementById('lb').addEventListener('click', function(e){
  if (e.target === this) closeLb();
});

document.addEventListener('keydown', e => {
  if (!document.getElementById('lb').classList.contains('open')) return;
  if (e.key === 'Escape')     closeLb();
  if (e.key === 'ArrowRight') lbNavigate(1);
  if (e.key === 'ArrowLeft')  lbNavigate(-1);
});

// Touch swipe
(function(){
  const lb = document.getElementById('lb');
  let startX = 0;
  lb.addEventListener('touchstart', e => { startX = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].clientX - startX;
    if (Math.abs(diff) > 50) lbNavigate(diff < 0 ? 1 : -1);
  }, { passive: true });
})();

// ── Boot ──
async function boot(){
  eventId=window.location.hash.slice(1);
  if(!eventId){showError('Invalid QR code — no event ID found.');hideSplash();return;}
  try{
    const r=await fetch(`${API}/events/${eventId}/token`);
    if(r.status === 503) {
      const err = await r.json().catch(console.error);
      if(err?.error === 'MAINTENANCE_MODE') { showMaintenanceMode(); hideSplash(); return; }
    }
    if(!r.ok){showError('This event was not found or is no longer active.');hideSplash();return;}
    const d=await r.json();
    eventData = d.event;

    // ── Collaborative event: show member login gate ──
    if (d.isCollaborative) {
      document.getElementById('login-event-name').textContent = eventData.name;
      // Check sessionStorage for an existing member session
      const savedToken  = sessionStorage.getItem('memberToken');
      const savedMember = sessionStorage.getItem('memberInfo');
      if (savedToken && savedMember) {
        memberToken = savedToken;
        memberInfo  = JSON.parse(savedMember);
        if (memberInfo.eventId === eventId) {
          setTimeout(() => { hideSplash(); showMemberPortal(); }, 1500);
          return;
        }
      }
      setTimeout(() => { hideSplash(); showScreen('member-login-screen'); }, 2500);
      return;
    }

    // ── Normal event: existing anonymous flow ──
    token=d.token;
    document.getElementById('welcome-name').textContent=eventData.name;
    document.getElementById('results-event-name').textContent=eventData.name;
    setTimeout(()=>{ hideSplash(); show('welcome-screen'); }, 2500);
  }catch(e){showError('Could not connect to the server. Check your connection.');hideSplash();}
}

function hideSplash(){
  const splash=document.getElementById('splash-screen');
  if(splash){ splash.classList.add('fade-out'); setTimeout(()=>splash.remove(), 700); }
}

function resetApp(){
  myPhotos=[]; generalPhotos=[]; favPhotos=[]; selected.clear(); selectMode=null;
  document.getElementById('sel-bar').classList.remove('visible');
  show('welcome-screen');
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

// Helper: show a non-.screen div (member portal)
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('member-screen').style.display = 'none';
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('screen')) { el.classList.add('active'); }
  else { el.style.display = 'flex'; }
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMBER PORTAL — Login / Logout
// ══════════════════════════════════════════════════════════════════════════════
async function memberLogin() {
  const username = document.getElementById('m-username').value.trim();
  const password = document.getElementById('m-password').value;
  const errEl    = document.getElementById('m-login-err');
  const btn      = document.getElementById('m-login-btn');
  errEl.style.display = 'none';
  if (!username || !password) { errEl.textContent = 'Username and password are required'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch(`${API}/auth/member-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, eventId })
    });
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Login failed'; errEl.style.display = 'block'; return; }
    memberToken = data.token;
    memberInfo  = data.member;
    sessionStorage.setItem('memberToken', memberToken);
    sessionStorage.setItem('memberInfo', JSON.stringify(memberInfo));
    showMemberPortal();
  } catch(e) {
    errEl.textContent = 'Network error — check your connection'; errEl.style.display = 'block';
  } finally { btn.disabled = false; btn.textContent = 'Sign In →'; }
}

function memberLogout() {
  memberToken = null; memberInfo = null;
  sessionStorage.removeItem('memberToken'); sessionStorage.removeItem('memberInfo');
  clearInterval(mSyncInterval); mSyncInterval = null;
  if (mVideoStream) { mVideoStream.getTracks().forEach(t => t.stop()); mVideoStream = null; }
  mAllPhotos = []; mMinePhotos = []; mPersonalFavIds.clear(); mGroupFavIds.clear();
  document.getElementById('member-screen').style.display = 'none';
  showScreen('member-login-screen');
}

function showMemberPortal() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const ms = document.getElementById('member-screen');
  ms.style.display = 'flex';
  document.getElementById('m-event-name').textContent = memberInfo.eventName || eventData?.name || 'Group Album';
  document.getElementById('m-user-display').textContent = memberInfo.displayName;
  if (!memberInfo.canUpload) {
    document.getElementById('m-upload-locked').style.display = 'block';
    document.getElementById('m-upload-zone-wrap').style.display = 'none';
  }
  // Show quality notice
  const q = eventData?.jpeg_quality ?? 82;
  const qNotice = document.getElementById('m-quality-notice');
  const qLabel  = document.getElementById('m-quality-label');
  if (qNotice && qLabel) {
    qLabel.textContent = `Uploading at quality ${q}/100`;
    qNotice.style.display = 'block';
  }
  switchMTab(document.querySelector('[data-mpanel="m-panel-upload"]'), 'm-panel-upload');
  // Sync favs immediately, but only poll every 5 minutes - no auto photo refresh
  mSyncPersonalFavIds();
  mSyncGroupFavIds();
  clearInterval(mSyncInterval);
  mSyncInterval = setInterval(mSync, 5 * 60 * 1000); // 5 minutes
}

async function mSync() {
  await Promise.all([mSyncPersonalFavIds(), mSyncGroupFavIds()]);
  // Re-render group favs panel only if it is currently visible
  const groupPanel = document.getElementById('m-favs-group');
  if (groupPanel && groupPanel.style.display !== 'none') {
    await mLoadGroupFavs();
  }
  // Update fav button states in any visible grid (no photo reload)
  mRefreshFavButtonStates();
}

// Refresh just the fav-button active states without reloading photos
function mRefreshFavButtonStates() {
  document.querySelectorAll('[data-mid]').forEach(btn => {
    const isFav = mPersonalFavIds.has(btn.dataset.mid);
    btn.classList.toggle('active', isFav);
    btn.textContent = isFav ? '❤' : '♡';
  });
}

// ── Tab switching ─────────────────────────────────────────────────
function switchMTab(btn, panelId) {
  document.querySelectorAll('[data-mpanel]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#member-screen .tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(panelId);
  if (panel) panel.classList.add('active');
  if (panelId === 'm-panel-all')  mLoadAllPhotos(true);
  if (panelId === 'm-panel-mine') mLoadMyUploads();
  if (panelId === 'm-panel-favs') { mLoadPersonalFavs(); mLoadGroupFavs(); }
}

function switchFavSubtab(which) {
  document.getElementById('fst-personal').classList.toggle('active', which === 'personal');
  document.getElementById('fst-group').classList.toggle('active', which === 'group');
  document.getElementById('m-favs-personal').style.display = which === 'personal' ? 'block' : 'none';
  document.getElementById('m-favs-group').style.display    = which === 'group'    ? 'block' : 'none';
}

// ── Avatar helpers ────────────────────────────────────────────────
const M_COLORS = ['#E24B4A','#4CAFE3','#10B981','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16'];
function mAvatarColor(name) {
  let h = 0; for (let i=0;i<(name||'').length;i++) h=name.charCodeAt(i)+((h<<5)-h);
  return M_COLORS[Math.abs(h)%M_COLORS.length];
}
function mInitials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }
function mUploaderBadge(name) {
  if(!name) return '';
  return `<div class="m-uploader-badge" style="background:${mAvatarColor(name)}" title="${name}">${mInitials(name)}</div>`;
}

// ── Fetch helper with member auth ─────────────────────────────────
async function mFetch(path, opts={}) {
  return fetch(API+path, { ...opts, headers:{ 'Authorization':`Bearer ${memberToken}`, ...(opts.headers||{}) } });
}

// ── UPLOAD TAB ────────────────────────────────────────────────────
function mHandleFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/') || f.size > 40*1024*1024) continue;
    if (mUploadQueue.some(q => q.file.name===f.name && q.file.size===f.size)) continue;
    mUploadQueue.push({ file: f, status: 'pending' });
  }
  mRenderQueue();
  document.getElementById('m-upload-actions').style.display = mUploadQueue.length ? 'flex' : 'none';
  document.getElementById('m-file-input').value = '';
}

function mRenderQueue() {
  const c = document.getElementById('m-upload-queue');
  c.innerHTML = mUploadQueue.map((q,i) => `
    <div class="m-queue-item">
      <div class="m-queue-name">${q.file.name}</div>
      <div class="m-queue-status s-${q.status}">
        ${q.status==='uploading'?'Uploading…':q.status==='ok'?(q.faces!==undefined?q.faces+' face'+(q.faces!==1?'s':''):'✓'):q.status==='skipped'?'Duplicate':q.status==='error'?'✕ Error':q.status}
      </div>
    </div>`).join('');
}

let mUploadPhotos = []; // photos uploaded this session

async function mStartUpload() {
  if (!mUploadQueue.length) return;
  mUploadCancelled = false;
  const startBtn = document.getElementById('m-start-btn');
  startBtn.disabled = true; startBtn.textContent = 'Uploading…';
  const progressBar = document.getElementById('m-progress-bar');
  progressBar.classList.add('visible');
  document.getElementById('m-progress-fill').style.width = '0%';
  document.getElementById('m-progress-text').textContent = '';
  let done = 0; const total = mUploadQueue.length;
  for (let i=0; i<total; i+=5) {
    if (mUploadCancelled) break;
    const batch = mUploadQueue.slice(i, i+5);
    const fd = new FormData();
    batch.forEach(q => { if(q.status==='pending'){fd.append('files',q.file);q.status='uploading';} });
    mRenderQueue();
    try {
      const res = await mFetch(`/upload/${eventId}`, { method:'POST', body:fd });
      if (!res.ok) { batch.forEach(q=>{if(q.status==='uploading'){q.status='error';}}); }
      else {
        const data = await res.json(); let ri=0;
        batch.forEach(q=>{
          if(q.status==='uploading'){
            const r=data.results?.[ri++];
            if(r?.status==='ok'){q.status='ok';q.faces=r.facesIndexed;}
            else if(r?.status==='skipped'){q.status='skipped';}
            else{q.status='error';}
          }
        });
      }
    } catch(e) { batch.forEach(q=>{if(q.status==='uploading')q.status='error';}); }
    done += batch.length;
    const pct = Math.round((done/total)*100);
    document.getElementById('m-progress-fill').style.width = pct+'%';
    document.getElementById('m-progress-text').textContent = `${done} of ${total} uploaded (${pct}%)`;
    mRenderQueue();
  }
  startBtn.disabled = false; startBtn.textContent = 'Upload all';
  // After upload: refresh My Uploads section
  mLoadMyUploads();
  setTimeout(() => progressBar.classList.remove('visible'), 4000);
}

function mClearQueue() {
  mUploadQueue = []; mRenderQueue();
  document.getElementById('m-upload-actions').style.display = 'none';
}

// ── MY PHOTOS TAB (selfie search) ────────────────────────────────
async function mStartSelfie() {
  document.getElementById('m-mine-welcome').style.display    = 'none';
  document.getElementById('m-mine-camera').style.display     = 'block';
  document.getElementById('m-mine-processing').style.display = 'none';
  document.getElementById('m-mine-results').style.display    = 'none';
  try {
    mVideoStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280}},audio:false});
    document.getElementById('m-video').srcObject = mVideoStream;
  } catch(e) {
    mCancelCamera();
    alert('Camera access denied. Please allow camera access and try again.');
  }
}

function mCancelCamera() {
  if(mVideoStream){mVideoStream.getTracks().forEach(t=>t.stop());mVideoStream=null;}
  document.getElementById('m-mine-camera').style.display = 'none';
  const hasResults = mMinePhotos.length > 0;
  document.getElementById('m-mine-welcome').style.display    = hasResults ? 'none' : 'block';
  document.getElementById('m-mine-results').style.display    = hasResults ? 'block' : 'none';
}

function mCapturePhoto() {
  const video  = document.getElementById('m-video');
  const canvas = document.getElementById('m-canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  if(mVideoStream){mVideoStream.getTracks().forEach(t=>t.stop());mVideoStream=null;}
  document.getElementById('m-mine-camera').style.display     = 'none';
  document.getElementById('m-mine-processing').style.display = 'block';
  canvas.toBlob(blob => { if(!blob){mCancelCamera();return;} mSearchFace(blob); }, 'image/jpeg', 0.9);
}

async function mSearchFace(blob) {
  try {
    const form = new FormData(); form.append('selfie', blob, 'selfie.jpg');
    const r = await mFetch(`/search`, { method:'POST', body:form });
    const data = await r.json();
    if (!r.ok) { document.getElementById('m-mine-processing').style.display='none'; document.getElementById('m-mine-welcome').style.display='block'; alert(data.error||'Search failed'); return; }
    mMinePhotos = data.myPhotos || [];
    mRenderMinePhotos();
  } catch(e) {
    document.getElementById('m-mine-processing').style.display = 'none';
    document.getElementById('m-mine-welcome').style.display    = 'block';
  }
}

function mRenderMinePhotos() {
  document.getElementById('m-mine-processing').style.display = 'none';
  document.getElementById('m-mine-results').style.display    = 'block';
  const grid  = document.getElementById('m-grid-mine');
  const empty = document.getElementById('m-empty-mine');
  const count = document.getElementById('m-count-mine');
  const dlBtn = document.getElementById('m-btn-dl-mine');
  if (!mMinePhotos.length) { grid.innerHTML=''; empty.style.display='block'; count.textContent=''; dlBtn.style.display='none'; return; }
  empty.style.display='none'; count.textContent=`${mMinePhotos.length} photo${mMinePhotos.length!==1?'s':''}`; dlBtn.style.display='inline-flex';
  grid.innerHTML = mMinePhotos.map((p,i) => {
    const isFav = mPersonalFavIds.has(p.id);
    const isOwn = p.uploaded_by === memberInfo?.id;
    return `<div class="photo-card" style="position:relative" onclick="mOpenLb('mine',${i})">
      <img src="${p.thumbUrl||p.url}" loading="lazy">
      <button class="m-fav-btn ${isFav?'active':''}" data-mid="${p.id}" onclick="event.stopPropagation();mToggleFav('${p.id}',this)">${isFav?'❤':'♡'}</button>
      ${isOwn?`<button class="m-del-btn" onclick="event.stopPropagation();mDeletePhoto('${p.id}','mine')" title="Delete">🗑</button>`:''}
      ${mUploaderBadge(p.uploader_name)}
    </div>`;
  }).join('');
}

// Load photos uploaded by this member (My Uploads section)
let mMyUploadedPhotos = [];
async function mLoadMyUploads() {
  const grid  = document.getElementById('m-grid-uploads');
  const empty = document.getElementById('m-empty-uploads');
  const count = document.getElementById('m-count-uploads');
  if (!grid) return;
  try {
    const r = await mFetch(`/collab/${eventId}/all-photos?uploadedBy=${memberInfo.id}`);
    if (!r.ok) return;
    const data = await r.json();
    mMyUploadedPhotos = data.photos || [];
    count.textContent = mMyUploadedPhotos.length ? `${mMyUploadedPhotos.length} photo${mMyUploadedPhotos.length!==1?'s':''}` : '';
    if (!mMyUploadedPhotos.length) { grid.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display='none';
    grid.innerHTML = mMyUploadedPhotos.map((p,i) => {
      const isFav = mPersonalFavIds.has(p.id);
      return `<div class="photo-card" style="position:relative" onclick="mOpenLb('my-uploads',${i})">
        <img src="${p.thumbUrl}" loading="lazy">
        <button class="m-fav-btn ${isFav?'active':''}" data-mid="${p.id}" onclick="event.stopPropagation();mToggleFav('${p.id}',this)">${isFav?'❤':'♡'}</button>
        <button class="m-del-btn" onclick="event.stopPropagation();mDeletePhoto('${p.id}','my-uploads')" title="Delete">🗑</button>
      </div>`;
    }).join('');
  } catch(e) {}
}

// ── ALL PHOTOS TAB ────────────────────────────────────────────────
async function mLoadAllPhotos(showSkeleton=true) {
  const grid  = document.getElementById('m-grid-all');
  const empty = document.getElementById('m-empty-all');
  const count = document.getElementById('m-count-all');
  if (showSkeleton) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--muted)">Loading…</div>`;
  try {
    const r = await mFetch(`/collab/${eventId}/all-photos`);
    if (!r.ok) return;
    const data = await r.json();
    const prev = mAllPhotos.length;
    mAllPhotos = data.photos || [];
    count.textContent = `${mAllPhotos.length} photo${mAllPhotos.length!==1?'s':''}`;
    document.getElementById('m-btn-dl-all').style.display = mAllPhotos.length ? 'inline-flex' : 'none';
    // Activity pill: photos added in last hour
    const hourAgo = Date.now() - 3600000;
    const recent = mAllPhotos.filter(p => new Date(p.indexed_at).getTime() > hourAgo).length;
    const pill = document.getElementById('m-activity-pill');
    if (recent > 0) { pill.style.display='inline-flex'; document.getElementById('m-recent-count').textContent=recent; }
    else { pill.style.display='none'; }
    // Build uploader filter chips
    mBuildUploaderChips();
    mRenderAllGrid(mAllPhotos);
    if (!mAllPhotos.length) { empty.style.display='block'; } else { empty.style.display='none'; }
  } catch(e) {}
}

// Multi-select uploader filter (tap to toggle, multiple allowed)
let mActiveUploaderFilters = new Set(); // empty = All

function mBuildUploaderChips() {
  const chips = document.getElementById('m-uploader-chips');
  const hint  = document.getElementById('m-filter-hint');
  const uploaderMap = {};
  mAllPhotos.forEach(p => { if(p.uploaded_by && p.uploader_name) uploaderMap[p.uploaded_by]=p.uploader_name; });
  const entries = Object.entries(uploaderMap);
  if (entries.length < 2) { chips.innerHTML=''; if(hint)hint.style.display='none'; return; }
  if(hint) hint.style.display='block';
  chips.innerHTML = entries.map(([uid,uname]) =>
    `<button class="filter-chip ${mActiveUploaderFilters.has(uid)?'active':''}" data-uid="${uid}" onclick="mToggleUploaderChip('${uid}')">
      <span class="chip-av" style="background:${mAvatarColor(uname)}">${mInitials(uname)}</span>${uname}
    </button>`
  ).join('');
}

function mToggleUploaderChip(uid) {
  if (mActiveUploaderFilters.has(uid)) {
    mActiveUploaderFilters.delete(uid);
  } else {
    mActiveUploaderFilters.add(uid);
  }
  // Rebuild chip active states
  document.querySelectorAll('#m-uploader-chips .filter-chip').forEach(c => {
    c.classList.toggle('active', mActiveUploaderFilters.has(c.dataset.uid));
  });
  // Apply filter
  const filtered = mActiveUploaderFilters.size === 0
    ? mAllPhotos
    : mAllPhotos.filter(p => mActiveUploaderFilters.has(p.uploaded_by));
  mRenderAllGrid(filtered);
}

function mRenderAllGrid(photos) {
  const grid = document.getElementById('m-grid-all');
  grid.innerHTML = photos.map((p,i) => {
    const isFav = mPersonalFavIds.has(p.id);
    const isOwn = p.uploaded_by === memberInfo?.id;
    return `<div class="photo-card" style="position:relative" onclick="mOpenLb('all',mAllPhotos.indexOf(mAllPhotos.find(x=>x.id==='${p.id}')))">
      <img src="${p.thumbUrl}" loading="lazy">
      <button class="m-fav-btn ${isFav?'active':''}" data-mid="${p.id}" onclick="event.stopPropagation();mToggleFav('${p.id}',this)">${isFav?'❤':'♡'}</button>
      ${isOwn?`<button class="m-del-btn" onclick="event.stopPropagation();mDeletePhoto('${p.id}','all')" title="Delete">🗑</button>`:''}
      ${mUploaderBadge(p.uploader_name)}
    </div>`;
  }).join('');
}

// ── FAVOURITES ────────────────────────────────────────────────────
async function mSyncPersonalFavIds() {
  try {
    const r = await mFetch(`/collab/${eventId}/my-favorites/ids`);
    if (r.ok) { mPersonalFavIds = new Set(await r.json()); }
  } catch(_) {}
}
async function mSyncGroupFavIds() {
  try {
    const r = await mFetch(`/collab/${eventId}/group-favorites/ids`);
    if (r.ok) { mGroupFavIds = new Set(await r.json()); }
  } catch(_) {}
}

async function mLoadPersonalFavs() {
  const grid=document.getElementById('m-grid-personal-favs');
  const empty=document.getElementById('m-empty-personal-favs');
  const count=document.getElementById('m-count-personal-favs');
  const dl=document.getElementById('m-btn-dl-personal-favs');
  grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:1.5rem;color:var(--muted)">Loading…</div>';
  try {
    const r = await mFetch(`/collab/${eventId}/my-favorites`);
    if(!r.ok) return;
    const data = await r.json();
    mPersonalFavPhotos = data.photos||[];
    mPersonalFavIds = new Set(mPersonalFavPhotos.map(p=>p.id));
    count.textContent = `${mPersonalFavPhotos.length} photo${mPersonalFavPhotos.length!==1?'s':''}`;
    dl.style.display = mPersonalFavPhotos.length ? 'inline-flex' : 'none';
    if (!mPersonalFavPhotos.length) { grid.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display='none';
    grid.innerHTML = mPersonalFavPhotos.map((p,i) => `
      <div class="photo-card" style="position:relative" onclick="mOpenLb('personal-favs',${i})">
        <img src="${p.thumbUrl}" loading="lazy">
        <button class="m-fav-btn active" data-mid="${p.id}" onclick="event.stopPropagation();mToggleFav('${p.id}',this)">❤</button>
        ${mUploaderBadge(p.uploader_name)}
      </div>`).join('');
  } catch(_) {}
}

async function mLoadGroupFavs() {
  const grid=document.getElementById('m-grid-group-favs');
  const empty=document.getElementById('m-empty-group-favs');
  const count=document.getElementById('m-count-group-favs');
  const dl=document.getElementById('m-btn-dl-group-favs');
  grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:1.5rem;color:var(--muted)">Loading…</div>';
  try {
    const r = await mFetch(`/collab/${eventId}/group-favorites`);
    if(!r.ok) return;
    const data = await r.json();
    mGroupFavPhotos = data.photos||[];
    mGroupFavIds = new Set(mGroupFavPhotos.map(p=>p.id));
    count.textContent = `${mGroupFavPhotos.length} photo${mGroupFavPhotos.length!==1?'s':''}`;
    dl.style.display = mGroupFavPhotos.length ? 'inline-flex' : 'none';
    if (!mGroupFavPhotos.length) { grid.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display='none';
    grid.innerHTML = mGroupFavPhotos.map((p,i) => `
      <div class="photo-card" style="position:relative" onclick="mOpenLb('group-favs',${i})">
        <img src="${p.thumbUrl}" loading="lazy">
        ${mUploaderBadge(p.uploader_name)}
      </div>`).join('');
  } catch(_) {}
}

async function mToggleFav(photoId, btn) {
  const isFav = mPersonalFavIds.has(photoId);
  // Optimistic UI
  document.querySelectorAll(`[data-mid="${photoId}"]`).forEach(b => {
    b.classList.toggle('active', !isFav);
    b.textContent = !isFav ? '❤' : '♡';
  });
  try {
    if (isFav) {
      await mFetch(`/collab/${eventId}/my-favorites/${photoId}`, {method:'DELETE'});
      mPersonalFavIds.delete(photoId);
    } else {
      await mFetch(`/collab/${eventId}/my-favorites/${photoId}`, {method:'POST'});
      mPersonalFavIds.add(photoId);
    }
    // Update lightbox fav btn if open on same photo
    if (document.getElementById('m-lb').classList.contains('open') && mLbPhotos[mLbIdx]?.id === photoId) {
      document.getElementById('m-lb-fav-btn').textContent = mPersonalFavIds.has(photoId) ? '❤ Unfavourite' : '♡ Favourite';
    }
  } catch(e) {
    document.querySelectorAll(`[data-mid="${photoId}"]`).forEach(b => {
      b.classList.toggle('active', isFav); b.textContent = isFav ? '❤' : '♡';
    });
  }
}

// ── Delete own photo ──────────────────────────────────────────────
async function mDeletePhoto(photoId, context) {
  if (!confirm('Delete this photo? This cannot be undone.')) return;
  try {
    const r = await mFetch(`/events/${eventId}/photos/${photoId}`, {method:'DELETE'});
    if (!r.ok) { const d=await r.json(); alert(d.error||'Delete failed'); return; }
    if (context==='all') { mAllPhotos=mAllPhotos.filter(p=>p.id!==photoId); mRenderAllGrid(mAllPhotos); }
    if (context==='mine') { mMinePhotos=mMinePhotos.filter(p=>p.id!==photoId); mRenderMinePhotos(); }
    if (context==='my-uploads') { mMyUploadedPhotos=mMyUploadedPhotos.filter(p=>p.id!==photoId); mLoadMyUploads(); }
    mCloseLb();
  } catch(e) { alert('Failed to delete photo'); }
}

// ── Download all ──────────────────────────────────────────────────
async function mDownloadAll(context) {
  const map = { all: mAllPhotos, mine: mMinePhotos, 'personal-favs': mPersonalFavPhotos, 'group-favs': mGroupFavPhotos, 'my-uploads': mMyUploadedPhotos };
  const photos = map[context] || [];
  for (let i=0; i<photos.length; i++) {
    try {
      const a=document.createElement('a');
      a.href=photos[i].fullUrl||photos[i].thumbUrl;
      a.download=`photo-${i+1}.jpg`; a.target='_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      await new Promise(r=>setTimeout(r,400));
    } catch(_) {}
  }
}

// ── Member Lightbox ───────────────────────────────────────────────
function mOpenLb(context, idx) {
  const map = { all:mAllPhotos, mine:mMinePhotos, 'personal-favs':mPersonalFavPhotos, 'group-favs':mGroupFavPhotos, 'my-uploads':mMyUploadedPhotos };
  mLbPhotos  = map[context] || [];
  mLbContext = context;
  mLbIdx     = idx;
  document.getElementById('m-lb').classList.add('open');
  mRenderLb();
}

function mRenderLb() {
  const p = mLbPhotos[mLbIdx];
  if (!p) return;
  document.getElementById('m-lb-img').src = p.fullUrl || p.thumbUrl || p.url;
  // Nav arrows
  document.getElementById('m-lb-prev').style.display = mLbIdx > 0 ? 'flex' : 'none';
  document.getElementById('m-lb-next').style.display = mLbIdx < mLbPhotos.length-1 ? 'flex' : 'none';
  // Uploader caption
  const cap = document.getElementById('m-lb-caption');
  cap.textContent = p.uploader_name ? `📤 ${p.uploader_name}` : '';
  // Fav button
  const favBtn = document.getElementById('m-lb-fav-btn');
  favBtn.textContent = mPersonalFavIds.has(p.id) ? '❤ Unfavourite' : '♡ Favourite';
  favBtn.style.display = mLbContext === 'group-favs' ? 'none' : '';
  // Delete button (only own photos)
  const delBtn = document.getElementById('m-lb-del-btn');
  delBtn.style.display = (p.uploaded_by === memberInfo?.id) ? 'inline-flex' : 'none';
}

function mCloseLb() { document.getElementById('m-lb').classList.remove('open'); }

function mLbNavigate(dir) {
  mLbIdx = Math.max(0, Math.min(mLbPhotos.length-1, mLbIdx+dir));
  mRenderLb();
}

function mToggleLbFav() {
  const p = mLbPhotos[mLbIdx];
  if (!p) return;
  mToggleFav(p.id, null);
}

function mLbDownload() {
  const p = mLbPhotos[mLbIdx];
  if (!p) return;
  const a=document.createElement('a'); a.href=p.fullUrl||p.thumbUrl; a.download='photo.jpg'; a.target='_blank';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function mLbDelete() {
  const p = mLbPhotos[mLbIdx]; if (!p) return;
  mDeletePhoto(p.id, mLbContext);
}

boot();
