require("dotenv").config();

const express = require("express");
const cron = require("node-cron");
const admin = require("firebase-admin");
const {
  Client, GatewayIntentBits, Partials, Events, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require("discord.js");

const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID", "OWNER_UID",
  "FIREBASE_DATABASE_URL", "FIREBASE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) console.warn(`[CONFIG] Falta la variable ${key}`);
}

let serviceAccount;
try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}"); }
catch (e) { console.error("FIREBASE_SERVICE_ACCOUNT_JSON no es JSON valido."); process.exit(1); }

if (!admin.apps.length && serviceAccount.project_id) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const db = admin.apps.length ? admin.database() : null;
let config = {};
let firebaseConfigLoaded = false;
let lastScheduledKey = "";
let lastEmbedScheduleKey = "";
let lastEmbedSentAt = 0;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

const commands = [
  new SlashCommandBuilder().setName("panel-tickets").setDescription("Publica el panel configurado de tickets")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("ping").setDescription("Comprueba si el bot responde"),
  new SlashCommandBuilder().setName("estado").setDescription("Muestra el estado del bot y la conexion con Firebase"),
  new SlashCommandBuilder().setName("limpiar").setDescription("Borra mensajes recientes")
    .addIntegerOption(o => o.setName("cantidad").setDescription("Cantidad entre 1 y 100").setMinValue(1).setMaxValue(100).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName("expulsar").setDescription("Expulsa a un miembro")
    .addUserOption(o => o.setName("usuario").setDescription("Miembro").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName("banear").setDescription("Banea a un miembro")
    .addUserOption(o => o.setName("usuario").setDescription("Miembro").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName("evento").setDescription("Publica un evento con botones para confirmar asistencia")
    .addStringOption(o => o.setName("titulo").setDescription("Nombre del evento").setMaxLength(100).setRequired(true))
    .addStringOption(o => o.setName("descripcion").setDescription("Detalles del evento").setMaxLength(1500).setRequired(true))
    .addStringOption(o => o.setName("fecha").setDescription("Fecha en Chile, formato AAAA-MM-DD").setRequired(true))
    .addStringOption(o => o.setName("hora").setDescription("Hora en Chile, formato HH:MM (24 horas)").setRequired(true))
    .addChannelOption(o => o.setName("canal").setDescription("Canal donde se publicara el evento").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption(o => o.setName("rol").setDescription("Rol que recibira la mencion").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
].map(c => c.toJSON());

async function registerCommands() {
  const missing = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"].filter(key => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Faltan variables de Render para registrar comandos: ${missing.join(", ")}`);
  }
  const clientId = process.env.CLIENT_ID.trim();
  const guildId = process.env.GUILD_ID.trim();
  console.log(`Registrando ${commands.length} comandos slash en el servidor ${guildId} para la aplicacion ${clientId}...`);
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN.trim());
  const result = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log(`Comandos slash registrados correctamente: ${Array.isArray(result) ? result.length : commands.length}.`);
}

function chileTimestamp(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredUtc;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(candidate));
    const value = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const representedUtc = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute));
    const difference = desiredUtc - representedUtc;
    candidate += difference;
    if (difference === 0) break;
  }
  return Math.floor(candidate / 1000);
}

function interpolate(template, member) {
  return String(template || "")
    .replaceAll("{usuario}", `<@${member.id}>`)
    .replaceAll("{servidor}", member.guild.name)
    .replaceAll("{miembros}", String(member.guild.memberCount));
}
async function sendConfigured(channelId, text, member = null) {
  if (!channelId || !text) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send(member ? interpolate(text, member) : text).catch(err => console.error("No se pudo enviar mensaje:", err.message));
}
async function sendLog(text, type = "moderation") {
  if (!config.modules?.logs || !config.logsChannelId) return;
  if (config.logOptions && config.logOptions[type] === false) return;
  const channel = await client.channels.fetch(config.logsChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ content: text, allowedMentions: { parse: [] } })
    .catch(err => console.error("No se pudo enviar registro:", err.message));
}
async function publishTicketPanel(interaction) {
  const embed = new EmbedBuilder().setColor(config.embedColor || "#C1121F")
    .setTitle(config.ticketTitle || "CENTRO DE SOPORTE")
    .setDescription(config.ticketDescription || "Selecciona el tipo de ayuda que necesitas en el menu.")
    .setFooter({ text: "STREET CONTROL • Centro de soporte" });
  const categories = String(config.ticketCategories || "Soporte").split(/[,\n]/).map(v => v.trim()).filter(Boolean).slice(0, 25);
  const menu = new StringSelectMenuBuilder().setCustomId("sc_ticket_category").setPlaceholder("Selecciona una categoria")
    .addOptions(categories.map((name, index) => ({ label: name.slice(0, 100), value: String(index), description: `Abrir ticket de ${name}`.slice(0, 100), emoji: "🎫" })));
  const row = new ActionRowBuilder().addComponents(menu);
  const target = config.ticketChannelId ? await client.channels.fetch(config.ticketChannelId).catch(() => null) : interaction.channel;
  if (!target || !target.isTextBased()) return interaction.reply({ content: "No encuentro el canal configurado para el panel. Revisa el ID en la web.", ephemeral: true });
  await target.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: `Panel de tickets publicado en ${target}.`, ephemeral: true });
}

