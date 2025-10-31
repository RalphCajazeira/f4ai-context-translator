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
const btnApproveAndNext = document.querySelector("#btnApproveAndNext")
const preserveLinesChk = document.querySelector("#preserveLines")

const compareBtn = document.querySelector("#btnCompare")
const capOptions = document.querySelector(".cap-options")
const capToggleBtn = document.querySelector("#btnCapOptions")
let compareActive = false
let compareBaseline = "" // versão anterior fixa

const altsEl = document.querySelector("#alts")
const logPendingEl = document.querySelector("#logPending")
const logApprovedEl = document.querySelector("#logApproved")
const statusStack = document.querySelector("#statusStack")
const gameInput = document.querySelector("#gameName")
const modInput = document.querySelector("#modName")

const GAME_STORAGE_KEY = "f4ai:last-game"
const MOD_STORAGE_KEY = "f4ai:last-mod"

const STATUS_ICONS = {
  success: "✔️",
  error: "⚠️",
  warning: "⚠️",
  loading: "⏳",
  info: "ℹ️",
}

const locale = "pt-BR"
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  )

let persistentToast = null
function dismissToast(el) {
  if (!el) return
  el.classList.add("dismissed")
  setTimeout(() => el.remove(), 200)
}

function createToast(message, variant = "info") {
  const el = document.createElement("div")
  el.className = "status-toast"
  el.dataset.variant = variant

  const icon = document.createElement("span")
  icon.className = "icon"
  icon.textContent = STATUS_ICONS[variant] || STATUS_ICONS.info

  const content = document.createElement("div")
  content.className = "content"
  content.textContent = message

  const close = document.createElement("button")
  close.type = "button"
  close.className = "dismiss"
  close.setAttribute("aria-label", "Fechar notificação")
  close.textContent = "✕"
  close.addEventListener("click", () => {
    if (persistentToast === el) persistentToast = null
    dismissToast(el)
  })

  el.append(icon, content, close)
  return el
}

function showStatus(message = "", variant = "info", { persist = false } = {}) {
  if (!statusStack) return
  if (!message) {
    if (persistentToast) {
      dismissToast(persistentToast)
      persistentToast = null
    }
    return
  }

  if (persist) {
    if (!persistentToast) {
      persistentToast = createToast(message, variant)
      statusStack.appendChild(persistentToast)
    } else {
      persistentToast.dataset.variant = variant
      const icon = persistentToast.querySelector(".icon")
      const content = persistentToast.querySelector(".content")
      if (icon) icon.textContent = STATUS_ICONS[variant] || STATUS_ICONS.info
      if (content) content.textContent = message
    }
    return
  }

  if (persistentToast) {
    dismissToast(persistentToast)
    persistentToast = null
  }

  const toast = createToast(message, variant)
  statusStack.appendChild(toast)
  setTimeout(() => {
    if (toast.isConnected) dismissToast(toast)
  }, 4800)
}

function loadPersistedContext() {
  try {
    const storedGame = localStorage.getItem(GAME_STORAGE_KEY)
    if (storedGame && gameInput) gameInput.value = storedGame
  } catch (_) {}
  try {
    const storedMod = localStorage.getItem(MOD_STORAGE_KEY)
    if (storedMod && modInput) modInput.value = storedMod
  } catch (_) {}
}

function persistContext(key, value) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch (_) {}
}

function currentGame() {
  return (gameInput?.value || "").trim()
}

function currentMod() {
  return (modInput?.value || "").trim()
}

function ensureContext() {
  const game = currentGame()
  const mod = currentMod()
  if (!game || !mod) {
    showStatus("Informe o nome do jogo e do mod antes de continuar.", "warning")
    if (!game && gameInput) gameInput.focus()
    else if (!mod && modInput) modInput.focus()
    return null
  }
  return { game, mod }
}

function emitContextChange() {
  const detail = { game: currentGame(), mod: currentMod() }
  window.dispatchEvent(new CustomEvent("contextchange", { detail }))
}

function refreshContextConsumers() {
  const context = ensureContext()
  if (!context) return
  emitContextChange()
  logState.pending.page = 1
  logState.approved.page = 1
  fetchPending(1)
  fetchApprovedTM(1)
}

