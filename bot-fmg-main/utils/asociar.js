// utils/asociar.js
const fs = require('fs');
const path = require('path'); // Añadimos path para manejar rutas seguras
const { guardarYSubirCambiosArchivo } = require('../git/guardarGit');

// Definimos la ruta apuntando a la raíz (un nivel arriba de /utils)
const archivo = path.join(__dirname, '..', 'usuarios.json');

function cargarAsociaciones() {
  try {
    if (!fs.existsSync(archivo)) return {};

    const data = fs.readFileSync(archivo, 'utf8');
    // Si el archivo está vacío, retornamos objeto vacío para evitar errores de JSON.parse
    if (!data || !data.trim()) return {};

    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error leyendo usuarios.json:', error);
    return {};
  }
}

function guardarAsociaciones(asociaciones) {
  try {
    // Usamos la ruta absoluta definida arriba
    fs.writeFileSync(archivo, JSON.stringify(asociaciones, null, 2), 'utf8');
    
    // ✅ Sube cambios a GitHub
    // Nota: Asegúrate de que guardarYSubirCambiosArchivo no tarde demasiado o maneje sus errores
    guardarYSubirCambiosArchivo(); 
  } catch (error) {
    console.error('❌ Error guardando usuarios.json:', error);
  }
}

/**
 * 🧠 Guarda el usuario COMPLETO
 * Mapeamos los datos para asegurar que el JSON siempre tenga la misma estructura
 */
function asociarUsuario(discordId, usuarioData) {
  const asociaciones = cargarAsociaciones();

  asociaciones[discordId] = {
    profileId: usuarioData.profileId,
    nombre: usuarioData.nombre,
    elo: usuarioData.elo,
    rank: usuarioData.rank,
    wins: usuarioData.wins,
    losses: usuarioData.losses,
    pais: usuarioData.pais,
    country: usuarioData.country,
    clan: usuarioData.clan,
    elomax: usuarioData.elomax,
    ultimapartida: usuarioData.ultimapartida
  };

  guardarAsociaciones(asociaciones);
}

/**
 * 🔎 Obtiene el profileId desde Discord ID
 * Vital para la "Inscripción Rápida"
 */
function obtenerProfileId(discordId) {
  const asociaciones = cargarAsociaciones();
  // Usamos el operador ?. por si el usuario no existe en el JSON
  return asociaciones[discordId]?.profileId || null;
}

/**
 * 🔎 Obtiene el usuario completo
 */
function obtenerUsuario(discordId) {
  const asociaciones = cargarAsociaciones();
  return asociaciones[discordId] || null;
}

module.exports = {
  asociarUsuario,
  obtenerProfileId,
  obtenerUsuario
};

