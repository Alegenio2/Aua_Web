require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const Database = require('better-sqlite3');
const MemoryStore = require('memorystore')(session);

const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

require('./routes/auth'); // inicializa estrategia Discord

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: process.env.SESSION_SECRET || 'cambia-esto-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
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

app.get('/torneos', publicPage('torneos'));
app.use(require('./routes/copa'));

app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/penca', require('./routes/penca'));
app.use('/api/torneos', require('./routes/api/torneos'));
app.use('/api/partidos', require('./routes/api/partidos'));
app.use('/api/usuarios', require('./routes/api/usuarios'));

app.use((req, res) => {
  res.status(404).render('404', { message: 'La página que buscás no existe.' });
});

const PORT = process.env.PORT || 80;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en http://${HOST}:${PORT}`);
});