const logSearchInput = document.querySelector("#logSearch")
const logPendingInfo = document.querySelector("#logPendingInfo")
const logApprovedInfo = document.querySelector("#logApprovedInfo")
const logPendingPager = document.querySelector("#logPendingPager")
const logApprovedPager = document.querySelector("#logApprovedPager")

const logState = {
  search: "",
  pending: { page: 1, totalPages: 1, total: 0 },
  approved: { page: 1, totalPages: 1, total: 0 },
}

function updateLogMeta(kind, meta = {}) {
  const state = logState[kind]
  if (!state) return
  const pageValue = Number(meta.page)
  if (!Number.isNaN(pageValue) && pageValue > 0) {
    state.page = pageValue
  }

  const totalPagesValue = Number(meta.total_pages)
  if (!Number.isNaN(totalPagesValue) && totalPagesValue > 0) {
    state.totalPages = Math.max(1, totalPagesValue)
  } else {
    state.totalPages = Math.max(1, state.totalPages)
  }

  const totalValue = Number(meta.total)
  if (!Number.isNaN(totalValue) && totalValue >= 0) {
    state.total = totalValue
  }

  const infoEl = kind === "pending" ? logPendingInfo : logApprovedInfo
  if (infoEl) {
    infoEl.textContent = `${state.total} itens • pág. ${state.page} de ${state.totalPages}`
  }

  const pager = kind === "pending" ? logPendingPager : logApprovedPager
  if (pager) {
    const prev = pager.querySelector('[data-dir="prev"]')
    const next = pager.querySelector('[data-dir="next"]')
    if (prev) prev.disabled = state.page <= 1
    if (next) next.disabled = state.page >= state.totalPages
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

gameInput?.addEventListener("input", () => {
  persistContext(GAME_STORAGE_KEY, currentGame())
})
gameInput?.addEventListener("change", () => {
  persistContext(GAME_STORAGE_KEY, currentGame())
  if (currentGame() && currentMod()) refreshContextConsumers()
})

modInput?.addEventListener("input", () => {
  persistContext(MOD_STORAGE_KEY, currentMod())
})
modInput?.addEventListener("change", () => {
  persistContext(MOD_STORAGE_KEY, currentMod())
  if (currentGame() && currentMod()) refreshContextConsumers()
})

// ===================== TRADUÇÃO =====================
btnTranslate?.addEventListener("click", () =>
  doTranslate({ log: true, refreshAfter: "pending" })
)
btnPasteTranslate?.addEventListener("click", () =>
  pasteAndTranslate({ log: true, refreshAfter: "pending" })
)

async function pasteAndTranslate({ log = true, refreshAfter = "pending" } = {}) {
  try {
    const clip = (await navigator.clipboard.readText()) || ""
    if (!clip.trim()) {
      showStatus("A área de transferência está vazia.", "warning")
      return false
    }
    sourceEl.value = clip.trim()
    await doTranslate({ log, refreshAfter })
    return true
  } catch (error) {
    handleError(error, "Não foi possível acessar a área de transferência.")
    return false
  }
}

function setTranslating(on) {
  if (!btnTranslate.dataset.label)
    btnTranslate.dataset.label = btnTranslate.textContent
  if (btnPasteTranslate && !btnPasteTranslate.dataset.label)
    btnPasteTranslate.dataset.label = btnPasteTranslate.textContent
  if (btnApproveAndNext && !btnApproveAndNext.dataset.label)
    btnApproveAndNext.dataset.label = btnApproveAndNext.textContent
  if (on) {
    btnTranslate.textContent = "Traduzindo..."
    btnTranslate.disabled = true
    if (btnPasteTranslate) {
      btnPasteTranslate.textContent = "Traduzindo..."
      btnPasteTranslate.disabled = true
    }
    if (btnApproveAndNext) btnApproveAndNext.disabled = true
    editor.dataset.busy = "1"
    showStatus("Traduzindo...", "loading", { persist: true })
  } else {
    btnTranslate.textContent = btnTranslate.dataset.label
    btnTranslate.disabled = false
    if (btnPasteTranslate) {
      btnPasteTranslate.textContent = btnPasteTranslate.dataset.label
      btnPasteTranslate.disabled = false
    }
    if (btnApproveAndNext) btnApproveAndNext.disabled = false
    delete editor.dataset.busy
  }
}

async function doTranslate({ log = true, refreshAfter = null } = {}) {
  const text = sourceEl.value.trim()
  if (!text) {
    showStatus("Cole ou digite um texto para traduzir.", "warning")
    return
  }
  const context = ensureContext()
  if (!context) return

  const payload = {
    text,
    src: srcSel.value,
    tgt: tgtSel.value,
    preserveLines: !!(preserveLinesChk && preserveLinesChk.checked),
    log,
    origin: "ui",
    game: context.game,
    mod: context.mod,
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

capToggleBtn?.addEventListener("click", () => {
  if (!capOptions) return
  const open = !capOptions.classList.contains("open")
  capOptions.classList.toggle("open", open)
  capToggleBtn.setAttribute("aria-expanded", open ? "true" : "false")
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
async function fetchPending(page = logState.pending.page) {
  logState.pending.page = page
  const params = new URLSearchParams({
    status: "pending",
    limit: "50",
    page: String(page),
  })
  if (logState.search) params.set("q", logState.search)
  const game = currentGame()
  if (game) params.set("game", game)
  const mod = currentMod()
  if (mod) params.set("mod", mod)

  try {
    const data = await fetchJSON(`/api/logs?${params}`)
    const items = Array.isArray(data) ? data : data.items || []
    const meta = Array.isArray(data)
      ? { page, total_pages: 1, total: items.length, per_page: items.length }
      : data.meta || {}
    updateLogMeta("pending", meta)
    renderPending(items, meta)
  } catch (e) {
    handleError(e, "Falha ao carregar traduções pendentes.")
  }
}
async function fetchApprovedTM(page = logState.approved.page) {
  logState.approved.page = page
  const params = new URLSearchParams({ limit: "50", page: String(page) })
  if (logState.search) params.set("q", logState.search)
  const game = currentGame()
  if (game) params.set("game", game)
  const mod = currentMod()
  if (mod) params.set("mod", mod)

  try {
    const data = await fetchJSON(`/api/tm?${params}`)
    const items = Array.isArray(data) ? data : data.items || []
    const meta = Array.isArray(data)
      ? { page, total_pages: 1, total: items.length, per_page: items.length }
      : data.meta || {}
    updateLogMeta("approved", meta)
    renderApprovedTM(items, meta)
  } catch (e) {
    handleError(e, "Falha ao carregar a memória de tradução.")
  }
}

let logSearchDebounce = null
logSearchInput?.addEventListener("input", () => {
  clearTimeout(logSearchDebounce)
  logSearchDebounce = setTimeout(() => {
    logState.search = logSearchInput.value.trim()
    logState.pending.page = 1
    logState.approved.page = 1
    fetchPending(1)
    fetchApprovedTM(1)
  }, 250)
})

function handlePagerClick(kind, dir) {
  const state = logState[kind]
  if (!state) return
  if (dir === "prev" && state.page > 1) {
    const nextPage = state.page - 1
    if (kind === "pending") fetchPending(nextPage)
    else fetchApprovedTM(nextPage)
  } else if (dir === "next" && state.page < state.totalPages) {
    const nextPage = state.page + 1
    if (kind === "pending") fetchPending(nextPage)
    else fetchApprovedTM(nextPage)
  }
}

logPendingPager?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-dir]")
  if (!btn) return
  event.preventDefault()
  handlePagerClick("pending", btn.dataset.dir)
})

logApprovedPager?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-dir]")
  if (!btn) return
  event.preventDefault()
  handlePagerClick("approved", btn.dataset.dir)
})

