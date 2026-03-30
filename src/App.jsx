import { useState, useEffect, useCallback } from "react";
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

// Ruoli disponibili per le card
const RUOLI = ["POR", "DIF", "CEN", "ATT"];

// ─── TIER SYSTEM ───
const getTier = (presenze) => {
  if (presenze >= 100) return { 
    name: 'platinum', 
    label: 'LEGGENDA', 
    colors: { primary: '#E5E4E2', secondary: '#B0C4DE', dark: '#1a1a2e' },
    gradient: 'linear-gradient(135deg, #FFFFFF 0%, #E5E4E2 50%, #B0C4DE 100%)'
  };
  if (presenze >= 50) return { 
    name: 'gold', 
    label: 'ELITE', 
    colors: { primary: '#FFD700', secondary: '#DAA520', dark: '#8B6914' },
    gradient: 'linear-gradient(135deg, #FFD700 0%, #DAA520 50%, #8B6914 100%)'
  };
  if (presenze >= 10) return { 
    name: 'silver', 
    label: 'VETERANO', 
    colors: { primary: '#E8E8E8', secondary: '#A8A8A8', dark: '#707070' },
    gradient: 'linear-gradient(135deg, #E8E8E8 0%, #A8A8A8 50%, #707070 100%)'
  };
  return { 
    name: 'bronze', 
    label: 'ROOKIE', 
    colors: { primary: '#CD7F32', secondary: '#8B5A2B', dark: '#5C3317' },
    gradient: 'linear-gradient(135deg, #CD7F32 0%, #8B5A2B 50%, #5C3317 100%)'
  };
};

// Get the Monday that defines the active match week
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

const formatDate = (date) => {
  const months = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  return `${date.getDate()} ${months[date.getMonth()]}`;
};

const isLocked = (dayKey) => {
  const dates = getWeekDates();
  const matchDate = dates[dayKey];
  if (!matchDate) return false;
  const lockTime = new Date(matchDate);
  lockTime.setHours(MATCH_HOUR - LOCK_HOURS_BEFORE, MATCH_MINUTE, 0, 0);
  return new Date() >= lockTime;
};

const getLockTimeStr = (dayKey) => {
  const lockH = MATCH_HOUR - LOCK_HOURS_BEFORE;
  return `${lockH}:${String(MATCH_MINUTE).padStart(2, "0")}`;
};

// ─── BALANCED TEAM ALGORITHM ───
function balanceTeams(players, playerStats) {
  const scored = players.map((name) => {
    const s = playerStats[name.toLowerCase()] || { gamesPlayed: 0 };
    return { name, presenze: s.gamesPlayed || 0 };
  });
  scored.sort((a, b) => b.presenze - a.presenze);

  const teamA = [];
  const teamB = [];
  let sumA = 0, sumB = 0;

  for (const p of scored) {
    if (teamA.length >= TEAM_SIZE) { teamB.push(p); sumB += p.presenze; }
    else if (teamB.length >= TEAM_SIZE) { teamA.push(p); sumA += p.presenze; }
    else if (sumA <= sumB) { teamA.push(p); sumA += p.presenze; }
    else { teamB.push(p); sumB += p.presenze; }
  }
  return { teamA, teamB, sumA, sumB };
}

// ─── FIREBASE HELPERS ───
function fbWrite(path, data) {
  return set(ref(db, path), data).catch((err) => console.error("Firebase write error:", err));
}

function fbListen(path, callback) {
  return onValue(ref(db, path), (snapshot) => {
    callback(snapshot.val());
  });
}

