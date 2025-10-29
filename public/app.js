// ========= Seletores principais =========
const srcSel = document.querySelector("#src")
const tgtSel = document.querySelector("#tgt")
const swapBtn = document.querySelector("#swap")

const sourceEl = document.querySelector("#source")
const targetEl = document.querySelector("#target")

const btnTranslate = document.querySelector("#btnTranslate")
const btnPasteTranslate = document.querySelector("#btnPasteTranslate") // NOVO
const btnApprove = document.querySelector("#btnApprove") // aprova o que está nos textareas principais
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

// ========= Traduzir (com opção de log) =========
btnTranslate?.addEventListener("click", () => doTranslate({ log: true }))

// NOVO: colar da área de transferência e traduzir (também gera log)
btnPasteTranslate?.addEventListener("click", async () => {
  try {
    const clip = (await navigator.clipboard.readText()) || ""
    const text = clip.trim()
    if (!text) return alert("A área de transferência está vazia.")
    sourceEl.value = text // preenche o original
    targetEl.value = "" // limpa o destino
    doTranslate({ log: true })
  } catch (e) {
    alert(
      "Não consegui ler a área de transferência. Dê permissão ao navegador."
    )
  }
})

async function doTranslate({ log = true } = {}) {
  const text = sourceEl.value.trim()
  if (!text) return

  const payload = {
    text,
    src: srcSel.value,
    tgt: tgtSel.value,
    preserveLines: !!(preserveLinesChk && preserveLinesChk.checked),
    log, // <- só loga quando solicitado
    origin: "ui",
  }

  const r = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  const j = await r.json()
  if (j.error) return alert(j.error)

  targetEl.value = j.best || ""
  renderAlts(j.candidates || [])
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
// Observação: isso NÃO cria log; grava direto na TM.
btnApprove?.addEventListener("click", async () => {
  const src = sourceEl.value.trim()
  const tgt = targetEl.value.trim()
  if (!src || !tgt) return alert("Forneça texto original e tradução.")

  const r = await fetch("/api/translate/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_text: src, target_text: tgt }),
  })
  const j = await r.json()
  if (j?.ok) {
    alert("Par salvo na memória!")
    await pollApprovedTM() // atualiza coluna da memória
  }
})

// ========= Glossário =========
glossForm?.addEventListener("submit", async (e) => {
  e.preventDefault()
  const fd = new FormData(glossForm)
  const payload = Object.fromEntries(fd.entries())

  const r = await fetch("/api/glossary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const j = await r.json()
  if (j.error) return alert(j.error)

  glossForm.reset()
  loadGloss()
})

async function loadGloss() {
  const items = await fetch("/api/glossary").then((r) => r.json())
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
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  )
}

/* =====================================================================================
   PENDENTES  (translation_logs.approved = 0)  — editável, com "lock" local para polling
   ===================================================================================== */

// Controle de edição: impede o polling de sobrescrever enquanto o usuário digita
const editingLocks = new Set() // guarda IDs de logs em edição

function renderPending(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))

  // remove cards que sumiram do servidor (e não estão lockados)
  Array.from(logPendingEl.children).forEach((li) => {
    const id = Number(li.dataset.id)
    if (!byId.has(id) && !editingLocks.has(id)) {
      li.remove()
    }
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

      // Preenche ao criar
      srcTA.value = row.source_text || ""
      tgtTA.value = row.target_text || ""

      // Locks de edição
      const lockOn = () => editingLocks.add(row.id)
      const lockOff = () => editingLocks.delete(row.id)
      srcTA.addEventListener("input", lockOn)
      tgtTA.addEventListener("input", lockOn)
      srcTA.addEventListener("blur", lockOff)
      tgtTA.addEventListener("blur", lockOff)

      // Salvar alterações no log (sem aprovar)
      li.querySelector(".save").addEventListener("click", async () => {
        const r = await fetch(`/api/logs/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_text: srcTA.value,
            target_text: tgtTA.value,
          }),
        })
        if (!r.ok) alert("Não foi possível salvar a alteração deste log.")
        editingLocks.delete(row.id)
      })

      // Aprovar usando o TEXTO EDITADO (grava na TM)
      li.querySelector(".approve").addEventListener("click", async () => {
        const r = await fetch(`/api/logs/${row.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_text: srcTA.value,
            target_text: tgtTA.value,
          }),
        })
        if (r.ok) {
          li.remove()
          editingLocks.delete(row.id)
          await pollApprovedTM() // atualiza a coluna da memória
        } else {
          alert("Falha ao aprovar.")
        }
      })

      // Reprovar
      li.querySelector(".reject").addEventListener("click", async () => {
        const r = await fetch(`/api/logs/${row.id}/reject`, { method: "POST" })
        if (r.ok) {
          li.remove()
          editingLocks.delete(row.id)
        } else {
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
      // Atualização de card existente — só se NÃO estiver em edição
      if (!editingLocks.has(row.id)) {
        li.querySelector(".src").value = row.source_text || ""
        li.querySelector(".tgt").value = row.target_text || ""
        li.querySelector(".meta").textContent = `#${row.id} • ${
          row.origin || "api"
        } • ${row.created_at}`
      }
    }
  })
}

