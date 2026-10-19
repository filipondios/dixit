import { randomUUID } from "node:crypto";

export type Phase = "lobby" | "story" | "choose" | "vote" | "results" | "finished";

export interface Player {
  id: string;
  token: string; // secreto, nunca se envía a otros jugadores
  name: string;
  score: number;
  hand: number[];
  ready: boolean;
  connected: boolean;
}

export interface BoardCard {
  card: number;
  owner: string;
}

export interface Room {
  id: string;
  created: number;
  updated: number;
  phase: Phase;
  round: number;
  target: number;
  hostId: string | null;
  players: Player[];
  deck: number[];
  discard: number[];
  storyteller: number; // índice en players
  clue: string;
  storyCard: number | null;
  played: Record<string, number>; // playerId -> carta
  board: BoardCard[]; // cartas barajadas para votar
  votes: Record<string, number>; // playerId -> carta votada
  delta: Record<string, number>; // puntos ganados en la ronda
  breakdown: Record<string, string[]>; // explicación de los puntos
}

export const HAND = 6;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const TARGETS = [15, 20, 30, 40];

let TOTAL = 84;
export const setTotal = (n: number) => (TOTAL = n);
export const total = () => TOTAL;

export function newRoom(id: string): Room {
  const t = Date.now();
  return {
    id, created: t, updated: t, phase: "lobby", round: 0, target: 30, hostId: null,
    players: [], deck: [], discard: [], storyteller: 0, clue: "", storyCard: null,
    played: {}, board: [], votes: {}, delta: {}, breakdown: {},
  };
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function refill(room: Room, p: Player) {
  while (p.hand.length < HAND) {
    if (!room.deck.length) {
      room.deck = shuffle(room.discard);
      room.discard = [];
    }
    const c = room.deck.pop();
    if (c === undefined) break;
    p.hand.push(c);
  }
}

export function addPlayer(room: Room, rawName: string): Player | string {
  const name = String(rawName ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
  if (!name) return "Escribe un nombre";
  if (room.phase !== "lobby") return "La partida ya ha empezado";
  if (room.players.length >= MAX_PLAYERS) return "La sala está llena";
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    return "Ese nombre ya está cogido";
  const p: Player = { id: randomUUID(), token: randomUUID(), name, score: 0, hand: [], ready: false, connected: true };
  room.players.push(p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

function resetRoundState(room: Room) {
  room.clue = "";
  room.storyCard = null;
  room.played = {};
  room.board = [];
  room.votes = {};
  room.delta = {};
  room.breakdown = {};
  room.players.forEach((p) => (p.ready = false));
}

function startGame(room: Room) {
  room.deck = shuffle(Array.from({ length: TOTAL }, (_, i) => i));
  room.discard = [];
  room.players.forEach((p) => { p.score = 0; p.hand = []; refill(room, p); });
  resetRoundState(room);
  room.round = 1;
  room.storyteller = Math.floor(Math.random() * room.players.length);
  room.phase = "story";
}

function score(room: Room) {
  const st = room.players[room.storyteller];
  const voters = room.players.filter((p) => p.id !== st.id);
  const correct = voters.filter((v) => room.votes[v.id] === room.storyCard);
  const d: Record<string, number> = {};
  const bd: Record<string, string[]> = {};
  room.players.forEach((p) => { d[p.id] = 0; bd[p.id] = []; });
  const add = (id: string, n: number, why: string) => { d[id] += n; bd[id].push(`${why}: +${n}`); };

  if (correct.length === 0 || correct.length === voters.length) {
    const why = correct.length === 0 ? "Nadie acertó" : "Todos acertaron";
    add(st.id, 0, `${why} (narrador)`);
    voters.forEach((v) => add(v.id, 2, why));
  } else {
    add(st.id, 3, "Algunos acertaron (narrador)");
    correct.forEach((v) => add(v.id, 3, "Acertó la carta"));
  }
  const received: Record<string, number> = {};
  for (const v of voters) {
    const b = room.board.find((x) => x.card === room.votes[v.id]);
    if (b && b.owner !== st.id) received[b.owner] = (received[b.owner] ?? 0) + 1;
  }
  for (const [id, n] of Object.entries(received)) add(id, n, n === 1 ? "1 voto a su carta" : `${n} votos a su carta`);

  room.players.forEach((p) => (p.score += d[p.id]));
  room.delta = d;
  room.breakdown = bd;
  room.phase = "results";
}

function advance(room: Room) {
  if (room.players.some((p) => p.score >= room.target)) {
    room.phase = "finished";
    return;
  }
  room.board.forEach((b) => room.discard.push(b.card));
  resetRoundState(room);
  room.players.forEach((p) => refill(room, p));
  room.storyteller = (room.storyteller + 1) % room.players.length;
  room.round++;
  room.phase = "story";
}

export function handle(room: Room, me: Player, msg: any): string | void {
  const st = room.players[room.storyteller];
  const isHost = me.id === room.hostId;
  const card = Number(msg.card);

  switch (msg.action) {
    case "start":
      if (!isHost) return "Solo el anfitrión puede empezar";
      if (room.phase !== "lobby") return;
      if (room.players.length < MIN_PLAYERS) return `Hacen falta al menos ${MIN_PLAYERS} jugadores`;
      return startGame(room);

    case "target":
      if (!isHost || room.phase !== "lobby") return;
      if (TARGETS.includes(Number(msg.value))) room.target = Number(msg.value);
      return;

    case "kick": {
      if (!isHost || room.phase !== "lobby") return;
      const i = room.players.findIndex((p) => p.id === msg.value && p.id !== room.hostId);
      if (i >= 0) room.players.splice(i, 1);
      return;
    }

    case "takehost": {
      const host = room.players.find((p) => p.id === room.hostId);
      if (!host || !host.connected) room.hostId = me.id;
      return;
    }

    case "story": {
      if (room.phase !== "story" || me.id !== st.id) return "No es tu turno";
      const clue = String(msg.clue ?? "").trim().replace(/\s+/g, " ").slice(0, 140);
      if (!clue) return "Escribe un tema para la carta";
      if (!me.hand.includes(card)) return "Carta no válida";
      me.hand = me.hand.filter((c) => c !== card);
      room.clue = clue;
      room.storyCard = card;
      room.played[me.id] = card;
      room.phase = "choose";
      return;
    }

    case "play": {
      if (room.phase !== "choose" || me.id === st.id || room.played[me.id] !== undefined) return;
      if (!me.hand.includes(card)) return "Carta no válida";
      me.hand = me.hand.filter((c) => c !== card);
      room.played[me.id] = card;
      if (Object.keys(room.played).length === room.players.length) {
        room.board = shuffle(Object.entries(room.played).map(([owner, c]) => ({ owner, card: c })));
        room.phase = "vote";
      }
      return;
    }

    case "vote": {
      if (room.phase !== "vote" || me.id === st.id || room.votes[me.id] !== undefined) return;
      const b = room.board.find((x) => x.card === card);
      if (!b) return "Carta no válida";
      if (b.owner === me.id) return "No puedes votar tu propia carta";
      room.votes[me.id] = card;
      if (Object.keys(room.votes).length === room.players.length - 1) score(room);
      return;
    }

    case "ready":
      if (room.phase !== "results") return;
      me.ready = true;
      if (room.players.every((p) => p.ready)) advance(room);
      return;

    case "force":
      if (!isHost || room.phase !== "results") return;
      return advance(room);

    case "newgame":
      if (!isHost || room.phase !== "finished") return;
      room.phase = "lobby";
      room.round = 0;
      room.players.forEach((p) => { p.score = 0; p.hand = []; p.ready = false; });
      resetRoundState(room);
      return;
  }
}