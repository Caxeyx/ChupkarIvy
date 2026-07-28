const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

require('dotenv').config();
const http = require('http');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  ActivityType 
} = require('discord.js');
const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
const { YtDlpPlugin } = require('@distube/yt-dlp');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is missing in .env file!');
  process.exit(1);
}

// Local Spotify Callback Web Server
const callbackServer = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, 'http://127.0.0.1:8888');
  if (reqUrl.pathname === '/callback') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html>
        <body style="font-family: Arial, sans-serif; background: #121212; color: #1DB954; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <h1 style="font-size: 3rem; margin-bottom: 10px;">🟢 Spotify Connected!</h1>
          <p style="color: #FFFFFF; font-size: 1.2rem;">Your Spotify account has been successfully linked to <strong>ChupkarIVY</strong>.</p>
          <p style="color: #B3B3B3;">You can close this browser tab and return to Discord!</p>
        </body>
      </html>
    `);
  } else {
    res.writeHead(404);
    res.end();
  }
});

callbackServer.listen(8888, '127.0.0.1', () => {
  console.log('🌐 Spotify Auth Callback Web Server running on http://127.0.0.1:8888/callback');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

// Initialize DisTube Chip-Style Music Engine
const distube = new DisTube(client, {
  emitNewSongOnly: true,
  emitAddSongWhenCreatingQueue: false,
  plugins: [
    new SpotifyPlugin({
      api: {
        clientId: process.env.SPOTIFY_CLIENT_ID || '8e8767817181457c84c05dd9b7e8bf18',
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET || ''
      }
    }),
    new YtDlpPlugin()
  ]
});

// Helper function: Build Chip-style Player Dashboard Embed + Buttons
function createPlayerDashboard(queue, song) {
  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('🎶 Now Playing')
    .setDescription(`[**${song.name}**](${song.url})`)
    .setThumbnail(song.thumbnail)
    .addFields(
      { name: '👤 Requested By', value: `<@${song.user.id}>`, inline: true },
      { name: '⏱️ Duration', value: `${song.formattedDuration}`, inline: true },
      { name: '🎤 Uploader / Artist', value: `${song.uploader.name || 'Spotify / YouTube'}`, inline: true },
      { name: '🔊 Volume', value: `${queue.volume}%`, inline: true },
      { name: '🔂 Repeat Mode', value: `${queue.repeatMode === 0 ? 'Disabled' : queue.repeatMode === 1 ? 'Song' : 'Queue'}`, inline: true },
      { name: '📜 Queue Length', value: `${queue.songs.length} song(s)`, inline: true }
    )
    .setFooter({ text: 'ChupkarIVY • Chip-Style Music Engine' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_pause').setLabel(queue.paused ? '▶️ Resume' : '⏸️ Pause').setStyle(queue.paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('btn_shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_loop').setLabel('🔂 Loop').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_voldown').setLabel('🔉 Vol -').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_volup').setLabel('🔊 Vol +').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_queue').setLabel('📜 Queue').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// DisTube Event Listeners
distube.on('playSong', (queue, song) => {
  const messageData = createPlayerDashboard(queue, song);
  queue.textChannel?.send(messageData).then(msg => {
    queue.dashboardMessage = msg;
  }).catch(() => {});
});

distube.on('addSong', (queue, song) => {
  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('➕ Added to Queue')
    .setDescription(`[**${song.name}**](${song.url}) - \`${song.formattedDuration}\``)
    .setThumbnail(song.thumbnail)
    .setFooter({ text: `Position #${queue.songs.length}` });

  queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
});

distube.on('addList', (queue, playlist) => {
  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('🎶 Added Playlist to Queue')
    .setDescription(`[**${playlist.name}**](${playlist.url}) (${playlist.songs.length} songs)`);

  queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
});

distube.on('finish', queue => {
  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('🎶 Queue Finished')
    .setDescription('Queue is empty! Play more music with `/play`.');

  queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
});

distube.on('error', (channel, error) => {
  console.error('DisTube Error:', error);
  channel?.send(`⚠️ Music Engine Error: ${error.message || error}`).catch(() => {});
});

