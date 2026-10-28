import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "./firebase.js";
import { ref, set, onValue, push, get, remove, update, runTransaction, query, limitToLast } from "firebase/database";

// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════
const MATCH_DAYS = [
  { key: "monday", label: "Lunedì", jsDay: 1 },
  { key: "tuesday", label: "Martedì", jsDay: 2 },
  { key: "wednesday", label: "Mercoledì", jsDay: 3 },
  { key: "thursday", label: "Giovedì", jsDay: 4 },
  { key: "friday", label: "Venerdì", jsDay: 5 },
];
const MAX_PLAYERS = 10;
const MAX_RESERVES = 3;
const MAX_TOTAL = MAX_PLAYERS + MAX_RESERVES;
const MATCH_HOUR = 19;
const MATCH_MINUTE = 30;
const TIME_STR = `${MATCH_HOUR}:${String(MATCH_MINUTE).padStart(2, "0")}`;

// Rating (forza giocatore)
const ELO_START = 1000;   // valore medio
const ELO_K = 24;         // quanto pesa una singola partita
const PRIOR_GAMES = 5;    // "partite fantasma" al 50%: evita giudizi su chi ha giocato poco
const ELO_TRUST = 6;      // dopo ~6 partite con squadre note l'Elo pesa più delle sole statistiche
const SHUFFLE_TOLERANCE = 15; // rimescola solo tra combinazioni quasi equilibrate quanto la migliore

