// ========= Seletores principais =========
const srcSel = document.querySelector("#src")
const tgtSel = document.querySelector("#tgt")
const swapBtn = document.querySelector("#swap")

const sourceEl = document.querySelector("#source")
const targetEl = document.querySelector("#target")

const btnTranslate = document.querySelector("#btnTranslate")
const btnPasteTranslate = document.querySelector("#btnPasteTranslate") // Colar & traduzir
const btnApprove = document.querySelector("#btnApprove") // Aprova par atual (sem log)
const altsEl = document.querySelector("#alts")

const glossForm = document.querySelector("#glossForm")
const glossList = document.querySelector("#glossList")

const preserveLinesChk = document.querySelector("#preserveLines")

// Logs (duas colunas)
const logPendingEl = document.querySelector("#logPending")
const logApprovedEl = document.querySelector("#logApproved")

// ========= Trocar idiomas =========
swapBtn?.addEventListener("click", () => {
  const s = srcSel.value
  srcSel.value = tgtSel.value
  tgtSel.value = s
})

// =============== UTILs de fetch on-demand (sem polling) ===============
async function fetchJSON(url, opts) {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function fetchPending() {
  try {
    const rows = await fetchJSON("/api/logs?status=pending&limit=200")
    renderPending(rows)
  } catch (e) {
    console.error("fetchPending:", e)
  }
}

async function fetchApprovedTM() {
  try {
    const rows = await fetchJSON("/api/tm?limit=200")
    renderApprovedTM(rows)
  } catch (e) {
    console.error("fetchApprovedTM:", e)
  }
}

// === Loading para tradução (bloqueia botões e dá feedback visual) ===
function setTranslating(on) {
  // guarda rótulos originais na 1ª vez
  if (!btnTranslate.dataset.label)
    btnTranslate.dataset.label = btnTranslate.textContent
  if (btnPasteTranslate && !btnPasteTranslate.dataset.label) {
    btnPasteTranslate.dataset.label = btnPasteTranslate.textContent
  }

  if (on) {
    btnTranslate.textContent = "Traduzindo..."
    btnTranslate.disabled = true
    if (btnPasteTranslate) {
      btnPasteTranslate.textContent = "Traduzindo..."
      btnPasteTranslate.disabled = true
    }
    targetEl.classList.add("busy")
  } else {
    btnTranslate.textContent = btnTranslate.dataset.label || "Traduzir"
    btnTranslate.disabled = false
    if (btnPasteTranslate) {
      btnPasteTranslate.textContent =
        btnPasteTranslate.dataset.label || "📥 Trad."
      btnPasteTranslate.disabled = false
    }
    targetEl.classList.remove("busy")
  }
}

// ========= Traduzir (gera ou não log) =========
btnTranslate?.addEventListener("click", () =>
  doTranslate({ log: true, refreshAfter: "pending" })
)

// Colar & Traduzir (gera log também)
btnPasteTranslate?.addEventListener("click", async () => {
  try {
    const clip = (await navigator.clipboard.readText()) || ""
    const text = clip.trim()
    if (!text) return alert("A área de transferência está vazia.")
    sourceEl.value = text // preenche o original
    targetEl.value = "" // limpa o destino
    doTranslate({ log: true, refreshAfter: "pending" })
  } catch (e) {
    alert(
      "Não consegui ler a área de transferência. Dê permissão ao navegador."
    )
  }
})

async function doTranslate({ log = true, refreshAfter = null } = {}) {
  const text = sourceEl.value.trim()
  if (!text) return

  const payload = {
    text,
    src: srcSel.value,
    tgt: tgtSel.value,
    preserveLines: !!(preserveLinesChk && preserveLinesChk.checked),
    log,
    origin: "ui",
  }

  setTranslating(true)
  try {
    const j = await fetchJSON("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (j.error) return alert(j.error)
    targetEl.value = j.best || ""
    renderAlts(j.candidates || [])

    // Atualiza coluna de pendentes só quando pediu log
    if (refreshAfter === "pending") await fetchPending()
  } finally {
    setTranslating(false)
  }
}

// ========= Alternativas =========
function renderAlts(items) {
  altsEl.innerHTML = ""
  items.forEach((it) => {
    const li = document.createElement("li")
    li.innerHTML = `
      <div>${escapeHTML(it.text)}</div>
      <small>${it.origin} ${
      it.score ? "• " + ((it.score * 100) | 0) + "%" : ""
    }</small>
    `
    li.addEventListener("click", () => {
      targetEl.value = it.text
    })
    altsEl.appendChild(li)
  })
}

// ========= Aprovar par atual (do editor principal) =========
// NÃO cria log; grava direto na TM e atualiza a coluna de aprovados on-demand.
btnApprove?.addEventListener("click", async () => {
  const src = sourceEl.value.trim()
  const tgt = targetEl.value.trim()
  if (!src || !tgt) return alert("Forneça texto original e tradução.")

  const j = await fetchJSON("/api/translate/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_text: src,
      target_text: tgt,
      removeFromLog: true,
    }),
  })

  if (j?.ok) {
    // remove o pendente retornado pelo backend (se houver)
    if (j.removedLogId) {
      const li = document.querySelector(
        `#logPending li[data-id="${j.removedLogId}"]`
      )
      if (li) li.remove()
    }
    await fetchApprovedTM() // atualiza a coluna de Aprovados (TM)
  }
})

