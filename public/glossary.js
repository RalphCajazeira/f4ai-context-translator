const glossaryTableBody = document.querySelector("#glossaryTable tbody")
const glossarySearchInput = document.querySelector("#glossSearch")
const glossaryInfo = document.querySelector("#glossInfo")
const glossaryPager = document.querySelector("#glossPager")
const glossaryGameInput = document.querySelector("#gameName")
const glossaryModInput = document.querySelector("#modName")
const glossaryForm = document.querySelector("#glossForm")

const GLOSSARY_LIMIT = 50

const glossaryState = {
  page: 1,
  totalPages: 1,
  total: 0,
  search: "",
}

const glossaryEvents = { initialized: false }

function g_escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function g_escapeAttr(value) {
  return String(value ?? "").replaceAll('"', "&quot;")
}

async function g_fetchJSON(url, opts) {
  const response = await fetch(url, opts)
  const payload = await response.text()
  let data = null
  if (payload) {
    try {
      data = JSON.parse(payload)
    } catch (_) {
      data = payload
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object"
        ? data.error || data.message
        : payload || response.statusText
    throw new Error(message || `HTTP ${response.status}`)
  }
  return data ?? {}
}

function g_getContext() {
  return {
    game: (glossaryGameInput?.value || "").trim(),
    mod: (glossaryModInput?.value || "").trim(),
  }
}

function g_updateInfo(meta = {}) {
  const pageValue = Number(meta.page)
  if (!Number.isNaN(pageValue) && pageValue > 0) {
    glossaryState.page = pageValue
  }

  const totalPagesValue = Number(meta.total_pages)
  if (!Number.isNaN(totalPagesValue) && totalPagesValue > 0) {
    glossaryState.totalPages = Math.max(1, totalPagesValue)
  }

  const totalValue = Number(meta.total)
  if (!Number.isNaN(totalValue) && totalValue >= 0) {
    glossaryState.total = totalValue
  }

  if (glossaryInfo) {
    glossaryInfo.textContent = `${glossaryState.total} itens • pág. ${glossaryState.page} de ${glossaryState.totalPages}`
  }

  if (glossaryPager) {
    const prev = glossaryPager.querySelector('[data-dir="prev"]')
    const next = glossaryPager.querySelector('[data-dir="next"]')
    if (prev) prev.disabled = glossaryState.page <= 1
    if (next) next.disabled = glossaryState.page >= glossaryState.totalPages
  }
}

function g_renderEmptyRow() {
  if (!glossaryTableBody) return
  const tr = document.createElement("tr")
  const td = document.createElement("td")
  td.colSpan = 7
  td.className = "muted"
  td.textContent = "Nenhum item no glossário ainda."
  tr.appendChild(td)
  glossaryTableBody.appendChild(tr)
}

function g_renderGlossary(items = []) {
  if (!glossaryTableBody) return
  glossaryTableBody.innerHTML = ""
  if (!items.length) {
    g_renderEmptyRow()
    return
  }

  for (const row of items) {
    glossaryTableBody.appendChild(g_createRow(row))
  }
}

function g_createRow(row) {
  const tr = document.createElement("tr")
  tr.dataset.id = row.id
  tr.innerHTML = `
    <td class="mono">${g_escapeHtml(row.term_source)}</td>
    <td class="mono">${g_escapeHtml(row.term_target)}</td>
    <td>${g_escapeHtml(row.game || "")}</td>
    <td>${g_escapeHtml(row.mod || "")}</td>
    <td>${g_escapeHtml(row.notes || "")}</td>
    <td class="ta-center">${row.approved ? "✔" : "—"}</td>
    <td class="ta-right">
      <button type="button" class="btn btn-secondary" data-action="edit">Editar</button>
      <button type="button" class="btn btn-danger" data-action="delete">Excluir</button>
    </td>
  `

  const editBtn = tr.querySelector('[data-action="edit"]')
  const deleteBtn = tr.querySelector('[data-action="delete"]')

  editBtn?.addEventListener("click", () => g_enterEditRow(tr, row))
  deleteBtn?.addEventListener("click", () => g_deleteRow(row.id))

  return tr
}

function g_enterEditRow(tr, row) {
  const id = row.id
  tr.innerHTML = `
    <td><input type="text" name="term_source" value="${g_escapeAttr(row.term_source || "")}" /></td>
    <td><input type="text" name="term_target" value="${g_escapeAttr(row.term_target || "")}" /></td>
    <td><input type="text" name="game" value="${g_escapeAttr(row.game || "")}" /></td>
    <td><input type="text" name="mod" value="${g_escapeAttr(row.mod || "")}" /></td>
    <td><input type="text" name="notes" value="${g_escapeAttr(row.notes || "")}" /></td>
    <td class="ta-center">
      <label style="display:inline-flex;align-items:center;gap:.4rem">
        <input type="checkbox" name="approved" ${row.approved ? "checked" : ""} /> ✔
      </label>
    </td>
    <td class="ta-right">
      <button type="button" class="btn btn-primary" data-action="save">Salvar</button>
      <button type="button" class="btn" data-action="cancel">Cancelar</button>
    </td>
  `

  const saveBtn = tr.querySelector('[data-action="save"]')
  const cancelBtn = tr.querySelector('[data-action="cancel"]')

  cancelBtn?.addEventListener("click", () => {
    tr.replaceWith(g_createRow(row))
  })

  saveBtn?.addEventListener("click", async () => {
    const termSource = tr.querySelector('input[name="term_source"]').value.trim()
    const termTarget = tr.querySelector('input[name="term_target"]').value.trim()
    const game = tr.querySelector('input[name="game"]').value.trim()
    const mod = tr.querySelector('input[name="mod"]').value.trim()
    const notes = tr.querySelector('input[name="notes"]').value.trim()
    const approved = tr.querySelector('input[name="approved"]').checked

    if (!termSource || !termTarget) {
      alert("Preencha os campos EN e PT.")
      return
    }
    if (!game || !mod) {
      alert("Informe o game e o mod do item.")
      return
    }

    try {
      const updated = await g_fetchJSON(`/api/glossary/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term_source: termSource,
          term_target: termTarget,
          game,
          mod,
          notes: notes || null,
          approved: approved ? 1 : 0,
        }),
      })
      const merged = { ...row, ...updated }
      tr.replaceWith(g_createRow(merged))
    } catch (error) {
      console.error(error)
      alert("Não foi possível salvar a edição.")
    }
  })
}

async function g_deleteRow(id) {
  if (!id) return
  if (!confirm("Apagar este item do glossário?")) return
  try {
    await g_fetchJSON(`/api/glossary/${id}`, { method: "DELETE" })
    await g_loadGlossary(glossaryState.page)
  } catch (error) {
    console.error(error)
    alert("Não foi possível excluir o item.")
  }
}

async function g_loadGlossary(page = glossaryState.page) {
  const params = new URLSearchParams({
    limit: String(GLOSSARY_LIMIT),
    page: String(page),
  })

  if (glossaryState.search) params.set("q", glossaryState.search)
  const { game, mod } = g_getContext()
  if (game) params.set("game", game)
  if (mod) params.set("mod", mod)

  try {
    const data = await g_fetchJSON(`/api/glossary?${params}`)
    const items = Array.isArray(data) ? data : data.items || []
    const meta = Array.isArray(data)
      ? { page, total_pages: 1, total: items.length }
      : data.meta || {}
    g_updateInfo(meta)
    g_renderGlossary(items)
  } catch (error) {
    console.error(error)
    if (glossaryTableBody) {
      glossaryTableBody.innerHTML = `<tr><td colspan="7" class="error">Falha ao carregar o glossário.</td></tr>`
    }
  }
}

function g_handleSearchInput(value) {
  glossaryState.search = value.trim()
  glossaryState.page = 1
  g_loadGlossary(1)
}

function g_handlePager(direction) {
  if (direction === "prev" && glossaryState.page > 1) {
    g_loadGlossary(glossaryState.page - 1)
  } else if (
    direction === "next" &&
    glossaryState.page < glossaryState.totalPages
  ) {
    g_loadGlossary(glossaryState.page + 1)
  }
}

function g_mountGlossaryForm() {
  if (!glossaryForm) return
  glossaryForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    const fd = new FormData(glossaryForm)
    const termSource = (fd.get("term_source") || "").trim()
    const termTarget = (fd.get("term_target") || "").trim()
    const notes = (fd.get("notes") || "").trim()
    const { game, mod } = g_getContext()

    if (!termSource || !termTarget) {
      alert("Preencha os campos de termo EN/PT.")
      return
    }
    if (!game || !mod) {
      alert("Informe o jogo e o mod antes de adicionar ao glossário.")
      return
    }

    try {
      await g_fetchJSON("/api/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term_source: termSource,
          term_target: termTarget,
          notes: notes || null,
          game,
          mod,
          approved: 1,
        }),
      })
      glossaryForm.reset()
      await g_loadGlossary(1)
    } catch (error) {
      console.error(error)
      alert("Não foi possível adicionar o termo.")
    }
  })
}

function g_attachEvents() {
  if (glossaryEvents.initialized) return
  glossaryEvents.initialized = true

  let debounce = null
  glossarySearchInput?.addEventListener("input", () => {
    clearTimeout(debounce)
    debounce = setTimeout(
      () => g_handleSearchInput(glossarySearchInput.value),
      250
    )
  })

  glossaryPager?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-dir]")
    if (!button) return
    event.preventDefault()
    g_handlePager(button.dataset.dir)
  })

  window.addEventListener("contextchange", () => {
    glossaryState.page = 1
    g_loadGlossary(1)
  })
}

window.initGlossaryUI = function initGlossaryUI() {
  g_mountGlossaryForm()
  g_attachEvents()
  g_loadGlossary(1)
}

window.refreshGlossaryUI = function refreshGlossaryUI() {
  if (!glossaryEvents.initialized) return
  g_loadGlossary(glossaryState.page)
}
