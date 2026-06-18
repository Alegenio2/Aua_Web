require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const MemoryStore = require('memorystore')(session);
const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));
const { cargarBaseDatosDesdeGit, subirBaseDatosGit } = require('./lib/guardarTorneosGit');
const { cargarRecsDesdeGit, scheduleRecCleanup } = require('./lib/recsGit');

require('./routes/auth'); // inicializa estrategia Discord

// Migraciones idempotentes — se ejecutan al inicio y tras cargar la BD desde git
function runMigrations() {
  const _db = new Database(path.resolve(process.cwd(), 'botfmg.db'));
  try { _db.prepare('ALTER TABLE torneos ADD COLUMN penca_abierta INTEGER DEFAULT NULL').run(); } catch (_) {}
  try { _db.prepare('ALTER TABLE torneos ADD COLUMN campeon_id TEXT DEFAULT NULL').run(); } catch (_) {}
  try { _db.prepare('ALTER TABLE penca_campeon ADD COLUMN puntos_campeon INTEGER DEFAULT 0').run(); } catch (_) {}
  try { _db.prepare('ALTER TABLE partidos ADD COLUMN equipo1_id INTEGER DEFAULT NULL').run(); } catch (_) {}
  try { _db.prepare('ALTER TABLE partidos ADD COLUMN equipo2_id INTEGER DEFAULT NULL').run(); } catch (_) {}
  try {
    _db.prepare(`
      CREATE TABLE IF NOT EXISTS equipos (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        torneo_id    INTEGER NOT NULL,
        nombre       TEXT    NOT NULL,
        jugador1_id  TEXT    NOT NULL,
        jugador2_id  TEXT    NOT NULL,
        elo1         INTEGER NOT NULL,
        elo2         INTEGER NOT NULL,
        elo_promedio INTEGER NOT NULL
      )
    `).run();
  } catch (_) {}
  try { _db.prepare('ALTER TABLE torneos ADD COLUMN elo_max_promedio INTEGER DEFAULT NULL').run(); } catch (_) {}
  try { _db.prepare('ALTER TABLE torneos ADD COLUMN costo_inscripcion INTEGER DEFAULT NULL').run(); } catch (_) {}
  try { _db.prepare('ALTER TABLE inscripciones ADD COLUMN pago INTEGER DEFAULT 0').run(); } catch (_) {}
  try {
    _db.prepare(`
      CREATE TABLE IF NOT EXISTS invitaciones_equipo (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        torneo_id     TEXT    NOT NULL,
        invitador_id  TEXT    NOT NULL,
        invitado_id   TEXT    NOT NULL,
        nombre_equipo TEXT    NOT NULL,
        estado        TEXT    NOT NULL DEFAULT 'pendiente',
        creado_en     TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (_) {}
  _db.close();
}

runMigrations();

const app = express();

const { login: discordLogin, notifyDiscord } = require('./bot-fmg-main/discordClient');
require('./bot-fmg-main/index'); // registra eventos: bienvenida, vincular, duelo
discordLogin();
app.locals.notifyDiscord = notifyDiscord;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(compression({ level: 6 }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: ['https://aua.netlify.app', 'https://aua.squareweb.app'], credentials: true }));

// Cache-Control middleware
app.use((req, res, next) => {
  // Assets with long cache (images, fonts, bundles)
  if (req.path.match(/\.(webp|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$|\/js\/bundles\//)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  // HTML pages (short cache)
  else if (req.path === '/' || req.path.match(/\.(html|ejs)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
  // CSS and JS (moderate cache)
  else if (req.path.match(/\.(css|js)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/stream', express.static(path.join(__dirname, 'stream')));

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('[FATAL] SESSION_SECRET no definido en producción. El servidor no puede iniciar de forma segura.');
  process.exit(1);
}

app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: process.env.SESSION_SECRET || 'cambia-esto-en-desarrollo',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  const adminIds = (process.env.ADMIN_DISCORDS || '').split(',').map(s => s.trim()).filter(Boolean);
  res.locals.isAdmin = req.user && adminIds.includes(req.user.id);
  next();
});

const publicPage = view => (req, res) => res.render(view);

app.get('/', (req, res) => {
  const adminIds = (process.env.ADMIN_DISCORDS || '').split(',').map(s => s.trim());
  const isAdmin = req.user && adminIds.includes(req.user.id);

  const db = getDB();
  try {
    const torneosActivos = db.prepare(`
      SELECT * FROM torneos
      WHERE estado IN ('inscripcion', 'jugando')
      ORDER BY CASE WHEN estado = 'inscripcion' THEN 0 ELSE 1 END, creado_en DESC
    `).all();

    const activeTournaments = torneosActivos.map(torneo => {
      const inscriptos = db.prepare('SELECT COUNT(*) as total FROM inscripciones WHERE torneo_id = ?').get(torneo.id).total;
      return { ...torneo, inscriptos };
    });

    const upcomingMatchesRaw = db.prepare(`
      SELECT p.id, p.coordinado, p.fase, p.ronda, p.estado,
             u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
             t.slug AS torneo_slug, t.nombre AS torneo_nombre
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      LEFT JOIN torneos t ON p.torneo_id = t.id
      WHERE p.coordinado IS NOT NULL AND p.coordinado != '' AND p.estado != 'finalizado'
      ORDER BY ABS(strftime('%s', p.coordinado) - strftime('%s','now')) ASC
      LIMIT 3
    `).all();

    const upcomingMatches = upcomingMatchesRaw.map(match => {
      const fecha = new Date(match.coordinado.replace(' ', 'T'));
      const displayDateTime = `${fecha.toLocaleDateString('es-UY', { weekday: 'short', day: '2-digit', month: 'short' })} · ${fecha.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}`;
      return { ...match, displayDateTime };
    });

    res.render('index', {
      isAdmin,
      activeTournaments,
      upcomingMatches,
    });
  } finally {
    db.close();
  }
});

app.get('/feed.json', (req, res) => {
  const feedPath = path.join(process.cwd(), 'feed.json');
  if (!fs.existsSync(feedPath)) return res.status(404).json([]);
  res.sendFile(feedPath);
});

app.get('/torneos', publicPage('torneos'));
app.use(require('./routes/copa'));

app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/penca', require('./routes/penca'));
app.use('/api/torneos', require('./routes/api/torneos'));
app.use('/api/partidos', require('./routes/api/partidos'));
app.use('/api/usuarios', require('./routes/api/usuarios'));

const PORT = process.env.PORT || 80;
const HOST = process.env.HOST || '0.0.0.0';

function iniciarWatcherDB() {
  const DB_PATH = path.join(process.cwd(), 'botfmg.db');
  let uploadTimer = null;
  fs.watchFile(DB_PATH, { interval: 5000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    if (uploadTimer) clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => {
      uploadTimer = null;
      subirBaseDatosGit().catch(e => console.error('[DB-GIT] Error en watcher:', e.message));
    }, 30 * 1000);
  });
  console.log('[DB-GIT] Watcher activo — subirá cambios a GitHub tras 30s de inactividad.');
}

if (process.env.GH_TOKEN) {
  cargarBaseDatosDesdeGit()
    .catch(e => console.warn('[DB-GIT] No se pudo restaurar DB:', e.message))
    .then(() => {
      runMigrations(); // re-aplicar tras sobrescribir la BD desde git
      iniciarWatcherDB();
      cargarRecsDesdeGit().catch(e => console.warn('[RECS-GIT] No se pudieron restaurar recs:', e.message));
      scheduleRecCleanup();
    });
}

const server = http.createServer(app);
require('./web')(app, server);

app.use((req, res) => {
  res.status(404).render('404', { message: 'La página que buscás no existe.' });
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en http://${HOST}:${PORT}`);
});
