// 情儿的食谱（云存版）前端脚本
// - 原图上传到 Vercel Blob（/api/upload）
// - 本地 IndexedDB 仅保存缩略图与元数据
// - 列表视图、月视图、搜索、CSV/JSON 导出/导入、图片查看

/* ================= IndexedDB ================= */
const DB_NAME = 'qinger_recipes_db_v2';
const STORE   = 'records';
let dbP;
function openDB() {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('by_date', 'date');
        os.createIndex('by_name', 'name');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return dbP;
}
async function getAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}
async function putRecord(rec) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
async function deleteRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/* ================= Utils ================= */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmt  = (d) => new Date(d).toISOString().slice(0, 10);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2)));

function compressToThumb(file, maxW = 360, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload  = () => (img.src = fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/* ================= Upload（含详细报错） ================= */
async function uploadOriginalSafe(file) {
  const endpoint = `/api/upload?filename=${encodeURIComponent(file.name)}`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'PUT',
      body: file,
      headers: { 'content-type': file.type || 'application/octet-stream' },
    });
  } catch (e) {
    throw new Error('网络异常：' + e.message);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('[upload] HTTP', res.status, text);
    throw new Error(`上传失败：HTTP ${res.status} ${text || ''}`.trim());
  }
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('上传返回格式异常：' + text); }
  if (!data?.url) throw new Error('上传成功但未返回 url：' + text);
  return data.url;
}

/* ================= State & DOM refs ================= */
const state = { list: [], view: 'list', month: new Date(), query: '' };

const listModeEl  = document.getElementById('list-mode');
const monthModeEl = document.getElementById('month-mode');
const toggleBtn   = document.getElementById('toggle-view');

function applyView() {
  if (state.view === 'list') {
    if (listModeEl)  listModeEl.style.display  = 'block';
    if (monthModeEl) monthModeEl.style.display = 'none';
    if (toggleBtn)   toggleBtn.textContent = '月视图';
  } else {
    if (listModeEl)  listModeEl.style.display  = 'none';
    if (monthModeEl) monthModeEl.style.display = 'block';
    if (toggleBtn)   toggleBtn.textContent = '列表';
  }
}