// ========= Glossário =========
glossForm?.addEventListener("submit", async (e) => {
  e.preventDefault()
  const fd = new FormData(glossForm)
  const payload = Object.fromEntries(fd.entries())

  const j = await fetchJSON("/api/glossary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (j.error) return alert(j.error)

  glossForm.reset()
  await loadGloss() // busca apenas ao concluir ação
})

async function loadGloss() {
  const items = await fetchJSON("/api/glossary")
  glossList.innerHTML = items
    .map(
      (i) =>
        `• <b>${escapeHTML(i.term_source)}</b> → ${escapeHTML(i.term_target)}`
    )
    .map((line) => `<div>${line}</div>`)
    .join("")
}

// ========= Util: escapar HTML =========
function escapeHTML(s) {
  return (s || "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  )
}

/* =====================================================================================
   PENDENTES  (translation_logs.approved = 0) — editável, sem polling
   ===================================================================================== */

function renderPending(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))

  // remove cards que sumiram do servidor
  Array.from(logPendingEl.children).forEach((li) => {
    const id = Number(li.dataset.id)
    if (!byId.has(id)) li.remove()
  })

  rows.forEach((row) => {
    let li = logPendingEl.querySelector(`li[data-id="${row.id}"]`)
    if (!li) {
      // Cria novo card
      li = document.createElement("li")
      li.className = "log-item"
      li.dataset.id = row.id
      li.innerHTML = `
        <div class="meta">#${row.id} • ${row.origin || "api"} • ${
        row.created_at
      }</div>
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
      `
      const srcTA = li.querySelector(".src")
      const tgtTA = li.querySelector(".tgt")
      srcTA.value = row.source_text || ""
      tgtTA.value = row.target_text || ""

      // Salvar alterações no log (sem aprovar)
      li.querySelector(".save").addEventListener("click", async () => {
        try {
          await fetchJSON(`/api/logs/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_text: srcTA.value,
              target_text: tgtTA.value,
            }),
          })
          // Sem reload; fica local
        } catch {
          alert("Não foi possível salvar a alteração deste log.")
        }
      })

      // Aprovar (grava na TM) e remove da lista; depois atualiza TM sob demanda
      li.querySelector(".approve").addEventListener("click", async () => {
        try {
          await fetchJSON(`/api/logs/${row.id}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_text: srcTA.value,
              target_text: tgtTA.value,
            }),
          })
          li.remove()
          await fetchApprovedTM()
        } catch {
          alert("Falha ao aprovar.")
        }
      })

      // Reprovar — apenas remove localmente
      li.querySelector(".reject").addEventListener("click", async () => {
        try {
          await fetchJSON(`/api/logs/${row.id}/reject`, { method: "POST" })
          li.remove()
        } catch {
          alert("Falha ao reprovar.")
        }
      })

      // Copiar para o editor principal
      li.querySelector(".copy").addEventListener("click", () => {
        sourceEl.value = srcTA.value
        targetEl.value = tgtTA.value
      })

      logPendingEl.appendChild(li)
    } else {
      // Atualiza card existente (sem polling contínuo, só quando recarregamos pendentes)
      li.querySelector(".src").value = row.source_text || ""
      li.querySelector(".tgt").value = row.target_text || ""
      li.querySelector(".meta").textContent = `#${row.id} • ${
        row.origin || "api"
      } • ${row.created_at}`
    }
  })
}