async function createTicket(interaction, category) {
  const slug = String(category).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 35);
  const existing = interaction.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic?.includes(`ticket-owner:${interaction.user.id}`));
  if (existing) return interaction.reply({ content: `Ya tienes un ticket abierto: ${existing}`, ephemeral: true });
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: ["ViewChannel"] },
    { id: interaction.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"] }
  ];
  if (config.supportRoleId) overwrites.push({ id: config.supportRoleId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] });
  const options = { name: `ticket-${slug}-${interaction.user.id.slice(-4)}`.slice(0, 90), type: ChannelType.GuildText, permissionOverwrites: overwrites,
    topic: `ticket-owner:${interaction.user.id} | categoria:${category} | abierto por ${interaction.user.tag}` };
  if (config.ticketCategoryId) options.parent = config.ticketCategoryId;
  const channel = await interaction.guild.channels.create(options);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("sc_ticket_close").setLabel("Cerrar ticket").setEmoji("🔒").setStyle(ButtonStyle.Secondary));
  await channel.send({ content: `<@!${interaction.user.id}> ${config.supportRoleId ? `<@&${config.supportRoleId}>` : ""}
**Categoria:** ${category}

${config.ticketOpenMessage || "Describe tu consulta aqui y el equipo te ayudara."}`, components: [row] });
  await interaction.reply({ content: `Ticket de **${category}** creado: ${channel}`, ephemeral: true });
  await sendLog(`🎫 Ticket abierto por ${interaction.user.tag} • ${category}: ${channel}`);
}

