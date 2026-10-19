import { type Player, type Room, MAX_PLAYERS, MIN_PLAYERS, TARGETS } from "./game";

class Raw { constructor(readonly s: string) {} }
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function r(v: unknown): string {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(r).join("");
  if (v == null || v === false) return "";
  return esc(String(v));
}
const html = (s: TemplateStringsArray, ...v: unknown[]) =>
  new Raw(s.reduce((o, x, i) => o + x + (i < v.length ? r(v[i]) : ""), ""));

const fmt = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

// ---------- componentes ----------
function tile(id: number, o: { badge?: string; cls?: string } = {}) {
  return html`<div class="card ${o.cls ?? ""}" data-card="${id}">
    <img src="/card/${id}" alt="Carta" loading="lazy" draggable="false">
    <button type="button" class="zoom" data-zoom="/card/${id}" aria-label="Ampliar carta">⤢</button>
    ${o.badge ? html`<span class="badge">${o.badge}</span>` : ""}
  </div>`;
}

const grid = (items: Raw[], selectable = false) =>
  html`<div class="cards ${selectable ? "selectable" : ""}">${items}</div>`;

function waiting(room: Room, ids: string[], prefix = "Esperando a") {
  const names = room.players.filter((p) => ids.includes(p.id)).map((p) => p.name + (p.connected ? "" : " (sin conexión)"));
  return names.length ? html`<p class="wait">${prefix} <strong>${fmt.format(names)}</strong>…</p>` : "";
}

