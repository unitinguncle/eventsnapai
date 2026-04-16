const API = window.location.origin;
let adminKey='', currentEvent=null, uploadQueue=[], uploadErrors=0;
let allUsers=[], currentUserFilter='all', resetPwUserId=null, assignUserId=null;
let allEvents=[], eventsView='grid', eventsSort={col:'created_at',dir:-1}, eventsFiltered=[];
let adminDelEventData=null;

// ── Auth ──
function signIn(){
  const k=document.getElementById('api-key').value.trim();
  if(!k) return;
  adminKey=k;
  verifyAndLoad();
}
document.getElementById('api-key').addEventListener('keydown', e=>{ if(e.key==='Enter') signIn(); });

async function verifyAndLoad(){
  try{
    const r=await api('/events');
    if(!r.ok){ showAuthErr('Invalid API key — please try again.'); adminKey=''; return; }
    sessionStorage.setItem('adminKey', adminKey);
    showApp();
    loadEvents();
    // loadContacts() removed here — pollAdminUnread() handles badge + fires once on login
    startAdminIdleTimer();
  }catch{ showAuthErr('Could not reach the server.'); }
}
function showAuthErr(msg){ const el=document.getElementById('auth-err'); el.textContent=msg; el.style.display='block'; }

function showApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('logout-btn').style.display='inline-flex';
  document.getElementById('admin-bell-btn').style.display='inline-flex';
  document.getElementById('main-app').style.display='block';
  document.getElementById('hdr-user').style.display='inline';
  // Do NOT call loadContacts() here — it will be loaded lazily when the tab is clicked
  // Calling it here caused double-hits against the rate limiter on every login
  startAdminNotifPolling();
}

function logout(){
  adminKey='';
  sessionStorage.removeItem('adminKey');
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('authUser');
  window.location.href='/landing';
}

// ── Admin Inactivity Timeout ──
const ADMIN_IDLE_MS = 4 * 60 * 60 * 1000;
let adminIdleTimer = null;

function resetAdminIdleTimer() {
  clearTimeout(adminIdleTimer);
  adminIdleTimer = setTimeout(adminIdleLogout, ADMIN_IDLE_MS);
}

function adminIdleLogout() {
  const modal = document.getElementById('admin-session-expired-modal');
  if (modal) modal.style.display = 'flex';
  adminKey = '';
  sessionStorage.removeItem('adminKey');
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('authUser');
}

function startAdminIdleTimer() {
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt =>
    document.addEventListener(evt, resetAdminIdleTimer, { passive: true })
  );
  resetAdminIdleTimer();
}

function api(path, opts={}) {
  // Auto-add Content-Type: application/json for mutations that have a JSON body
  const headers = { 'x-admin-key': adminKey };
  if (opts.body && typeof opts.body === 'string' && !opts.headers?.['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
}

function showBanner(msg, type='ok'){
  const el=document.getElementById('alert-banner');
  el.textContent=msg; el.className=`alert alert-${type}`; el.style.display='block';
  setTimeout(()=>{ el.style.display='none'; }, 5000);
}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// ── Events ──
async function loadEvents(){
  // Skeleton loaders
  if(eventsView==='grid'){
    document.getElementById('events-list').innerHTML=Array(4).fill('<div class="skel-card skeleton"></div>').join('');
  } else {
    document.getElementById('events-tbody').innerHTML=Array(4).fill(`<tr><td colspan="6"><div class="skel-row skeleton"></div></td></tr>`).join('');
  }
  const r=await api('/events');
  if(!r.ok){ showBanner('Failed to load events','err'); return; }
  allEvents=await r.json();
  eventsFiltered=[...allEvents];
  populateManagerFilter();
  applyFilters();
}

function populateManagerFilter(){
  const sel=document.getElementById('filter-manager');
  const existing=new Set([...sel.options].map(o=>o.value).filter(v=>v));
  const managers=allEvents.filter(e=>e.owner_name).map(e=>({id:e.owner_id||'',name:e.owner_name}));
  const unique=managers.filter((m,i,a)=>m.id&&!existing.has(m.name)&&a.findIndex(x=>x.name===m.name)===i);
  unique.forEach(m=>{
    const opt=document.createElement('option');
    opt.value=m.name; opt.textContent=m.name;
    sel.appendChild(opt);
  });
}

function applyFilters(){
  const nameQ=document.getElementById('filter-name')?.value.toLowerCase()||'';
  const managerQ=document.getElementById('filter-manager')?.value||'';
  const fromDate=document.getElementById('filter-from')?.value;
  const toDate=document.getElementById('filter-to')?.value;
  eventsFiltered=allEvents.filter(e=>{
    if(nameQ&&!e.name.toLowerCase().includes(nameQ)) return false;
    if(managerQ&&e.owner_name!==managerQ) return false;
    if(fromDate&&new Date(e.created_at)<new Date(fromDate)) return false;
    if(toDate&&new Date(e.created_at)>new Date(toDate)) return false;
    return true;
  });
  sortAndRenderEvents();
}

function clearFilters(){
  document.getElementById('filter-name').value='';
  document.getElementById('filter-manager').value='';
  document.getElementById('filter-from').value='';
  document.getElementById('filter-to').value='';
  applyFilters();
}

function sortEvents(col){
  if(eventsSort.col===col) eventsSort.dir*=-1;
  else { eventsSort.col=col; eventsSort.dir=-1; }
  // Update sort icons
  ['name','owner_name','created_at','photo_count'].forEach(c=>{
    const el=document.getElementById('sort-'+c);
    if(el) el.textContent=c===col?(eventsSort.dir===1?'↑':'↓'):'';
  });
  sortAndRenderEvents();
}

function sortAndRenderEvents(){
  const col=eventsSort.col; const dir=eventsSort.dir;
  eventsFiltered.sort((a,b)=>{
    let av=a[col]??'', bv=b[col]??'';
    if(col==='created_at'){ av=new Date(av).getTime(); bv=new Date(bv).getTime(); }
    if(col==='photo_count'){ av=parseInt(av)||0; bv=parseInt(bv)||0; }
    return av<bv?-dir:av>bv?dir:0;
  });
  if(eventsView==='grid') renderEventsGrid();
  else renderEventsTable();
}

function renderEventsGrid(){
  const c=document.getElementById('events-list');
  if(!eventsFiltered.length){
    c.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🎉</div><div class="empty-title">No events found</div></div>`;
    return;
  }
  c.innerHTML=eventsFiltered.map(e=>`
    <div class="event-card ${currentEvent?.id===e.id?'active':''}" onclick='selectEvent(${JSON.stringify(e).replace(/'/g,"&apos;")})'>
      <div class="event-name">${esc(e.name)}</div>
      <div class="event-meta">Bucket: ${e.bucket_name}</div>
      <div class="event-meta">${e.owner_name?'Manager: '+esc(e.owner_name):''} · ${new Date(e.created_at).toLocaleDateString()}</div>
      <div class="event-meta">${e.photo_count||0} photos</div>
      <span class="badge badge-purple">Open</span>
    </div>`).join('');
}

function renderEventsTable(){
  const tbody=document.getElementById('events-tbody');
  const empty=document.getElementById('events-list-empty');
  if(!eventsFiltered.length){ tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  tbody.innerHTML=eventsFiltered.map(e=>`
    <tr>
      <td><strong>${esc(e.name)}</strong><div style="font-size:11px;color:var(--muted)">${e.bucket_name}</div></td>
      <td>${e.owner_name?esc(e.owner_name):'<span style="color:var(--hint)">—</span>'}</td>
      <td style="font-size:12px;color:var(--muted)">${new Date(e.created_at).toLocaleDateString()}</td>
      <td>${e.photo_count||0}</td>
      <td></td>
      <td style="text-align:right">
        <div class="user-actions" style="justify-content:flex-end">
          <button class="act-btn" onclick='selectEvent(${JSON.stringify(e).replace(/'/g,"&apos;")})'>Open</button>
          <button class="act-btn danger" onclick="openAdminDelEvent('${e.id}','${esc(e.name)}','${esc(e.bucket_name)}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function setEventsView(view){
  eventsView=view;
  document.getElementById('view-grid-btn').classList.toggle('active',view==='grid');
  document.getElementById('view-list-btn').classList.toggle('active',view==='list');
  document.getElementById('events-list').style.display=view==='grid'?'grid':'none';
  document.getElementById('events-list-table').style.display=view==='list'?'block':'none';
  document.getElementById('events-filter-bar').style.display=view==='list'?'flex':'none';
  sortAndRenderEvents();
}

