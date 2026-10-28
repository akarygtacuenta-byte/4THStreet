require("dotenv").config();

const express = require("express");
const cron = require("node-cron");
const admin = require("firebase-admin");
const {
  Client, GatewayIntentBits, Partials, Events, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
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
const configPath = `users/${process.env.OWNER_UID}/guilds/${process.env.GUILD_ID}/config`;
let config = {};
let lastScheduledKey = "";

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
  new SlashCommandBuilder().setName("panel-tickets").setDescription("Publica el panel de tickets en este canal")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("ping").setDescription("Comprueba si el bot responde"),
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
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log("Comandos slash registrados.");
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
async function sendLog(text) {
  if (config.modules?.logs && config.logsChannelId) await sendConfigured(config.logsChannelId, text);
}
async function publishTicketPanel(interaction) {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor || "#C1121F")
    .setTitle(config.ticketTitle || "CENTRO DE SOPORTE")
    .setDescription(config.ticketDescription || "Pulsa el boton para abrir un ticket privado.")
    .setFooter({ text: "STREET CONTROL" });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sc_ticket_open").setLabel("Abrir ticket").setEmoji("🎫").setStyle(ButtonStyle.Danger)
  );
  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: "Panel de tickets publicado.", ephemeral: true });
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Bot conectado como ${readyClient.user.tag}`);
  try { await registerCommands(); } catch (e) { console.error("No se pudieron registrar comandos:", e.message); }
  if (db) {
    db.ref(configPath).on("value", snap => {
      config = snap.val() || {};
      console.log("Configuracion recargada desde Firebase.");
    }, err => console.error("Error leyendo configuracion Firebase:", err.message));
  }
});

client.on(Events.GuildMemberAdd, async member => {
  if (config.modules?.welcome) {
    await sendConfigured(config.welcomeChannelId, config.welcomeMessage || "¡Bienvenido/a {usuario} a {servidor}!", member);
  }
  await sendLog(`📥 **Entrada:** ${member.user.tag} (${member.id})`);
});
client.on(Events.GuildMemberRemove, async member => {
  if (config.modules?.welcome) {
    await sendConfigured(config.goodbyeChannelId, config.goodbyeMessage || "{usuario} ha salido del servidor.", member);
  }
  await sendLog(`📤 **Salida:** ${member.user?.tag || member.id}`);
});

const spam = new Map();
client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot || !config.modules?.moderation) return;
  const now = Date.now();
  const previous = spam.get(message.author.id) || [];
  const recent = previous.filter(t => now - t < 6000);
  recent.push(now); spam.set(message.author.id, recent);
  if (recent.length >= Number(config.spamLimit || 5) && message.member?.moderatable) {
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
  if (message.guild && !message.author?.bot) await sendLog(`🗑️ Mensaje eliminado en <#${message.channelId}>${message.author ? ` por ${message.author.tag}` : ""}.`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") return interaction.reply({ content: `Pong! ${client.ws.ping} ms`, ephemeral: true });
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
    if (interaction.isButton() && interaction.customId === "sc_ticket_open") {
      if (!config.modules?.tickets) return interaction.reply({ content: "Tickets desactivados.", ephemeral: true });
      const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.id}`.slice(0, 90));
      if (existing) return interaction.reply({ content: `Ya tienes un ticket abierto: ${existing}`, ephemeral: true });
      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: ["ViewChannel"] },
        { id: interaction.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"] }
      ];
      if (config.supportRoleId) overwrites.push({ id: config.supportRoleId, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] });
      const options = {
        name: `ticket-${interaction.user.id}`.slice(0, 90),
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
        topic: `Ticket abierto por ${interaction.user.tag} (${interaction.user.id})`
      };
      if (config.ticketCategoryId) options.parent = config.ticketCategoryId;
      const channel = await interaction.guild.channels.create(options);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("sc_ticket_close").setLabel("Cerrar ticket").setStyle(ButtonStyle.Secondary));
      await channel.send({ content: `${interaction.user} ${config.supportRoleId ? `<@&${config.supportRoleId}>` : ""}\n${config.ticketOpenMessage || "Describe tu consulta aqui."}`, components: [row] });
      await interaction.reply({ content: `Ticket creado: ${channel}`, ephemeral: true });
      await sendLog(`🎫 Ticket abierto por ${interaction.user.tag}: ${channel}`);
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

// Avisos diarios usando la zona horaria configurada. No duplica el mismo minuto.
cron.schedule("* * * * *", async () => {
  if (!config.modules?.activities || !config.activityChannelId || !config.activityMessage) return;
  const tz = config.timezone || "America/Santiago";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date());
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const times = [config.activityTime1 || "14:00", config.activityTime2 || "21:00"];
  for (const time of times) {
    const key = `${today}-${time}`;
    if (parts === time && lastScheduledKey !== key) {
      lastScheduledKey = key;
      await sendConfigured(config.activityChannelId, `${config.activityRoleId ? `<@&${config.activityRoleId}> ` : ""}${config.activityMessage}`);
    }
  }
}, { timezone: "UTC" });

const app = express();
app.get("/", (_req, res) => res.sendFile(require("path").join(__dirname, "health.html")));
app.get("/health", (_req, res) => res.json({ ok: true, botReady: client.isReady(), bot: client.user?.tag || null }));
app.listen(Number(process.env.PORT || 3000), () => console.log(`Health server en puerto ${process.env.PORT || 3000}`));

client.login(process.env.DISCORD_TOKEN);
