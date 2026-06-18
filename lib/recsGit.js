const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const GITHUB_REPO = process.env.GITHUB_REPO || 'Alegenio2/Aua_Web';
const BRANCH      = process.env.GITHUB_DB_BRANCH || process.env.GITHUB_BRANCH || 'data';
const GH_TOKEN    = process.env.GH_TOKEN;
const RECS_DIR    = path.join(process.cwd(), 'public', 'recs');
const DB_PATH     = path.join(process.cwd(), 'botfmg.db');
const MAX_SIZE    = 25 * 1024 * 1024; // 25 MB — límite seguro de GitHub Contents API

const GH_HEADERS = () => ({
  Authorization: `Bearer ${GH_TOKEN}`,
  'Content-Type': 'application/json',
  'User-Agent': 'aua-web/1.0'
});

function apiUrl(filename) {
  return `https://api.github.com/repos/${GITHUB_REPO}/contents/recs/${filename}`;
}

async function getSha(filename) {
  try {
    const r = await fetch(`${apiUrl(filename)}?ref=${BRANCH}`, { headers: GH_HEADERS() });
    if (r.ok) return (await r.json()).sha;
  } catch {}
  return null;
}

// ── Subir una rec a GitHub ────────────────────────────────────────────────────
async function subirRecGit(filename) {
  if (!GH_TOKEN) return;
  const localPath = path.join(RECS_DIR, filename);
  if (!fs.existsSync(localPath)) return;

  const size = fs.statSync(localPath).size;
  if (size > MAX_SIZE) {
    return console.warn(`[RECS-GIT] ${filename} supera 25 MB — no se sube a GitHub.`);
  }

  const content = fs.readFileSync(localPath).toString('base64');
  const sha = await getSha(filename);

  try {
    const body = { message: `rec: ${filename}`, content, branch: BRANCH };
    if (sha) body.sha = sha;
    const r = await fetch(apiUrl(filename), { method: 'PUT', headers: GH_HEADERS(), body: JSON.stringify(body) });
    if (r.ok) {
      console.log(`[RECS-GIT] ${filename} subido a GitHub (rama ${BRANCH}).`);
    } else {
      const err = await r.json().catch(() => ({}));
      console.error(`[RECS-GIT] Error subiendo ${filename}:`, err.message || r.status);
    }
  } catch (e) {
    console.error(`[RECS-GIT] Error subiendo ${filename}:`, e.message);
  }
}

// ── Eliminar una rec de GitHub ────────────────────────────────────────────────
async function eliminarRecGit(filename) {
  if (!GH_TOKEN) return;
  const sha = await getSha(filename);
  if (!sha) return;

  try {
    const body = { message: `delete rec: ${filename}`, sha, branch: BRANCH };
    const r = await fetch(apiUrl(filename), { method: 'DELETE', headers: GH_HEADERS(), body: JSON.stringify(body) });
    if (r.ok) console.log(`[RECS-GIT] ${filename} eliminado de GitHub.`);
  } catch (e) {
    console.error(`[RECS-GIT] Error eliminando ${filename}:`, e.message);
  }
}

// ── Al arrancar: restaurar recs referenciadas en la DB que no estén en disco ──
async function cargarRecsDesdeGit() {
  if (!GH_TOKEN) return;
  if (!fs.existsSync(RECS_DIR)) fs.mkdirSync(RECS_DIR, { recursive: true });

  let db;
  try {
    db = new Database(DB_PATH);
    const partidos = db.prepare(`
      SELECT rec_link FROM partidos WHERE rec_link IS NOT NULL AND rec_link != ''
    `).all();

    for (const { rec_link } of partidos) {
      const filename = path.basename(rec_link);
      const localPath = path.join(RECS_DIR, filename);
      if (fs.existsSync(localPath)) continue;

      try {
        const meta = await fetch(`${apiUrl(filename)}?ref=${BRANCH}`, { headers: GH_HEADERS() });
        if (!meta.ok) continue;
        const { download_url } = await meta.json();
        const resp = await fetch(download_url);
        if (!resp.ok) continue;
        fs.writeFileSync(localPath, Buffer.from(await resp.arrayBuffer()));
        console.log(`[RECS-GIT] ${filename} restaurado desde GitHub.`);
      } catch {}
    }
  } finally {
    if (db) try { db.close(); } catch {}
  }
}

// ── Limpiar recs con más de 5 días: borra local, GitHub y limpia la DB ────────
async function limpiarRecsAntiguos() {
  let db;
  try {
    db = new Database(DB_PATH);
    const antiguos = db.prepare(`
      SELECT id, rec_link FROM partidos
      WHERE rec_link IS NOT NULL AND rec_link != ''
        AND fecha < datetime('now', '-5 days')
    `).all();

    for (const { id, rec_link } of antiguos) {
      const filename = path.basename(rec_link);

      const localPath = path.join(RECS_DIR, filename);
      try { if (fs.existsSync(localPath)) fs.unlinkSync(localPath); } catch {}

      await eliminarRecGit(filename);

      db.prepare('UPDATE partidos SET rec_link = NULL WHERE id = ?').run(id);
      console.log(`[RECS-GIT] REC partido ${id} eliminada (más de 5 días).`);
    }

    if (antiguos.length > 0) {
      console.log(`[RECS-GIT] ${antiguos.length} REC(s) antigua(s) eliminada(s).`);
    }
  } finally {
    if (db) try { db.close(); } catch {}
  }
}

// ── Programar limpieza cada 5 días ────────────────────────────────────────────
function scheduleRecCleanup() {
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
  // Primera ejecución al minuto de arrancar (para no bloquear el inicio)
  setTimeout(() => limpiarRecsAntiguos().catch(e => console.error('[RECS-GIT] Error limpieza:', e.message)), 60 * 1000);
  setInterval(() => limpiarRecsAntiguos().catch(e => console.error('[RECS-GIT] Error limpieza:', e.message)), FIVE_DAYS);
}

module.exports = { subirRecGit, cargarRecsDesdeGit, limpiarRecsAntiguos, scheduleRecCleanup };
