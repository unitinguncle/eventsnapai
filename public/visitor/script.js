const API = window.location.origin;
let eventId=null, eventData=null, token=null, videoStream=null;
let myPhotos=[], generalPhotos=[], favPhotos=[];
let currentBlob = null;
let lastRefreshTime = 0;
let isRefreshing = false;
let selectMode=null, selected=new Set();
let currentLbUrl=null;

// ── Screens ──
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showError(msg){
  document.getElementById('error-msg').textContent=msg;
  show('error-screen');
}

// ── Boot ──
async function boot(){
  eventId=window.location.hash.slice(1);
  if(!eventId){showError('Invalid QR code — no event ID found.');return;}
  try{
    const r=await fetch(`${API}/events/${eventId}/token`);
    if(!r.ok){showError('This event was not found or is no longer active.');return;}
    const d=await r.json();
    token=d.token; eventData=d.event;
    document.getElementById('welcome-name').textContent=eventData.name;
    document.getElementById('results-event-name').textContent=eventData.name;
    show('welcome-screen');
  }catch(e){showError('Could not connect to the server. Check your connection.');}
}

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
    const p = photos[idx];
    openLb(p.fullUrl || p.url);
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
function openLb(url){
  currentLbUrl = url;
  document.getElementById('lb-img').src=url;
  document.getElementById('lb').classList.add('open');
}
function closeLb(){
  document.getElementById('lb').classList.remove('open');
  document.getElementById('lb-img').src='';
}
document.getElementById('lb').addEventListener('click',function(e){if(e.target===this)closeLb();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLb();});

// ── Boot ──
async function boot(){
  eventId=window.location.hash.slice(1);
  if(!eventId){showError('Invalid QR code — no event ID found.');hideSplash();return;}
  try{
    const r=await fetch(`${API}/events/${eventId}/token`);
    if(!r.ok){showError('This event was not found or is no longer active.');hideSplash();return;}
    const d=await r.json();
    token=d.token; eventData=d.event;
    document.getElementById('welcome-name').textContent=eventData.name;
    document.getElementById('results-event-name').textContent=eventData.name;
    // Show splash for 2.5s then transition
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

boot();