// ═══════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════
const BAD_CHARS = /[.#$/[\]]/;
const sanitizeKey = (s) => String(s ?? "").trim().replace(/[.#$/[\]]/g, "_");
const statsKey = (s) => sanitizeKey(s).toLowerCase();
const norm = (s) => String(s ?? "").trim().toLowerCase();
const asArray = (v) =>
  (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []).filter((x) => typeof x === "string" && x.trim());
const teamNames = (arr) =>
  (Array.isArray(arr) ? arr : arr && typeof arr === "object" ? Object.values(arr) : [])
    .map((p) => (typeof p === "string" ? p : p?.name))
    .filter(Boolean);
const sameSet = (a, b) => {
  if (a.length !== b.length) return false;
  const s = new Set(a.map(norm));
  return b.every((x) => s.has(norm(x)));
};
const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((n) => {
    const k = norm(n);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const hasName = (arr, name) => arr.some((n) => norm(n) === norm(name));
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
const lsGet = (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage non disponibile */ } };
const DEVICE_ID = (() => {
  let id = lsGet("fazi_device");
  if (!id) { id = Math.random().toString(36).slice(2, 8); lsSet("fazi_device", id); }
  return id;
})();

// PIN admin: nel database finisce solo un'impronta (hash) del PIN, mai il PIN in chiaro
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));
async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 150000, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

// Tipi di attività da controllare nel registro
const SUSPECT_TYPES = ["signup_for", "remove_for", "identity", "admin_fail"];
const LOG_ICONS = { signup: "➕", signup_for: "👥", remove: "➖", remove_for: "⚠️", identity: "📱", admin: "🔧", admin_fail: "🚫", profile: "🎖️" };

// ═══════════════════════════════════════════════════════════
//  DATE
// ═══════════════════════════════════════════════════════════
const getActiveMonday = () => {
  const now = new Date();
  const currentDay = now.getDay();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  if (currentDay >= 1 && currentDay <= 5) {
    monday.setDate(now.getDate() - (currentDay - 1));
  } else {
    const daysUntilMonday = currentDay === 0 ? 1 : 2;
    monday.setDate(now.getDate() + daysUntilMonday);
  }
  return monday;
};

const getWeekId = () => {
  const monday = getActiveMonday();
  const start = new Date(monday.getFullYear(), 0, 1);
  const diff = monday - start;
  return `${monday.getFullYear()}-W${Math.floor(diff / 604800000)}`;
};

const getWeekDates = () => {
  const monday = getActiveMonday();
  const dates = {};
  MATCH_DAYS.forEach((d, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    dates[d.key] = date;
  });
  return dates;
};

const getMatchDate = (dayKey) => {
  const d = new Date(getWeekDates()[dayKey] || new Date());
  d.setHours(MATCH_HOUR, MATCH_MINUTE, 0, 0);
  return d;
};

const formatDate = (date) => {
  const months = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  return `${date.getDate()} ${months[date.getMonth()]}`;
};

const isLocked = (dayKey) => new Date() >= getMatchDate(dayKey);

const dayLabel = (key) => MATCH_DAYS.find((d) => d.key === key)?.label || key;

const getTierInfo = (presences) => {
  if (presences >= 100) return { name: "LEGGENDA", color: "#a78bfa", gradient: "linear-gradient(135deg, #7c3aed 0%, #a78bfa 50%, #c4b5fd 100%)" };
  if (presences >= 50) return { name: "ELITE", color: "#fbbf24", gradient: "linear-gradient(135deg, #b45309 0%, #f59e0b 50%, #fde68a 100%)" };
  if (presences >= 10) return { name: "VETERANO", color: "#94a3b8", gradient: "linear-gradient(135deg, #475569 0%, #94a3b8 50%, #e2e8f0 100%)" };
  return { name: "ROOKIE", color: "#cd7f32", gradient: "linear-gradient(135deg, #5c3317 0%, #cd7f32 50%, #daa06d 100%)" };
};

// ═══════════════════════════════════════════════════════════
//  RATING & SQUADRE
// ═══════════════════════════════════════════════════════════

// Squadre di una partita: quelle salvate nella partita (nuovo formato)
// oppure ricostruite dalle squadre della settimana (partite vecchie).
function getMatchSides(m, teamsArchive) {
  const A = teamNames(m.teamA), B = teamNames(m.teamB);
  if (A.length && B.length) return { A, B, stored: true };
  const t = teamsArchive?.[m.weekId]?.[m.day];
  if (!t) return null;
  const present = new Set(asArray(m.players).map(norm));
  const keep = (n) => present.size === 0 || present.has(norm(n));
  const fa = teamNames(t.teamA).filter(keep), fb = teamNames(t.teamB).filter(keep);
  if (!fa.length || !fb.length) return null;
  return { A: fa, B: fb, stored: false };
}

// Forza di ogni giocatore:
// 1) Elo a squadre sulle partite con formazioni note (conta con chi e contro chi hai giocato, e lo scarto)
// 2) % vittorie "prudente" dalle statistiche totali (chi ha poche partite resta vicino alla media)
// 3) bonus MVP + eventuale correzione manuale dell'admin
function computeRatings(playerStats, matchHistory, teamsArchive, adjustments) {
  const elo = {}, eloN = {};
  const matches = [...matchHistory].filter((m) => m && m.id).sort((a, b) => a.id - b.id);
  for (const m of matches) {
    const sides = getMatchSides(m, teamsArchive);
    if (!sides || sides.A.length < 2 || sides.B.length < 2) continue;
    const A = sides.A.map(statsKey), B = sides.B.map(statsKey);
    const avg = (ks) => ks.reduce((s, k) => s + (elo[k] ?? ELO_START), 0) / ks.length;
    const expA = 1 / (1 + Math.pow(10, (avg(B) - avg(A)) / 400));
    const sa = Number(m.scoreA) || 0, sb = Number(m.scoreB) || 0;
    const actA = sa > sb ? 1 : sa < sb ? 0 : 0.5;
    const mult = 1 + Math.min(1, Math.log2(1 + Math.abs(sa - sb)) / 3);
    const delta = ELO_K * mult * (actA - expA);
    A.forEach((k) => { elo[k] = (elo[k] ?? ELO_START) + delta; eloN[k] = (eloN[k] || 0) + 1; });
    B.forEach((k) => { elo[k] = (elo[k] ?? ELO_START) - delta; eloN[k] = (eloN[k] || 0) + 1; });
  }
  const out = {};
  const keys = new Set([...Object.keys(playerStats || {}), ...Object.keys(elo), ...Object.keys(adjustments || {})]);
  keys.forEach((k) => {
    const s = playerStats?.[k] || {};
    const g = +s.gamesPlayed || 0, w = +s.wins || 0, d = +s.draws || 0, mvp = +s.mvpCount || 0;
    const wr = (w + 0.5 * d + 0.5 * PRIOR_GAMES) / (g + PRIOR_GAMES);
    const statsR = ELO_START + 600 * (wr - 0.5);
    const n = eloN[k] || 0, trust = n / (n + ELO_TRUST);
    let r = trust * (elo[k] ?? ELO_START) + (1 - trust) * statsR;
    r += (200 * (mvp - 0.1 * g)) / (g + 8);
    r += (Number(adjustments?.[k]) || 0) * 8;
    out[k] = { r, games: g, eloGames: n };
  });
  return out;
}

const toOvr = (r) => Math.round(Math.max(40, Math.min(99, 70 + (r - ELO_START) / 8)));
const winProb = (avgA, avgB) => 1 / (1 + Math.pow(10, (avgB - avgA) / 400));

// Prova TUTTE le divisioni possibili (con 10 giocatori sono 126) e le ordina dalla più equilibrata.
function rankSplits(names, ratingOf) {
  const n = names.length;
  if (n < 2) return [];
  const r = names.map(ratingOf);
  const sizeA = Math.ceil(n / 2);
  const out = [];
  const pick = [];
  const evaluate = () => {
    const inA = new Array(n).fill(false);
    pick.forEach((i) => (inA[i] = true));
    let sA = 0, sB = 0, cA = 0, cB = 0;
    for (let i = 0; i < n; i++) {
      if (inA[i]) { sA += r[i]; cA++; }
      else { sB += r[i]; cB++; }
    }
    const avgA = sA / cA, avgB = sB / cB;
    const cost = Math.abs(avgA - avgB);
    out.push({
      A: names.filter((_, i) => inA[i]),
      B: names.filter((_, i) => !inA[i]),
      cost, avgA, avgB, probA: winProb(avgA, avgB),
    });
  };
  const rec = (start) => {
    if (pick.length === sizeA) return evaluate();
    for (let i = start; i < n; i++) {
      if (n % 2 === 0 && pick.length === 0 && i > 0) break; // evita le combinazioni speculari
      pick.push(i); rec(i + 1); pick.pop();
    }
  };
  rec(0);
  out.sort((x, y) => x.cost - y.cost || x.A.join("|").localeCompare(y.A.join("|")));
  return out;
}

// Aggiunge (sign=+1) o toglie (sign=-1) il contributo di una partita alle statistiche.
// Se "sides" è null (partita vecchia senza squadre salvate) tocca solo presenze e MVP.
function applyMatchToStats(stats, match, sign, sides) {
  const changed = new Set();
  const sideOf = (name) => {
    if (!sides) return null;
    if (hasName(sides.A || [], name)) return "A";
    if (hasName(sides.B || [], name)) return "B";
    return null;
  };
  asArray(match.players).forEach((name) => {
    const k = statsKey(name);
    if (!k) return;
    const rec = { name, gamesPlayed: 0, wins: 0, draws: 0, losses: 0, mvpCount: 0, ...(stats[k] || {}) };
    if (sign > 0) rec.name = name;
    rec.gamesPlayed = Math.max(0, (+rec.gamesPlayed || 0) + sign);
    const side = sideOf(name);
    if (side) {
      const f = match.winner === "draw" ? "draws" : side === match.winner ? "wins" : "losses";
      rec[f] = Math.max(0, (+rec[f] || 0) + sign);
    }
    if (match.mvp && norm(match.mvp) === norm(name)) rec.mvpCount = Math.max(0, (+rec.mvpCount || 0) + sign);
    stats[k] = rec;
    changed.add(k);
  });
  return changed;
}

function logEvent(type, detail) {
  push(ref(db, "logs"), { t: Date.now(), type, detail, dev: DEVICE_ID, me: lsGet("fazi_me") }).catch(() => {});
}

function ScorePicker({ label, value, onChange }) {
  return (
    <div style={S.scoreTeam}>
      <span style={S.scoreLabel}>{label}</span>
      <div style={S.scoreControl}>
        <button style={S.scoreBtn} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <span style={S.scoreNum}>{value}</span>
        <button style={S.scoreBtn} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

const EMPTY_PROFILE = { nickname: "", numero: "", ruolo: "ATT", eta: "", altezza: "", peso: "", piede: "Destro", origKey: null };

// ═══════════════════════════════════════════════════════════
//  APP
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("signup");
  const [playerName, setPlayerName] = useState(() => lsGet("fazi_me"));
  const [signups, setSignups] = useState({});
  const [playerStats, setPlayerStats] = useState({});
  const [matchHistory, setMatchHistory] = useState([]);
  const [teamsArchive, setTeamsArchive] = useState({});
  const [players, setPlayers] = useState({});
  const [ratingAdjust, setRatingAdjust] = useState({});
  const [loading, setLoading] = useState(true);
  const [weekId] = useState(getWeekId());
  const [toast, setToast] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [adminClicks, setAdminClicks] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [matchForm, setMatchForm] = useState(null);
  const [editingTeams, setEditingTeams] = useState(null); // { day, A, B }
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [editingMatch, setEditingMatch] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [adminSheet, setAdminSheet] = useState(null); // { dayKey, name }
  const [mergeForm, setMergeForm] = useState(null);   // { from, into }
  const [showLog, setShowLog] = useState(false);
  const [logOnlySuspect, setLogOnlySuspect] = useState(false);
  const [me, setMe] = useState(() => lsGet("fazi_me")); // chi usa questo telefono
  const [signupMeta, setSignupMeta] = useState({});     // chi ha iscritto chi
  const [pinModal, setPinModal] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logFilter, setLogFilter] = useState("");
  const [undoStack, setUndoStack] = useState([]);
  const [busy, setBusy] = useState(false);

  const autocompleteRef = useRef(null);
  const toastTimer = useRef(null);

  const weekDates = useMemo(() => getWeekDates(), []);
  const generatedTeams = teamsArchive?.[weekId] || {};

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const listen = (path, cb) => onValue(ref(db, path), (snap) => cb(snap.val()), (err) => console.error(path, err));
    const unsubs = [
      listen(`signups/${weekId}`, (data) => { setSignups(data || {}); setLoading(false); }),
      listen(`signupMeta/${weekId}`, (data) => setSignupMeta(data || {})),
      listen("playerStats", (data) => setPlayerStats(data || {})),
      listen("matchHistory", (data) => setMatchHistory(data ? Object.values(data).filter((m) => m && m.id).sort((a, b) => b.id - a.id) : [])),
      listen("teams", (data) => setTeamsArchive(data || {})),
      listen("players", (data) => setPlayers(data || {})),
      listen("ratingAdjust", (data) => setRatingAdjust(data || {})),
    ];
    const fallback = setTimeout(() => setLoading(false), 6000);
    return () => { unsubs.forEach((u) => u()); clearTimeout(fallback); };
  }, [weekId]);

  // ─── DATI DERIVATI ───
  const ratings = useMemo(
    () => computeRatings(playerStats, matchHistory, teamsArchive, ratingAdjust),
    [playerStats, matchHistory, teamsArchive, ratingAdjust]
  );
  const ratingOf = (name) => ratings[statsKey(name)]?.r ?? ELO_START;
  const ovrOf = (name) => toOvr(ratingOf(name));

  const profileIndex = useMemo(() => {
    const idx = {};
    Object.entries(players || {}).forEach(([key, data]) => {
      if (!data) return;
      const entry = { key, data };
      idx[norm(key)] = entry;
      if (data.nickname) idx[norm(data.nickname)] = entry;
    });
    return idx;
  }, [players]);
  const findProfile = (name) => profileIndex[norm(name)] || null;
  // Capitano: chi ha più presenze; a parità più MVP; poi ordine alfabetico
  const captainOf = (names) => {
    const st = (n) => playerStats[statsKey(n)] || {};
    return [...names].sort((a, b) =>
      (+st(b).gamesPlayed || 0) - (+st(a).gamesPlayed || 0) ||
      (+st(b).mvpCount || 0) - (+st(a).mvpCount || 0) ||
      a.localeCompare(b)
    )[0];
  };

  const allNames = useMemo(() => {
    const fromProfiles = Object.entries(players || {}).map(([k, p]) => p?.nickname || k);
    const fromStats = Object.values(playerStats || {}).map((s) => s?.name).filter(Boolean);
    const fromSignups = MATCH_DAYS.flatMap((d) => asArray(signups[d.key]));
    return dedupe([...fromProfiles, ...fromStats, ...fromSignups]).sort((a, b) => a.localeCompare(b));
  }, [players, playerStats, signups]);

  const daySignups = (dayKey) => asArray(signups[dayKey]);

  // Squadre del giorno: quelle fissate dall'admin se corrispondono ancora alla lista,
  // altrimenti la divisione più equilibrata calcolata al volo (uguale per tutti).
  const getDayTeams = (dayKey) => {
    const titolari = daySignups(dayKey).slice(0, MAX_PLAYERS);
    if (titolari.length < 2) return null;
    const saved = generatedTeams[dayKey];
    if (saved) {
      const A = teamNames(saved.teamA), B = teamNames(saved.teamB);
      if (A.length && B.length && sameSet([...A, ...B], titolari)) return { A, B, fixed: true, outdated: false };
    }
    const best = rankSplits(titolari, ratingOf)[0];
    return { A: best.A, B: best.B, fixed: false, outdated: !!saved };
  };

  const teamAvg = (names) => (names.length ? names.reduce((s, n) => s + ratingOf(n), 0) / names.length : ELO_START);

  const defaultTeamsDay = useMemo(() => {
    const open = MATCH_DAYS.filter((d) => !isLocked(d.key));
    const withPlayers = open.find((d) => asArray(signups[d.key]).length >= 2);
    return (withPlayers || open[0] || MATCH_DAYS[MATCH_DAYS.length - 1]).key;
  }, [signups]);
  const activeTeamsDay = selectedDay || defaultTeamsDay;

  // ─── ADMIN: SCRITTURE CON "ANNULLA" ───
  const adminUpdate = async (updates, label) => {
    setBusy(true);
    try {
      const paths = Object.keys(updates);
      const prev = {};
      await Promise.all(paths.map(async (p) => {
        const snap = await get(ref(db, p));
        prev[p] = snap.exists() ? snap.val() : null;
      }));
      await update(ref(db), updates);
      setUndoStack((st) => [...st.slice(-9), { label, prev, t: Date.now() }]);
      logEvent("admin", label);
      showToast(`${label} ✓`);
      return true;
    } catch (err) {
      console.error(err);
      showToast(`Errore: ${err.message}`, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    const mins = Math.round((Date.now() - last.t) / 60000);
    if (!window.confirm(`Annullare "${last.label}"?${mins > 5 ? `\n\nAttenzione: è di ${mins} minuti fa, eventuali modifiche fatte da altri nel frattempo sugli stessi dati verranno sovrascritte.` : ""}`)) return;
    try {
      await update(ref(db), last.prev);
      setUndoStack((st) => st.slice(0, -1));
      logEvent("admin", `Annullato: ${last.label}`);
      showToast("Modifica annullata ↩️");
    } catch (err) {
      showToast(`Errore: ${err.message}`, "error");
    }
  };

  // ─── ISCRIZIONI ───
  const metaOf = (dayKey, name) => signupMeta?.[dayKey]?.[statsKey(name)] || null;
  const canonical = (n) => allNames.find((x) => norm(x) === norm(n)) || n;

  const setIdentity = (name) => {
    const old = me;
    lsSet("fazi_me", name);
    setMe(name);
    logEvent("identity", old ? `Telefono passato da ${old} a ${name}` : `Telefono registrato come ${name}`);
  };

  const changeIdentity = () => {
    const nn = (window.prompt("Chi usa questo telefono? Scrivi il TUO nickname", me) || "").trim().replace(/\s+/g, " ");
    if (!nn || norm(nn) === norm(me)) return;
    if (BAD_CHARS.test(nn)) return showToast("Caratteri non permessi: . # $ / [ ]", "error");
    if (!window.confirm(`Questo telefono diventa di "${canonical(nn)}".\nIl cambio resta registrato. Confermi?`)) return;
    setIdentity(canonical(nn));
    setPlayerName(canonical(nn));
  };

  const handleSignup = async (dayKey) => {
    const typed = playerName.trim().replace(/\s+/g, " ");
    if (!typed) return showToast("Scrivi il tuo nome!", "error");
    if (BAD_CHARS.test(typed)) return showToast("Caratteri non permessi: . # $ / [ ]", "error");
    if (isLocked(dayKey) && !adminMode) return showToast("Lista chiusa!", "error");
    const name = canonical(typed); // stessa grafia di sempre
    let who = me;
    if (!adminMode) {
      // Prima volta su questo telefono: chiediamo chi sei
      if (!who) {
        if (window.confirm(`Ti stai iscrivendo come "${name}".\n\nSei tu?\nOK = sì, sono io\nAnnulla = sto iscrivendo un'altra persona`)) {
          who = name;
        } else {
          const w = (window.prompt("Allora scrivi il TUO nickname (chi usa questo telefono):") || "").trim().replace(/\s+/g, " ");
          if (!w) return;
          if (BAD_CHARS.test(w)) return showToast("Caratteri non permessi: . # $ / [ ]", "error");
          who = canonical(w);
        }
        setIdentity(who);
      }
      if (norm(name) !== norm(who) && !window.confirm(`Stai iscrivendo ${name} da parte tua.\nIn lista comparirà "da ${who}". Continuare?`)) return;
    }
    const forOther = !adminMode && norm(name) !== norm(who);
    let reason = null;
    try {
      // Transazione: due iscrizioni nello stesso istante non si sovrascrivono più
      const res = await runTransaction(ref(db, `signups/${weekId}/${dayKey}`), (cur) => {
        const arr = asArray(cur);
        if (hasName(arr, name)) { reason = "dup"; return; }
        if (arr.length >= MAX_TOTAL) { reason = "full"; return; }
        reason = null;
        return [...arr, name];
      });
      if (!res.committed) return showToast(reason === "full" ? "Lista piena (anche le riserve)!" : "Già iscritto!", "error");
      const arr = asArray(res.snapshot.val());
      const spot = arr.findIndex((n) => norm(n) === norm(name)) + 1;
      if (spot <= MAX_PLAYERS) showToast(`${name} iscritto per ${dayLabel(dayKey)}!`);
      else showToast(`${name} in riserva #${spot - MAX_PLAYERS} per ${dayLabel(dayKey)}!`);
      set(ref(db, `signupMeta/${weekId}/${dayKey}/${statsKey(name)}`), { by: adminMode ? "admin" : who, dev: DEVICE_ID, t: Date.now() }).catch(() => {});
      logEvent(forOther ? "signup_for" : "signup", forOther ? `${who} ha iscritto ${name} → ${dayLabel(dayKey)}` : `${name} → ${dayLabel(dayKey)}${adminMode ? " (admin)" : ""}`);
      if (!adminMode) setPlayerName(who);
    } catch (err) {
      console.error(err);
      showToast("Errore di connessione, riprova", "error");
    }
  };

  // Ognuno può togliere solo sé stesso o chi ha iscritto lui; l'admin tutti
  const canRemove = (dayKey, name) => {
    if (adminMode) return true;
    if (!myName) return false;
    const mt = metaOf(dayKey, name);
    return norm(name) === myName || (mt && norm(mt.by) === myName);
  };

  const handleRemove = async (dayKey, name) => {
    if (isLocked(dayKey) && !adminMode) return showToast("Lista chiusa!", "error");
    if (!canRemove(dayKey, name)) return showToast("Puoi togliere solo te stesso o chi hai iscritto tu", "error");
    const mine = norm(name) === myName;
    if (!window.confirm(`Togliere ${name} dalla lista di ${dayLabel(dayKey)}?`)) return;
    try {
      await runTransaction(ref(db, `signups/${weekId}/${dayKey}`), (cur) => asArray(cur).filter((n) => n !== name));
      remove(ref(db, `signupMeta/${weekId}/${dayKey}/${statsKey(name)}`)).catch(() => {});
      showToast(`${name} rimosso.`);
      if (mine || adminMode) logEvent("remove", `${name} ✕ ${dayLabel(dayKey)}${adminMode ? " (admin)" : ""}`);
      else logEvent("remove_for", `${me} ha tolto ${name} ✕ ${dayLabel(dayKey)}`);
    } catch (err) {
      showToast("Errore di connessione, riprova", "error");
    }
  };

  // Operazioni admin sulle liste (transazione su tutta la settimana: spostamenti atomici)
  const adminSignupOp = async (fn, getLabel) => {
    try {
      const res = await runTransaction(ref(db, `signups/${weekId}`), (cur) => {
        const week = {};
        MATCH_DAYS.forEach((d) => (week[d.key] = asArray(cur?.[d.key])));
        if (fn(week) === false) return;
        return week;
      });
      if (!res.committed) { showToast("Operazione non possibile (nome già presente o lista piena)", "error"); return false; }
      const label = typeof getLabel === "function" ? getLabel() : getLabel;
      logEvent("admin", label);
      showToast(`${label} ✓`);
      return true;
    } catch (err) {
      showToast(`Errore: ${err.message}`, "error");
      return false;
    }
  };

  const sheetAction = async (action, arg) => {
    if (!adminSheet) return;
    const { dayKey, name } = adminSheet;
    let label = "";
    if (action === "rename") {
      const nn = (window.prompt(`Correggi il nome di "${name}"`, name) || "").trim().replace(/\s+/g, " ");
      if (!nn || nn === name) return;
      if (BAD_CHARS.test(nn)) return showToast("Caratteri non permessi: . # $ / [ ]", "error");
      arg = nn;
    }
    if (action === "remove" && !window.confirm(`Togliere ${name} da ${dayLabel(dayKey)}?`)) return;
    const ok = await adminSignupOp((week) => {
      const arr = week[dayKey];
      const i = arr.indexOf(name);
      if (i < 0) return false;
      if (action === "remove") { arr.splice(i, 1); label = `${name} tolto da ${dayLabel(dayKey)}`; }
      else if (action === "up") { if (i === 0) return false; [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; label = `${name} spostato su`; }
      else if (action === "down") { if (i === arr.length - 1) return false; [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; label = `${name} spostato giù`; }
      else if (action === "starter") {
        if (i < MAX_PLAYERS) return false;
        arr.splice(i, 1);
        arr.splice(MAX_PLAYERS - 1, 0, name); // entra come 10°, l'ex 10° diventa prima riserva
        label = `${name} promosso titolare`;
      }
      else if (action === "rename") {
        if (arr.some((n, j) => j !== i && norm(n) === norm(arg))) return false;
        arr[i] = arg; label = `${name} → ${arg}`;
      }
      else if (action === "move") {
        const to = week[arg];
        if (hasName(to, name) || to.length >= MAX_TOTAL) return false;
        arr.splice(i, 1); to.push(name); label = `${name} spostato a ${dayLabel(arg)}`;
      }
      return true;
    }, () => label);
    if (!ok) return;
    setAdminSheet(null);
    const base = `signupMeta/${weekId}`;
    const mt = metaOf(dayKey, name);
    const up = {};
    if (action === "remove") up[`${base}/${dayKey}/${statsKey(name)}`] = null;
    if (action === "rename") {
      up[`${base}/${dayKey}/${statsKey(name)}`] = null;
      up[`${base}/${dayKey}/${statsKey(arg)}`] = { ...(mt || {}), by: !mt || norm(mt.by) === norm(name) ? arg : mt.by, renamedFrom: name, t: mt?.t || Date.now() };
    }
    if (action === "move" && mt) {
      up[`${base}/${dayKey}/${statsKey(name)}`] = null;
      up[`${base}/${arg}/${statsKey(name)}`] = mt;
    }
    if (Object.keys(up).length) update(ref(db), up).catch(() => {});
  };

  // ─── SQUADRE ───
  const fixTeams = async (dayKey, A, B, label = "Squadre fissate") => {
    try {
      await set(ref(db, `teams/${weekId}/${dayKey}`), {
        teamA: A.map((name) => ({ name })),
        teamB: B.map((name) => ({ name })),
        fixedAt: Date.now(),
      });
      logEvent("admin", `${label} (${dayLabel(dayKey)})`);
      showToast(`${label}!`);
    } catch (err) {
      showToast(`Errore: ${err.message}`, "error");
    }
  };

  const unfixTeams = async (dayKey) => {
    if (!window.confirm("Tornare alle squadre automatiche per questo giorno?")) return;
    await remove(ref(db, `teams/${weekId}/${dayKey}`));
    logEvent("admin", `Squadre sbloccate (${dayLabel(dayKey)})`);
    showToast("Squadre di nuovo automatiche");
  };

  const shuffleTeams = (dayKey) => {
    const titolari = daySignups(dayKey).slice(0, MAX_PLAYERS);
    const cur = getDayTeams(dayKey);
    const splits = rankSplits(titolari, ratingOf);
    if (!splits.length || !cur) return;
    const notCurrent = (s) => !sameSet(s.A, cur.A) && !sameSet(s.A, cur.B);
    let cands = splits.filter((s) => s.cost <= splits[0].cost + SHUFFLE_TOLERANCE && notCurrent(s));
    if (!cands.length) cands = splits.filter(notCurrent).slice(0, 5);
    if (!cands.length) return showToast("Nessuna alternativa disponibile", "error");
    const pick = cands[Math.floor(Math.random() * cands.length)];
    fixTeams(dayKey, pick.A, pick.B, "Squadre rimescolate");
  };

  const swapInEdit = (name) => {
    setEditingTeams((et) => {
      if (!et) return et;
      if (et.A.includes(name)) return { ...et, A: et.A.filter((n) => n !== name), B: [...et.B, name] };
      return { ...et, B: et.B.filter((n) => n !== name), A: [...et.A, name] };
    });
  };

  // ─── REGISTRA PARTITA ───
  const startMatchForm = (dayKey) => {
    const t = getDayTeams(dayKey);
    if (!t) return showToast("Servono almeno 2 giocatori", "error");
    const pf = {};
    t.A.forEach((n) => (pf[n] = { present: true, team: "A" }));
    t.B.forEach((n) => (pf[n] = { present: true, team: "B" }));
    setMatchForm({ dayKey, players: pf, scoreA: 0, scoreB: 0, mvp: "", addName: "", addTeam: "A" });
  };

  const addToMatchForm = () => {
    const name = (matchForm.addName || "").trim();
    if (!name) return;
    if (BAD_CHARS.test(name)) return showToast("Caratteri non permessi", "error");
    const canon = allNames.find((n) => norm(n) === norm(name)) || name;
    if (hasName(Object.keys(matchForm.players), canon)) return showToast("Già in lista", "error");
    setMatchForm((p) => ({ ...p, players: { ...p.players, [canon]: { present: true, team: p.addTeam } }, addName: "" }));
  };

  const saveMatchResult = async () => {
    if (!matchForm || busy) return;
    const { dayKey, players: pf, scoreA, scoreB, mvp } = matchForm;
    if (!mvp) return showToast("Seleziona un MVP!", "error");
    const present = Object.entries(pf).filter(([, d]) => d.present);
    const teamA = present.filter(([, d]) => d.team === "A").map(([n]) => n);
    const teamB = present.filter(([, d]) => d.team === "B").map(([n]) => n);
    if (!teamA.length || !teamB.length) return showToast("Entrambe le squadre devono avere giocatori", "error");
    if (!hasName([...teamA, ...teamB], mvp)) return showToast("L'MVP deve essere tra i presenti", "error");
    const dup = matchHistory.find((m) => m.weekId === weekId && m.day === dayKey);
    if (dup && !window.confirm(`Esiste già una partita registrata per ${dayLabel(dayKey)} (${dup.scoreA}-${dup.scoreB}). Registrarne un'altra?`)) return;
    const winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "draw";
    const id = Date.now();
    const match = {
      id, date: getMatchDate(dayKey).toISOString(), weekId, day: dayKey,
      scoreA, scoreB, winner, mvp, players: [...teamA, ...teamB], teamA, teamB,
    };
    const stats = clone(playerStats);
    const changed = applyMatchToStats(stats, match, 1, { A: teamA, B: teamB });
    const updates = { [`matchHistory/${id}`]: match };
    changed.forEach((k) => (updates[`playerStats/${k}`] = stats[k]));
    const ok = await adminUpdate(updates, `Partita ${dayLabel(dayKey)} registrata`);
    if (ok) { setMatchForm(null); setEditingTeams(null); }
  };

  // ─── MODIFICA / ELIMINA PARTITA ───
  const startEditingMatch = (m) => {
    const sides = getMatchSides(m, teamsArchive);
    const legacy = !(teamNames(m.teamA).length && teamNames(m.teamB).length);
    const teamOf = (n) => (sides ? (hasName(sides.A, n) ? "A" : hasName(sides.B, n) ? "B" : null) : null);
    setEditingMatch({
      id: m.id, day: m.day, scoreA: Number(m.scoreA) || 0, scoreB: Number(m.scoreB) || 0, mvp: m.mvp || "",
      legacy, confirmed: false, reconstructed: !!sides && !sides.stored,
      list: asArray(m.players).map((n) => ({ name: n, team: teamOf(n), removed: false, isNew: false })),
      addName: "", addTeam: "A",
    });
  };

  const emUpdatePlayer = (idx, patch) =>
    setEditingMatch((em) => ({ ...em, list: em.list.map((p, i) => (i === idx ? { ...p, ...patch } : p)) }));

  const emAddPlayer = () => {
    const name = (editingMatch.addName || "").trim();
    if (!name) return;
    if (BAD_CHARS.test(name)) return showToast("Caratteri non permessi", "error");
    const canon = allNames.find((n) => norm(n) === norm(name)) || name;
    if (hasName(editingMatch.list.filter((p) => !p.removed).map((p) => p.name), canon)) return showToast("Già in lista", "error");
    setEditingMatch((em) => ({ ...em, addName: "", list: [...em.list, { name: canon, team: em.addTeam, removed: false, isNew: true }] }));
  };

  // Calcola i lati "vecchi" della partita da togliere dalle statistiche
  const oldSidesFor = (em, orig) => {
    if (!em.legacy) return { A: teamNames(orig.teamA), B: teamNames(orig.teamB) };
    if (!em.confirmed) return null;
    const olds = em.list.filter((p) => !p.isNew);
    if (olds.some((p) => !p.team)) return "missing";
    return { A: olds.filter((p) => p.team === "A").map((p) => p.name), B: olds.filter((p) => p.team === "B").map((p) => p.name) };
  };

  const saveEditedMatch = async () => {
    const em = editingMatch;
    if (!em || busy) return;
    const orig = matchHistory.find((m) => m.id === em.id);
    if (!orig) return;
    const kept = em.list.filter((p) => !p.removed);
    if (!em.mvp || !hasName(kept.map((p) => p.name), em.mvp)) return showToast("Scegli un MVP tra i presenti", "error");
    const fullMode = !em.legacy || em.confirmed;
    if (fullMode && kept.some((p) => !p.team)) return showToast("Assegna la squadra a tutti i giocatori", "error");
    const oldSides = oldSidesFor(em, orig);
    if (oldSides === "missing") return showToast("Assegna la squadra a tutti per confermare", "error");
    const newA = kept.filter((p) => p.team === "A").map((p) => p.name);
    const newB = kept.filter((p) => p.team === "B").map((p) => p.name);
    if (fullMode && (!newA.length || !newB.length)) return showToast("Entrambe le squadre devono avere giocatori", "error");
    const winner = em.scoreA > em.scoreB ? "A" : em.scoreB > em.scoreA ? "B" : "draw";
    const stats = clone(playerStats);
    const ch1 = applyMatchToStats(stats, orig, -1, oldSides);
    const newMatch = { ...orig, scoreA: em.scoreA, scoreB: em.scoreB, winner, mvp: em.mvp, players: kept.map((p) => p.name) };
    if (fullMode) { newMatch.teamA = newA; newMatch.teamB = newB; }
    const ch2 = applyMatchToStats(stats, newMatch, 1, fullMode ? { A: newA, B: newB } : null);
    const updates = { [`matchHistory/${orig.id}`]: newMatch };
    new Set([...ch1, ...ch2]).forEach((k) => (updates[`playerStats/${k}`] = stats[k]));
    const ok = await adminUpdate(updates, `Partita ${dayLabel(orig.day)} modificata`);
    if (ok) setEditingMatch(null);
  };

  const deleteMatch = async () => {
    const em = editingMatch;
    if (!em || busy) return;
    const orig = matchHistory.find((m) => m.id === em.id);
    if (!orig) return;
    const oldSides = oldSidesFor(em, orig);
    if (oldSides === "missing") return showToast("Assegna la squadra a tutti per confermare", "error");
    const warn = oldSides ? "" : "\n\nPartita vecchia senza squadre salvate: verranno tolte presenze e MVP, ma non vittorie/sconfitte (spunta la conferma squadre per toglierle).";
    if (!window.confirm(`Eliminare la partita ${dayLabel(orig.day)} ${orig.scoreA}-${orig.scoreB} e aggiornare le statistiche?${warn}`)) return;
    const stats = clone(playerStats);
    const ch = applyMatchToStats(stats, orig, -1, oldSides);
    const updates = { [`matchHistory/${orig.id}`]: null };
    ch.forEach((k) => (updates[`playerStats/${k}`] = stats[k]));
    const ok = await adminUpdate(updates, `Partita ${dayLabel(orig.day)} eliminata`);
    if (ok) setEditingMatch(null);
  };

  // ─── PROFILI ───
  const openProfileEditor = (name) => {
    const prof = findProfile(name);
    if (prof) {
      const d = prof.data;
      setProfileForm({
        nickname: d.nickname || prof.key, numero: d.numero ?? "", ruolo: d.ruolo || "ATT",
        eta: d.eta || "", altezza: d.altezza || "", peso: d.peso || "", piede: d.piede || "Destro", origKey: prof.key,
      });
    } else {
      setProfileForm({ ...EMPTY_PROFILE, nickname: name || "" });
    }
    setShowProfileModal(true);
  };

  const handleSaveProfile = async () => {
    const { numero, ruolo, eta, altezza, peso, piede, origKey } = profileForm;
    const nickname = profileForm.nickname.trim().replace(/\s+/g, " ");
    if (!nickname || numero === "") return showToast("Compila nome e numero!", "error");
    if (BAD_CHARS.test(nickname)) return showToast("Caratteri non permessi nel nome: . # $ / [ ]", "error");
    const key = sanitizeKey(nickname);
    const existing = findProfile(nickname);
    if (existing && existing.key !== origKey && !window.confirm(`Esiste già un profilo "${existing.data.nickname || existing.key}". Sovrascriverlo?`)) return;
    try {
      await set(ref(db, `players/${key}`), {
        nickname, numero: parseInt(numero) || 0, ruolo,
        eta: parseInt(eta) || 0, altezza: parseInt(altezza) || 0, peso: parseInt(peso) || 0, piede,
      });
      if (origKey && origKey !== key) await remove(ref(db, `players/${origKey}`));
      if (existing && existing.key !== key && existing.key !== origKey) await remove(ref(db, `players/${existing.key}`));
      setShowProfileModal(false);
      setProfileForm(EMPTY_PROFILE);
      logEvent("profile", `Profilo ${nickname} salvato`);
      showToast("Profilo salvato!");
    } catch (err) {
      showToast(`Errore: ${err.message}`, "error");
    }
  };

  const handleDeletePlayer = async (key, nickname) => {
    if (!window.confirm(`Eliminare il profilo (card) di ${nickname}?\nLe statistiche restano.`)) return;
    await adminUpdate({ [`players/${key}`]: null }, `Profilo ${nickname} eliminato`);
  };

  // ─── STATISTICHE GIOCATORE (admin) ───
  const startEditingPlayerStats = (name) => {
    const k = statsKey(name);
    const s = playerStats[k] || {};
    setEditingPlayer({
      key: k, nickname: s.name || name,
      gamesPlayed: s.gamesPlayed || 0, wins: s.wins || 0, draws: s.draws || 0, losses: s.losses || 0, mvpCount: s.mvpCount || 0,
      adj: ratingAdjust[k] || 0,
    });
  };

  const saveEditedPlayerStats = async () => {
    const ep = editingPlayer;
    if (!ep) return;
    const adj = Math.max(-20, Math.min(20, parseInt(ep.adj) || 0));
    const ok = await adminUpdate({
      [`playerStats/${ep.key}`]: {
        name: ep.nickname,
        gamesPlayed: parseInt(ep.gamesPlayed) || 0, wins: parseInt(ep.wins) || 0, draws: parseInt(ep.draws) || 0,
        losses: parseInt(ep.losses) || 0, mvpCount: parseInt(ep.mvpCount) || 0,
      },
      [`ratingAdjust/${ep.key}`]: adj || null,
    }, `Statistiche ${ep.nickname} aggiornate`);
    if (ok) setEditingPlayer(null);
  };

  const deletePlayerStats = async () => {
    const ep = editingPlayer;
    if (!ep || !window.confirm(`Eliminare tutte le statistiche di ${ep.nickname}?\n(Le partite nello storico restano. Puoi annullare.)`)) return;
    const ok = await adminUpdate({ [`playerStats/${ep.key}`]: null, [`ratingAdjust/${ep.key}`]: null }, `Statistiche ${ep.nickname} eliminate`);
    if (ok) setEditingPlayer(null);
  };

  // ─── UNISCI / RINOMINA GIOCATORE ───
  const mergePlayers = async () => {
    const from = (mergeForm?.from || "").trim();
    const into = (mergeForm?.into || "").trim().replace(/\s+/g, " ");
    if (!from || !into) return showToast("Scegli i due nomi", "error");
    if (norm(from) === norm(into)) return showToast("I due nomi sono uguali", "error");
    if (BAD_CHARS.test(into)) return showToast("Caratteri non permessi nel nuovo nome", "error");
    const target = allNames.find((n) => norm(n) === norm(into)) || into;
    if (!window.confirm(`Unire "${from}" dentro "${target}"?\n\nStatistiche sommate, storico partite, liste e squadre aggiornate. "${from}" sparisce. Puoi annullare subito dopo.`)) return;

    const kF = statsKey(from), kI = statsKey(target);
    const updates = {};
    const ren = (arr) => dedupe(arr.map((n) => (norm(n) === norm(from) ? target : n)));

    // Statistiche
    const sF = playerStats[kF], sI = playerStats[kI];
    if (sF || sI) {
      const sum = { name: target };
      ["gamesPlayed", "wins", "draws", "losses", "mvpCount"].forEach((f) => (sum[f] = (+sF?.[f] || 0) + (+sI?.[f] || 0)));
      updates[`playerStats/${kI}`] = sum;
      if (kF !== kI) updates[`playerStats/${kF}`] = null;
    }
    if (kF !== kI && ratingAdjust[kF] && !ratingAdjust[kI]) updates[`ratingAdjust/${kI}`] = ratingAdjust[kF];
    if (kF !== kI && ratingAdjust[kF]) updates[`ratingAdjust/${kF}`] = null;

    // Profilo (card)
    const pF = findProfile(from), pI = findProfile(target);
    if (pF) {
      if (!pI) updates[`players/${sanitizeKey(target)}`] = { ...pF.data, nickname: target };
      if (!pI || pF.key !== pI.key) updates[`players/${pF.key}`] = null;
    }

    // Storico partite
    matchHistory.forEach((m) => {
      const involved = hasName(asArray(m.players), from) || hasName(teamNames(m.teamA), from) || hasName(teamNames(m.teamB), from) || norm(m.mvp) === norm(from);
      if (!involved) return;
      const nm = { ...m, players: ren(asArray(m.players)) };
      if (m.teamA) nm.teamA = ren(teamNames(m.teamA));
      if (m.teamB) nm.teamB = ren(teamNames(m.teamB));
      if (norm(m.mvp) === norm(from)) nm.mvp = target;
      updates[`matchHistory/${m.id}`] = nm;
    });

    // Liste della settimana
    MATCH_DAYS.forEach((d) => {
      const arr = daySignups(d.key);
      if (hasName(arr, from)) updates[`signups/${weekId}/${d.key}`] = ren(arr);
    });

    // Squadre salvate (tutte le settimane: servono al calcolo della forza)
    Object.entries(teamsArchive || {}).forEach(([wk, days]) => {
      Object.entries(days || {}).forEach(([day, t]) => {
        if (!t) return;
        const A = teamNames(t.teamA), B = teamNames(t.teamB);
        if (!hasName(A, from) && !hasName(B, from)) return;
        updates[`teams/${wk}/${day}`] = { ...t, teamA: ren(A).map((name) => ({ name })), teamB: ren(B).map((name) => ({ name })) };
      });
    });

    if (!Object.keys(updates).length) return showToast(`Nessun dato trovato per "${from}"`, "error");
    const ok = await adminUpdate(updates, `${from} unito a ${target}`);
    if (ok) setMergeForm(null);
  };

  // ─── REGISTRO ATTIVITÀ ───
  const openLog = async () => {
    setShowLog(true);
    try {
      const snap = await get(query(ref(db, "logs"), limitToLast(300)));
      setLogs(Object.values(snap.val() || {}).sort((a, b) => b.t - a.t));
    } catch (err) {
      showToast("Impossibile caricare il registro", "error");
    }
  };

  // ─── RESET ───
  const resetWeek = async () => {
    if (!window.confirm("Azzerare tutte le liste e le squadre della settimana?\n(Puoi annullare subito dopo.)")) return;
    await adminUpdate({ [`signups/${weekId}`]: null, [`teams/${weekId}`]: null, [`signupMeta/${weekId}`]: null }, "Liste della settimana azzerate");
  };

  const resetAllStats = async () => {
    if (!window.confirm("ATTENZIONE: azzerare TUTTE le statistiche e lo storico?")) return;
    if (window.prompt('Per confermare scrivi AZZERA') !== "AZZERA") return showToast("Annullato", "error");
    await adminUpdate({ playerStats: null, matchHistory: null, ratingAdjust: null }, "Statistiche azzerate");
  };

  // ─── CONDIVISIONE WHATSAPP ───
  const openWhatsApp = (txt) => window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank");
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  const shareDay = (dayKey) => {
    const arr = daySignups(dayKey);
    const tit = arr.slice(0, MAX_PLAYERS), ris = arr.slice(MAX_PLAYERS, MAX_TOTAL);
    const free = MAX_PLAYERS - tit.length;
    let txt = `⚽ *FAZI LEAGUE* — ${dayLabel(dayKey)} ${formatDate(weekDates[dayKey])} ore ${TIME_STR}\n\n`;
    txt += tit.length ? tit.map((n, i) => `${i + 1}. ${n}`).join("\n") : "Ancora nessun iscritto";
    if (free > 0) txt += `\n\n🟢 Mancano ${free} giocator${free === 1 ? "e" : "i"}!`;
    else txt += `\n\n✅ Lista completa`;
    if (ris.length) txt += `\n🪑 Riserve: ${ris.join(", ")}`;
    txt += `\n\n👉 ${appUrl}`;
    openWhatsApp(txt);
  };

  const shareTeams = (dayKey, t) => {
    const pA = Math.round(winProb(teamAvg(t.A), teamAvg(t.B)) * 100);
    let txt = `⚔️ *FAZI LEAGUE* — Squadre ${dayLabel(dayKey)} ${formatDate(weekDates[dayKey])}\n\n`;
    const list = (names) => { const c = captainOf(names); return names.map((n) => (n === c ? `${n} (C)` : n)).join("\n"); };
    txt += `🟢 *SQUADRA A*\n${list(t.A)}\n\n🟡 *SQUADRA B*\n${list(t.B)}\n\n`;
    txt += `⚖️ Equilibrio ${pA}% – ${100 - pA}%\n👉 ${appUrl}`;
    openWhatsApp(txt);
  };

  // ─── ADMIN CON PIN ───
  const requestAdmin = async () => {
    try {
      const cfg = (await get(ref(db, "config/adminPin"))).val();
      if (cfg?.hash && lsGet("fazi_admin_token") === cfg.hash) {
        setAdminMode(true);
        showToast("🔧 Modalità admin attiva");
        return;
      }
      setPinModal({ mode: cfg?.hash ? "enter" : "create", pin: "", pin2: "", remember: true, error: "", cfg });
    } catch (err) {
      showToast("Errore di connessione", "error");
    }
  };

  const submitPin = async () => {
    const pm = pinModal;
    if (!pm || pm.checking) return;
    const pin = pm.pin.trim();
    if (!crypto?.subtle) return setPinModal({ ...pm, error: "Browser non supportato" });
    setPinModal({ ...pm, checking: true, error: "" });
    try {
      if (pm.mode === "enter") {
        const h = await hashPin(pin, pm.cfg.salt);
        if (h !== pm.cfg.hash) {
          logEvent("admin_fail", "Tentativo di accesso admin con PIN sbagliato");
          return setPinModal({ ...pm, pin: "", checking: false, error: "PIN sbagliato" });
        }
        lsSet("fazi_admin_token", pm.remember ? h : "");
        logEvent("admin", "Accesso admin");
      } else {
        if (pin.length < 6) return setPinModal({ ...pm, checking: false, error: "Almeno 6 caratteri" });
        if (pin !== pm.pin2.trim()) return setPinModal({ ...pm, checking: false, error: "I due PIN non coincidono" });
        const salt = randomSalt();
        const h = await hashPin(pin, salt);
        await set(ref(db, "config/adminPin"), { salt, hash: h, t: Date.now() });
        lsSet("fazi_admin_token", pm.remember ? h : "");
        logEvent("admin", pm.mode === "create" ? "PIN admin creato" : "PIN admin cambiato");
      }
      setPinModal(null);
      setAdminMode(true);
      showToast(pm.mode === "enter" ? "🔧 Modalità admin attiva" : "PIN salvato ✓");
    } catch (err) {
      setPinModal({ ...pm, checking: false, error: `Errore: ${err.message}` });
    }
  };

  const exitAdmin = (forget = false) => {
    if (forget) lsSet("fazi_admin_token", "");
    setAdminMode(false);
    showToast(forget ? "Admin chiuso, PIN richiesto al prossimo accesso" : "Modalità admin disattivata");
  };

  const handleTitleClick = () => {
    const n = adminClicks + 1;
    setAdminClicks(n);
    if (n >= 5) {
      setAdminClicks(0);
      if (adminMode) exitAdmin();
      else requestAdmin();
    }
    setTimeout(() => setAdminClicks(0), 3000);
  };

  const getSortedPlayers = (sortBy = "gamesPlayed") =>
    Object.values(playerStats)
      .filter((p) => p && p.gamesPlayed > 0)
      .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));

  const myName = norm(me);

  if (loading) {
    return (
      <div style={S.loadWrap}>
        <div style={S.spinner} />
        <p style={S.loadText}>Caricamento...</p>
      </div>
    );
  }

  const lastUndo = undoStack[undoStack.length - 1];

  return (
    <div style={S.container}>
      <div style={S.bgPattern} />
      {toast && <div style={{ ...S.toast, background: toast.type === "error" ? "#dc2626" : "#16a34a" }}>{toast.msg}</div>}

      {/* BARRA ADMIN */}
      {adminMode && (
        <div style={S.adminBar}>
          <span style={{ fontFamily: "'Oswald', sans-serif", letterSpacing: 2, color: "#eab308", fontSize: 13 }}>🔧 ADMIN</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {lastUndo && <button onClick={undoLast} style={S.adminBarBtn} title={lastUndo.label}>↩️ Annulla</button>}
            <button onClick={openLog} style={S.adminBarBtn}>📜 Registro</button>
            <button onClick={() => setMergeForm({ from: "", into: "" })} style={S.adminBarBtn}>🔀 Unisci</button>
            <button onClick={() => setPinModal({ mode: "change", pin: "", pin2: "", remember: true, error: "" })} style={S.adminBarBtn}>🔑 PIN</button>
            <button onClick={() => exitAdmin(window.confirm("Vuoi che questo telefono richieda il PIN al prossimo accesso?"))} style={{ ...S.adminBarBtn, color: "#f87171" }}>Esci</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "32px 20px 16px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div onClick={handleTitleClick} style={{ cursor: "pointer", userSelect: "none" }}>
          <svg width="140" height="164" viewBox="0 0 240 280" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="shieldGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1a3a2a" /><stop offset="100%" stopColor="#0a1a12" />
              </linearGradient>
              <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fbbf24" /><stop offset="50%" stopColor="#eab308" /><stop offset="100%" stopColor="#ca8a04" />
              </linearGradient>
              <linearGradient id="goldStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fde68a" /><stop offset="100%" stopColor="#b45309" />
              </linearGradient>
              <linearGradient id="silverGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e2e8f0" /><stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            </defs>
            <path d="M120 8 L218 55 L218 160 Q218 230 120 272 Q22 230 22 160 L22 55 Z" fill="url(#shieldGrad)" stroke="url(#goldStroke)" strokeWidth="4" />
            <path d="M120 20 L208 62 L208 158 Q208 222 120 260 Q32 222 32 158 L32 62 Z" fill="none" stroke="url(#goldGrad)" strokeWidth="1.5" opacity="0.4" />
            <path d="M55 58 Q120 35 185 58" stroke="url(#goldGrad)" strokeWidth="2" fill="none" />
            <path d="M65 66 Q120 46 175 66" stroke="url(#goldGrad)" strokeWidth="1" fill="none" opacity="0.4" />
            <polygon points="90,55 93,47 96,55 89,50 97,50" fill="url(#goldGrad)" />
            <polygon points="117,55 120,47 123,55 116,50 124,50" fill="url(#goldGrad)" />
            <polygon points="144,55 147,47 150,55 143,50 151,50" fill="url(#goldGrad)" />
            <text x="120" y="138" textAnchor="middle" fontFamily="Oswald, sans-serif" fontSize="72" fontWeight="700" letterSpacing="8" fill="url(#silverGrad)">FAZI</text>
            <line x1="48" y1="152" x2="98" y2="152" stroke="url(#goldGrad)" strokeWidth="1.5" />
            <line x1="142" y1="152" x2="192" y2="152" stroke="url(#goldGrad)" strokeWidth="1.5" />
            <text x="120" y="178" textAnchor="middle" fontFamily="Oswald, sans-serif" fontSize="26" fontWeight="400" letterSpacing="10" fill="url(#goldGrad)">LEAGUE</text>
            <path d="M70 200 Q120 215 170 200" stroke="url(#goldGrad)" strokeWidth="1.2" fill="none" opacity="0.4" />
            <path d="M85 210 Q120 220 155 210" stroke="url(#goldGrad)" strokeWidth="0.8" fill="none" opacity="0.3" />
          </svg>
        </div>
        <p style={S.subtitle}>Settimana {formatDate(weekDates.monday)} – {formatDate(weekDates.friday)}</p>
      </div>

      {/* TABS */}
      <div style={S.tabBar}>
        {[
          { id: "signup", label: "ISCRIZIONI", icon: "📋" },
          { id: "teams", label: "SQUADRE", icon: "⚔️" },
          { id: "careers", label: "CARRIERE", icon: "🎖️" },
          { id: "stats", label: "PRESENZE", icon: "🏃" },
          { id: "history", label: "STORICO", icon: "🏆" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...S.tabBtn, ...(tab === t.id ? S.tabActive : {}) }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>
            <span style={S.tabLabel}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ═══ TAB: ISCRIZIONI ═══ */}
      {tab === "signup" && (
        <div style={S.content}>
          <p style={{ textAlign: "center", color: "#64748b", fontSize: 13, marginBottom: 16 }}>
            ⏰ Partite alle <strong style={{ color: "#e2e8f0" }}>{TIME_STR}</strong> — la lista si chiude all'inizio della partita
          </p>

          <div style={S.inputSection}>
            <div style={{ ...S.inputWrap, position: "relative" }} ref={autocompleteRef}>
              <input
                type="text"
                placeholder="Il tuo nome..."
                value={playerName}
                onChange={(e) => {
                  const val = e.target.value;
                  if (BAD_CHARS.test(val)) { showToast("❌ Caratteri non permessi: . # $ / [ ]", "error"); return; }
                  setPlayerName(val);
                  setShowSuggestions(val.trim().length > 0);
                }}
                onFocus={() => playerName.trim().length > 0 && setShowSuggestions(true)}
                style={S.input}
                maxLength={20}
                autoComplete="off"
              />
              <div style={S.inputGlow} />
              {showSuggestions && (() => {
                const q = playerName.trim().toLowerCase();
                const suggestions = allNames.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q).slice(0, 6);
                if (!suggestions.length) return null;
                return (
                  <div style={S.suggestBox}>
                    {suggestions.map((name, i) => (
                      <div key={name}
                        onMouseDown={(e) => { e.preventDefault(); setPlayerName(name); setShowSuggestions(false); }}
                        onTouchEnd={(e) => { e.preventDefault(); setPlayerName(name); setShowSuggestions(false); }}
                        style={{ ...S.suggestItem, borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                        <span style={{ color: "#16a34a", fontSize: 13 }}>⚽</span>{name}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
          {adminMode ? (
            <p style={{ textAlign: "center", color: "#eab308", fontSize: 12, marginTop: -14, marginBottom: 16 }}>Admin: scrivi un nome per iscrivere chiunque (anche a lista chiusa). Tocca un iscritto per modificarlo.</p>
          ) : (
            <p style={{ textAlign: "center", color: "#64748b", fontSize: 12, marginTop: -14, marginBottom: 16 }}>
              {me ? (
                <>📱 Questo telefono è di <strong style={{ color: "#e2e8f0" }}>{me}</strong> · <span onClick={changeIdentity} style={{ color: "#4ade80", cursor: "pointer", textDecoration: "underline" }}>non sei tu?</span></>
              ) : "Alla prima iscrizione ti chiediamo chi sei: così ognuno gestisce il proprio nome."}
            </p>
          )}

          <div style={S.daysGrid}>
            {MATCH_DAYS.map((day) => {
              const playersArr = daySignups(day.key);
              const titolari = playersArr.slice(0, MAX_PLAYERS);
              const riserve = playersArr.slice(MAX_PLAYERS, MAX_TOTAL);
              const locked = isLocked(day.key);
              const isFull = playersArr.length >= MAX_TOTAL;
              const imIn = myName && hasName(playersArr, myName);
              const renderRow = (p, i, reserve) => {
                const mine = norm(p) === myName;
                const mt = metaOf(day.key, p);
                const byOther = mt && mt.by && mt.by !== "admin" && norm(mt.by) !== norm(p);
                const canTouch = adminMode || (!locked && canRemove(day.key, p));
                return (
                  <div key={`${reserve ? "r" : "t"}${i}-${p}`}
                    style={{
                      ...S.playerRow,
                      ...(reserve ? { borderLeft: "3px dashed rgba(234,179,8,0.4)", background: "rgba(234,179,8,0.05)" } : { borderLeft: i < 5 ? "3px solid rgba(22,163,74,0.5)" : "3px solid rgba(234,179,8,0.5)" }),
                      ...(mine ? { background: "rgba(22,163,74,0.14)" } : {}),
                      cursor: canTouch ? "pointer" : "default",
                    }}
                    onClick={() => {
                      if (adminMode) setAdminSheet({ dayKey: day.key, name: p });
                      else if (canTouch) handleRemove(day.key, p);
                    }}>
                    <span style={{ ...S.playerNum, ...(reserve ? { color: "#eab308" } : {}) }}>{reserve ? `R${i + 1}` : i + 1}</span>
                    <span style={S.playerNameText}>
                      {p}{mine && <span style={{ color: "#4ade80", fontSize: 11, marginLeft: 6 }}>(tu)</span>}
                      {byOther && <span style={S.byTag}>da {mt.by}</span>}
                    </span>
                    {adminMode ? <span style={{ fontSize: 13, color: "#eab308" }}>⋯</span> : canTouch && <span style={S.removeX}>✕</span>}
                  </div>
                );
              };
              return (
                <div key={day.key} style={{ ...S.dayCard, opacity: locked && !adminMode ? 0.7 : 1 }}>
                  <div style={S.dayHead}>
                    <div>
                      <span style={S.dayName}>{day.label}</span>
                      <span style={{ fontSize: 13, color: "#94a3b8", marginLeft: 8, fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>{formatDate(weekDates[day.key])}</span>
                    </div>
                    <span style={{ ...S.countBadge, background: titolari.length >= MAX_PLAYERS ? "#16a34a" : titolari.length >= 7 ? "#eab308" : "#475569" }}>
                      {titolari.length}/{MAX_PLAYERS}
                    </span>
                  </div>
                  {locked && (
                    <div style={{ padding: "6px 16px", background: "rgba(220,38,38,0.1)", borderBottom: "1px solid rgba(220,38,38,0.2)" }}>
                      <span style={{ fontSize: 12, color: "#f87171", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>🔒 LISTA CHIUSA{adminMode ? " — admin può ancora modificare" : ""}</span>
                    </div>
                  )}
                  <div style={S.playerList}>
                    {titolari.map((p, i) => renderRow(p, i, false))}
                    {riserve.length > 0 && (
                      <div style={{ padding: "4px 10px 2px", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#eab308", fontFamily: "'Oswald', sans-serif", letterSpacing: 2 }}>RISERVE</span>
                      </div>
                    )}
                    {riserve.map((p, i) => renderRow(p, i, true))}
                    {playersArr.length === 0 && <p style={S.emptyMsg}>Nessun iscritto</p>}
                  </div>
                  <div style={{ display: "flex", gap: 8, margin: "8px 12px 12px" }}>
                    <button onClick={() => handleSignup(day.key)} disabled={isFull || (locked && !adminMode) || (imIn && !adminMode)}
                      style={{
                        ...S.signBtn, margin: 0, flex: 1,
                        ...(isFull || (locked && !adminMode) || (imIn && !adminMode) ? S.signBtnFull : {}),
                        ...(locked && !adminMode ? { background: "rgba(220,38,38,0.1)", color: "#f87171" } : {}),
                      }}>
                      {locked && !adminMode ? "🔒 CHIUSA" : imIn && !adminMode ? "✓ SEI IN LISTA" : isFull ? "COMPLETO ✓" : titolari.length >= MAX_PLAYERS ? `RISERVA (${MAX_TOTAL - playersArr.length} posti)` : `MI ISCRIVO (${MAX_PLAYERS - titolari.length} posti)`}
                    </button>
                    <button onClick={() => shareDay(day.key)} style={S.shareBtn} title="Condividi su WhatsApp">📲</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={S.footer}>
            <p style={S.footerText}>📋 <strong>Iscrizioni:</strong> chiusura ore {TIME_STR}. Max {MAX_PLAYERS} titolari + {MAX_RESERVES} riserve. Tocca il tuo nome per toglierti.</p>
            <p style={S.footerSub}>👥 <strong>Iscrivi un amico?</strong> Si può: in lista comparirà "da" e il tuo nome. Puoi togliere solo te stesso o chi hai iscritto tu.</p>
            <p style={S.footerSub}>⚖️ <strong>Squadre:</strong> calcolate sui risultati delle partite giocate — si prova ogni combinazione e si sceglie la più equilibrata.</p>
            <p style={S.footerSub}>🏆 <strong>Tier:</strong> ROOKIE (0-9) → VETERANO (10-49) → ELITE (50-99) → LEGGENDA (100+)</p>
            <p style={{ ...S.footerSub, marginTop: 12, color: "#f59e0b" }}>⚠️ <strong>Usa sempre lo stesso nickname</strong> per non perdere le tue statistiche.</p>
            <p style={{ ...S.footerSub, color: "#f87171" }}>🚫 <strong>No caratteri speciali</strong> nel nome: vietati <code style={{ background: "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: 4 }}>. # $ / [ ]</code></p>
          </div>
        </div>
      )}

      {/* ═══ TAB: SQUADRE ═══ */}
      {tab === "teams" && (
        <div style={S.content}>
          <div style={S.dayBtns}>
            {MATCH_DAYS.map((day) => {
              const count = Math.min(daySignups(day.key).length, MAX_PLAYERS);
              return (
                <button key={day.key} onClick={() => { setSelectedDay(day.key); setEditingTeams(null); }}
                  style={{ ...S.daySelectBtn, ...(activeTeamsDay === day.key ? S.daySelectActive : {}), opacity: count < 2 ? 0.4 : 1 }}>
                  <span style={S.daySelectLabel}>{day.label} {formatDate(weekDates[day.key])}</span>
                  <span style={S.daySelectCount}>{count} giocatori</span>
                </button>
              );
            })}
          </div>

          {(() => {
            const day = activeTeamsDay;
            const dt = getDayTeams(day);
            if (!dt) return <p style={S.emptyState}>Servono almeno 2 iscritti per vedere le squadre di {dayLabel(day)}.</p>;
            const editing = editingTeams && editingTeams.day === day;
            const A = editing ? editingTeams.A : dt.A;
            const B = editing ? editingTeams.B : dt.B;
            const avgA = teamAvg(A), avgB = teamAvg(B);
            const pA = Math.round(winProb(avgA, avgB) * 100);
            const nTit = Math.min(daySignups(day).length, MAX_PLAYERS);
            const renderTeam = (names, side) => {
              const captain = captainOf(names);
              return (
              <div style={S.teamBox}>
                <div style={{ ...S.teamHeader, background: side === "A" ? "linear-gradient(135deg, rgba(22,163,74,0.2), rgba(22,163,74,0.05))" : "linear-gradient(135deg, rgba(234,179,8,0.2), rgba(234,179,8,0.05))" }}>
                  <span style={S.teamTitle}>{side === "A" ? "🟢 SQUADRA A" : "🟡 SQUADRA B"}</span>
                  <span style={S.teamPower}>{adminMode ? `OVR ${toOvr(side === "A" ? avgA : avgB)}` : `${names.length} giocatori`}</span>
                </div>
                {names.map((n) => (
                  <div key={n} style={{ ...S.teamPlayer, cursor: editing ? "pointer" : "default", ...(norm(n) === myName ? { background: "rgba(22,163,74,0.1)" } : {}) }}
                    onClick={() => editing && swapInEdit(n)}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>
                      {n}{n === captain && <span style={S.capBadge} title="Capitano">C</span>}
                    </span>
                    <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Oswald', sans-serif" }}>
                      {editing ? "⇄" : adminMode ? ovrOf(n) : ""}
                    </span>
                  </div>
                ))}
              </div>
              );
            };
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  {editing ? (
                    <span style={{ ...S.statusPill, color: "#eab308", border: "1px solid rgba(234,179,8,0.4)" }}>✏️ Tocca un giocatore per spostarlo nell'altra squadra</span>
                  ) : dt.fixed ? (
                    <span style={{ ...S.statusPill, color: "#4ade80", border: "1px solid rgba(74,222,128,0.4)" }}>📌 Squadre ufficiali</span>
                  ) : (
                    <span style={S.statusPill}>🔄 Provvisorie — cambiano se cambia la lista{nTit < MAX_PLAYERS ? ` (${nTit}/${MAX_PLAYERS})` : ""}</span>
                  )}
                  {adminMode && dt.outdated && !editing && (
                    <p style={{ color: "#f59e0b", fontSize: 12, marginTop: 8 }}>⚠️ Le squadre fissate non corrispondono più alla lista (qualcuno è entrato/uscito): ora vedi quelle automatiche. Fissale di nuovo.</p>
                  )}
                </div>

                <div style={S.teamVsRow}>
                  {renderTeam(A, "A")}
                  <div style={S.vsCircle}><span style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Oswald', sans-serif", color: "#64748b" }}>VS</span></div>
                  {renderTeam(B, "B")}
                </div>

                <div style={S.balanceBar}>
                  <div style={{ ...S.balanceFill, width: `${pA}%` }} />
                </div>
                <p style={S.balanceText}>
                  Equilibrio {pA}% – {100 - pA}%{Math.abs(pA - 50) <= 3 ? " — Partita apertissima ⚖️" : ""}
                </p>

                {editing ? (
                  <div style={S.teamActions}>
                    <button onClick={async () => { await fixTeams(day, A, B, "Squadre salvate"); setEditingTeams(null); }} style={{ ...S.actionBtn, ...S.actionPrimary }}>💾 SALVA</button>
                    <button onClick={() => setEditingTeams(null)} style={{ ...S.actionBtn, background: "#dc2626" }}>❌ ANNULLA</button>
                  </div>
                ) : (
                  <div style={S.teamActions}>
                    <button onClick={() => shareTeams(day, { A, B })} style={S.actionBtn}>📲 CONDIVIDI</button>
                    {adminMode && !dt.fixed && <button onClick={() => fixTeams(day, A, B)} style={S.actionBtn}>📌 FISSA</button>}
                    {adminMode && <button onClick={() => shuffleTeams(day)} style={S.actionBtn}>🔄 RIMESCOLA</button>}
                    {adminMode && <button onClick={() => setEditingTeams({ day, A: [...A], B: [...B] })} style={S.actionBtn}>✏️ MODIFICA</button>}
                    {adminMode && dt.fixed && <button onClick={() => unfixTeams(day)} style={S.actionBtn}>🔓 AUTOMATICHE</button>}
                    {adminMode && <button onClick={() => startMatchForm(day)} style={{ ...S.actionBtn, ...S.actionPrimary }}>✅ REGISTRA PARTITA</button>}
                  </div>
                )}
              </div>
            );
          })()}

          {matchForm && (
            <div style={S.overlay}>
              <div style={S.modal}>
                <h3 style={S.modalTitle}>Registra Partita — {dayLabel(matchForm.dayKey)}</h3>
                <div style={S.scoreRow}>
                  <ScorePicker label="🟢 Squadra A" value={matchForm.scoreA} onChange={(v) => setMatchForm((p) => ({ ...p, scoreA: v }))} />
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#64748b" }}>—</span>
                  <ScorePicker label="🟡 Squadra B" value={matchForm.scoreB} onChange={(v) => setMatchForm((p) => ({ ...p, scoreB: v }))} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={S.mvpLabel}>⭐ MVP DELLA PARTITA</label>
                  <select value={matchForm.mvp} onChange={(e) => setMatchForm((p) => ({ ...p, mvp: e.target.value }))} style={S.mvpSelect}>
                    <option value="">-- Seleziona MVP --</option>
                    {Object.entries(matchForm.players).filter(([, d]) => d.present).map(([name]) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={S.formHeader}>
                    <span style={{ flex: 2 }}>Giocatore</span>
                    <span style={{ flex: 1, textAlign: "center" }}>Squadra</span>
                    <span style={{ flex: 1, textAlign: "center" }}>Presente?</span>
                  </div>
                  {Object.entries(matchForm.players).map(([name, data]) => (
                    <div key={name} style={{ ...S.formRow, borderLeft: data.team === "A" ? "3px solid #16a34a" : "3px solid #eab308", opacity: data.present ? 1 : 0.4 }}>
                      <span style={{ flex: 2, fontWeight: 600, fontSize: 14 }}>{name}</span>
                      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                        <button style={{ ...S.sideChip, ...(data.team === "A" ? S.sideA : S.sideB) }}
                          onClick={() => setMatchForm((p) => ({ ...p, players: { ...p.players, [name]: { ...data, team: data.team === "A" ? "B" : "A" } } }))}>
                          {data.team}
                        </button>
                      </div>
                      <div style={{ flex: 1, display: "flex", justifyContent: "center", cursor: "pointer" }}
                        onClick={() => setMatchForm((p) => ({ ...p, players: { ...p.players, [name]: { ...data, present: !data.present } } }))}>
                        <span style={{ fontSize: 20 }}>{data.present ? "✅" : "❌"}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={S.addRow}>
                  <input list="all-names" placeholder="Aggiungi chi ha giocato..." value={matchForm.addName}
                    onChange={(e) => setMatchForm((p) => ({ ...p, addName: e.target.value }))} style={{ ...S.input, ...S.smallInput }} />
                  <button style={{ ...S.sideChip, ...(matchForm.addTeam === "A" ? S.sideA : S.sideB) }}
                    onClick={() => setMatchForm((p) => ({ ...p, addTeam: p.addTeam === "A" ? "B" : "A" }))}>{matchForm.addTeam}</button>
                  <button style={S.actionBtn} onClick={addToMatchForm}>＋</button>
                </div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
                  <button style={S.cancelBtn} onClick={() => setMatchForm(null)}>ANNULLA</button>
                  <button style={{ ...S.saveBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={saveMatchResult}>💾 SALVA PARTITA</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: CARRIERE ═══ */}
      {tab === "careers" && (
        <div style={S.content}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 28, letterSpacing: 3, color: "#eab308", margin: 0 }}>CARRIERE</h2>
            <button onClick={() => openProfileEditor(adminMode ? "" : playerName)} style={{ ...S.actionBtn, ...S.actionPrimary }}>+ CREA PROFILO</button>
          </div>
          <div style={{ display: "flex", gap: 16, overflowX: "auto", padding: "0 0 20px", WebkitOverflowScrolling: "touch" }}>
            {Object.entries(players)
              .filter(([, data]) => data)
              .map(([key, data]) => {
                const nick = data.nickname || key;
                const sk = Object.keys(playerStats).find((k) => k === statsKey(nick) || k === statsKey(key));
                const stats = sk ? playerStats[sk] : null;
                return { key, ...data, nickname: nick, presences: stats?.gamesPlayed || 0, wins: stats?.wins || 0, draws: stats?.draws || 0, losses: stats?.losses || 0, mvps: stats?.mvpCount || 0 };
              })
              .sort((a, b) => b.presences - a.presences)
              .map((p) => {
                const tier = getTierInfo(p.presences);
                const winRate = p.presences > 0 ? Math.round((p.wins / p.presences) * 100) : 0;
                const mine = norm(p.nickname) === myName;
                return (
                  <div key={p.key}
                    style={{ width: 190, borderRadius: 14, overflow: "hidden", border: `2px solid ${tier.color}`, background: "#0d1117", flexShrink: 0, position: "relative", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", cursor: adminMode || mine ? "pointer" : "default" }}
                    onClick={() => (adminMode ? startEditingPlayerStats(p.nickname) : mine && openProfileEditor(p.nickname))}>
                    {adminMode && (
                      <button onClick={(e) => { e.stopPropagation(); handleDeletePlayer(p.key, p.nickname); }} style={S.cardDelete}>✕</button>
                    )}
                    <div style={{ backgroundImage: tier.gradient, position: "relative", height: 200, overflow: "hidden" }}>
                      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(180deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)", pointerEvents: "none" }} />
                      <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 50, height: 16, borderRadius: "0 0 25px 25px", background: "rgba(0,0,0,0.25)" }} />
                      <div style={{ position: "absolute", top: 14, left: 0, width: "30%", height: 2, background: "rgba(0,0,0,0.12)" }} />
                      <div style={{ position: "absolute", top: 14, right: 0, width: "30%", height: 2, background: "rgba(0,0,0,0.12)" }} />
                      <div style={{ position: "absolute", top: 8, right: adminMode ? 34 : 8, background: "rgba(0,0,0,0.4)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontFamily: "'Oswald',sans-serif", letterSpacing: 2, color: "#fff", zIndex: 2 }}>{p.ruolo || "ATT"}</div>
                      <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.4)", borderRadius: 6, padding: "2px 8px", fontSize: 8, fontFamily: "'Oswald',sans-serif", letterSpacing: 2, color: "rgba(255,255,255,0.7)", zIndex: 2 }}>{tier.name}</div>
                      <div style={{ position: "absolute", top: 30, left: 0, right: 0, textAlign: "center", zIndex: 1 }}>
                        <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: p.nickname.length > 10 ? 13 : 17, fontWeight: 800, letterSpacing: 3, color: "#fff", textTransform: "uppercase", textShadow: "0 2px 4px rgba(0,0,0,0.3)", padding: "0 8px", wordBreak: "break-word", lineHeight: 1.2 }}>{p.nickname}</div>
                      </div>
                      <div style={{ position: "absolute", top: 55, left: 0, right: 0, textAlign: "center", zIndex: 1 }}>
                        <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 74, fontWeight: 800, color: "#fff", lineHeight: 1, textShadow: "0 3px 8px rgba(0,0,0,0.3)", letterSpacing: 4 }}>{p.numero || "?"}</div>
                      </div>
                      <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 4, zIndex: 1, flexWrap: "wrap", padding: "0 6px" }}>
                        {p.eta > 0 && <span style={S.cardChip}>{p.eta}y</span>}
                        {p.altezza > 0 && <span style={S.cardChip}>{p.altezza}cm</span>}
                        {p.peso > 0 && <span style={S.cardChip}>{p.peso}kg</span>}
                        {p.piede && <span style={S.cardChip}>🦶{p.piede[0]}</span>}
                        {adminMode && <span style={{ ...S.cardChip, color: "#fde68a" }}>OVR {ovrOf(p.nickname)}</span>}
                      </div>
                    </div>
                    <div style={{ padding: "8px 6px 4px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 3 }}>
                      {[["PRE", p.presences, "#4ade80"], ["MVP", p.mvps, "#eab308"], ["VIT", p.wins, "#16a34a"], ["SCO", p.losses, "#f87171"]].map(([lbl, val, col]) => (
                        <div key={lbl} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 5, padding: "3px 0", textAlign: "center" }}>
                          <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 14, fontWeight: 700, color: col, display: "block" }}>{val}</span>
                          <span style={{ fontSize: 7, fontFamily: "'Oswald',sans-serif", letterSpacing: 1, color: "#64748b" }}>{lbl}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "0 6px 8px" }}>
                      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 3, height: 5, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #16a34a, #4ade80)", width: `${winRate}%` }} />
                      </div>
                      <div style={{ textAlign: "center", fontSize: 8, color: "#64748b", fontFamily: "'Oswald',sans-serif", marginTop: 2, letterSpacing: 1 }}>{winRate}% WIN</div>
                    </div>
                    {adminMode && <div style={{ textAlign: "center", fontSize: 9, color: "#eab308", padding: "0 0 6px", fontFamily: "'Oswald',sans-serif" }}>Tocca per modificare</div>}
                    {!adminMode && mine && <div style={{ textAlign: "center", fontSize: 9, color: "#4ade80", padding: "0 0 6px", fontFamily: "'Oswald',sans-serif" }}>Tocca per aggiornare la tua card</div>}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ═══ TAB: PRESENZE ═══ */}
      {tab === "stats" && (
        <div style={S.content}>
          {getSortedPlayers().length === 0 ? (
            <p style={S.emptyState}>Nessuna statistica ancora. Gioca qualche partita e registra i risultati!</p>
          ) : (
            <>
              {getSortedPlayers().length >= 3 && (
                <div style={S.podium}>
                  {[1, 0, 2].map((pos) => {
                    const p = getSortedPlayers()[pos];
                    if (!p) return null;
                    const medals = ["🥇", "🥈", "🥉"];
                    const heights = [140, 100, 80];
                    return (
                      <div key={pos} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, order: pos === 0 ? 1 : pos === 1 ? 0 : 2 }}>
                        <span style={{ fontSize: pos === 0 ? 36 : 28 }}>{medals[pos]}</span>
                        <span style={S.podiumName}>{p.name}</span>
                        <span style={S.podiumRating}>{p.gamesPlayed} presenze</span>
                        <div style={{ width: 80, height: heights[pos], borderRadius: "12px 12px 0 0", background: pos === 0 ? "linear-gradient(180deg, #eab308, #a16207)" : pos === 1 ? "linear-gradient(180deg, #94a3b8, #64748b)" : "linear-gradient(180deg, #b45309, #78350f)" }} />
                      </div>
                    );
                  })}
                </div>
              )}
              {adminMode && <p style={{ textAlign: "center", color: "#eab308", fontSize: 12, marginBottom: 10 }}>Tocca una riga per correggere, eliminare o unire un giocatore.</p>}
              <div style={S.table}>
                <div style={S.tableHead}>
                  <span style={{ width: 30, textAlign: "center" }}>#</span>
                  <span style={{ flex: 3 }}>Giocatore</span>
                  <span style={{ flex: 1, textAlign: "center" }}>Pres.</span>
                  <span style={{ flex: 1, textAlign: "center" }}>V</span>
                  <span style={{ flex: 1, textAlign: "center" }}>P</span>
                  <span style={{ flex: 1, textAlign: "center" }}>S</span>
                  <span style={{ flex: 1, textAlign: "center" }}>MVP</span>
                  {adminMode && <span style={{ flex: 1, textAlign: "center" }}>OVR</span>}
                </div>
                {getSortedPlayers().map((p, i) => (
                  <div key={p.name + i} onClick={() => adminMode && startEditingPlayerStats(p.name)}
                    style={{ ...S.tableRow, background: norm(p.name) === myName ? "rgba(22,163,74,0.12)" : i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent", cursor: adminMode ? "pointer" : "default" }}>
                    <span style={{ width: 30, textAlign: "center", fontWeight: 700, color: i < 3 ? "#eab308" : "#64748b" }}>{i + 1}</span>
                    <span style={{ flex: 3, fontWeight: 600 }}>{p.name}</span>
                    <span style={{ flex: 1, textAlign: "center", fontWeight: 700, color: "#4ade80" }}>{p.gamesPlayed}</span>
                    <span style={{ flex: 1, textAlign: "center", color: "#16a34a" }}>{p.wins || 0}</span>
                    <span style={{ flex: 1, textAlign: "center", color: "#94a3b8" }}>{p.draws || 0}</span>
                    <span style={{ flex: 1, textAlign: "center", color: "#f87171" }}>{p.losses || 0}</span>
                    <span style={{ flex: 1, textAlign: "center", color: "#eab308" }}>{p.mvpCount || 0}</span>
                    {adminMode && <span style={{ flex: 1, textAlign: "center", color: "#fde68a", fontFamily: "'Oswald', sans-serif" }}>{ovrOf(p.name)}</span>}
                  </div>
                ))}
              </div>
              <div style={S.awards}>
                {[
                  { label: "🏃 Più presente", key: "gamesPlayed", val: (p) => p.gamesPlayed + " presenze" },
                  { label: "🏆 Più vittorie", key: "wins", val: (p) => (p.wins || 0) + " vittorie" },
                  { label: "⭐ Più MVP", key: "mvpCount", val: (p) => (p.mvpCount || 0) + " MVP" },
                ].map((stat) => {
                  const top = getSortedPlayers(stat.key)[0];
                  if (!top || !top[stat.key]) return null;
                  return (
                    <div key={stat.key} style={S.awardCard}>
                      <span style={{ fontSize: 12, color: "#64748b", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>{stat.label}</span>
                      <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{top.name}</span>
                      <span style={{ fontSize: 13, color: "#4ade80" }}>{stat.val(top)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ TAB: STORICO ═══ */}
      {tab === "history" && (
        <div style={S.content}>
          {matchHistory.length === 0 ? (
            <p style={S.emptyState}>Nessuna partita registrata.</p>
          ) : matchHistory.map((m) => {
            const tA = teamNames(m.teamA), tB = teamNames(m.teamB);
            return (
              <div key={m.id} style={{ ...S.histCard, cursor: adminMode ? "pointer" : "default" }} onClick={() => adminMode && startEditingMatch(m)}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, letterSpacing: 1.5 }}>{dayLabel(m.day)}</span>
                  <span style={{ fontSize: 13, color: "#64748b" }}>{new Date(m.date).toLocaleDateString("it-IT")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, fontFamily: "'Oswald', sans-serif", fontSize: 15, letterSpacing: 1, marginBottom: 12 }}>
                  <span style={{ color: m.winner === "A" ? "#4ade80" : "#e2e8f0" }}>Squadra A</span>
                  <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 3 }}>{m.scoreA} — {m.scoreB}</span>
                  <span style={{ color: m.winner === "B" ? "#4ade80" : "#e2e8f0" }}>Squadra B</span>
                </div>
                {m.mvp && <div style={{ textAlign: "center", marginBottom: 12, fontSize: 14, color: "#eab308", fontFamily: "'Oswald', sans-serif" }}>⭐ MVP: {m.mvp}</div>}
                {tA.length > 0 && tB.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                    <div style={{ ...S.histTeam, borderLeft: "3px solid #16a34a" }}>{tA.join(", ")}</div>
                    <div style={{ ...S.histTeam, borderLeft: "3px solid #eab308" }}>{tB.join(", ")}</div>
                  </div>
                ) : asArray(m.players).length > 0 && (
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 12, fontSize: 12 }}>
                    <div style={{ color: "#94a3b8", fontFamily: "'Oswald', sans-serif", marginBottom: 4 }}>{asArray(m.players).length} giocatori</div>
                    <div style={{ color: "#e2e8f0", lineHeight: 1.6 }}>{asArray(m.players).join(", ")}</div>
                  </div>
                )}
                {adminMode && <div style={{ marginTop: 12, fontSize: 11, color: "#eab308", textAlign: "center", fontFamily: "'Oswald', sans-serif" }}>Tocca per modificare o eliminare</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ MODALE: AZIONI ADMIN SU UN ISCRITTO ═══ */}
      {adminSheet && (() => {
        const arr = daySignups(adminSheet.dayKey);
        const idx = arr.indexOf(adminSheet.name);
        if (idx < 0) {
          return (
            <div style={S.overlay} onClick={() => setAdminSheet(null)}>
              <div style={S.modal}>
                <p style={{ textAlign: "center", color: "#94a3b8" }}>{adminSheet.name} non è più in lista. Tocca per chiudere.</p>
              </div>
            </div>
          );
        }
        return (
          <div style={S.overlay} onClick={() => setAdminSheet(null)}>
            <div style={S.modal} onClick={(e) => e.stopPropagation()}>
              <h3 style={S.modalTitle}>{adminSheet.name}</h3>
              <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, marginTop: -12, marginBottom: 18 }}>
                {dayLabel(adminSheet.dayKey)} · {idx < MAX_PLAYERS ? `titolare #${idx + 1}` : `riserva #${idx - MAX_PLAYERS + 1}`}
              </p>
              {(() => {
                const mt = metaOf(adminSheet.dayKey, adminSheet.name);
                if (!mt) return <p style={{ textAlign: "center", color: "#64748b", fontSize: 12, marginTop: -10, marginBottom: 16 }}>Nessuna info su chi l'ha iscritto (iscrizione fatta prima dell'aggiornamento).</p>;
                const d = new Date(mt.t);
                return (
                  <p style={{ textAlign: "center", color: norm(mt.by) === norm(adminSheet.name) ? "#64748b" : "#fcd34d", fontSize: 12, marginTop: -10, marginBottom: 16 }}>
                    Iscritto da <strong>{mt.by}</strong> · {d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric" })} {d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} · 📱{mt.dev}
                  </p>
                );
              })()}
              <div style={S.sheetGrid}>
                <button style={S.sheetBtn} onClick={() => sheetAction("rename")}>✏️ Correggi nome</button>
                {idx >= MAX_PLAYERS && <button style={S.sheetBtn} onClick={() => sheetAction("starter")}>⭐ Metti titolare</button>}
                <button style={S.sheetBtn} disabled={idx <= 0} onClick={() => sheetAction("up")}>⬆️ Sposta su</button>
                <button style={S.sheetBtn} disabled={idx >= arr.length - 1} onClick={() => sheetAction("down")}>⬇️ Sposta giù</button>
              </div>
              <p style={{ color: "#64748b", fontSize: 12, fontFamily: "'Oswald', sans-serif", letterSpacing: 1, margin: "16px 0 8px" }}>SPOSTA A UN ALTRO GIORNO</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MATCH_DAYS.filter((d) => d.key !== adminSheet.dayKey).map((d) => (
                  <button key={d.key} style={{ ...S.sheetBtn, flex: "1 1 30%" }} onClick={() => sheetAction("move", d.key)}>{d.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
                <button style={S.cancelBtn} onClick={() => setAdminSheet(null)}>CHIUDI</button>
                <button style={{ ...S.saveBtn, background: "#dc2626" }} onClick={() => sheetAction("remove")}>🗑️ TOGLI</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ MODALE: MODIFICA PARTITA ═══ */}
      {editingMatch && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={S.modalTitle}>Modifica Partita — {dayLabel(editingMatch.day)}</h3>
            <div style={S.scoreRow}>
              <ScorePicker label="🟢 Squadra A" value={editingMatch.scoreA} onChange={(v) => setEditingMatch((p) => ({ ...p, scoreA: v }))} />
              <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#64748b" }}>—</span>
              <ScorePicker label="🟡 Squadra B" value={editingMatch.scoreB} onChange={(v) => setEditingMatch((p) => ({ ...p, scoreB: v }))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={S.mvpLabel}>⭐ MVP DELLA PARTITA</label>
              <select value={editingMatch.mvp} onChange={(e) => setEditingMatch((p) => ({ ...p, mvp: e.target.value }))} style={S.mvpSelect}>
                <option value="">-- Seleziona MVP --</option>
                {editingMatch.list.filter((p) => !p.removed).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>

            {editingMatch.legacy && (
              <div style={S.warnBox}>
                <p style={{ marginBottom: 8 }}>
                  Partita registrata con la vecchia versione: le squadre non erano salvate.
                  {editingMatch.reconstructed ? " Le ho ricostruite dalle squadre di quella settimana: controllale." : " Assegna A/B a ciascun giocatore."}
                </p>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={editingMatch.confirmed} onChange={(e) => setEditingMatch((p) => ({ ...p, confirmed: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span>Confermo che le squadre qui sotto sono quelle giocate. Così ricalcolo anche vittorie e sconfitte. Senza spunta correggo solo risultato, MVP e presenze.</span>
                </label>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={S.formHeader}>
                <span style={{ flex: 2 }}>Giocatore</span>
                <span style={{ flex: 1, textAlign: "center" }}>Squadra</span>
                <span style={{ width: 36, textAlign: "center" }}></span>
              </div>
              {editingMatch.list.map((p, i) => (
                <div key={p.name + i} style={{ ...S.formRow, opacity: p.removed ? 0.35 : 1, borderLeft: p.team === "A" ? "3px solid #16a34a" : p.team === "B" ? "3px solid #eab308" : "3px solid #475569" }}>
                  <span style={{ flex: 2, fontWeight: 600, fontSize: 14, textDecoration: p.removed ? "line-through" : "none" }}>{p.name}{p.isNew && <span style={{ color: "#4ade80", fontSize: 11 }}> nuovo</span>}</span>
                  <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                    <button style={{ ...S.sideChip, ...(p.team === "A" ? S.sideA : p.team === "B" ? S.sideB : {}) }}
                      onClick={() => emUpdatePlayer(i, { team: p.team === "A" ? "B" : "A" })}>{p.team || "?"}</button>
                  </div>
                  <button style={{ ...S.miniBtn, width: 36 }} onClick={() => (p.isNew ? setEditingMatch((em) => ({ ...em, list: em.list.filter((_, j) => j !== i) })) : emUpdatePlayer(i, { removed: !p.removed }))}>
                    {p.removed ? "↩︎" : "✕"}
                  </button>
                </div>
              ))}
            </div>
            <div style={S.addRow}>
              <input list="all-names" placeholder="Aggiungi giocatore..." value={editingMatch.addName}
                onChange={(e) => setEditingMatch((p) => ({ ...p, addName: e.target.value }))} style={{ ...S.input, ...S.smallInput }} />
              <button style={{ ...S.sideChip, ...(editingMatch.addTeam === "A" ? S.sideA : S.sideB) }}
                onClick={() => setEditingMatch((p) => ({ ...p, addTeam: p.addTeam === "A" ? "B" : "A" }))}>{editingMatch.addTeam}</button>
              <button style={S.actionBtn} onClick={emAddPlayer}>＋</button>
            </div>
            <p style={{ color: "#64748b", fontSize: 12, marginTop: 10 }}>Le statistiche dei giocatori vengono ricalcolate in automatico. Puoi annullare dalla barra admin.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button style={{ ...S.cancelBtn, border: "1px solid #dc2626", color: "#f87171" }} disabled={busy} onClick={deleteMatch}>🗑️ ELIMINA</button>
              <button style={S.cancelBtn} onClick={() => setEditingMatch(null)}>ANNULLA</button>
              <button style={{ ...S.saveBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={saveEditedMatch}>💾 SALVA</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE: PROFILO ═══ */}
      {showProfileModal && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={S.modalTitle}>{profileForm.origKey ? "Modifica Profilo" : "Crea Profilo Giocatore"}</h3>
            <label style={S.fieldLabel}>NICKNAME (lo stesso che usi per iscriverti)</label>
            <input type="text" list="all-names" value={profileForm.nickname} maxLength={20} onChange={(e) => setProfileForm({ ...profileForm, nickname: e.target.value })} style={S.formInput} />
            <label style={S.fieldLabel}>NUMERO MAGLIA</label>
            <input type="number" inputMode="numeric" value={profileForm.numero} onChange={(e) => setProfileForm({ ...profileForm, numero: e.target.value })} style={S.formInput} />
            <label style={S.fieldLabel}>RUOLO</label>
            <select value={profileForm.ruolo} onChange={(e) => setProfileForm({ ...profileForm, ruolo: e.target.value })} style={S.formInput}>
              <option value="ATT">ATT — Attaccante</option><option value="CEN">CEN — Centrocampista</option>
              <option value="DIF">DIF — Difensore</option><option value="POR">POR — Portiere</option>
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><label style={S.fieldLabel}>ETÀ</label><input type="number" inputMode="numeric" value={profileForm.eta} onChange={(e) => setProfileForm({ ...profileForm, eta: e.target.value })} style={S.formInput} /></div>
              <div><label style={S.fieldLabel}>CM</label><input type="number" inputMode="numeric" value={profileForm.altezza} onChange={(e) => setProfileForm({ ...profileForm, altezza: e.target.value })} style={S.formInput} /></div>
              <div><label style={S.fieldLabel}>KG</label><input type="number" inputMode="numeric" value={profileForm.peso} onChange={(e) => setProfileForm({ ...profileForm, peso: e.target.value })} style={S.formInput} /></div>
            </div>
            <label style={S.fieldLabel}>PIEDE</label>
            <select value={profileForm.piede} onChange={(e) => setProfileForm({ ...profileForm, piede: e.target.value })} style={{ ...S.formInput, marginBottom: 20 }}>
              <option>Destro</option><option>Sinistro</option><option>Ambidestro</option>
            </select>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button style={S.cancelBtn} onClick={() => { setShowProfileModal(false); setProfileForm(EMPTY_PROFILE); }}>ANNULLA</button>
              <button style={S.saveBtn} onClick={handleSaveProfile}>💾 SALVA</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE: STATISTICHE GIOCATORE (admin) ═══ */}
      {editingPlayer && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={S.modalTitle}>{editingPlayer.nickname}</h3>
            <p style={{ textAlign: "center", color: "#fde68a", fontFamily: "'Oswald', sans-serif", marginTop: -12, marginBottom: 16 }}>
              OVR attuale {ovrOf(editingPlayer.nickname)} · {ratings[editingPlayer.key]?.eloGames || 0} partite con squadre note
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[["PRESENZE", "gamesPlayed"], ["MVP", "mvpCount"], ["VITTORIE", "wins"], ["PAREGGI", "draws"], ["SCONFITTE", "losses"]].map(([label, field]) => (
                <div key={field}>
                  <label style={S.fieldLabel}>{label}</label>
                  <input type="number" inputMode="numeric" value={editingPlayer[field]} onChange={(e) => setEditingPlayer({ ...editingPlayer, [field]: e.target.value })} style={S.formInput} />
                </div>
              ))}
              <div>
                <label style={S.fieldLabel}>CORREZIONE FORZA (±20)</label>
                <input type="number" inputMode="numeric" value={editingPlayer.adj} onChange={(e) => setEditingPlayer({ ...editingPlayer, adj: e.target.value })} style={S.formInput} />
              </div>
            </div>
            <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 16px" }}>
              Correzione forza: punti OVR in più o in meno, utile per chi è nuovo e sai già che è forte (o scarso). 0 = automatico.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 16 }}>
              <button style={S.sheetBtn} onClick={() => { const n = editingPlayer.nickname; setEditingPlayer(null); openProfileEditor(n); }}>🎖️ Profilo / card</button>
              <button style={S.sheetBtn} onClick={() => { const n = editingPlayer.nickname; setEditingPlayer(null); setMergeForm({ from: n, into: "" }); }}>🔀 Unisci / rinomina</button>
              <button style={{ ...S.sheetBtn, color: "#f87171" }} onClick={deletePlayerStats}>🗑️ Elimina statistiche</button>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button style={S.cancelBtn} onClick={() => setEditingPlayer(null)}>ANNULLA</button>
              <button style={{ ...S.saveBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={saveEditedPlayerStats}>💾 SALVA</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE: UNISCI / RINOMINA ═══ */}
      {mergeForm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={S.modalTitle}>🔀 Unisci o rinomina giocatore</h3>
            <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
              Per i doppioni (es. "Gio" e "Gio La Catapulta") o per correggere un nome ovunque. Somma le statistiche e aggiorna storico, liste, squadre e card.
              Se il secondo nome non esiste, è una semplice rinomina.
            </p>
            <label style={S.fieldLabel}>DA (sparisce)</label>
            <select value={mergeForm.from} onChange={(e) => setMergeForm({ ...mergeForm, from: e.target.value })} style={S.formInput}>
              <option value="">-- Scegli --</option>
              {allNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <label style={S.fieldLabel}>IN (resta)</label>
            <input list="all-names" value={mergeForm.into} maxLength={20} onChange={(e) => setMergeForm({ ...mergeForm, into: e.target.value })} style={S.formInput} placeholder="Nome esistente o nuovo" />
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 8 }}>
              <button style={S.cancelBtn} onClick={() => setMergeForm(null)}>ANNULLA</button>
              <button style={{ ...S.saveBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={mergePlayers}>🔀 UNISCI</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE: REGISTRO ATTIVITÀ ═══ */}
      {showLog && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <h3 style={S.modalTitle}>📜 Registro attività</h3>
            <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
              Ogni telefono ha un codice (📱) e il nome di chi lo usa. In giallo le cose da controllare: iscrizioni e cancellazioni fatte per altri, cambi di identità, PIN sbagliati.
            </p>
            <input placeholder="Filtra (nome, giorno, codice...)" value={logFilter} onChange={(e) => setLogFilter(e.target.value)} style={{ ...S.formInput, marginBottom: 8 }} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#fcd34d", marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={logOnlySuspect} onChange={(e) => setLogOnlySuspect(e.target.checked)} /> Solo da controllare
            </label>
            <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
              {logs
                .filter((l) => !logOnlySuspect || SUSPECT_TYPES.includes(l.type))
                .filter((l) => !logFilter || JSON.stringify(l).toLowerCase().includes(logFilter.toLowerCase())).map((l, i) => {
                const d = new Date(l.t);
                const icon = LOG_ICONS[l.type] || "🔧";
                const suspect = SUSPECT_TYPES.includes(l.type);
                return (
                  <div key={i} style={{ ...S.logRow, ...(suspect ? { background: l.type === "admin_fail" ? "rgba(220,38,38,0.1)" : "rgba(245,158,11,0.08)", color: "#fde68a" } : {}) }}>
                    <span style={{ color: "#64748b", fontSize: 11, minWidth: 74 }}>
                      {d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "numeric" })} {d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span style={{ flex: 1 }}>{icon} {l.detail}</span>
                    <span style={{ color: "#64748b", fontSize: 11, textAlign: "right" }}>📱{l.dev}{l.me ? ` · ${l.me}` : ""}</span>
                  </div>
                );
              })}
              {logs.length === 0 && <p style={S.emptyMsg}>Ancora nessuna attività registrata.</p>}
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              <button style={S.cancelBtn} onClick={() => setShowLog(false)}>CHIUDI</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE: PIN ADMIN ═══ */}
      {pinModal && (
        <div style={S.overlay}>
          <div style={{ ...S.modal, maxWidth: 380 }}>
            <h3 style={S.modalTitle}>
              {pinModal.mode === "enter" ? "🔒 PIN admin" : pinModal.mode === "create" ? "🔑 Crea il PIN admin" : "🔑 Cambia PIN admin"}
            </h3>
            {pinModal.mode !== "enter" && (
              <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
                Almeno 6 caratteri. Se lo cambi, tutti i telefoni "ricordati" dovranno reinserirlo.
              </p>
            )}
            <input type="password" autoFocus placeholder="PIN" value={pinModal.pin}
              onChange={(e) => setPinModal({ ...pinModal, pin: e.target.value, error: "" })}
              onKeyDown={(e) => e.key === "Enter" && pinModal.mode === "enter" && submitPin()}
              style={{ ...S.formInput, textAlign: "center", letterSpacing: 4 }} />
            {pinModal.mode !== "enter" && (
              <input type="password" placeholder="Ripeti PIN" value={pinModal.pin2}
                onChange={(e) => setPinModal({ ...pinModal, pin2: e.target.value, error: "" })}
                style={{ ...S.formInput, textAlign: "center", letterSpacing: 4 }} />
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#94a3b8", marginBottom: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={pinModal.remember} onChange={(e) => setPinModal({ ...pinModal, remember: e.target.checked })} />
              Ricorda questo telefono (solo sul tuo)
            </label>
            {pinModal.error && <p style={{ color: "#f87171", fontSize: 13, textAlign: "center", marginBottom: 12 }}>{pinModal.error}</p>}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button style={S.cancelBtn} onClick={() => setPinModal(null)}>ANNULLA</button>
              <button style={{ ...S.saveBtn, opacity: pinModal.checking ? 0.6 : 1 }} disabled={pinModal.checking} onClick={submitPin}>
                {pinModal.checking ? "..." : pinModal.mode === "enter" ? "ENTRA" : "SALVA PIN"}
              </button>
            </div>
          </div>
        </div>
      )}

      <datalist id="all-names">
        {allNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      {/* ADMIN */}
      {adminMode && (
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "24px 20px" }}>
          <p style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 3, color: "#eab308", marginBottom: 12 }}>🔧 Modalità Admin</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={resetWeek} style={S.resetBtn}>AZZERA LISTE SETTIMANA</button>
            <button onClick={resetAllStats} style={{ ...S.resetBtn, border: "2px solid #dc2626", color: "#dc2626" }}>AZZERA TUTTE LE STATISTICHE</button>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  container: { position: "relative", minHeight: "100vh", background: "linear-gradient(145deg, #0a1628 0%, #0f2218 40%, #1a1a2e 100%)", fontFamily: "'Source Sans 3', sans-serif", color: "#e2e8f0", overflow: "hidden", paddingBottom: 40 },
  bgPattern: { position: "fixed", inset: 0, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(22,163,74,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(234,179,8,0.05) 0%, transparent 50%)", pointerEvents: "none", zIndex: 0 },
  loadWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a1628" },
  spinner: { width: 48, height: 48, border: "4px solid rgba(22,163,74,0.2)", borderTopColor: "#16a34a", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  loadText: { marginTop: 16, color: "#94a3b8", fontFamily: "'Oswald', sans-serif", fontSize: 18, letterSpacing: 2 },
  toast: { position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", padding: "12px 28px", borderRadius: 12, color: "white", fontWeight: 600, fontSize: 15, zIndex: 1000, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxWidth: "90vw", textAlign: "center" },
  adminBar: { position: "sticky", top: 0, zIndex: 400, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(26,26,46,0.96)", borderBottom: "1px solid rgba(234,179,8,0.3)", backdropFilter: "blur(6px)" },
  adminBarBtn: { padding: "6px 10px", fontSize: 12, fontFamily: "'Oswald', sans-serif", letterSpacing: 1, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0", cursor: "pointer" },
  subtitle: { fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 4, color: "#64748b", marginTop: 6, textTransform: "uppercase" },
  tabBar: { position: "relative", zIndex: 1, display: "flex", justifyContent: "center", gap: 4, padding: "0 12px 20px", flexWrap: "wrap" },
  tabBtn: { display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, color: "#94a3b8", cursor: "pointer", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1, transition: "all 0.2s" },
  tabActive: { background: "rgba(22,163,74,0.15)", border: "1px solid rgba(22,163,74,0.3)", color: "#4ade80" },
  tabLabel: { fontSize: 12, letterSpacing: 1.5 },
  content: { position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "0 16px" },
  sectionDesc: { textAlign: "center", color: "#64748b", fontSize: 14, marginBottom: 20 },
  inputSection: { display: "flex", justifyContent: "center", marginBottom: 24 },
  inputWrap: { position: "relative", width: "100%", maxWidth: 380 },
  input: { width: "100%", padding: "14px 20px", fontSize: 17, fontFamily: "'Source Sans 3', sans-serif", fontWeight: 600, background: "rgba(255,255,255,0.06)", border: "2px solid rgba(22,163,74,0.3)", borderRadius: 14, color: "#e2e8f0", outline: "none", textAlign: "center", boxSizing: "border-box", letterSpacing: 1 },
  smallInput: { padding: "10px 12px", fontSize: 15, textAlign: "left", flex: 1, minWidth: 0 },
  formInput: { width: "100%", padding: "11px 14px", fontSize: 16, fontFamily: "'Source Sans 3', sans-serif", fontWeight: 600, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#e2e8f0", outline: "none", boxSizing: "border-box", marginBottom: 12 },
  fieldLabel: { display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4, fontFamily: "'Oswald', sans-serif", letterSpacing: 1 },
  inputGlow: { position: "absolute", bottom: -2, left: "10%", right: "10%", height: 2, background: "linear-gradient(90deg, transparent, #16a34a, transparent)", borderRadius: 2 },
  suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#1a1a2e", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 12, overflow: "hidden", zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" },
  suggestItem: { padding: "12px 18px", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 },
  daysGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 },
  dayCard: { background: "rgba(255,255,255,0.04)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" },
  dayHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 8px" },
  dayName: { fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" },
  countBadge: { padding: "3px 12px", borderRadius: 16, fontSize: 13, fontWeight: 700, fontFamily: "'Oswald', sans-serif", letterSpacing: 1, color: "white" },
  playerList: { padding: "4px 12px", minHeight: 60 },
  playerRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 3, borderRadius: 8, background: "rgba(255,255,255,0.02)", transition: "background 0.15s" },
  playerNum: { fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#64748b", width: 18, textAlign: "center" },
  playerNameText: { fontSize: 14, fontWeight: 600, flex: 1 },
  removeX: { fontSize: 12, color: "#f87171", fontWeight: 700 },
  emptyMsg: { color: "#475569", fontSize: 13, textAlign: "center", padding: 12 },
  signBtn: { width: "calc(100% - 24px)", margin: "8px 12px 12px", padding: "12px", fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", border: "none", borderRadius: 12, cursor: "pointer", background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", boxShadow: "0 4px 16px rgba(22,163,74,0.3)" },
  signBtnFull: { background: "rgba(22,163,74,0.15)", color: "#16a34a", boxShadow: "none", cursor: "default" },
  shareBtn: { width: 48, flexShrink: 0, borderRadius: 12, border: "1px solid rgba(37,211,102,0.35)", background: "rgba(37,211,102,0.1)", fontSize: 18, cursor: "pointer" },
  footer: { textAlign: "center", padding: "24px 0 0", color: "#64748b", fontSize: 13 },
  footerText: { fontSize: 13, margin: "4px 0" },
  footerSub: { fontSize: 13, margin: "4px 0" },
  dayBtns: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 20 },
  daySelectBtn: { padding: "10px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, transition: "all 0.2s", minWidth: 100, color: "#e2e8f0" },
  daySelectActive: { background: "rgba(22,163,74,0.15)", border: "1px solid rgba(22,163,74,0.4)" },
  daySelectLabel: { fontFamily: "'Oswald', sans-serif", fontSize: 15, letterSpacing: 1.5 },
  daySelectCount: { fontSize: 11, color: "#64748b" },
  statusPill: { display: "inline-block", padding: "6px 14px", borderRadius: 20, border: "1px solid rgba(148,163,184,0.3)", fontSize: 12, color: "#94a3b8", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 },
  teamVsRow: { display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" },
  teamBox: { flex: 1, minWidth: 200, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)" },
  teamHeader: { padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  teamTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 16, letterSpacing: 2, fontWeight: 600 },
  teamPower: { fontSize: 13, color: "#94a3b8", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 },
  teamPlayer: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.04)" },
  capBadge: { display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: 8, width: 18, height: 18, fontSize: 11, fontWeight: 700, borderRadius: "50%", background: "#eab308", color: "#1a1a2e", fontFamily: "'Oswald', sans-serif", verticalAlign: "middle" },
  vsCircle: { width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "center", flexShrink: 0 },
  balanceBar: { height: 6, borderRadius: 3, background: "rgba(234,179,8,0.35)", margin: "16px 0 6px", overflow: "hidden" },
  balanceFill: { height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #16a34a, #4ade80)", transition: "width 0.5s" },
  balanceText: { textAlign: "center", fontSize: 13, color: "#94a3b8", marginBottom: 16 },
  teamActions: { display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" },
  actionBtn: { padding: "10px 16px", fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 1.5, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "rgba(255,255,255,0.05)", color: "#e2e8f0", cursor: "pointer" },
  actionPrimary: { background: "linear-gradient(135deg, #16a34a, #15803d)", border: "none", color: "white" },
  overlay: { position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" },
  modal: { background: "#1a1a2e", borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", padding: 24, maxWidth: 600, width: "100%" },
  modalTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 20, letterSpacing: 2, textAlign: "center", margin: "0 0 20px" },
  scoreRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 24 },
  scoreTeam: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  scoreLabel: { fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 1.5 },
  scoreControl: { display: "flex", alignItems: "center", gap: 12 },
  scoreBtn: { width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#e2e8f0", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Oswald', sans-serif" },
  scoreNum: { fontFamily: "'Oswald', sans-serif", fontSize: 36, fontWeight: 700, minWidth: 40, textAlign: "center" },
  mvpLabel: { display: "block", fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 1.5, color: "#eab308", marginBottom: 8 },
  mvpSelect: { width: "100%", padding: "12px", background: "#1a202c", border: "2px solid #eab308", borderRadius: 10, color: "#e2e8f0", fontFamily: "'Oswald', sans-serif", fontSize: 15, cursor: "pointer" },
  formHeader: { display: "flex", padding: "8px 12px", fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.06)" },
  formRow: { display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)" },
  sideChip: { width: 34, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#e2e8f0", fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", flexShrink: 0 },
  sideA: { background: "rgba(22,163,74,0.25)", border: "1px solid #16a34a", color: "#4ade80" },
  sideB: { background: "rgba(234,179,8,0.2)", border: "1px solid #eab308", color: "#fde68a" },
  miniBtn: { height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 14 },
  addRow: { display: "flex", gap: 8, alignItems: "center" },
  warnBox: { background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: 12, fontSize: 13, color: "#fcd34d", marginBottom: 16, lineHeight: 1.45 },
  sheetGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  sheetBtn: { padding: "12px 10px", fontSize: 14, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0", cursor: "pointer" },
  cancelBtn: { padding: "10px 24px", fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 1.5, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "transparent", color: "#94a3b8", cursor: "pointer" },
  saveBtn: { padding: "10px 24px", fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 1.5, border: "none", borderRadius: 10, background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", cursor: "pointer" },
  emptyState: { textAlign: "center", color: "#64748b", fontSize: 15, padding: 40 },
  podium: { display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 12, marginBottom: 32 },
  podiumName: { fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: 1, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  podiumRating: { fontFamily: "'Oswald', sans-serif", fontSize: 13, color: "#94a3b8" },
  table: { borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 24 },
  tableHead: { display: "flex", padding: "10px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#64748b", textTransform: "uppercase", background: "rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.06)" },
  tableRow: { display: "flex", padding: "8px 14px", alignItems: "center", fontSize: 14, borderBottom: "1px solid rgba(255,255,255,0.02)" },
  awards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 8 },
  awardCard: { background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 4, border: "1px solid rgba(255,255,255,0.06)" },
  histCard: { background: "rgba(255,255,255,0.04)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", padding: 16, marginBottom: 12 },
  histTeam: { background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", lineHeight: 1.6 },
  cardChip: { fontSize: 8, color: "rgba(255,255,255,0.6)", fontFamily: "'Oswald',sans-serif", background: "rgba(0,0,0,0.25)", borderRadius: 4, padding: "1px 5px" },
  cardDelete: { position: "absolute", top: 6, right: 6, background: "#dc2626", border: "none", color: "#fff", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: "bold", zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center" },
  byTag: { marginLeft: 8, fontSize: 10, color: "#fcd34d", background: "rgba(245,158,11,0.12)", borderRadius: 4, padding: "1px 6px", fontWeight: 600, whiteSpace: "nowrap" },
  logRow: { display: "flex", gap: 8, alignItems: "baseline", padding: "8px 4px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13, flexWrap: "wrap" },
  resetBtn: { padding: "10px 24px", fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", border: "2px solid #eab308", borderRadius: 10, background: "transparent", color: "#eab308", cursor: "pointer" },
};
