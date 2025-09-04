// 情儿的食谱（云存版）前端脚本
// - 原图上传到 Vercel Blob（/api/upload）
// - 本地 IndexedDB 仅保存缩略图与元数据（几乎不占空间）
// - 支持不限条目、不限图片（云端容量为准）
// - 列表视图、月视图、搜索、CSV/JSON 导出/导入、图片查看

// ====== IndexedDB wrapper ======
const DB_NAME = 'qinger_recipes_db_v2';
const STORE = 'records';
let dbP;

function openDB() {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' }); // id = uuid
        os.createIndex('by_date', 'date');
        os.createIndex('by_name', 'name');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbP;
}

async function getAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function putRecord(rec) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function deleteRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ====== Utils ======
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (d) => new Date(d).toISOString().slice(0,10);
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : (Date.now()+'-'+Math.random().toString(16).slice(2));

function compressToThumb(file, maxW = 360, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = cv.toDataURL('image/jpeg', quality);
      resolve(dataUrl);
    };
    img.onerror = reject;
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function uploadOriginal(file) {
  // 通过 Vercel Serverless: /api/upload?filename=... (PUT 原始文件流)
  const endpoint = `/api/upload?filename=${encodeURIComponent(file.name)}`;
  const res = await fetch(endpoint, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
  if (!res.ok) {
    const t = await res.text().catch(()=>'');
    throw new Error('上传失败：' + res.status + ' ' + t);
  }
  const data = await res.json();
  return data.url; // cloud url
}

// ====== State & UI ======
const state = {
  list: [],
  view: 'list', // 'list' | 'month'
  month: new Date(),
  query: ''
};

async function load() {
  state.list = await getAll();
  render();
}

function render() {
  // search filter
  const q = state.query.trim();
  let filtered = state.list;
  if (q) {
    filtered = state.list.filter(r => r.name.includes(q) || r.date.includes(q));
  }
  if (state.view === 'list') renderList(filtered);
  else renderMonth(filtered);
}

function renderList(list) {
  const wrap = $('#list-wrap');
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">还没有记录，先来第一餐吧 🍚</div>`;
    return;
  }
  // sort by date desc then createdAt desc
  list.sort((a,b)=> (b.date||'').localeCompare(a.date||'') || (b.createdAt||0)-(a.createdAt||0));

  for (const rec of list) {
    const thumbs = rec.photos.map(p=>`
      <img class="thumb" src="${p.thumb}" data-url="${p.url}" title="点我查看大图">
    `).join('');
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
        <button class="btn danger" data-act="del" data-id="${rec.id}">删除</button>
      </div>
    `;
    wrap.appendChild(el);
  }

  wrap.querySelectorAll('.thumb').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.dataset.url));
  });
  wrap.querySelectorAll('.btn[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if (!confirm('确定删除这道菜吗？')) return;
      await deleteRecord(btn.dataset.id);
      await load();
    });
  });
  wrap.querySelectorAll('.btn[data-act="view"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const rec = state.list.find(r=>r.id===btn.dataset.id);
      if (!rec) return;
      openAlbum(rec);
    });
  });
}

function renderMonth(list) {
  const grid = $('#month-grid');
  const title = $('#month-title');
  const base = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
  const year = base.getFullYear();
  const month = base.getMonth();
  title.textContent = `${year}年 ${String(month+1).padStart(2,'0')}月`;

  // build map date -> records
  const map = {};
  for (const r of list) {
    (map[r.date] ||= []).push(r);
  }

  // calendar calculation
  const firstDay = new Date(year, month, 1).getDay() || 7; // Monday start style optional
  const days = new Date(year, month+1, 0).getDate();
  grid.innerHTML = '';
  // create cells 6x7
  const total = Math.ceil((firstDay-1 + days) / 7) * 7;
  for (let i=0;i<total;i++){
    const dayNum = i - (firstDay-1) + 1;
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (dayNum>=1 && dayNum<=days) {
      const date = `${year}-${String(month+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
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
        <div class="mini-wrap">${thumbs.join('')}</div>
      `;
    } else {
      cell.classList.add('blank');
    }
    grid.appendChild(cell);
  }
  grid.querySelectorAll('.mini').forEach(img=>{
    img.addEventListener('click', ()=> openLightbox(img.dataset.url));
  });
}

function openLightbox(url){
  const overlay = $('#lightbox');
  overlay.querySelector('img').src = url;
  overlay.classList.add('show');
}
function closeLightbox(){
  const overlay = $('#lightbox');
  overlay.classList.remove('show');
  overlay.querySelector('img').src = '';
}

function openAlbum(rec){
  const overlay = $('#album');
  const box = overlay.querySelector('.album-body');
  box.innerHTML = rec.photos.map(p=>`<img src="${p.url}">`).join('');
  overlay.classList.add('show');
}
function closeAlbum(){ $('#album').classList.remove('show'); }

// ====== Export / Import ======
async function exportCSV() {
  const list = await getAll();
  const rows = [['date','name','photo_urls']];
  for (const r of list) {
    rows.push([r.date, r.name, r.photos.map(p=>p.url).join('|')]);
  }
  const csv = rows.map(row => row.map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'qinger_recipes.csv';
  a.click();
}

async function backupJSON() {
  const list = await getAll();
  const blob = new Blob([JSON.stringify(list)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'qinger_recipes_backup.json';
  a.click();
}

async function importJSON(file) {
  const txt = await file.text();
  const list = JSON.parse(txt);
  if (!Array.isArray(list)) return alert('格式不对');
  for (const r of list) {
    if (!r.id) r.id = uuid();
    await putRecord(r);
  }
  await load();
}

// ====== Handlers ======
$('#toggle-view').addEventListener('click', () => {
  state.view = (state.view==='list'?'month':'list');
  render();
});

$('#prev-month').addEventListener('click', () => {
  const d = state.month; d.setMonth(d.getMonth()-1); render();
});
$('#next-month').addEventListener('click', () => {
  const d = state.month; d.setMonth(d.getMonth()+1); render();
});

$('#search').addEventListener('input', (e)=>{
  state.query = e.target.value;
  render();
});

$('#export-csv').addEventListener('click', exportCSV);
$('#backup-json').addEventListener('click', backupJSON);
$('#import-json').addEventListener('change', (e)=>{
  const f = e.target.files[0]; if (f) importJSON(f);
  e.target.value = '';
});

$('#record-btn').addEventListener('click', async ()=>{
  const date = $('#date').value || fmt(new Date());
  const name = ($('#name').value || '').trim();
  const file = $('#file').files[0];
  if (!name) return alert('请输入菜名');
  if (!file) return alert('请选择照片');

  try {
    $('#record-btn').disabled = true;
    $('#record-btn').textContent = '上传中…';
    const [thumb, url] = await Promise.all([
      compressToThumb(file, 420, 0.72),
      uploadOriginal(file)
    ]);
    const rec = { id: uuid(), date, name, photos: [{ url, thumb }], createdAt: Date.now() };
    await putRecord(rec);
    $('#name').value = '';
    $('#file').value = '';
    await load();
    alert('已记录 ✅');
  } catch (err) {
    console.error(err);
    alert('失败：' + err.message);
  } finally {
    $('#record-btn').disabled = false;
    $('#record-btn').textContent = '记录晚餐';
  }
});

$('#clear-all').addEventListener('click', async ()=>{
  if (!confirm('确定清空全部记录吗？（仅清本地缩略图与元数据，云端原图不动）')) return;
  await clearAll();
  await load();
});

$('#lightbox').addEventListener('click', (e)=>{
  if (e.target.id==='lightbox' || e.target.classList.contains('close')) closeLightbox();
});
$('#album').addEventListener('click', (e)=>{
  if (e.target.id==='album' || e.target.classList.contains('close')) closeAlbum();
});

// init
$('#date').value = fmt(new Date());
load();
<script>
(function () {
  function formatHeader(hd) {
    if (!hd || hd.dataset.fixed === "1") return;

    // 取出原始文本，例如：“萝卜干炒毛豆 2025-09-03 · 1张图”
    const raw = hd.textContent.trim().replace(/\s+/g, ' ');

    // 匹配日期
    const m = raw.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m) return;

    const date = m[1];
    const title = raw.slice(0, m.index).trim();

    // 重写为：标题一行 + 日期一行
    hd.innerHTML = `
      <span class="title">${title}</span>
      <span class="date">${date}</span>
    `;
    hd.dataset.fixed = "1";
  }

  function sweep() {
    document.querySelectorAll('.card-hd').forEach(formatHeader);
  }

  // 初始整理一次
  sweep();

  // 监听 main 内部变化（列表刷新、上传后重渲染等）
  const main = document.querySelector('main');
  if (main) {
    const ob = new MutationObserver(() => sweep());
    ob.observe(main, { childList: true, subtree: true });
  }
})();
</script>