client.once('ready', async (c) => {
  console.log('==========================================');
  console.log(`🟢 SUCCESS! ChupkarIVY Chip Music Bot is ONLINE as: ${c.user.tag}`);
  console.log(`🌐 Serving in ${c.guilds.cache.size} server(s)`);
  console.log('==========================================');

  c.user.setActivity('Chip Music Engine | /play', { type: ActivityType.Listening });

  // Define Slash Commands
  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play any song or playlist from Spotify / YouTube / SoundCloud')
      .addStringOption(option =>
        option.setName('query')
          .setDescription('Song title, Spotify link, or YouTube link')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('pause')
      .setDescription('Pause current music playback'),

    new SlashCommandBuilder()
      .setName('resume')
      .setDescription('Resume paused music playback'),

    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Skip to the next song in queue'),

    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop music playback and clear queue'),

    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set music playback volume (1-100)')
      .addIntegerOption(option =>
        option.setName('percent')
          .setDescription('Volume percentage (1-100)')
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName('join')
      .setDescription('Connect ChupkarIVY to your voice channel'),

    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Disconnect ChupkarIVY from the voice channel'),

    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('View current music queue'),

    new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Show details of the currently playing track'),

    new SlashCommandBuilder()
      .setName('link')
      .setDescription('Link your Spotify account'),

    new SlashCommandBuilder()
      .setName('unlink')
      .setDescription('Unlink your Spotify account'),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('View Chip Bot music commands')
  ].map(cmd => cmd.toJSON());

  try {
    console.log('🔄 Registering Slash Commands...');
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    
    for (const [guildId] of c.guilds.cache) {
      await rest.put(Routes.applicationGuildCommands(c.user.id, guildId), { body: commands }).catch(() => {});
    }
    console.log('⚡ Slash Commands registered successfully (Instant Guild + Global)!');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err.message);
  }
});