const eventAttendance = new Map();
async function publishEvent(interaction) {
  const title = interaction.options.getString("titulo", true), description = interaction.options.getString("descripcion", true);
  const date = interaction.options.getString("fecha", true), time = interaction.options.getString("hora", true);
  const channel = interaction.options.getChannel("canal", true), role = interaction.options.getRole("rol");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    return interaction.reply({ content: "Formato incorrecto. Usa fecha AAAA-MM-DD y hora HH:MM (24 h).", ephemeral: true });
  const [year, month, day] = date.split("-").map(Number), check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    return interaction.reply({ content: "La fecha indicada no existe.", ephemeral: true });
  const timestamp = chileTimestamp(date, time);
  if (timestamp <= Math.floor(Date.now() / 1000)) return interaction.reply({ content: "La fecha y hora deben estar en el futuro (hora de Chile).", ephemeral: true });
  const eventKey = `sc_event_${Date.now().toString(36)}`;
  eventAttendance.set(eventKey, { yes: new Set(), no: new Set(), date, time });
  const embed = new EmbedBuilder().setColor(config.embedColor || "#C1121F").setTitle(`📅 ${title}`).setDescription(description)
    .addFields({ name: "📆 Fecha", value: date, inline: true }, { name: "🕒 Hora de Chile", value: time, inline: true }, { name: "🙋 Asistencia", value: "Aún no hay confirmaciones.", inline: false })
    .setTimestamp(new Date(timestamp * 1000)).setFooter({ text: `STREET CONTROL • Creado por ${interaction.user.username}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${eventKey}_yes`).setLabel("Participaré").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${eventKey}_no`).setLabel("No podré").setEmoji("❌").setStyle(ButtonStyle.Secondary));
  const eventMessage = await channel.send({ content: role ? `<@&${role.id}>` : undefined, embeds: [embed], components: [row], allowedMentions: { roles: role ? [role.id] : [] } });
  const eventData = { title, description, date, time, channelId: channel.id, messageId: eventMessage.id, roleId: role?.id || null, yes: [], no: [] };
  eventAttendance.set(eventKey, { ...eventData, yes: new Set(), no: new Set() });
  if (db) {
    await db.ref(`users/${process.env.OWNER_UID}/guilds/${process.env.GUILD_ID}/events/${eventKey}`).set(eventData)
      .catch(err => console.error("No se pudo guardar el evento en Firebase:", err.message));
  }
  await interaction.reply({ content: `Evento publicado en ${channel}. Los miembros pueden confirmar asistencia con los botones.`, ephemeral: true });
  await sendLog(`📅 Evento creado por ${interaction.user.tag}: ${title} (${date} ${time})`);
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);
  try {
    await registerCommands();
  } catch (e) {
    console.error("ERROR REGISTRANDO COMANDOS SLASH:", e?.status ? `HTTP ${e.status}` : "", e?.message || e);
    if (e?.status === 401) console.error("Revisa DISCORD_TOKEN: el token del bot no es valido.");
    if (e?.status === 403) console.error("Discord rechazo el registro. Comprueba que CLIENT_ID sea el Application ID y que el bot/app pertenezca a este servidor.");
    if (e?.status === 404) console.error("No se encontro la aplicacion o el servidor. Revisa CLIENT_ID y GUILD_ID.");
  }
  if (!db) {
    console.error("[FIREBASE] Admin SDK no inicializado. Comprueba FIREBASE_SERVICE_ACCOUNT_JSON (JSON de cuenta de servicio) y FIREBASE_DATABASE_URL en Render.");
  }
  if (db) {
    const savedLastEmbed = await db.ref(`users/${process.env.OWNER_UID}/guilds/${process.env.GUILD_ID}/embedScheduler/lastSentAt`).once("value").catch(() => null);
    lastEmbedSentAt = Number(savedLastEmbed?.val() || 0);
    const configsPath = `users/${process.env.OWNER_UID}/configs`;
    db.ref(configsPath).on("value", snap => {
      const sections = snap.val() || {};
      const welcome = sections.welcome || {};
      const tickets = sections.tickets || {};
      const moderation = sections.moderation || {};
      const activities = sections.activities || {};
      const logs = sections.logs || {};
      const embeds = sections.embeds || {};
      const modules = sections.modules || {};

      // El panel web guarda cada modulo por separado en users/{uid}/configs.
      // Aqui se convierten esos campos al formato que utiliza el bot.
      config = {
        modules: {
          welcome: modules.welcome ?? Boolean(welcome.channel),
          tickets: modules.tickets ?? Boolean(tickets.channel || tickets.title),
          moderation: modules.moderation ?? Boolean(moderation.antiSpam || moderation.linkFilter),
          activities: modules.activities ?? Boolean(activities.channel && activities.message),
          embeds: modules.embeds ?? Boolean(embeds.channel && embeds.description),
          logs: modules.logs ?? Boolean(logs.channel && (logs.members || logs.messages || logs.moderation))
        },
        welcomeChannelId: welcome.channel || "",
        goodbyeChannelId: welcome.channel || "",
        welcomeMessage: welcome.welcomeMessage || "",
        goodbyeMessage: welcome.goodbyeMessage || "",
        ticketChannelId: tickets.channel || "",
        ticketTitle: tickets.title || "CENTRO DE SOPORTE",
        ticketDescription: tickets.description || "Pulsa el boton para abrir un ticket privado.",
        ticketOpenMessage: tickets.openMessage || "Describe tu consulta aqui y el equipo te ayudara.",
        ticketCategories: tickets.categories || "",
        ticketCategoryId: tickets.categoryId || "",
        supportRoleId: tickets.supportRoleId || "",
        logsChannelId: logs.channel || moderation.channel || "",
        logOptions: { members: Boolean(logs.members), messages: Boolean(logs.messages), moderation: Boolean(logs.moderation) },
        antiSpam: Boolean(moderation.antiSpam),
        blockLinks: Boolean(moderation.linkFilter),
        spamLimit: Number(moderation.spamLimit || 5),
        activityChannelId: activities.channel || "",
        activityTime1: activities.time1 || "14:00",
        activityTime2: activities.time2 || "21:00",
        activityMessage: activities.message || "",
        activityRoleId: activities.roleId || "",
        embedChannelId: embeds.channel || "",
        scheduledEmbedTitle: embeds.title || "",
        scheduledEmbedDescription: embeds.description || "",
        scheduledEmbedColor: /^#[0-9a-fA-F]{6}$/.test(embeds.color || "") ? embeds.color : "#C1121F",
        scheduledEmbedImage: embeds.image || "",
        scheduledEmbedThumbnail: embeds.thumbnail || "",
        scheduledEmbedDays: Array.isArray(embeds.days) ? embeds.days : ["1","2","3","4","5","6","0"],
        scheduledEmbedTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(embeds.time || "") ? embeds.time : "18:00",
        welcomeImage: welcome.image || "",
        welcomeThumbnail: welcome.thumbnail || "",
        welcomeColor: /^#[0-9a-fA-F]{6}$/.test(welcome.color || "") ? welcome.color : "#C1121F",
        timezone: activities.timezone || "America/Santiago"
      };
      firebaseConfigLoaded = true;
      console.log("Configuracion recargada desde Firebase.");
    }, err => console.error("Error leyendo configuracion Firebase:", err.message));
  }
});

client.on(Events.GuildMemberAdd, async member => {
  if (config.modules?.welcome && config.welcomeChannelId) {
    const channel = await client.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(config.welcomeColor || "#C1121F")
        .setDescription(interpolate(config.welcomeMessage || "¡Bienvenido/a {usuario} a {servidor}!", member))
        .setFooter({ text: "STREET CONTROL • Bienvenida" })
        .setTimestamp(new Date());
      if (/^https?:\/\//i.test(config.welcomeThumbnail || "")) embed.setThumbnail(config.welcomeThumbnail);
      else embed.setThumbnail(member.user.displayAvatarURL({ size: 256 }));
      if (/^https?:\/\//i.test(config.welcomeImage || "")) embed.setImage(config.welcomeImage);
      await channel.send({ embeds: [embed], allowedMentions: { users: [member.id] } })
        .catch(err => console.error("[WELCOME] No se pudo enviar bienvenida:", err.message));
    }
  }
  await sendLog(`📥 **Entrada:** ${member.user.tag} (${member.id})`, "members");
});
client.on(Events.GuildMemberRemove, async member => {
  if (config.modules?.welcome) {
    await sendConfigured(config.goodbyeChannelId, config.goodbyeMessage || "{usuario} ha salido del servidor.", member);
  }
  await sendLog(`📤 **Salida:** ${member.user?.tag || member.id}`, "members");
});

const spam = new Map();
client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot || !config.modules?.moderation) return;
  const now = Date.now();
  const previous = spam.get(message.author.id) || [];
  const recent = previous.filter(t => now - t < 6000);
  recent.push(now); spam.set(message.author.id, recent);
  if (config.antiSpam && recent.length >= Number(config.spamLimit || 5) && message.member?.moderatable) {
    await message.member.timeout(60_000, "Antispam automatico").catch(() => {});
    await message.channel.send(`⚠️ ${message.author}, se detecto spam. Se aplico una pausa de 60 segundos.`).catch(() => {});
    await sendLog(`⚠️ Antispam: ${message.author.tag} recibio timeout de 60 segundos.`);
    spam.set(message.author.id, []);
  }
  if (config.blockLinks && !message.member?.permissions.has(PermissionFlagsBits.ManageMessages)
      && /(https?:\/\/|discord\.gg\/)/i.test(message.content)) {
    await message.delete().catch(() => {});
    await message.channel.send(`${message.author}, no puedes publicar enlaces aqui.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
  }
});

