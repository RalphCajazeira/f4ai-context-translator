// ===== elementos =====
const srcSel = document.querySelector("#src")
const tgtSel = document.querySelector("#tgt")
const swapBtn = document.querySelector("#swap")

const sourceEl = document.querySelector("#source")
const editor = document.querySelector("#editor") // ÚNICA caixa de edição

const targetPreview = document.querySelector("#targetPreview")
const toggleOldBtn = document.getElementById("toggleOld")

const btnTranslate = document.querySelector("#btnTranslate")
const btnPasteTranslate = document.querySelector("#btnPasteTranslate")
const btnApprove = document.querySelector("#btnApprove")
const preserveLinesChk = document.querySelector("#preserveLines")

const compareBtn = document.querySelector("#btnCompare")
let compareActive = false
let compareBaseline = "" // versão anterior fixa

const altsEl = document.querySelector("#alts")
const logPendingEl = document.querySelector("#logPending")
const logApprovedEl = document.querySelector("#logApproved")
const statusBanner = document.querySelector("#statusMessage")

const locale = "pt-BR"
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  )

let statusTimer = null
function showStatus(message = "", variant = "info", { persist = false } = {}) {
  if (!statusBanner) return
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
  if (!message) {
    statusBanner.hidden = true
    return
  }
  statusBanner.textContent = message
  statusBanner.dataset.variant = variant
  statusBanner.hidden = false
  if (!persist) {
    statusTimer = setTimeout(() => {
      statusBanner.hidden = true
    }, 4500)
  }
}

function handleError(error, fallback = "Ocorreu um erro inesperado.") {
  console.error(error)
  const detail = error?.message ? ` (${error.message})` : ""
  showStatus(fallback + detail, "error")
}

// ===== helpers: caret em contenteditable =====
function getCaretIndex(root) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  let idx = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (n === range.startContainer) return idx + range.startOffset
    idx += n.textContent.length
  }
  return idx
}
function setCaretIndex(root, index) {
  index = Math.max(0, Math.min(index, root.textContent.length))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let node = null,
    offset = 0,
    acc = 0
  while (walker.nextNode()) {
    const t = walker.currentNode
    if (acc + t.textContent.length >= index) {
      node = t
      offset = index - acc
      break
    }
    acc += t.textContent.length
  }
  if (!node) {
    node = root
    offset = root.childNodes.length
  }
  const sel = window.getSelection(),
    r = document.createRange()
  try {
    r.setStart(node, offset)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  } catch (_) {}
}

// ===== linguagem =====
swapBtn?.addEventListener("click", () => {
  const s = srcSel.value
  srcSel.value = tgtSel.value
  tgtSel.value = s
})

// ===== versão anterior vis/oculta =====
toggleOldBtn?.addEventListener("click", () => {
  const showing = targetPreview.style.display !== "none"
  targetPreview.style.display = showing ? "none" : "block"
  toggleOldBtn.textContent = showing ? "Exibir" : "Ocultar"
})

// ===================== TRADUÇÃO =====================
btnTranslate?.addEventListener("click", () =>
  doTranslate({ log: true, refreshAfter: "pending" })
)
btnPasteTranslate?.addEventListener("click", async () => {
  try {
    const clip = (await navigator.clipboard.readText()) || ""
    if (!clip.trim()) {
      showStatus("A área de transferência está vazia.", "warning")
      return
    }
    sourceEl.value = clip.trim()
    await doTranslate({ log: true, refreshAfter: "pending" })
  } catch (error) {
    handleError(error, "Não foi possível acessar a área de transferência.")
  }
})

