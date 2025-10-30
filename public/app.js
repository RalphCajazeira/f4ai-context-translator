// ====== elementos ======
const srcSel = document.querySelector("#src")
const tgtSel = document.querySelector("#tgt")
const swapBtn = document.querySelector("#swap")

const sourceEl = document.querySelector("#source")
const targetTA = document.querySelector("#target") // textarea “origem de verdade”
const targetRich = document.querySelector("#targetRich") // editor colorido

const targetPreview = document.querySelector("#targetPreview")
const toggleOldBtn = document.getElementById("toggleOld")

const btnTranslate = document.querySelector("#btnTranslate")
const btnPasteTranslate = document.querySelector("#btnPasteTranslate")
const btnApprove = document.querySelector("#btnApprove")

const preserveLinesChk = document.querySelector("#preserveLines")

const compareBtn = document.querySelector("#btnCompare")
let compareActive = false
let compareBaseline = "" // versão anterior fixa para comparar

const altsEl = document.querySelector("#alts")
const logPendingEl = document.querySelector("#logPending")
const logApprovedEl = document.querySelector("#logApproved")

// ===== helpers =====
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  )

const locale = "pt-BR"

// ====================== UI geral ======================
swapBtn?.addEventListener("click", () => {
  const s = srcSel.value
  srcSel.value = tgtSel.value
  tgtSel.value = s
})

// Mostrar/ocultar “Versão anterior”
toggleOldBtn?.addEventListener("click", () => {
  const showing = targetPreview.style.display !== "none"
  targetPreview.style.display = showing ? "none" : "block"
  toggleOldBtn.textContent = showing ? "Exibir" : "Ocultar"
})

// ==================== TRADUÇÃO ====================
btnTranslate?.addEventListener("click", () =>
  doTranslate({ log: true, refreshAfter: "pending" })
)
btnPasteTranslate?.addEventListener("click", async () => {
  const clip = (await navigator.clipboard.readText()) || ""
  if (!clip.trim()) return alert("A área de transferência está vazia.")
  sourceEl.value = clip.trim()
  await doTranslate({ log: true, refreshAfter: "pending" })
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
    targetTA.classList.add("busy")
  } else {
    btnTranslate.textContent = btnTranslate.dataset.label
    btnTranslate.disabled = false
    if (btnPasteTranslate) {
      btnPasteTranslate.textContent = btnPasteTranslate.dataset.label
      btnPasteTranslate.disabled = false
    }
    targetTA.classList.remove("busy")
  }
}

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

  // guarda versão anterior
  const previous = getCurrentEditorText()
  targetPreview.textContent = previous || ""

  setTranslating(true)
  try {
    const r = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`)
    }
    const j = await r.json()
    const newText = j.best || ""

    // atualiza editor base
    setEditorText(newText)

    if (compareActive) {
      compareBaseline = previous || ""
      // força exibição da versão anterior
      targetPreview.style.display = "block"
      toggleOldBtn.textContent = "Ocultar"
      renderDiff(compareBaseline, newText) // pinta no editor rico e no preview
    } else {
      hideRichMode()
    }

    renderAlts(j.candidates || [])
    if (refreshAfter === "pending" && log) await fetchPending()
  } finally {
    setTranslating(false)
  }
}

// ============ EDITOR: alternância & sincronização ============
function useRichMode() {
  // mostra contenteditable, esconde textarea
  targetTA.classList.add("hidden")
  targetRich.classList.remove("hidden")
  // mantém o mesmo texto
  targetRich.textContent = targetTA.value
}
function hideRichMode() {
  targetRich.classList.add("hidden")
  targetTA.classList.remove("hidden")
}

function getCurrentEditorText() {
  return compareActive ? targetRich.textContent : targetTA.value
}
function setEditorText(text) {
  if (compareActive) {
    targetRich.textContent = text
    targetTA.value = text // manter sincronizado
  } else {
    targetTA.value = text
  }
}

// ============ DIFF colorido direto no editor ============
function tokenizeByWordBoundaries(txt) {
  return txt.split(/\b/) // mantém separadores para reconstruir layout
}

// cursor em contenteditable (índice em caracteres, contando apenas nós de texto)
function getCaretIndex(root) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  let idx = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node === range.startContainer) {
      return idx + range.startOffset
    }
    idx += node.textContent.length
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
  const sel = window.getSelection()
  const range = document.createRange()
  try {
    range.setStart(node, offset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  } catch (_) {}
}

function renderDiff(oldText, newText) {
  // tokens
  const oldT = tokenizeByWordBoundaries(oldText)
  const newT = tokenizeByWordBoundaries(newText)
  const len = Math.max(oldT.length, newT.length)

  // “Versão anterior” (vermelho p/ removidos)
  const prevOut = []

  // Editor rico (verde p/ novos/modificados)
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

  // mantém posição do cursor
  const caretBefore = getCaretIndex(targetRich)
  targetRich.innerHTML = richOut.join("")
  setCaretIndex(
    targetRich,
    Math.min(caretBefore, targetRich.textContent.length)
  )

  targetPreview.innerHTML = prevOut.join("")
  // sincroniza o valor “oficial” no textarea
  targetTA.value = targetRich.textContent
}

// entrada do usuário quando o modo rico está ativo
targetRich.addEventListener("input", () => {
  if (!compareActive) return
  const current = targetRich.textContent
  renderDiff(compareBaseline, current)
})

// ================= Toggle Comparar =================
compareBtn?.addEventListener("click", () => {
  compareActive = !compareActive
  compareBtn.setAttribute("aria-pressed", String(compareActive))
  compareBtn.textContent = compareActive
    ? "🔍 Comparar: ON"
    : "🔍 Comparar: OFF"

  if (compareActive) {
    compareBaseline = (targetPreview?.textContent ?? "") || targetTA.value || ""
    useRichMode()
    targetPreview.style.display = "block"
    toggleOldBtn.textContent = "Ocultar"
    renderDiff(compareBaseline, targetRich.textContent)
  } else {
    hideRichMode()
    // ao sair, garante que o textarea tenha o texto editado
    targetTA.value = targetTA.value || targetRich.textContent
  }
})

// =================== Alternativas, logs e TM ===================
function renderAlts(items) {
  const list = document.querySelector("#alts")
  list.innerHTML = ""
  items.forEach((it) => {
    const li = document.createElement("li")
    li.innerHTML = `<div>${esc(it.text)}</div><small>${it.origin || ""} ${
      it.score ? "• " + ((it.score * 100) | 0) + "%" : ""
    }</small>`
    li.addEventListener("click", () => {
      setEditorText(it.text)
      if (compareActive) renderDiff(compareBaseline, it.text)
    })
    list.appendChild(li)
  })
}

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function fetchPending() {
  try {
    renderPending(await fetchJSON("/api/logs?status=pending&limit=200"))
  } catch (e) {
    console.error(e)
  }
}
async function fetchApprovedTM() {
  try {
    renderApprovedTM(await fetchJSON("/api/tm?limit=200"))
  } catch (e) {
    console.error(e)
  }
}

function renderPending(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  Array.from(logPendingEl.children).forEach((li) => {
    const id = Number(li.dataset.id)
    if (!byId.has(id)) li.remove()
  })
  rows.forEach((row) => {
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
        await fetchJSON(`/api/logs/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_text: srcTA.value,
            target_text: tgtTA.value,
          }),
        })
      })
      li.querySelector(".approve").addEventListener("click", async () => {
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
      })
      li.querySelector(".reject").addEventListener("click", async () => {
        await fetchJSON(`/api/logs/${row.id}/reject`, { method: "POST" })
        li.remove()
      })
      li.querySelector(".copy").addEventListener("click", () => {
        sourceEl.value = srcTA.value
        setEditorText(tgtTA.value)
        if (compareActive) renderDiff(compareBaseline, tgtTA.value)
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
}

function renderApprovedTM(rows = []) {
  logApprovedEl.innerHTML = ""
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
      </div>`
    const tgtTA = li.querySelector(".tgt")
    li.querySelector(".update").addEventListener("click", async () => {
      const up = await fetchJSON(`/api/tm/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_text: tgtTA.value.trim() }),
      })
      tgtTA.value = up.target_text
      li.querySelector(".meta").textContent = `TM #${up.id} • uses:${
        up.uses ?? row.uses ?? 0
      } • quality:${Number(up.quality ?? row.quality ?? 0.9).toFixed(2)}`
    })
    li.querySelector(".del").addEventListener("click", async () => {
      if (!confirm("Remover esta tradução da memória (TM)?")) return
      await fetchJSON(`/api/tm/${row.id}`, { method: "DELETE" })
      li.remove()
    })
    li.querySelector(".copy").addEventListener("click", () => {
      sourceEl.value = li.querySelector(".src").value || row.source_norm || ""
      setEditorText(tgtTA.value || row.target_text || "")
      if (compareActive) renderDiff(compareBaseline, getCurrentEditorText())
    })
    logApprovedEl.appendChild(li)
  })
}

