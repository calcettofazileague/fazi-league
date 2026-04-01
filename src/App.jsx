import { useState, useEffect, useRef } from "react";
import { db } from "./firebase.js";
import { ref, set, onValue } from "firebase/database";

// ─── CONFIG ───
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
const TEAM_SIZE = 5;
const MATCH_HOUR = 19;
const MATCH_MINUTE = 30;
const LOCK_HOURS_BEFORE = 6;

// ─── TIERS ───
const getTier = (p) => {
  if (p >= 100) return { name: "LEGGENDA", color: "#c0c0f0", bg: "linear-gradient(135deg,#6366f1,#818cf8,#a5b4fc)", border: "#818cf8" };
  if (p >= 50) return { name: "ELITE", color: "#fbbf24", bg: "linear-gradient(135deg,#d97706,#f59e0b,#fbbf24)", border: "#f59e0b" };
  if (p >= 10) return { name: "VETERANO", color: "#94a3b8", bg: "linear-gradient(135deg,#64748b,#94a3b8,#cbd5e1)", border: "#94a3b8" };
  return { name: "ROOKIE", color: "#b45309", bg: "linear-gradient(135deg,#78350f,#b45309,#d97706)", border: "#b45309" };
};

// ─── WEEK HELPERS ───
const getActiveMonday = () => {
  const now = new Date();
  const d = now.getDay();
  const mon = new Date(now);
  mon.setHours(0,0,0,0);
  if (d >= 1 && d <= 5) mon.setDate(now.getDate() - (d - 1));
  else mon.setDate(now.getDate() + (d === 0 ? 1 : 2));
  return mon;
};
const getWeekId = () => {
  const m = getActiveMonday();
  return `${m.getFullYear()}-W${Math.floor((m - new Date(m.getFullYear(),0,1)) / 604800000)}`;
};
const getWeekDates = () => {
  const m = getActiveMonday();
  const d = {};
  MATCH_DAYS.forEach((day, i) => { const dt = new Date(m); dt.setDate(m.getDate() + i); d[day.key] = dt; });
  return d;
};
const fmtDate = (dt) => {
  const mo = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
  return `${dt.getDate()} ${mo[dt.getMonth()]}`;
};
const isLocked = (dk) => {
  const dt = getWeekDates()[dk];
  if (!dt) return false;
  const lt = new Date(dt);
  lt.setHours(MATCH_HOUR - LOCK_HOURS_BEFORE, MATCH_MINUTE, 0, 0);
  return new Date() >= lt;
};
const isMatchValid = (dk, su) => (su[dk] || []).length >= MAX_PLAYERS;

// ─── BALANCE ALGORITHM ───
function balanceTeams(players, stats) {
  const sc = players.map(n => ({ name: n, presenze: (stats[n.toLowerCase()] || {}).gamesPlayed || 0 }));
  sc.sort((a,b) => b.presenze - a.presenze);
  const tA = [], tB = [];
  let sA = 0, sB = 0;
  for (const p of sc) {
    if (tA.length >= TEAM_SIZE) { tB.push(p); sB += p.presenze; }
    else if (tB.length >= TEAM_SIZE) { tA.push(p); sA += p.presenze; }
    else if (sA <= sB) { tA.push(p); sA += p.presenze; }
    else { tB.push(p); sB += p.presenze; }
  }
  return { teamA: tA, teamB: tB, sumA: sA, sumB: sB };
}

// ─── FIREBASE ───
const fbW = (p, d) => set(ref(db, p), d).catch(e => console.error(e));
const fbL = (p, cb) => onValue(ref(db, p), s => cb(s.val()));