function setTranslating(on) {
  if (!btnTranslate.dataset.label)
    btnTranslate.dataset.label = btnTranslate.textContent
  if (btnPasteTranslate && !btnPasteTranslate.dataset.label)
    btnPasteTranslate.dataset.label = btnPasteTranslate.textContent
  if (on) {
    btnTranslate.textContent = "Traduzindo..."
    btnTranslate.disabled = true
    if (btnPasteTranslate) {
      btnPasteTranslate.textContent = "Traduzindo..."
      btnPasteTranslate.disabled = true
    }
    editor.dataset.busy = "1"
    showStatus("Traduzindo...", "loading", { persist: true })
  } else {
    btnTranslate.textContent = btnTranslate.dataset.label
    btnTranslate.disabled = false
    if (btnPasteTranslate) {
      btnPasteTranslate.textContent = btnPasteTranslate.dataset.label
      btnPasteTranslate.disabled = false
    }
    delete editor.dataset.busy
  }
}

async function doTranslate({ log = true, refreshAfter = null } = {}) {
  const text = sourceEl.value.trim()
  if (!text) {
    showStatus("Cole ou digite um texto para traduzir.", "warning")
    return
  }
  const payload = {
    text,
    src: srcSel.value,
    tgt: tgtSel.value,
    preserveLines: !!(preserveLinesChk && preserveLinesChk.checked),
    log,
    origin: "ui",
  }

  // guarda “versão anterior”
  const previous = editor.textContent
  targetPreview.textContent = previous || ""

  setTranslating(true)
  try {
    const r = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    const newText = j.best || ""

    if (compareActive) {
      compareBaseline = previous || ""
      targetPreview.style.display = "block"
      toggleOldBtn.textContent = "Ocultar"
      renderDiff(compareBaseline, newText)
    } else {
      setPlainText(newText) // sem cores
    }

    renderAlts(j.candidates || [])
    if (refreshAfter === "pending" && log) await fetchPending()
    showStatus("Tradução atualizada com sucesso!", "success")
  } catch (error) {
    handleError(error, "Não foi possível obter a tradução.")
  } finally {
    setTranslating(false)
  }
}

// ====== renderização no editor ======
function setPlainText(text) {
  const caret = getCaretIndex(editor)
  editor.textContent = text
  setCaretIndex(editor, Math.min(caret, editor.textContent.length))
}

// quebra por limites de palavra, preservando separadores
const tokenize = (s) => s.split(/\b/)

function renderDiff(oldText, newText) {
  const oldT = tokenize(oldText)
  const newT = tokenize(newText)
  const len = Math.max(oldT.length, newT.length)

  const prevOut = []
  const richOut = []

  for (let i = 0; i < len; i++) {
    const a = oldT[i] || ""
    const b = newT[i] || ""
    if (a === b) {
      richOut.push(esc(b))
      prevOut.push(esc(a))
    } else if (!a && b) {
      richOut.push(`<span class="diff-add">${esc(b)}</span>`)
    } else if (a && !b) {
      prevOut.push(`<span class="diff-remove">${esc(a)}</span>`)
    } else if (a.toLowerCase() !== b.toLowerCase()) {
      richOut.push(`<span class="diff-add">${esc(b)}</span>`)
      prevOut.push(`<span class="diff-remove">${esc(a)}</span>`)
    } else {
      richOut.push(esc(b))
      prevOut.push(esc(a))
    }
  }

  const caret = getCaretIndex(editor)
  editor.innerHTML = richOut.join("")
  setCaretIndex(editor, Math.min(caret, editor.textContent.length))

  targetPreview.innerHTML = prevOut.join("")
}

// Atualiza diff em tempo real quando comparando
editor.addEventListener("input", () => {
  if (compareActive) renderDiff(compareBaseline, editor.textContent)
})

// ================= Toggle Comparar =================
compareBtn?.addEventListener("click", () => {
  compareActive = !compareActive
  compareBtn.setAttribute("aria-pressed", String(compareActive))
  compareBtn.textContent = compareActive
    ? "🔍 Comparar: ON"
    : "🔍 Comparar: OFF"

  if (compareActive) {
    compareBaseline =
      (targetPreview?.textContent ?? "") || editor.textContent || ""
    targetPreview.style.display = "block"
    toggleOldBtn.textContent = "Ocultar"
    renderDiff(compareBaseline, editor.textContent)
  } else {
    // remover cores: manter apenas texto
    setPlainText(editor.textContent)
  }
})

