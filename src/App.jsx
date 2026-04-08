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

const getWeekDates = () => {
  const now = new Date();
  const today = now.getDay();
  const isWeekend = today === 0 || today === 6;
  const daysToMonday = isWeekend ? (today === 0 ? 1 : 3) : (1 - today + 7) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + daysToMonday);
  monday.setHours(0, 0, 0, 0);
  
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    dates.push(date);
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

const getWeekId = (monday) => {
  return getDateId(monday);
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
  const [selectedWeek, setSelectedWeek] = useState(null);
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

  useEffect(() => {
    if (!selectedWeek) {
      const dates = getWeekDates();
      setSelectedWeek(dates[0]);
    }
  }, [selectedWeek]);

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

 const handleSignup = (dayKey) => {
  if (!username.trim()) return alert('Inserisci il tuo nome!');
  if (!selectedWeek) return;

  const weekDates = getWeekDates();
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const dayIndex = dayKeys.indexOf(dayKey);
  
  if (dayIndex === -1) return;
  
  const targetDate = weekDates[dayIndex];
  const dateId = getDateId(targetDate);
  const closed = isMatchClosed(targetDate);
  
  if (closed && !adminMode) return alert('Iscrizioni chiuse!');

  const current = signups[dateId] || { titolari: [], riserve: [] };
  const all = [...current.titolari, ...current.riserve];
  if (all.includes(username)) return alert('Sei già iscritto!');

  if (current.titolari.length < 10) {
    set(ref(database, `signups/${dateId}/titolari`), [...current.titolari, username]);
  } else if (current.riserve.length < 3) {
    set(ref(database, `signups/${dateId}/riserve`), [...current.riserve, username]);
  } else {
    alert('Liste piene!');
  }
};

  const handleRemoveSignup = (name, list, dateId) => {
    const weekDates = getWeekDates();
    const targetDate = new Date(dateId);
    const closed = isMatchClosed(targetDate);
    
    if (closed && !adminMode) return alert('Iscrizioni chiuse!');

    const current = signups[dateId] || { titolari: [], riserve: [] };
    set(ref(database, `signups/${dateId}/${list}`), current[list].filter(n => n !== name));
  };

  const generateTeams = () => {
    if (!selectedWeek) return;
    const weekId = getWeekId(selectedWeek);
    if (teamsGenerated.current[weekId]) return;

    const weekDates = getWeekDates();
    const allPlayers = new Set();
    weekDates.forEach(date => {
      const dateId = getDateId(date);
      const current = signups[dateId] || { titolari: [] };
      if (current.titolari.length >= 10) {
        current.titolari.forEach(p => allPlayers.add(p));
      }
    });

    if (allPlayers.size < 10) return alert('Servono almeno 10 giocatori unici nella settimana!');

    const sorted = Array.from(allPlayers).map(name => ({
      name, presences: playerStats[name]?.gamesPlayed || 0
    })).sort((a, b) => b.presences - a.presences);

    const teamA = [], teamB = [];
    sorted.forEach((p, i) => (i % 2 === 0 ? teamA : teamB).push(p.name));

    set(ref(database, `teams/${weekId}`), { teamA, teamB });
    teamsGenerated.current[weekId] = true;
  };

  const startEditingTeams = () => {
    if (!selectedWeek) return;
    const weekId = getWeekId(selectedWeek);
    const current = teams[weekId];
    if (!current) return alert('Genera prima le squadre!');
    setEditedTeams(JSON.parse(JSON.stringify(current)));
    setEditingTeams(true);
  };

  const saveEditedTeams = () => {
    if (!selectedWeek || !editedTeams) return;
    set(ref(database, `teams/${getWeekId(selectedWeek)}`), editedTeams);
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

  const handleRegisterResult = async (dateId) => {
    const weekId = getWeekId(selectedWeek);
    const currentTeams = editedTeams || teams[weekId];
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
    const weekDates = getWeekDates();
    const dayNames = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];
    const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ color: '#FFD700', marginBottom: '20px', fontFamily: 'Oswald' }}>ISCRIZIONI</h2>
        
        <div style={{ marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Il tuo nome"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              localStorage.setItem('faziUsername', e.target.value);
            }}
            style={{
              width: '100%',
              padding: '12px',
              background: '#2D3748',
              border: '2px solid #4A5568',
              borderRadius: '8px',
              color: '#fff',
              fontFamily: 'Source Sans 3',
              fontSize: '16px',
              marginBottom: '15px'
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: '20px' }}>
          {weekDates.map((date, i) => {
            const dateId = getDateId(date);
            const dayKey = dayKeys[i];
            const current = signups[dateId] || { titolari: [], riserve: [] };
            const closed = isMatchClosed(date);

            return (
              <div key={i} style={{
                background: '#2D3748',
                borderRadius: '12px',
                padding: '20px',
                border: closed ? '2px solid #744210' : '2px solid #4A5568'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h3 style={{ color: '#FFD700', fontFamily: 'Oswald', margin: 0 }}>
                    {dayNames[i]} {date.getDate()}/{date.getMonth() + 1}
                  </h3>
                  <span style={{
                    background: current.titolari.length >= 10 ? '#48BB78' : '#555',
                    color: '#fff',
                    padding: '5px 12px',
                    borderRadius: '12px',
                    fontFamily: 'Oswald',
                    fontSize: '14px'
                  }}>
                    {current.titolari.length}/10
                  </span>
                </div>

                {closed && !adminMode && (
                  <div style={{
                    padding: '10px',
                    background: '#744210',
                    borderRadius: '8px',
                    textAlign: 'center',
                    fontFamily: 'Oswald',
                    color: '#FFD700',
                    marginBottom: '15px'
                  }}>
                    ISCRIZIONI CHIUSE (19:30)
                  </div>
                )}

                {(!closed || adminMode) && (
                  <button
                    onClick={() => handleSignup(dayKey)}
                    disabled={current.titolari.length >= 10 && current.riserve.length >= 3}
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: (current.titolari.length >= 10 && current.riserve.length >= 3) ? '#555' : 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '8px',
                      fontFamily: 'Oswald',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      cursor: (current.titolari.length >= 10 && current.riserve.length >= 3) ? 'not-allowed' : 'pointer',
                      marginBottom: '15px'
                    }}
                  >
                    {current.titolari.length >= 10 && current.riserve.length >= 3 ? 'LISTA PIENA' : 'MI ISCRIVO'}
                  </button>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                  <div>
                    <h4 style={{ color: '#FFD700', marginBottom: '10px', fontFamily: 'Oswald', fontSize: '14px' }}>TITOLARI</h4>
                    {current.titolari.map((name, idx) => (
                      <div key={idx} style={{
                        padding: '8px',
                        background: '#1A202C',
                        marginBottom: '5px',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span style={{ fontFamily: 'Source Sans 3', color: '#fff', fontSize: '14px' }}>
                          {idx + 1}. {name}
                        </span>
                        {(!closed || adminMode) && adminMode && (
                          <button
                            onClick={() => handleRemoveSignup(name, 'titolari', dateId)}
                            style={{
                              background: '#E53E3E',
                              border: 'none',
                              color: '#fff',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div>
                    <h4 style={{ color: '#C0C0C0', marginBottom: '10px', fontFamily: 'Oswald', fontSize: '14px' }}>RISERVE</h4>
                    {current.riserve.map((name, idx) => (
                      <div key={idx} style={{
                        padding: '8px',
                        background: '#1A202C',
                        marginBottom: '5px',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span style={{ fontFamily: 'Source Sans 3', color: '#fff', fontSize: '14px' }}>
                          {idx + 1}. {name}
                        </span>
                        {(!closed || adminMode) && adminMode && (
                          <button
                            onClick={() => handleRemoveSignup(name, 'riserve', dateId)}
                            style={{
                              background: '#E53E3E',
                              border: 'none',
                              color: '#fff',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSquadre = () => {
    if (!selectedWeek) return null;
    const weekId = getWeekId(selectedWeek);
    const weekDates = getWeekDates();
    const currentTeams = editingTeams ? editedTeams : teams[weekId];

    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ color: '#FFD700', marginBottom: '20px', fontFamily: 'Oswald' }}>SQUADRE</h2>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {weekDates.map((date, i) => (
            <button
              key={i}
              onClick={() => setSelectedWeek(date)}
              style={{
                padding: '10px 15px',
                background: getWeekId(date) === weekId ? '#FFD700' : '#2D3748',
                color: getWeekId(date) === weekId ? '#000' : '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontFamily: 'Oswald',
                fontSize: '14px'
              }}
            >
              Sett. {formatDate(date).split(' ')[2]}
            </button>
          ))}
        </div>

        {!currentTeams && (
          <button
            onClick={generateTeams}
            style={{
              width: '100%',
              padding: '15px',
              background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              fontFamily: 'Oswald',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginBottom: '20px'
            }}
          >
            GENERA SQUADRE
          </button>
        )}

        {currentTeams && !editingTeams && adminMode && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button
              onClick={startEditingTeams}
              style={{
                flex: 1,
                padding: '12px',
                background: '#3182CE',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontFamily: 'Oswald',
                cursor: 'pointer'
              }}
            >
              MODIFICA SQUADRE
            </button>
            <button
              onClick={() => {
                const dateId = prompt('Inserisci data partita (YYYY-MM-DD):');
                if (dateId) handleRegisterResult(dateId);
              }}
              style={{
                flex: 1,
                padding: '12px',
                background: 'linear-gradient(135deg, #48BB78 0%, #38A169 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontFamily: 'Oswald',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              REGISTRA RISULTATO
            </button>
          </div>
        )}

        {editingTeams && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button
              onClick={saveEditedTeams}
              style={{
                flex: 1,
                padding: '12px',
                background: '#48BB78',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontFamily: 'Oswald',
                cursor: 'pointer'
              }}
            >
              SALVA MODIFICHE
            </button>
            <button
              onClick={() => {
                setEditingTeams(false);
                setEditedTeams(null);
              }}
              style={{
                flex: 1,
                padding: '12px',
                background: '#E53E3E',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontFamily: 'Oswald',
                cursor: 'pointer'
              }}
            >
              ANNULLA
            </button>
          </div>
        )}

        {currentTeams && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => editingTeams && handleDrop('teamA')}
              style={{
                padding: '20px',
                background: editingTeams ? '#2C5282' : '#2D3748',
                borderRadius: '12px',
                border: editingTeams ? '2px dashed #FFD700' : 'none'
              }}
            >
              <h3 style={{ color: '#FFD700', marginBottom: '15px', fontFamily: 'Oswald' }}>TEAM A</h3>
              {currentTeams.teamA?.map((player, i) => (
                <div
                  key={i}
                  draggable={editingTeams}
                  onDragStart={() => handleDragStart(player, 'teamA')}
                  style={{
                    padding: '12px',
                    background: '#1A202C',
                    marginBottom: '8px',
                    borderRadius: '8px',
                    fontFamily: 'Source Sans 3',
                    color: '#fff',
                    cursor: editingTeams ? 'move' : 'default'
                  }}
                >
                  {i + 1}. {player}
                </div>
              ))}
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => editingTeams && handleDrop('teamB')}
              style={{
                padding: '20px',
                background: editingTeams ? '#2C5282' : '#2D3748',
                borderRadius: '12px',
                border: editingTeams ? '2px dashed #C0C0C0' : 'none'
              }}
            >
              <h3 style={{ color: '#C0C0C0', marginBottom: '15px', fontFamily: 'Oswald' }}>TEAM B</h3>
              {currentTeams.teamB?.map((player, i) => (
                <div
                  key={i}
                  draggable={editingTeams}
                  onDragStart={() => handleDragStart(player, 'teamB')}
                  style={{
                    padding: '12px',
                    background: '#1A202C',
                    marginBottom: '8px',
                    borderRadius: '8px',
                    fontFamily: 'Source Sans 3',
                    color: '#fff',
                    cursor: editingTeams ? 'move' : 'default'
                  }}
                >
                  {i + 1}. {player}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCarriere = () => {
    const sorted = Object.entries(players)
      .map(([nickname, data]) => ({
        nickname,
        ...data,
        presences: playerStats[nickname]?.gamesPlayed || 0,
        wins: playerStats[nickname]?.wins || 0,
        mvps: playerStats[nickname]?.mvpCount || 0
      }))
      .sort((a, b) => b.presences - a.presences);

    return (
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ color: '#FFD700', fontFamily: 'Oswald' }}>CARRIERE</h2>
          <button
            onClick={() => setShowProfileModal(true)}
            style={{
              padding: '10px 20px',
              background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              fontFamily: 'Oswald',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            + CREA PROFILO
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
          {sorted.map((p) => {
            const tier = getTierInfo(p.presences);
            return (
              <div
                key={p.nickname}
                style={{
                  background: tier.gradient,
                  borderRadius: '12px',
                  padding: '20px',
                  textAlign: 'center',
                  position: 'relative',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}
              >
                {adminMode && (
                  <button
                    onClick={() => handleDeletePlayer(p.nickname)}
                    style={{
                      position: 'absolute',
                      top: '10px',
                      right: '10px',
                      background: '#E53E3E',
                      border: 'none',
                      color: '#fff',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold'
                    }}
                  >
                    ✕
                  </button>
                )}
                <div
                  style={{
                    fontSize: '48px',
                    fontFamily: 'Oswald',
                    fontWeight: 'bold',
                    color: '#000',
                    marginBottom: '5px'
                  }}
                >
                  {p.numero}
                </div>
                <div
                  style={{
                    fontSize: '24px',
                    fontFamily: 'Oswald',
                    fontWeight: 'bold',
                    color: '#000',
                    marginBottom: '10px'
                  }}
                >
                  {p.nickname}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#000',
                    marginBottom: '15px',
                    fontFamily: 'Source Sans 3',
                    fontWeight: '600'
                  }}
                >
                  {p.ruolo} • {tier.name}
                </div>
                <div
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '8px',
                    padding: '10px',
                    fontSize: '12px',
                    color: '#000',
                    fontFamily: 'Source Sans 3'
                  }}
                >
                  <div>
                    <strong>{p.presences}</strong> presenze
                  </div>
                  <div>
                    <strong>{p.wins}</strong> vittorie
                  </div>
                  <div>
                    <strong>{p.mvps}</strong> MVP
                  </div>
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
        {sorted.map((m) => (
          <div
            key={m.id}
            style={{ background: '#2D3748', padding: '20px', borderRadius: '12px', marginBottom: '15px' }}
          >
            <div style={{ color: '#FFD700', fontFamily: 'Oswald', fontSize: '18px', marginBottom: '10px' }}>
              {m.date}
            </div>
            <div
              style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: '15px' }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#FFD700', fontFamily: 'Oswald', fontSize: '14px' }}>TEAM A</div>
                <div
                  style={{
                    fontSize: '36px',
                    fontFamily: 'Oswald',
                    fontWeight: 'bold',
                    color: m.winner === 'A' ? '#48BB78' : '#fff'
                  }}
                >
                  {m.scoreA}
                </div>
              </div>
              <div style={{ color: '#fff', fontSize: '24px' }}>-</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#C0C0C0', fontFamily: 'Oswald', fontSize: '14px' }}>TEAM B</div>
                <div
                  style={{
                    fontSize: '36px',
                    fontFamily: 'Oswald',
                    fontWeight: 'bold',
                    color: m.winner === 'B' ? '#48BB78' : '#fff'
                  }}
                >
                  {m.scoreB}
                </div>
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
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1a4d2e 0%, #0f2818 100%)',
        fontFamily: 'Source Sans 3, sans-serif',
        paddingBottom: '140px'
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Source+Sans+3:wght@400;600;700&display=swap"
        rel="stylesheet"
      />

      <div style={{ padding: '20px', textAlign: 'center', borderBottom: '2px solid #FFD700' }}>
        <div onClick={handleLogoTap} style={{ cursor: 'pointer', display: 'inline-block' }}>
          <svg width="120" height="140" viewBox="0 0 120 140" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}>
            <path
              d="M60 10 L110 45 L110 115 L60 130 L10 115 L10 45 Z"
              fill="url(#shieldGradient)"
              stroke="#FFD700"
              strokeWidth="2"
            />
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
            <text x="60" y="65" fontFamily="Oswald" fontSize="28" fontWeight="bold" fill="url(#goldGradient)" textAnchor="middle">
              FAZI
            </text>
            <text x="60" y="95" fontFamily="Oswald" fontSize="24" fontWeight="bold" fill="url(#silverGradient)" textAnchor="middle">
              LEAGUE
            </text>
          </svg>
        </div>
        {adminMode && (
          <div style={{ marginTop: '10px', color: '#E53E3E', fontFamily: 'Oswald', fontSize: '14px', fontWeight: 'bold' }}>
            ADMIN MODE
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          padding: '15px',
          borderBottom: '2px solid #2D3748',
          position: 'sticky',
          top: 0,
          background: 'linear-gradient(135deg, #1a4d2e 0%, #0f2818 100%)',
          zIndex: 100
        }}
      >
        {['iscrizioni', 'squadre', 'carriere', 'storico'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)' : 'transparent',
              color: activeTab === tab ? '#000' : '#fff',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '8px',
              fontFamily: 'Oswald',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
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
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000
          }}
        >
          <div style={{ background: '#2D3748', padding: '30px', borderRadius: '12px', width: '90%', maxWidth: '400px' }}>
            <h2 style={{ color: '#FFD700', marginBottom: '20px', fontFamily: 'Oswald' }}>CREA PROFILO</h2>
            {['nickname', 'numero', 'eta', 'altezza', 'peso'].map((field) => (
              <input
                key={field}
                type={field === 'nickname' ? 'text' : 'number'}
                placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                value={profileForm[field]}
                onChange={(e) => setProfileForm({ ...profileForm, [field]: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '15px',
                  background: '#1A202C',
                  border: '2px solid #4A5568',
                  borderRadius: '8px',
                  color: '#fff',
                  fontFamily: 'Source Sans 3',
                  fontSize: '16px'
                }}
              />
            ))}
            <select
              value={profileForm.ruolo}
              onChange={(e) => setProfileForm({ ...profileForm, ruolo: e.target.value })}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '15px',
                background: '#1A202C',
                border: '2px solid #4A5568',
                borderRadius: '8px',
                color: '#fff',
                fontFamily: 'Source Sans 3',
                fontSize: '16px'
              }}
            >
              <option>ATT</option>
              <option>CEN</option>
              <option>DIF</option>
              <option>POR</option>
            </select>
            <select
              value={profileForm.piede}
              onChange={(e) => setProfileForm({ ...profileForm, piede: e.target.value })}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '15px',
                background: '#1A202C',
                border: '2px solid #4A5568',
                borderRadius: '8px',
                color: '#fff',
                fontFamily: 'Source Sans 3',
                fontSize: '16px'
              }}
            >
              <option>Destro</option>
              <option>Sinistro</option>
              <option>Ambidestro</option>
            </select>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button
                onClick={handleSaveProfile}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '8px',
                  fontFamily: 'Oswald',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                SALVA
              </button>
              <button
                onClick={() => setShowProfileModal(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#E53E3E',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontFamily: 'Oswald',
                  cursor: 'pointer'
                }}
              >
                ANNULLA
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(180deg, transparent 0%, #0a1f14 20%)',
          padding: '20px',
          borderTop: '1px solid #FFD700'
        }}
      >
        <div
          style={{
            maxWidth: '800px',
            margin: '0 auto',
            color: '#C0C0C0',
            fontSize: '13px',
            fontFamily: 'Source Sans 3',
            lineHeight: '1.6'
          }}
        >
          <p style={{ marginBottom: '8px' }}>
            📋 <strong>Iscrizioni:</strong> Chiusura ore 19:30. Max 10 titolari + 3 riserve.
          </p>
          <p style={{ marginBottom: '8px' }}>
            ⚖️ <strong>Squadre:</strong> Bilanciamento automatico basato su presenze (snake draft).
          </p>
          <p style={{ marginBottom: '0' }}>
            🏆 <strong>Tier:</strong> ROOKIE (0-9) → VETERANO (10-49) → ELITE (50-99) → LEGGENDA (100+)
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
