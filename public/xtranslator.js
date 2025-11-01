;(function () {
  const pendingList = document.getElementById("xtLogPending")
  const approvedList = document.getElementById("xtLogApproved")
  const pendingInfo = document.getElementById("xtLogPendingInfo")
  const approvedInfo = document.getElementById("xtLogApprovedInfo")
  const pendingPager = document.getElementById("xtLogPendingPager")
  const approvedPager = document.getElementById("xtLogApprovedPager")
  const pendingSearch = document.getElementById("xtLogPendingSearch")
  const approvedSearch = document.getElementById("xtLogApprovedSearch")
  const tabButtons = Array.from(document.querySelectorAll(".xt-tab-btn"))
  const tabPanels = Array.from(document.querySelectorAll(".xt-tab-panel"))

  const requestList = document.getElementById("xtRequestList")
  const requestInfo = document.getElementById("xtRequestInfo")
  const requestSearch = document.getElementById("xtRequestSearch")
  const requestRefreshBtn = document.getElementById("xtRequestRefresh")

  const state = {
    pending: { page: 1, totalPages: 1, total: 0, search: "" },
    approved: { page: 1, totalPages: 1, total: 0, search: "" },
    requests: { items: [], filtered: [], search: "" },
    activeTab: "pending",
  }

  const debounceTimers = { pending: null, approved: null, requests: null }

  function getContext() {
    const game = document.querySelector("#gameName")?.value?.trim() || ""
    const mod = document.querySelector("#modName")?.value?.trim() || ""
    return { game, mod }
  }

  async function fetchJson(url, options) {
    if (typeof window.fetchJSON === "function") {
      return window.fetchJSON(url, options)
    }
    const res = await fetch(url, options)
    if (!res.ok) {
      const message = await res.text()
      throw new Error(message || `HTTP ${res.status}`)
    }
    return res.json()
  }

  function notify(message, variant = "info") {
    if (typeof window.showStatus === "function") {
      window.showStatus(message, variant)
    } else if (message) {
      console[variant === "error" ? "error" : "log"](message)
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (m) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    )
  }

  function updateMeta(kind, meta = {}) {
    const target = state[kind]
    if (!target) return
    const page = Number(meta.page)
    const totalPages = Number(meta.total_pages)
    const total = Number(meta.total)

    if (!Number.isNaN(page) && page > 0) target.page = page
    if (!Number.isNaN(totalPages) && totalPages > 0) {
      target.totalPages = Math.max(1, totalPages)
    }
    if (!Number.isNaN(total) && total >= 0) target.total = total

    const infoEl = kind === "pending" ? pendingInfo : approvedInfo
    if (infoEl) {
      infoEl.textContent = `${target.total} itens • pág. ${target.page} de ${target.totalPages}`
    }

    const pager = kind === "pending" ? pendingPager : approvedPager
    if (pager) {
      const prev = pager.querySelector('[data-dir="prev"]')
      const next = pager.querySelector('[data-dir="next"]')
      if (prev) prev.disabled = target.page <= 1
      if (next) next.disabled = target.page >= target.totalPages
    }
  }

  function updateRequestInfo() {
    if (!requestInfo) return
    const total = state.requests.filtered.length
    requestInfo.textContent = `${total} itens`
  }

  function renderRequestList() {
    if (!requestList) return
    requestList.innerHTML = ""
    const items = state.requests.filtered
    if (!items.length) {
      requestList.setAttribute("data-empty", "1")
      return
    }
    requestList.removeAttribute("data-empty")

    for (const row of items) {
      const li = document.createElement("li")
      li.className = "request-item"
      li.dataset.id = row.id
      li.innerHTML = `
        <div class="meta">
          <span class="line">#${row.id} • ${escapeHtml(row.model || "-")} • ${
        row.created_at || ""
      }</span>
          <span class="line tags">
            <span class="tag">Itens: ${row.item_count ?? 0}</span>
            <span class="tag">Status: ${escapeHtml(row.status || "-")}</span>
          </span>
        </div>
        <div class="body">
          <strong>Prompt</strong>
          <p>${escapeHtml(row.prompt || "—")}</p>
        </div>
      `

      const sourceDetails = document.createElement("details")
      sourceDetails.innerHTML = `
        <summary>Ver texto original</summary>
        <pre>${escapeHtml(row.raw_source || "")}</pre>
      `
      li.appendChild(sourceDetails)

      const targetDetails = document.createElement("details")
      targetDetails.innerHTML = `
        <summary>Ver tradução gerada</summary>
        <pre>${escapeHtml(row.raw_response || "")}</pre>
      `
      li.appendChild(targetDetails)

      requestList.appendChild(li)
    }
  }

  function activateTab(tab, options = {}) {
    if (!tabButtons.length || !tabPanels.length) return Promise.resolve()
    const normalized = tab === "approved" ? "approved" : "pending"
    const changed = state.activeTab !== normalized
    state.activeTab = normalized

    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.xtTab === normalized
      btn.classList.toggle("active", isActive)
      btn.setAttribute("aria-selected", isActive ? "true" : "false")
    })

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.xtPanel === normalized
      panel.classList.toggle("active", isActive)
      if (isActive) {
        panel.removeAttribute("hidden")
      } else {
        panel.setAttribute("hidden", "true")
      }
    })

    if (changed || options.force) {
      return normalized === "approved"
        ? fetchApprovedItems()
        : fetchPendingItems()
    }

    return Promise.resolve()
  }

  async function fetchPendingItems(page = state.pending.page) {
    state.pending.page = page
    const params = new URLSearchParams({
      status: "pending",
      origin: "xtranslator",
      limit: "50",
      page: String(page),
    })
    if (state.pending.search) params.set("q", state.pending.search)
    const { game, mod } = getContext()
    if (game) params.set("game", game)
    if (mod) params.set("mod", mod)

    try {
      const data = await fetchJson(`/api/logs?${params.toString()}`)
      const items = Array.isArray(data) ? data : data.items || []
      const meta = Array.isArray(data)
        ? { page, total_pages: 1, total: items.length, per_page: items.length }
        : data.meta || {}
      updateMeta("pending", meta)
      renderPendingList(items)
    } catch (error) {
      notify("Falha ao carregar itens pendentes.", "error")
      console.error(error)
    }
  }

  async function fetchApprovedItems(page = state.approved.page) {
    state.approved.page = page
    const params = new URLSearchParams({
      status: "approved",
      origin: "xtranslator",
      limit: "50",
      page: String(page),
    })
    if (state.approved.search) params.set("q", state.approved.search)
    const { game, mod } = getContext()
    if (game) params.set("game", game)
    if (mod) params.set("mod", mod)

    try {
      const data = await fetchJson(`/api/logs?${params.toString()}`)
      const items = Array.isArray(data) ? data : data.items || []
      const meta = Array.isArray(data)
        ? { page, total_pages: 1, total: items.length, per_page: items.length }
        : data.meta || {}
      updateMeta("approved", meta)
      renderApprovedList(items)
    } catch (error) {
      notify("Falha ao carregar itens aprovados.", "error")
      console.error(error)
    }
  }

  async function fetchRequests() {
    try {
      const data = await fetchJson("/api/xtranslator/requests?limit=100")
      const items = Array.isArray(data?.items) ? data.items : []
      state.requests.items = items
      applyRequestFilter()
    } catch (error) {
      notify("Não foi possível carregar o histórico de requisições.", "error")
      console.error(error)
    }
  }

  function applyRequestFilter() {
    const term = state.requests.search.toLowerCase()
    if (!term) {
      state.requests.filtered = [...state.requests.items]
    } else {
      state.requests.filtered = state.requests.items.filter((row) => {
        const haystack = [
          row.prompt || "",
          row.raw_source || "",
          row.raw_response || "",
          row.model || "",
        ]
          .join(" ")
          .toLowerCase()
        return haystack.includes(term)
      })
    }
    updateRequestInfo()
    renderRequestList()
  }

  function renderPendingList(rows = []) {
    if (!pendingList) return
    pendingList.innerHTML = ""
    const items = Array.isArray(rows) ? rows : []
    if (!items.length) {
      pendingList.setAttribute("data-empty", "1")
      return
    }
    pendingList.removeAttribute("data-empty")

    for (const row of items) {
      const li = document.createElement("li")
      li.className = "log-item"
      li.dataset.id = row.id
      li.innerHTML = `
        <div class="meta">
          <span class="line">#${row.id} • ${escapeHtml(row.origin || "xtranslator")} • ${
        row.created_at || ""
      }</span>
          <span class="line tags">
            <span class="tag tag-game">🎮 ${escapeHtml(row.game || "—")}</span>
            <span class="tag tag-mod">🧩 ${escapeHtml(row.mod || "—")}</span>
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
        </div>
      `

      const srcTA = li.querySelector(".src")
      const tgtTA = li.querySelector(".tgt")
      srcTA.value = row.source_text || ""
      tgtTA.value = row.target_text || ""

      li.querySelector(".save").addEventListener("click", async () => {
        try {
          const { game, mod } = getContext()
          const payloadGame = game || row.game
          const payloadMod = mod || row.mod
          await fetchJson(`/api/logs/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_text: srcTA.value,
              target_text: tgtTA.value,
              game: payloadGame,
              mod: payloadMod,
            }),
          })
          row.game = payloadGame
          row.mod = payloadMod
          const gameTag = li.querySelector(".tag-game")
          const modTag = li.querySelector(".tag-mod")
          if (gameTag) gameTag.textContent = `🎮 ${payloadGame || "—"}`
          if (modTag) modTag.textContent = `🧩 ${payloadMod || "—"}`
          notify("Tradução pendente atualizada.", "success")
        } catch (error) {
          notify("Não foi possível salvar a alteração.", "error")
          console.error(error)
        }
      })

      li.querySelector(".approve").addEventListener("click", async () => {
        try {
          const { game, mod } = getContext()
          const payloadGame = game || row.game
          const payloadMod = mod || row.mod
          await fetchJson(`/api/logs/${row.id}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_text: srcTA.value,
              target_text: tgtTA.value,
              game: payloadGame,
              mod: payloadMod,
            }),
          })
          row.game = payloadGame
          row.mod = payloadMod
          notify("Item aprovado e enviado para a TM.", "success")
          await fetchPendingItems()
          await fetchApprovedItems()
        } catch (error) {
          notify("Não foi possível aprovar este item.", "error")
          console.error(error)
        }
      })

      li.querySelector(".reject").addEventListener("click", async () => {
        try {
          await fetchJson(`/api/logs/${row.id}/reject`, { method: "POST" })
          notify("Item rejeitado.", "warning")
          await fetchPendingItems()
        } catch (error) {
          notify("Não foi possível rejeitar este item.", "error")
          console.error(error)
        }
      })

      li.querySelector(".copy").addEventListener("click", () => {
        const source = document.querySelector("#source")
        if (source) source.value = srcTA.value
        const editor = document.getElementById("editor")
        if (editor) {
          if (typeof window.setPlainText === "function") {
            window.setPlainText(tgtTA.value)
          } else {
            editor.textContent = tgtTA.value
          }
        }
        notify("Par copiado para o editor principal.", "info")
      })

      pendingList.appendChild(li)
    }
  }

  function renderApprovedList(rows = []) {
    if (!approvedList) return
    approvedList.innerHTML = ""
    const items = Array.isArray(rows) ? rows : []
    if (!items.length) {
      approvedList.setAttribute("data-empty", "1")
      return
    }
    approvedList.removeAttribute("data-empty")

    for (const row of items) {
      const li = document.createElement("li")
      li.className = "log-item"
      li.dataset.id = row.id
      li.innerHTML = `
        <div class="meta">
          <span class="line">#${row.id} • ${escapeHtml(row.origin || "xtranslator")} • ${
        row.updated_at || row.created_at || ""
      }</span>
          <span class="line tags">
            <span class="tag tag-game">🎮 ${escapeHtml(row.game || "—")}</span>
            <span class="tag tag-mod">🧩 ${escapeHtml(row.mod || "—")}</span>
          </span>
        </div>
        <div><b>Original</b></div>
        <textarea class="src" readonly spellcheck="false"></textarea>
        <div><b>Tradução</b></div>
        <textarea class="tgt" readonly spellcheck="false"></textarea>
      `
      li.querySelector(".src").value = row.source_text || ""
      li.querySelector(".tgt").value = row.target_text || ""
      approvedList.appendChild(li)
    }
  }

  function handlePager(kind, direction) {
    const target = state[kind]
    if (!target) return
    if (direction === "prev" && target.page > 1) {
      const next = target.page - 1
      if (kind === "pending") fetchPendingItems(next)
      else fetchApprovedItems(next)
    }
    if (direction === "next" && target.page < target.totalPages) {
      const next = target.page + 1
      if (kind === "pending") fetchPendingItems(next)
      else fetchApprovedItems(next)
    }
  }

  function initEvents() {
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.xtTab
        if (!target) return
        activateTab(target)
      })
    })

    pendingPager?.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-dir]")
      if (!btn) return
      event.preventDefault()
      handlePager("pending", btn.dataset.dir)
    })

    approvedPager?.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-dir]")
      if (!btn) return
      event.preventDefault()
      handlePager("approved", btn.dataset.dir)
    })

    pendingSearch?.addEventListener("input", () => {
      clearTimeout(debounceTimers.pending)
      debounceTimers.pending = setTimeout(() => {
        state.pending.search = pendingSearch.value.trim()
        state.pending.page = 1
        fetchPendingItems(1)
      }, 250)
    })

    approvedSearch?.addEventListener("input", () => {
      clearTimeout(debounceTimers.approved)
      debounceTimers.approved = setTimeout(() => {
        state.approved.search = approvedSearch.value.trim()
        state.approved.page = 1
        fetchApprovedItems(1)
      }, 250)
    })

    requestSearch?.addEventListener("input", () => {
      clearTimeout(debounceTimers.requests)
      debounceTimers.requests = setTimeout(() => {
        state.requests.search = requestSearch.value.trim()
        applyRequestFilter()
      }, 200)
    })

    requestRefreshBtn?.addEventListener("click", () => {
      fetchRequests()
    })

    window.addEventListener("contextchange", () => {
      state.pending.page = 1
      state.approved.page = 1
      fetchPendingItems(1)
      fetchApprovedItems(1)
    })
  }

  async function bootstrap() {
    initEvents()
    const tasks = [activateTab(state.activeTab, { force: true }), fetchRequests()]
    if (state.activeTab === "approved") {
      tasks.push(fetchPendingItems())
    } else {
      tasks.push(fetchApprovedItems())
    }
    await Promise.all(tasks)
  }

  window.initXTranslatorUI = bootstrap
})()