// ================= Alternativas / Logs / TM =================
function renderAlts(items) {
  const list = altsEl
  if (!list) return
  list.innerHTML = ""
  items.forEach((it) => {
    const li = document.createElement("li")
    li.innerHTML = `<div>${esc(it.text)}</div><small>${it.origin || ""} ${
      it.score ? "• " + ((it.score * 100) | 0) + "%" : ""
    }</small>`
    li.addEventListener("click", () => {
      if (compareActive) renderDiff(compareBaseline, it.text)
      else setPlainText(it.text)
    })
    list.appendChild(li)
  })
  if (items.length) list.removeAttribute("data-empty")
  else list.setAttribute("data-empty", "1")
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts)
  const raw = await r.text()
  let data = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch (_) {
      data = raw
    }
  }
  if (!r.ok) {
    const detail =
      data && typeof data === "object" ? data.error || data.message : raw
    throw new Error(detail ? `HTTP ${r.status}: ${detail}` : `HTTP ${r.status}`)
  }
  return data ?? {}
}
async function fetchPending() {
  try {
    renderPending(await fetchJSON("/api/logs?status=pending&limit=200"))
  } catch (e) {
    handleError(e, "Falha ao carregar traduções pendentes.")
  }
}
async function fetchApprovedTM() {
  try {
    renderApprovedTM(await fetchJSON("/api/tm?limit=200"))
  } catch (e) {
    handleError(e, "Falha ao carregar a memória de tradução.")
  }
}

