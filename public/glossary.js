// ===== helpers =====
function g_escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}
function g_escapeAttr(s) {
  return String(s).replaceAll('"', "&quot;")
}
async function g_fetchJSON(url, opts) {
  const r = await fetch(url, opts)
  if (!r.ok)
    throw new Error(`${opts?.method || "GET"} ${url} → HTTP ${r.status}`)
  return r.json()
}

// ===== render/list =====
async function g_loadGlossary() {
  const wrap = document.getElementById("glossCards")
  if (!wrap) return
  wrap.innerHTML = `<div class="muted">Carregando…</div>`
  try {
    const list = await g_fetchJSON("/api/glossary")
    if (!Array.isArray(list) || list.length === 0) {
      wrap.innerHTML = `<div class="muted">Nenhum item no glossário ainda.</div>`
      return
    }
    wrap.innerHTML = ""
    for (const row of list) {
      wrap.appendChild(g_renderCard(row))
    }
  } catch (e) {
    console.error(e)
    wrap.innerHTML = `<div class="error">Falha ao carregar /api/glossary (veja o console).</div>`
  }
}

function g_renderCard(row) {
  const card = document.createElement("div")
  card.className = "gloss-card"
  card.dataset.id = row.id

  card.innerHTML = `
    <div class="field">
      <div class="label">EN</div>
      <div class="value mono">${g_escapeHtml(row.term_source || "")}</div>
    </div>
    <div class="field">
      <div class="label">PT</div>
      <div class="value mono">${g_escapeHtml(row.term_target || "")}</div>
    </div>
    <div class="field">
      <div class="label">Game</div>
      <div class="value mono">${g_escapeHtml(row.game || "")}</div>
    </div>
    <div class="field">
      <div class="label">Notas</div>
      <div class="value muted">${g_escapeHtml(row.notes || "")}</div>
    </div>
    <div class="field ta-center">
      <div class="label">Aprovado</div>
      <div class="value">${row.approved ? "✔" : "—"}</div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" data-action="edit">Editar</button>
      <button class="btn btn-danger" data-action="del">Apagar</button>
    </div>
  `

  card
    .querySelector('[data-action="edit"]')
    .addEventListener("click", () => g_enterEditCard(card, row))
  card
    .querySelector('[data-action="del"]')
    .addEventListener("click", () => g_deleteCard(card))

  return card
}

// ===== criar =====
function g_mountGlossaryForm() {
  const form = document.querySelector("#glossForm")
  if (!form) return
  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const gameField = document.querySelector("#gameName")
    const body = {
      term_source: (fd.get("term_source") || "").trim(),
      term_target: (fd.get("term_target") || "").trim(),
      game: (gameField?.value || "").trim() || null,
      notes: (fd.get("notes") || "").trim() || null,
      approved: 1,
    }
    if (!body.term_source || !body.term_target) {
      alert("term_source e term_target são obrigatórios")
      return
    }
    try {
      await g_fetchJSON("/api/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      form.reset()
      await g_loadGlossary()
    } catch (e) {
      console.error(e)
      alert("Não foi possível adicionar.")
    }
  })
}

// ===== editar =====
function g_enterEditCard(card, row) {
  const id = card.dataset.id
  const en = row.term_source ?? ""
  const pt = row.term_target ?? ""
  const game = row.game ?? ""
  const notes = row.notes ?? ""
  const ok = !!row.approved

  card.innerHTML = `
    <div class="field">
      <div class="label">EN</div>
      <input type="text" name="term_source" value="${g_escapeAttr(en)}" />
    </div>
    <div class="field">
      <div class="label">PT</div>
      <input type="text" name="term_target" value="${g_escapeAttr(pt)}" />
    </div>
    <div class="field">
      <div class="label">Game</div>
      <input type="text" name="game" value="${g_escapeAttr(game)}" />
    </div>
    <div class="field">
      <div class="label">Notas</div>
      <input type="text" name="notes" value="${g_escapeAttr(notes)}" />
    </div>
    <div class="field ta-center">
      <div class="label">Aprovado</div>
      <label style="display:inline-flex;gap:.4rem;align-items:center">
        <input type="checkbox" name="approved" ${ok ? "checked" : ""}/> ✔
      </label>
    </div>
    <div class="actions">
      <button class="btn btn-primary" data-action="save">Salvar</button>
      <button class="btn" data-action="cancel">Cancelar</button>
    </div>
  `

  card
    .querySelector('[data-action="save"]')
    .addEventListener("click", async () => {
      const body = {
        term_source: card
          .querySelector('input[name="term_source"]')
          .value.trim(),
        term_target: card
          .querySelector('input[name="term_target"]')
          .value.trim(),
        game: card.querySelector('input[name="game"]').value.trim() || null,
        notes: card.querySelector('input[name="notes"]').value.trim() || null,
        approved: card.querySelector('input[name="approved"]').checked ? 1 : 0,
      }
      if (!body.term_source || !body.term_target) {
        alert("term_source e term_target são obrigatórios")
        return
      }
      try {
        const updated = await g_fetchJSON(`/api/glossary/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        // re-render com dados retornados (ou body) para manter consistência
        const finalRow = Object.assign({}, row, updated || body, { id })
        card.replaceWith(g_renderCard(finalRow))
      } catch (e) {
        console.error(e)
        alert("Não foi possível salvar.")
      }
    })

  card.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    card.replaceWith(g_renderCard(row))
  })
}

// ===== excluir =====
async function g_deleteCard(card) {
  const id = card.dataset.id
  if (!confirm("Apagar este item do glossário?")) return
  try {
    await g_fetchJSON(`/api/glossary/${id}`, { method: "DELETE" })
    card.remove()
  } catch (e) {
    console.error(e)
    alert("Não foi possível apagar.")
  }
}

// ===== init público =====
window.initGlossaryUI = function () {
  g_mountGlossaryForm()
  g_loadGlossary()
}