function renderPending(rows = [], meta = {}) {
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
        <div class="meta">
          <span class="line">#${row.id} • ${row.origin || "api"} • ${
        row.created_at || ""
      }</span>
          <span class="line tags">
            <span class="tag">🎮 ${esc(row.game || "—")}</span>
            <span class="tag">🧩 ${esc(row.mod || "—")}</span>
          </span>
        </div>
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
              game: row.game,
              mod: row.mod,
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
              game: row.game,
              mod: row.mod,
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
      li.dataset.id = row.id
      const metaEl = li.querySelector(".meta")
      if (metaEl) {
        metaEl.innerHTML = `
          <span class="line">#${row.id} • ${row.origin || "api"} • ${
          row.created_at || ""
        }</span>
          <span class="line tags">
            <span class="tag">🎮 ${esc(row.game || "—")}</span>
            <span class="tag">🧩 ${esc(row.mod || "—")}</span>
          </span>`
      }
    }
    li.dataset.game = row.game || ""
    li.dataset.mod = row.mod || ""
  })
  if (logPendingEl.children.length)
    logPendingEl.removeAttribute("data-empty")
  else logPendingEl.setAttribute("data-empty", "1")
}

function renderApprovedTM(rows = [], meta = {}) {
  if (!logApprovedEl) return
  logApprovedEl.innerHTML = ""
  const items = Array.isArray(rows) ? rows : []
  items.forEach((row) => {
    const li = document.createElement("li")
    li.className = "log-item"
    li.dataset.id = row.id
    li.innerHTML = `
      <div class="meta">
        <span class="line">TM #${row.id} • uses:${row.uses ?? 0} • quality:${Number(
      row.quality ?? 0.9
    ).toFixed(2)}</span>
        <span class="line tags">
          <span class="tag">🎮 ${esc(row.game || "—")}</span>
          <span class="tag">🧩 ${esc(row.mod || "—")}</span>
        </span>
      </div>
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
async function approveCurrent({ showSuccess = true } = {}) {
  const src = sourceEl.value.trim()
  const tgt = editor.textContent.trim()
  if (!src || !tgt) {
    showStatus("Forneça texto original e tradução para aprovar.", "warning")
    return false
  }
  const context = ensureContext()
  if (!context) return false
  try {
    await fetchJSON("/api/translate/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_text: src,
        target_text: tgt,
        removeFromLog: true,
        game: context.game,
        mod: context.mod,
      }),
    })
    await fetchApprovedTM()
    await fetchPending()
    if (showSuccess)
      showStatus("Par atual aprovado e salvo na memória.", "success")
    return true
  } catch (error) {
    handleError(error, "Não foi possível aprovar a tradução atual.")
    return false
  }
}

btnApprove?.addEventListener("click", () => approveCurrent({ showSuccess: true }))

btnApproveAndNext?.addEventListener("click", async () => {
  if (btnApproveAndNext.disabled) return
  btnApproveAndNext.disabled = true
  try {
    showStatus("Aprovando tradução atual...", "loading", { persist: true })
    const ok = await approveCurrent({ showSuccess: false })
    if (!ok) return
    showStatus(
      "Par aprovado! Preparando próxima tradução...",
      "loading",
      { persist: true }
    )
    const started = await pasteAndTranslate({ log: true, refreshAfter: "pending" })
    if (!started) {
      showStatus(
        "Par aprovado, mas nenhuma nova tradução foi encontrada na área de transferência.",
        "warning"
      )
      return
    }
  } finally {
    if (!editor.dataset.busy) btnApproveAndNext.disabled = false
  }
})

// =================== Init ===================
;(async function init() {
  loadPersistedContext()
  if (currentGame() && currentMod()) {
    emitContextChange()
  } else {
    showStatus("Defina o jogo e o mod para carregar os dados.", "info")
  }

  if (typeof window.initGlossaryUI === "function") {
    window.initGlossaryUI()
  }
  if (typeof window.initBlacklistUI === "function") {
    window.initBlacklistUI()
  }

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

const appTabs = document.querySelectorAll(".app-tab")
function activateAppTab(name) {
  document.querySelectorAll(".app-tab").forEach((tab) => {
    const isActive = tab.dataset.tab === name
    tab.classList.toggle("active", isActive)
    tab.setAttribute("aria-selected", isActive ? "true" : "false")
  })
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const isActive = panel.id === `tab-${name}`
    panel.classList.toggle("active", isActive)
    panel.setAttribute("aria-hidden", isActive ? "false" : "true")
  })
}

appTabs.forEach((tab) => {
  tab.addEventListener("click", () => activateAppTab(tab.dataset.tab))
})

if (appTabs.length) {
  const current = Array.from(appTabs).find((tab) =>
    tab.classList.contains("active")
  )
  activateAppTab(current?.dataset.tab || appTabs[0].dataset.tab)
}
