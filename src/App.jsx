import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, push, remove, get } from 'firebase/database';

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDfdsnyQ7gko4fQKp4unUJ1-HUK_IDxJuU",
  authDomain: "fazi-league.firebaseapp.com",
  databaseURL: "https://fazi-league-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fazi-league",
  storageBucket: "fazi-league.firebasestorage.app",
  messagingSenderId: "150831876857",
  appId: "1:150831876857:web:accb0b5ed7c9aaXXXXXX"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Utility: Get all Mon-Fri dates for current month
const getMonthDates = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const dates = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) dates.push(date);
  }
  return dates;
};

const formatDate = (date) => {
  const days = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
};

const getDateId = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isMatchClosed = (date) => {
  const now = new Date();
  const matchTime = new Date(date);
  matchTime.setHours(19, 30, 0, 0);
  return now >= matchTime;
};

const getTierInfo = (presences) => {
  if (presences >= 100) return { name: 'LEGGENDA', color: '#FFD700', gradient: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)' };
  if (presences >= 50) return { name: 'ELITE', color: '#C0C0C0', gradient: 'linear-gradient(135deg, #E8E8E8 0%, #A8A8A8 100%)' };
  if (presences >= 10) return { name: 'VETERANO', color: '#CD7F32', gradient: 'linear-gradient(135deg, #CD7F32 0%, #8B4513 100%)' };
  return { name: 'ROOKIE', color: '#4A5568', gradient: 'linear-gradient(135deg, #718096 0%, #4A5568 100%)' };
};

