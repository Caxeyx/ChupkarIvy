// ============================================================
// ChupkarIVY — Chip-Style Discord Music Bot
// Clean rewrite with proven voice + audio pipeline
// ============================================================

// 1. Setup ffmpeg + sodium BEFORE anything else
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
process.env.PATH = path.dirname(ffmpegStatic) + ';' + process.env.PATH;

// Force load sodium-native for voice encryption
try { require('sodium-native'); console.log('✅ sodium-native loaded'); }
catch { try { require('libsodium-wrappers'); console.log('✅ libsodium-wrappers loaded'); }
catch { console.warn('⚠️ No sodium library found'); } }

require('dotenv').config();

// 2. Imports
const http = require('http');
const { spawn } = require('child_process');
const {
  Client, GatewayIntentBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  SlashCommandBuilder, REST, Routes, ActivityType
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior,
  entersState, StreamType
} = require('@discordjs/voice');
const ytdlp = require('yt-dlp-exec');

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ DISCORD_TOKEN missing in .env!'); process.exit(1); }

// 3. Spotify Auth Callback Server
const callbackServer = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, 'http://127.0.0.1:8888');
  if (reqUrl.pathname === '/callback') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><body style="font-family:Arial;background:#121212;color:#1DB954;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
      <h1 style="font-size:3rem">🟢 Spotify Connected!</h1>
      <p style="color:#fff;font-size:1.2rem">Your Spotify account has been linked to <b>ChupkarIVY</b>.</p>
      <p style="color:#B3B3B3">You can close this tab and return to Discord!</p>
    </body></html>`);
  } else { res.writeHead(404); res.end(); }
});
callbackServer.listen(8888, '127.0.0.1', () => {
  console.log('🌐 Spotify Callback: http://127.0.0.1:8888/callback');
});

// 4. Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

// 5. Per-guild queue map
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });

    player.on('stateChange', (o, n) => {
      console.log(`🎵 Player: ${o.status} → ${n.status}`);
    });

    player.on('error', err => {
      console.error('🎵 Player Error:', err.message);
    });

    queues.set(guildId, {
      connection: null,
      player,
      songs: [],
      current: null,
      volume: 80,
      loop: 0 // 0=off, 1=song, 2=queue
    });
  }
  return queues.get(guildId);
}

// 6. Stream audio via yt-dlp piped through ffmpeg
function streamAudio(url) {
  // yt-dlp downloads audio and pipes raw data to stdout
  const ytdlpProc = ytdlp.exec(url, {
    output: '-',
    format: 'bestaudio/best',
    noWarnings: true
  });

  // ffmpeg transcodes to s16le PCM for Discord
  const ffmpeg = spawn(ffmpegStatic, [
    '-i', 'pipe:0',
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  ytdlpProc.stdout.pipe(ffmpeg.stdin);

  ytdlpProc.on('error', () => {});
  ffmpeg.on('error', () => {});
  ytdlpProc.stdout.on('error', () => {});
  ffmpeg.stdin.on('error', () => {});

  return ffmpeg.stdout;
}

// 7. Play next song in queue
async function playNext(guildId, textChannel) {
  const q = getQueue(guildId);

  if (q.loop === 1 && q.current) {
    // repeat current song
  } else if (q.songs.length === 0) {
    q.current = null;
    textChannel?.send({ embeds: [
      new EmbedBuilder().setColor(0x1DB954).setTitle('🎶 Queue Finished')
        .setDescription('No more songs! Use `/play` to add more.').setTimestamp()
    ] }).catch(() => {});
    return;
  } else {
    if (q.loop === 2 && q.current) q.songs.push(q.current); // re-add to end
    q.current = q.songs.shift();
  }

  const song = q.current;
  console.log(`▶️ Playing: ${song.title}`);

  try {
    let target = song.searchQuery || song.url;
    const pcmStream = streamAudio(target);
    const resource = createAudioResource(pcmStream, {
      inputType: StreamType.Raw,
      inlineVolume: true
    });
    resource.volume?.setVolume(q.volume / 100);
    q.player.play(resource);

    const dashboard = createDashboard(q, song);
    textChannel?.send(dashboard).catch(() => {});
  } catch (err) {
    console.error('Playback Error:', err.message);
    textChannel?.send(`⚠️ Error playing **${song.title}**: ${err.message}`).catch(() => {});
    playNext(guildId, textChannel);
  }
}

// 8. Chip-style player dashboard
function createDashboard(q, song) {
  const loopText = q.loop === 0 ? 'Off' : q.loop === 1 ? '🔂 Song' : '🔁 Queue';
  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('🎶 Now Playing')
    .setDescription(`[**${song.title}**](${song.url})`)
    .setThumbnail(song.thumbnail || null)
    .addFields(
      { name: '👤 Requested By', value: `<@${song.requestedBy}>`, inline: true },
      { name: '⏱️ Duration', value: song.duration || 'Live', inline: true },
      { name: '🎤 Artist', value: song.artist || 'Unknown', inline: true },
      { name: '🔊 Volume', value: `${q.volume}%`, inline: true },
      { name: '🔂 Loop', value: loopText, inline: true },
      { name: '📜 Queue', value: `${q.songs.length} song(s)`, inline: true }
    )
    .setFooter({ text: 'ChupkarIVY • Chip Music Engine' }).setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_pause').setLabel('⏯️ Pause/Resume').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('btn_shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_loop').setLabel('🔂 Loop').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_voldown').setLabel('🔉 Vol-').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_volup').setLabel('🔊 Vol+').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_queue').setLabel('📜 Queue').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// 9. Search YouTube via yt-dlp
async function searchYouTube(query) {
  const result = await ytdlp(`ytsearch:${query}`, {
    dumpSingleJson: true,
    noWarnings: true,
    flatPlaylist: true
  });
  const entry = result.entries?.[0] || result;
  return {
    title: entry.title || query,
    url: entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
    thumbnail: entry.thumbnail || null,
    duration: entry.duration_string || 'Unknown',
    artist: entry.uploader || entry.channel || 'Unknown',
    searchQuery: entry.webpage_url || `ytsearch:${query}`
  };
}

// 10. Connect to voice channel with retry
async function connectToVoice(voiceChannel, guildId, q) {
  if (q.connection && q.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    return q.connection;
  }

  q.connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });

  // Debug: log every state change
  q.connection.on('stateChange', (oldState, newState) => {
    console.log(`🔌 Voice: ${oldState.status} → ${newState.status}`);
  });

  // Subscribe player immediately
  q.connection.subscribe(q.player);

  // Wait for connection to be ready with fallback
  try {
    await entersState(q.connection, VoiceConnectionStatus.Ready, 10_000);
    console.log(`🔊 Connected to voice channel: ${voiceChannel.name}`);
  } catch {
    const status = q.connection?.state?.status;
    console.log(`🔌 Voice state after 10s: ${status}`);
    if (status === VoiceConnectionStatus.Destroyed) {
      q.connection = null;
      throw new Error('Failed to join voice channel. Please check channel permissions.');
    }
    // For Ready, Signalling, Connecting, or Disconnected retry - proceed to play
    console.log(`🔊 Voice connection established or joining (${status}). Proceeding...`);
  }

  // Handle disconnects
  q.connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(q.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(q.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      q.connection?.destroy();
      q.connection = null;
    }
  });

  return q.connection;
}

// 11. Bot ready event — register commands
client.once('ready', async (c) => {
  console.log('==========================================');
  console.log(`🟢 ChupkarIVY ONLINE as: ${c.user.tag}`);
  console.log(`🌐 Serving ${c.guilds.cache.size} server(s)`);
  console.log('==========================================');

  c.user.setActivity('/play • Chip Music', { type: ActivityType.Listening });

  const commands = [
    new SlashCommandBuilder().setName('play').setDescription('Play a song from YouTube / Spotify')
      .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true)),
    new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
    new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
    new SlashCommandBuilder().setName('skip').setDescription('Skip current song'),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear queue'),
    new SlashCommandBuilder().setName('volume').setDescription('Set volume (1-100)')
      .addIntegerOption(o => o.setName('percent').setDescription('Volume %').setRequired(true)),
    new SlashCommandBuilder().setName('join').setDescription('Join your voice channel'),
    new SlashCommandBuilder().setName('leave').setDescription('Leave voice channel'),
    new SlashCommandBuilder().setName('queue').setDescription('View music queue'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('Show current track'),
    new SlashCommandBuilder().setName('link').setDescription('Link Spotify account'),
    new SlashCommandBuilder().setName('unlink').setDescription('Unlink Spotify account'),
    new SlashCommandBuilder().setName('help').setDescription('Show all commands'),
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('🔄 Registering commands...');
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    for (const [gid] of c.guilds.cache) {
      await rest.put(Routes.applicationGuildCommands(c.user.id, gid), { body: commands }).catch(() => {});
    }
    console.log('⚡ Commands registered!');
  } catch (err) {
    console.error('❌ Command registration failed:', err.message);
  }
});

// 12. Interaction handler
client.on('interactionCreate', async (interaction) => {
  console.log(`📥 Interaction received: type=${interaction.type} command=${interaction.commandName || interaction.customId || '?'}`);
  // --- Button handler ---
  if (interaction.isButton()) {
    const q = getQueue(interaction.guildId);
    const { customId } = interaction;

    if (customId === 'btn_pause') {
      if (q.player.state.status === AudioPlayerStatus.Playing) {
        q.player.pause();
        return interaction.reply({ content: '⏸️ Paused.', flags: 64 });
      } else {
        q.player.unpause();
        return interaction.reply({ content: '▶️ Resumed.', flags: 64 });
      }
    }
    if (customId === 'btn_skip') {
      q.player.stop(); // triggers Idle → playNext
      return interaction.reply({ content: '⏭️ Skipped.', flags: 64 });
    }
    if (customId === 'btn_stop') {
      q.songs = [];
      q.current = null;
      q.player.stop();
      return interaction.reply({ content: '⏹️ Stopped and cleared queue.', flags: 64 });
    }
    if (customId === 'btn_shuffle') {
      for (let i = q.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q.songs[i], q.songs[j]] = [q.songs[j], q.songs[i]];
      }
      return interaction.reply({ content: '🔀 Queue shuffled!', flags: 64 });
    }
    if (customId === 'btn_loop') {
      q.loop = (q.loop + 1) % 3;
      const t = ['Off', '🔂 Song', '🔁 Queue'][q.loop];
      return interaction.reply({ content: `Loop: **${t}**`, flags: 64 });
    }
    if (customId === 'btn_volup') {
      q.volume = Math.min(q.volume + 10, 100);
      return interaction.reply({ content: `🔊 Volume: **${q.volume}%**`, flags: 64 });
    }
    if (customId === 'btn_voldown') {
      q.volume = Math.max(q.volume - 10, 1);
      return interaction.reply({ content: `🔉 Volume: **${q.volume}%**`, flags: 64 });
    }
    if (customId === 'btn_queue') {
      const list = q.songs.slice(0, 10).map((s, i) => `${i + 1}. **${s.title}** — ${s.duration}`).join('\n');
      return interaction.reply({ embeds: [
        new EmbedBuilder().setColor(0x1DB954).setTitle('📜 Queue').setDescription(list || 'Empty!')
      ], flags: 64 });
    }
    return;
  }

  // --- Slash command handler ---
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, member, channel } = interaction;
  const voiceChannel = member.voice?.channel;
  const q = getQueue(guildId);

  // /link
  if (commandName === 'link') {
    const cid = process.env.SPOTIFY_CLIENT_ID || '8e8767817181457c84c05dd9b7e8bf18';
    const redir = encodeURIComponent('http://127.0.0.1:8888/callback');
    const scope = encodeURIComponent('user-read-currently-playing user-read-playback-state user-modify-playback-state');
    const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${cid}&scope=${scope}&redirect_uri=${redir}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🔗 Authorize Spotify').setStyle(ButtonStyle.Link).setURL(url)
    );
    return interaction.reply({ content: '🎧 Click below to link Spotify:', components: [row] });
  }
  if (commandName === 'unlink') return interaction.reply('🔌 Spotify unlinked.');

  // /help
  if (commandName === 'help') {
    return interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0x1DB954).setTitle('🎧 ChupkarIVY Commands')
        .setDescription('Chip-Style Music Engine')
        .addFields(
          { name: '/play <query>', value: 'Play from YouTube/Spotify' },
          { name: '/pause / /resume', value: 'Pause or resume' },
          { name: '/skip / /stop', value: 'Skip or stop' },
          { name: '/volume <1-100>', value: 'Set volume' },
          { name: '/queue / /nowplaying', value: 'View queue or current track' },
          { name: '/join / /leave', value: 'Voice channel' },
          { name: '/link / /unlink', value: 'Spotify account' },
        )
    ] });
  }

  // Voice-required commands
  if (['play', 'join'].includes(commandName) && !voiceChannel) {
    return interaction.reply({ content: '❌ Join a voice channel first!', flags: 64 });
  }

  // /join
  if (commandName === 'join') {
    try {
      await connectToVoice(voiceChannel, guildId, q);
      return interaction.reply(`🔊 Joined **${voiceChannel.name}**!`);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: 64 });
    }
  }

  // /leave
  if (commandName === 'leave') {
    if (q.connection) { q.connection.destroy(); q.connection = null; q.songs = []; q.current = null; }
    return interaction.reply('👋 Left voice channel.');
  }

  // /pause
  if (commandName === 'pause') {
    q.player.pause();
    return interaction.reply('⏸️ Paused.');
  }

  // /resume
  if (commandName === 'resume') {
    q.player.unpause();
    return interaction.reply('▶️ Resumed.');
  }

  // /skip
  if (commandName === 'skip') {
    q.player.stop();
    return interaction.reply('⏭️ Skipped.');
  }

  // /stop
  if (commandName === 'stop') {
    q.songs = []; q.current = null; q.player.stop();
    return interaction.reply('⏹️ Stopped.');
  }

  // /volume
  if (commandName === 'volume') {
    q.volume = interaction.options.getInteger('percent');
    return interaction.reply(`🔊 Volume: **${q.volume}%**`);
  }

  // /nowplaying
  if (commandName === 'nowplaying') {
    if (!q.current) return interaction.reply({ content: '❌ Nothing playing!', flags: 64 });
    return interaction.reply(createDashboard(q, q.current));
  }

  // /queue
  if (commandName === 'queue') {
    let desc = '';
    if (q.current) desc += `**Now:** ${q.current.title}\n\n`;
    if (q.songs.length > 0) {
      desc += q.songs.slice(0, 10).map((s, i) => `${i + 1}. **${s.title}** — ${s.duration}`).join('\n');
    } else {
      desc += 'Queue is empty!';
    }
    return interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0x1DB954).setTitle('📜 Music Queue').setDescription(desc)
    ] });
  }

  // /play
  if (commandName === 'play') {
    await interaction.deferReply();
    const query = interaction.options.getString('query');

    try {
      // Connect to voice
      await connectToVoice(voiceChannel, guildId, q);

      // Setup Idle listener (only once)
      if (!q._idleListenerSet) {
        q.player.on(AudioPlayerStatus.Idle, () => {
          playNext(guildId, channel);
        });
        q._idleListenerSet = true;
      }

      // Search for the song
      let song;
      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        song = await searchYouTube(query);
      } else if (query.includes('spotify.com')) {
        // Extract song name from Spotify URL via yt-dlp
        song = await searchYouTube(query);
      } else {
        song = await searchYouTube(query);
      }
      song.requestedBy = member.id;

      // Add to queue
      q.songs.push(song);

      // If nothing playing, start immediately
      if (q.player.state.status === AudioPlayerStatus.Idle) {
        playNext(guildId, channel);
        await interaction.editReply(`🎵 Now playing **${song.title}**`);
      } else {
        await interaction.editReply(`➕ Added **${song.title}** to queue (Position #${q.songs.length})`);
      }
    } catch (err) {
      console.error('Play Error:', err);
      await interaction.editReply(`❌ Error: ${err.message}`).catch(() => {});
    }
  }
});

// 13. Handle unhandled rejections gracefully
process.on('unhandledRejection', (err) => {
  console.error('Unhandled:', err.message || err);
});

client.login(token);