// =================== Toolbar (copiar/case) ===================
const btnCopy = document.querySelector("#btnCopy")
const btnUpper = document.querySelector("#btnUpper")
const btnLower = document.querySelector("#btnLower")
const btnCapWords = document.querySelector("#btnCapWords")
const btnCapSentence = document.querySelector("#btnCapSentence")

btnCopy?.addEventListener("click", () => {
  navigator.clipboard.writeText(getCurrentEditorText())
  alert("Texto copiado!")
})
btnUpper?.addEventListener("click", () => {
  const t = getCurrentEditorText().toLocaleUpperCase(locale)
  setEditorText(t)
  if (compareActive) renderDiff(compareBaseline, t)
})
btnLower?.addEventListener("click", () => {
  const t = getCurrentEditorText().toLocaleLowerCase(locale)
  setEditorText(t)
  if (compareActive) renderDiff(compareBaseline, t)
})
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
  const s = getCurrentEditorText()
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
  const out = tokens.join("")
  setEditorText(out)
  if (compareActive) renderDiff(compareBaseline, out)
})
btnCapSentence?.addEventListener("click", () => {
  const out = getCurrentEditorText()
    .toLocaleLowerCase(locale)
    .replace(/(^\s*\p{L}|[.!?]\s*\p{L})/gu, (m) => {
      const a = Array.from(m)
      return a[0].toLocaleUpperCase(locale) + a.slice(1).join("")
    })
  setEditorText(out)
  if (compareActive) renderDiff(compareBaseline, out)
})

// =================== Aprovar par atual ===================
btnApprove?.addEventListener("click", async () => {
  const src = sourceEl.value.trim()
  const tgt = getCurrentEditorText().trim()
  if (!src || !tgt) return alert("Forneça texto original e tradução.")
  const r = await fetch("/api/translate/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_text: src,
      target_text: tgt,
      removeFromLog: true,
    }),
  })
  const j = await r.json()
  if (j?.ok) await fetchApprovedTM()
})

// =================== Init ===================
;(async function init() {
  await loadGloss()
  await fetchPending()
  await fetchApprovedTM()
})()

async function loadGloss() {
  const r = await fetch("/api/glossary")
  if (!r.ok) return
  const items = await r.json()
  document.querySelector("#glossList").innerHTML = items
    .map((i) => `• <b>${esc(i.term_source)}</b> → ${esc(i.term_target)}`)
    .map((line) => `<div>${line}</div>`)
    .join("")
}