// ── Admin Delete Event (2-step) ──
function openAdminDelEvent(id, name, bucket){
  adminDelEventData={id, name, bucket};
  document.getElementById('admin-del-event-name').textContent=`"${name}" (${bucket})`;
  document.getElementById('admin-del-step1').style.display='block';
  document.getElementById('admin-del-step2').style.display='none';
  document.getElementById('admin-del-confirm-input').value='';
  document.getElementById('admin-del-err').style.display='none';
  document.getElementById('admin-del-event-modal').classList.add('open');
}
function closeAdminDelEvent(){ document.getElementById('admin-del-event-modal').classList.remove('open'); adminDelEventData=null; }
function adminDelStep2(){
  document.getElementById('admin-del-step1').style.display='none';
  document.getElementById('admin-del-step2').style.display='block';
  setTimeout(()=>document.getElementById('admin-del-confirm-input').focus(),100);
}
async function adminDelConfirm(){
  if(!adminDelEventData) return;
  const typed=document.getElementById('admin-del-confirm-input').value.trim();
  const errEl=document.getElementById('admin-del-err');
  if(typed!==adminDelEventData.bucket){
    errEl.textContent=`Bucket name mismatch. Type "${adminDelEventData.bucket}" exactly.`;
    errEl.style.display='block'; return;
  }
  const btn=document.getElementById('admin-del-final-btn');
  btn.disabled=true; btn.textContent='Deleting…';
  try{
    const r=await api(`/events/${adminDelEventData.id}`,{
      method:'DELETE',
      headers:{'x-delete-key':prompt('Enter delete API key:')||''}
    });
    if(!r.ok){
      const d=await r.json(); errEl.textContent=d.error||'Deletion failed'; errEl.style.display='block';
      btn.disabled=false; btn.textContent='Delete permanently'; return;
    }
    closeAdminDelEvent();
    if(currentEvent?.id===adminDelEventData.id) closeDetail();
    showBanner('Event deleted successfully');
    loadEvents();
  }catch(e){
    errEl.textContent=e.message||'Deletion failed'; errEl.style.display='block';
    btn.disabled=false; btn.textContent='Delete permanently';
  }
}

async function selectEvent(ev){
  currentEvent=ev;
  uploadQueue=[]; uploadErrors=0;
  renderQueue();
  document.getElementById('upload-actions').style.display='none';
  document.getElementById('file-input').value='';
  document.getElementById('stat-total').textContent='—';
  document.getElementById('stat-indexed').textContent='—';
  document.getElementById('stat-errs').textContent='—';
  document.getElementById('photo-library').innerHTML='';
  document.getElementById('event-detail').style.display='block';
  document.getElementById('detail-name').textContent=ev.name;
  document.getElementById('detail-bucket').textContent='Bucket: '+ev.bucket_name;
  switchTab('upload');
  loadPhotos();
  renderBrandedQR();
  document.getElementById('event-detail').scrollIntoView({behavior:'smooth',block:'start'});
  loadEvents();
}

function closeDetail(){
  currentEvent=null;
  document.getElementById('event-detail').style.display='none';
  loadEvents();
}

// ── Create event ──
function openCreateModal(){
  document.getElementById('new-name').value='';
  document.getElementById('new-bucket').value='';
  document.getElementById('create-err').style.display='none';
  document.getElementById('create-modal').classList.add('open');
  setTimeout(()=>document.getElementById('new-name').focus(),100);
}
document.getElementById('new-name').addEventListener('input', function(){
  document.getElementById('new-bucket').value=this.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
});
document.getElementById('new-name').addEventListener('keydown', e=>{ if(e.key==='Enter') submitCreateEvent(); });

