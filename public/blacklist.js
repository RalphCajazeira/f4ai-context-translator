// ===== Blacklist UI =====
async function loadBlacklist() {
  try {
    const r = await fetch("/api/blacklist")
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const list = await r.json()

    const tbody = document.querySelector("#blacklistTable tbody")
    if (!tbody) return
    tbody.innerHTML = ""

    for (const row of list) {
      const tr = document.createElement("tr")
      tr.innerHTML = `
        <td class="mono">${row.term}</td>
        <td class="muted">${row.notes || ""}</td>
        <td class="ta-right">
          <button class="btn btn-danger" data-id="${row.id}">Remover</button>
        </td>
      `
      tbody.appendChild(tr)
    }

    // delete handlers
    tbody.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id")
        if (!confirm("Remover este termo da lista negra?")) return
        try {
          const r = await fetch(`/api/blacklist/${id}`, { method: "DELETE" })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          await loadBlacklist()
        } catch (e) {
          console.error(e)
          alert("Não foi possível remover.")
        }
      })
    })
  } catch (e) {
    console.error(e)
  }
}

function mountBlacklistForm() {
  const form = document.querySelector("#blackForm")
  if (!form) return
  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const term = (fd.get("term") || "").trim()
    const notes = (fd.get("notes") || "").trim()
    if (!term) {
      alert("Informe um termo.")
      return
    }
    try {
      const r = await fetch("/api/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, notes }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      form.reset()
      await loadBlacklist()
    } catch (e) {
      console.error(e)
      alert("Não foi possível adicionar.")
    }
  })
}

// Chame essas duas na sua função init()
window.initBlacklistUI = function () {
  mountBlacklistForm()
  loadBlacklist()
}
