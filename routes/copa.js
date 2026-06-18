const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const router = express.Router();
const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

// Slug del torneo Copa Uruguaya — ajustar si el torneo se crea con otro nombre
const COPA_SLUG = process.env.COPA_SLUG || 'copa-uruguaya-2026';

function calcularTabla(jugadores, partidos, clasificados) {
  const stats = {};
  jugadores.forEach(j => {
    // 2v2: clave por equipo_id; 1v1: clave por usuario_id
    const key = j.equipo_id != null ? j.equipo_id : j.usuario_id;
    stats[key] = { nick: j.nombre, elo: j.elo, pj: 0, pg: 0, pp: 0, sf: 0, sc: 0, pts: 0 };
  });
  partidos.forEach(p => {
    if (p.estado !== 'finalizado') return;
    const id1 = p.equipo1_id != null ? p.equipo1_id : p.jugador1_id;
    const id2 = p.equipo2_id != null ? p.equipo2_id : p.jugador2_id;
    if (!stats[id1] || !stats[id2]) return;
    const s1 = p.score1, s2 = p.score2;
    stats[id1].pj++; stats[id2].pj++;
    stats[id1].sf += s1; stats[id1].sc += s2;
    stats[id2].sf += s2; stats[id2].sc += s1;
    if (s1 > s2) {
      stats[id1].pg++; stats[id1].pts += 2;
      stats[id2].pp++; if (s2 >= 1) stats[id2].pts += 1;
    } else if (s2 > s1) {
      stats[id2].pg++; stats[id2].pts += 2;
      stats[id1].pp++; if (s1 >= 1) stats[id1].pts += 1;
    }
  });
  return Object.values(stats)
    .sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      const da = a.sf - a.sc, db = b.sf - b.sc;
      if (db !== da) return db - da;
      return b.sf - a.sf;
    })
    .map((j, i) => ({ ...j, clasificado: i < clasificados }));
}

// ── Redirect old Copa URL to the new eventos page ───────────────────────────
router.get('/copa_uruguaya_2026', (req, res) => {
  res.redirect(301, '/eventos');
});