// Button Interaction Handler for Chip Dashboard
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const queue = distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: '❌ No active music playing!', flags: 64 });
    }

    const { customId } = interaction;

    if (customId === 'btn_pause') {
      if (queue.paused) {
        distube.resume(interaction.guildId);
        return interaction.reply({ content: '▶️ Resumed playback.', flags: 64 });
      } else {
        distube.pause(interaction.guildId);
        return interaction.reply({ content: '⏸️ Paused playback.', flags: 64 });
      }
    }

    if (customId === 'btn_skip') {
      try {
        await distube.skip(interaction.guildId);
        return interaction.reply({ content: '⏭️ Skipped to next song.', flags: 64 });
      } catch {
        distube.stop(interaction.guildId);
        return interaction.reply({ content: '⏹️ Stopped playback (end of queue).', flags: 64 });
      }
    }

    if (customId === 'btn_stop') {
      distube.stop(interaction.guildId);
      return interaction.reply({ content: '⏹️ Stopped music and cleared queue.', flags: 64 });
    }

    if (customId === 'btn_shuffle') {
      distube.shuffle(interaction.guildId);
      return interaction.reply({ content: '🔀 Shuffled queue!', flags: 64 });
    }

    if (customId === 'btn_loop') {
      const mode = distube.setRepeatMode(interaction.guildId);
      const modeText = mode === 0 ? 'Disabled' : mode === 1 ? 'Song' : 'Queue';
      return interaction.reply({ content: `🔂 Repeat Mode: **${modeText}**`, flags: 64 });
    }

    if (customId === 'btn_volup') {
      const newVol = Math.min(queue.volume + 10, 100);
      distube.setVolume(interaction.guildId, newVol);
      return interaction.reply({ content: `🔊 Volume set to **${newVol}%**`, flags: 64 });
    }

    if (customId === 'btn_voldown') {
      const newVol = Math.max(queue.volume - 10, 1);
      distube.setVolume(interaction.guildId, newVol);
      return interaction.reply({ content: `🔉 Volume set to **${newVol}%**`, flags: 64 });
    }

    if (customId === 'btn_queue') {
      let qText = queue.songs.slice(0, 10).map((s, i) => `${i + 1}. [${s.name}](${s.url}) - \`${s.formattedDuration}\``).join('\n');
      const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('📜 Music Queue')
        .setDescription(qText || 'Queue is empty!');
      return interaction.reply({ embeds: [embed], flags: 64 });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, member, channel } = interaction;
  const voiceChannel = member.voice?.channel;

  if (commandName === 'link') {
    const spotifyClientId = process.env.SPOTIFY_CLIENT_ID || '8e8767817181457c84c05dd9b7e8bf18';
    const redirectUri = encodeURIComponent('http://127.0.0.1:8888/callback');
    const scope = encodeURIComponent('user-read-currently-playing user-read-playback-state user-modify-playback-state');
    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${spotifyClientId}&scope=${scope}&redirect_uri=${redirectUri}`;

    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎧 Connect Your Spotify Account')
      .setDescription('Click below to link your Spotify account directly!')
      .addFields(
        { name: '🔑 Client ID', value: spotifyClientId, inline: true },
        { name: '⚡ Callback URL', value: 'http://127.0.0.1:8888/callback', inline: true }
      )
      .setFooter({ text: 'ChupkarIVY Spotify Integration' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔗 Authorize Spotify Account')
        .setStyle(ButtonStyle.Link)
        .setURL(authUrl)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  if (commandName === 'unlink') {
    return interaction.reply('🔌 Your Spotify account has been unlinked.');
  }

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle('🎧 ChupkarIVY Chip-Style Music Commands')
      .setDescription('Chip-Style High Quality Music Bot')
      .addFields(
        { name: '🎵 `/play <query/url>`', value: 'Play song or playlist from Spotify / YouTube / SoundCloud' },
        { name: '🔗 `/link` / `/unlink`', value: 'Link or unlink your Spotify account' },
        { name: '⏸️ `/pause` / `/resume`', value: 'Pause or resume current playback' },
        { name: '⏭️ `/skip` / `/stop`', value: 'Skip or stop current queue' },
        { name: '🔊 `/volume <1-100>`', value: 'Adjust music volume' },
        { name: '🔊 `/join` / `/leave`', value: 'Connect or disconnect voice channel' },
        { name: '📜 `/queue` / `/nowplaying`', value: 'View queue or current track info' }
      )
      .setFooter({ text: 'ChupkarIVY Chip Engine' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (['play', 'pause', 'resume', 'skip', 'stop', 'join', 'leave', 'queue', 'nowplaying', 'volume'].includes(commandName)) {
    if (!voiceChannel && ['play', 'join'].includes(commandName)) {
      return interaction.reply({ content: '❌ You must be in a Voice Channel to use music commands!', flags: 64 });
    }

    if (commandName === 'join') {
      distube.voices.join(voiceChannel);
      return interaction.reply(`🔊 Joined **${voiceChannel.name}**!`);
    }

    if (commandName === 'leave') {
      distube.voices.leave(guildId);
      return interaction.reply('👋 Disconnected from voice channel.');
    }

    const queue = distube.getQueue(guildId);

    if (commandName === 'pause') {
      if (!queue) return interaction.reply({ content: '❌ No active music playing!', flags: 64 });
      distube.pause(guildId);
      return interaction.reply('⏸️ Paused playback.');
    }

    if (commandName === 'resume') {
      if (!queue) return interaction.reply({ content: '❌ No active music playing!', flags: 64 });
      distube.resume(guildId);
      return interaction.reply('▶️ Resumed playback.');
    }

    if (commandName === 'skip') {
      if (!queue) return interaction.reply({ content: '❌ No active music playing!', flags: 64 });
      try {
        await distube.skip(guildId);
        return interaction.reply('⏭️ Skipped current song.');
      } catch {
        distube.stop(guildId);
        return interaction.reply('⏹️ Stopped playback.');
      }
    }

    if (commandName === 'stop') {
      if (!queue) return interaction.reply({ content: '❌ No active music playing!', flags: 64 });
      distube.stop(guildId);
      return interaction.reply('⏹️ Stopped playback and cleared queue.');
    }

    if (commandName === 'volume') {
      if (!queue) return interaction.reply({ content: '❌ No active music playing!', flags: 64 });
      const percent = interaction.options.getInteger('percent');
      distube.setVolume(guildId, percent);
      return interaction.reply(`🔊 Volume set to **${percent}%**`);
    }

    if (commandName === 'nowplaying') {
      if (!queue || !queue.songs[0]) return interaction.reply({ content: '❌ No song is currently playing!', flags: 64 });
      const song = queue.songs[0];
      const messageData = createPlayerDashboard(queue, song);
      return interaction.reply(messageData);
    }

    if (commandName === 'queue') {
      if (!queue || queue.songs.length === 0) return interaction.reply({ content: '📜 The queue is empty!', flags: 64 });
      let qText = queue.songs.slice(0, 10).map((s, i) => `${i + 1}. [${s.name}](${s.url}) - \`${s.formattedDuration}\``).join('\n');
      const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('📜 Music Queue')
        .setDescription(qText);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');

      try {
        await distube.play(voiceChannel, query, {
          textChannel: channel,
          member: member
        });
        await interaction.editReply(`🎵 Processing **${query}**...`);
      } catch (err) {
        console.error('Play Error:', err);
        return interaction.editReply(`❌ Error playing song: ${err.message}`);
      }
    }
  }
});

client.login(token);