/* ============================================================
   APROVADOS (TM) — agora lê /edita/exclui direto em /api/tm
   ============================================================ */

function renderApprovedTM(rows = []) {
  const list = document.querySelector("#logApproved")
  if (!list) return

  const escapeHTMLLocal = (s) =>
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
      <textarea class="src" readonly>${escapeHTMLLocal(
        row.source_norm
      )}</textarea>

      <label>Tradução (editar e salvar)</label>
      <textarea class="tgt">${escapeHTMLLocal(row.target_text)}</textarea>

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

    // SALVAR EDIÇÃO NA TM
    btnSave.addEventListener("click", async () => {
      const target_text = (tgtTA.value || "").trim()
      if (!target_text) {
        alert("Tradução vazia.")
        return
      }

      btnSave.disabled = true
      btnSave.textContent = "Salvando..."

      try {
        const r = await fetch(`/api/tm/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_text }),
        })

        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || `Falha ao salvar (${r.status})`)
        }

        const updated = await r.json()
        tgtTA.value = updated.target_text ?? target_text
        metaEl.textContent = `TM #${updated.id} • uses:${
          updated.uses ?? row.uses ?? 0
        } • quality:${Number(updated.quality ?? row.quality ?? 0.9).toFixed(2)}`

        btnSave.textContent = "Salvo!"
        setTimeout(() => {
          btnSave.textContent = "Salvar edição"
          btnSave.disabled = false
        }, 600)
      } catch (err) {
        btnSave.disabled = false
        btnSave.textContent = "Salvar edição"
        alert(err.message || "Erro ao salvar edição.")
      }
    })

    // EXCLUIR DA TM
    btnDel.addEventListener("click", async () => {
      if (!confirm("Remover esta tradução da memória (TM)?")) return

      btnDel.disabled = true
      btnDel.textContent = "Excluindo..."

      try {
        const r = await fetch(`/api/tm/${row.id}`, { method: "DELETE" })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || `Falha ao excluir (${r.status})`)
        }
        li.remove()
      } catch (err) {
        btnDel.disabled = false
        btnDel.textContent = "Excluir da TM"
        alert(err.message || "Erro ao excluir.")
      }
    })

    // COPIAR PARA O EDITOR PRINCIPAL
    btnCopy.addEventListener("click", () => {
      // Usa o source_norm (normalizado) como original e a tradução editável atual
      if (typeof sourceEl !== "undefined" && typeof targetEl !== "undefined") {
        const srcText = li.querySelector(".src").value || row.source_norm || ""
        sourceEl.value = srcText
        targetEl.value = tgtTA.value || row.target_text || ""
      }
    })

    list.appendChild(li)
  })
}

// ========= Polling dos pendentes (translation_logs) =========
async function pollPending() {
  try {
    const rows = await fetch(
      "/api/logs?status=pending&limit=200&_=" + Date.now()
    ).then((r) => r.json())
    renderPending(rows)
  } catch {}
}

// ========= Polling da TM (aprovados de verdade) =========
async function pollApprovedTM() {
  try {
    const rows = await fetch("/api/tm?limit=200&_=" + Date.now()).then((r) =>
      r.json()
    )
    renderApprovedTM(rows)
  } catch {}
}

setInterval(pollPending, 2000)
setInterval(pollApprovedTM, 5000)

/* =======================
   Toolbar de edição (Unicode)
   ======================= */

// Helpers Unicode
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

// Botões
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

// ========= Inicialização =========
loadGloss()
pollPending()
pollApprovedTM()
