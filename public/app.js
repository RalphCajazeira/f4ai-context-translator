// ========= Seletores principais =========
const srcSel = document.querySelector("#src")
const tgtSel = document.querySelector("#tgt")
const swapBtn = document.querySelector("#swap")

const sourceEl = document.querySelector("#source")
const targetEl = document.querySelector("#target")

const btnTranslate = document.querySelector("#btnTranslate")
const btnApprove = document.querySelector("#btnApprove")
const altsEl = document.querySelector("#alts")

const glossForm = document.querySelector("#glossForm")
const glossList = document.querySelector("#glossList")

const logList = document.querySelector("#logList") // painel de log
const preserveLinesChk = document.querySelector("#preserveLines") // checkbox (se existir)

// ========= Trocar idiomas =========
swapBtn.addEventListener("click", () => {
  const s = srcSel.value
  srcSel.value = tgtSel.value
  tgtSel.value = s
})

// ========= Traduzir =========
btnTranslate.addEventListener("click", doTranslate)

async function doTranslate() {
  const text = sourceEl.value.trim()
  if (!text) return

  const payload = {
    text,
    src: srcSel.value,
    tgt: tgtSel.value,
    preserveLines: !!(preserveLinesChk && preserveLinesChk.checked),

    // Se o backend já tiver a rota de logs, isso registra lá; se não tiver, é ignorado.
    log: true,
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

  // Log local na UI (independente do backend)
  addToLog(text, j.best || "")
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

// ========= Aprovar par atual (editor) =========
btnApprove.addEventListener("click", async () => {
  const src = sourceEl.value.trim()
  const tgt = targetEl.value.trim()
  if (!src || !tgt) return alert("Forneça texto original e tradução.")

  const r = await fetch("/api/translate/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_text: src, target_text: tgt }),
  })
  const j = await r.json()
  if (j && j.ok) alert("Par salvo na memória!")
})

// ========= Glossário =========
glossForm.addEventListener("submit", async (e) => {
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

// ========= Log de traduções (UI) =========
function addToLog(source, target) {
  const li = document.createElement("li")
  li.innerHTML = `
    <div><b>Original:</b> ${escapeHTML(source)}</div>
    <div><b>Tradução:</b> ${escapeHTML(target)}</div>
    <div class="actions">
      <button class="approve">Aprovar</button>
      <button class="reject">Reprovar</button>
      <button class="copiar">Copiar para editor</button>
    </div>
  `

  // Aprovar → grava na TM e remove do log
  li.querySelector(".approve").addEventListener("click", async () => {
    const r = await fetch("/api/translate/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_text: source, target_text: target }),
    })
    const j = await r.json()
    if (j && j.ok) {
      alert("Par aprovado e salvo na memória!")
      li.remove()
    }
  })

  // Reprovar → apenas remove do log (não grava)
  li.querySelector(".reject").addEventListener("click", () => li.remove())

  // Copiar → joga a tradução selecionada para o editor (textarea da direita)
  li.querySelector(".copiar").addEventListener("click", () => {
    targetEl.value = target
  })

  // Itens mais recentes no topo
  logList.prepend(li)
}

// ========= Botões de edição (toolbar) =========
const target = document.querySelector("#target")

const btnCopy = document.querySelector("#btnCopy")
const btnUpper = document.querySelector("#btnUpper")
const btnLower = document.querySelector("#btnLower")
const btnCapWords = document.querySelector("#btnCapWords")
const btnCapSentence = document.querySelector("#btnCapSentence")

if (btnCopy) {
  btnCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(target.value)
    alert("Texto copiado!")
  })
}
if (btnUpper) {
  btnUpper.addEventListener("click", () => {
    target.value = target.value.toUpperCase()
  })
}
if (btnLower) {
  btnLower.addEventListener("click", () => {
    target.value = target.value.toLowerCase()
  })
}
if (btnCapWords) {
  btnCapWords.addEventListener("click", () => {
    target.value = target.value
      .toLowerCase()
      .replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
  })
}
if (btnCapSentence) {
  btnCapSentence.addEventListener("click", () => {
    target.value = target.value
      .toLowerCase()
      .replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase())
  })
}

// ========= Inicialização =========
loadGloss()