// ── GET /copa_stats ──────────────────────────────────────────────────────────
router.get('/copa_stats', (req, res) => {
  const db = getDB();
  try {
    const torneo =
      db.prepare('SELECT * FROM torneos WHERE slug = ?').get(COPA_SLUG) ||
      db.prepare(`
        SELECT t.* FROM torneos t
        WHERE EXISTS (SELECT 1 FROM partidos p WHERE p.torneo_id = t.id AND p.estado = 'finalizado')
        ORDER BY t.id DESC LIMIT 1
      `).get() ||
      db.prepare("SELECT * FROM torneos ORDER BY id DESC LIMIT 1").get();

    if (!torneo) {
      return res.render('copa_stats', {
        torneo: null,
        stats: { meta: { total_partidas: 0, ultima_actualizacion: null }, jugadores: {}, mapas: {}, civs: {}, partidas: [] }
      });
    }

    console.log(`[copa_stats] torneo: "${torneo.nombre}" (slug: ${torneo.slug}, id: ${torneo.id})`);

    const partidos = db.prepare(`
      SELECT p.id, p.score1, p.score2, p.ronda, p.fase, p.grupo_id, p.fecha, p.draftmap, p.draftcivs,
             p.jugador1_id AS j1_id, p.jugador2_id AS j2_id,
             u1.nombre AS j1_nombre, u2.nombre AS j2_nombre
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      WHERE p.torneo_id = ? AND p.estado = 'finalizado'
      ORDER BY p.id DESC
    `).all(torneo.id);

    console.log(`[copa_stats] partidos finalizados: ${partidos.length}`);

    const statsRaw = db.prepare(`
      SELECT ps.*, p.jugador1_id AS j1_id, p.jugador2_id AS j2_id
      FROM partidas_stats ps
      JOIN partidos p ON ps.partido_id = p.id
      WHERE p.torneo_id = ?
    `).all(torneo.id);

    // Jugadores: win/loss desde partidos
    const jugadoresMap = {};
    const addPlayer = (id, nick) => {
      if (!jugadoresMap[id]) jugadoresMap[id] = { nick, global: { pj: 0, pg: 0, pp: 0, winrate: 0 }, civs: {}, mapas: {} };
    };
    partidos.forEach(p => {
      addPlayer(p.j1_id, p.j1_nombre);
      addPlayer(p.j2_id, p.j2_nombre);
      jugadoresMap[p.j1_id].global.pj++;
      jugadoresMap[p.j2_id].global.pj++;
      if (p.score1 > p.score2) { jugadoresMap[p.j1_id].global.pg++; jugadoresMap[p.j2_id].global.pp++; }
      else if (p.score2 > p.score1) { jugadoresMap[p.j2_id].global.pg++; jugadoresMap[p.j1_id].global.pp++; }
    });
    Object.values(jugadoresMap).forEach(j => {
      j.global.winrate = j.global.pj > 0 ? Math.round((j.global.pg / j.global.pj) * 100) : 0;
    });

    // Civs y mapas desde partidas_stats (si hay datos)
    const civsMap = {};
    const mapasMap = {};
    statsRaw.forEach(s => {
      const mapa  = s.mapa || 'Desconocido';
      const civ1  = s.civilizacion_1 || 'Desconocida';
      const civ2  = s.civilizacion_2 || 'Desconocida';
      const gano1 = s.ganador_id === s.j1_id;
      const ganadorCiv  = gano1 ? civ1 : civ2;
      const perdedorCiv = gano1 ? civ2 : civ1;

      // Mapas
      if (!mapasMap[mapa]) mapasMap[mapa] = { total_partidas: 0, civs_ganadoras: {}, civs_perdedoras: {} };
      mapasMap[mapa].total_partidas++;
      mapasMap[mapa].civs_ganadoras[ganadorCiv]  = (mapasMap[mapa].civs_ganadoras[ganadorCiv]  || 0) + 1;
      mapasMap[mapa].civs_perdedoras[perdedorCiv] = (mapasMap[mapa].civs_perdedoras[perdedorCiv] || 0) + 1;

      // Civs
      [civ1, civ2].forEach((civ, i) => {
        const gano = i === 0 ? gano1 : !gano1;
        if (!civsMap[civ]) civsMap[civ] = { total_jugadas: 0, total_ganadas: 0, winrate: 0, vs_civs: {} };
        civsMap[civ].total_jugadas++;
        if (gano) civsMap[civ].total_ganadas++;
      });

      // Matchup civ vs civ
      if (!civsMap[civ1].vs_civs[civ2]) civsMap[civ1].vs_civs[civ2] = { jugadas: 0, ganadas: 0, winrate: 0 };
      civsMap[civ1].vs_civs[civ2].jugadas++;
      if (gano1) civsMap[civ1].vs_civs[civ2].ganadas++;
      if (!civsMap[civ2].vs_civs[civ1]) civsMap[civ2].vs_civs[civ1] = { jugadas: 0, ganadas: 0, winrate: 0 };
      civsMap[civ2].vs_civs[civ1].jugadas++;
      if (!gano1) civsMap[civ2].vs_civs[civ1].ganadas++;
    });

    // Calcular winrates finales de civs
    Object.values(civsMap).forEach(c => {
      c.winrate = c.total_jugadas > 0 ? Math.round((c.total_ganadas / c.total_jugadas) * 100) : 0;
      Object.values(c.vs_civs).forEach(v => {
        v.winrate = v.jugadas > 0 ? Math.round((v.ganadas / v.jugadas) * 100) : 0;
      });
    });

    const stats = {
      meta: {
        torneo: torneo.slug,
        ultima_actualizacion: partidos[0]?.fecha || null,
        total_partidas: partidos.length
      },
      jugadores: jugadoresMap,
      mapas: mapasMap,
      civs: civsMap,
      partidas: partidos.map(p => ({
        fecha: p.fecha,
        mapa: p.draftmap,
        ronda: p.ronda,
        jugador1: { nick: p.j1_nombre, gano: p.score1 > p.score2 },
        jugador2: { nick: p.j2_nombre, gano: p.score2 > p.score1 },
        score1: p.score1,
        score2: p.score2
      }))
    };

    res.render('copa_stats', { torneo, stats });
  } finally {
    db.close();
  }
});

// ── GET /jugador/:discordId ───────────────────────────────────────────────────
router.get('/jugador/:discordId', (req, res) => {
  const db = getDB();
  try {
    const jugador = db.prepare('SELECT * FROM usuarios WHERE discordId = ?').get(req.params.discordId);
    if (!jugador) return res.status(404).render('404', { message: 'Jugador no encontrado.' });

    const partidos = db.prepare(`
      SELECT p.id, p.fase, p.ronda, p.score1, p.score2, p.estado, p.fecha, p.draftmap,
             p.jugador1_id, p.jugador2_id,
             u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
             t.nombre AS torneo_nombre, t.slug AS torneo_slug
      FROM partidos p
      JOIN torneos t ON p.torneo_id = t.id
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      WHERE (p.jugador1_id = ? OR p.jugador2_id = ?) AND p.estado = 'finalizado'
      ORDER BY p.fecha DESC
    `).all(jugador.discordId, jugador.discordId);

    const statsPorTorneo = {};
    partidos.forEach(p => {
      if (!statsPorTorneo[p.torneo_slug]) {
        statsPorTorneo[p.torneo_slug] = { nombre: p.torneo_nombre, slug: p.torneo_slug, pj: 0, pg: 0, pp: 0 };
      }
      const esMio = p.jugador1_id === jugador.discordId;
      const s = esMio ? p.score1 : p.score2;
      const sr = esMio ? p.score2 : p.score1;
      statsPorTorneo[p.torneo_slug].pj++;
      if (s > sr) statsPorTorneo[p.torneo_slug].pg++;
      else statsPorTorneo[p.torneo_slug].pp++;
    });

    res.render('jugador', { jugador, partidos, statsPorTorneo: Object.values(statsPorTorneo) });
  } finally {
    db.close();
  }
});