// ─── PLAYER CARD COMPONENT ───
const PlayerCard = ({ nickname, numero, ruolo, eta, altezza, peso, presenze, foto, onClick }) => {
  const tier = getTier(presenze);
  
  return (
    <div onClick={onClick} style={{
      width: 160,
      height: 220,
      borderRadius: 12,
      overflow: 'hidden',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'transform 0.2s, box-shadow 0.2s',
      boxShadow: `0 4px 20px rgba(0,0,0,0.3), 0 0 0 2px ${tier.colors.secondary}`,
      position: 'relative',
      background: tier.gradient,
    }}>
      {/* Inner card */}
      <div style={{
        position: 'absolute',
        top: 6,
        left: 6,
        right: 6,
        bottom: 6,
        borderRadius: 8,
        background: 'linear-gradient(180deg, #2a2a3a 0%, #1a1a2a 100%)',
        border: `1px solid ${tier.colors.primary}`,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Top section: numero + ruolo + foto */}
        <div style={{ display: 'flex', padding: '8px 10px 4px', gap: 8 }}>
          {/* Left: numero + ruolo + logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40 }}>
            <span style={{ 
              fontFamily: "'Oswald', sans-serif", 
              fontSize: 28, 
              fontWeight: 700, 
              color: tier.colors.primary,
              lineHeight: 1,
            }}>{numero || '?'}</span>
            <span style={{ 
              fontFamily: "'Oswald', sans-serif", 
              fontSize: 11, 
              color: tier.colors.primary,
              letterSpacing: 1,
            }}>{ruolo || 'N/D'}</span>
            {/* Mini Logo */}
            <div style={{
              width: 28,
              height: 28,
              marginTop: 6,
              borderRadius: 4,
              background: 'rgba(0,0,0,0.3)',
              border: `1px solid ${tier.colors.secondary}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{ fontSize: 8, fontFamily: "'Oswald', sans-serif", color: tier.colors.primary, letterSpacing: 1 }}>FL</span>
            </div>
          </div>
          
          {/* Right: foto/silhouette */}
          <div style={{
            flex: 1,
            height: 85,
            borderRadius: 6,
            background: 'linear-gradient(180deg, #3a3a4a 0%, #2a2a3a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {foto ? (
              <img src={foto} alt={nickname} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="50" height="65" viewBox="0 0 50 65" fill="none">
                <ellipse cx="25" cy="15" rx="12" ry="14" fill="#5a5a6a"/>
                <path d="M10 35 Q8 50 12 62 L38 62 Q42 50 40 35 Q35 28 25 28 Q15 28 10 35" fill="#5a5a6a"/>
              </svg>
            )}
          </div>
        </div>
        
        {/* Name bar */}
        <div style={{
          background: 'rgba(0,0,0,0.4)',
          padding: '6px 8px',
          margin: '0 6px',
          borderRadius: 4,
        }}>
          <p style={{
            margin: 0,
            fontFamily: "'Oswald', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: tier.colors.primary,
            textAlign: 'center',
            letterSpacing: 1,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{nickname || 'SCONOSCIUTO'}</p>
        </div>
        
        {/* Stats */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-around', 
          padding: '8px 4px',
          marginTop: 'auto',
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, color: tier.colors.primary }}>{eta || '-'}</p>
            <p style={{ margin: 0, fontSize: 8, color: '#888', letterSpacing: 1 }}>ETÀ</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, color: tier.colors.primary }}>{altezza || '-'}</p>
            <p style={{ margin: 0, fontSize: 8, color: '#888', letterSpacing: 1 }}>CM</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontFamily: "'Oswald', sans-serif", fontSize: 16, fontWeight: 600, color: tier.colors.primary }}>{peso || '-'}</p>
            <p style={{ margin: 0, fontSize: 8, color: '#888', letterSpacing: 1 }}>KG</p>
          </div>
        </div>
        
        {/* Presenze + Tier badge */}
        <div style={{ 
          padding: '4px 8px 8px',
          textAlign: 'center',
        }}>
          <p style={{ margin: '0 0 2px', fontSize: 10, color: '#888' }}>{presenze} presenze</p>
          <span style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 10,
            background: `linear-gradient(135deg, ${tier.colors.primary}22, ${tier.colors.secondary}22)`,
            border: `1px solid ${tier.colors.primary}44`,
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            letterSpacing: 2,
            color: tier.colors.primary,
          }}>{tier.label}</span>
        </div>
      </div>
    </div>
  );
};

// ─── PLAYER FORM MODAL ───
const PlayerFormModal = ({ player, onSave, onClose, existingNicknames }) => {
  const [form, setForm] = useState(player || {
    nickname: '',
    numero: '',
    ruolo: 'CEN',
    eta: '',
    altezza: '',
    peso: '',
  });
  const [error, setError] = useState('');
  
  const handleSave = () => {
    if (!form.nickname.trim()) {
      setError('Inserisci un nickname');
      return;
    }
    // Check nickname univoco (solo per nuovi profili)
    if (!player && existingNicknames.some(n => n.toLowerCase() === form.nickname.trim().toLowerCase())) {
      setError('Nickname già in uso!');
      return;
    }
    onSave({
      ...form,
      nickname: form.nickname.trim(),
      numero: parseInt(form.numero) || 0,
      eta: parseInt(form.eta) || 0,
      altezza: parseInt(form.altezza) || 0,
      peso: parseInt(form.peso) || 0,
    });
  };
  
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <h3 style={S.modalTitle}>{player ? 'Modifica Profilo' : 'Crea il tuo Profilo'}</h3>
        
        {error && <p style={{ color: '#f87171', textAlign: 'center', marginBottom: 16 }}>{error}</p>}
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={S.formLabel}>Nickname *</label>
            <input 
              type="text" 
              value={form.nickname} 
              onChange={e => setForm({...form, nickname: e.target.value})}
              style={S.formInput}
              placeholder="Come ti chiamano in campo?"
              maxLength={20}
              disabled={!!player} // Non modificabile se esiste già
            />
          </div>
          
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={S.formLabel}>Numero maglia</label>
              <input 
                type="number" 
                value={form.numero} 
                onChange={e => setForm({...form, numero: e.target.value})}
                style={S.formInput}
                placeholder="10"
                min="1" max="99"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.formLabel}>Ruolo</label>
              <select 
                value={form.ruolo} 
                onChange={e => setForm({...form, ruolo: e.target.value})}
                style={S.formInput}
              >
                {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={S.formLabel}>Età</label>
              <input 
                type="number" 
                value={form.eta} 
                onChange={e => setForm({...form, eta: e.target.value})}
                style={S.formInput}
                placeholder="28"
                min="10" max="70"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.formLabel}>Altezza (cm)</label>
              <input 
                type="number" 
                value={form.altezza} 
                onChange={e => setForm({...form, altezza: e.target.value})}
                style={S.formInput}
                placeholder="178"
                min="140" max="220"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.formLabel}>Peso (kg)</label>
              <input 
                type="number" 
                value={form.peso} 
                onChange={e => setForm({...form, peso: e.target.value})}
                style={S.formInput}
                placeholder="75"
                min="40" max="150"
              />
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button style={S.cancelBtn} onClick={onClose}>ANNULLA</button>
          <button style={S.saveBtn} onClick={handleSave}>💾 SALVA PROFILO</button>
        </div>
      </div>
    </div>
  );
};

// ─── ADMIN PRESENZE MODAL ───
const AdminPresenzeModal = ({ playerStats, onSave, onClose }) => {
  const [stats, setStats] = useState({...playerStats});
  
  const updatePresenze = (key, delta) => {
    const current = stats[key]?.gamesPlayed || 0;
    const newVal = Math.max(0, current + delta);
    setStats({
      ...stats,
      [key]: { ...stats[key], gamesPlayed: newVal }
    });
  };
  
  const handleSave = () => {
    onSave(stats);
  };
  
  const sorted = Object.entries(stats)
    .filter(([_, p]) => p.name)
    .sort((a, b) => (b[1].gamesPlayed || 0) - (a[1].gamesPlayed || 0));
  
  return (
    <div style={S.overlay}>
      <div style={{...S.modal, maxHeight: '80vh', overflow: 'auto'}}>
        <h3 style={S.modalTitle}>🔧 Modifica Presenze (Admin)</h3>
        
        <div style={{ marginBottom: 20 }}>
          {sorted.map(([key, p]) => (
            <div key={key} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button 
                  style={S.miniBtn} 
                  onClick={() => updatePresenze(key, -1)}
                >−</button>
                <span style={{ 
                  fontFamily: "'Oswald', sans-serif", 
                  fontSize: 18, 
                  fontWeight: 600,
                  minWidth: 30,
                  textAlign: 'center',
                  color: '#4ade80'
                }}>{p.gamesPlayed || 0}</span>
                <button 
                  style={S.miniBtn} 
                  onClick={() => updatePresenze(key, 1)}
                >+</button>
              </div>
            </div>
          ))}
          {sorted.length === 0 && (
            <p style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>Nessun giocatore registrato</p>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button style={S.cancelBtn} onClick={onClose}>ANNULLA</button>
          <button style={S.saveBtn} onClick={handleSave}>💾 SALVA MODIFICHE</button>
        </div>
      </div>
    </div>
  );
};

// ─── MAIN APP ───
export default function App() {
  const [tab, setTab] = useState("signup");
  const [playerName, setPlayerName] = useState("");
  const [signups, setSignups] = useState({});
  const [playerStats, setPlayerStats] = useState({});
  const [players, setPlayers] = useState({}); // Profili giocatori per le card
  const [fieldStatus, setFieldStatus] = useState({}); // Stato campo prenotato
  const [matchHistory, setMatchHistory] = useState([]);
  const [generatedTeams, setGeneratedTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [weekId] = useState(getWeekId());
  const [toast, setToast] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [adminClicks, setAdminClicks] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [matchForm, setMatchForm] = useState(null);
  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showAdminPresenze, setShowAdminPresenze] = useState(false);
  const [presenzeContate, setPresenzeContate] = useState({});

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // ─── FIREBASE REALTIME LISTENERS ───
  useEffect(() => {
    const empty = {};
    MATCH_DAYS.forEach((d) => (empty[d.key] = []));

    const unsub1 = fbListen(`signups/${weekId}`, (data) => {
      setSignups(data || empty);
    });
    const unsub2 = fbListen("playerStats", (data) => {
      setPlayerStats(data || {});
    });
    const unsub3 = fbListen("matchHistory", (data) => {
      setMatchHistory(data ? Object.values(data).sort((a, b) => b.id - a.id) : []);
    });
    const unsub4 = fbListen(`teams/${weekId}`, (data) => {
      setGeneratedTeams(data || {});
    });
    const unsub5 = fbListen("players", (data) => {
      setPlayers(data || {});
    });
    const unsub6 = fbListen(`fieldStatus/${weekId}`, (data) => {
      setFieldStatus(data || {});
    });
    const unsub7 = fbListen(`presenzeContate/${weekId}`, (data) => {
      setPresenzeContate(data || {});
    });

    setLoading(false);

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); };
  }, [weekId]);

  // ─── AUTO COUNT PRESENZE ON LIST LOCK ───
  useEffect(() => {
    const checkAndCountPresenze = async () => {
      for (const day of MATCH_DAYS) {
        if (isLocked(day.key) && !presenzeContate[day.key]) {
          // Lista appena chiusa e non ancora contata
          const players = signups[day.key] || [];
          const titolari = players.slice(0, MAX_PLAYERS);
          
          if (titolari.length > 0) {
            const newStats = { ...playerStats };
            
            for (const name of titolari) {
              const key = name.toLowerCase();
              if (!newStats[key]) {
                newStats[key] = { name, gamesPlayed: 0, wins: 0, draws: 0, losses: 0 };
              }
              newStats[key].gamesPlayed = (newStats[key].gamesPlayed || 0) + 1;
            }
            
            // Salva stats aggiornate
            await fbWrite("playerStats", newStats);
            
            // Marca come contata
            const newContate = { ...presenzeContate, [day.key]: true };
            await fbWrite(`presenzeContate/${weekId}`, newContate);
            
            console.log(`Presenze contate per ${day.label}: ${titolari.length} giocatori`);
          }
        }
      }
    };
    
    // Check ogni minuto
    const interval = setInterval(checkAndCountPresenze, 60000);
    checkAndCountPresenze(); // Check immediato
    
    return () => clearInterval(interval);
  }, [signups, presenzeContate, playerStats, weekId]);

  // ─── FIELD STATUS TOGGLE ───
  const toggleFieldStatus = async (dayKey) => {
    if (!adminMode) return;
    const newStatus = { ...fieldStatus, [dayKey]: !fieldStatus[dayKey] };
    setFieldStatus(newStatus);
    await fbWrite(`fieldStatus/${weekId}`, newStatus);
    showToast(newStatus[dayKey] ? "Campo prenotato! ✓" : "Campo non prenotato");
  };

  // ─── SIGNUP HANDLERS ───
  const handleSignup = async (dayKey) => {
    const name = playerName.trim();
    if (!name) return showToast("Scrivi il tuo nome!", "error");
    if (isLocked(dayKey)) return showToast("Lista chiusa!", "error");
    const cur = signups[dayKey] || [];
    if (cur.some(n => n.toLowerCase() === name.toLowerCase())) return showToast("Già iscritto!", "error");
    if (cur.length >= MAX_TOTAL) return showToast("Lista piena (anche le riserve)!", "error");
    const updated = { ...signups, [dayKey]: [...cur, name] };
    setSignups(updated);
    await fbWrite(`signups/${weekId}`, updated);
    const spot = cur.length + 1;
    const label = MATCH_DAYS.find(d => d.key === dayKey).label;
    if (spot <= MAX_PLAYERS) {
      showToast(`${name} iscritto per ${label}!`);
    } else {
      showToast(`${name} in riserva #${spot - MAX_PLAYERS} per ${label}!`);
    }
  };

  const handleRemove = async (dayKey, name) => {
    if (isLocked(dayKey) && !adminMode) return showToast("Lista chiusa!", "error");
    const updated = { ...signups, [dayKey]: (signups[dayKey] || []).filter(n => n !== name) };
    setSignups(updated);
    await fbWrite(`signups/${weekId}`, updated);
    showToast(`${name} rimosso.`);
  };

  // ─── PLAYER PROFILE HANDLERS ───
  const handleSavePlayer = async (playerData) => {
    const key = playerData.nickname.toLowerCase().replace(/\s+/g, '_');
    const newPlayers = { 
      ...players, 
      [key]: { 
        ...playerData, 
        dataRegistrazione: players[key]?.dataRegistrazione || new Date().toISOString() 
      } 
    };
    setPlayers(newPlayers);
    await fbWrite("players", newPlayers);
    setShowPlayerForm(false);
    setEditingPlayer(null);
    showToast("Profilo salvato! 🎴");
  };

  const handleDeletePlayer = async (key) => {
    if (!adminMode) return;
    const newPlayers = { ...players };
    delete newPlayers[key];
    setPlayers(newPlayers);
    await fbWrite("players", newPlayers);
    showToast("Profilo eliminato");
  };

  // ─── ADMIN PRESENZE SAVE ───
  const handleSaveAdminPresenze = async (newStats) => {
    setPlayerStats(newStats);
    await fbWrite("playerStats", newStats);
    setShowAdminPresenze(false);
    showToast("Presenze aggiornate!");
  };

  // ─── TEAM GENERATION ───
  const generateTeams = async (dayKey) => {
    const allPlayers = signups[dayKey] || [];
    const players = allPlayers.slice(0, MAX_PLAYERS);
    if (players.length < 2) return showToast("Servono almeno 2 giocatori!", "error");
    const result = balanceTeams(players, playerStats);
    const updated = { ...generatedTeams, [dayKey]: result };
    setGeneratedTeams(updated);
    await fbWrite(`teams/${weekId}`, updated);
    setSelectedDay(dayKey);
    showToast("Squadre generate!");
  };

  const shuffleTeams = async (dayKey) => {
    const allPlayers = signups[dayKey] || [];
    const players = allPlayers.slice(0, MAX_PLAYERS);
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const result = balanceTeams(shuffled, playerStats);
    const updated = { ...generatedTeams, [dayKey]: result };
    setGeneratedTeams(updated);
    await fbWrite(`teams/${weekId}`, updated);
    showToast("Squadre rimescolate!");
  };

  // ─── MATCH RESULT RECORDING ───
  const startMatchForm = (dayKey) => {
    const teams = generatedTeams[dayKey];
    if (!teams) return;
    const allPlayers = [...teams.teamA, ...teams.teamB];
    const pf = {};
    allPlayers.forEach(p => {
      pf[p.name] = { present: true, team: teams.teamA.some(t => t.name === p.name) ? "A" : "B" };
    });
    setMatchForm({ dayKey, players: pf, scoreA: 0, scoreB: 0 });
  };

  const togglePresence = (name) => {
    setMatchForm(prev => ({
      ...prev,
      players: { ...prev.players, [name]: { ...prev.players[name], present: !prev.players[name].present } }
    }));
  };

  const saveMatchResult = async () => {
    if (!matchForm) return;
    const { dayKey, players, scoreA, scoreB } = matchForm;
    const winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "draw";

    const newStats = { ...playerStats };
    Object.entries(players).forEach(([name, data]) => {
      if (!data.present) return;
      const key = name.toLowerCase();
      const prev = newStats[key] || { name, gamesPlayed: 0, wins: 0, draws: 0, losses: 0 };
      prev.name = name;
      // gamesPlayed già contato automaticamente alla chiusura lista
      if (winner === "draw") prev.draws = (prev.draws || 0) + 1;
      else if (data.team === winner) prev.wins = (prev.wins || 0) + 1;
      else prev.losses = (prev.losses || 0) + 1;
      newStats[key] = prev;
    });

    const presentPlayers = Object.entries(players).filter(([_, d]) => d.present).map(([n]) => n);
    const matchId = Date.now();
    const match = {
      id: matchId,
      date: new Date().toISOString(),
      weekId,
      day: dayKey,
      scoreA,
      scoreB,
      winner,
      players: presentPlayers,
    };

    setPlayerStats(newStats);
    setMatchHistory([match, ...matchHistory]);
    await fbWrite("playerStats", newStats);
    await fbWrite(`matchHistory/${matchId}`, match);
    setMatchForm(null);
    showToast("Partita registrata!");
  };

  // ─── ADMIN ───
  const handleTitleClick = () => {
    const n = adminClicks + 1;
    setAdminClicks(n);
    if (n >= 5) { setAdminMode(!adminMode); setAdminClicks(0); }
    setTimeout(() => setAdminClicks(0), 3000);
  };

  const resetWeek = async () => {
    const empty = {};
    MATCH_DAYS.forEach(d => (empty[d.key] = []));
    setSignups(empty);
    setGeneratedTeams({});
    setFieldStatus({});
    setPresenzeContate({});
    await fbWrite(`signups/${weekId}`, empty);
    await fbWrite(`teams/${weekId}`, {});
    await fbWrite(`fieldStatus/${weekId}`, {});
    await fbWrite(`presenzeContate/${weekId}`, {});
    showToast("Liste azzerate!");
  };

  const resetAllStats = async () => {
    setPlayerStats({});
    setMatchHistory([]);
    await fbWrite("playerStats", {});
    await fbWrite("matchHistory", {});
    showToast("Statistiche azzerate!");
  };

  const getSortedPlayers = (sortBy = "gamesPlayed") => {
    return Object.values(playerStats)
      .filter(p => p.gamesPlayed > 0)
      .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  };

  // Get player card data by merging players profile with stats
  const getPlayerCardData = (playerKey) => {
    const profile = players[playerKey] || {};
    const stats = playerStats[profile.nickname?.toLowerCase()] || {};
    return {
      ...profile,
      presenze: stats.gamesPlayed || 0,
    };
  };

  if (loading) {
    return (
      <div style={S.loadWrap}>
        <div style={S.spinner} />
        <p style={S.loadText}>Caricamento...</p>
      </div>
    );
  }

  return (
    <div style={S.container}>
      <div style={S.bgPattern} />
      {toast && <div style={{ ...S.toast, background: toast.type === "error" ? "#dc2626" : "#16a34a" }}>{toast.msg}</div>}

      {/* HEADER */}
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "32px 20px 16px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div onClick={handleTitleClick} style={{ cursor: "pointer", userSelect: "none" }}>
          <svg width="140" height="164" viewBox="0 0 240 280" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="shieldGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1a3a2a" />
                <stop offset="100%" stopColor="#0a1a12" />
              </linearGradient>
              <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="50%" stopColor="#eab308" />
                <stop offset="100%" stopColor="#ca8a04" />
              </linearGradient>
              <linearGradient id="goldStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fde68a" />
                <stop offset="100%" stopColor="#b45309" />
              </linearGradient>
              <linearGradient id="silverGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e2e8f0" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
            </defs>
            <path d="M120 8 L218 55 L218 160 Q218 230 120 272 Q22 230 22 160 L22 55 Z"
              fill="url(#shieldGrad)" stroke="url(#goldStroke)" strokeWidth="4" />
            <path d="M120 20 L208 62 L208 158 Q208 222 120 260 Q32 222 32 158 L32 62 Z"
              fill="none" stroke="url(#goldGrad)" strokeWidth="1.5" opacity="0.4" />
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
        <p style={S.subtitle}>Settimana {weekId}</p>
      </div>

      {/* TABS */}
      <div style={S.tabBar}>
        {[
          { id: "signup", label: "ISCRIZIONI", icon: "📋" },
          { id: "teams", label: "SQUADRE", icon: "⚔️" },
          { id: "careers", label: "CARRIERE", icon: "🎴" },
          { id: "history", label: "STORICO", icon: "🏆" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...S.tabBtn, ...(tab === t.id ? S.tabActive : {}) }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>
            <span style={S.tabLabel}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ═══ TAB: ISCRIZIONI ═══ */}
      {tab === "signup" && (
        <div style={S.content}>
          <p style={{ textAlign: "center", color: "#64748b", fontSize: 13, marginBottom: 16 }}>
            ⏰ Partite alle <strong style={{ color: "#e2e8f0" }}>{MATCH_HOUR}:{String(MATCH_MINUTE).padStart(2, "0")}</strong> — Lista si chiude alle <strong style={{ color: "#eab308" }}>{MATCH_HOUR - LOCK_HOURS_BEFORE}:{String(MATCH_MINUTE).padStart(2, "0")}</strong> del giorno
          </p>
          <div style={S.inputSection}>
            <div style={S.inputWrap}>
              <input type="text" placeholder="Il tuo nome..." value={playerName}
                onChange={e => setPlayerName(e.target.value)} style={S.input} maxLength={20} />
              <div style={S.inputGlow} />
            </div>
          </div>

          <div style={S.daysGrid}>
            {MATCH_DAYS.map(day => {
              const playersList = signups[day.key] || [];
              const titolari = playersList.slice(0, MAX_PLAYERS);
              const riserve = playersList.slice(MAX_PLAYERS, MAX_TOTAL);
              const locked = isLocked(day.key);
              const isFull = playersList.length >= MAX_TOTAL;
              const spotsLeft = MAX_TOTAL - playersList.length;
              const weekDates = getWeekDates();
              const dateStr = formatDate(weekDates[day.key]);
              const isFieldBooked = fieldStatus[day.key];

              return (
                <div key={day.key} style={{ ...S.dayCard, opacity: locked ? 0.7 : 1 }}>
                  <div style={S.dayHead}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={S.dayName}>{day.label}</span>
                      <span style={{ fontSize: 13, color: "#94a3b8", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>{dateStr}</span>
                      {/* Campo prenotato indicator */}
                      <span 
                        onClick={(e) => { e.stopPropagation(); toggleFieldStatus(day.key); }}
                        style={{ 
                          fontSize: 14, 
                          cursor: adminMode ? 'pointer' : 'default',
                          opacity: adminMode ? 1 : 0.7,
                          transition: 'transform 0.2s',
                        }}
                        title={isFieldBooked ? "Campo prenotato" : "Campo non prenotato"}
                      >
                        {isFieldBooked ? '🟢' : '🔴'}
                      </span>
                    </div>
                    <span style={{ ...S.countBadge, background: titolari.length >= MAX_PLAYERS ? "#16a34a" : titolari.length >= 7 ? "#eab308" : "#475569" }}>
                      {titolari.length}/{MAX_PLAYERS}
                    </span>
                  </div>

                  {locked && (
                    <div style={{ padding: "6px 16px", background: "rgba(220,38,38,0.1)", borderBottom: "1px solid rgba(220,38,38,0.2)" }}>
                      <span style={{ fontSize: 12, color: "#f87171", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>🔒 LISTA CHIUSA</span>
                    </div>
                  )}

                  <div style={S.playerList}>
                    {titolari.map((p, i) => (
                      <div key={i} style={{ ...S.playerRow, borderLeft: i < 5 ? "3px solid rgba(22,163,74,0.5)" : "3px solid rgba(234,179,8,0.5)" }}
                        onClick={() => (adminMode || p.toLowerCase() === playerName.trim().toLowerCase()) && handleRemove(day.key, p)}>
                        <span style={S.playerNum}>{i + 1}</span>
                        <span style={S.playerNameText}>{p}</span>
                        {(adminMode || p.toLowerCase() === playerName.trim().toLowerCase()) &&
                          <span style={S.removeX}>✕</span>}
                      </div>
                    ))}
                    {riserve.length > 0 && (
                      <div style={{ padding: "4px 10px 2px", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#eab308", fontFamily: "'Oswald', sans-serif", letterSpacing: 2 }}>RISERVE</span>
                      </div>
                    )}
                    {riserve.map((p, i) => (
                      <div key={`r${i}`} style={{ ...S.playerRow, borderLeft: "3px dashed rgba(234,179,8,0.4)", background: "rgba(234,179,8,0.05)" }}
                        onClick={() => (adminMode || p.toLowerCase() === playerName.trim().toLowerCase()) && handleRemove(day.key, p)}>
                        <span style={{ ...S.playerNum, color: "#eab308" }}>R{i + 1}</span>
                        <span style={S.playerNameText}>{p}</span>
                        {(adminMode || p.toLowerCase() === playerName.trim().toLowerCase()) &&
                          <span style={S.removeX}>✕</span>}
                      </div>
                    ))}
                    {playersList.length === 0 && <p style={S.emptyMsg}>Nessun iscritto</p>}
                  </div>

                  <button onClick={() => handleSignup(day.key)} disabled={isFull || locked}
                    style={{ ...S.signBtn, ...(isFull || locked ? S.signBtnFull : {}), ...(locked ? { background: "rgba(220,38,38,0.1)", color: "#f87171" } : {}) }}>
                    {locked ? "🔒 CHIUSA" : isFull ? "COMPLETO ✓" : titolari.length >= MAX_PLAYERS ? `RISERVA (${MAX_TOTAL - playersList.length} posti)` : `MI ISCRIVO (${MAX_PLAYERS - titolari.length} posti)`}
                  </button>
                </div>
              );
            })}
          </div>

          <div style={S.footer}>
            <p style={S.footerText}>Scrivi il tuo nome → clicca "MI ISCRIVO" sul giorno che vuoi</p>
            <p style={S.footerSub}>I primi 10 giocano, dal 11° al 13° sono riserve. Lista si chiude 6h prima.</p>
            <p style={S.footerSub}>🟢 = Campo prenotato | 🔴 = Campo da prenotare</p>
          </div>
        </div>
      )}

      {/* ═══ TAB: SQUADRE ═══ */}
      {tab === "teams" && (
        <div style={S.content}>
          <p style={S.sectionDesc}>Seleziona un giorno per generare squadre bilanciate in base alle statistiche.</p>
          <div style={S.dayBtns}>
            {MATCH_DAYS.map(day => {
              const allPlayers = signups[day.key] || [];
              const count = Math.min(allPlayers.length, MAX_PLAYERS);
              const weekDates = getWeekDates();
              const dateStr = formatDate(weekDates[day.key]);
              return (
                <button key={day.key} onClick={() => { setSelectedDay(day.key); generateTeams(day.key); }}
                  style={{ ...S.daySelectBtn, ...(selectedDay === day.key ? S.daySelectActive : {}), opacity: count < 2 ? 0.4 : 1 }}>
                  <span style={S.daySelectLabel}>{day.label} {dateStr}</span>
                  <span style={S.daySelectCount}>{count} giocatori</span>
                </button>
              );
            })}
          </div>

          {selectedDay && generatedTeams[selectedDay] && (() => {
            const t = generatedTeams[selectedDay];
            return (
              <div style={{ marginTop: 8 }}>
                <div style={S.teamVsRow}>
                  <div style={S.teamBox}>
                    <div style={{ ...S.teamHeader, background: "linear-gradient(135deg, rgba(22,163,74,0.2), rgba(22,163,74,0.05))" }}>
                      <span style={S.teamTitle}>🟢 SQUADRA A</span>
                      <span style={S.teamPower}>{t.sumA} presenze</span>
                    </div>
                    {t.teamA.map((p, i) => (
                      <div key={i} style={S.teamPlayer}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Oswald', sans-serif" }}>{p.presenze} pres.</span>
                      </div>
                    ))}
                  </div>
                  <div style={S.vsCircle}><span style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Oswald', sans-serif", color: "#64748b" }}>VS</span></div>
                  <div style={S.teamBox}>
                    <div style={{ ...S.teamHeader, background: "linear-gradient(135deg, rgba(234,179,8,0.2), rgba(234,179,8,0.05))" }}>
                      <span style={S.teamTitle}>🟡 SQUADRA B</span>
                      <span style={S.teamPower}>{t.sumB} presenze</span>
                    </div>
                    {t.teamB.map((p, i) => (
                      <div key={i} style={S.teamPlayer}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Oswald', sans-serif" }}>{p.presenze} pres.</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={S.balanceBar}>
                  <div style={{ ...S.balanceFill, width: `${t.sumA + t.sumB > 0 ? (t.sumA / (t.sumA + t.sumB)) * 100 : 50}%` }} />
                </div>
                <p style={S.balanceText}>
                  Differenza: {Math.abs(t.sumA - t.sumB)} presenze
                  {Math.abs(t.sumA - t.sumB) <= 2 ? " — Ben bilanciato! ⚖️" : ""}
                </p>
                <div style={S.teamActions}>
                  <button onClick={() => shuffleTeams(selectedDay)} style={S.actionBtn}>🔄 RIMESCOLA</button>
                  <button onClick={() => startMatchForm(selectedDay)} style={{ ...S.actionBtn, ...S.actionPrimary }}>✅ REGISTRA PARTITA</button>
                </div>
              </div>
            );
          })()}

          {matchForm && (
            <div style={S.overlay}>
              <div style={S.modal}>
                <h3 style={S.modalTitle}>Registra Partita — {MATCH_DAYS.find(d => d.key === matchForm.dayKey)?.label}</h3>
                <div style={S.scoreRow}>
                  <div style={S.scoreTeam}>
                    <span style={S.scoreLabel}>🟢 Squadra A</span>
                    <div style={S.scoreControl}>
                      <button style={S.scoreBtn} onClick={() => setMatchForm(p => ({ ...p, scoreA: Math.max(0, p.scoreA - 1) }))}>−</button>
                      <span style={S.scoreNum}>{matchForm.scoreA}</span>
                      <button style={S.scoreBtn} onClick={() => setMatchForm(p => ({ ...p, scoreA: p.scoreA + 1 }))}>+</button>
                    </div>
                  </div>
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#64748b" }}>—</span>
                  <div style={S.scoreTeam}>
                    <span style={S.scoreLabel}>🟡 Squadra B</span>
                    <div style={S.scoreControl}>
                      <button style={S.scoreBtn} onClick={() => setMatchForm(p => ({ ...p, scoreB: Math.max(0, p.scoreB - 1) }))}>−</button>
                      <span style={S.scoreNum}>{matchForm.scoreB}</span>
                      <button style={S.scoreBtn} onClick={() => setMatchForm(p => ({ ...p, scoreB: p.scoreB + 1 }))}>+</button>
                    </div>
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={S.formHeader}>
                    <span style={{ flex: 2 }}>Giocatore</span>
                    <span style={{ flex: 1, textAlign: "center" }}>Presente?</span>
                  </div>
                  {Object.entries(matchForm.players).map(([name, data]) => (
                    <div key={name} style={{ ...S.formRow, borderLeft: data.team === "A" ? "3px solid #16a34a" : "3px solid #eab308", opacity: data.present ? 1 : 0.4, cursor: "pointer" }}
                      onClick={() => togglePresence(name)}>
                      <span style={{ flex: 2, fontWeight: 600, fontSize: 14 }}>{name}</span>
                      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                        <span style={{ fontSize: 20 }}>{data.present ? "✅" : "❌"}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                  <button style={S.cancelBtn} onClick={() => setMatchForm(null)}>ANNULLA</button>
                  <button style={S.saveBtn} onClick={saveMatchResult}>💾 SALVA PARTITA</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: CARRIERE ═══ */}
      {tab === "careers" && (
        <div style={S.content}>
          {/* Header section */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <p style={S.sectionDesc}>Le tue statistiche, la tua card. Crea il tuo profilo e scala i tier!</p>
            <button 
              onClick={() => setShowPlayerForm(true)} 
              style={{ ...S.actionBtn, ...S.actionPrimary, marginTop: 12 }}
            >
              ➕ CREA IL TUO PROFILO
            </button>
            {adminMode && (
              <button 
                onClick={() => setShowAdminPresenze(true)} 
                style={{ ...S.actionBtn, marginTop: 12, marginLeft: 12, borderColor: '#eab308', color: '#eab308' }}
              >
                🔧 MODIFICA PRESENZE
              </button>
            )}
          </div>

          {/* Tier Legend */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 16,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}>
            {[
              { label: 'ROOKIE', range: '0-9', color: '#CD7F32' },
              { label: 'VETERANO', range: '10-49', color: '#A8A8A8' },
              { label: 'ELITE', range: '50-99', color: '#FFD700' },
              { label: 'LEGGENDA', range: '100+', color: '#E5E4E2' },
            ].map(t => (
              <div key={t.label} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 20,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${t.color}33`,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: t.color }} />
                <span style={{ fontSize: 11, color: t.color, fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>{t.label}</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>({t.range})</span>
              </div>
            ))}
          </div>

          {/* Player Cards Grid */}
          {Object.keys(players).length > 0 ? (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 20,
              justifyContent: 'center',
              marginBottom: 32,
            }}>
              {Object.entries(players)
                .sort((a, b) => {
                  const presenzeA = playerStats[a[1].nickname?.toLowerCase()]?.gamesPlayed || 0;
                  const presenzeB = playerStats[b[1].nickname?.toLowerCase()]?.gamesPlayed || 0;
                  return presenzeB - presenzeA;
                })
                .map(([key, player]) => {
                  const presenze = playerStats[player.nickname?.toLowerCase()]?.gamesPlayed || 0;
                  return (
                    <div key={key} style={{ position: 'relative' }}>
                      <PlayerCard
                        nickname={player.nickname}
                        numero={player.numero}
                        ruolo={player.ruolo}
                        eta={player.eta}
                        altezza={player.altezza}
                        peso={player.peso}
                        presenze={presenze}
                        foto={player.foto}
                        onClick={adminMode ? () => {
                          setEditingPlayer(player);
                          setShowPlayerForm(true);
                        } : null}
                      />
                      {adminMode && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleDeletePlayer(key); }}
                          style={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: '#dc2626',
                            border: 'none',
                            color: 'white',
                            fontSize: 14,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >✕</button>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : (
            <p style={S.emptyState}>Nessun profilo creato. Sii il primo! 🎴</p>
          )}

          {/* Classifica Presenze (from old PRESENZE tab) */}
          {getSortedPlayers().length > 0 && (
            <>
              <h3 style={{ 
                fontFamily: "'Oswald', sans-serif", 
                fontSize: 18, 
                letterSpacing: 2, 
                textAlign: 'center', 
                marginBottom: 16,
                color: '#e2e8f0',
              }}>🏆 CLASSIFICA PRESENZE</h3>
              
              {/* Podium */}
              {getSortedPlayers().length >= 3 && (
                <div style={S.podium}>
                  {[1, 0, 2].map(pos => {
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

              {/* Table */}
              <div style={S.table}>
                <div style={S.tableHead}>
                  <span style={{ width: 30, textAlign: "center" }}>#</span>
                  <span style={{ flex: 3 }}>Giocatore</span>
                  <span style={{ flex: 1, textAlign: "center" }}>Presenze</span>
                  <span style={{ flex: 1, textAlign: "center" }}>V</span>
                  <span style={{ flex: 1, textAlign: "center" }}>P</span>
                  <span style={{ flex: 1, textAlign: "center" }}>S</span>
                </div>
                {getSortedPlayers().map((p, i) => (
                  <div key={p.name} style={{ ...S.tableRow, background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                    <span style={{ width: 30, textAlign: "center", fontWeight: 700, color: i < 3 ? "#eab308" : "#64748b" }}>{i + 1}</span>
                    <span style={{ flex: 3, fontWeight: 600 }}>{p.name}</span>
                    <span style={{ flex: 1, textAlign: "center", fontWeight: 700, color: "#4ade80" }}>{p.gamesPlayed}</span>
                    <span style={{ flex: 1, textAlign: "center", color: "#16a34a" }}>{p.wins || 0}</span>
                    <span style={{ flex: 1, textAlign: "center", color: "#94a3b8" }}>{p.draws || 0}</span>
                    <span style={{ flex: 1, textAlign: "center", color: "#f87171" }}>{p.losses || 0}</span>
                  </div>
                ))}
              </div>

              {/* Awards */}
              <div style={S.awards}>
                {[
                  { label: "🏃 Più presente", key: "gamesPlayed", val: p => p.gamesPlayed + " presenze" },
                  { label: "🏆 Più vittorie", key: "wins", val: p => (p.wins || 0) + " vittorie" },
                ].map(stat => {
                  const sorted = getSortedPlayers(stat.key);
                  const top = sorted[0];
                  if (!top || !(top[stat.key])) return null;
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
          ) : matchHistory.map(m => (
            <div key={m.id} style={S.histCard}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, letterSpacing: 1.5 }}>{MATCH_DAYS.find(d => d.key === m.day)?.label || m.day}</span>
                <span style={{ fontSize: 13, color: "#64748b" }}>{new Date(m.date).toLocaleDateString("it-IT")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, fontFamily: "'Oswald', sans-serif", fontSize: 15, letterSpacing: 1 }}>
                <span style={{ color: m.winner === "A" ? "#4ade80" : "#e2e8f0" }}>Squadra A</span>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 3 }}>{m.scoreA} — {m.scoreB}</span>
                <span style={{ color: m.winner === "B" ? "#4ade80" : "#e2e8f0" }}>Squadra B</span>
              </div>
              <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: "#64748b" }}>
                {Array.isArray(m.players) ? `${m.players.length} giocatori` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODALS */}
      {showPlayerForm && (
        <PlayerFormModal 
          player={editingPlayer}
          existingNicknames={Object.values(players).map(p => p.nickname)}
          onSave={handleSavePlayer}
          onClose={() => { setShowPlayerForm(false); setEditingPlayer(null); }}
        />
      )}

      {showAdminPresenze && (
        <AdminPresenzeModal
          playerStats={playerStats}
          onSave={handleSaveAdminPresenze}
          onClose={() => setShowAdminPresenze(false)}
        />
      )}

      {/* ADMIN PANEL */}
      {adminMode && (
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "24px 20px" }}>
          <p style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 3, color: "#eab308", marginBottom: 12 }}>🔧 Modalità Admin</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={resetWeek} style={S.resetBtn}>AZZERA LISTE SETTIMANA</button>
            <button onClick={resetAllStats} style={{ ...S.resetBtn, borderColor: "#dc2626", color: "#dc2626" }}>AZZERA TUTTE LE STATISTICHE</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STYLES ───
const S = {
  container: { position: "relative", minHeight: "100vh", background: "linear-gradient(145deg, #0a1628 0%, #0f2218 40%, #1a1a2e 100%)", fontFamily: "'Source Sans 3', sans-serif", color: "#e2e8f0", overflow: "hidden", paddingBottom: 40 },
  bgPattern: { position: "fixed", inset: 0, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(22,163,74,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(234,179,8,0.05) 0%, transparent 50%)", pointerEvents: "none", zIndex: 0 },
  loadWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a1628" },
  spinner: { width: 48, height: 48, border: "4px solid rgba(22,163,74,0.2)", borderTopColor: "#16a34a", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  loadText: { marginTop: 16, color: "#94a3b8", fontFamily: "'Oswald', sans-serif", fontSize: 18, letterSpacing: 2 },
  toast: { position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", padding: "12px 28px", borderRadius: 12, color: "white", fontWeight: 600, fontSize: 15, zIndex: 1000, animation: "slideIn 0.3s ease", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" },
  subtitle: { fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 4, color: "#64748b", marginTop: 6, textTransform: "uppercase" },
  tabBar: { position: "relative", zIndex: 1, display: "flex", justifyContent: "center", gap: 4, padding: "0 12px 20px", flexWrap: "wrap" },
  tabBtn: { display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, color: "#94a3b8", cursor: "pointer", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1, transition: "all 0.2s" },
  tabActive: { background: "rgba(22,163,74,0.15)", borderColor: "rgba(22,163,74,0.3)", color: "#4ade80" },
  tabLabel: { fontSize: 12, letterSpacing: 1.5 },
  content: { position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "0 16px" },
  sectionDesc: { textAlign: "center", color: "#64748b", fontSize: 14, marginBottom: 20 },
  inputSection: { display: "flex", justifyContent: "center", marginBottom: 24 },
  inputWrap: { position: "relative", width: "100%", maxWidth: 380 },
  input: { width: "100%", padding: "14px 20px", fontSize: 17, fontFamily: "'Source Sans 3', sans-serif", fontWeight: 600, background: "rgba(255,255,255,0.06)", border: "2px solid rgba(22,163,74,0.3)", borderRadius: 14, color: "#e2e8f0", outline: "none", textAlign: "center", boxSizing: "border-box", letterSpacing: 1 },
  inputGlow: { position: "absolute", bottom: -2, left: "10%", right: "10%", height: 2, background: "linear-gradient(90deg, transparent, #16a34a, transparent)", borderRadius: 2 },
  daysGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 },
  dayCard: { background: "rgba(255,255,255,0.04)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" },
  dayHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 8px" },
  dayName: { fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" },
  countBadge: { padding: "3px 12px", borderRadius: 16, fontSize: 13, fontWeight: 700, fontFamily: "'Oswald', sans-serif", letterSpacing: 1, color: "white" },
  playerList: { padding: "4px 12px", minHeight: 60 },
  playerRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", marginBottom: 3, borderRadius: 8, background: "rgba(255,255,255,0.02)", cursor: "pointer", transition: "background 0.15s" },
  playerNum: { fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#64748b", width: 18, textAlign: "center" },
  playerNameText: { fontSize: 14, fontWeight: 600, flex: 1 },
  removeX: { fontSize: 12, color: "#f87171", fontWeight: 700 },
  emptyMsg: { color: "#475569", fontSize: 13, textAlign: "center", padding: 12 },
  signBtn: { width: "calc(100% - 24px)", margin: "8px 12px 12px", padding: "12px", fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", border: "none", borderRadius: 12, cursor: "pointer", background: "linear-gradient(135deg, #16a34a, #15803d)", color: "white", boxShadow: "0 4px 16px rgba(22,163,74,0.3)" },
  signBtnFull: { background: "rgba(22,163,74,0.15)", color: "#16a34a", boxShadow: "none", cursor: "default" },
  footer: { textAlign: "center", padding: "24px 0 0" },
  footerText: { fontSize: 14, color: "#64748b", margin: 0 },
  footerSub: { fontSize: 12, color: "#475569", marginTop: 4 },
  dayBtns: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 24 },
  daySelectBtn: { padding: "10px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, transition: "all 0.2s", minWidth: 100, color: "#e2e8f0" },
  daySelectActive: { background: "rgba(22,163,74,0.15)", borderColor: "rgba(22,163,74,0.4)" },
  daySelectLabel: { fontFamily: "'Oswald', sans-serif", fontSize: 15, letterSpacing: 1.5 },
  daySelectCount: { fontSize: 11, color: "#64748b" },
  teamVsRow: { display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" },
  teamBox: { flex: 1, minWidth: 200, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)" },
  teamHeader: { padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  teamTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 16, letterSpacing: 2, fontWeight: 600 },
  teamPower: { fontSize: 13, color: "#94a3b8", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 },
  teamPlayer: { display: "flex", justifyContent: "space-between", padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,0.04)" },
  vsCircle: { width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "center", flexShrink: 0 },
  balanceBar: { height: 6, borderRadius: 3, background: "rgba(234,179,8,0.2)", margin: "16px 0 6px", overflow: "hidden" },
  balanceFill: { height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #16a34a, #4ade80)", transition: "width 0.5s" },
  balanceText: { textAlign: "center", fontSize: 13, color: "#94a3b8", marginBottom: 16 },
  teamActions: { display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" },
  actionBtn: { padding: "10px 20px", fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 1.5, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "rgba(255,255,255,0.05)", color: "#e2e8f0", cursor: "pointer" },
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
  formHeader: { display: "flex", padding: "8px 12px", fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#64748b", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.06)" },
  formRow: { display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)" },
  formLabel: { display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4, fontFamily: "'Oswald', sans-serif", letterSpacing: 1 },
  formInput: { width: "100%", padding: "10px 14px", fontSize: 15, fontFamily: "'Source Sans 3', sans-serif", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e2e8f0", outline: "none", boxSizing: "border-box" },
  miniBtn: { width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Oswald', sans-serif" },
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
  resetBtn: { padding: "10px 24px", fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", border: "2px solid #eab308", borderRadius: 10, background: "transparent", color: "#eab308", cursor: "pointer" },
};