client.on(Events.MessageDelete, async message => {
  if (message.guild && !message.author?.bot) await sendLog(`🗑️ Mensaje eliminado en <#${message.channelId}>${message.author ? ` por ${message.author.tag}` : ""}.`, "messages");
});
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || oldMessage.author?.bot || !config.logOptions?.messages) return;
  if (oldMessage.content === newMessage.content || !oldMessage.content || !newMessage.content) return;
  await sendLog(`✏️ Mensaje editado en <#${newMessage.channelId}> por ${newMessage.author?.tag || "usuario desconocido"}.
**Antes:** ${oldMessage.content.slice(0, 700)}
**Después:** ${newMessage.content.slice(0, 700)}`, "messages");
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") return interaction.reply({ content: `Pong! ${client.ws.ping} ms`, ephemeral: true });
      if (interaction.commandName === "estado") {
        const active = Object.entries(config.modules || {}).filter(([, enabled]) => enabled).map(([name]) => name);
        return interaction.reply({
          content: [
            `🤖 **Bot:** ${client.isReady() ? "Conectado" : "No conectado"}`,
            `🔥 **Firebase Admin:** ${db ? "Inicializado" : "No conectado"}`,
            `⚙️ **Configuración cargada:** ${firebaseConfigLoaded ? "Sí" : "No"}`,
            `🧩 **Módulos activos:** ${active.length ? active.join(", ") : "Ninguno o aún no configurados"}`
          ].join("\n"),
          ephemeral: true
        });
      }
      if (interaction.commandName === "evento") return publishEvent(interaction);
      if (interaction.commandName === "panel-tickets") {
        if (!config.modules?.tickets) return interaction.reply({ content: "El sistema de tickets esta desactivado en el panel.", ephemeral: true });
        return publishTicketPanel(interaction);
      }
      if (interaction.commandName === "limpiar") {
        const amount = interaction.options.getInteger("cantidad", true);
        const deleted = await interaction.channel.bulkDelete(amount, true);
        return interaction.reply({ content: `Se borraron ${deleted.size} mensajes.`, ephemeral: true });
      }
      if (interaction.commandName === "expulsar") {
        const user = interaction.options.getUser("usuario", true);
        const reason = interaction.options.getString("motivo") || "Sin motivo indicado";
        const member = await interaction.guild.members.fetch(user.id);
        await member.kick(reason);
        await interaction.reply({ content: `Se expulso a ${user.tag}.`, ephemeral: true });
        return sendLog(`👢 ${user.tag} expulsado. Motivo: ${reason}`);
      }
      if (interaction.commandName === "banear") {
        const user = interaction.options.getUser("usuario", true);
        const reason = interaction.options.getString("motivo") || "Sin motivo indicado";
        await interaction.guild.members.ban(user.id, { reason });
        await interaction.reply({ content: `Se baneo a ${user.tag}.`, ephemeral: true });
        return sendLog(`🔨 ${user.tag} baneado. Motivo: ${reason}`);
      }
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "sc_ticket_category") {
      if (!config.modules?.tickets) return interaction.reply({ content: "Tickets desactivados.", ephemeral: true });
      const categories = String(config.ticketCategories || "Soporte").split(/[,\n]/).map(v => v.trim()).filter(Boolean).slice(0, 25);
      const category = categories[Number(interaction.values[0])];
      if (!category) return interaction.reply({ content: "Categoria no disponible. Vuelve a publicar el panel.", ephemeral: true });
      return createTicket(interaction, category);
    }
    if (interaction.isButton() && /^(sc_event_[a-z0-9]+)_(yes|no)$/.test(interaction.customId)) {
      const match = interaction.customId.match(/^(sc_event_[a-z0-9]+)_(yes|no)$/);
      let event = eventAttendance.get(match[1]);
      const eventRef = db ? db.ref(`users/${process.env.OWNER_UID}/guilds/${process.env.GUILD_ID}/events/${match[1]}`) : null;
      if (!event && eventRef) {
        const snapshot = await eventRef.once("value");
        const saved = snapshot.val();
        if (saved) {
          event = { ...saved, yes: new Set(saved.yes || []), no: new Set(saved.no || []) };
          eventAttendance.set(match[1], event);
        }
      }
      if (!event) return interaction.reply({ content: "No se encontró el evento guardado. Publica uno nuevo.", ephemeral: true });
      const mine = match[2] === "yes" ? event.yes : event.no, other = match[2] === "yes" ? event.no : event.yes;
      if (mine.has(interaction.user.id)) mine.delete(interaction.user.id); else { mine.add(interaction.user.id); other.delete(interaction.user.id); }
      const embed = EmbedBuilder.from(interaction.message.embeds[0]).setFields(
        { name: "📆 Fecha", value: event.date, inline: true }, { name: "🕒 Hora de Chile", value: event.time, inline: true },
        { name: "🙋 Asistencia", value: `✅ Participarán: ${event.yes.size}
❌ No podrán: ${event.no.size}`, inline: false });
      await interaction.update({ embeds: [embed] });
      if (eventRef) {
        await eventRef.update({ yes: [...event.yes], no: [...event.no] })
          .catch(err => console.error("No se pudo guardar la asistencia en Firebase:", err.message));
      }
      return;
    }
    if (interaction.isButton() && interaction.customId === "sc_ticket_close") {
      await interaction.reply({ content: "Este ticket se cerrara en 5 segundos.", ephemeral: true });
      const ch = interaction.channel;
      await sendLog(`🎫 Ticket cerrado por ${interaction.user.tag}: ${ch.name}`);
      setTimeout(() => ch.delete("Ticket cerrado").catch(() => {}), 5000);
    }
  } catch (err) {
    console.error(err);
    const reply = { content: "Ocurrio un error. Revisa los permisos del bot y los registros del alojamiento.", ephemeral: true };
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply(reply).catch(() => {});
  }
});