async function submitCreateEvent(){
  const name=document.getElementById('new-name').value.trim();
  const bucketName=document.getElementById('new-bucket').value.trim();
  if(!name||!bucketName) return;
  const btn=document.getElementById('create-btn');
  btn.disabled=true; btn.textContent='Creating…';
  try{
    const r=await api('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,bucketName})});
    const data=await r.json();
    if(!r.ok){ document.getElementById('create-err').textContent=data.error||'Failed.'; document.getElementById('create-err').style.display='block'; return; }
    closeModal(); showBanner('Event created!'); loadEvents(); selectEvent(data);
  }finally{ btn.disabled=false; btn.textContent='Create'; }
}
function closeModal(){ document.getElementById('create-modal').classList.remove('open'); }

// ── Tabs ──
function switchTab(tab){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  ['upload','library','qr'].forEach(t=>document.getElementById('tab-'+t).style.display=t===tab?'block':'none');
  if(tab==='library') loadPhotos();
  if(tab==='qr') renderBrandedQR();
}

// ── Upload ──
const zone=document.getElementById('upload-zone');
zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');handleFiles(e.dataTransfer.files);});

function handleFiles(files){
  if(!currentEvent) return;
  Array.from(files).filter(f=>f.type.startsWith('image/')).forEach(f=>{
    uploadQueue.push({file:f,status:'pending',faces:null,error:null});
  });
  renderQueue();
  if(uploadQueue.length) document.getElementById('upload-actions').style.display='flex';
}

function renderQueue(){
  const c=document.getElementById('upload-queue');
  c.innerHTML=uploadQueue.map((item,i)=>`
    <div class="queue-item">
      <div class="queue-item-name" title="${item.file.name}">${item.file.name}</div>
      <div class="queue-status s-${item.status}">
        ${item.status==='pending'?'Waiting':
          item.status==='uploading'?'<div class="spinner"></div>':
          item.status==='ok'?(item.faces!==null?item.faces+' face'+(item.faces!==1?'s':''):'✓'):
          item.status==='skipped'?'Duplicate':
          item.error||'Error'}
      </div>
    </div>`).join('');
}

function clearQueue(){
  uploadQueue=[]; renderQueue();
  document.getElementById('upload-actions').style.display='none';
  document.getElementById('file-input').value='';
}

async function startUpload(){
  if(!currentEvent||!uploadQueue.length) return;
  const btn=document.getElementById('start-btn');
  btn.disabled=true; btn.textContent='Uploading…';
  uploadErrors=0;
  const progBar=document.getElementById('progress-bar');
  progBar.classList.add('visible');
  let completed=0;
  const total=uploadQueue.length;
  const batchSize=5;
  for(let i=0;i<uploadQueue.length;i+=batchSize){
    const batch=uploadQueue.slice(i,i+batchSize);
    const form=new FormData();
    batch.forEach((item,idx)=>{ form.append('files',item.file); uploadQueue[i+idx].status='uploading'; });
    renderQueue();
    try{
      const r=await fetch(`${API}/upload/${currentEvent.id}`,{method:'POST',headers:{'x-admin-key':adminKey},body:form});
      const data=await r.json();
      (data.results||[]).forEach((res,idx)=>{
        const q=uploadQueue[i+idx];
        if(res.status==='ok'){ q.status='ok'; q.faces=res.facesIndexed; }
        else if(res.status==='skipped'){ q.status='skipped'; }
        else{ q.status='error'; q.error=res.error||'Failed'; uploadErrors++; }
      });
    }catch{
      batch.forEach((_,idx)=>{ uploadQueue[i+idx].status='error'; uploadQueue[i+idx].error='Network error'; uploadErrors++; });
    }
    completed+=batch.length;
    const pct=Math.round(completed/total*100);
    document.getElementById('progress-fill').style.width=pct+'%';
    document.getElementById('progress-text').textContent=`${completed} / ${total} (${pct}%)`;
    renderQueue();
  }
  btn.disabled=false; btn.textContent='Upload all';
  const done=uploadQueue.filter(i=>i.status==='ok').length;
  const skipped=uploadQueue.filter(i=>i.status==='skipped').length;
  showBanner(
    `${done} uploaded${skipped?', '+skipped+' duplicate'+(skipped!==1?'s':''):''}${uploadErrors?', '+uploadErrors+' error'+(uploadErrors!==1?'s':''):''}`,
    uploadErrors?'warn':'ok'
  );
  setTimeout(()=>progBar.classList.remove('visible'),3000);
  loadPhotos();
}

// ── Library ──
async function loadPhotos(){
  if(!currentEvent) return;
  document.getElementById('photo-library').innerHTML=`<div class="skel-grid">${Array(12).fill('<div class="skel-thumb skeleton"></div>').join('')}</div>`;
  try{
    const r=await api(`/events/${currentEvent.id}/photos`);
    if(r.status===404){
      const d=await r.json().catch(()=>({}));
      showBanner(d.error||'Event no longer exists.','warn');
      closeDetail(); loadEvents(); return;
    }
    if(!r.ok){ console.error('loadPhotos failed:',r.status); return; }
    const data=await r.json();
    const photos=data.photos||[];
    renderLibrary(photos);
    document.getElementById('stat-total').textContent=photos.length;
    document.getElementById('stat-indexed').textContent=photos.filter(p=>p.has_faces).length;
    document.getElementById('stat-errs').textContent=uploadErrors;
  }catch(e){ console.error('loadPhotos error:',e); }
}

function renderLibrary(photos){
  const c=document.getElementById('photo-library');
  if(!photos.length){
    c.innerHTML=`<div class="empty"><div class="empty-icon">📷</div><div class="empty-title">No photos yet</div><div style="font-size:13px;color:var(--muted);margin-top:.5rem">Upload photos to see them here.</div></div>`;
    return;
  }
  c.innerHTML=`<p style="font-size:13px;color:var(--muted);margin-bottom:.75rem">${photos.length} photo${photos.length!==1?'s':''} indexed</p>
  <div class="photo-grid">${photos.map(p=>`
    <div class="photo-thumb" style="padding:0">
      <img src="${p.thumbUrl}" loading="lazy"
           style="width:100%;height:100%;object-fit:cover;display:block;border-radius:calc(var(--r) - 1px)"
           onerror="this.style.display='none'">
    </div>`).join('')}</div>`;
}

// ── Branded QR ──
// ── QR (img-based, no CDN library) ──
let currentQRUrl='';
function renderBrandedQR(){
  if(!currentEvent) return;
  const url=`${window.location.origin}/e/${currentEvent.id}`;
  currentQRUrl=url;
  const encoded=encodeURIComponent(url);
  const src=`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}&bgcolor=ffffff&color=1a1a18&margin=10&ecc=M`;
  const img=document.getElementById('qr-img');
  if(img) img.src=src;
  const nameEl=document.getElementById('qr-event-name');
  if(nameEl) nameEl.textContent=currentEvent.name;
}

function copyQR(){
  navigator.clipboard.writeText(currentQRUrl).then(()=>showBanner('Link copied!'));
}
async function shareQR(){
  if(!currentEvent) return;
  const shareText=`🎉 Visit the album and find key photos and your own photos!\n${currentEvent.name} — RaidCloud EventSnapAI`;
  if(navigator.share){
    try{
      await navigator.share({title:`${currentEvent.name} — EventSnapAI`,text:shareText,url:currentQRUrl});
    }catch(e){ if(e.name!=='AbortError') copyQR(); }
  }else{ copyQR(); showBanner('Link copied! (Share not supported on this device)'); }
}

// ── Section switching ──
function switchSection(section){
  document.querySelectorAll('.top-nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('nav-'+section).classList.add('active');
  document.getElementById('section-events').style.display=section==='events'?'block':'none';
  document.getElementById('section-users').style.display=section==='users'?'block':'none';
  if(section==='users') loadUsers();
}

// ── Users Management ──
async function loadUsers(){
  document.getElementById('users-tbody').innerHTML=`<tr><td colspan="8" style="text-align:center;padding:2rem"><div class="skel-row skeleton"></div><div class="skel-row skeleton" style="margin-top:.5rem"></div></td></tr>`;
  try{
    const r=await api('/users');
    if(!r.ok) throw new Error('Failed to fetch users');
    allUsers=await r.json();
    renderUsers();
  }catch(err){ console.error('Failed to load users:',err); }
}

function renderUsers(){
  const tbody=document.getElementById('users-tbody');
  const empty=document.getElementById('users-empty');
  const filtered=currentUserFilter==='all'?allUsers:allUsers.filter(u=>u.role===currentUserFilter);
  if(filtered.length===0){ tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';

  tbody.innerHTML=filtered.map(u=>{
    const isAdmin=u.role==='admin';
    let nestedRows='';

    if(u.role==='manager'){
      let bucketsHTML='';
      if(u.assigned_buckets_json&&Array.isArray(u.assigned_buckets_json)&&u.assigned_buckets_json[0]!==null){
        bucketsHTML=u.assigned_buckets_json.map(b=>{
          const daysOld=Math.floor((new Date()-new Date(b.created_at))/(1000*60*60*24));
          return `
            <div class="nested-bucket-item">
              <div style="flex:1;min-width:200px">
                <strong>${esc(b.name)}</strong> <span style="color:var(--muted)">(${esc(b.bucket_name)})</span>
                <div style="margin-top:6px;font-size:12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
                  <span>${b.photo_count} photos</span>
                  <span class="${daysOld>7?'danger-text':''}">${daysOld} days old</span>
                  <label class="toggle" title="Toggle access">
                    <input type="checkbox" ${b.can_upload?'checked':''} onchange="toggleBucketAccess('${u.id}','${b.id}',this.checked)">
                    <span class="toggle-slider"></span>
                  </label>
                  <button class="act-btn danger" onclick="openAdminDelEvent('${b.id}','${esc(b.name)}','${esc(b.bucket_name)}')" style="height:24px;font-size:11px">Delete</button>
                </div>
                <div id="client-info-${b.id}" style="margin-top:8px;font-size:12px;color:var(--muted)"></div>
              </div>
            </div>`;
        }).join('');
      } else {
        bucketsHTML=`<div style="color:var(--muted);text-align:center;padding:10px">No buckets assigned</div>`;
      }
      nestedRows=`
        <tr>
          <td><strong>${esc(u.username)}</strong></td>
          <td>${esc(u.display_name)}</td>
          <td><span class="user-role role-${u.role}">${u.role}</span></td>
          <td><span style="color:var(--muted);font-size:13px">${u.creator_name?esc(u.creator_name):'—'}</span></td>
          <td>
            <button class="btn btn-sm" onclick="toggleAccordion('manager-acc-${u.id}');loadBucketClients('${u.id}')">
              View ${u.assigned_buckets_json&&u.assigned_buckets_json[0]!==null?u.assigned_buckets_json.length:0} Buckets
            </button>
          </td>
          <td><span style="font-size:13px">${u.mobile ? esc(u.mobile) : '<span style="color:var(--hint)">—</span>'}</span></td>
          <td><span style="font-size:13px;word-break:break-all">${u.email?esc(u.email):'<span style="color:var(--hint)">—</span>'}</span></td>
          <td>
            <label class="toggle">
              <input type="checkbox" ${u.is_active?'checked':''} onchange="toggleUserActive('${u.id}',this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </td>
          <td style="font-size:12px;color:var(--muted)">${new Date(u.created_at).toLocaleDateString()}</td>
          <td>
            <div class="user-actions">
              <button class="act-btn" onclick="openAssignEvents('${u.id}','${esc(u.username)}')">📅 Events</button>
              <button class="act-btn" onclick="openEditUser('${u.id}')">✏️ Edit</button>
              <button class="act-btn" onclick="openResetPw('${u.id}','${esc(u.username)}')">🔑 Reset</button>
              <button class="act-btn danger" onclick="deleteUser('${u.id}','${esc(u.username)}')">Delete</button>
            </div>
          </td>
        </tr>
        <tr id="manager-acc-${u.id}" style="display:none">
          <td colspan="8" style="padding:0">
            <div class="nested-buckets">${bucketsHTML}</div>
          </td>
        </tr>`;
    } else {
      let simpleBucketList='—';
      if(u.assigned_buckets_json&&Array.isArray(u.assigned_buckets_json)&&u.assigned_buckets_json[0]!==null){
        simpleBucketList=u.assigned_buckets_json.map(b=>b.bucket_name).join(', ');
      }
      nestedRows=`
        <tr>
          <td><strong>${esc(u.username)}</strong></td>
          <td>${esc(u.display_name)}</td>
          <td><span class="user-role role-${u.role}">${u.role}</span></td>
          <td><span style="color:var(--muted);font-size:13px">${u.creator_name?esc(u.creator_name):'—'}</span></td>
          <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(simpleBucketList)}">
            <span style="font-size:13px;color:var(--muted)">${esc(simpleBucketList)}</span>
          </td>
          <td><span style="font-size:13px">${u.mobile ? esc(u.mobile) : '<span style="color:var(--hint)">—</span>'}</span></td>
          <td><span style="font-size:13px;word-break:break-all">${u.email?esc(u.email):'<span style="color:var(--hint)">—</span>'}</span></td>
          <td>
            ${isAdmin
              ? '<span style="font-size:12px;color:var(--muted)">Active</span>'
              : `<label class="toggle">
                  <input type="checkbox" ${u.is_active?'checked':''} onchange="toggleUserActive('${u.id}',this.checked)">
                  <span class="toggle-slider"></span>
                </label>`}
          </td>
          <td style="font-size:12px;color:var(--muted)">${new Date(u.created_at).toLocaleDateString()}</td>
          <td>
            <div class="user-actions">
              ${!isAdmin?`<button class="act-btn" onclick="openAssignEvents('${u.id}','${esc(u.username)}')">📅 Events</button>`:''}
              <button class="act-btn" onclick="openEditUser('${u.id}')">✏️ Edit</button>
              <button class="act-btn" onclick="openResetPw('${u.id}','${esc(u.username)}')">🔑 Reset</button>
              ${!isAdmin?`<button class="act-btn danger" onclick="deleteUser('${u.id}','${esc(u.username)}')">Delete</button>`:''}
            </div>
          </td>
        </tr>`;
    }
    return nestedRows;
  }).join('');
}

function toggleAccordion(id){
  const el=document.getElementById(id);
  el.style.display=el.style.display==='none'?'table-row':'none';
}

async function toggleBucketAccess(userId, eventId, canAccess){
  try{
    if(!canAccess){
      await api(`/users/${userId}/events/${eventId}`,{method:'DELETE'});
      showBanner('Access revoked');
    }else{
      await api(`/users/${userId}/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId})});
      showBanner('Access restored');
    }
    loadUsers();
  }catch(err){ showBanner('Failed to update bucket access','err'); loadUsers(); }
}

async function loadBucketClients(managerId){
  const user=allUsers.find(u=>u.id===managerId);
  if(!user||!user.assigned_buckets_json) return;
  for(const b of user.assigned_buckets_json){
    if(!b||!b.id) continue;
    const el=document.getElementById('client-info-'+b.id);
    if(!el) continue;
    try{
      const r=await api('/events/'+b.id+'/clients');
      if(!r.ok){ el.innerHTML=''; continue; }
      const clients=await r.json();
      el.innerHTML=clients.length>0
        ?`<span style="color:var(--ok)">👤 Client:</span> <strong>${esc(clients[0].username)}</strong> · <button class="act-btn" onclick="openResetPw('${clients[0].id}','${esc(clients[0].username)}')" style="height:22px;font-size:11px">🔑 Reset Password</button>`
        :`<span style="color:var(--hint)">No client login created</span>`;
    }catch{ el.innerHTML=''; }
  }
}

function filterUsers(role, btn){
  currentUserFilter=role;
  document.querySelectorAll('.user-sub-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderUsers();
}

async function toggleUserActive(userId, isActive){
  try{
    const r=await api(`/users/${userId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isActive})});
    if(!r.ok) throw new Error();
    const u=allUsers.find(u=>u.id===userId);
    if(u) u.is_active=isActive;
    showBanner(isActive?'User activated':'User deactivated');
  }catch(err){ showBanner('Failed to update user','err'); loadUsers(); }
}

// ── Create user modal ──
function openCreateUserModal(){
  document.getElementById('user-modal').classList.add('open');
  document.getElementById('user-err').style.display='none';
  document.getElementById('new-username').value='';
  document.getElementById('new-displayname').value='';
  document.getElementById('new-password').value='';
  document.getElementById('new-role').value='manager';
}
function closeUserModal(){ document.getElementById('user-modal').classList.remove('open'); }
document.getElementById('user-modal').addEventListener('click',function(e){ if(e.target===this) closeUserModal(); });

async function submitCreateUser(){
  const username=document.getElementById('new-username').value.trim();
  const displayName=document.getElementById('new-displayname').value.trim();
  const password=document.getElementById('new-password').value;
  const role=document.getElementById('new-role').value;
  const mobile=document.getElementById('new-mobile').value.trim();
  const phone='';
  const email=document.getElementById('new-email').value.trim();
  const errEl=document.getElementById('user-err');
  if(!username||!displayName||!password){ errEl.textContent='All fields are required'; errEl.style.display='block'; return; }
  if(!mobile){ errEl.textContent='Mobile is mandatory'; errEl.style.display='block'; return; }
  try{
    const r=await api('/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,displayName,password,role,mobile,phone,email})});
    const data=await r.json();
    if(!r.ok){ errEl.textContent=data.error||'Failed to create user'; errEl.style.display='block'; return; }
    closeUserModal();
    showBanner(`User "${username}" created`);
    loadUsers();
  }catch(err){ errEl.textContent=err.message||'Failed to create user'; errEl.style.display='block'; }
}

// ── Reset password modal ──
function openResetPw(userId, username){
  resetPwUserId=userId;
  document.getElementById('pw-modal').classList.add('open');
  document.getElementById('pw-user-label').textContent=`Resetting password for: ${username}`;
  document.getElementById('pw-err').style.display='none';
  document.getElementById('reset-password').value='';
}
function closePwModal(){ document.getElementById('pw-modal').classList.remove('open'); resetPwUserId=null; }
document.getElementById('pw-modal').addEventListener('click',function(e){ if(e.target===this) closePwModal(); });

async function submitResetPassword(){
  const password=document.getElementById('reset-password').value;
  const errEl=document.getElementById('pw-err');
  if(!password||password.length<6){ errEl.textContent='Password must be at least 6 characters'; errEl.style.display='block'; return; }
  try{
    const r=await api(`/users/${resetPwUserId}/password`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    if(!r.ok){ const d=await r.json(); errEl.textContent=d.error||'Failed'; errEl.style.display='block'; return; }
    closePwModal();
    showBanner('Password reset successfully');
  }catch(err){ errEl.textContent=err.message||'Failed to reset password'; errEl.style.display='block'; }
}

// ── Assign events modal ──
async function openAssignEvents(userId, username){
  assignUserId=userId;
  document.getElementById('assign-modal').classList.add('open');
  document.getElementById('assign-user-label').textContent=`Assigning access for: ${username}`;
  document.getElementById('assign-err').style.display='none';
  document.getElementById('assign-list').innerHTML='<div class="spinner" style="margin: 2rem auto"></div>';
  try{
    const [allEvRes, userEvRes]=await Promise.all([api('/events'),api(`/users/${userId}/events`)]);
    if(!allEvRes.ok||!userEvRes.ok) throw new Error('Failed to load events');
    const allEv=await allEvRes.json();
    const userEv=await userEvRes.json();
    const userEventIds=new Set(userEv.map(e=>e.id));
    if(allEv.length===0){
      document.getElementById('assign-list').innerHTML='<div style="text-align:center;padding:1rem;color:var(--muted);font-size:13px">No events available.</div>';
      return;
    }
    document.getElementById('assign-list').innerHTML=allEv.map(e=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem;border-bottom:.5px solid var(--border-s)">
        <div>
          <div style="font-weight:600;font-size:14px">${esc(e.name)}</div>
          <div style="font-size:12px;color:var(--muted)">${e.bucket_name}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" onchange="toggleEventAccess('${userId}','${e.id}',this.checked)" ${userEventIds.has(e.id)?'checked':''}>
          <span class="toggle-slider"></span>
        </label>
      </div>`).join('');
  }catch(err){
    document.getElementById('assign-err').textContent=err.message;
    document.getElementById('assign-err').style.display='block';
    document.getElementById('assign-list').innerHTML='';
  }
}
function closeAssignModal(){ document.getElementById('assign-modal').classList.remove('open'); assignUserId=null; }
document.getElementById('assign-modal').addEventListener('click',function(e){ if(e.target===this) closeAssignModal(); });

async function toggleEventAccess(userId, eventId, isGranted){
  try{
    const res=await api(`/users/${userId}/events${isGranted?'':'/'+eventId}`,{
      method:isGranted?'POST':'DELETE',
      headers:isGranted?{'Content-Type':'application/json'}:undefined,
      body:isGranted?JSON.stringify({eventId,canUpload:true,canDelete:true,canManage:false}):undefined
    });
    if(!res.ok) throw new Error();
    showBanner(isGranted?'Event access granted':'Event access revoked');
  }catch(err){ showBanner('Failed to update event access','err'); openAssignEvents(assignUserId,''); }
}

// ── Delete user ──
async function deleteUser(userId, username){
  if(!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  try{
    const r=await api(`/users/${userId}`,{method:'DELETE'});
    const data=await r.json();
    if(!r.ok){
      // Show the error from server (e.g. manager has buckets assigned)
      showBanner(data.error||'Failed to delete user','err');
      return;
    }
    showBanner(`User "${username}" deleted`);
    loadUsers();
  }catch(err){ showBanner('Failed to delete user','err'); }
}

// ── Edit user modal ──
function openEditUser(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  document.getElementById('edit-user-modal').classList.add('open');
  document.getElementById('edit-user-err').style.display = 'none';
  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-username').value = user.username;
  document.getElementById('edit-displayname').value = user.display_name;
  document.getElementById('edit-mobile').value = user.mobile || '';
  document.getElementById('edit-email').value = user.email || '';
}

function closeEditUserModal() { document.getElementById('edit-user-modal').classList.remove('open'); }
document.getElementById('edit-user-modal').addEventListener('click', function(e){ if(e.target === this) closeEditUserModal(); });

async function submitEditUser() {
  const id = document.getElementById('edit-user-id').value;
  const username = document.getElementById('edit-username').value.trim();
  const displayName = document.getElementById('edit-displayname').value.trim();
  const mobile = document.getElementById('edit-mobile').value.trim();
  const phone = '';
  const email = document.getElementById('edit-email').value.trim();
  const errEl = document.getElementById('edit-user-err');

  if (!username || !displayName) { errEl.textContent = 'Username and Display Name are required'; errEl.style.display = 'block'; return; }
  if (!mobile) { errEl.textContent = 'Mobile is mandatory'; errEl.style.display = 'block'; return; }

  try {
    const res = await api(`/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, mobile, phone, email })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Failed to update user'; errEl.style.display = 'block'; return; }
    closeEditUserModal();
    showBanner(`User updated successfully`);
    loadUsers();
  } catch(err) {
    errEl.textContent = err.message || 'Failed to update user'; errEl.style.display = 'block';
  }
}

// ── Contact Requests ──
async function loadContacts() {
  const tbody = document.getElementById('contacts-tbody');
  const empty = document.getElementById('contacts-empty');
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem"><div class="skel-row skeleton"></div></td></tr>`;
  try {
    const r = await api('/contact');
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--err)">Failed to load contacts: ${err.error || r.status}</td></tr>`;
      return;
    }
    const data = await r.json();
    if (!data || !Array.isArray(data) || data.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    
    const unread = data.filter(c => !c.is_read).length;
    if (unread > 0 && !sessionStorage.getItem('contactAlertShown')) {
      document.getElementById('custom-alert-title').textContent = 'Unread Contact Requests';
      document.getElementById('custom-alert-msg').textContent = `You have ${unread} unread contact request(s) waiting for you.`;
      document.getElementById('custom-alert-modal').classList.add('open');
      sessionStorage.setItem('contactAlertShown', 'true');
    }

    const contactTab = document.getElementById('nav-contacts');
    if (contactTab) {
      contactTab.textContent = unread > 0 ? `Contact us forms (${unread})` : 'Contact us forms';
      contactTab.style.color = unread > 0 ? 'var(--err)' : '';
    }

    tbody.innerHTML = data.map(c => `
      <tr style="background:${c.is_read ? 'transparent' : 'var(--accent-l)'}">
        <td style="font-size:12px;color:var(--muted)">${new Date(c.created_at).toLocaleString()}</td>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.contact_info)}</td>
        <td style="max-width:300px;white-space:pre-wrap;font-size:13px">${esc(c.message)}</td>
        <td>
          ${c.is_read 
            ? '<span style="font-size:12px;color:var(--muted)">Read</span>' 
            : `<button class="btn btn-sm btn-primary" onclick="markContactRead('${c.id}')">Mark Read</button>`}
        </td>
      </tr>
    `).join('');
  } catch(e) {
    console.error('loadContacts error:', e);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--err)">Failed to load contacts</td></tr>';
  }
}

async function markContactRead(id) {
  try {
    await api(`/contact/${id}/read`, { method: 'PATCH' });
    showBanner('Marked as read');
    loadContacts();
  } catch(e) { showBanner('Failed to mark read', 'err'); }
}

async function loadFeedback() {
  const tbody  = document.getElementById('feedback-tbody');
  const empty  = document.getElementById('feedback-empty');
  const role   = document.getElementById('feedback-role-filter')?.value || '';
  const status = document.getElementById('feedback-status-filter')?.value || '';
  try {
    let url = '/feedback?';
    if (role)            url += `role=${encodeURIComponent(role)}&`;
    if (status==='unread') url += 'unread=true&';
    if (status==='pinned') url += 'pinned=true&';
    const r = await api(url.replace(/&$/, ''));
    if (!r.ok) { tbody.innerHTML = '<tr><td colspan="7" style="color:var(--err);text-align:center">Failed to load</td></tr>'; return; }
    const data = await r.json();

    // Update tab badge
    const countR = await api('/feedback/unread-count');
    if (countR.ok) {
      const { count } = await countR.json();
      const tab = document.getElementById('nav-feedback');
      if (tab) { tab.textContent = count > 0 ? `Feedback (${count})` : 'Feedback'; tab.style.color = count > 0 ? 'var(--err)' : ''; }
    }

    if (!data.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const roleColors = { manager: '#6366f1', user: '#22c55e', visitor: '#f59e0b', admin: '#ef4444' };
    tbody.innerHTML = data.map(f => `
      <tr style="${f.is_read ? '' : 'background:rgba(99,102,241,0.06)'}${f.is_pinned ? ';border-left:3px solid #f59e0b' : ''}">
        <td><span style="
          display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;
          background:${roleColors[f.role]||'#6366f1'}22;color:${roleColors[f.role]||'#6366f1'}">
          ${f.role.toUpperCase()}
        </span></td>
        <td>${esc(f.display_name||'Anonymous')}</td>
        <td style="font-size:12px">${f.contact_info ? esc(f.contact_info) : '<span style="color:var(--hint)">—</span>'}</td>
        <td style="font-size:12px">${f.event_name ? esc(f.event_name) : '<span style="color:var(--hint)">—</span>'}</td>
        <td style="white-space:pre-wrap;font-size:13px;word-break:break-word;overflow-wrap:break-word">${esc(f.message)}</td>
        <td style="font-size:11px;color:var(--hint)">${new Date(f.created_at).toLocaleString('en-IN')}</td>
        <td style="white-space:nowrap">
          ${f.is_read ? '<span style="color:var(--ok,#22c55e);font-size:11px">✓ Read</span>' : `<button class="btn btn-sm btn-primary" onclick="markFeedbackRead('${f.id}')">Mark Read</button>`}
          <button class="btn btn-sm" onclick="pinFeedback('${f.id}')" title="${f.is_pinned?'Unpin':'Pin'}">${f.is_pinned?'📌':'📍'}</button>
          <button class="btn btn-sm" onclick="discardFeedback('${f.id}')" title="Discard" style="color:var(--err)">✕</button>
        </td>
      </tr>
    `).join('');
  } catch(e) { console.error('loadFeedback error:', e); }
}

async function markFeedbackRead(id) {
  await api(`/feedback/${id}/read`, { method: 'PATCH' });
  loadFeedback();
}
async function pinFeedback(id) {
  await api(`/feedback/${id}/pin`, { method: 'PATCH' });
  loadFeedback();
}
async function discardFeedback(id) {
  if (!confirm('Discard this feedback? It will be removed from the list.')) return;
  await api(`/feedback/${id}/discard`, { method: 'PATCH' });
  loadFeedback();
}

function closeCustomAlert() {
  document.getElementById('custom-alert-modal').classList.remove('open');
}
let adminToastTimer = null;
function showAdminToast(msg) {
  const el = document.getElementById('admin-notif-toast');
  document.getElementById('admin-toast-msg').textContent = msg;
  el.style.display = 'block';
  clearTimeout(adminToastTimer);
  adminToastTimer = setTimeout(closeAdminToast, 5000);
}
function closeAdminToast() {
  document.getElementById('admin-notif-toast').style.display = 'none';
}


let adminBellInterval = null;
let adminPrevUnread = 0; // track previous unread count to detect new arrivals

async function pollAdminUnread() {
  try {
    const [fbR, ctR] = await Promise.all([
      api('/feedback/unread-count'),
      api('/contact?unread=true')
    ]);
    let total = 0;
    if (fbR.ok) { const d = await fbR.json(); total += d.count || 0; }
    if (ctR.ok) { const d = await ctR.json(); total += (Array.isArray(d) ? d.filter(c=>!c.is_read).length : 0); }
    const badge = document.getElementById('admin-notif-badge');
    if (badge) badge.style.display = total > 0 ? 'block' : 'none';
    // Show a toast if new unread items appeared since last poll
    if (total > adminPrevUnread) {
      const diff = total - adminPrevUnread;
      showAdminToast(`📨 ${diff} new submission${diff > 1 ? 's' : ''} received`);
    }
    adminPrevUnread = total;
  } catch(_) {}
}

function startAdminNotifPolling() {
  pollAdminUnread();
  adminBellInterval = setInterval(pollAdminUnread, 60000);
}

function toggleAdminNotifPanel() {
  // Bell shows a small dropdown with unread counts and quick links
  const existing = document.getElementById('admin-bell-dropdown');
  if (existing) { existing.remove(); return; }
  const btn = document.getElementById('admin-bell-btn');
  const dropdown = document.createElement('div');
  dropdown.id = 'admin-bell-dropdown';
  dropdown.style.cssText = 'position:fixed;top:56px;right:16px;z-index:99999;background:var(--surface,#1e1e2e);border:1px solid var(--border);border-radius:12px;padding:12px 0;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  dropdown.innerHTML = `
    <div style="padding:8px 16px;font-size:12px;color:var(--hint);text-transform:uppercase;letter-spacing:0.05em">Quick Access</div>
    <button onclick="switchSection('feedback');document.getElementById('admin-bell-dropdown')?.remove()" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;color:var(--text);cursor:pointer;font-size:14px">
      💬 Feedback Inbox
    </button>
    <button onclick="switchSection('contacts');document.getElementById('admin-bell-dropdown')?.remove()" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;color:var(--text);cursor:pointer;font-size:14px">
      📨 Contact Forms
    </button>
    <button onclick="switchSection('send-notification');document.getElementById('admin-bell-dropdown')?.remove()" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;color:var(--text);cursor:pointer;font-size:14px">
      🔔 Send Notification
    </button>
  `;
  document.body.appendChild(dropdown);
  // Close on outside click
  setTimeout(() => {
    function outsideClick(e) {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.remove();
        document.removeEventListener('click', outsideClick);
      }
    }
    document.addEventListener('click', outsideClick);
  }, 0);
}

function updateNotifTargetUser() {
  const val = document.getElementById('notif-target').value;
  document.getElementById('notif-user-select').style.display = val === 'specific' ? 'block' : 'none';
  if (val === 'specific') loadUsersForNotifDropdown();
}

async function loadUsersForNotifDropdown() {
  const sel = document.getElementById('notif-specific-user');
  const r = await api('/users');
  if (!r.ok) return;
  const users = await r.json();
  const managers = users.filter(u => u.role === 'manager' || u.role === 'user');
  sel.innerHTML = managers.map(u =>
    `<option value="${u.id}">${esc(u.display_name)} (${u.role})</option>`
  ).join('');
}

async function sendAdminNotification() {
  const title = document.getElementById('notif-title').value.trim();
  const body  = document.getElementById('notif-body').value.trim();
  const target = document.getElementById('notif-target').value;
  const result = document.getElementById('notif-send-result');

  if (!title || !body) { result.textContent = 'Title and message are required.'; result.style.color='var(--err)'; return; }

  const payload = { title, body };
  if (target === 'specific') {
    payload.recipientId = document.getElementById('notif-specific-user').value;
  } else if (target === 'role_manager') {
    payload.recipientRole = 'manager';
  } else if (target === 'role_user') {
    payload.recipientRole = 'user';
  }

  document.getElementById('notif-send-result').textContent = 'Sending...';
  document.getElementById('notif-send-result').style.color = '';

  const r = await api('/notifications', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (r.ok) {
    result.textContent = '✓ Notification sent!';
    result.style.color = 'var(--ok,#22c55e)';
    document.getElementById('notif-title').value = '';
    document.getElementById('notif-body').value = '';
    loadSentNotifications();
    setTimeout(() => { result.textContent = ''; }, 4000);
  } else {
    const d = await r.json();
    result.textContent = d.error || 'Failed to send.';
    result.style.color = 'var(--err)';
  }
}

async function loadSentNotifications() {
  const tbody = document.getElementById('sent-notif-tbody');
  if (!tbody) return;
  const r = await api('/notifications/sent');
  if (!r.ok) return;
  const data = await r.json();
  tbody.innerHTML = data.map(n => `
    <tr>
      <td style="font-size:13px">${n.recipient_id ? esc(n.recipient_name||n.recipient_id) : `All ${n.recipient_role}s`}</td>
      <td style="font-weight:600">${esc(n.title)}</td>
      <td style="font-size:13px;max-width:300px;white-space:pre-wrap">${esc(n.body)}</td>
      <td style="font-size:11px;color:var(--hint)">${new Date(n.created_at).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}

let originalSwitchSection = switchSection;
switchSection = function(section) {
  originalSwitchSection(section);
  // Section panels managed outside base switchSection
  document.getElementById('section-contacts').style.display = section === 'contacts' ? 'block' : 'none';
  const sf = document.getElementById('section-feedback');
  if (sf) sf.style.display = section === 'feedback' ? 'block' : 'none';
  const sn = document.getElementById('section-send-notification');
  if (sn) sn.style.display = section === 'send-notification' ? 'block' : 'none';
  // Handle active state for extra nav buttons
  document.getElementById('nav-contacts')?.classList.toggle('active', section === 'contacts');
  document.getElementById('nav-feedback')?.classList.toggle('active', section === 'feedback');
  document.getElementById('nav-send-notification')?.classList.toggle('active', section === 'send-notification');
  // Lazy-load data
  if (section === 'contacts') loadContacts();
  if (section === 'feedback') loadFeedback();
  if (section === 'send-notification') loadSentNotifications();
};

async function loadPastCustomers() {
  const tbody = document.getElementById('users-tbody');
  const empty = document.getElementById('users-empty');
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem"><div class="skel-row skeleton"></div></td></tr>`;
  try {
    const r = await api('/users/past-customers');
    if (!r.ok) throw new Error();
    const data = await r.json();
    if (data.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = data.map(u => `
      <tr style="opacity:0.7">
        <td><strong>${esc(u.username)}</strong> <span style="font-size:11px;color:var(--muted)">(Deleted)</span></td>
        <td>${esc(u.display_name)}</td>
        <td><span class="user-role role-${u.role}">${u.role}</span></td>
        <td><span style="color:var(--muted);font-size:13px">—</span></td>
        <td><span style="color:var(--muted);font-size:13px">Archived</span></td>
        <td><span style="font-size:13px">${u.mobile ? esc(u.mobile) : '<span style="color:var(--hint)">—</span>'}</span></td>
        <td><span style="font-size:13px;word-break:break-all">${u.email ? esc(u.email) : '<span style="color:var(--hint)">—</span>'}</span></td>
        <td><span style="font-size:12px;color:var(--muted)">Deleted: ${new Date(u.deleted_at).toLocaleDateString()}</span></td>
        <td></td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--err)">Failed to load past customers</td></tr>';
  }
}

// Intercept filterUsers to handle 'past' gracefully
let originalFilterUsers = filterUsers;
filterUsers = function(role, btn) {
  if (role === 'past') {
    currentUserFilter = role;
    document.querySelectorAll('.user-sub-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadPastCustomers();
  } else {
    originalFilterUsers(role, btn);
  }
};

// ── Boot ──
const saved=sessionStorage.getItem('adminKey');
if(saved){ adminKey=saved; verifyAndLoad(); }
