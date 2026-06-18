const fs = require('fs');
const path = require('path');

const GITHUB_REPO = process.env.GITHUB_REPO || 'Alegenio2/Aua_Web';
const BRANCH_DB   = process.env.GITHUB_DB_BRANCH || process.env.GITHUB_BRANCH || 'data';
const GH_TOKEN    = process.env.GH_TOKEN;
const DB_PATH     = path.join(process.cwd(), 'botfmg.db');
const GH_HEADERS  = () => ({
  Authorization: `Bearer ${GH_TOKEN}`,
  'Content-Type': 'application/json',
  'User-Agent': 'aua-web/1.0'
});

// ── Subir botfmg.db a GitHub ──────────────────────────────────────────────────
async function subirBaseDatosGit() {
  if (!GH_TOKEN) return;
  if (!fs.existsSync(DB_PATH)) return console.error('[DB-GIT] botfmg.db no encontrado.');

  const stat = fs.statSync(DB_PATH);
  if (stat.size > 90 * 1024 * 1024) {
    return console.error('[DB-GIT] botfmg.db excede 90 MB — límite de GitHub Contents API.');
  }

  const contenidoBase64 = fs.readFileSync(DB_PATH).toString('base64');
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/botfmg.db`;

  let sha;
  try {
    const r = await fetch(`${apiUrl}?ref=${BRANCH_DB}`, { headers: GH_HEADERS() });
    if (r.ok) sha = (await r.json()).sha;
  } catch {}

  try {
    const body = { message: `backup: botfmg.db ${new Date().toISOString()}`, content: contenidoBase64, branch: BRANCH_DB };
    if (sha) body.sha = sha;

    const r = await fetch(apiUrl, { method: 'PUT', headers: GH_HEADERS(), body: JSON.stringify(body) });
    if (r.ok) {
      console.log('[DB-GIT] botfmg.db subido a rama', BRANCH_DB);
    } else {
      const err = await r.json().catch(() => ({}));
      console.error('[DB-GIT] Error subiendo DB:', err.message || r.status);
    }
  } catch (e) {
    console.error('[DB-GIT] Error subiendo DB:', e.message);
  }
}

// ── Descargar botfmg.db desde GitHub (usar al arrancar) ──────────────────────
async function cargarBaseDatosDesdeGit() {
  if (!GH_TOKEN) return;
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/botfmg.db?ref=${BRANCH_DB}`;

  try {
    const meta = await fetch(apiUrl, { headers: GH_HEADERS() });
    if (!meta.ok) {
      console.warn('[DB-GIT] No se encontró botfmg.db en GitHub — arrancando con DB local.');
      return;
    }
    const { download_url } = await meta.json();
    const resp = await fetch(download_url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const buf = await resp.arrayBuffer();
    fs.writeFileSync(DB_PATH, Buffer.from(buf));
    console.log('[DB-GIT] botfmg.db restaurado desde rama', BRANCH_DB);
  } catch (e) {
    console.error('[DB-GIT] Error descargando DB:', e.message);
  }
}

// ── Debounce: agrupa escrituras y hace un solo commit ─────────────────────────
let _uploadTimer = null;
function scheduleDbBackup(delayMs = 15000) {
  if (!GH_TOKEN) return;
  if (_uploadTimer) clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(() => { _uploadTimer = null; subirBaseDatosGit(); }, delayMs);
}

module.exports = { subirBaseDatosGit, cargarBaseDatosDesdeGit, scheduleDbBackup };