// ── GET /eventos ─────────────────────────────────────────────────────────────
router.get('/eventos', (req, res) => {
  const db = getDB();
  try {
    const activeTournaments = db.prepare(`
      SELECT t.*, COUNT(i.id) AS inscriptos
      FROM torneos t
      LEFT JOIN inscripciones i ON i.torneo_id = t.id
      WHERE t.estado IN ('inscripcion', 'jugando')
      GROUP BY t.id
      ORDER BY t.creado_en DESC
    `).all();
    res.render('eventos', { activeTournaments, user: req.user || null });
  } finally {
    db.close();
  }
});

// ── GET /torneo/:slug ─────────────────────────────────────────────────────────
router.get('/torneo/:slug', (req, res) => {
  const db = getDB();
  try {
    const torneo = db.prepare('SELECT * FROM torneos WHERE slug = ?').get(req.params.slug);
    if (!torneo) return res.status(404).render('404', { message: 'Torneo no encontrado.' });

    const inscriptos = db.prepare('SELECT COUNT(*) AS total FROM inscripciones WHERE torneo_id = ?').get(torneo.id).total;
    const clasificados = torneo.clasificados_por_grupo || 1;

    const esEquipo = torneo.tipo !== '1v1';

    const gruposRaw = db.prepare('SELECT * FROM grupos WHERE torneo_id = ? ORDER BY nombre').all(torneo.id);
    const grupos = gruposRaw.map(g => {
      const participantes = db.prepare(`
        SELECT gp.usuario_id, gp.equipo_id, gp.elo,
               u.nombre AS nombre,
               e.nombre AS equipo_nombre
        FROM grupo_participantes gp
        LEFT JOIN usuarios u ON gp.usuario_id = u.discordId
        LEFT JOIN equipos  e ON gp.equipo_id  = e.id
        WHERE gp.grupo_id = ?
        ORDER BY gp.elo DESC
      `).all(g.id).map(p => ({ ...p, nombre: p.equipo_nombre || p.nombre }));

      const partidos = db.prepare(`
        SELECT p.*,
               u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
               e1.nombre AS eq1_nombre, e2.nombre AS eq2_nombre
        FROM partidos p
        LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
        LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
        WHERE p.grupo_id = ? AND p.fase = 'grupos'
        ORDER BY p.ronda, p.id
      `).all(g.id).map(p => ({
        ...p,
        j1_nombre: p.eq1_nombre || p.j1_nombre,
        j2_nombre: p.eq2_nombre || p.j2_nombre,
      }));

      const tabla = calcularTabla(participantes, partidos, clasificados);

      const rondasMap = {};
      partidos.forEach(p => {
        if (!rondasMap[p.ronda]) rondasMap[p.ronda] = [];
        rondasMap[p.ronda].push(p);
      });
      const rondas = Object.keys(rondasMap)
        .map(Number).sort((a, b) => a - b)
        .map(r => ({ ronda: r, partidos: rondasMap[r] }));

      const totalPartidos = partidos.length;
      const completados = partidos.filter(p => p.estado === 'finalizado').length;

      return { ...g, participantes, partidos, tabla, rondas, totalPartidos, completados };
    });

    const fasesElim = ['octavos', 'cuartos', 'semis', 'final', 'eliminatoria'];
    const eliminatorias = {};
    fasesElim.forEach(fase => {
      const matches = db.prepare(`
        SELECT p.*,
               u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
               e1.nombre AS eq1_nombre, e2.nombre AS eq2_nombre
        FROM partidos p
        LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
        LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
        WHERE p.torneo_id = ? AND p.fase = ?
        ORDER BY p.ronda, p.id
      `).all(torneo.id, fase).map(p => ({
        ...p,
        j1_nombre: p.eq1_nombre || p.j1_nombre,
        j2_nombre: p.eq2_nombre || p.j2_nombre,
      }));
      if (matches.length) eliminatorias[fase] = matches;
    });

    const inscriptosList = torneo.estado === 'inscripcion'
      ? db.prepare(`
          SELECT u.nombre, u.clan, u.pais, i.elo_inscripcion
          FROM inscripciones i
          JOIN usuarios u ON i.usuario_id = u.discordId
          WHERE i.torneo_id = ?
          ORDER BY i.elo_inscripcion DESC
        `).all(torneo.id)
      : [];

    res.render('torneo', { user: req.user || null, torneo, inscriptos, grupos, eliminatorias, inscriptosList });
  } finally {
    db.close();
  }
});

module.exports = router;