function App() {
  const [activeTab, setActiveTab] = useState('iscrizioni');
  const [selectedDate, setSelectedDate] = useState(null);
  const [signups, setSignups] = useState({});
  const [playerStats, setPlayerStats] = useState({});
  const [matchHistory, setMatchHistory] = useState([]);
  const [teams, setTeams] = useState({});
  const [players, setPlayers] = useState({});
  const [username, setUsername] = useState('');
  const [adminMode, setAdminMode] = useState(false);
  const [logoTaps, setLogoTaps] = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingTeams, setEditingTeams] = useState(false);
  const [editedTeams, setEditedTeams] = useState(null);
  const [draggedPlayer, setDraggedPlayer] = useState(null);
  const [profileForm, setProfileForm] = useState({
    nickname: '', numero: '', ruolo: 'ATT', eta: '', altezza: '', peso: '', piede: 'Destro'
  });

  const logoTapTimeout = useRef(null);
  const teamsGenerated = useRef({});
  const monthDates = getMonthDates();

  useEffect(() => {
    if (!selectedDate && monthDates.length > 0) {
      const today = new Date();
      const todayMatch = monthDates.find(d => d.toDateString() === today.toDateString());
      setSelectedDate(todayMatch || monthDates[0]);
    }
  }, [monthDates.length]);

  useEffect(() => {
    const storedUsername = localStorage.getItem('faziUsername');
    if (storedUsername) setUsername(storedUsername);

    onValue(ref(database, 'signups'), (s) => setSignups(s.val() || {}));
    onValue(ref(database, 'playerStats'), (s) => setPlayerStats(s.val() || {}));
    onValue(ref(database, 'matchHistory'), (s) => {
      const data = s.val();
      setMatchHistory(data ? Object.entries(data).map(([id, m]) => ({ id, ...m })) : []);
    });
    onValue(ref(database, 'teams'), (s) => setTeams(s.val() || {}));
    onValue(ref(database, 'players'), (s) => setPlayers(s.val() || {}));
  }, []);

  const handleLogoTap = () => {
    clearTimeout(logoTapTimeout.current);
    const newTaps = logoTaps + 1;
    setLogoTaps(newTaps);
    if (newTaps === 5) {
      setAdminMode(!adminMode);
      setLogoTaps(0);
    } else {
      logoTapTimeout.current = setTimeout(() => setLogoTaps(0), 2000);
    }
  };

  const handleSignup = (isTitolare) => {
    if (!username.trim()) return alert('Inserisci il tuo nome!');
    if (!selectedDate) return;

    const dateId = getDateId(selectedDate);
    const closed = isMatchClosed(selectedDate);
    if (closed && !adminMode) return alert('Iscrizioni chiuse!');

    const current = signups[dateId] || { titolari: [], riserve: [] };
    const all = [...current.titolari, ...current.riserve];
    if (all.includes(username)) return alert('Sei già iscritto!');

    const list = isTitolare ? 'titolari' : 'riserve';
    if (isTitolare && current.titolari.length >= 10) return alert('Titolari pieni!');
    if (!isTitolare && current.riserve.length >= 3) return alert('Riserve piene!');

    set(ref(database, `signups/${dateId}/${list}`), [...current[list], username]);
  };

  const handleRemoveSignup = (name, list) => {
    if (!selectedDate) return;
    const dateId = getDateId(selectedDate);
    const closed = isMatchClosed(selectedDate);
    if (closed && !adminMode) return alert('Iscrizioni chiuse!');

    const current = signups[dateId] || { titolari: [], riserve: [] };
    set(ref(database, `signups/${dateId}/${list}`), current[list].filter(n => n !== name));
  };

  const generateTeams = () => {
    if (!selectedDate) return;
    const dateId = getDateId(selectedDate);
    if (teamsGenerated.current[dateId]) return;

    const current = signups[dateId] || { titolari: [], riserve: [] };
    if (current.titolari.length < 10) return alert('Servono almeno 10 giocatori!');

    const sorted = current.titolari.map(name => ({
      name, presences: playerStats[name]?.gamesPlayed || 0
    })).sort((a, b) => b.presences - a.presences);

    const teamA = [], teamB = [];
    sorted.forEach((p, i) => (i % 2 === 0 ? teamA : teamB).push(p.name));

    set(ref(database, `teams/${dateId}`), { teamA, teamB, riserve: current.riserve });
    teamsGenerated.current[dateId] = true;
  };

  const startEditingTeams = () => {
    if (!selectedDate) return;
    const dateId = getDateId(selectedDate);
    const current = teams[dateId];
    if (!current) return alert('Genera prima le squadre!');
    setEditedTeams(JSON.parse(JSON.stringify(current)));
    setEditingTeams(true);
  };

  const saveEditedTeams = () => {
    if (!selectedDate || !editedTeams) return;
    set(ref(database, `teams/${getDateId(selectedDate)}`), editedTeams);
    setEditingTeams(false);
    alert('Squadre salvate!');
  };

  const handleDragStart = (player, team) => setDraggedPlayer({ player, team });

  const handleDrop = (targetTeam) => {
    if (!draggedPlayer || !editedTeams || draggedPlayer.team === targetTeam) return;
    const newTeams = { ...editedTeams };
    newTeams[draggedPlayer.team] = newTeams[draggedPlayer.team].filter(p => p !== draggedPlayer.player);
    newTeams[targetTeam] = [...newTeams[targetTeam], draggedPlayer.player];
    setEditedTeams(newTeams);
    setDraggedPlayer(null);
  };

  const handleRegisterResult = async () => {
    if (!selectedDate) return;
    const dateId = getDateId(selectedDate);
    const currentTeams = editedTeams || teams[dateId];
    if (!currentTeams?.teamA || !currentTeams?.teamB) return alert('Genera prima le squadre!');

    const scoreA = parseInt(prompt('Gol Team A:'));
    const scoreB = parseInt(prompt('Gol Team B:'));
    if (isNaN(scoreA) || isNaN(scoreB)) return;

    const mvp = prompt('Nome MVP:');
    if (!mvp || ![...currentTeams.teamA, ...currentTeams.teamB].includes(mvp)) return alert('MVP non valido!');

    const winner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw';
    await push(ref(database, 'matchHistory'), {
      date: dateId, scoreA, scoreB, winner, mvp,
      players: { teamA: currentTeams.teamA, teamB: currentTeams.teamB }
    });

    const allPlayers = [...currentTeams.teamA, ...currentTeams.teamB];
    for (const player of allPlayers) {
      const snapshot = await get(ref(database, `playerStats/${player}`));
      const stats = snapshot.val() || { gamesPlayed: 0, wins: 0, draws: 0, losses: 0, mvpCount: 0 };
      const isTeamA = currentTeams.teamA.includes(player);
      const result = winner === 'draw' ? 'draws' : (winner === 'A' && isTeamA) || (winner === 'B' && !isTeamA) ? 'wins' : 'losses';
      stats.gamesPlayed++;
      stats[result]++;
      if (player === mvp) stats.mvpCount++;
      await set(ref(database, `playerStats/${player}`), stats);
    }

    alert('Risultato registrato!');
    setEditingTeams(false);
    setEditedTeams(null);
  };

  const handleSaveProfile = async () => {
    await set(ref(database, `players/${profileForm.nickname}`), {
      nickname: profileForm.nickname,
      numero: parseInt(profileForm.numero),
      ruolo: profileForm.ruolo,
      eta: parseInt(profileForm.eta),
      altezza: parseInt(profileForm.altezza),
      peso: parseInt(profileForm.peso),
      piede: profileForm.piede
    });
    setShowProfileModal(false);
    setProfileForm({ nickname: '', numero: '', ruolo: 'ATT', eta: '', altezza: '', peso: '', piede: 'Destro' });
    alert('Profilo salvato!');
  };

  const handleDeletePlayer = async (nickname) => {
    if (!window.confirm(`Eliminare ${nickname}?`)) return;
    await remove(ref(database, `players/${nickname}`));
  };

  const renderIscrizioni = () => {
    if (!selectedDate) return null;
    const dateId = getDateId(selectedDate);
    const current = signups[dateId] || { titolari: [], riserve: [] };
    const closed = isMatchClosed(selectedDate);

    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ color: '#FFD700', marginBottom: '20px', fontFamily: 'Oswald' }}>ISCRIZIONI</h2>
        
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '25px' }}>
          {monthDates.map(date => {
            const id = getDateId(date);
            const isSelected = getDateId(selectedDate) === id;
            const isClosed = isMatchClosed(date);
            return (
              <button key={id} onClick={() => setSelectedDate(date)} style={{
                padding: '8px 12px', background: isSelected ? '#FFD700' : isClosed ? '#555' : '#2D3748',
                color: isSelected ? '#000' : '#fff', border: 'none', borderRadius: '6px',
                cursor: 'pointer', fontFamily: 'Oswald', fontSize: '13px',
                fontWeight: isSelected ? 'bold' : 'normal', opacity: isClosed ? 0.7 : 1
              }}>
                {formatDate(date)}
              </button>
            );
          })}
        </div>

        <input type="text" placeholder="Il tuo nome" value={username}
          onChange={(e) => { setUsername(e.target.value); localStorage.setItem('faziUsername', e.target.value); }}
          style={{ width: '100%', padding: '12px', background: '#2D3748', border: '2px solid #4A5568',
            borderRadius: '8px', color: '#fff', fontFamily: 'Source Sans 3', fontSize: '16px', marginBottom: '15px' }}
        />

        {(!closed || adminMode) && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => handleSignup(true)} disabled={current.titolari.length >= 10}
              style={{ flex: 1, padding: '15px', background: current.titolari.length >= 10 ? '#555' : 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                color: '#000', border: 'none', borderRadius: '8px', fontFamily: 'Oswald', fontSize: '16px', fontWeight: 'bold',
                cursor: current.titolari.length >= 10 ? 'not-allowed' : 'pointer' }}>
              TITOLARE ({current.titolari.length}/10)
            </button>
            <button onClick={() => handleSignup(false)} disabled={current.riserve.length >= 3}
              style={{ flex: 1, padding: '15px', background: current.riserve.length >= 3 ? '#555' : 'linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%)',
                color: '#000', border: 'none', borderRadius: '8px', fontFamily: 'Oswald', fontSize: '16px', fontWeight: 'bold',
                cursor: current.riserve.length >= 3 ? 'not-allowed' : 'pointer' }}>
              RISERVA ({current.riserve.length}/3)
            </button>
          </div>
        )}

        {closed && !adminMode && (
          <div style={{ padding: '15px', background: '#744210', borderRadius: '8px', textAlign: 'center', fontFamily: 'Oswald', color: '#FFD700', marginBottom: '20px' }}>
            ISCRIZIONI CHIUSE
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <h3 style={{ color: '#FFD700', marginBottom: '10px', fontFamily: 'Oswald' }}>TITOLARI</h3>
            {current.titolari.map((name, i) => (
              <div key={i} style={{ padding: '10px', background: '#2D3748', marginBottom: '8px', borderRadius: '8px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'Source Sans 3', color: '#fff' }}>{i + 1}. {name}</span>
                {(!closed || adminMode) && adminMode && (
                  <button onClick={() => handleRemoveSignup(name, 'titolari')}
                    style={{ background: '#E53E3E', border: 'none', color: '#fff', padding: '5px 10px',
                      borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                )}
              </div>
            ))}
          </div>
          <div>
            <h3 style={{ color: '#C0C0C0', marginBottom: '10px', fontFamily: 'Oswald' }}>RISERVE</h3>
            {current.riserve.map((name, i) => (
              <div key={i} style={{ padding: '10px', background: '#2D3748', marginBottom: '8px', borderRadius: '8px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'Source Sans 3', color: '#fff' }}>{i + 1}. {name}</span>
                {(!closed || adminMode) && adminMode && (
                  <button onClick={() => handleRemoveSignup(name, 'riserve')}
                    style={{ background: '#E53E3E', border: 'none', color: '#fff', padding: '5px 10px',
                      borderRadius: '5px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderSquadre = () => {
    if (!selectedDate) return null;
    const dateId = getDateId(selectedDate);
    const currentTeams = editingTeams ? editedTeams : teams[dateId];
    const current = signups[dateId] || { titolari: [] };

    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ color: '#FFD700', marginBottom: '20px', fontFamily: 'Oswald' }}>SQUADRE - {formatDate(selectedDate)}</h2>

        {!currentTeams && (
          <button onClick={generateTeams} disabled={current.titolari.length < 10}
            style={{ width: '100%', padding: '15px', background: current.titolari.length < 10 ? '#555' : 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
              color: '#000', border: 'none', borderRadius: '8px', fontFamily: 'Oswald', fontSize: '18px', fontWeight: 'bold',
              cursor: current.titolari.length < 10 ? 'not-allowed' : 'pointer', marginBottom: '20px' }}>
            GENERA SQUADRE
          </button>
        )}

        {currentTeams && !editingTeams && adminMode && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button onClick={startEditingTeams}
              style={{ flex: 1, padding: '12px', background: '#3182CE', color: '#fff', border: 'none',
                borderRadius: '8px', fontFamily: 'Oswald', cursor: 'pointer' }}>
              MODIFICA SQUADRE
            </button>
            <button onClick={handleRegisterResult}
              style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #48BB78 0%, #38A169 100%)',
                color: '#fff', border: 'none', borderRadius: '8px', fontFamily: 'Oswald', fontWeight: 'bold', cursor: 'pointer' }}>
              REGISTRA RISULTATO
            </button>
          </div>
        )}

        {editingTeams && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button onClick={saveEditedTeams}
              style={{ flex: 1, padding: '12px', background: '#48BB78', color: '#fff', border: 'none',
                borderRadius: '8px', fontFamily: 'Oswald', cursor: 'pointer' }}>SALVA MODIFICHE</button>
            <button onClick={() => { setEditingTeams(false); setEditedTeams(null); }}
              style={{ flex: 1, padding: '12px', background: '#E53E3E', color: '#fff', border: 'none',
                borderRadius: '8px', fontFamily: 'Oswald', cursor: 'pointer' }}>ANNULLA</button>
          </div>
        )}

        {currentTeams && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div onDragOver={(e) => e.preventDefault()} onDrop={() => editingTeams && handleDrop('teamA')}
              style={{ padding: '20px', background: editingTeams ? '#2C5282' : '#2D3748', borderRadius: '12px',
                border: editingTeams ? '2px dashed #FFD700' : 'none' }}>
              <h3 style={{ color: '#FFD700', marginBottom: '15px', fontFamily: 'Oswald' }}>TEAM A</h3>
              {currentTeams.teamA.map((player, i) => (
                <div key={i} draggable={editingTeams} onDragStart={() => handleDragStart(player, 'teamA')}
                  style={{ padding: '12px', background: '#1A202C', marginBottom: '8px', borderRadius: '8px',
                    fontFamily: 'Source Sans 3', color: '#fff', cursor: editingTeams ? 'move' : 'default' }}>
                  {i + 1}. {player}
                </div>
              ))}
            </div>
            <div onDragOver={(e) => e.preventDefault()} onDrop={() => editingTeams && handleDrop('teamB')}
              style={{ padding: '20px', background: editingTeams ? '#2C5282' : '#2D3748', borderRadius: '12px',
                border: editingTeams ? '2px dashed #C0C0C0' : 'none' }}>
              <h3 style={{ color: '#C0C0C0', marginBottom: '15px', fontFamily: 'Oswald' }}>TEAM B</h3>
              {currentTeams.teamB.map((player, i) => (
                <div key={i} draggable={editingTeams} onDragStart={() => handleDragStart(player, 'teamB')}
                  style={{ padding: '12px', background: '#1A202C', marginBottom: '8px', borderRadius: '8px',
                    fontFamily: 'Source Sans 3', color: '#fff', cursor: editingTeams ? 'move' : 'default' }}>
                  {i + 1}. {player}
                </div>
              ))}
            </div>
          </div>
        )}

        {currentTeams?.riserve?.length > 0 && (
          <div style={{ marginTop: '20px', padding: '15px', background: '#2D3748', borderRadius: '12px' }}>
            <h3 style={{ color: '#C0C0C0', marginBottom: '10px', fontFamily: 'Oswald' }}>RISERVE</h3>
            {currentTeams.riserve.map((player, i) => (
              <div key={i} style={{ padding: '8px', color: '#fff', fontFamily: 'Source Sans 3' }}>
                {i + 1}. {player}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderCarriere = () => {
    const sorted = Object.entries(players).map(([nickname, data]) => ({
      nickname, ...data,
      presences: playerStats[nickname]?.gamesPlayed || 0,
      wins: playerStats[nickname]?.wins || 0,
      mvps: playerStats[nickname]?.mvpCount || 0
    })).sort((a, b) => b.presences - a.presences);

    return (
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ color: '#FFD700', fontFamily: 'Oswald' }}>CARRIERE</h2>
          <button onClick={() => setShowProfileModal(true)}
            style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
              color: '#000', border: 'none', borderRadius: '8px', fontFamily: 'Oswald', fontWeight: 'bold', cursor: 'pointer' }}>
            + CREA PROFILO
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
          {sorted.map(p => {
            const tier = getTierInfo(p.presences);
            return (
              <div key={p.nickname} style={{ background: tier.gradient, borderRadius: '12px', padding: '20px',
                textAlign: 'center', position: 'relative', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                {adminMode && (
                  <button onClick={() => handleDeletePlayer(p.nickname)}
                    style={{ position: 'absolute', top: '10px', right: '10px', background: '#E53E3E', border: 'none',
                      color: '#fff', width: '24px', height: '24px', borderRadius: '50%', cursor: 'pointer',
                      fontSize: '14px', fontWeight: 'bold' }}>✕</button>
                )}
                <div style={{ fontSize: '48px', fontFamily: 'Oswald', fontWeight: 'bold', color: '#000', marginBottom: '5px' }}>
                  {p.numero}
                </div>
                <div style={{ fontSize: '24px', fontFamily: 'Oswald', fontWeight: 'bold', color: '#000', marginBottom: '10px' }}>
                  {p.nickname}
                </div>
                <div style={{ fontSize: '12px', color: '#000', marginBottom: '15px', fontFamily: 'Source Sans 3', fontWeight: '600' }}>
                  {p.ruolo} • {tier.name}
                </div>
                <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px', fontSize: '12px',
                  color: '#000', fontFamily: 'Source Sans 3' }}>
                  <div><strong>{p.presences}</strong> presenze</div>
                  <div><strong>{p.wins}</strong> vittorie</div>
                  <div><strong>{p.mvps}</strong> MVP</div>
                  <div style={{ marginTop: '5px', fontSize: '11px' }}>
                    {p.eta}y • {p.altezza}cm • {p.peso}kg • {p.piede}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderStorico = () => {
    const sorted = [...matchHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ color: '#FFD700', marginBottom: '20px', fontFamily: 'Oswald' }}>STORICO</h2>
        {sorted.map(m => (
          <div key={m.id} style={{ background: '#2D3748', padding: '20px', borderRadius: '12px', marginBottom: '15px' }}>
            <div style={{ color: '#FFD700', fontFamily: 'Oswald', fontSize: '18px', marginBottom: '10px' }}>{m.date}</div>
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: '15px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#FFD700', fontFamily: 'Oswald', fontSize: '14px' }}>TEAM A</div>
                <div style={{ fontSize: '36px', fontFamily: 'Oswald', fontWeight: 'bold',
                  color: m.winner === 'A' ? '#48BB78' : '#fff' }}>{m.scoreA}</div>
              </div>
              <div style={{ color: '#fff', fontSize: '24px' }}>-</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#C0C0C0', fontFamily: 'Oswald', fontSize: '14px' }}>TEAM B</div>
                <div style={{ fontSize: '36px', fontFamily: 'Oswald', fontWeight: 'bold',
                  color: m.winner === 'B' ? '#48BB78' : '#fff' }}>{m.scoreB}</div>
              </div>
            </div>
            <div style={{ textAlign: 'center', color: '#FFD700', fontFamily: 'Oswald', fontSize: '16px' }}>
              ⭐ MVP: {m.mvp}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a4d2e 0%, #0f2818 100%)',
      fontFamily: 'Source Sans 3, sans-serif', paddingBottom: '140px' }}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
      
      <div style={{ padding: '20px', textAlign: 'center', borderBottom: '2px solid #FFD700' }}>
        <div onClick={handleLogoTap} style={{ cursor: 'pointer', display: 'inline-block' }}>
          <svg width="120" height="140" viewBox="0 0 120 140" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>
            <path d="M60 10 L110 45 L110 115 L60 130 L10 115 L10 45 Z" fill="url(#shieldGradient)" stroke="#FFD700" strokeWidth="2"/>
            <defs>
              <linearGradient id="shieldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#1a4d2e', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#0a1f14', stopOpacity: 1 }} />
              </linearGradient>
              <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#FFD700', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#FFA500', stopOpacity: 1 }} />
              </linearGradient>
              <linearGradient id="silverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#E8E8E8', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#C0C0C0', stopOpacity: 1 }} />
              </linearGradient>
            </defs>
            <text x="60" y="65" fontFamily="Oswald" fontSize="28" fontWeight="bold" fill="url(#goldGradient)" textAnchor="middle">FAZI</text>
            <text x="60" y="95" fontFamily="Oswald" fontSize="24" fontWeight="bold" fill="url(#silverGradient)" textAnchor="middle">LEAGUE</text>
          </svg>
        </div>
        {adminMode && <div style={{ marginTop: '10px', color: '#E53E3E', fontFamily: 'Oswald', fontSize: '14px', fontWeight: 'bold' }}>ADMIN MODE</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '15px', borderBottom: '2px solid #2D3748',
        position: 'sticky', top: 0, background: 'linear-gradient(135deg, #1a4d2e 0%, #0f2818 100%)', zIndex: 100 }}>
        {['iscrizioni', 'squadre', 'carriere', 'storico'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ background: activeTab === tab ? 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)' : 'transparent',
              color: activeTab === tab ? '#000' : '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px',
              fontFamily: 'Oswald', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>
            {tab}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'iscrizioni' && renderIscrizioni()}
        {activeTab === 'squadre' && renderSquadre()}
        {activeTab === 'carriere' && renderCarriere()}
        {activeTab === 'storico' && renderStorico()}
      </div>

      {showProfileModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#2D3748', padding: '30px', borderRadius: '12px', width: '90%', maxWidth: '400px' }}>
            <h2 style={{ color: '#FFD700', marginBottom: '20px', fontFamily: 'Oswald' }}>CREA PROFILO</h2>
            {['nickname', 'numero', 'eta', 'altezza', 'peso'].map(field => (
              <input key={field} type={field === 'nickname' ? 'text' : 'number'} placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                value={profileForm[field]} onChange={(e) => setProfileForm({...profileForm, [field]: e.target.value})}
                style={{ width: '100%', padding: '12px', marginBottom: '15px', background: '#1A202C', border: '2px solid #4A5568',
                  borderRadius: '8px', color: '#fff', fontFamily: 'Source Sans 3', fontSize: '16px' }} />
            ))}
            <select value={profileForm.ruolo} onChange={(e) => setProfileForm({...profileForm, ruolo: e.target.value})}
              style={{ width: '100%', padding: '12px', marginBottom: '15px', background: '#1A202C', border: '2px solid #4A5568',
                borderRadius: '8px', color: '#fff', fontFamily: 'Source Sans 3', fontSize: '16px' }}>
              <option>ATT</option><option>CEN</option><option>DIF</option><option>POR</option>
            </select>
            <select value={profileForm.piede} onChange={(e) => setProfileForm({...profileForm, piede: e.target.value})}
              style={{ width: '100%', padding: '12px', marginBottom: '15px', background: '#1A202C', border: '2px solid #4A5568',
                borderRadius: '8px', color: '#fff', fontFamily: 'Source Sans 3', fontSize: '16px' }}>
              <option>Destro</option><option>Sinistro</option><option>Ambidestro</option>
            </select>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={handleSaveProfile}
                style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                  color: '#000', border: 'none', borderRadius: '8px', fontFamily: 'Oswald', fontWeight: 'bold', cursor: 'pointer' }}>
                SALVA
              </button>
              <button onClick={() => setShowProfileModal(false)}
                style={{ flex: 1, padding: '12px', background: '#E53E3E', color: '#fff', border: 'none',
                  borderRadius: '8px', fontFamily: 'Oswald', cursor: 'pointer' }}>ANNULLA</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'linear-gradient(180deg, transparent 0%, #0a1f14 20%)',
        padding: '20px', borderTop: '1px solid #FFD700' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', color: '#C0C0C0', fontSize: '13px',
          fontFamily: 'Source Sans 3', lineHeight: '1.6' }}>
          <p style={{ marginBottom: '8px' }}>📋 <strong>Iscrizioni:</strong> Chiusura ore 19:30. Max 10 titolari + 3 riserve.</p>
          <p style={{ marginBottom: '8px' }}>⚖️ <strong>Squadre:</strong> Bilanciamento automatico basato su presenze (snake draft).</p>
          <p style={{ marginBottom: '0' }}>🏆 <strong>Tier:</strong> ROOKIE (0-9) → VETERANO (10-49) → ELITE (50-99) → LEGGENDA (100+)</p>
        </div>
      </div>
    </div>
  );
}

export default App;