// Revisa avisos diarios y embeds programados cada minuto.
cron.schedule("* * * * *", async () => {
  try {
    if (config.modules?.activities && config.activityChannelId && config.activityMessage) {
      const tz = config.timezone || "America/Santiago";
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
      }).format(new Date());
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
      }).format(new Date());
      const times = [config.activityTime1 || "14:00", config.activityTime2 || "21:00"];
      for (const time of times) {
        const key = `${today}-${time}`;
        if (parts === time && lastScheduledKey !== key) {
          lastScheduledKey = key;
          await sendConfigured(config.activityChannelId,
            `${config.activityRoleId ? `<@&${config.activityRoleId}> ` : ""}${config.activityMessage}`);
        }
      }
    }

    if (config.modules?.embeds && config.embedChannelId && config.scheduledEmbedDescription) {
      const tz = config.timezone || "America/Santiago";
      const nowDate = new Date();
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(nowDate);
      const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(nowDate);
      const dayNumber = ({ Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" })[day];
      const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowDate);
      const scheduleKey = todayKey + "-" + config.scheduledEmbedTime;
      if (parts === config.scheduledEmbedTime && config.scheduledEmbedDays.includes(dayNumber) && lastEmbedScheduleKey !== scheduleKey) {
        const channel = await client.channels.fetch(config.embedChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          console.error("[EMBEDS] No se encuentra el canal configurado o no es de texto.");
        } else {
          const embed = new EmbedBuilder().setColor(config.scheduledEmbedColor || "#C1121F")
            .setDescription(config.scheduledEmbedDescription.slice(0, 4000))
            .setFooter({ text: "STREET CONTROL • Mensaje automático" }).setTimestamp(new Date());
          if (config.scheduledEmbedTitle) embed.setTitle(config.scheduledEmbedTitle.slice(0, 256));
          if (/^https?:\/\//i.test(config.scheduledEmbedImage || "")) embed.setImage(config.scheduledEmbedImage);
          if (/^https?:\/\//i.test(config.scheduledEmbedThumbnail || "")) embed.setThumbnail(config.scheduledEmbedThumbnail);
          await channel.send({ embeds: [embed] });
          lastEmbedScheduleKey = scheduleKey;
          lastEmbedSentAt = Date.now();
          if (db) await db.ref(`users/${process.env.OWNER_UID}/guilds/${process.env.GUILD_ID}/embedScheduler/lastSentAt`).set(lastEmbedSentAt)
            .catch(err => console.error("[EMBEDS] No se pudo guardar la última publicación:", err.message));
          console.log("[EMBEDS] Mensaje programado publicado correctamente.");
        }
      }
    }
  } catch (err) {
    console.error("[PROGRAMADOR] Error al procesar mensajes programados:", err.message);
  }
}, { timezone: "UTC" });

const app = express();
app.get("/", (_req, res) => res.sendFile(require("path").join(__dirname, "health.html")));
app.get("/health", (_req, res) => res.json({
  ok: client.isReady(),
  botReady: client.isReady(),
  firebaseReady: Boolean(db),
  configLoaded: firebaseConfigLoaded,
  modules: config.modules || {},
  bot: client.user?.tag || null
}));
app.listen(Number(process.env.PORT || 3000), () => console.log(`Health server en puerto ${process.env.PORT || 3000}`));

client.login(process.env.DISCORD_TOKEN);