// ─── JERSEY CARD (back of shirt design) ───
function JerseyCard({ name, presenze, mvpCount, wins, losses, numero, ruolo, eta, altezza, peso, piede, onEdit, onDelete }) {
  const t = getTier(presenze || 0);
  const displayNum = numero || "?";
  const displayName = (name || "GIOCATORE").toUpperCase();
  return (
    <div style={{ width: 170, borderRadius: 14, overflow: "hidden", border: `2px solid ${t.border}`, background: "#0d1117", flexShrink: 0, cursor: onEdit ? "pointer" : "default", position: "relative" }} onClick={onEdit}>
      {/* Delete button (admin only) */}
      {onDelete && <div onClick={e => { e.stopPropagation(); onDelete(); }} style={{ position: "absolute", top: 4, right: 4, zIndex: 10, width: 22, height: 22, borderRadius: "50%", background: "rgba(220,38,38,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#fff", lineHeight: 1 }}>✕</div>}
      {/* === JERSEY TOP (back of shirt) === */}
      <div style={{ background: t.bg, position: "relative", height: 190, overflow: "hidden" }}>
        {/* Shirt texture - subtle V lines */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(180deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)", pointerEvents: "none" }} />
        {/* Collar */}
        <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 50, height: 16, borderRadius: "0 0 25px 25px", background: "rgba(0,0,0,0.25)" }} />
        {/* Shoulder seams */}
        <div style={{ position: "absolute", top: 14, left: 0, width: "30%", height: 2, background: "rgba(0,0,0,0.12)" }} />
        <div style={{ position: "absolute", top: 14, right: 0, width: "30%", height: 2, background: "rgba(0,0,0,0.12)" }} />
        {/* Center back seam */}
        <div style={{ position: "absolute", top: 16, left: "50%", width: 1, height: "100%", background: "rgba(0,0,0,0.05)" }} />
        
        {/* Role badge top-right */}
        {ruolo && <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.4)", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontFamily: "'Oswald',sans-serif", letterSpacing: 2, color: "#fff", zIndex: 2 }}>{ruolo}</div>}
        
        {/* Tier badge top-left */}
        <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.4)", borderRadius: 6, padding: "2px 8px", fontSize: 8, fontFamily: "'Oswald',sans-serif", letterSpacing: 2, color: "rgba(255,255,255,0.7)", zIndex: 2 }}>{t.name}</div>
        
        {/* NAME on jersey (like printed text) */}
        <div style={{ position: "absolute", top: 32, left: 0, right: 0, textAlign: "center", zIndex: 1 }}>
          <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: displayName.length > 10 ? 13 : 16, fontWeight: 800, letterSpacing: 3, color: "#fff", textTransform: "uppercase", textShadow: "0 2px 4px rgba(0,0,0,0.3), 0 0 1px rgba(0,0,0,0.2)", padding: "0 8px", wordBreak: "break-word", lineHeight: 1.2 }}>{displayName}</div>
        </div>
        
        {/* BIG NUMBER */}
        <div style={{ position: "absolute", top: 58, left: 0, right: 0, textAlign: "center", zIndex: 1 }}>
          <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 72, fontWeight: 800, color: "#fff", lineHeight: 1, textShadow: "0 3px 8px rgba(0,0,0,0.3), 2px 2px 0 rgba(0,0,0,0.1)", letterSpacing: 4 }}>{displayNum}</div>
        </div>
        
        {/* Physical info at bottom of jersey */}
        <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, zIndex: 1 }}>
          {eta && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'Oswald',sans-serif", letterSpacing: 1, background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "1px 6px" }}>{eta}y</span>}
          {altezza && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'Oswald',sans-serif", letterSpacing: 1, background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "1px 6px" }}>{altezza}cm</span>}
          {peso && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'Oswald',sans-serif", letterSpacing: 1, background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "1px 6px" }}>{peso}kg</span>}
          {piede && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'Oswald',sans-serif", letterSpacing: 1, background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "1px 6px" }}>🦶{piede[0]}</span>}
        </div>
      </div>
      
      {/* === STATS BOTTOM === */}
      <div style={{ padding: "8px 8px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {[["PRE", presenze||0],["⭐", mvpCount||0],["VIT", wins||0],["SCO", losses||0]].map(([l,v],i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "4px 0", textAlign: "center" }}>
            <span style={{ fontFamily: "'Oswald',sans-serif", fontSize: 16, fontWeight: 700, color: "#e2e8f0", display: "block" }}>{v}</span>
            <span style={{ fontSize: 8, fontFamily: "'Oswald',sans-serif", letterSpacing: 1.5, color: "#64748b" }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ MAIN APP ═══
export default function App() {
  const [tab, setTab] = useState("signup");
  const [playerName, setPlayerName] = useState("");
  const [signups, setSignups] = useState({});
  const [playerStats, setPlayerStats] = useState({});
  const [matchHistory, setMatchHistory] = useState([]);
  const [generatedTeams, setGeneratedTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [weekId] = useState(getWeekId());
  const [toast, setToast] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [adminClicks, setAdminClicks] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [matchForm, setMatchForm] = useState(null);
  const [players, setPlayers] = useState({});
  const [profileForm, setProfileForm] = useState(null);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    const empty = {}; MATCH_DAYS.forEach(d => (empty[d.key] = []));
    const u1 = fbL(`signups/${weekId}`, d => setSignups(d || empty));
    const u2 = fbL("playerStats", d => setPlayerStats(d || {}));
    const u3 = fbL("matchHistory", d => setMatchHistory(d ? Object.values(d).sort((a,b) => b.id - a.id) : []));
    const u4 = fbL(`teams/${weekId}`, d => setGeneratedTeams(d || {}));
    const u5 = fbL("players", d => setPlayers(d || {}));
    setLoading(false);
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [weekId]);

  // AUTO-GENERATE TEAMS when list closes with valid match (only once per day)
  const teamsGenerated = useRef({});
  useEffect(() => {
    MATCH_DAYS.forEach(day => {
      const dk = day.key;
      // Skip if already generated (in Firebase or this session)
      if (generatedTeams[dk] || teamsGenerated.current[dk]) return;
      if (isLocked(dk) && isMatchValid(dk, signups)) {
        const pl = (signups[dk] || []).slice(0, MAX_PLAYERS);
        if (pl.length >= MAX_PLAYERS) {
          teamsGenerated.current[dk] = true;
          const r = balanceTeams(pl, playerStats);
          const upd = { ...generatedTeams, [dk]: r };
          setGeneratedTeams(upd);
          fbW(`teams/${weekId}`, upd);
        }
      }
    });
  }, [signups, playerStats, weekId]); // removed generatedTeams from deps

  // SIGNUP
  const handleSignup = async (dk) => {
    const nm = playerName.trim();
    if (!nm) return showToast("Scrivi il tuo nome!", "error");
    if (isLocked(dk)) return showToast("Lista chiusa!", "error");
    const cur = signups[dk] || [];
    if (cur.some(n => n.toLowerCase() === nm.toLowerCase())) return showToast("Già iscritto!", "error");
    if (cur.length >= MAX_TOTAL) return showToast("Lista piena!", "error");
    const upd = { ...signups, [dk]: [...cur, nm] };
    setSignups(upd); await fbW(`signups/${weekId}`, upd);
    const sp = cur.length + 1;
    const lb = MATCH_DAYS.find(d => d.key === dk).label;
    showToast(sp <= MAX_PLAYERS ? `${nm} iscritto per ${lb}!` : `${nm} riserva #${sp - MAX_PLAYERS} per ${lb}!`);
  };
  const handleRemove = async (dk, nm) => {
    if (isLocked(dk) && !adminMode) return showToast("Lista chiusa!", "error");
    const upd = { ...signups, [dk]: (signups[dk] || []).filter(n => n !== nm) };
    setSignups(upd); await fbW(`signups/${weekId}`, upd);
    showToast(`${nm} rimosso.`);
  };

  // TEAMS (auto-generated, shuffle for admin only)
  const shuffleTeams = async (dk) => {
    const pl = (signups[dk] || []).slice(0, MAX_PLAYERS).sort(() => Math.random() - 0.5);
    const r = balanceTeams(pl, playerStats);
    const upd = { ...generatedTeams, [dk]: r };
    setGeneratedTeams(upd); await fbW(`teams/${weekId}`, upd);
    showToast("Squadre rimescolate!");
  };

  // MATCH RESULT + MVP
  const startMatchForm = (dk) => {
    const t = generatedTeams[dk]; if (!t) return;
    const pf = {};
    [...t.teamA, ...t.teamB].forEach(p => { pf[p.name] = { present: true, team: t.teamA.some(x => x.name === p.name) ? "A" : "B" }; });
    setMatchForm({ dayKey: dk, players: pf, scoreA: 0, scoreB: 0, mvp: null });
  };
  const togglePresence = (nm) => setMatchForm(p => ({ ...p, players: { ...p.players, [nm]: { ...p.players[nm], present: !p.players[nm].present } } }));
  const saveMatchResult = async () => {
    if (!matchForm) return;
    const { dayKey, players, scoreA, scoreB, mvp } = matchForm;
    if (!mvp) return showToast("Seleziona l'MVP!", "error");
    const winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "draw";
    const ns = { ...playerStats };
    Object.entries(players).forEach(([nm, d]) => {
      if (!d.present) return;
      const k = nm.toLowerCase();
      const pr = ns[k] || { name: nm, gamesPlayed: 0, wins: 0, draws: 0, losses: 0, mvpCount: 0 };
      pr.name = nm; pr.gamesPlayed += 1;
      if (winner === "draw") pr.draws = (pr.draws || 0) + 1;
      else if (d.team === winner) pr.wins = (pr.wins || 0) + 1;
      else pr.losses = (pr.losses || 0) + 1;
      ns[k] = pr;
    });
    const mk = mvp.toLowerCase();
    if (ns[mk]) ns[mk].mvpCount = (ns[mk].mvpCount || 0) + 1;
    const pp = Object.entries(players).filter(([,d]) => d.present).map(([n]) => n);
    const id = Date.now();
    const m = { id, date: new Date().toISOString(), weekId, day: dayKey, scoreA, scoreB, winner, mvp, players: pp };
    setPlayerStats(ns); setMatchHistory([m, ...matchHistory]);
    await fbW("playerStats", ns); await fbW(`matchHistory/${id}`, m);
    setMatchForm(null); showToast("Partita registrata!");
  };

  // ADMIN
  const handleTitleClick = () => { const n = adminClicks + 1; setAdminClicks(n); if (n >= 5) { setAdminMode(!adminMode); setAdminClicks(0); } setTimeout(() => setAdminClicks(0), 3000); };
  const resetWeek = async () => { const e = {}; MATCH_DAYS.forEach(d => (e[d.key] = [])); setSignups(e); setGeneratedTeams({}); await fbW(`signups/${weekId}`, e); await fbW(`teams/${weekId}`, {}); showToast("Liste azzerate!"); };
  const resetAllStats = async () => { setPlayerStats({}); setMatchHistory([]); await fbW("playerStats", {}); await fbW("matchHistory", {}); showToast("Tutto azzerato!"); };
  const getSorted = (by = "gamesPlayed") => Object.values(playerStats).filter(p => p.gamesPlayed > 0).sort((a,b) => (b[by]||0) - (a[by]||0));

  // PLAYER PROFILE
  const RUOLI = ["ATT","CEN","DIF","POR"];
  const openProfileForm = (nick) => {
    const existing = Object.values(players).find(p => p.nickname?.toLowerCase() === nick?.toLowerCase());
    setProfileForm(existing ? { ...existing } : { nickname: nick || "", numero: "", ruolo: "ATT", eta: "", altezza: "", peso: "", piede: "Destro" });
  };
  const saveProfile = async () => {
    if (!profileForm) return;
    const nick = profileForm.nickname?.trim();
    if (!nick) return showToast("Inserisci il nickname!", "error");
    const key = nick.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const data = { ...profileForm, nickname: nick, dataRegistrazione: profileForm.dataRegistrazione || new Date().toISOString() };
    const upd = { ...players, [key]: data };
    setPlayers(upd);
    await fbW("players", upd);
    setProfileForm(null);
    showToast("Profilo salvato!");
  };
  const deleteProfile = async (nick) => {
    const key = nick.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const upd = { ...players };
    delete upd[key];
    setPlayers(upd);
    await fbW("players", upd);
    showToast(`${nick} eliminato.`);
  };

  if (loading) return <div style={S.loadWrap}><div style={S.spinner}/><p style={S.loadText}>Caricamento...</p></div>;

  return (
    <div style={S.container}>
      <div style={S.bgPattern} />
      {toast && <div style={{ ...S.toast, background: toast.type === "error" ? "#dc2626" : "#16a34a" }}>{toast.msg}</div>}

      {/* HEADER */}
      <div style={{ position:"relative",zIndex:1,textAlign:"center",padding:"32px 20px 16px",display:"flex",flexDirection:"column",alignItems:"center" }}>
        <div onClick={handleTitleClick} style={{ cursor:"pointer",userSelect:"none" }}>
          <svg width="140" height="164" viewBox="0 0 240 280" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a3a2a"/><stop offset="100%" stopColor="#0a1a12"/></linearGradient>
              <linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#fbbf24"/><stop offset="50%" stopColor="#eab308"/><stop offset="100%" stopColor="#ca8a04"/></linearGradient>
              <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fde68a"/><stop offset="100%" stopColor="#b45309"/></linearGradient>
              <linearGradient id="sv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e2e8f0"/><stop offset="100%" stopColor="#94a3b8"/></linearGradient>
            </defs>
            <path d="M120 8 L218 55 L218 160 Q218 230 120 272 Q22 230 22 160 L22 55 Z" fill="url(#sg)" stroke="url(#gs)" strokeWidth="4"/>
            <path d="M120 20 L208 62 L208 158 Q208 222 120 260 Q32 222 32 158 L32 62 Z" fill="none" stroke="url(#gg)" strokeWidth="1.5" opacity="0.4"/>
            <path d="M55 58 Q120 35 185 58" stroke="url(#gg)" strokeWidth="2" fill="none"/>
            <polygon points="90,55 93,47 96,55 89,50 97,50" fill="url(#gg)"/>
            <polygon points="117,55 120,47 123,55 116,50 124,50" fill="url(#gg)"/>
            <polygon points="144,55 147,47 150,55 143,50 151,50" fill="url(#gg)"/>
            <text x="120" y="138" textAnchor="middle" fontFamily="Oswald,sans-serif" fontSize="72" fontWeight="700" letterSpacing="8" fill="url(#sv)">FAZI</text>
            <line x1="48" y1="152" x2="98" y2="152" stroke="url(#gg)" strokeWidth="1.5"/>
            <line x1="142" y1="152" x2="192" y2="152" stroke="url(#gg)" strokeWidth="1.5"/>
            <text x="120" y="178" textAnchor="middle" fontFamily="Oswald,sans-serif" fontSize="26" fontWeight="400" letterSpacing="10" fill="url(#gg)">LEAGUE</text>
            <path d="M70 200 Q120 215 170 200" stroke="url(#gg)" strokeWidth="1.2" fill="none" opacity="0.4"/>
          </svg>
        </div>
        <p style={S.subtitle}>Settimana {weekId}</p>
      </div>

      {/* TABS: ISCRIZIONI | SQUADRE | CARRIERE | STORICO */}
      <div style={S.tabBar}>
        {[{id:"signup",label:"ISCRIZIONI",icon:"📋"},{id:"teams",label:"SQUADRE",icon:"⚔️"},{id:"careers",label:"CARRIERE",icon:"🏃"},{id:"history",label:"STORICO",icon:"🏆"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{...S.tabBtn,...(tab===t.id?S.tabActive:{})}}>
            <span style={{fontSize:16}}>{t.icon}</span><span style={S.tabLabel}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ═══ ISCRIZIONI ═══ */}
      {tab==="signup"&&(
        <div style={S.content}>
          <p style={{textAlign:"center",color:"#64748b",fontSize:13,marginBottom:16}}>Partite alle <strong style={{color:"#e2e8f0"}}>{MATCH_HOUR}:{String(MATCH_MINUTE).padStart(2,"0")}</strong> — Lista chiude alle <strong style={{color:"#eab308"}}>{MATCH_HOUR-LOCK_HOURS_BEFORE}:{String(MATCH_MINUTE).padStart(2,"0")}</strong></p>
          <div style={S.inputSection}><div style={S.inputWrap}><input type="text" placeholder="Il tuo nome..." value={playerName} onChange={e=>setPlayerName(e.target.value)} style={S.input} maxLength={20}/></div></div>
          <div style={S.daysGrid}>
            {MATCH_DAYS.map(day=>{
              const pl=signups[day.key]||[], tit=pl.slice(0,MAX_PLAYERS), ris=pl.slice(MAX_PLAYERS,MAX_TOTAL);
              const lk=isLocked(day.key), vl=isMatchValid(day.key,signups), fl=pl.length>=MAX_TOTAL;
              const wd=getWeekDates(), ds=fmtDate(wd[day.key]);
              return(
                <div key={day.key} style={{...S.dayCard,opacity:lk?0.75:1}}>
                  <div style={S.dayHead}>
                    <div><span style={S.dayName}>{day.label}</span><span style={{fontSize:13,color:"#94a3b8",marginLeft:8,fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>{ds}</span></div>
                    <span style={{...S.countBadge,background:tit.length>=MAX_PLAYERS?"#16a34a":tit.length>=7?"#eab308":"#475569"}}>{tit.length}/{MAX_PLAYERS}</span>
                  </div>
                  {lk&&(<div style={{padding:"6px 16px",background:vl?"rgba(22,163,74,0.12)":"rgba(220,38,38,0.1)",borderBottom:`1px solid ${vl?"rgba(22,163,74,0.2)":"rgba(220,38,38,0.2)"}`}}><span style={{fontSize:12,color:vl?"#4ade80":"#f87171",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>{vl?"✅ PARTITA CONFERMATA":"❌ PARTITA ANNULLATA"}</span></div>)}
                  <div style={S.playerList}>
                    {tit.map((p,i)=>(
                      <div key={i} style={{...S.playerRow,borderLeft:i<5?"3px solid rgba(22,163,74,0.5)":"3px solid rgba(234,179,8,0.5)"}} onClick={()=>(adminMode||p.toLowerCase()===playerName.trim().toLowerCase())&&handleRemove(day.key,p)}>
                        <span style={S.playerNum}>{i+1}</span><span style={S.playerNameText}>{p}</span>
                        {(adminMode||p.toLowerCase()===playerName.trim().toLowerCase())&&<span style={S.removeX}>✕</span>}
                      </div>
                    ))}
                    {ris.length>0&&<div style={{padding:"4px 10px 2px",marginTop:4}}><span style={{fontSize:10,color:"#eab308",fontFamily:"'Oswald',sans-serif",letterSpacing:2}}>RISERVE</span></div>}
                    {ris.map((p,i)=>(
                      <div key={`r${i}`} style={{...S.playerRow,borderLeft:"3px dashed rgba(234,179,8,0.4)",background:"rgba(234,179,8,0.05)"}} onClick={()=>(adminMode||p.toLowerCase()===playerName.trim().toLowerCase())&&handleRemove(day.key,p)}>
                        <span style={{...S.playerNum,color:"#eab308"}}>R{i+1}</span><span style={S.playerNameText}>{p}</span>
                        {(adminMode||p.toLowerCase()===playerName.trim().toLowerCase())&&<span style={S.removeX}>✕</span>}
                      </div>
                    ))}
                    {pl.length===0&&<p style={S.emptyMsg}>Nessun iscritto</p>}
                  </div>
                  <button onClick={()=>handleSignup(day.key)} disabled={fl||lk} style={{...S.signBtn,...(fl||lk?S.signBtnFull:{}),...(lk?{background:"rgba(100,100,100,0.15)",color:"#64748b"}:{})}}>
                    {lk?(vl?"✅ CONFERMATA":"❌ ANNULLATA"):fl?"COMPLETO ✓":tit.length>=MAX_PLAYERS?`RISERVA (${MAX_TOTAL-pl.length} posti)`:`MI ISCRIVO (${MAX_PLAYERS-tit.length} posti)`}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={S.footer}><p style={S.footerText}>I primi 10 giocano. 11°-13° riserve.</p><p style={S.footerSub}>Min 10 = partita valida. Meno = annullata.</p></div>
        </div>
      )}

      {/* ═══ SQUADRE ═══ */}
      {tab==="teams"&&(
        <div style={S.content}>
          <p style={S.sectionDesc}>Le squadre si generano automaticamente alla chiusura delle liste.</p>
          
          {MATCH_DAYS.map(day => {
            const dk = day.key;
            const lk = isLocked(dk);
            const vl = isMatchValid(dk, signups);
            const t = generatedTeams[dk];
            const wd = getWeekDates();
            const ds = fmtDate(wd[dk]);
            
            // Not locked yet or not valid = no teams
            if (!lk || !vl || !t) {
              return (
                <div key={dk} style={{...S.dayCard, marginBottom: 12, opacity: 0.5}}>
                  <div style={S.dayHead}>
                    <div><span style={S.dayName}>{day.label}</span><span style={{fontSize:13,color:"#94a3b8",marginLeft:8,fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>{ds}</span></div>
                    <span style={{fontSize:12,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>
                      {!lk ? "⏳ Lista aperta" : !vl ? "❌ Annullata" : "..."}
                    </span>
                  </div>
                </div>
              );
            }
            
            return (
              <div key={dk} style={{marginBottom: 20}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:600,letterSpacing:2,marginBottom:8}}>
                  {day.label} <span style={{fontSize:13,color:"#94a3b8",fontWeight:400}}>{ds}</span>
                </div>
                <div style={S.teamVsRow}>
                  <div style={S.teamBox}>
                    <div style={{...S.teamHeader,background:"linear-gradient(135deg,rgba(22,163,74,0.2),rgba(22,163,74,0.05))"}}><span style={S.teamTitle}>🟢 SQ A</span><span style={S.teamPower}>{t.sumA} pres.</span></div>
                    {t.teamA.map((p,i)=>(<div key={i} style={S.teamPlayer}><span style={{fontSize:15,fontWeight:600}}>{p.name}</span><span style={{fontSize:12,color:"#94a3b8",fontFamily:"'Oswald',sans-serif"}}>{p.presenze}</span></div>))}
                  </div>
                  <div style={S.vsCircle}><span style={{fontSize:20,fontWeight:800,fontFamily:"'Oswald',sans-serif",color:"#64748b"}}>VS</span></div>
                  <div style={S.teamBox}>
                    <div style={{...S.teamHeader,background:"linear-gradient(135deg,rgba(234,179,8,0.2),rgba(234,179,8,0.05))"}}><span style={S.teamTitle}>🟡 SQ B</span><span style={S.teamPower}>{t.sumB} pres.</span></div>
                    {t.teamB.map((p,i)=>(<div key={i} style={S.teamPlayer}><span style={{fontSize:15,fontWeight:600}}>{p.name}</span><span style={{fontSize:12,color:"#94a3b8",fontFamily:"'Oswald',sans-serif"}}>{p.presenze}</span></div>))}
                  </div>
                </div>
                <div style={S.balanceBar}><div style={{...S.balanceFill,width:`${t.sumA+t.sumB>0?(t.sumA/(t.sumA+t.sumB))*100:50}%`}}/></div>
                <p style={S.balanceText}>Diff: {Math.abs(t.sumA-t.sumB)} pres. {Math.abs(t.sumA-t.sumB)<=2?"⚖️":""}</p>
                <div style={S.teamActions}>
                  {adminMode && <button onClick={()=>shuffleTeams(dk)} style={S.actionBtn}>🔄 RIMESCOLA</button>}
                  {adminMode && <button onClick={()=>startMatchForm(dk)} style={{...S.actionBtn,...S.actionPrimary}}>✅ REGISTRA PARTITA</button>}
                </div>
              </div>
            );
          })}

          {/* MATCH FORM + MVP */}
          {matchForm&&(
            <div style={S.overlay}><div style={S.modal}>
              <h3 style={S.modalTitle}>Registra — {MATCH_DAYS.find(d=>d.key===matchForm.dayKey)?.label}</h3>
              <div style={S.scoreRow}>
                <div style={S.scoreTeam}><span style={S.scoreLabel}>🟢 Sq A</span><div style={S.scoreControl}><button style={S.scoreBtn} onClick={()=>setMatchForm(p=>({...p,scoreA:Math.max(0,p.scoreA-1)}))}>−</button><span style={S.scoreNum}>{matchForm.scoreA}</span><button style={S.scoreBtn} onClick={()=>setMatchForm(p=>({...p,scoreA:p.scoreA+1}))}>+</button></div></div>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:24,color:"#64748b"}}>—</span>
                <div style={S.scoreTeam}><span style={S.scoreLabel}>🟡 Sq B</span><div style={S.scoreControl}><button style={S.scoreBtn} onClick={()=>setMatchForm(p=>({...p,scoreB:Math.max(0,p.scoreB-1)}))}>−</button><span style={S.scoreNum}>{matchForm.scoreB}</span><button style={S.scoreBtn} onClick={()=>setMatchForm(p=>({...p,scoreB:p.scoreB+1}))}>+</button></div></div>
              </div>
              <div style={{marginBottom:16}}>
                <div style={S.formHeader}><span style={{flex:2}}>Giocatore</span><span style={{flex:1,textAlign:"center"}}>Presente?</span></div>
                {Object.entries(matchForm.players).map(([nm,d])=>(
                  <div key={nm} style={{...S.formRow,borderLeft:d.team==="A"?"3px solid #16a34a":"3px solid #eab308",opacity:d.present?1:0.4,cursor:"pointer"}} onClick={()=>togglePresence(nm)}>
                    <span style={{flex:2,fontWeight:600,fontSize:14}}>{nm}</span>
                    <div style={{flex:1,display:"flex",justifyContent:"center"}}><span style={{fontSize:20}}>{d.present?"✅":"❌"}</span></div>
                  </div>
                ))}
              </div>
              {/* MVP */}
              <div style={{marginBottom:16}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:2,color:"#eab308",marginBottom:8}}>⭐ SELEZIONA MVP</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {Object.entries(matchForm.players).filter(([,d])=>d.present).map(([nm])=>(
                    <button key={nm} onClick={()=>setMatchForm(p=>({...p,mvp:nm}))} style={{padding:"6px 14px",borderRadius:8,border:matchForm.mvp===nm?"2px solid #eab308":"1px solid rgba(255,255,255,0.1)",background:matchForm.mvp===nm?"rgba(234,179,8,0.15)":"rgba(255,255,255,0.04)",color:matchForm.mvp===nm?"#eab308":"#e2e8f0",cursor:"pointer",fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1}}>
                      {matchForm.mvp===nm&&"⭐ "}{nm}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:12,justifyContent:"center"}}>
                <button style={S.cancelBtn} onClick={()=>setMatchForm(null)}>ANNULLA</button>
                <button style={S.saveBtn} onClick={saveMatchResult}>💾 SALVA</button>
              </div>
            </div></div>
          )}
        </div>
      )}

      {/* ═══ CARRIERE ═══ */}
      {tab==="careers"&&(
        <div style={S.content}>
          {/* CREATE PROFILE BUTTON */}
          <div style={{textAlign:"center",marginBottom:20}}>
            <button onClick={()=>openProfileForm("")} style={{...S.actionBtn,...S.actionPrimary,padding:"12px 28px",fontSize:15}}>🎴 CREA LA TUA CARD</button>
          </div>

          {/* PLAYER CARDS GRID */}
          {Object.values(players).length > 0 && (
            <div style={{display:"flex",gap:12,overflowX:"auto",padding:"0 0 20px",WebkitOverflowScrolling:"touch"}}>
              {Object.values(players).map(p => {
                const st = playerStats[p.nickname?.toLowerCase()] || {};
                return <JerseyCard key={p.nickname} name={p.nickname} presenze={st.gamesPlayed} mvpCount={st.mvpCount} wins={st.wins} losses={st.losses} numero={p.numero} ruolo={p.ruolo} eta={p.eta} altezza={p.altezza} peso={p.peso} piede={p.piede} onEdit={()=>openProfileForm(p.nickname)} onDelete={adminMode ? ()=>deleteProfile(p.nickname) : null} />;
              })}
            </div>
          )}

          {/* CLASSIFICA */}
          {getSorted().length > 0 && (
            <div style={S.table}>
              <div style={S.tableHead}>
                <span style={{width:28,textAlign:"center"}}>#</span>
                <span style={{flex:3}}>Giocatore</span>
                <span style={{flex:1,textAlign:"center"}}>PRE</span>
                <span style={{flex:1,textAlign:"center"}}>V/P/S</span>
                <span style={{flex:1,textAlign:"center"}}>⭐</span>
              </div>
              {getSorted().map((p,i)=>{const t=getTier(p.gamesPlayed);return(
                <div key={p.name} style={{...S.tableRow,background:i%2===0?"rgba(255,255,255,0.02)":"transparent"}}>
                  <span style={{width:28,textAlign:"center",fontWeight:700,color:i<3?"#eab308":"#64748b"}}>{i+1}</span>
                  <div style={{flex:3,display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontWeight:600}}>{p.name}</span>
                    <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:`${t.border}22`,color:t.color,fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>{t.name}</span>
                  </div>
                  <span style={{flex:1,textAlign:"center",fontWeight:700,color:"#4ade80"}}>{p.gamesPlayed}</span>
                  <span style={{flex:1,textAlign:"center",fontSize:12,color:"#94a3b8"}}>{p.wins||0}/{p.draws||0}/{p.losses||0}</span>
                  <span style={{flex:1,textAlign:"center",color:"#eab308"}}>{p.mvpCount||0}</span>
                </div>
              );})}
            </div>
          )}

          {Object.values(players).length === 0 && getSorted().length === 0 && (
            <p style={S.emptyState}>Crea il tuo profilo giocatore per iniziare!</p>
          )}

          {/* PROFILE FORM MODAL */}
          {profileForm && (
            <div style={S.overlay}><div style={S.modal}>
              <h3 style={S.modalTitle}>🎴 {profileForm.dataRegistrazione ? "MODIFICA" : "CREA"} PROFILO</h3>
              <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
                <div>
                  <label style={{fontSize:11,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1,display:"block",marginBottom:4}}>NICKNAME</label>
                  <input type="text" value={profileForm.nickname} onChange={e=>setProfileForm({...profileForm,nickname:e.target.value})} style={S.input} placeholder="Il tuo nome" maxLength={20} disabled={!!profileForm.dataRegistrazione} />
                </div>
                <div style={{display:"flex",gap:12}}>
                  <div style={{flex:1}}>
                    <label style={{fontSize:11,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1,display:"block",marginBottom:4}}>NUMERO</label>
                    <input type="number" value={profileForm.numero} onChange={e=>setProfileForm({...profileForm,numero:e.target.value})} style={S.input} placeholder="10" min="1" max="99" />
                  </div>
                  <div style={{flex:1}}>
                    <label style={{fontSize:11,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1,display:"block",marginBottom:4}}>RUOLO</label>
                    <select value={profileForm.ruolo} onChange={e=>setProfileForm({...profileForm,ruolo:e.target.value})} style={{...S.input,appearance:"auto"}}>
                      {RUOLI.map(r=><option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{display:"flex",gap:12}}>
                  <div style={{flex:1}}>
                    <label style={{fontSize:11,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1,display:"block",marginBottom:4}}>ETÀ</label>
                    <input type="number" value={profileForm.eta} onChange={e=>setProfileForm({...profileForm,eta:e.target.value})} style={S.input} placeholder="28" min="10" max="70" />
                  </div>
                  <div style={{flex:1}}>
                    <label style={{fontSize:11,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1,display:"block",marginBottom:4}}>ALTEZZA (cm)</label>
                    <input type="number" value={profileForm.altezza} onChange={e=>setProfileForm({...profileForm,altezza:e.target.value})} style={S.input} placeholder="178" min="140" max="210" />
                  </div>
                </div>
                <div style={{display:"flex",gap:12}}>
                  <div style={{flex:1}}>
                    <label style={{fontSize:11,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1,display:"block",marginBottom:4}}>PESO (kg)</label>
                    <input type="number" value={profileForm.peso} onChange={e=>setProfileForm({...profileForm,peso:e.target.value})} style={S.input} placeholder="75" min="40" max="150" />
                  </div>
                  <div style={{flex:1}}>
                    <label style={{fontSize:11,color:"#64748b",fontFamily:"'Oswald',sans-serif",letterSpacing:1,display:"block",marginBottom:4}}>PIEDE</label>
                    <select value={profileForm.piede} onChange={e=>setProfileForm({...profileForm,piede:e.target.value})} style={{...S.input,appearance:"auto"}}>
                      <option value="Destro">Destro</option>
                      <option value="Sinistro">Sinistro</option>
                      <option value="Ambidestro">Ambidestro</option>
                    </select>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",gap:12,justifyContent:"center"}}>
                <button style={S.cancelBtn} onClick={()=>setProfileForm(null)}>ANNULLA</button>
                <button style={S.saveBtn} onClick={saveProfile}>💾 SALVA PROFILO</button>
              </div>
            </div></div>
          )}
        </div>
      )}

      {/* ═══ STORICO (solo partite valide) ═══ */}
      {tab==="history"&&(
        <div style={S.content}>
          {matchHistory.filter(m=>Array.isArray(m.players)&&m.players.length>=MAX_PLAYERS).length===0?<p style={S.emptyState}>Nessuna partita registrata.</p>:
          matchHistory.filter(m=>Array.isArray(m.players)&&m.players.length>=MAX_PLAYERS).map(m=>(
            <div key={m.id} style={S.histCard}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:16,letterSpacing:1.5}}>{MATCH_DAYS.find(d=>d.key===m.day)?.label||m.day}</span>
                <span style={{fontSize:13,color:"#64748b"}}>{new Date(m.date).toLocaleDateString("it-IT")}</span>
              </div>
              <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:16,fontFamily:"'Oswald',sans-serif",fontSize:15,letterSpacing:1}}>
                <span style={{color:m.winner==="A"?"#4ade80":"#e2e8f0"}}>Sq A</span>
                <span style={{fontSize:28,fontWeight:700,letterSpacing:3}}>{m.scoreA} — {m.scoreB}</span>
                <span style={{color:m.winner==="B"?"#4ade80":"#e2e8f0"}}>Sq B</span>
              </div>
              {m.mvp&&<div style={{textAlign:"center",marginTop:8,fontSize:13,color:"#eab308"}}>⭐ MVP: {m.mvp}</div>}
            </div>
          ))}
        </div>
      )}

      {/* ADMIN */}
      {adminMode&&(
        <div style={{position:"relative",zIndex:1,textAlign:"center",padding:"24px 20px"}}>
          <p style={{fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:3,color:"#eab308",marginBottom:12}}>🔧 Admin</p>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center"}}>
            <button onClick={resetWeek} style={S.resetBtn}>AZZERA LISTE</button>
            <button onClick={resetAllStats} style={{...S.resetBtn,borderColor:"#dc2626",color:"#dc2626"}}>AZZERA TUTTO</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ STYLES ═══
const S={
  container:{position:"relative",minHeight:"100vh",background:"linear-gradient(145deg,#0a1628 0%,#0f2218 40%,#1a1a2e 100%)",fontFamily:"'Source Sans 3',sans-serif",color:"#e2e8f0",overflow:"hidden",paddingBottom:40},
  bgPattern:{position:"fixed",inset:0,backgroundImage:"radial-gradient(circle at 20% 50%,rgba(22,163,74,0.08) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(234,179,8,0.05) 0%,transparent 50%)",pointerEvents:"none",zIndex:0},
  loadWrap:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0a1628"},
  spinner:{width:48,height:48,border:"4px solid rgba(22,163,74,0.2)",borderTopColor:"#16a34a",borderRadius:"50%",animation:"spin 0.8s linear infinite"},
  loadText:{marginTop:16,color:"#94a3b8",fontFamily:"'Oswald',sans-serif",fontSize:18,letterSpacing:2},
  toast:{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",padding:"12px 28px",borderRadius:12,color:"white",fontWeight:600,fontSize:15,zIndex:1000,animation:"slideIn 0.3s ease",boxShadow:"0 8px 32px rgba(0,0,0,0.4)"},
  subtitle:{fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:4,color:"#64748b",marginTop:6,textTransform:"uppercase"},
  tabBar:{position:"relative",zIndex:1,display:"flex",justifyContent:"center",gap:4,padding:"0 12px 20px",flexWrap:"wrap"},
  tabBtn:{display:"flex",alignItems:"center",gap:6,padding:"10px 16px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,color:"#94a3b8",cursor:"pointer",fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,transition:"all 0.2s"},
  tabActive:{background:"rgba(22,163,74,0.15)",borderColor:"rgba(22,163,74,0.3)",color:"#4ade80"},
  tabLabel:{fontSize:12,letterSpacing:1.5},
  content:{position:"relative",zIndex:1,maxWidth:900,margin:"0 auto",padding:"0 16px"},
  sectionDesc:{textAlign:"center",color:"#64748b",fontSize:14,marginBottom:20},
  inputSection:{display:"flex",justifyContent:"center",marginBottom:24},
  inputWrap:{position:"relative",width:"100%",maxWidth:380},
  input:{width:"100%",padding:"14px 20px",fontSize:17,fontFamily:"'Source Sans 3',sans-serif",fontWeight:600,background:"rgba(255,255,255,0.06)",border:"2px solid rgba(22,163,74,0.3)",borderRadius:14,color:"#e2e8f0",outline:"none",textAlign:"center",boxSizing:"border-box",letterSpacing:1},
  daysGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16},
  dayCard:{background:"rgba(255,255,255,0.04)",borderRadius:16,border:"1px solid rgba(255,255,255,0.06)",overflow:"hidden"},
  dayHead:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px 8px"},
  dayName:{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:600,letterSpacing:2,textTransform:"uppercase"},
  countBadge:{padding:"3px 12px",borderRadius:16,fontSize:13,fontWeight:700,fontFamily:"'Oswald',sans-serif",letterSpacing:1,color:"white"},
  playerList:{padding:"4px 12px",minHeight:60},
  playerRow:{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",marginBottom:3,borderRadius:8,background:"rgba(255,255,255,0.02)",cursor:"pointer"},
  playerNum:{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#64748b",width:18,textAlign:"center"},
  playerNameText:{fontSize:14,fontWeight:600,flex:1},
  removeX:{fontSize:12,color:"#f87171",fontWeight:700},
  emptyMsg:{color:"#475569",fontSize:13,textAlign:"center",padding:12},
  signBtn:{width:"calc(100% - 24px)",margin:"8px 12px 12px",padding:"12px",fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:600,letterSpacing:2,textTransform:"uppercase",border:"none",borderRadius:12,cursor:"pointer",background:"linear-gradient(135deg,#16a34a,#15803d)",color:"white",boxShadow:"0 4px 16px rgba(22,163,74,0.3)"},
  signBtnFull:{background:"rgba(22,163,74,0.15)",color:"#16a34a",boxShadow:"none",cursor:"default"},
  footer:{textAlign:"center",padding:"24px 0 0"},
  footerText:{fontSize:14,color:"#64748b",margin:0},
  footerSub:{fontSize:12,color:"#475569",marginTop:4},
  dayBtns:{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",marginBottom:24},
  daySelectBtn:{padding:"10px 18px",borderRadius:12,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.04)",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:100,color:"#e2e8f0"},
  daySelectActive:{background:"rgba(22,163,74,0.15)",borderColor:"rgba(22,163,74,0.4)"},
  daySelectLabel:{fontFamily:"'Oswald',sans-serif",fontSize:15,letterSpacing:1.5},
  daySelectCount:{fontSize:11,color:"#64748b"},
  teamVsRow:{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap",justifyContent:"center"},
  teamBox:{flex:1,minWidth:200,borderRadius:16,overflow:"hidden",border:"1px solid rgba(255,255,255,0.06)",background:"rgba(255,255,255,0.03)"},
  teamHeader:{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"},
  teamTitle:{fontFamily:"'Oswald',sans-serif",fontSize:16,letterSpacing:2,fontWeight:600},
  teamPower:{fontSize:13,color:"#94a3b8",fontFamily:"'Oswald',sans-serif",letterSpacing:1},
  teamPlayer:{display:"flex",justifyContent:"space-between",padding:"8px 16px",borderTop:"1px solid rgba(255,255,255,0.04)"},
  vsCircle:{width:50,height:50,borderRadius:"50%",background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",alignSelf:"center",flexShrink:0},
  balanceBar:{height:6,borderRadius:3,background:"rgba(234,179,8,0.2)",margin:"16px 0 6px",overflow:"hidden"},
  balanceFill:{height:"100%",borderRadius:3,background:"linear-gradient(90deg,#16a34a,#4ade80)",transition:"width 0.5s"},
  balanceText:{textAlign:"center",fontSize:13,color:"#94a3b8",marginBottom:16},
  teamActions:{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"},
  actionBtn:{padding:"10px 20px",fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:1.5,border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,background:"rgba(255,255,255,0.05)",color:"#e2e8f0",cursor:"pointer"},
  actionPrimary:{background:"linear-gradient(135deg,#16a34a,#15803d)",border:"none",color:"white"},
  overlay:{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 16px",overflowY:"auto"},
  modal:{background:"#1a1a2e",borderRadius:20,border:"1px solid rgba(255,255,255,0.08)",padding:24,maxWidth:600,width:"100%"},
  modalTitle:{fontFamily:"'Oswald',sans-serif",fontSize:20,letterSpacing:2,textAlign:"center",margin:"0 0 20px"},
  scoreRow:{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:24},
  scoreTeam:{display:"flex",flexDirection:"column",alignItems:"center",gap:8},
  scoreLabel:{fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:1.5},
  scoreControl:{display:"flex",alignItems:"center",gap:12},
  scoreBtn:{width:36,height:36,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.15)",background:"rgba(255,255,255,0.06)",color:"#e2e8f0",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Oswald',sans-serif"},
  scoreNum:{fontFamily:"'Oswald',sans-serif",fontSize:36,fontWeight:700,minWidth:40,textAlign:"center"},
  formHeader:{display:"flex",padding:"8px 12px",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1.5,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,0.06)"},
  formRow:{display:"flex",alignItems:"center",padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.03)"},
  cancelBtn:{padding:"10px 24px",fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:1.5,border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,background:"transparent",color:"#94a3b8",cursor:"pointer"},
  saveBtn:{padding:"10px 24px",fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:1.5,border:"none",borderRadius:10,background:"linear-gradient(135deg,#16a34a,#15803d)",color:"white",cursor:"pointer"},
  emptyState:{textAlign:"center",color:"#64748b",fontSize:15,padding:40},
  table:{borderRadius:14,overflow:"hidden",border:"1px solid rgba(255,255,255,0.06)",marginBottom:24},
  tableHead:{display:"flex",padding:"10px 14px",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1.5,color:"#64748b",textTransform:"uppercase",background:"rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.06)"},
  tableRow:{display:"flex",padding:"8px 14px",alignItems:"center",fontSize:14,borderBottom:"1px solid rgba(255,255,255,0.02)"},
  histCard:{background:"rgba(255,255,255,0.04)",borderRadius:14,border:"1px solid rgba(255,255,255,0.06)",padding:16,marginBottom:12},
  resetBtn:{padding:"10px 24px",fontFamily:"'Oswald',sans-serif",fontSize:13,fontWeight:600,letterSpacing:2,textTransform:"uppercase",border:"2px solid #eab308",borderRadius:10,background:"transparent",color:"#eab308",cursor:"pointer"},
};