/* ================= Render ================= */
async function load() {
  state.list = await getAll();
  render();
}
function render() {
  applyView();
  const q = state.query.trim();
  let filtered = state.list;
  if (q) filtered = state.list.filter(r => r.name.includes(q) || r.date.includes(q));
  if (state.view === 'list') renderList(filtered);
  else renderMonth(filtered);
}
function renderList(list) {
  const wrap = $('#list-wrap');
  wrap.innerHTML = '';
  if (!list.length) { wrap.innerHTML = `<div class="empty">还没有记录，先来第一餐吧 🍚</div>`; return; }

  list.sort((a,b)=> (b.date||'').localeCompare(a.date||'') || (b.createdAt||0)-(a.createdAt||0));

  for (const rec of list) {
    const thumbs = rec.photos.map(p=>`<img class="thumb" src="${p.thumb}" data-url="${p.url}" title="点我查看大图">`).join('');
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-hd">
        <div><b>${rec.name}</b></div>
        <div class="muted">${rec.date} · ${rec.photos.length}张图</div>
      </div>
      <div class="thumbs">${thumbs}</div>
      <div class="ops">
        <button class="btn ghost" data-act="view" data-id="${rec.id}">查看</button>
        <button class="btn danger" data-act="del"  data-id="${rec.id}">删除</button>
      </div>`;
    wrap.appendChild(el);
  }

  wrap.querySelectorAll('.thumb').forEach(img => img.addEventListener('click', () => openLightbox(img.dataset.url)));
  wrap.querySelectorAll('.btn[data-act="del"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除这道菜吗？')) return;
      await deleteRecord(btn.dataset.id);
      await load();
    });
  });
  wrap.querySelectorAll('.btn[data-act="view"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rec = state.list.find(r => r.id === btn.dataset.id);
      if (rec) openAlbum(rec);
    });
  });
}
function renderMonth(list) {
  const grid  = $('#month-grid');
  const title = $('#month-title');
  const base  = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
  const y = base.getFullYear(), m = base.getMonth();
  if (title) title.textContent = `${y}年 ${String(m+1).padStart(2,'0')}月`;

  const map = {};
  for (const r of list) (map[r.date] ||= []).push(r);

  const firstDay = new Date(y, m, 1).getDay() || 7;
  const days = new Date(y, m+1, 0).getDate();
  if (grid) grid.innerHTML = '';
  const total = Math.ceil((firstDay-1 + days) / 7) * 7;

  for (let i=0; i<total; i++){
    const dayNum = i - (firstDay-1) + 1;
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (dayNum>=1 && dayNum<=days) {
      const date = `${y}-${String(m+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
      const recs = map[date] || [];
      const thumbs = [];
      for (const rec of recs) {
        for (const p of rec.photos) {
          thumbs.push(`<img src="${p.thumb}" class="mini" title="${rec.name}" data-url="${p.url}">`);
          if (thumbs.length>=3) break;
        }
        if (thumbs.length>=3) break;
      }
      cell.innerHTML = `
        <div class="day">${dayNum}${recs.length?`<span class="badge">${recs.length}</span>`:''}</div>
        <div class="mini-wrap">${thumbs.join('')}</div>`;
    } else {
      cell.classList.add('blank');
    }
    grid && grid.appendChild(cell);
  }
  grid?.querySelectorAll('.mini').forEach(img => img.addEventListener('click', ()=> openLightbox(img.dataset.url)));
}

/* ================= Overlays ================= */
function openLightbox(url){ const o = $('#lightbox'); o.querySelector('img').src = url; o.classList.add('show'); }
function closeLightbox(){ const o = $('#lightbox'); o.classList.remove('show'); o.querySelector('img').src=''; }
function openAlbum(rec){ const o = $('#album'); const b = o.querySelector('.album-body'); b.innerHTML = rec.photos.map(p=>`<img src="${p.url}">`).join(''); o.classList.add('show'); }
function closeAlbum(){ $('#album').classList.remove('show'); }

/* ================= Export / Import ================= */
async function exportCSV() {
  const list = await getAll();
  const rows = [['date','name','photo_urls']];
  for (const r of list) rows.push([r.date, r.name, r.photos.map(p=>p.url).join('|')]);
  const csv = rows.map(row => row.map(v=>`"${(v??'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'qinger_recipes.csv' });
  a.click();
}
async function backupJSON() {
  const list = await getAll();
  const blob = new Blob([JSON.stringify(list)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'qinger_recipes_backup.json' });
  a.click();
}
async function importJSON(file) {
  const txt = await file.text();
  const list = JSON.parse(txt);
  if (!Array.isArray(list)) return alert('格式不对');
  for (const r of list) { if (!r.id) r.id = uuid(); await putRecord(r); }
  await load();
}

/* ================= Handlers ================= */
$('#toggle-view')?.addEventListener('click', () => {
  state.view = (state.view === 'list' ? 'month' : 'list');
  applyView();
  render();
});
$('#prev-month')?.addEventListener('click', () => { const d = state.month; d.setMonth(d.getMonth()-1); render(); });
$('#next-month')?.addEventListener('click', () => { const d = state.month; d.setMonth(d.getMonth()+1); render(); });
$('#search')?.addEventListener('input', (e)=>{ state.query = e.target.value; render(); });
$('#export-csv')?.addEventListener('click', exportCSV);
$('#backup-json')?.addEventListener('click', backupJSON);
$('#import-json')?.addEventListener('change', (e)=>{ const f = e.target.files[0]; if (f) importJSON(f); e.target.value=''; });
$('#clear-all')?.addEventListener('click', async ()=>{ if (!confirm('确定清空全部记录吗？（仅清本地缩略图与元数据，云端原图不动）')) return; await clearAll(); await load(); });
$('#lightbox')?.addEventListener('click', (e)=>{ if (e.target.id==='lightbox' || e.target.classList.contains('close')) closeLightbox(); });
$('#album')?.addEventListener('click',   (e)=>{ if (e.target.id==='album'    || e.target.classList.contains('close')) closeAlbum(); });

/* ===== “记录晚餐”防重复稳健绑定 ===== */
function bindRecordOnce() {
  const btn = document.getElementById('record-btn');
  if (!btn) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    try {
      const date = ($('#date')?.value) || fmt(new Date());
      const name = ($('#name')?.value || '').trim();
      const file = $('#file')?.files?.[0] || null;
      if (!name) { alert('请输入菜名'); return; }
      if (!file) { alert('请选择照片'); return; }

      btn.disabled = true; btn.textContent = '上传中…';
      const [thumb, url] = await Promise.all([compressToThumb(file, 420, 0.72), uploadOriginalSafe(file)]);
      const rec = { id: uuid(), date, name, photos: [{ url, thumb }], createdAt: Date.now() };
      await putRecord(rec);
      $('#name').value = ''; $('#file').value = '';
      await load();
      alert('已记录 ✅');
    } catch (err) {
      console.error('[record] failed:', err);
      alert('失败：' + (err?.message || err));
    } finally {
      btn.disabled = false; btn.textContent = '记录晚餐';
    }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindRecordOnce);
else bindRecordOnce();

/* ================= Init ================= */
$('#date').value = fmt(new Date());
load();

/* ========== 卡片标题与日期分行（纯 JS） ========== */
(function () {
  function formatHeader(hd) {
    if (!hd || hd.dataset.fixed === '1') return;
    const raw = hd.textContent.trim().replace(/\s+/g, ' ');
    const m = raw.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m) return;
    const date  = m[1];
    const title = raw.slice(0, m.index).trim();
    hd.innerHTML = `<span class="title">${title}</span><span class="date">${date}</span>`;
    hd.dataset.fixed = '1';
  }
  function sweep(){ document.querySelectorAll('.card-hd').forEach(formatHeader); }
  sweep();
  const main = document.querySelector('main');
  if (main) new MutationObserver(sweep).observe(main, { childList: true, subtree: true });
})();
