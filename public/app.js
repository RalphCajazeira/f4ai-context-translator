// ========= Seletores principais =========
const srcSel  = document.querySelector('#src');
const tgtSel  = document.querySelector('#tgt');
const swapBtn = document.querySelector('#swap');

const sourceEl = document.querySelector('#source');
const targetEl = document.querySelector('#target');

const btnTranslate = document.querySelector('#btnTranslate');
const btnApprove   = document.querySelector('#btnApprove'); // aprova o que está nos textareas principais
const altsEl       = document.querySelector('#alts');

const glossForm = document.querySelector('#glossForm');
const glossList = document.querySelector('#glossList');

const preserveLinesChk = document.querySelector('#preserveLines');

// Logs (duas colunas)
const logPendingEl  = document.querySelector('#logPending');
const logApprovedEl = document.querySelector('#logApproved');

// ========= Trocar idiomas =========
swapBtn?.addEventListener('click', () => {
  const s = srcSel.value;
  srcSel.value = tgtSel.value;
  tgtSel.value = s;
});

// ========= Traduzir (registra no log do backend) =========
btnTranslate?.addEventListener('click', doTranslate);

async function doTranslate () {
  const text = sourceEl.value.trim();
  if (!text) return;

  const payload = {
    text,
    src: srcSel.value,
    tgt: tgtSel.value,
    preserveLines: !!(preserveLinesChk && preserveLinesChk.checked),
    log: true,
    origin: 'ui'
  };

  const r = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const j = await r.json();
  if (j.error) return alert(j.error);

  targetEl.value = j.best || '';
  renderAlts(j.candidates || []);
}

// ========= Alternativas =========
function renderAlts (items) {
  altsEl.innerHTML = '';
  items.forEach(it => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>${escapeHTML(it.text)}</div>
      <small>${it.origin} ${it.score ? ('• ' + (it.score * 100 | 0) + '%') : ''}</small>
    `;
    li.addEventListener('click', () => { targetEl.value = it.text; });
    altsEl.appendChild(li);
  });
}

// ========= Aprovar par atual (do editor principal) =========
btnApprove?.addEventListener('click', async () => {
  const src = sourceEl.value.trim();
  const tgt = targetEl.value.trim();
  if (!src || !tgt) return alert('Forneça texto original e tradução.');

  const r = await fetch('/api/translate/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_text: src, target_text: tgt })
  });
  const j = await r.json();
  if (j?.ok) {
    alert('Par salvo na memória!');
    await pollApprovedTM(); // atualiza coluna da memória
  }
});

// ========= Glossário =========
glossForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(glossForm);
  const payload = Object.fromEntries(fd.entries());

  const r = await fetch('/api/glossary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (j.error) return alert(j.error);

  glossForm.reset();
  loadGloss();
});

async function loadGloss () {
  const items = await fetch('/api/glossary').then(r => r.json());
  glossList.innerHTML = items
    .map(i => `• <b>${escapeHTML(i.term_source)}</b> → ${escapeHTML(i.term_target)}`)
    .map(line => `<div>${line}</div>`)
    .join('');
}

// ========= Util: escapar HTML =========
function escapeHTML (s) {
  return (s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* =====================================================================================
   PENDENTES  (translation_logs.approved = 0)  — editável, com "lock" local para polling
   ===================================================================================== */

// Controle de edição: impede o polling de sobrescrever enquanto o usuário digita
const editingLocks = new Set(); // guarda IDs de logs em edição

function renderPending (rows) {
  // índice por id
  const byId = new Map(rows.map(r => [r.id, r]));

  // remove cards que sumiram do servidor (e não estão lockados)
  Array.from(logPendingEl.children).forEach(li => {
    const id = Number(li.dataset.id);
    if (!byId.has(id) && !editingLocks.has(id)) {
      li.remove();
    }
  });

  rows.forEach(row => {
    let li = logPendingEl.querySelector(`li[data-id="${row.id}"]`);

    if (!li) {
      // Cria novo card
      li = document.createElement('li');
      li.className = 'log-item';
      li.dataset.id = row.id;
      li.innerHTML = `
        <div class="meta">#${row.id} • ${row.origin || 'api'} • ${row.created_at}</div>
        <div><b>Original</b></div>
        <textarea class="src" spellcheck="false"></textarea>
        <div><b>Tradução (editável)</b></div>
        <textarea class="tgt" spellcheck="false"></textarea>
        <div class="actions">
          <button class="btn save">Salvar alteração</button>
          <button class="btn approve">Aprovar</button>
          <button class="btn reject">Reprovar</button>
          <button class="btn copy">Copiar para editor</button>
        </div>
      `;

      const srcTA = li.querySelector('.src');
      const tgtTA = li.querySelector('.tgt');

      // Preenche ao criar
      srcTA.value = row.source_text || '';
      tgtTA.value = row.target_text || '';

      // Locks de edição
      const lockOn  = () => editingLocks.add(row.id);
      const lockOff = () => editingLocks.delete(row.id);
      srcTA.addEventListener('input', lockOn);
      tgtTA.addEventListener('input', lockOn);
      srcTA.addEventListener('blur', lockOff);
      tgtTA.addEventListener('blur', lockOff);

      // Salvar alterações no log (sem aprovar)
      li.querySelector('.save').addEventListener('click', async () => {
        const r = await fetch(`/api/logs/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_text: srcTA.value, target_text: tgtTA.value })
        });
        if (!r.ok) alert('Não foi possível salvar a alteração deste log.');
        editingLocks.delete(row.id);
      });

      // Aprovar usando o TEXTO EDITADO (grava na TM)
      li.querySelector('.approve').addEventListener('click', async () => {
        const r = await fetch(`/api/logs/${row.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_text: srcTA.value, target_text: tgtTA.value })
        });
        if (r.ok) {
          li.remove();
          editingLocks.delete(row.id);
          await pollApprovedTM(); // atualiza a coluna da memória
        } else {
          alert('Falha ao aprovar.');
        }
      });

      // Reprovar
      li.querySelector('.reject').addEventListener('click', async () => {
        const r = await fetch(`/api/logs/${row.id}/reject`, { method: 'POST' });
        if (r.ok) {
          li.remove();
          editingLocks.delete(row.id);
        } else {
          alert('Falha ao reprovar.');
        }
      });

      // Copiar para o editor principal
      li.querySelector('.copy').addEventListener('click', () => {
        sourceEl.value = srcTA.value;
        targetEl.value = tgtTA.value;
      });

      logPendingEl.appendChild(li);
    } else {
      // Atualização de card existente — só se NÃO estiver em edição
      if (!editingLocks.has(row.id)) {
        li.querySelector('.src').value  = row.source_text || '';
        li.querySelector('.tgt').value  = row.target_text || '';
        li.querySelector('.meta').textContent = `#${row.id} • ${row.origin || 'api'} • ${row.created_at}`;
      }
    }
  });
}

