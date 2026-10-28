# STREET CONTROL

Bot multifunción de Discord y panel web con Firebase Realtime Database.

## Qué incluye

- Bienvenidas y despedidas.
- Tickets privados por categorías y comando `/panel-tickets`.
- Moderación básica: antispam y filtro de enlaces.
- Avisos automáticos en horario de Chile.
- Embeds programados por días y hora.
- Registros de entradas/salidas, mensajes y moderación.
- Comandos `/ping`, `/estado`, `/limpiar`, `/expulsar`, `/banear` y `/evento`.
- Diagnóstico en `/health` y comando `/estado`.

## 1. Firebase

Este código del panel está configurado para el proyecto `th-street-a49e8`.

1. En Firebase Console, abre ese proyecto.
2. En **Authentication → Sign-in method**, activa **Google**.
3. En **Authentication → Settings → Authorized domains**, agrega `akarygtacuenta.github.io`. Si usas otro dominio, agrega también ese dominio.
4. En **Realtime Database**, comprueba que la URL sea `https://th-street-a49e8-default-rtdb.firebaseio.com`.
5. En **Realtime Database → Rules**, publica el contenido de `database.rules.json` de este repositorio.
6. En **Project settings → Service accounts**, genera una clave privada de cuenta de servicio para el proyecto `th-street-a49e8`. Guarda el JSON en privado: nunca lo subas al repositorio ni lo compartas en capturas.

Las reglas de la base permiten que cada usuario autenticado lea y escriba solo su propia ruta `users/{uid}`. El bot usa Firebase Admin y necesita la cuenta de servicio del mismo proyecto.

## 2. Discord Developer Portal

1. Abre la aplicación del bot y copia el **Application ID**: será `CLIENT_ID`.
2. En **Bot**, genera/copia el token del bot: será `DISCORD_TOKEN`. No compartas el token.
3. En **Bot → Privileged Gateway Intents**, activa **Server Members Intent** y **Message Content Intent**.
4. Invita el bot al servidor con los scopes `bot` y `applications.commands`.
5. Dale solo los permisos que usarás: ver canales, enviar mensajes, insertar enlaces/embeds, leer historial, administrar canales para tickets, gestionar mensajes para moderación, moderar miembros y expulsar/banear si usarás esos comandos.
6. Activa el modo desarrollador de Discord, haz clic derecho en tu servidor y copia su ID: será `GUILD_ID`.

## 3. Render

La URL depende del servicio que creaste en Render; no se debe asumir un nombre de dominio.

En **Render → servicio → Environment**, configura estas variables:

| Variable | Valor |
|---|---|
| `DISCORD_TOKEN` | Token del bot de Discord |
| `CLIENT_ID` | Application ID de Discord |
| `GUILD_ID` | ID numérico del servidor; recomendado para que los comandos aparezcan inmediatamente |
| `OWNER_UID` | UID que muestra el panel después de iniciar sesión con Google |
| `FIREBASE_DATABASE_URL` | `https://th-street-a49e8-default-rtdb.firebaseio.com` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Contenido completo del JSON de la cuenta de servicio de Firebase, del proyecto `th-street-a49e8` |

Para `OWNER_UID`: abre el panel, inicia sesión y copia el UID que aparece en **Resumen** con el botón **Copiar UID para Render**. Pégalo sin comillas ni espacios adicionales. Es el identificador de Firebase Authentication, no tu correo electrónico ni tu ID de Discord.

En Render usa **Build Command** `npm install` y **Start Command** `npm start`. Después guarda las variables y ejecuta **Manual Deploy → Deploy latest commit**.

Si no configuras `GUILD_ID`, el bot intentará registrar comandos globales, pero Discord puede tardar en mostrarlos. Para el funcionamiento recomendado, configura el ID del servidor.

## 4. GitHub Pages / panel web

El panel principal está en `index.html`; Firebase Hosting usa `public/index.html`.

Para GitHub Pages, abre **Settings → Pages** y publica desde la rama `main`, carpeta `/(root)`. El dominio `akarygtacuenta.github.io` debe estar autorizado en Firebase Authentication.

## 5. Verificación

1. En Render, copia la URL pública del servicio STREET CONTROL. En el panel, sección Resumen, pega la URL en **URL pública de tu servicio STREET CONTROL en Render** y pulsa **Guardar URL y comprobar conexión**. El panel consultará automáticamente `/health`. También puedes abrir `TU_URL_DE_RENDER/health` en el navegador. El JSON muestra si el bot está conectado, si Firebase se inicializó, qué configuraciones encontró y qué variables faltan; no muestra los secretos.
2. Inicia sesión en el panel. En Resumen, el estado del bot se actualiza automáticamente.
3. Copia el UID mostrado y comprueba que coincide exactamente con `OWNER_UID` en Render.
4. En Discord ejecuta `/estado` y luego `/ping`.
5. Guarda cada módulo desde su sección. Introduce IDs reales de canales y roles de Discord.
6. Para publicar tickets, guarda la sección y ejecuta `/panel-tickets` en el servidor.
7. Para eventos, usa `/evento` y completa título, descripción, fecha, hora, canal y rol opcional.

## Errores comunes

- **No aparece el inicio de sesión de Google:** activa Google en Firebase Authentication y autoriza el dominio exacto del panel.
- **El panel guarda, pero Discord no cambia:** revisa que `OWNER_UID` coincida con el UID de la sesión; revisa `/health`, Render Logs y `/estado`.
- **Proyecto Firebase incorrecto:** el JSON de cuenta de servicio y `FIREBASE_DATABASE_URL` deben pertenecer al mismo proyecto que el panel (`th-street-a49e8`).
- **No aparecen los comandos slash:** verifica `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, scopes de invitación y que el bot esté en el servidor.
- **No publica mensajes:** revisa los IDs de canal, permisos del bot, el módulo activado y que la hora configurada sea hora de Chile.

Nunca publiques el token de Discord ni el JSON de cuenta de servicio. Si una clave privada se expuso, revócala y genera otra.
