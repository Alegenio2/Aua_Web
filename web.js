const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');
const jwt  = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { obtenerDatosJugadorCompl } = require('./lib/aoe2');

const PASS_DRAFT   = process.env.ADMIN_PASSWORD_DRAFT   || 'draft-cambiar';
const PASS_CONTROL = process.env.ADMIN_PASSWORD_CONTROL || 'control-cambiar';
const GH_TOKEN     = process.env.GH_TOKEN || '';
const JWT_EXPIRES  = '2h';

const JWT_SECRET = process.env.JWT_SECRET || null;
if (!JWT_SECRET) console.warn('[web.js] ⚠️  JWT_SECRET no definido — endpoints de auth del overlay desactivados.');

const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

function requireAuth(req, res, next) {
  if (!JWT_SECRET) return res.status(503).json({ error: 'Auth no configurado (falta JWT_SECRET)' });
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token || '';
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = function setupStream(app, server) {
  const wss = new WebSocket.Server({ server });
  const lastState = { overlay: null, mapa: null, draft: null, ticker: null };

  wss.on('connection', (ws, req) => {
    const url   = new URL(req.url, 'http://localhost');
    const canal = url.searchParams.get('canal') || 'overlay';
    ws.canal = canal;
    console.log(`[WS] conectado — canal: ${canal} | clientes: ${wss.clients.size}`);
    if (lastState[canal]) ws.send(JSON.stringify(lastState[canal]));
    ws.on('close', () => console.log(`[WS] desconectado — canal: ${canal}`));
    ws.on('error', err => console.error('[WS] error:', err.message));
  });

  function broadcast(canal, data) {
    lastState[canal] = data;
    const msg = JSON.stringify(data);
    let count = 0;
    wss.clients.forEach(ws => {
      if (ws.canal === canal && ws.readyState === WebSocket.OPEN) { ws.send(msg); count++; }
    });
    console.log(`[WS] broadcast → canal:${canal} | ${count} clientes`);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────
  app.post('/auth/login/draft', (req, res) => {
    if (!JWT_SECRET) return res.status(503).json({ error: 'JWT_SECRET no configurado' });
    const { password } = req.body;
    if (!password || password !== PASS_DRAFT) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ token: jwt.sign({ role: 'draft' }, JWT_SECRET, { expiresIn: JWT_EXPIRES }), expiresIn: JWT_EXPIRES });
  });

  app.post('/auth/login/control', (req, res) => {
    if (!JWT_SECRET) return res.status(503).json({ error: 'JWT_SECRET no configurado' });
    const { password } = req.body;
    if (!password || password !== PASS_CONTROL) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({ token: jwt.sign({ role: 'control' }, JWT_SECRET, { expiresIn: JWT_EXPIRES }), expiresIn: JWT_EXPIRES });
  });

  app.get('/auth/verify', requireAuth, (req, res) => res.json({ ok: true, role: req.user.role }));

  app.get('/auth/gh-token', requireAuth, (req, res) => {
    if (!GH_TOKEN) return res.status(404).json({ error: 'GH_TOKEN no configurado' });
    res.json({ token: GH_TOKEN });
  });

  // ── Proxy imagen ─────────────────────────────────────────────────────────────
  const PROXY_ALLOWED_HOSTS = [
    'cdn.aoe2companion.com',
    'data.aoe2companion.com',
    'avatars.githubusercontent.com',
    'cdn.discordapp.com',
    'media.discordapp.net',
  ];

  app.get('/proxy-image', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("Falta parámetro 'url'");

    let parsed;
    try { parsed = new URL(url); } catch (_) { return res.status(400).send('URL inválida'); }

    if (!PROXY_ALLOWED_HOSTS.includes(parsed.hostname)) {
      return res.status(403).send('Host no permitido');
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
      clearTimeout(timeout);
      if (!r.ok) return res.status(r.status).send('No se pudo cargar');
      const contentType = r.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) return res.status(415).send('El recurso no es una imagen');
      res.set('Content-Type', contentType);
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.status(500).send('Error al cargar la imagen'); }
  });

  // ── API: tabla de posiciones por grupos ───────────────────────────────────────
  app.get('/api/torneos/tabla_posiciones', (req, res) => {
    const db = getDB();
    try {
      const torneo = db.prepare("SELECT * FROM torneos WHERE estado = 'jugando' ORDER BY id DESC LIMIT 1").get();
      if (!torneo) return res.json({});

      const grupos = db.prepare('SELECT * FROM grupos WHERE torneo_id = ? ORDER BY nombre').all(torneo.id);
      const tabla = {};

      for (const g of grupos) {
        const jugadores = db.prepare(`
          SELECT gp.usuario_id as id, u.nombre as nick, gp.elo
          FROM grupo_participantes gp JOIN usuarios u ON gp.usuario_id = u.discordId
          WHERE gp.grupo_id = ?
        `).all(g.id);

        const stats = {};
        jugadores.forEach(j => { stats[j.id] = { nick: j.nick, elo: j.elo, pts: 0, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0 }; });

        const partidos = db.prepare("SELECT * FROM partidos WHERE grupo_id = ? AND estado = 'finalizado'").all(g.id);
        for (const p of partidos) {
          const s1 = p.score1, s2 = p.score2;
          if (stats[p.jugador1_id]) { stats[p.jugador1_id].pj++; stats[p.jugador1_id].sf += s1; stats[p.jugador1_id].sc += s2; }
          if (stats[p.jugador2_id]) { stats[p.jugador2_id].pj++; stats[p.jugador2_id].sf += s2; stats[p.jugador2_id].sc += s1; }
          if (s1 > s2) {
            if (stats[p.jugador1_id]) { stats[p.jugador1_id].pg++; stats[p.jugador1_id].pts += 2; }
            if (stats[p.jugador2_id]) { stats[p.jugador2_id].pp++; if (s2 >= 1) stats[p.jugador2_id].pts += 1; }
          } else {
            if (stats[p.jugador2_id]) { stats[p.jugador2_id].pg++; stats[p.jugador2_id].pts += 2; }
            if (stats[p.jugador1_id]) { stats[p.jugador1_id].pp++; if (s1 >= 1) stats[p.jugador1_id].pts += 1; }
          }
        }

        tabla[g.nombre] = Object.values(stats).sort((a, b) => {
          if (b.pts !== a.pts) return b.pts - a.pts;
          return (b.sf - b.sc) - (a.sf - a.sc);
        });
      }

      res.json(tabla);
    } finally { db.close(); }
  });

  // ── API: datos del torneo (para admin_ticker y overlay_resultados) ────────────
  // Acepta slug o nombre de archivo legado con guiones bajos (ej: 1v1_copa_uruguaya_2026)
  app.get('/api/torneos/:slug', (req, res) => {
    const slugParam = req.params.slug.replace(/_/g, '-').toLowerCase();
    const db = getDB();
    try {
      const torneo = db.prepare('SELECT * FROM torneos WHERE slug = ?').get(slugParam)
                  || db.prepare('SELECT * FROM torneos WHERE estado IN (\'jugando\',\'inscripcion\') ORDER BY id DESC LIMIT 1').get();

      if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado' });

      // ── Grupos y participantes ────────────────────────────────────────────────
      const grupos = db.prepare('SELECT * FROM grupos WHERE torneo_id = ? ORDER BY nombre').all(torneo.id);

      const gruposData = grupos.map(g => {
        const jugadores = db.prepare(`
          SELECT gp.usuario_id as id, u.nombre as nick, gp.elo
          FROM grupo_participantes gp
          JOIN usuarios u ON gp.usuario_id = u.discordId
          WHERE gp.grupo_id = ?
        `).all(g.id);
        return { nombre: g.nombre, jugadores };
      });

      // ── Partidos de grupos agrupados por grupo y ronda ────────────────────────
      const rondasGrupos = grupos.map(g => {
        const partidos = db.prepare(`
          SELECT p.id, p.ronda, p.jugador1_id, p.jugador2_id,
                 p.equipo1_id, p.equipo2_id,
                 p.score1, p.score2, p.estado, p.coordinado,
                 u1.nombre as j1_nick, u2.nombre as j2_nick,
                 e1.nombre as eq1_nick, e2.nombre as eq2_nick
          FROM partidos p
          LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
          LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
          LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
          LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
          WHERE p.grupo_id = ? AND p.fase = 'grupos'
          ORDER BY p.ronda, p.id
        `).all(g.id);

        const porRonda = {};
        for (const p of partidos) {
          if (!porRonda[p.ronda]) porRonda[p.ronda] = [];
          const id1  = p.equipo1_id ?? p.jugador1_id;
          const id2  = p.equipo2_id ?? p.jugador2_id;
          const n1   = p.eq1_nick   ?? p.j1_nick;
          const n2   = p.eq2_nick   ?? p.j2_nick;
          const resultado = p.estado === 'finalizado'
            ? { [id1]: p.score1, [id2]: p.score2 }
            : null;
          let fecha = null, horario = null, diaSemana = null;
          if (p.coordinado) {
            const [datePart, timePart] = p.coordinado.split(' ');
            if (datePart && timePart) {
              const [y, m, d] = datePart.split('-');
              fecha   = `${d}-${m}-${y}`;
              horario = timePart.substring(0, 5);
              const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
              diaSemana = dias[new Date(datePart + 'T' + timePart).getDay()];
            }
          }
          porRonda[p.ronda].push({
            jugador1Id: id1, jugador1Nick: n1,
            jugador2Id: id2, jugador2Nick: n2,
            resultado, fecha, horario, diaSemana
          });
        }

        return {
          grupo: g.nombre.replace(/^Grupo\s+/i, ''),
          partidos: Object.entries(porRonda).map(([ronda, ps]) => ({ ronda: Number(ronda), partidos: ps }))
        };
      });

      // ── Eliminatorias ─────────────────────────────────────────────────────────
      const partidosEli = db.prepare(`
        SELECT p.fase, p.jugador1_id, p.jugador2_id,
               p.equipo1_id, p.equipo2_id,
               p.score1, p.score2, p.estado,
               u1.nombre as j1_nick, u2.nombre as j2_nick,
               e1.nombre as eq1_nick, e2.nombre as eq2_nick
        FROM partidos p
        LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
        LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
        WHERE p.torneo_id = ? AND p.fase != 'grupos'
        ORDER BY p.ronda, p.id
      `).all(torneo.id);

      const eliminatorias = {};
      for (const p of partidosEli) {
        if (!eliminatorias[p.fase]) eliminatorias[p.fase] = [];
        const id1 = p.equipo1_id ?? p.jugador1_id;
        const id2 = p.equipo2_id ?? p.jugador2_id;
        const resultado = p.estado === 'finalizado'
          ? { [id1]: p.score1, [id2]: p.score2 }
          : null;
        eliminatorias[p.fase].push({
          jugador1Id: id1, jugador1Nick: p.eq1_nick ?? p.j1_nick,
          jugador2Id: id2, jugador2Nick: p.eq2_nick ?? p.j2_nick,
          resultado
        });
      }

      res.json({ nombre: torneo.nombre, grupos: gruposData, rondas_grupos: rondasGrupos, eliminatorias });
    } finally {
      db.close();
    }
  });

  // ── API: stats por jugador para overlays ──────────────────────────────────────
  app.get('/api/stats', (req, res) => {
    const db = getDB();
    try {
      const filas = db.prepare(`
        SELECT ps.mapa, ps.civilizacion_1, ps.civilizacion_2, ps.ganador_id,
               p.jugador1_id, p.jugador2_id,
               u1.nombre as j1_nick, u2.nombre as j2_nick,
               u1.profileId as pid1, u2.profileId as pid2
        FROM partidas_stats ps
        JOIN partidos p ON ps.partido_id = p.id
        JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      `).all();

      const jugadores = {};
      const civsMapa  = {};

      const initJ = (id, nick) => {
        if (!jugadores[id]) jugadores[id] = { nick, global: { pj:0, pg:0, pp:0, winrate:0 }, civs: {}, mapas: {} };
      };
      const addCiv = (jData, civ, gano) => {
        if (!jData.civs[civ]) jData.civs[civ] = { pj:0, pg:0, pp:0, winrate:0 };
        jData.civs[civ].pj++;
        gano ? jData.civs[civ].pg++ : jData.civs[civ].pp++;
        jData.civs[civ].winrate = Math.round((jData.civs[civ].pg / jData.civs[civ].pj) * 100);
      };
      const addMapa = (jData, mapa, gano) => {
        if (!jData.mapas[mapa]) jData.mapas[mapa] = { pj:0, pg:0, pp:0, winrate:0 };
        jData.mapas[mapa].pj++;
        gano ? jData.mapas[mapa].pg++ : jData.mapas[mapa].pp++;
        jData.mapas[mapa].winrate = Math.round((jData.mapas[mapa].pg / jData.mapas[mapa].pj) * 100);
      };

      for (const f of filas) {
        const gano1 = f.ganador_id === f.pid1;
        const gano2 = f.ganador_id === f.pid2;

        initJ(f.jugador1_id, f.j1_nick);
        initJ(f.jugador2_id, f.j2_nick);

        const j1 = jugadores[f.jugador1_id];
        const j2 = jugadores[f.jugador2_id];

        j1.global.pj++; gano1 ? j1.global.pg++ : j1.global.pp++;
        j2.global.pj++; gano2 ? j2.global.pg++ : j2.global.pp++;
        j1.global.winrate = Math.round((j1.global.pg / j1.global.pj) * 100);
        j2.global.winrate = Math.round((j2.global.pg / j2.global.pj) * 100);

        if (f.civilizacion_1) addCiv(j1, f.civilizacion_1, gano1);
        if (f.civilizacion_2) addCiv(j2, f.civilizacion_2, gano2);
        if (f.mapa) {
          addMapa(j1, f.mapa, gano1);
          addMapa(j2, f.mapa, gano2);

          // civs por mapa (para overlay_maps)
          const civ1 = f.civilizacion_1, civ2 = f.civilizacion_2;
          if (civ1) {
            if (!civsMapa[civ1]) civsMapa[civ1] = { por_mapa: {} };
            if (!civsMapa[civ1].por_mapa[f.mapa]) civsMapa[civ1].por_mapa[f.mapa] = { jugadas: 0, wins: 0, winrate: 0 };
            civsMapa[civ1].por_mapa[f.mapa].jugadas++;
            if (gano1) civsMapa[civ1].por_mapa[f.mapa].wins++;
            civsMapa[civ1].por_mapa[f.mapa].winrate = Math.round((civsMapa[civ1].por_mapa[f.mapa].wins / civsMapa[civ1].por_mapa[f.mapa].jugadas) * 100);
          }
          if (civ2) {
            if (!civsMapa[civ2]) civsMapa[civ2] = { por_mapa: {} };
            if (!civsMapa[civ2].por_mapa[f.mapa]) civsMapa[civ2].por_mapa[f.mapa] = { jugadas: 0, wins: 0, winrate: 0 };
            civsMapa[civ2].por_mapa[f.mapa].jugadas++;
            if (gano2) civsMapa[civ2].por_mapa[f.mapa].wins++;
            civsMapa[civ2].por_mapa[f.mapa].winrate = Math.round((civsMapa[civ2].por_mapa[f.mapa].wins / civsMapa[civ2].por_mapa[f.mapa].jugadas) * 100);
          }
        }
      }

      res.json({ jugadores, civs: civsMapa, meta: { total_partidas: filas.length } });
    } finally { db.close(); }
  });

  // ── API: mapas (sirve archivo estático o respuesta vacía) ─────────────────────
  app.get('/api/mapas', (req, res) => {
    const p = path.join(process.cwd(), 'public', 'mapas.json');
    if (fs.existsSync(p)) return res.json(JSON.parse(fs.readFileSync(p, 'utf-8')));
    res.json([]);
  });

  // ── API: estado de overlay (fallback REST) ────────────────────────────────────
  app.get('/api/overlay/ticker', (req, res) => {
    res.json(lastState.ticker || { resultados: [], tablas: {}, gruposVisibles: [] });
  });

  app.get('/api/overlay/:canal', (req, res) => {
    res.json(lastState[req.params.canal] || { visible: false, ts: 0 });
  });

  // ── API: datos de jugador aoe2companion para overlay de jugador ────────────────
  app.get('/api/jugador/:profileId', async (req, res) => {
    const { profileId } = req.params;
    if (!profileId || !/^\d+$/.test(profileId)) {
      return res.status(400).json({ error: 'profileId inválido' });
    }
    try {
      const datos = await obtenerDatosJugadorCompl(profileId);
      if (datos?.error) {
        return res.status(404).json({ error: datos.error });
      }
      res.json(datos);
    } catch (e) {
      console.error('[/api/jugador] Error:', e.message);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // ── Broadcasts (requieren auth) ───────────────────────────────────────────────
  app.post('/overlay/draft',  requireAuth, (req, res) => { const s = { ...req.body, ts: Date.now() }; broadcast('draft',   s); res.json({ ok: true, ts: s.ts }); });
  app.post('/overlay/update', requireAuth, (req, res) => { const s = { ...req.body, ts: Date.now() }; broadcast('overlay', s); res.json({ ok: true, ts: s.ts }); });
  app.post('/overlay/mapa',   requireAuth, (req, res) => { const s = { ...req.body, ts: Date.now() }; broadcast('mapa',    s); res.json({ ok: true, ts: s.ts }); });
  app.post('/overlay/ticker', requireAuth, (req, res) => {
    const s = { ...req.body, ts: Date.now() };
    lastState.ticker = s;
    broadcast('ticker', s);
    console.log(`[overlay] ticker actualizado: ${s.resultados?.length || 0} partidos`);
    res.json({ ok: true, ts: s.ts });
  });

  // ── Health ────────────────────────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ ok: true, uptime: Math.floor(process.uptime()), wsClients: wss.clients.size, timestamp: new Date().toISOString() });
  });
};
