const { Client, GatewayIntentBits, ActivityType, REST, Routes, ApplicationCommandType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus } = require('@discordjs/voice');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const commands = [
    {
        name: 'ping',
        description: 'Botun ping değerlerini gösterir'
    }
];

const rest = new REST({ version: '10' }).setToken(config.token);

async function deployCommands() {
    try {
        console.log('Slash komutları yükleniyor...');
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commands }
        );
        console.log('Slash komutları başarıyla yüklendi!');
    } catch (error) {
        console.error('Slash komut yükleme hatası:', error);
    }
}

let voiceConnection = null;
let audioPlayer = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
    }
});

let isPlaying = false;
let isSpeaking = false;

// Temp klasörü kontrolü
if (!fs.existsSync('./temp')) {
    fs.mkdirSync('./temp');
}

function playMusic(connection) {
    if (isPlaying || isSpeaking) return;
    
    try {
        const resource = createAudioResource('muzik.mp3', {
            inlineVolume: true
        });
        resource.volume.setVolume(0.5);
        audioPlayer.play(resource);
        connection.subscribe(audioPlayer);
        isPlaying = true;
    } catch (error) {
        console.error('Müzik çalma hatası:', error);
    }
}

audioPlayer.on(AudioPlayerStatus.Idle, () => {
    if (isSpeaking) return;
    
    if (voiceConnection && isPlaying) {
        setTimeout(() => {
            playMusic(voiceConnection);
        }, 500);
    }
});

async function downloadAndPlayAudio(text, connection) {
    return new Promise(async (mainResolve) => {
        try {
            isSpeaking = true;
            isPlaying = false;
            audioPlayer.stop();

            text = text.replace(/ğ/g, 'g')
                      .replace(/ç/g, 'ch')
                      .replace(/ş/g, 'sh')
                      .replace(/ı/g, 'i')
                      .replace(/ö/g, 'o')
                      .replace(/ü/g, 'u');

            console.log('Ses çalınıyor:', text); // Debug log

            const response = await axios({
                url: `https://www.msii.xyz/api/yaziyi-ses-yapma?text=${encodeURIComponent(text)}`,
                method: 'GET',
                responseType: 'stream'
            });

            const tempFile = `./temp/temp_${Date.now()}.mp3`;
            const writer = fs.createWriteStream(tempFile);
            
            response.data.pipe(writer);

            writer.on('finish', () => {
                const resource = createAudioResource(tempFile, {
                    inlineVolume: true
                });
                resource.volume.setVolume(1);
                
                audioPlayer.play(resource);
                connection.subscribe(audioPlayer);

                audioPlayer.once(AudioPlayerStatus.Idle, () => {
                    try {
                        fs.unlinkSync(tempFile);
                        setTimeout(() => {
                            isSpeaking = false;
                            isPlaying = false;
                            playMusic(connection);
                            mainResolve();
                        }, 1000);
                    } catch (err) {
                        console.error('Dosya silme hatası:', err);
                        mainResolve();
                    }
                });
            });

            writer.on('error', error => {
                console.error('Dosya yazma hatası:', error);
                isSpeaking = false;
                mainResolve();
            });

        } catch (error) {
            console.error('API hatası:', error);
            isSpeaking = false;
            isPlaying = false;
            playMusic(connection);
            mainResolve();
        }
    });
}

function connectToVoiceChannel(channel) {
    try {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        connection.on('stateChange', (_, newState) => {
            if (newState.status === 'disconnected') {
                setTimeout(() => {
                    try {
                        connectToVoiceChannel(channel);
                    } catch (error) {
                        console.error('Yeniden bağlanma hatası:', error);
                    }
                }, 5000);
            }
        });

        return connection;
    } catch (error) {
        console.error('Ses kanalına bağlanma hatası:', error);
        return null;
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        try {
            await interaction.deferReply();

            const apiPing = Math.round(client.ws.ping);
            const messagePing = Date.now() - interaction.createdTimestamp;
            const voicePing = voiceConnection ? voiceConnection.ping?.udp || 0 : 0;

            const getPingStatus = (ping) => {
                if (ping < 100) return { emoji: '🟢', status: 'Mükemmel', color: 0x00ff00 };
                if (ping < 200) return { emoji: '🟡', status: 'İyi', color: 0xffff00 };
                return { emoji: '🔴', status: 'Yüksek', color: 0xff0000 };
            };

            const apiStatus = getPingStatus(apiPing);
            const messageStatus = getPingStatus(messagePing);
            const voiceStatus = getPingStatus(voicePing);

            const embed = {
                color: apiStatus.color,
                title: '🏓 Pong! Bot Ping Değerleri',
                fields: [
                    {
                        name: `${apiStatus.emoji} Discord API Pingi`,
                        value: `\`${apiPing}ms\` - ${apiStatus.status}`,
                        inline: true
                    },
                    {
                        name: `${messageStatus.emoji} Bot Pingi`,
                        value: `\`${messagePing}ms\` - ${messageStatus.status}`,
                        inline: true
                    },
                    {
                        name: `${voiceStatus.emoji} Ses Pingi`,
                        value: `\`${voicePing}ms\` - ${voiceStatus.status}`,
                        inline: true
                    }
                ],
                footer: {
                    text: `${interaction.user.tag} tarafından istendi`,
                    icon_url: interaction.user.displayAvatarURL({ dynamic: true })
                },
                timestamp: new Date()
            };

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Ping komutu hatası:', error);
            await interaction.editReply('Ping ölçülürken bir hata oluştu!');
        }
    }
});

client.once('ready', async () => {
    console.log(`${client.user.tag} olarak giriş yapıldı!`);
    
    await deployCommands();
    
    client.user.setActivity(config.botDurum, { 
        type: ActivityType[config.botDurumTipi] 
    });

    const channel = client.channels.cache.get(config.hedefSesKanalID);
    if (channel) {
        voiceConnection = connectToVoiceChannel(channel);
        setTimeout(() => {
            isPlaying = false;
            playMusic(voiceConnection);
        }, 2000);
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    // Kullanıcı hedef kanala katıldığında
    if (newState.channelId === config.hedefSesKanalID && oldState.channelId !== config.hedefSesKanalID) {
        const member = newState.member;
        
        // Bot kendisi ise işlemi durdur
        if (member.id === client.user.id) return;
        
        // Bağlantı kontrolü
        if (!voiceConnection || voiceConnection.state.status === 'disconnected') {
            const channel = client.channels.cache.get(config.hedefSesKanalID);
            if (channel) {
                voiceConnection = connectToVoiceChannel(channel);
            }
        }

        try {
            // Yetkili kontrolü
            const hasYetkili = member.roles.cache.has(config.yetkiliRolID);
            
            console.log(`Kullanıcı: ${member.user.username}`);
            console.log(`Yetkili mi: ${hasYetkili}`);
            
            if (hasYetkili) {
                await downloadAndPlayAudio(
                    "Ses kanalına bir yetkili veya kayıt sorumlusu girdi",
                    voiceConnection
                );
            } else {
                await downloadAndPlayAudio(
                    `${member.user.username} hoşgeldin sunucumuza lütfen kayıt yetkililerini bekle`,
                    voiceConnection
                );
            }
        } catch (error) {
            console.error('Ses çalma hatası:', error);
        }
    }
});

process.on('unhandledRejection', error => {
    console.error('Yakalanmamış Hata:', error);
});

client.login(config.token);