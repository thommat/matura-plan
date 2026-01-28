const STORAGE_PROGRESS = 'matura-plan-v2-progress';
const STORAGE_BUCKETS  = 'matura-plan-v2-buckets';

function loadJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function saveJSON(key, obj){
  localStorage.setItem(key, JSON.stringify(obj));
}

function pct(done,total){ return total ? Math.round((done/total)*100) : 0; }

function subjectLabel(sub){
  return ({polski:'Polski', angielski:'Angielski', biologia:'Biologia', chemia:'Chemia'})[sub] || sub;
}

function fmtBucketLabel(bucketKey, data){
  const wk = data.weeks.find(w=>w.key===bucketKey);
  if(wk) return wk.label;
  const mb = data.monthBuckets.find(b=>b.key===bucketKey);
  if(mb) return mb.label;
  if(bucketKey.endsWith(':unassigned') || bucketKey==='unassigned') return 'Nieprzypisane';
  return bucketKey;
}

function matchesFilters(task, filters){
  if(filters.subject !== 'all' && task.subject !== filters.subject) return false;
  if(filters.month !== 'all'){
    const m = Number(filters.month);
    if(task.month !== m) return false;
  }
  if(filters.tag !== 'all'){
    if(!task.tags || !task.tags.includes(filters.tag)) return false;
  }
  if(filters.q){
    const q = filters.q.toLowerCase();
    const blob = [task.section, ...(task.items||[]), task.subject, ...(task.tags||[])].join(' ').toLowerCase();
    if(!blob.includes(q)) return false;
  }
  return true;
}

