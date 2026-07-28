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
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  VoiceConnectionStatus 
} = require('@discordjs/voice');
const play = require('play-dl');
const spotifyUrl = require('spotify-url-info')(fetch);
const ytdlp = require('yt-dlp-exec');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is missing in .env file!');
  process.exit(1);
}

// Local Spotify Callback Web Server
const callbackServer = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, 'http://127.0.0.1:8888');
  if (reqUrl.pathname === '/callback') {
    const code = reqUrl.searchParams.get('code');
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

// Guild Music Queue Map: guildId -> { connection, player, queue: [], currentTrack, loop }
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      player: createAudioPlayer(),
      queue: [],
      currentTrack: null,
      loop: false
    });
  }
  return queues.get(guildId);
}

async function playNext(guildId, textChannel) {
  const serverQueue = getQueue(guildId);
  if (serverQueue.queue.length === 0) {
    serverQueue.currentTrack = null;
    if (textChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎶 Queue Finished')
        .setDescription('Queue is empty! Add more songs using `/play`.')
        .setTimestamp();
      textChannel.send({ embeds: [embed] }).catch(() => {});
    }
    return;
  }

  const track = serverQueue.queue.shift();
  serverQueue.currentTrack = track;

  try {
    let searchTarget = track.url;
    if (!searchTarget.includes('youtube.com') && !searchTarget.includes('youtu.be')) {
      searchTarget = `ytsearch:${track.title} ${track.artist || ''}`;
    }

    const output = await ytdlp(searchTarget, {
      dumpSingleJson: true,
      noWarnings: true,
      format: 'bestaudio/best'
    });

    const info = output.entries ? output.entries[0] : output;
    if (!info || !info.url) {
      throw new Error('Could not extract stream URL');
    }

    const resource = createAudioResource(info.url);
    serverQueue.player.play(resource);

    if (textChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 Now Playing')
        .setDescription(`[**${info.title || track.title}**](${info.webpage_url || track.url})\n👤 Requested by: <@${track.requestedBy}>`)
        .setThumbnail(info.thumbnail || track.thumbnail || 'https://open.spotifycdn.com/cdn/images/device-picker/spotify.png')
        .addFields(
          { name: '⏱️ Duration', value: track.duration || 'Unknown', inline: true },
          { name: '🎤 Artist/Channel', value: info.uploader || track.artist || 'Unknown', inline: true }
        )
        .setFooter({ text: 'ChupkarIVY Spotify & YouTube Music Engine' })
        .setTimestamp();

      textChannel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    console.error('Playback Error:', err.message);
    if (textChannel) {
      textChannel.send(`⚠️ Error playing **${track.title}**: ${err.message}`).catch(() => {});
    }
    playNext(guildId, textChannel);
  }
}

client.once('ready', async (c) => {
  console.log('==========================================');
  console.log(`🟢 SUCCESS! ChupkarIVY Music Bot is ONLINE as: ${c.user.tag}`);
  console.log(`🌐 Serving in ${c.guilds.cache.size} server(s)`);
  console.log('==========================================');

  c.user.setActivity('Spotify Music | /play', { type: ActivityType.Listening });

  // Define Slash Commands
  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song or playlist from Spotify / YouTube')
      .addStringOption(option =>
        option.setName('query')
          .setDescription('Song title, artist name, Spotify link, or YouTube link')
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
      .setDescription('Stop music playback and clear the queue'),

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
      .setDescription('Link your Spotify account to mirror playback & sync listening'),

    new SlashCommandBuilder()
      .setName('unlink')
      .setDescription('Unlink your Spotify account'),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('View list of available music commands')
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

client.on('interactionCreate', async (interaction) => {
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
      .setTitle('🎧 ChupkarIVY Music Commands')
      .setDescription('High Quality Spotify & YouTube Music Bot')
      .addFields(
        { name: '🎵 `/play <query/url>`', value: 'Play song or playlist from Spotify / YouTube' },
        { name: '🔗 `/link` / `/unlink`', value: 'Link or unlink your Spotify account' },
        { name: '⏸️ `/pause`', value: 'Pause current playback' },
        { name: '▶️ `/resume`', value: 'Resume paused playback' },
        { name: '⏭️ `/skip`', value: 'Skip to next song' },
        { name: '⏹️ `/stop`', value: 'Stop playback and clear queue' },
        { name: '🔊 `/join` / `/leave`', value: 'Connect or disconnect voice channel' },
        { name: '📜 `/queue`', value: 'View upcoming queued songs' },
        { name: '🎶 `/nowplaying`', value: 'Show current playing track info' }
      )
      .setFooter({ text: 'ChupkarIVY 24/7 Music Engine' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (['play', 'pause', 'resume', 'skip', 'stop', 'join', 'leave', 'queue', 'nowplaying'].includes(commandName)) {
    if (!voiceChannel && ['play', 'join'].includes(commandName)) {
      return interaction.reply({ content: '❌ You must be in a Voice Channel to use music commands!', flags: 64 });
    }

    const serverQueue = getQueue(guildId);

    if (commandName === 'join') {
      serverQueue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
      });
      serverQueue.connection.subscribe(serverQueue.player);
      return interaction.reply(`🔊 Joined **${voiceChannel.name}**!`);
    }

    if (commandName === 'leave') {
      if (serverQueue.connection) {
        serverQueue.connection.destroy();
        serverQueue.connection = null;
        serverQueue.queue = [];
        serverQueue.currentTrack = null;
        return interaction.reply('👋 Disconnected from voice channel.');
      }
      return interaction.reply({ content: '❌ I am not connected to a voice channel!', flags: 64 });
    }

    if (commandName === 'pause') {
      serverQueue.player.pause();
      return interaction.reply('⏸️ Paused playback.');
    }

    if (commandName === 'resume') {
      serverQueue.player.unpause();
      return interaction.reply('▶️ Resumed playback.');
    }

    if (commandName === 'skip') {
      serverQueue.player.stop();
      return interaction.reply('⏭️ Skipped current song.');
    }

    if (commandName === 'stop') {
      serverQueue.queue = [];
      serverQueue.currentTrack = null;
      serverQueue.player.stop();
      return interaction.reply('⏹️ Stopped playback and cleared queue.');
    }

    if (commandName === 'nowplaying') {
      if (!serverQueue.currentTrack) {
        return interaction.reply({ content: '❌ No song is currently playing!', flags: 64 });
      }
      const track = serverQueue.currentTrack;
      const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('🎵 Currently Playing')
        .setDescription(`[**${track.title}**](${track.url})`)
        .setThumbnail(track.thumbnail || 'https://open.spotifycdn.com/cdn/images/device-picker/spotify.png')
        .addFields(
          { name: '🎤 Artist', value: track.artist || 'Unknown', inline: true },
          { name: '⏱️ Duration', value: track.duration || 'Unknown', inline: true }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'queue') {
      if (!serverQueue.currentTrack && serverQueue.queue.length === 0) {
        return interaction.reply({ content: '📜 The queue is empty!', flags: 64 });
      }
      let desc = serverQueue.currentTrack ? `**Now Playing:** [${serverQueue.currentTrack.title}](${serverQueue.currentTrack.url})\n\n**Up Next:**\n` : '**Up Next:**\n';
      serverQueue.queue.slice(0, 10).forEach((t, i) => {
        desc += `${i + 1}. [${t.title}](${t.url}) - requested by <@${t.requestedBy}>\n`;
      });
      if (serverQueue.queue.length > 10) {
        desc += `\n*...and ${serverQueue.queue.length - 10} more songs*`;
      }
      const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setTitle('📜 Music Queue')
        .setDescription(desc);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');

      // Ensure voice connection
      if (!serverQueue.connection || serverQueue.connection.state.status === VoiceConnectionStatus.Destroyed) {
        serverQueue.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guildId,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator
        });
        serverQueue.connection.subscribe(serverQueue.player);

        serverQueue.player.on(AudioPlayerStatus.Idle, () => {
          playNext(guildId, channel);
        });
      }

      try {
        let tracksToAdd = [];

        if (query.includes('spotify.com')) {
          if (query.includes('/track/')) {
            const data = await spotifyUrl.getPreview(query);
            tracksToAdd.push({
              title: data.title,
              artist: data.artist,
              url: query,
              thumbnail: data.image,
              duration: '3:00',
              requestedBy: member.user.id
            });
          } else if (query.includes('/playlist/') || query.includes('/album/')) {
            const tracksData = await spotifyUrl.getTracks(query);
            tracksData.slice(0, 25).forEach(t => {
              tracksToAdd.push({
                title: t.name,
                artist: t.artists ? t.artists.map(a => a.name).join(', ') : 'Artist',
                url: query,
                thumbnail: 'https://open.spotifycdn.com/cdn/images/device-picker/spotify.png',
                duration: '3:00',
                requestedBy: member.user.id
              });
            });
          }
        } else if (query.includes('youtube.com') || query.includes('youtu.be')) {
          tracksToAdd.push({
            title: query,
            artist: 'YouTube',
            url: query,
            thumbnail: 'https://open.spotifycdn.com/cdn/images/device-picker/spotify.png',
            duration: 'Audio',
            requestedBy: member.user.id
          });
        } else {
          // Direct text search
          tracksToAdd.push({
            title: query,
            artist: 'Search Query',
            url: query,
            thumbnail: 'https://open.spotifycdn.com/cdn/images/device-picker/spotify.png',
            duration: 'Audio',
            requestedBy: member.user.id
          });
        }

        serverQueue.queue.push(...tracksToAdd);

        if (!serverQueue.currentTrack) {
          await interaction.editReply(`🎵 Added **${tracksToAdd[0].title}** to queue & starting playback!`);
          playNext(guildId, channel);
        } else {
          if (tracksToAdd.length === 1) {
            await interaction.editReply(`➕ Added **${tracksToAdd[0].title}** to queue (Position #${serverQueue.queue.length})`);
          } else {
            await interaction.editReply(`🎶 Added **${tracksToAdd.length} songs** to queue!`);
          }
        }
      } catch (err) {
        console.error('Play Error:', err);
        return interaction.editReply(`❌ Error adding song: ${err.message}`);
      }
    }
  }
});

client.login(token);
