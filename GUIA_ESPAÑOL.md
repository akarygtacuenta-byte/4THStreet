# STREET CONTROL — Guia de instalacion en español

Este proyecto incluye un bot de Discord en Node.js, un panel web estatico y Firebase Realtime Database. Sigue los pasos en orden. No necesitas pegar todas las claves en el codigo: los secretos del bot van en las variables privadas del alojamiento.

## 0. Que necesitas

- Una cuenta de Discord y permiso para administrar tu servidor.
- Una cuenta de Google/Firebase.
- Una cuenta de GitHub.
- Node.js 20 o superior para probar el bot en tu PC.
- Git instalado (opcional; tambien puedes subir archivos desde la web de GitHub).

## 1. Crear la aplicacion y el bot de Discord

1. Abre https://discord.com/developers/applications
2. Pulsa **New Application**, pon `STREET CONTROL` y crea la aplicacion.
3. En **General Information**, copia **Application ID**. Ese valor sera `CLIENT_ID`.
4. En **Bot**, crea el bot si aparece la opcion y pulsa **Reset Token** para generar/copiar el token. Guardalo en privado; sera `DISCORD_TOKEN`.
5. En **Bot > Privileged Gateway Intents**, activa **Server Members Intent** y **Message Content Intent**. Guarda los cambios.
6. En **OAuth2 > URL Generator**, marca los scopes `bot` y `applications.commands`.
7. En permisos del bot marca como minimo: View Channels, Send Messages, Read Message History, Manage Channels, Manage Messages, Moderate Members, Kick Members y Ban Members. Para tickets privados tambien necesita Manage Channels.
8. Abre la URL generada e invita el bot a tu servidor.
9. En Discord, activa **Ajustes de usuario > Avanzado > Modo desarrollador**. Haz clic derecho en tu servidor y copia su ID. Ese sera `GUILD_ID`.

**Seguridad:** nunca compartas el token del bot ni lo guardes en un archivo que vayas a subir a GitHub.

## 2. Crear Firebase Realtime Database

1. Abre https://console.firebase.google.com/ y crea un proyecto, por ejemplo `street-control-mi-servidor`.
2. Dentro del proyecto entra en **Build > Realtime Database > Create Database**. Elige una ubicacion y crea la base.
3. Copia la URL exacta de Realtime Database, por ejemplo `https://NOMBRE-PROYECTO-default-rtdb.firebaseio.com/`. En algunos proyectos la URL puede terminar en `firebasedatabase.app`; copia la que muestra Firebase. La usaras en `FIREBASE_DATABASE_URL` y en `public/index.html`.
4. Ve a **Build > Authentication > Get started > Sign-in method** y activa **Google**. Guarda.
5. En Authentication > Settings > Authorized domains, confirma que esta autorizado `localhost` para pruebas y agrega el dominio que te entregue Firebase Hosting cuando lo publiques.
6. En **Project settings > General > Your apps**, agrega una aplicacion web (`</>`). Ponle un nombre. Copia la configuracion web que Firebase muestra. En `public/index.html`, reemplaza los valores `PEGA_AQUI...` dentro de `firebaseConfig` por `apiKey`, `authDomain`, `databaseURL`, `projectId` y `appId` de tu app.
7. En **Project settings > Service accounts**, selecciona **Generate new private key** y descarga el JSON. No lo subas a GitHub. Lo usaras como variable privada `FIREBASE_SERVICE_ACCOUNT_JSON` en el alojamiento del bot.
8. En Realtime Database > Rules, publica el contenido de `database.rules.json` de este proyecto. Estas reglas permiten a un usuario autenticado leer/escribir solo dentro de su propia ruta `users/UID/...`; la cuenta de servicio del bot usa Admin SDK y puede leer desde el servidor.

## 3. Subir el proyecto a GitHub

1. En https://github.com/new crea un repositorio llamado `street-control-discord`.
2. Sube las carpetas y archivos de este proyecto, incluyendo `public/`, `bot.js`, `package.json`, `firebase.json`, `database.rules.json`, `render.yaml`, `health.html` y `GUIA_ESPAÑOL.md`.
3. **No subas** `.env`, tokens, JSON de cuenta de servicio ni claves privadas. `.gitignore` ya excluye los archivos habituales.
4. Abre `public/index.html` y confirma que sustituiste `firebaseConfig` por la configuracion web de tu proyecto Firebase. Esa configuracion web no es el token del bot; la proteccion de los datos se hace con Authentication y Rules.
5. Si usas GitHub desde el navegador, entra al repositorio, pulsa **Add file > Upload files**, arrastra los archivos y confirma con **Commit changes**.

## 4. Publicar el panel web con Firebase Hosting

Instala Node.js desde https://nodejs.org/ y luego abre una terminal dentro de la carpeta del proyecto.

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase init hosting
```

Durante `firebase init hosting`:
- Selecciona el proyecto Firebase que creaste.
- Directorio publico: `public`
- Configurar como SPA: puedes responder **No** (el `firebase.json` ya tiene rewrite).
- Si pregunta si reemplazar `public/index.html`, responde **No** para conservar el panel.

Luego publica:

```bash
firebase deploy --only hosting,database
```

Firebase mostrara una URL similar a `https://TU-PROYECTO.web.app`. Abrela, inicia sesion con Google y copia el **UID** que aparece en el estado del panel. Si Google login falla, revisa que el proveedor Google este habilitado y que el dominio `TU-PROYECTO.web.app` este autorizado en Firebase Authentication.

