// ============================================================
// ChupkarIVY — Chip-Style Discord Music Bot
// Fresh Build: Chip UI Dashboard + Spotify/YouTube Engine
// ============================================================

// 1. Force IPv4 DNS & Detect Primary Local Network Adapter
const dns = require('dns');
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

const os = require('os');
const dgram = require('dgram');

let mainLocalIp = '0.0.0.0';
const netIfaces = os.networkInterfaces();
for (const ifaceName of Object.keys(netIfaces)) {
  for (const iface of netIfaces[ifaceName]) {
    if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
      mainLocalIp = iface.address;
      break;
    }
  }
  if (mainLocalIp !== '0.0.0.0') break;
}
console.log(`🌐 Primary Local Network IP: ${mainLocalIp}`);

// Bind UDP sockets explicitly to main local IP to bypass virtual network adapters
if (mainLocalIp !== '0.0.0.0') {
  const origCreateSocket = dgram.createSocket;
  dgram.createSocket = function(...args) {
    const socket = origCreateSocket.apply(this, args);
    const origBind = socket.bind;
    socket.bind = function(...bArgs) {
      let port = 0;
      let cb;
      if (typeof bArgs[0] === 'number') {
        port = bArgs[0];
        if (typeof bArgs[1] === 'function') cb = bArgs[1];
      } else if (typeof bArgs[0] === 'object' && bArgs[0] !== null) {
        port = bArgs[0].port || 0;
        if (typeof bArgs[1] === 'function') cb = bArgs[1];
      }
      return origBind.call(this, port, mainLocalIp, cb);
    };
    return socket;
  };
}

// 2. Setup ffmpeg static binary path
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
process.env.PATH = path.dirname(ffmpegStatic) + ';' + process.env.PATH;

// Force load C++ native modules
try { require('sodium-native'); console.log('✅ sodium-native loaded'); }
catch { try { require('libsodium-wrappers'); console.log('✅ libsodium-wrappers loaded'); }
catch { console.warn('⚠️ No sodium library found'); } }

try { require('@discordjs/opus'); console.log('✅ @discordjs/opus loaded'); }
catch { console.warn('⚠️ @discordjs/opus not found'); }

require('dotenv').config();

// 3. Imports
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
const { getDetails, getTracks } = require('spotify-url-info')(fetch);

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ DISCORD_TOKEN missing in .env!'); process.exit(1); }

// 4. Local Spotify Auth Web Server
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

// 5. Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

// 6. Per-guild Queue Management
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
      loop: 0 // 0=Off, 1=Song, 2=Queue
    });
  }
  return queues.get(guildId);
}

