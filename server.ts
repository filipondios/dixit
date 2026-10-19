import type { ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Room, handle, addPlayer, newRoom, setTotal, total } from "./game";
import { renderView } from "./views";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "data");
const DATA_FILE = join(DATA_DIR, "rooms.json");
const PUB = join(import.meta.dir, "public");
const ROOM_TTL = 14 * 24 * 3600 * 1000;
const ID_RE = /^[a-z0-9]{4,16}$/;

// ---- cartas: imágenes propias en ./cards (>= 60) o SVG generadas ----
const CARDS_DIR = join(import.meta.dir, "cards");
const customCards = existsSync(CARDS_DIR)
  ? readdirSync(CARDS_DIR).filter((f) => /\.(jpe?g|png|webp|avif|svg)$/i.test(f)).sort()
  : [];
if (customCards.length >= 60) setTotal(customCards.length);
const useCustom = customCards.length >= 60;
console.log(useCustom ? `Usando ${customCards.length} cartas propias` : `Usando ${total()} cartas generadas`);

// ---- estado y persistencia ----
const rooms = new Map<string, Room>();
const sockets = new Map<string, Set<ServerWebSocket<WSData>>>();
type WSData = { roomId?: string; playerId?: string | null };

try {
  if (existsSync(DATA_FILE)) {
    const saved: Room[] = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    for (const r of saved) {
      if (Date.now() - r.updated > ROOM_TTL) continue;
      r.players.forEach((p) => (p.connected = false));
      rooms.set(r.id, r);
    }
    console.log(`Cargadas ${rooms.size} partidas`);
  }
} catch (e) {
  console.error("No se pudo cargar rooms.json", e);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      await Bun.write(DATA_FILE, JSON.stringify([...rooms.values()]));
    } catch (e) {
      console.error("Error guardando", e);
    }
  }, 500);
}

function broadcast(room: Room) {
  const set = sockets.get(room.id);
  for (const p of room.players) p.connected = !!set && [...set].some((w) => w.data.playerId === p.id);
  if (!set) return;
  for (const ws of set) {
    const me = room.players.find((p) => p.id === ws.data.playerId) ?? null;
    ws.send(JSON.stringify({ type: "view", html: renderView(room, me) }));
  }
}

function detach(ws: ServerWebSocket<WSData>) {
  const id = ws.data.roomId;
  if (!id) return;
  sockets.get(id)?.delete(ws);
  const room = rooms.get(id);
  if (room) broadcast(room);
}

// ---- servidor ----
const statics: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/style.css": "style.css" };

Bun.serve<WSData>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      return server.upgrade(req, { data: {} }) ? undefined : new Response("Upgrade failed", { status: 400 });
    }
    if (statics[url.pathname]) return new Response(Bun.file(join(PUB, statics[url.pathname])));
    if (url.pathname === "/healthz") return new Response("ok");
    const m = url.pathname.match(/^\/card\/(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n >= total()) return new Response("Not found", { status: 404 });
      const headers = { "Cache-Control": "public, max-age=86400" };
      if (useCustom) return new Response(Bun.file(join(CARDS_DIR, customCards[n])), { headers });
      //return new Response(cardSvg(n), { headers: { ...headers, "Content-Type": "image/svg+xml" } });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    maxPayloadLength: 8192,
    idleTimeout: 120,
    message(ws, raw) {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === "ping") return;

      if (msg.type === "hello") {
        const id = String(msg.room ?? "").toLowerCase();
        if (!ID_RE.test(id)) return;
        detach(ws);
        let room = rooms.get(id);
        if (!room) { room = newRoom(id); rooms.set(id, room); }
        if (!sockets.has(id)) sockets.set(id, new Set());
        sockets.get(id)!.add(ws);
        ws.data.roomId = id;
        const p = room.players.find((x) => x.token === msg.token);
        ws.data.playerId = p?.id ?? null;
        broadcast(room);
        return;
      }

      if (msg.type === "act" && ws.data.roomId) {
        const room = rooms.get(ws.data.roomId);
        if (!room) return;
        const err = (m: string): void => { ws.send(JSON.stringify({ type: "error", msg: m })); };
        let me = room.players.find((p) => p.id === ws.data.playerId) ?? null;

        if (msg.action === "join" && !me) {
          const res = addPlayer(room, msg.name);
          if (typeof res === "string") return err(res);
          ws.data.playerId = res.id;
          ws.send(JSON.stringify({ type: "token", token: res.token }));
        } else if (msg.action === "claim" && !me) {
          const p = room.players.find((x) => x.id === msg.value);
          if (!p || p.connected) return err("Ese jugador ya está conectado");
          p.token = randomUUID();
          ws.data.playerId = p.id;
          ws.send(JSON.stringify({ type: "token", token: p.token }));
        } else if (me) {
          const e = handle(room, me, msg);
          if (e) err(e);
        }
        room.updated = Date.now();
        broadcast(room);
        save();
      }
    },
    close(ws) {
      detach(ws);
    },
  },
});

console.log(`Dixit escuchando en http://localhost:${PORT}`);