## 5. Ejecutar el bot gratis en un alojamiento

El panel web no mantiene el bot encendido: el bot necesita un proceso Node.js en un servidor. Puedes probar localmente primero y despues desplegarlo en un servicio como Render. Los planes gratuitos pueden dormir, tener limites o cambiar; para funcionamiento continuo puede hacer falta un plan de pago u otro proveedor.

### En Render

1. En https://render.com crea una cuenta y conecta tu repositorio GitHub.
2. Crea un **Web Service** desde el repositorio. Render puede detectar `render.yaml`; si no, elige Node.
3. Build command: `npm install`. Start command: `npm start`.
4. En **Environment**, crea estas variables:
   - `DISCORD_TOKEN`: token del bot.
   - `CLIENT_ID`: Application ID.
   - `GUILD_ID`: ID del servidor Discord.
   - `OWNER_UID`: UID que copiaste desde el panel tras iniciar sesion.
   - `FIREBASE_DATABASE_URL`: URL exacta de Realtime Database.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: pega el contenido COMPLETO del JSON de cuenta de servicio como una sola linea. No lo subas al repositorio.
5. Despliega. En los logs deberias ver `Bot conectado como ...`, `Comandos slash registrados` y `Configuracion recargada desde Firebase`.
6. Si ves errores de Firebase, comprueba que el JSON es valido, que `project_id` corresponde al proyecto correcto y que la URL de la base de datos es exacta.

## 6. Primer uso

1. Abre el panel publicado y entra con Google.
2. Copia el UID mostrado en pantalla y ponlo como `OWNER_UID` en Render. Si cambias la variable, vuelve a desplegar.
3. En el panel pega el ID de tu servidor Discord y pulsa Guardar.
4. Para cada campo de canal, rol o categoria, activa Modo desarrollador en Discord, clic derecho sobre el elemento y selecciona **Copiar ID**.
5. Guarda la configuracion en el panel.
6. En Discord usa `/ping` para probar la conexion.
7. En el canal donde quieres el panel, usa `/panel-tickets`.
8. Prueba los mensajes de bienvenida con una cuenta de prueba o con alguien que entre al servidor.
9. Prueba las funciones de moderacion en un canal de pruebas antes de usarlas con miembros reales.

## 7. Comandos disponibles

- `/ping`: comprueba que el bot responde.
- `/panel-tickets`: publica el panel de tickets en el canal configurado. Los usuarios eligen una categoria (por ejemplo Cúpula, Postulación o Solicitud de Rango) y reciben un canal privado.\n- `/evento`: crea un evento con título, descripción, fecha `AAAA-MM-DD`, hora `HH:MM` de Chile, canal y rol opcional. Los usuarios pueden confirmar si participarán; la asistencia se guarda en Firebase si la conexión está activa.
- `/limpiar cantidad:10`: borra hasta 100 mensajes recientes; Discord no permite borrar en bloque mensajes de mas de 14 dias.
- `/expulsar usuario:@miembro motivo:...`
- `/banear usuario:@miembro motivo:...`

El bot crea tickets privados por categoría, permite mencionar el rol de soporte configurado en el panel y muestra un botón para cerrarlos. En el panel puedes configurar el ID de la categoría de Discord donde se crearán los tickets y el ID del rol de soporte. En Actividades puedes configurar el rol opcional que se mencionará. La cuenta del bot debe tener jerarquia y permisos suficientes. Los permisos de Discord siempre limitan lo que el bot puede hacer.

## 8. Errores frecuentes

- **El bot aparece desconectado:** revisa `DISCORD_TOKEN`, logs del alojamiento y que el servicio este en ejecucion.
- **No aparecen comandos slash:** confirma `CLIENT_ID`, `GUILD_ID`, scope `applications.commands` y revisa logs. Espera un poco y reinicia el servicio.
- **Firebase: Permission denied en el panel:** revisa inicio de sesion Google, proveedor habilitado y `database.rules.json`.
- **El bot no lee los ajustes:** `OWNER_UID` debe ser exactamente el UID que inicio sesion en el panel; `GUILD_ID` debe coincidir en panel y alojamiento.
- **No llegan bienvenidas:** activa Server Members Intent en Developer Portal, activa el modulo en el panel y revisa el ID del canal/permisos.
- **No funciona antispam:** activa Message Content Intent, permisos de timeout y el modulo de moderacion.
- **No se crean tickets:** el bot necesita Manage Channels y View/Send Messages; verifica el ID de categoria y el rol de soporte.
- **Google no inicia sesion:** agrega el dominio publicado en Authentication > Settings > Authorized domains.

## 9. Importante sobre la seguridad y el alcance

- No publiques el token del bot, la clave privada de Firebase ni el contenido de `FIREBASE_SERVICE_ACCOUNT_JSON`.
- Si el token se filtra, regenera el token en Discord Developer Portal.
- El UID de Firebase es un identificador, no una contraseña, pero no hace falta publicarlo.
- La interfaz web usa Firebase Authentication y reglas de Realtime Database para limitar a cada usuario a su propia ruta. El bot solo lee la ruta configurada por `OWNER_UID` y `GUILD_ID`.
- Esta primera version trae modulos basicos, no reemplaza un sistema profesional de moderacion ni garantiza disponibilidad 24/7 en planes gratuitos.
- Los campos de IDs deben ser IDs reales de Discord, no nombres como `#bienvenidas`.