// 7. Stream audio via yt-dlp piped into FFmpeg OggOpus
function streamAudio(searchTarget) {
  const ytdlpProc = ytdlp.exec(searchTarget, {
    output: '-',
    format: 'bestaudio/best',
    noWarnings: true
  });

  const ffmpeg = spawn(ffmpegStatic, [
    '-i', 'pipe:0',
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'opus',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  ytdlpProc.stdout.pipe(ffmpeg.stdin);

  ytdlpProc.on('error', () => {});
  ffmpeg.on('error', () => {});
  ytdlpProc.stdout.on('error', () => {});
  ffmpeg.stdin.on('error', () => {});

  return ffmpeg.stdout;
}

// 8. Play Next Song
async function playNext(guildId, textChannel) {
  const q = getQueue(guildId);

  if (q.loop === 1 && q.current) {
    // repeat current song
  } else if (q.songs.length === 0) {
    q.current = null;
    textChannel?.send({ embeds: [
      new EmbedBuilder().setColor(0x1DB954).setTitle('🎶 Queue Finished')
        .setDescription('No more songs in queue! Use `/play` to add more tracks.').setTimestamp()
    ] }).catch(() => {});
    return;
  } else {
    if (q.loop === 2 && q.current) q.songs.push(q.current);
    q.current = q.songs.shift();
  }

  const song = q.current;
  console.log(`▶️ Playing: ${song.title}`);

  try {
    const opusStream = streamAudio(song.searchQuery || song.url);
    const resource = createAudioResource(opusStream, {
      inputType: StreamType.OggOpus,
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

// 9. Create Chip-Style Player Dashboard
function createDashboard(q, song) {
  const loopText = q.loop === 0 ? 'Off' : q.loop === 1 ? '🔂 Song' : '🔁 Queue';
  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('🎶 Now Playing')
    .setDescription(`[**${song.title}**](${song.url || 'https://open.spotify.com'})`)
    .setThumbnail(song.thumbnail || 'https://i.imgur.com/vH0E8dK.png')
    .addFields(
      { name: '👤 Requested By', value: `<@${song.requestedBy}>`, inline: true },
      { name: '⏱️ Duration', value: song.duration || 'Live', inline: true },
      { name: '🎤 Artist', value: song.artist || 'Unknown Artist', inline: true },
      { name: '🔊 Volume', value: `${q.volume}%`, inline: true },
      { name: '🔂 Loop', value: loopText, inline: true },
      { name: '📜 Queue', value: `${q.songs.length} song(s) waiting`, inline: true }
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

// 10. Search Track (Spotify & YouTube)
async function searchTrack(query) {
  // If query is a Spotify link
  if (query.includes('spotify.com')) {
    try {
      if (query.includes('/track/')) {
        const details = await getDetails(query);
        const title = details.preview.title;
        const artist = details.preview.artist;
        const thumbnail = details.preview.image;
        return [{
          title: `${title} - ${artist}`,
          url: query,
          thumbnail: thumbnail,
          artist: artist,
          duration: 'Spotify Track',
          searchQuery: `ytsearch:${title} ${artist}`
        }];
      } else {
        // Spotify Playlist or Album
        const tracks = await getTracks(query);
        return tracks.map(t => ({
          title: `${t.name} - ${t.artists?.map(a => a.name).join(', ') || ''}`,
          url: query,
          thumbnail: null,
          artist: t.artists?.[0]?.name || 'Spotify',
          duration: 'Spotify Track',
          searchQuery: `ytsearch:${t.name} ${t.artists?.[0]?.name || ''}`
        }));
      }
    } catch (err) {
      console.warn('Spotify url parse failed, falling back to ytsearch:', err.message);
    }
  }

  // YouTube / Text Search
  let searchTarget = query;
  if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
    searchTarget = `ytsearch:${query}`;
  }

  const result = await ytdlp(searchTarget, {
    dumpSingleJson: true,
    noWarnings: true,
    flatPlaylist: true
  });
  const entry = result.entries?.[0] || result;

  return [{
    title: entry.title || query,
    url: entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
    thumbnail: entry.thumbnail || null,
    duration: entry.duration_string || 'Unknown',
    artist: entry.uploader || entry.channel || 'YouTube',
    searchQuery: entry.webpage_url || searchTarget
  }];
}

// 11. Voice Channel Connection
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

  q.connection.on('stateChange', (oldState, newState) => {
    console.log(`🔌 Voice: ${oldState.status} → ${newState.status}`);
  });

  q.connection.subscribe(q.player);

  try {
    await entersState(q.connection, VoiceConnectionStatus.Ready, 10_000);
    console.log(`🔊 Connected to voice: ${voiceChannel.name}`);
  } catch {
    const status = q.connection?.state?.status;
    console.log(`🔌 Voice connection state: ${status}`);
    if (status === VoiceConnectionStatus.Destroyed) {
      q.connection = null;
      throw new Error('Failed to join voice channel.');
    }
  }

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

// 12. Bot Client Ready Event
client.once('ready', async (c) => {
  console.log('==========================================');
  console.log(`🟢 ChupkarIVY ONLINE as: ${c.user.tag}`);
  console.log(`🌐 Serving ${c.guilds.cache.size} server(s)`);
  console.log('==========================================');

  c.user.setActivity('/play • Chip Music', { type: ActivityType.Listening });

  const commands = [
    new SlashCommandBuilder().setName('play').setDescription('Play music from YouTube or Spotify')
      .addStringOption(o => o.setName('query').setDescription('Song name, YouTube URL, or Spotify URL').setRequired(true)),
    new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
    new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
    new SlashCommandBuilder().setName('skip').setDescription('Skip current song'),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear queue'),
    new SlashCommandBuilder().setName('volume').setDescription('Set volume (1-100)')
      .addIntegerOption(o => o.setName('percent').setDescription('Volume %').setRequired(true)),
    new SlashCommandBuilder().setName('join').setDescription('Join your voice channel'),
    new SlashCommandBuilder().setName('leave').setDescription('Leave voice channel'),
    new SlashCommandBuilder().setName('queue').setDescription('View current queue'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('Show current playing track'),
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
    console.log('⚡ Commands registered successfully!');
  } catch (err) {
    console.error('❌ Command registration failed:', err.message);
  }
});

// 13. Interaction Handler
client.on('interactionCreate', async (interaction) => {
  // --- Button Interactivity ---
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
      q.player.stop();
      return interaction.reply({ content: '⏭️ Skipped.', flags: 64 });
    }
    if (customId === 'btn_stop') {
      q.songs = []; q.current = null; q.player.stop();
      return interaction.reply({ content: '⏹️ Stopped.', flags: 64 });
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
      return interaction.reply({ content: `Loop mode: **${t}**`, flags: 64 });
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
      const list = q.songs.slice(0, 10).map((s, i) => `${i + 1}. **${s.title}**`).join('\n');
      return interaction.reply({ embeds: [
        new EmbedBuilder().setColor(0x1DB954).setTitle('📜 Current Queue').setDescription(list || 'Queue is empty!')
      ], flags: 64 });
    }
    return;
  }

  // --- Slash Commands ---
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
      new ButtonBuilder().setLabel('🔗 Authorize Spotify Account').setStyle(ButtonStyle.Link).setURL(url)
    );
    return interaction.reply({ content: '🎧 Click below to link your Spotify account:', components: [row] });
  }
  if (commandName === 'unlink') return interaction.reply('🔌 Spotify unlinked.');

  // /help
  if (commandName === 'help') {
    return interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0x1DB954).setTitle('🎧 ChupkarIVY Commands')
        .setDescription('Chip-Style Music Engine')
        .addFields(
          { name: '/play <query / URL>', value: 'Play song or Spotify track/playlist' },
          { name: '/pause / /resume', value: 'Pause or resume playback' },
          { name: '/skip / /stop', value: 'Skip track or clear queue' },
          { name: '/volume <1-100>', value: 'Set volume level' },
          { name: '/queue / /nowplaying', value: 'View queue or current song' },
          { name: '/join / /leave', value: 'Manage voice connection' },
          { name: '/link / /unlink', value: 'Link Spotify account' }
        )
    ] });
  }

  // Voice requirement check
  if (['play', 'join'].includes(commandName) && !voiceChannel) {
    return interaction.reply({ content: '❌ Please join a voice channel first!', flags: 64 });
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
    return interaction.reply('⏭️ Skipped track.');
  }

  // /stop
  if (commandName === 'stop') {
    q.songs = []; q.current = null; q.player.stop();
    return interaction.reply('⏹️ Stopped playback and cleared queue.');
  }

  // /volume
  if (commandName === 'volume') {
    q.volume = interaction.options.getInteger('percent');
    return interaction.reply(`🔊 Volume set to **${q.volume}%**`);
  }

  // /nowplaying
  if (commandName === 'nowplaying') {
    if (!q.current) return interaction.reply({ content: '❌ Nothing currently playing!', flags: 64 });
    return interaction.reply(createDashboard(q, q.current));
  }

  // /queue
  if (commandName === 'queue') {
    let desc = '';
    if (q.current) desc += `**Now Playing:** ${q.current.title}\n\n`;
    if (q.songs.length > 0) {
      desc += q.songs.slice(0, 10).map((s, i) => `${i + 1}. **${s.title}**`).join('\n');
    } else {
      desc += 'Queue is empty!';
    }
    return interaction.reply({ embeds: [
      new EmbedBuilder().setColor(0x1DB954).setTitle('📜 Current Music Queue').setDescription(desc)
    ] });
  }

  // /play
  if (commandName === 'play') {
    await interaction.deferReply();
    const query = interaction.options.getString('query');

    try {
      await connectToVoice(voiceChannel, guildId, q);

      if (!q._idleListenerSet) {
        q.player.on(AudioPlayerStatus.Idle, () => {
          playNext(guildId, channel);
        });
        q._idleListenerSet = true;
      }

      // Resolve track(s)
      const tracks = await searchTrack(query);
      for (const t of tracks) {
        t.requestedBy = member.id;
        q.songs.push(t);
      }

      if (q.player.state.status === AudioPlayerStatus.Idle) {
        playNext(guildId, channel);
        await interaction.editReply(`🎵 Now playing **${tracks[0].title}**`);
      } else {
        await interaction.editReply(`➕ Added **${tracks.length} song(s)** to queue (Queue length: #${q.songs.length})`);
      }
    } catch (err) {
      console.error('Play Error:', err);
      await interaction.editReply(`❌ Error: ${err.message}`).catch(() => {});
    }
  }
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled:', err.message || err);
});

client.login(token);