/* ============================================================
   APROVADOS (TM) — lê/edita/exclui direto; sem polling
   ============================================================ */

function renderApprovedTM(rows = []) {
  const list = document.querySelector("#logApproved")
  if (!list) return

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m])
    )

  // Reconstrói a lista conforme a resposta (evento é raro, somente em ações)
  list.innerHTML = ""
  rows.forEach((row) => {
    const li = document.createElement("li")
    li.className = "log-item"
    li.dataset.id = row.id

    li.innerHTML = `
      <div class="meta">TM #${row.id} • uses:${
      row.uses ?? 0
    } • quality:${Number(row.quality ?? 0.9).toFixed(2)}</div>

      <label>Original (chave normalizada)</label>
      <textarea class="src" readonly>${esc(row.source_norm)}</textarea>

      <label>Tradução (editar e salvar)</label>
      <textarea class="tgt" spellcheck="false">${esc(
        row.target_text
      )}</textarea>

      <div class="actions">
        <button class="btn update">Salvar edição</button>
        <button class="btn del">Excluir da TM</button>
        <button class="btn copy">Copiar para editor</button>
      </div>
    `

    const tgtTA = li.querySelector(".tgt")
    const metaEl = li.querySelector(".meta")
    const btnSave = li.querySelector(".update")
    const btnDel = li.querySelector(".del")
    const btnCopy = li.querySelector(".copy")

    // SALVAR EDIÇÃO NA TM (não recarrega toda a lista; atualiza só este card)
    btnSave.addEventListener("click", async () => {
      const target_text = (tgtTA.value || "").trim()
      if (!target_text) return alert("Tradução vazia.")
      btnSave.disabled = true
      btnSave.textContent = "Salvando..."
      try {
        const up = await fetchJSON(`/api/tm/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_text }),
        })
        tgtTA.value = up.target_text ?? target_text
        metaEl.textContent = `TM #${up.id} • uses:${
          up.uses ?? row.uses ?? 0
        } • quality:${Number(up.quality ?? row.quality ?? 0.9).toFixed(2)}`
        btnSave.textContent = "Salvo!"
        setTimeout(() => {
          btnSave.textContent = "Salvar edição"
          btnSave.disabled = false
        }, 600)
      } catch (e) {
        btnSave.disabled = false
        btnSave.textContent = "Salvar edição"
        alert(e.message || "Erro ao salvar edição.")
      }
    })

    // EXCLUIR DA TM (remove apenas este item)
    btnDel.addEventListener("click", async () => {
      if (!confirm("Remover esta tradução da memória (TM)?")) return
      btnDel.disabled = true
      btnDel.textContent = "Excluindo..."
      try {
        await fetchJSON(`/api/tm/${row.id}`, { method: "DELETE" })
        li.remove()
      } catch (e) {
        btnDel.disabled = false
        btnDel.textContent = "Excluir da TM"
        alert(e.message || "Erro ao excluir.")
      }
    })

    // COPIAR PARA O EDITOR PRINCIPAL
    btnCopy.addEventListener("click", () => {
      sourceEl.value = li.querySelector(".src").value || row.source_norm || ""
      targetEl.value = tgtTA.value || row.target_text || ""
    })

    logApprovedEl.appendChild(li)
  })
}

/* =======================
   Toolbar de edição (Unicode)
   ======================= */

const locale = "pt-BR"
function tokenizeUnicodePieces(s) {
  const re = /(\p{L}[\p{L}\p{M}]*(?:[’'\-]\p{L}[\p{L}\p{M}]*)*)/gu
  const out = []
  let last = 0,
    m
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ type: "sep", text: s.slice(last, m.index) })
    out.push({ type: "word", text: m[0] })
    last = re.lastIndex
  }
  if (last < s.length) out.push({ type: "sep", text: s.slice(last) })
  return out
}
function isAllCaps(word) {
  const hasLetter = /\p{L}/u.test(word)
  return hasLetter && word === word.toLocaleUpperCase(locale)
}
function capFirstUnicode(word) {
  const arr = Array.from(word)
  if (arr.length === 0) return word
  const first = arr[0].toLocaleUpperCase(locale)
  const rest = arr.slice(1).join("").toLocaleLowerCase(locale)
  return first + rest
}
function getCapOptions() {
  const minLenInput = document.querySelector("#capMinLen")
  const ignoreInput = document.querySelector("#capIgnore")
  const defaultIgnore = "a,o,as,os,de,do,da,dos,das,e,ou,para,por,no,na,nos,nas"
  const minLen = Math.max(0, parseInt(minLenInput?.value || "2", 10) || 0)
  const ignoreSet = new Set(
    (ignoreInput?.value || defaultIgnore)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((w) => w.toLocaleLowerCase(locale))
  )
  return { minLen, ignoreSet }
}

// Botões da toolbar
const btnCopy = document.querySelector("#btnCopy")
const btnUpper = document.querySelector("#btnUpper")
const btnLower = document.querySelector("#btnLower")
const btnCapWords = document.querySelector("#btnCapWords")
const btnCapSentence = document.querySelector("#btnCapSentence")

btnCopy?.addEventListener("click", () => {
  navigator.clipboard.writeText(targetEl.value)
  alert("Texto copiado!")
})
btnUpper?.addEventListener("click", () => {
  targetEl.value = targetEl.value.toLocaleUpperCase(locale)
})
btnLower?.addEventListener("click", () => {
  targetEl.value = targetEl.value.toLocaleLowerCase(locale)
})
btnCapWords?.addEventListener("click", () => {
  const { minLen, ignoreSet } = getCapOptions()
  const tokens = tokenizeUnicodePieces(targetEl.value)
  let isFirstWord = true

  for (const t of tokens) {
    if (t.type === "sep") {
      if (/[.!?]\s*$/.test(t.text)) isFirstWord = true
      continue
    }
    if (isAllCaps(t.text)) {
      isFirstWord = false
      continue
    }

    const parts = t.text.split(/([’'-])/u)
    for (let i = 0; i < parts.length; i += 2) {
      const chunk = parts[i]
      if (!chunk) continue
      const baseLower = chunk.toLocaleLowerCase(locale)
      const isStop = ignoreSet.has(baseLower)
      const shouldCap = isFirstWord || (!isStop && baseLower.length >= minLen)
      parts[i] = shouldCap ? capFirstUnicode(baseLower) : baseLower
      isFirstWord = false
    }
    t.text = parts.join("")
  }
  targetEl.value = tokens.map((x) => x.text).join("")
})
btnCapSentence?.addEventListener("click", () => {
  const s = targetEl.value.toLocaleLowerCase(locale)
  const out = s.replace(/(^\s*\p{L}|[.!?]\s*\p{L})/gu, (m) => {
    const arr = Array.from(m)
    return arr[0].toLocaleUpperCase(locale) + arr.slice(1).join("")
  })
  targetEl.value = out
})

// ========= Inicialização (sem polling) =========
;(async function init() {
  await loadGloss() // uma vez ao carregar
  await fetchPending() // carrega pendentes só agora
  await fetchApprovedTM() // carrega aprovados só agora
})()