function scoreboard(room: Room, me: Player | null, showDelta: boolean) {
  const st = room.players[room.storyteller];
  const sorted = [...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let pos = 0, prev = -1;
  return html`<ol class="score">${sorted.map((p, i) => {
    if (p.score !== prev) pos = i + 1;
    prev = p.score;
    const d = room.delta[p.id] ?? 0;
    return html`<li class="${p.id === me?.id ? "me" : ""}">
      <span class="pos">${pos}</span>
      <span class="nm">${p.name}${room.phase !== "lobby" && st && p.id === st.id && room.phase !== "finished" ? " 🎙" : ""}
        ${showDelta ? html`<small>${(room.breakdown[p.id] ?? []).join(" · ")}</small>` : ""}</span>
      ${showDelta ? html`<span class="delta ${d > 0 ? "up" : ""}">+${d}</span>` : ""}
      <span class="pts">${p.score}</span>
    </li>`;
  })}</ol>`;
}

const header = (room: Room) => html`<header class="top">
  <div class="rid">Dixit <b>#${room.id}</b></div>
  <div class="tools">
    <button type="button" data-share>🔗 Compartir</button>
    <button type="button" class="ghost" data-newroom>＋ Nueva</button>
  </div>
</header>`;

function banner(room: Room) {
  const st = room.players[room.storyteller];
  return html`<div class="banner"><span>Ronda ${room.round}</span><span>🎙 ${st.name}</span><span>Meta ${room.target}</span></div>`;
}

function clueBox(room: Room) {
  const st = room.players[room.storyteller];
  return html`<div class="clue"><small>Tema de ${st.name}</small><p>“${room.clue}”</p></div>`;
}

const confirmBar = (label: string, act: string, extra = "") =>
  html`<div class="bar"><button class="primary" data-act="${act}" data-confirm ${new Raw(extra)} disabled>${label}</button></div>`;

// ---------- vistas por fase ----------
function joinView(room: Room) {
  const gone = room.players.filter((p) => !p.connected);
  if (room.phase === "lobby") {
    return html`<section class="card-box">
      <h1>Únete a una partida!</h1>
      <p class="hint">${room.players.length ? `Ya están: ${fmt.format(room.players.map((p) => p.name))}` : "Serás la anfitriona y la primera en entrar."}</p>
      <input id="name" type="text" maxlength="20" placeholder="Tu nombre" autocomplete="off" autocapitalize="words">
      <button class="primary" data-act="join" data-confirm data-inputs="name" disabled>Entrar</button>
    </section>`;
  }
  return html`<section class="card-box">
    <h1>Partida en curso</h1>
    <p class="hint">Si ya estabas jugando (cambio de móvil o navegador), elige quién eras:</p>
    ${gone.length
      ? gone.map((p) => html`<button class="primary alt" data-act="claim" data-value="${p.id}">Soy ${p.name}</button>`)
      : html`<p class="wait">Todos los jugadores están conectados ahora mismo.</p>`}
  </section>`;
}

function takeHost(room: Room, me: Player) {
  const host = room.players.find((p) => p.id === room.hostId);
  if (host && !host.connected && host.id !== me.id)
    return html`<button class="ghost wide" data-act="takehost">${host.name} no está conectado: ser anfitrión</button>`;
  return "";
}

function lobbyView(room: Room, me: Player) {
  const host = me.id === room.hostId;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? "";
  return html`<section class="card-box">
    <h1>Sala de espera</h1>
    <p class="hint">Pulsa <b>Compartir</b> arriba para invitar a más gente (${room.players.length}/${MAX_PLAYERS}).</p>
    <ul class="plist">${room.players.map((p) => html`<li>
      <span class="dot ${p.connected ? "on" : ""}"></span>${p.name}${p.id === room.hostId ? " 👑" : ""}${p.id === me.id ? " (tú)" : ""}
      ${host && p.id !== me.id ? html`<button class="x" data-act="kick" data-value="${p.id}" aria-label="Expulsar ${p.name}">✕</button>` : ""}
    </li>`)}</ul>
    ${host
      ? html`<label class="field">Puntos para ganar
          <select data-act="target">${TARGETS.map((t) => html`<option value="${t}" ${t === room.target ? "selected" : ""}>${t}</option>`)}</select></label>
        <button class="primary" data-act="start" ${room.players.length < MIN_PLAYERS ? "disabled" : ""}>
          ${room.players.length < MIN_PLAYERS ? `Faltan ${MIN_PLAYERS - room.players.length} jugador(es)` : "Empezar partida"}</button>`
      : html`<p class="wait">Esperando a que <strong>${hostName}</strong> empiece la partida (meta: ${room.target} puntos)…</p>`}
    ${takeHost(room, me)}
  </section>`;
}

function storyView(room: Room, me: Player) {
  const st = room.players[room.storyteller];
  if (me.id === st.id) {
    return html`${banner(room)}
      <section class="card-box tight">
        <h2>Eres el narrador</h2>
        <p class="hint">Elige una carta, escribe tu tema y confirma.</p>
        <textarea id="clue" rows="2" maxlength="140" placeholder="Pon aquí tu pista: una palabra, frase..."></textarea>
      </section>
      ${grid(me.hand.map((c) => tile(c)), true)}
      ${confirmBar("Confirmar carta y tema", "story", 'data-needs-card data-inputs="clue"')}`;
  }
  return html`${banner(room)}
    <section class="card-box tight"><h2>${st.name} está eligiendo carta y tema</h2>${waiting(room, [st.id])}</section>
    <p class="hint c">Tu mano</p>${grid(me.hand.map((c) => tile(c)))}`;
}

function chooseView(room: Room, me: Player) {
  const st = room.players[room.storyteller];
  const pending = room.players.filter((p) => room.played[p.id] === undefined).map((p) => p.id);
  if (me.id !== st.id && room.played[me.id] === undefined) {
    return html`${banner(room)}${clueBox(room)}
      <p class="hint c">Elige la carta de tu mano que mejor encaje con el tema</p>
      ${grid(me.hand.map((c) => tile(c)), true)}
      ${confirmBar("Confirmar carta", "play", "data-needs-card")}`;
  }
  const mine = room.played[me.id];
  return html`${banner(room)}${clueBox(room)}
    <section class="card-box tight">
      <h2>${me.id === st.id ? "Tu carta" : "Carta enviada ✓"}</h2>
      ${grid([tile(mine, { cls: "story" })])}
      ${waiting(room, pending)}
    </section>`;
}

function voteView(room: Room, me: Player) {
  const st = room.players[room.storyteller];
  const canVote = me.id !== st.id && room.votes[me.id] === undefined;
  const pending = room.players.filter((p) => p.id !== st.id && room.votes[p.id] === undefined).map((p) => p.id);
  const items = room.board.map((b) => {
    if (b.owner === me.id) return tile(b.card, { cls: "own disabled", badge: me.id === st.id ? "Tu carta" : "Tuya" });
    if (room.votes[me.id] === b.card) return tile(b.card, { cls: "voted", badge: "Tu voto" });
    return tile(b.card);
  });
  return html`${banner(room)}${clueBox(room)}
    ${canVote
      ? html`<p class="hint c">¿Cuál es la carta de ${st.name}?</p>`
      : html`<section class="card-box tight">${me.id === st.id ? html`<h2>Los demás están votando</h2>` : html`<h2>Voto enviado ✓</h2>`}${waiting(room, pending, "Esperando el voto de")}</section>`}
    ${grid(items, canVote)}
    ${canVote ? confirmBar("Confirmar voto", "vote", "data-needs-card") : ""}`;
}

function resultsView(room: Room, me: Player) {
  const st = room.players[room.storyteller];
  const won = room.players.some((p) => p.score >= room.target);
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? "?";
  const pending = room.players.filter((p) => !p.ready).map((p) => p.id);
  const host = me.id === room.hostId;
  return html`${banner(room)}${clueBox(room)}
    <h2 class="c">Resultado</h2>
    <div class="cards res">${room.board.map((b) => {
      const voters = room.players.filter((p) => room.votes[p.id] === b.card).map((p) => p.name);
      const story = b.card === room.storyCard;
      return html`<div class="resitem">
        ${tile(b.card, { cls: story ? "story" : "", badge: story ? "⭐ Narrador" : "" })}
        <p class="who">${story ? `${st.name} (narrador)` : nameOf(b.owner)}</p>
        <p class="votes">${voters.length ? `Votaron: ${voters.join(", ")}` : "Sin votos"}</p>
      </div>`;
    })}</div>
    <h2 class="c">Puntuación</h2>
    ${scoreboard(room, me, true)}
    ${won ? html`<p class="win">🏆 ¡Alguien ha llegado a ${room.target} puntos!</p>` : ""}
    <div class="bar stack">
      ${me.ready
        ? html`<p class="wait">Listo ✓ ${waiting(room, pending)}</p>`
        : html`<button class="primary" data-act="ready">${won ? "Ver clasificación final" : "Listo para la siguiente ronda"}</button>`}
      ${host && pending.length ? html`<button class="ghost wide" data-act="force">Continuar sin esperar</button>` : ""}
    </div>`;
}

function finishedView(room: Room, me: Player) {
  const top = Math.max(...room.players.map((p) => p.score));
  const winners = room.players.filter((p) => p.score === top).map((p) => p.name);
  return html`<section class="card-box"><h1>🏆 ${fmt.format(winners)}</h1><p class="hint">¡${winners.length > 1 ? "Ganan" : "Gana"} con ${top} puntos!</p></section>
    ${scoreboard(room, me, false)}
    <div class="bar stack">
      ${me.id === room.hostId
        ? html`<button class="primary" data-act="newgame">Nueva partida con los mismos jugadores</button>`
        : html`<p class="wait">Esperando al anfitrión para jugar otra…</p>`}
      ${takeHost(room, me)}
    </div>`;
}

// ¿Tiene el jugador que hacer algo ahora mismo? (para vibrar / título)
function needsAction(room: Room, me: Player | null): boolean {
  if (!me) return false;
  const st = room.players[room.storyteller];
  switch (room.phase) {
    case "story": return me.id === st.id;
    case "choose": return me.id !== st.id && room.played[me.id] === undefined;
    case "vote": return me.id !== st.id && room.votes[me.id] === undefined;
    case "results": return !me.ready;
    default: return false;
  }
}

export function renderView(room: Room, me: Player | null): string {
  let body: Raw;
  if (!me) body = joinView(room);
  else
    switch (room.phase) {
      case "lobby": body = lobbyView(room, me); break;
      case "story": body = storyView(room, me); break;
      case "choose": body = chooseView(room, me); break;
      case "vote": body = voteView(room, me); break;
      case "results": body = resultsView(room, me); break;
      default: body = finishedView(room, me);
    }
  const showScore = me && ["story", "choose", "vote"].includes(room.phase);
  const key = `${room.phase}-${room.round}-${me ? "in" : "out"}`;
  return html`<div class="screen" data-key="${key}" data-turn="${needsAction(room, me) ? 1 : 0}">
    ${header(room)}${body}
    ${showScore ? html`<details class="mini"><summary>Puntuación</summary>${scoreboard(room, me, false)}</details>` : ""}
  </div>`.s;
}