function download(filename, text) {
  const blob = new Blob([text], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

function setActiveTab(tab){
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tab}`);
  });
}

function ensureDefaultBuckets(data, buckets){
  // initialize any missing mapping with defaultBucket
  let changed=false;
  for(const t of data.tasks){
    if(!buckets[t.id]){
      buckets[t.id] = t.defaultBucket || 'unassigned';
      changed=true;
    }
  }
  if(changed) saveJSON(STORAGE_BUCKETS, buckets);
}

function itemKey(taskId, itemIndex){
  return `${taskId}::${itemIndex}`;
}

function renderChecklistCard(task, progress){
  const card = document.createElement('div');
  card.className = 'card';

  const h = document.createElement('h3');
  h.textContent = `${subjectLabel(task.subject)} · ${task.section}`;
  card.appendChild(h);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const pills = [];
  if(task.month){ pills.push(`Miesiąc: ${task.month}`); }
  if(task.tags && task.tags.length){ pills.push(...task.tags); }
  for(const p of pills){
    const pill=document.createElement('div');
    pill.className='pill';
    pill.textContent=p;
    meta.appendChild(pill);
  }
  card.appendChild(meta);

  const bar = document.createElement('div');
  bar.className = 'progress';
  const barInner = document.createElement('div');
  bar.appendChild(barInner);
  card.appendChild(bar);

  const list = document.createElement('div');
  list.className = 'list';

  function update(){
    const total = (task.items||[]).length;
    let done=0;
    for(let i=0;i<total;i++) if(progress[itemKey(task.id,i)]) done++;
    barInner.style.width = `${pct(done,total)}%`;
  }

  (task.items||[]).forEach((text, i)=>{
    const row=document.createElement('label');
    row.className='item';

    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked=!!progress[itemKey(task.id,i)];

    const span=document.createElement('div');
    span.className='label' + (cb.checked?' done':'');
    span.textContent=text;

    cb.addEventListener('change', ()=>{
      const k=itemKey(task.id,i);
      if(cb.checked) progress[k]=true;
      else delete progress[k];
      saveJSON(STORAGE_PROGRESS, progress);
      span.className='label' + (cb.checked?' done':'');
      update();
    });

    row.appendChild(cb);
    row.appendChild(span);
    list.appendChild(row);
  });

  card.appendChild(list);
  update();

  return card;
}

function renderBoard(data, filters, progress, buckets){
  const board=document.getElementById('board');
  board.innerHTML='';

  const columns = [
    {key: 'unassigned', label:'Nieprzypisane'},
    // month buckets first
    ...data.monthBuckets,
    // then dated weeks
    ...data.weeks,
  ].map(c=>({key:c.key||c, label:c.label||fmtBucketLabel(c.key||c, data)}));

  // make map
  const byCol = new Map(columns.map(c=>[c.key, []]));

  for(const t of data.tasks){
    if(!matchesFilters(t, filters)) continue;
    const colKey = buckets[t.id] || t.defaultBucket || 'unassigned';
    if(!byCol.has(colKey)) byCol.set(colKey, []);
    byCol.get(colKey).push(t);
  }

  // render columns
  columns.forEach(col => {
    const wrap=document.createElement('div');
    wrap.className='column';
    wrap.dataset.bucket=col.key;

    const head=document.createElement('div');
    head.className='column__head';
    const left=document.createElement('div');
    const strong=document.createElement('strong');
    strong.textContent=col.label;
    const small=document.createElement('div');
    small.className='muted';
    const count=(byCol.get(col.key)||[]).length;
    small.textContent=`${count} bloków`;
    left.appendChild(strong);
    left.appendChild(small);
    head.appendChild(left);
    wrap.appendChild(head);

    const body=document.createElement('div');
    body.className='column__body';
    body.addEventListener('dragover', (e)=>{ e.preventDefault(); });
    body.addEventListener('drop', (e)=>{
      e.preventDefault();
      const taskId = e.dataTransfer.getData('text/taskId');
      if(!taskId) return;
      buckets[taskId]=col.key;
      saveJSON(STORAGE_BUCKETS, buckets);
      renderAll(data);
    });

    (byCol.get(col.key)||[]).forEach(task => {
      const el=document.createElement('div');
      el.className='task';
      el.draggable=true;
      el.addEventListener('dragstart', (e)=>{
        el.classList.add('dragging');
        e.dataTransfer.setData('text/taskId', task.id);
      });
      el.addEventListener('dragend', ()=> el.classList.remove('dragging'));

      const tTitle=document.createElement('div');
      tTitle.className='task__title';
      const h4=document.createElement('h4');
      h4.textContent = task.section;
      const pill=document.createElement('div');
      pill.className='pill';
      pill.textContent = subjectLabel(task.subject);
      tTitle.appendChild(h4);
      tTitle.appendChild(pill);

      const sub=document.createElement('div');
      sub.className='task__sub';
      const tags = (task.tags||[]).join(', ');
      sub.textContent = tags ? tags : '';

      const items=document.createElement('div');
      items.className='task__items';

      const max=5;
      const arr=task.items||[];
      arr.slice(0,max).forEach((txt, i)=>{
        const row=document.createElement('label');
        row.className='mini';
        const cb=document.createElement('input');
        cb.type='checkbox';
        cb.checked=!!progress[itemKey(task.id,i)];
        const span=document.createElement('span');
        span.textContent=txt;
        cb.addEventListener('change', ()=>{
          const k=itemKey(task.id,i);
          if(cb.checked) progress[k]=true; else delete progress[k];
          saveJSON(STORAGE_PROGRESS, progress);
          renderAll(data);
        });
        row.appendChild(cb);
        row.appendChild(span);
        items.appendChild(row);
      });

      if(arr.length>max){
        const more=document.createElement('div');
        more.className='muted';
        more.textContent=`+ ${arr.length-max} kolejnych… (pełna lista w widoku „Lista”)`;
        items.appendChild(more);
      }

      el.appendChild(tTitle);
      if(sub.textContent) el.appendChild(sub);
      el.appendChild(items);
      body.appendChild(el);
    });

    wrap.appendChild(body);
    board.appendChild(wrap);
  });
}

function computeStats(data, filters, progress){
  // total items / done items by subject
  const stats={};
  for(const t of data.tasks){
    if(!matchesFilters(t, filters)) continue;
    const sub=t.subject;
    stats[sub] ||= {done:0,total:0};
    const items=t.items||[];
    stats[sub].total += items.length;
    for(let i=0;i<items.length;i++) if(progress[itemKey(t.id,i)]) stats[sub].done++;
  }
  return stats;
}

function renderStats(data, filters, progress){
  const wrap=document.getElementById('stats');
  const cards=document.getElementById('statsTasks');
  wrap.innerHTML='';
  cards.innerHTML='';

  const stats=computeStats(data, filters, progress);
  const subjects=['polski','angielski','biologia','chemia'];
  subjects.forEach(s=>{
    const v=stats[s]||{done:0,total:0};
    const el=document.createElement('div');
    el.className='stat';
    const h=document.createElement('h3');
    h.textContent=subjectLabel(s);
    const big=document.createElement('div');
    big.className='big';
    big.textContent=`${pct(v.done,v.total)}%`;
    const small=document.createElement('div');
    small.className='muted';
    small.textContent=`${v.done}/${v.total} podpunktów`;
    el.appendChild(h);
    el.appendChild(big);
    el.appendChild(small);
    wrap.appendChild(el);
  });

  // Also show filtered tasks list to drill down
  const tasks = data.tasks.filter(t=>matchesFilters(t, filters));
  tasks.slice(0,20).forEach(t=> cards.appendChild(renderChecklistCard(t, progress)));
}

let DATA=null;

function currentFilters(){
  return {
    subject: document.getElementById('subjectFilter').value,
    month: document.getElementById('monthFilter').value,
    tag: document.getElementById('tagFilter').value,
    q: document.getElementById('search').value.trim()
  };
}

function renderAll(data){
  const filters=currentFilters();
  const progress=loadJSON(STORAGE_PROGRESS, {});
  const buckets=loadJSON(STORAGE_BUCKETS, {});
  ensureDefaultBuckets(data, buckets);

  // board
  renderBoard(data, filters, progress, buckets);

  // list
  const list=document.getElementById('list');
  list.innerHTML='';
  data.tasks.filter(t=>matchesFilters(t, filters)).forEach(t=>{
    list.appendChild(renderChecklistCard(t, progress));
  });

  // dashboard
  renderStats(data, filters, progress);
}

async function main(){
  const res = await fetch('./data.json');
  const data = await res.json();
  DATA=data;

  document.getElementById('generated').textContent = `Źródło: PDF → wyciągnięte automatycznie (${new Date(data.generatedAt).toLocaleString('pl-PL')})`;

  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', ()=> setActiveTab(btn.dataset.tab));
  });

  // Filters
  ['subjectFilter','monthFilter','tagFilter','search'].forEach(id=>{
    document.getElementById(id).addEventListener('input', ()=>renderAll(DATA));
  });
  document.getElementById('clearFilters').addEventListener('click', ()=>{
    document.getElementById('subjectFilter').value='all';
    document.getElementById('monthFilter').value='all';
    document.getElementById('tagFilter').value='all';
    document.getElementById('search').value='';
    renderAll(DATA);
  });

  // Settings
  document.getElementById('resetAll').addEventListener('click', ()=>{
    if(confirm('Wyczyścić postęp i przypisania na tym urządzeniu?')){
      localStorage.removeItem(STORAGE_PROGRESS);
      localStorage.removeItem(STORAGE_BUCKETS);
      location.reload();
    }
  });

  const exportPreview = document.getElementById('exportPreview');
  document.getElementById('exportBtn').addEventListener('click', ()=>{
    const payload={
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: loadJSON(STORAGE_PROGRESS, {}),
      buckets: loadJSON(STORAGE_BUCKETS, {})
    };
    const json=JSON.stringify(payload,null,2);
    exportPreview.hidden=false;
    exportPreview.textContent=json;
    download('matura-plan-export.json', json);
  });

  document.getElementById('importFile').addEventListener('change', async (e)=>{
    const f=e.target.files && e.target.files[0];
    if(!f) return;
    const txt=await f.text();
    let payload;
    try { payload=JSON.parse(txt); } catch { alert('Nieprawidłowy JSON'); return; }
    if(payload.progress) saveJSON(STORAGE_PROGRESS, payload.progress);
    if(payload.buckets) saveJSON(STORAGE_BUCKETS, payload.buckets);
    alert('Zaimportowano. Odświeżam…');
    location.reload();
  });

  // Turbo topics
  const ul=document.getElementById('turboTopics');
  ul.innerHTML='';
  (data.chemistry.turboTopics||[]).slice(0,60).forEach(t=>{
    const li=document.createElement('li');
    li.textContent=t;
    ul.appendChild(li);
  });

  renderAll(DATA);
}

main().catch(err => {
  console.error(err);
  document.body.innerHTML = '<pre style="padding:16px">Błąd ładowania danych: ' + String(err) + '</pre>';
});
