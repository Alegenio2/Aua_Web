# 🎨 Setup: Tarjeta de Jugador AoE2 con aoe2companion

## Resumen de Cambios

Se implementó un **overlay automático de jugador** que obtiene datos en tiempo real de aoe2companion y los muestra en una tarjeta estilo "figurita del mundial". **Usando archivos HTML estáticos en `/public`** igual que los otros overlays del proyecto.

### Archivos Modificados

| Archivo | Cambio | Descripción |
|---------|--------|-------------|
| `lib/aoe2.js` | ➕ Nueva función | `obtenerDatosJugadorCompl(profileId)` - Obtiene datos completos del jugador |
| `web.js` | ➕ Nueva ruta API | `GET /api/jugador/:profileId` - Endpoint para datos del jugador |

### Archivos Creados

| Archivo | Descripción |
|---------|-------------|
| `public/overlay-jugador.html` | Tarjeta visual tipo overlay (HTML estático) |
| `public/overlay-control-jugador.html` | Panel de control para buscar jugadores (HTML estático) |
| `OVERLAY_JUGADOR.md` | Documentación de uso |
| `OVERLAY_JUGADOR_SETUP.md` | Guía de setup técnico |

---

## 🚀 Cómo Usar

### Opción 1: Panel de Control (Recomendado)

1. Abre: **`http://localhost/overlay-control-jugador.html`**
2. Busca un jugador por profileId (ej: 195348)
3. Haz clic en "Ver Overlay"
4. Copia la URL para usarla en OBS/Streamlabs

### Opción 2: URL Directa

```
http://localhost/overlay-jugador.html?id={profileId}
```

Ejemplos:
- TheViper: `http://localhost/overlay-jugador.html?id=195348`
- Hera: `http://localhost/overlay-jugador.html?id=155908`

### Opción 3: En OBS/Streamlabs

1. Agregar fuente → **Browser Source**
2. URL: `http://localhost/overlay-jugador.html?id=195348`
3. Tamaño recomendado: **480x600 píxeles**
4. Marcar: "Refresh browser when scene becomes active"

---

## 📊 Datos que Muestra

La tarjeta muestra en tiempo real:

```
┌─────────────────────────────┐
│  TheViper 🇵🇪               │
│  Rank #15 | Clan: VIPE      │
├─────────────────────────────┤
│ ELO: 2100  │  Max: 2150    │
│ Wins: 1850 │  Losses: 450  │
├─────────────────────────────┤
│  🔥 Racha de 3 Victorias   │
├─────────────────────────────┤
│ ⚔️ Britons  │  🏜️ Arabia    │
│ Civ Favorita  Mapa Favorito│
└─────────────────────────────┘
```

- **Rating Actual & Máximo**: De leaderboard 1v1
- **Victorias/Derrotas**: Del leaderboard
- **Racha**: Calculada de los últimos 5 partidos
- **Civilización Favorita**: La más usada en historial
- **Mapa Favorito**: El más jugado en historial

---

## 🔧 API Disponible

Si necesitas solo los datos en JSON:

```bash
GET /api/jugador/{profileId}
```

**Respuesta:**
```json
{
  "nombre": "TheViper",
  "elo": 2100,
  "elomax": 2150,
  "rank": 15,
  "wins": 1850,
  "losses": 450,
  "clan": "VIPE",
  "country": "Peru",
  "pais": "🇵🇪",
  "racha": {
    "tipo": "win",
    "cantidad": 3
  },
  "civFavorita": "Britons",
  "mapFavorita": "Arabia",
  "totalPartidos": 2300,
  "profileId": "195348"
}
```

---

## 🎯 Flujo de Datos

```
┌─────────────────────────────────────────────────────────────┐
│  Usuario busca jugador en /overlay/control                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  /overlay/jugador/{profileId} renderiza la página            │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  JavaScript en cliente llama a /api/jugador/{profileId}      │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  obtenerDatosJugadorCompl() consulta aoe2companion API       │
│  - https://data.aoe2companion.com/api/profiles/{profileId}  │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Datos se procesan y formatean en servidor                   │
│  - Rating, rank, W/L                                         │
│  - Racha de últimos 5 partidos                               │
│  - Civ y Mapa favoritos                                      │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  JSON se envía al cliente                                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Cliente renderiza la tarjeta con estilos overlay            │
│  Se actualiza cada 30 segundos                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎨 Personalización

Para cambiar colores, tamaños o estilos, editar:

```
views/overlay-jugador.ejs
```

Paleta de colores (líneas 34-48):
- **Fondo**: `#1a0f05`
- **Borde/Acento**: `#8b6f47`
- **Highlight (ELO)**: `#b8860b`
- **Texto**: `#e8d4b8`

Cambiar tamaño máximo (línea 23):
```css
max-width: 420px;  /* Ajustar aquí */
```

---

## 📱 Responsive

La tarjeta se adapta automáticamente a:
- 📺 **Desktop**: 480px (ancho máximo)
- 📱 **Mobile**: 100% del ancho disponible
- 🖥️ **OBS/Streamlabs**: Perfecta a 480x600px

---

## ⚡ Performance

- **Caching**: aoe2companion API tiene rate limit de 500ms
- **Actualización**: Cada 30 segundos automáticamente
- **Fondo transparente**: Optimizado para overlays
- **Tamaño**: ~15KB (sin comprimir)

---

## 🐛 Troubleshooting

| Problema | Solución |
|----------|----------|
| "profileId inválido" | Usar solo números (ej: 195348) |
| "No se encontró el jugador" | Verificar en aoe2companion que el perfil existe |
| Sin datos de racha/civ | El jugador tiene muy pocos partidos registrados |
| No se actualiza | Verificar que JavaScript esté habilitado |
| Fondo no transparente en OBS | Marcar "Refresh browser when scene becomes active" |

---

## 🔗 Ejemplos de URLs

```
# Control panel (buscar jugadores)
http://localhost/overlay-control-jugador.html

# Overlay directo - TheViper
http://localhost/overlay-jugador.html?id=195348

# Overlay directo - Hera
http://localhost/overlay-jugador.html?id=155908

# API de datos - JSON
http://localhost/api/jugador/195348

# Embed en iframe
<iframe src="http://localhost/overlay-jugador.html?id=195348" 
        width="480" height="600" 
        style="border:none;background:transparent;"></iframe>
```

---

## 📚 Próximas Mejoras Posibles

- [ ] Búsqueda por nombre de jugador
- [ ] Historial de últimos 5 partidos
- [ ] Gráfico de evolución de ELO
- [ ] Estadísticas por civilización (WR%)
- [ ] Animaciones de actualización
- [ ] Dark mode / Light mode
- [ ] Exportar como imagen PNG
- [ ] Webhooks para actualizaciones en tiempo real

---

## 💡 Notas

- Los datos se obtienen de **aoe2companion API** (servicio público)
- El overlay funciona con **fondo transparente** para OBS/Streamlabs
- Se actualiza automáticamente cada **30 segundos**
- Compatible con navegadores modernos (Chrome, Firefox, Safari, Edge)
- Responsive: funciona en cualquier resolución

---

**¿Preguntas?** Ver `OVERLAY_JUGADOR.md` para más detalles.