function renderPending(rows) {
  if (!logPendingEl) return
  const items = Array.isArray(rows) ? rows : []
  const byId = new Map(items.map((r) => [r.id, r]))
  Array.from(logPendingEl.children).forEach((li) => {
    const id = Number(li.dataset.id)
    if (!byId.has(id)) li.remove()
  })
  items.forEach((row) => {
    let li = logPendingEl.querySelector(`li[data-id="${row.id}"]`)
    if (!li) {
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
        </div>`
      const srcTA = li.querySelector(".src")
      const tgtTA = li.querySelector(".tgt")
      srcTA.value = row.source_text || ""
      tgtTA.value = row.target_text || ""

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
          showStatus("Tradução pendente atualizada.", "success")
        } catch (error) {
          handleError(error, "Não foi possível salvar a alteração.")
        }
      })
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
          showStatus("Tradução aprovada e movida para a memória.", "success")
          await fetchPending()
        } catch (error) {
          handleError(error, "Não foi possível aprovar esta tradução.")
        }
      })
      li.querySelector(".reject").addEventListener("click", async () => {
        try {
          await fetchJSON(`/api/logs/${row.id}/reject`, { method: "POST" })
          li.remove()
          showStatus("Tradução pendente rejeitada.", "warning")
          await fetchPending()
        } catch (error) {
          handleError(error, "Não foi possível rejeitar a tradução.")
        }
      })
      li.querySelector(".copy").addEventListener("click", () => {
        sourceEl.value = srcTA.value
        if (compareActive) renderDiff(compareBaseline, tgtTA.value)
        else setPlainText(tgtTA.value)
        showStatus("Par copiado para o editor.", "info")
      })
      logPendingEl.appendChild(li)
    } else {
      li.querySelector(".src").value = row.source_text || ""
      li.querySelector(".tgt").value = row.target_text || ""
      li.querySelector(".meta").textContent = `#${row.id} • ${
        row.origin || "api"
      } • ${row.created_at}`
    }
  })
  if (logPendingEl.children.length)
    logPendingEl.removeAttribute("data-empty")
  else logPendingEl.setAttribute("data-empty", "1")
}

function renderApprovedTM(rows = []) {
  if (!logApprovedEl) return
  logApprovedEl.innerHTML = ""
  const items = Array.isArray(rows) ? rows : []
  items.forEach((row) => {
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
      </div>`
    const tgtTA = li.querySelector(".tgt")
    li.querySelector(".update").addEventListener("click", async () => {
      try {
        const up = await fetchJSON(`/api/tm/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_text: tgtTA.value.trim() }),
        })
        if (up && typeof up === "object") {
          tgtTA.value = up.target_text ?? tgtTA.value
          li.querySelector(".meta").textContent = `TM #${up.id ?? row.id} • uses:${
            up.uses ?? row.uses ?? 0
          } • quality:${Number(up.quality ?? row.quality ?? 0.9).toFixed(2)}`
        }
        showStatus("Entrada atualizada na memória.", "success")
      } catch (error) {
        handleError(error, "Não foi possível atualizar esta entrada da memória.")
      }
    })
    li.querySelector(".del").addEventListener("click", async () => {
      if (!confirm("Remover esta tradução da memória (TM)?")) return
      try {
        await fetchJSON(`/api/tm/${row.id}`, { method: "DELETE" })
        li.remove()
        showStatus("Entrada removida da memória de tradução.", "warning")
        if (!logApprovedEl.children.length)
          logApprovedEl.setAttribute("data-empty", "1")
      } catch (error) {
        handleError(error, "Não foi possível remover esta entrada da memória.")
      }
    })
    li.querySelector(".copy").addEventListener("click", () => {
      sourceEl.value = li.querySelector(".src").value || row.source_norm || ""
      if (compareActive)
        renderDiff(compareBaseline, tgtTA.value || row.target_text || "")
      else setPlainText(tgtTA.value || row.target_text || "")
      showStatus("Entrada copiada para o editor.", "info")
    })
    logApprovedEl.appendChild(li)
  })
  if (logApprovedEl.children.length)
    logApprovedEl.removeAttribute("data-empty")
  else logApprovedEl.setAttribute("data-empty", "1")
}

// =================== Toolbar (copiar/case/cap) ===================
const btnCopy = document.querySelector("#btnCopy")
const btnUpper = document.querySelector("#btnUpper")
const btnLower = document.querySelector("#btnLower")
const btnCapWords = document.querySelector("#btnCapWords")
const btnCapSentence = document.querySelector("#btnCapSentence")

btnCopy?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(editor.textContent)
    showStatus("Tradução copiada para a área de transferência.", "success")
  } catch (error) {
    handleError(
      error,
      "Não foi possível copiar o texto para a área de transferência."
    )
  }
})
btnUpper?.addEventListener("click", () =>
  applyTransform((t) => t.toLocaleUpperCase(locale))
)
btnLower?.addEventListener("click", () =>
  applyTransform((t) => t.toLocaleLowerCase(locale))
)
btnCapWords?.addEventListener("click", () => {
  const minLen = Math.max(
    0,
    parseInt(document.querySelector("#capMinLen")?.value || "2", 10) || 0
  )
  const ignore = new Set(
    (
      document.querySelector("#capIgnore")?.value ||
      "a,o,as,os,de,do,da,dos,das,e,ou,para,por,no,na,nos,nas"
    )
      .split(",")
      .map((s) => s.trim().toLocaleLowerCase(locale))
      .filter(Boolean)
  )
  const s = editor.textContent
  const tokens = s.split(/(\p{L}[\p{L}\p{M}]*(?:[’'\-]\p{L}[\p{L}\p{M}]*)*)/gu)
  let first = true
  for (let i = 1; i < tokens.length; i += 2) {
    const w = tokens[i]
    const base = w.toLocaleLowerCase(locale)
    if (first || (!ignore.has(base) && base.length >= minLen)) {
      tokens[i] = base.charAt(0).toLocaleUpperCase(locale) + base.slice(1)
    } else tokens[i] = base
    first = false
  }
  applyTransform(() => tokens.join(""))
})
btnCapSentence?.addEventListener("click", () => {
  applyTransform((t) =>
    t.toLocaleLowerCase(locale).replace(/(^\s*\p{L}|[.!?]\s*\p{L})/gu, (m) => {
      const a = Array.from(m)
      return a[0].toLocaleUpperCase(locale) + a.slice(1).join("")
    })
  )
})

function applyTransform(fn) {
  const plain = editor.textContent
  const out = typeof fn === "function" ? fn(plain) : String(fn || "")
  if (compareActive) renderDiff(compareBaseline, out)
  else setPlainText(out)
}

// =================== Aprovar par atual ===================
btnApprove?.addEventListener("click", async () => {
  const src = sourceEl.value.trim()
  const tgt = editor.textContent.trim()
  if (!src || !tgt) {
    showStatus("Forneça texto original e tradução para aprovar.", "warning")
    return
  }
  try {
    await fetchJSON("/api/translate/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_text: src,
        target_text: tgt,
        removeFromLog: true,
      }),
    })
    await fetchApprovedTM()
    await fetchPending()
    showStatus("Par atual aprovado e salvo na memória.", "success")
  } catch (error) {
    handleError(error, "Não foi possível aprovar a tradução atual.")
  }
})

// =================== Init ===================
;(async function init() {
  if (window.initGlossaryUI) window.initGlossaryUI() // ← hook do novo glossary.js
  await fetchPending()
  await fetchApprovedTM()
})()

// ==== Controle de Abas (Glossário / Blacklist) ====
document.querySelectorAll(".tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab
    document
      .querySelectorAll(".tabs .tab")
      .forEach((t) => t.classList.remove("active"))
    tab.classList.add("active")
    document
      .querySelectorAll(".tab-content")
      .forEach((div) => div.classList.remove("active"))
    const target = document.getElementById(`tab-${name}`)
    if (target) target.classList.add("active")
  })
})

// ===== Retrátil do painel lateral (Glossário/Blacklist) =====
;(function setupCollapsibleSidePanel() {
  const side = document.getElementById("sidePanel")
  const body = document.getElementById("sideBody")
  const btn = document.getElementById("toggleSide")
  if (!side || !body || !btn) return

  const LS_KEY = "ui.sidePanelCollapsed"

  function setBodyMaxHeight() {
    const wasCollapsed = side.classList.contains("is-collapsed")
    if (wasCollapsed) side.classList.remove("is-collapsed")
    body.style.maxHeight = "none"
    const h = body.scrollHeight
    body.style.maxHeight = h + "px"
    if (wasCollapsed) side.classList.add("is-collapsed")
  }

  function toggle() {
    const collapsed = side.classList.toggle("is-collapsed")
    btn.setAttribute("aria-expanded", String(!collapsed))
    localStorage.setItem(LS_KEY, collapsed ? "1" : "0")
    if (!collapsed) requestAnimationFrame(() => setBodyMaxHeight())
  }

  const saved = localStorage.getItem(LS_KEY)
  if (saved === "1") {
    side.classList.add("is-collapsed")
    btn.setAttribute("aria-expanded", "false")
  } else {
    btn.setAttribute("aria-expanded", "true")
  }

  if (!side.classList.contains("is-collapsed")) {
    window.requestAnimationFrame(() => setBodyMaxHeight())
  }

  btn.addEventListener("click", toggle)
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      toggle()
    }
  })

  document.querySelectorAll(".tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!side.classList.contains("is-collapsed")) {
        requestAnimationFrame(() => setBodyMaxHeight())
      }
    })
  })

  window.addEventListener("resize", () => {
    if (!side.classList.contains("is-collapsed")) setBodyMaxHeight()
  })
})()
