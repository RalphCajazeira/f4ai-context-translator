const blacklistTableBody = document.querySelector("#blacklistTable tbody")
const blacklistSearchInput = document.querySelector("#blacklistSearch")
const blacklistInfo = document.querySelector("#blacklistInfo")
const blacklistPager = document.querySelector("#blacklistPager")
const blacklistForm = document.querySelector("#blackForm")
const blacklistGameInput = document.querySelector("#gameName")
const blacklistModInput = document.querySelector("#modName")

const BLACKLIST_LIMIT = 50

const blacklistCollator = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  ignorePunctuation: true,
  numeric: true,
})

const blacklistState = {
  page: 1,
  totalPages: 1,
  total: 0,
  search: "",
}

const blacklistEvents = { initialized: false }

function b_escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function b_escapeAttr(value) {
  return String(value ?? "").replaceAll('"', "&quot;")
}

async function b_fetchJSON(url, opts) {
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

function b_getContext() {
  return {
    game: (blacklistGameInput?.value || "").trim(),
    mod: (blacklistModInput?.value || "").trim(),
  }
}

function b_updateInfo(meta = {}) {
  const pageValue = Number(meta.page)
  if (!Number.isNaN(pageValue) && pageValue > 0) {
    blacklistState.page = pageValue
  }

  const totalPagesValue = Number(meta.total_pages)
  if (!Number.isNaN(totalPagesValue) && totalPagesValue > 0) {
    blacklistState.totalPages = Math.max(1, totalPagesValue)
  }

  const totalValue = Number(meta.total)
  if (!Number.isNaN(totalValue) && totalValue >= 0) {
    blacklistState.total = totalValue
  }

  if (blacklistInfo) {
    blacklistInfo.textContent = `${blacklistState.total} itens • pág. ${blacklistState.page} de ${blacklistState.totalPages}`
  }

  if (blacklistPager) {
    const prev = blacklistPager.querySelector('[data-dir="prev"]')
    const next = blacklistPager.querySelector('[data-dir="next"]')
    if (prev) prev.disabled = blacklistState.page <= 1
    if (next) next.disabled = blacklistState.page >= blacklistState.totalPages
  }
}

function b_renderEmptyRow() {
  if (!blacklistTableBody) return
  const tr = document.createElement("tr")
  const td = document.createElement("td")
  td.colSpan = 5
  td.className = "muted"
  td.textContent = "Nenhum item na lista negra."
  tr.appendChild(td)
  blacklistTableBody.appendChild(tr)
}

function b_renderTable(items = []) {
  if (!blacklistTableBody) return
  blacklistTableBody.innerHTML = ""
  if (!items.length) {
    b_renderEmptyRow()
    return
  }

  for (const row of items) {
    blacklistTableBody.appendChild(b_createRow(row))
  }
}

function b_createRow(row) {
  const tr = document.createElement("tr")
  tr.dataset.id = row.id
  tr.innerHTML = `
    <td class="mono">${b_escapeHtml(row.term)}</td>
    <td>${b_escapeHtml(row.game || "")}</td>
    <td>${b_escapeHtml(row.mod || "")}</td>
    <td>${b_escapeHtml(row.notes || "")}</td>
    <td class="ta-right">
      <button type="button" class="btn btn-secondary" data-action="edit">Editar</button>
      <button type="button" class="btn btn-danger" data-action="delete">Excluir</button>
    </td>
  `

  tr.querySelector('[data-action="edit"]')?.addEventListener("click", () =>
    b_enterEditRow(tr, row)
  )
  tr.querySelector('[data-action="delete"]')?.addEventListener("click", () =>
    b_deleteRow(row.id)
  )

  return tr
}

function b_enterEditRow(tr, row) {
  const id = row.id
  tr.innerHTML = `
    <td><input type="text" name="term" value="${b_escapeAttr(row.term)}" /></td>
    <td><input type="text" name="game" value="${b_escapeAttr(
      row.game || ""
    )}" /></td>
    <td><input type="text" name="mod" value="${b_escapeAttr(
      row.mod || ""
    )}" /></td>
    <td><input type="text" name="notes" value="${b_escapeAttr(
      row.notes || ""
    )}" /></td>
    <td class="ta-right">
      <button type="button" class="btn btn-primary" data-action="save">Salvar</button>
      <button type="button" class="btn" data-action="cancel">Cancelar</button>
    </td>
  `

  const saveBtn = tr.querySelector('[data-action="save"]')
  const cancelBtn = tr.querySelector('[data-action="cancel"]')

  cancelBtn?.addEventListener("click", () => {
    tr.replaceWith(b_createRow(row))
  })

  saveBtn?.addEventListener("click", async () => {
    const term = tr.querySelector('input[name="term"]').value.trim()
    const game = tr.querySelector('input[name="game"]').value.trim()
    const mod = tr.querySelector('input[name="mod"]').value.trim()
    const notes = tr.querySelector('input[name="notes"]').value.trim()

    if (!term) {
      alert("Informe o termo.")
      return
    }
    if (!game || !mod) {
      alert("Informe o game e o mod do termo.")
      return
    }

    try {
      const updated = await b_fetchJSON(`/api/blacklist/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, game, mod, notes: notes || null }),
      })
      tr.replaceWith(b_createRow(updated))
    } catch (error) {
      console.error(error)
      alert("Não foi possível salvar a edição.")
    }
  })
}

async function b_deleteRow(id) {
  if (!id) return
  if (!confirm("Remover este termo da lista negra?")) return
  try {
    await b_fetchJSON(`/api/blacklist/${id}`, { method: "DELETE" })
    await b_loadBlacklist(blacklistState.page)
  } catch (error) {
    console.error(error)
    alert("Não foi possível remover o termo.")
  }
}

async function b_loadBlacklist(page = blacklistState.page) {
  const params = new URLSearchParams({
    limit: String(BLACKLIST_LIMIT),
    page: String(page),
  })
  if (blacklistState.search) params.set("q", blacklistState.search)
  const { game, mod } = b_getContext()
  if (game) params.set("game", game)
  if (mod) params.set("mod", mod)

  try {
    const data = await b_fetchJSON(`/api/blacklist?${params}`)
    const items = Array.isArray(data) ? data : data.items || []

    items.sort((a, b) =>
      blacklistCollator.compare(a?.term ?? "", b?.term ?? "")
    )
    const meta = Array.isArray(data)
      ? { page, total_pages: 1, total: items.length }
      : data.meta || {}
    b_updateInfo(meta)
    b_renderTable(items)
  } catch (error) {
    console.error(error)
    if (blacklistTableBody) {
      blacklistTableBody.innerHTML = `<tr><td colspan="5" class="error">Falha ao carregar a lista negra.</td></tr>`
    }
  }
}

function b_handleSearch(value) {
  blacklistState.search = value.trim()
  blacklistState.page = 1
  b_loadBlacklist(1)
}

function b_handlePager(direction) {
  if (direction === "prev" && blacklistState.page > 1) {
    b_loadBlacklist(blacklistState.page - 1)
  } else if (
    direction === "next" &&
    blacklistState.page < blacklistState.totalPages
  ) {
    b_loadBlacklist(blacklistState.page + 1)
  }
}

function b_mountForm() {
  if (!blacklistForm) return
  blacklistForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    const fd = new FormData(blacklistForm)
    const term = (fd.get("term") || "").trim()
    const notes = (fd.get("notes") || "").trim()
    const { game, mod } = b_getContext()

    if (!term) {
      alert("Informe um termo.")
      return
    }
    if (!game || !mod) {
      alert("Informe o jogo e o mod antes de adicionar.")
      return
    }

    try {
      await b_fetchJSON("/api/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, notes: notes || null, game, mod }),
      })
      blacklistForm.reset()
      await b_loadBlacklist(1)
    } catch (error) {
      console.error(error)
      alert("Não foi possível adicionar o termo.")
    }
  })
}

function b_attachEvents() {
  if (blacklistEvents.initialized) return
  blacklistEvents.initialized = true

  let debounce = null
  blacklistSearchInput?.addEventListener("input", () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => b_handleSearch(blacklistSearchInput.value), 250)
  })

  blacklistPager?.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-dir]")
    if (!btn) return
    event.preventDefault()
    b_handlePager(btn.dataset.dir)
  })

  window.addEventListener("contextchange", () => {
    blacklistState.page = 1
    b_loadBlacklist(1)
  })
}

window.initBlacklistUI = function initBlacklistUI() {
  b_mountForm()
  b_attachEvents()
  b_loadBlacklist(1)
}

window.refreshBlacklistUI = function refreshBlacklistUI() {
  if (!blacklistEvents.initialized) return
  b_loadBlacklist(blacklistState.page)
}
