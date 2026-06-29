# Overlay de Jugador AoE2

Tarjeta automática de jugador estilo "figurita" que obtiene datos en tiempo real de aoe2companion. Similar a los otros overlays del proyecto.

## Características

- 📊 **Datos en tiempo real**: Rating actual, máximo, victorias, derrotas
- 🔥 **Racha**: Muestra racha de victorias o derrotas (últimos 5 partidos)
- ⚔️ **Civilización favorita**: Basada en los últimos partidos
- 🗺️ **Mapa favorito**: Basada en los últimos partidos
- 🎨 **Diseño tipo overlay**: Fondo transparente, compatible con OBS/Streamlabs
- ♻️ **Actualización automática**: Se refresca cada 30 segundos

## Uso

### Opción 1: Panel de Control (Recomendado)
```
http://localhost/overlay-control-jugador.html
```
Interfaz para buscar jugadores y copiar URLs.

### Opción 2: URL directa en navegador
```
http://localhost/overlay-jugador.html?id={profileId}
```

Ejemplo:
```
http://localhost/overlay-jugador.html?id=195348
```

### Opción 3: En OBS/Streamlabs como Browser Source
1. Agregar nueva fuente → Browser source
2. URL: `http://localhost/overlay-jugador.html?id=195348`
3. Ancho: 480px (recomendado)
4. Alto: 600px (recomendado)
5. Marcar "Refresh browser when scene becomes active" (opcional)

### Opción 4: En HTML/página web
Embed en un iframe:
```html
<iframe 
  src="http://localhost/overlay-jugador.html?id=195348" 
  width="480" 
  height="600" 
  style="border: none; background: transparent;"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
></iframe>
```

## Encontrar profileId

1. Ir a [aoe2companion.com](https://aoe2companion.com)
2. Buscar el jugador
3. El URL será: `https://aoe2companion.com/player/{profileId}/{nombre}`
4. El número es el **profileId**

Ejemplo: `https://aoe2companion.com/player/195348/TheViper`
→ profileId = **195348**

## API

Si necesitas solo los datos en JSON:

```bash
GET /api/jugador/{profileId}
```

Respuesta:
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

## Personalización

Para cambiar colores, tamaños o estilos, editar el archivo:
```
views/overlay-jugador.ejs
```

Colores principales (variables de CSS):
- `#1a0f05` - Fondo oscuro
- `#8b6f47` - Color de borde/acento
- `#b8860b` - Color de highlight (ELO, nombres)
- `#e8d4b8` - Color de texto principal

## Troubleshooting

**"profileId inválido"**
- Verificar que sea solo números
- Ejemplo válido: `195348`

**"No se encontró el jugador"**
- El perfil no existe en aoe2companion
- O el jugador nunca ha jugado 1v1 (requiere datos de leaderboard)

**Sin datos de racha/civ/mapa**
- El jugador tiene muy pocos partidos registrados en aoe2companion
- Los datos se calculan a partir de los últimos partidos en su historial

## Ejemplo de URL para diferentes jugadores

```
# TheViper (Perú)
/overlay/jugador/195348

# Hera (Vietnam)
/overlay/jugador/155908

# Mr Yo (China)
/overlay/jugador/197746

# DauT (Alemania)
/overlay/jugador/196540
```

## Notas técnicas

- Usa la API pública de aoe2companion (`data.aoe2companion.com`)
- Rate limit: 500ms entre requests
- Actualización automática cada 30 segundos
- Compatible con navegadores modernos (Chrome, Firefox, Safari, Edge)
- Fondo transparente para overlays
