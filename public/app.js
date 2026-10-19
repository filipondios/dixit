(() => {
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const zoom = document.getElementById("zoom");
  const ID_RE = /^[a-z0-9]{4,16}$/;
  const newId = () => Math.random().toString(16).slice(2, 9).padEnd(7, "0");

  // La partida se identifica por la etiqueta de la URL: https://host/#4e3242a
  let room = location.hash.slice(1).toLowerCase();
  if (!ID_RE.test(room)) {
    room = newId();
    history.replaceState(null, "", "#" + room);
  }
  window.addEventListener("hashchange", () => location.reload());

  const KEY = "dixit:" + room;
  let ws, pingTimer, selected = null, lastHtml = "", lastKey = "", lastTurn = false, retry = 0, toastTimer;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => {
      retry = 0;
      send({ type: "hello", room, token: localStorage.getItem(KEY) || "" });
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ type: "ping" }), 25000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "view") patch(m.html);
      else if (m.type === "token") localStorage.setItem(KEY, m.token);
      else if (m.type === "error") toast(m.msg);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      toast("Reconectando…");
      setTimeout(connect, Math.min(1000 * ++retry, 5000));
    };
  }

  function patch(htmlStr) {
    if (htmlStr === lastHtml) return;
    lastHtml = htmlStr;
    const clueEl = document.getElementById("clue");
    const keep = clueEl ? { v: clueEl.value, focus: document.activeElement === clueEl } : null;
    const nameEl = document.getElementById("name");
    const keepName = nameEl ? { v: nameEl.value, focus: document.activeElement === nameEl } : null;
    const scrollY = window.scrollY;

    app.innerHTML = htmlStr;

    const screen = app.querySelector(".screen");
    const key = screen ? screen.dataset.key : "";
    if (key !== lastKey) { selected = null; lastKey = key; }
    else {
      const c1 = document.getElementById("clue");
      if (keep && c1) { c1.value = keep.v; if (keep.focus) c1.focus(); }
      const n1 = document.getElementById("name");
      if (keepName && n1) { n1.value = keepName.v; if (keepName.focus) n1.focus(); }
      window.scrollTo(0, scrollY);
    }
    markSelection();

    const turn = !!screen && screen.dataset.turn === "1";
    if (turn && !lastTurn && navigator.vibrate) navigator.vibrate(200);
    lastTurn = turn;
    document.title = turn ? "🔔 Tu turno · Dixit" : "Dixit";
  }

  function markSelection() {
    app.querySelectorAll(".cards.selectable .card.selected").forEach((c) => c.classList.remove("selected"));
    if (selected !== null) {
      const el = app.querySelector(`.cards.selectable .card[data-card="${selected}"]:not(.disabled)`);
      if (el) el.classList.add("selected");
      else selected = null;
    }
    updateConfirm();
  }

  function updateConfirm() {
    app.querySelectorAll("button[data-confirm]").forEach((b) => {
      const needsCard = b.hasAttribute("data-needs-card");
      const inputs = (b.dataset.inputs || "").split(",").filter(Boolean);
      const ok = (!needsCard || selected !== null) &&
        inputs.every((id) => { const el = document.getElementById(id); return el && el.value.trim(); });
      b.disabled = !ok;
    });
  }

  async function share() {
    const url = location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Dixit", text: "Únete a mi partida de Dixit", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("Enlace copiado");
    } catch (e) {
      if (e && e.name !== "AbortError") prompt("Copia el enlace:", url);
    }
  }

  app.addEventListener("click", (e) => {
    const z = e.target.closest("[data-zoom]");
    if (z) { zoom.querySelector("img").src = z.dataset.zoom; zoom.hidden = false; return; }

    const card = e.target.closest(".cards.selectable .card:not(.disabled)");
    if (card) { selected = Number(card.dataset.card); markSelection(); return; }

    if (e.target.closest("[data-share]")) return share();
    if (e.target.closest("[data-newroom]")) {
      if (confirm("¿Crear una partida nueva con otro código? La actual seguirá disponible en su enlace.")) {
        location.hash = newId();
      }
      return;
    }

    const a = e.target.closest("[data-act]");
    if (a && a.tagName === "BUTTON" && !a.disabled) {
      const m = { type: "act", action: a.dataset.act };
      if (a.dataset.value !== undefined) m.value = a.dataset.value;
      if (a.hasAttribute("data-needs-card")) m.card = selected;
      (a.dataset.inputs || "").split(",").filter(Boolean).forEach((id) => (m[id] = document.getElementById(id).value));
      send(m);
    }
  });

  app.addEventListener("change", (e) => {
    const s = e.target.closest("select[data-act]");
    if (s) send({ type: "act", action: s.dataset.act, value: s.value });
  });
  app.addEventListener("input", updateConfirm);
  app.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "name") {
      const b = app.querySelector("button[data-confirm]:not([disabled])");
      if (b) b.click();
    }
  });
  zoom.addEventListener("click", () => (zoom.hidden = true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (!ws || ws.readyState > 1)) connect();
  });

  connect();
})();