/* ============================================================
   APROVADOS (TM) — agora lê /edita/exclui direto em /api/tm
   ============================================================ */

function renderApprovedTM (rows) {
  logApprovedEl.innerHTML = '';
  rows.forEach(row => {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.innerHTML = `
      <div class="meta">TM #${row.id} • uses:${row.uses ?? 1} • quality:${row.quality?.toFixed?.(2) ?? '0.90'}</div>
      <div><b>Original (editável)</b></div>
      <textarea class="src" spellcheck="false">${row.source_norm || ''}</textarea>
      <div><b>Tradução aprovada (editável)</b></div>
      <textarea class="tgt" spellcheck="false">${row.target_text || ''}</textarea>
      <div class="actions">
        <button class="btn update">Salvar edição</button>
        <button class="btn delete">Excluir da TM</button>
        <button class="btn copy">Copiar para editor</button>
      </div>
    `;

    const srcTA = li.querySelector('.src');
    const tgtTA = li.querySelector('.tgt');

    // Salvar edição na TM
    li.querySelector('.update').addEventListener('click', async () => {
      const r = await fetch(`/api/tm/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_text: srcTA.value, target_text: tgtTA.value })
      });
      if (!r.ok) alert('Falha ao salvar edição na TM');
      else await pollApprovedTM();
    });

    // Excluir da TM
    li.querySelector('.delete').addEventListener('click', async () => {
      const r = await fetch(`/api/tm/${row.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(()=>({}));
        alert('Falha ao excluir da TM: ' + (j?.error || r.status));
      } else {
        await pollApprovedTM();
      }
    });

    // Copiar para o editor principal
    li.querySelector('.copy').addEventListener('click', () => {
      sourceEl.value = srcTA.value;
      targetEl.value = tgtTA.value;
    });

    logApprovedEl.appendChild(li);
  });
}

// ========= Polling dos pendentes (translation_logs) =========
async function pollPending () {
  try {
    const rows = await fetch('/api/logs?status=pending&limit=200&_=' + Date.now()).then(r => r.json());
    renderPending(rows);
  } catch {}
}

// ========= Polling da TM (aprovados de verdade) =========
async function pollApprovedTM () {
  try {
    const rows = await fetch('/api/tm?limit=200&_=' + Date.now()).then(r => r.json());
    renderApprovedTM(rows);
  } catch {}
}

setInterval(pollPending,   2000);
setInterval(pollApprovedTM, 5000);

// ========= Toolbar (copiar/maiúsc/minúsc/capitalizações) =========
const btnCopy        = document.querySelector('#btnCopy');
const btnUpper       = document.querySelector('#btnUpper');
const btnLower       = document.querySelector('#btnLower');
const btnCapWords    = document.querySelector('#btnCapWords');
const btnCapSentence = document.querySelector('#btnCapSentence');

if (btnCopy)        btnCopy.addEventListener('click', () => { navigator.clipboard.writeText(targetEl.value); alert('Texto copiado!') });
if (btnUpper)       btnUpper.addEventListener('click', () => { targetEl.value = targetEl.value.toUpperCase() });
if (btnLower)       btnLower.addEventListener('click', () => { targetEl.value = targetEl.value.toLowerCase() });
if (btnCapWords)    btnCapWords.addEventListener('click', () => {
  targetEl.value = targetEl.value.toLowerCase().replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1))
});
if (btnCapSentence) btnCapSentence.addEventListener('click', () => {
  targetEl.value = targetEl.value.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, c => c.toUpperCase())
});

// ========= Inicialização =========
loadGloss();
pollPending();
pollApprovedTM();
