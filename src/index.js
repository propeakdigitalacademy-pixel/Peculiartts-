Require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const googleTTS = require('google-tts-api');
const axios = require('axios');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ FATAL: BOT_TOKEN environment variable is missing.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// --- In-Memory Persistence (Map) ---
// Structure: Map<chatId, { language: string, speed: number }>
const userSettings = new Map();

const DEFAULT_SETTINGS = {
    language: 'en',
    speed: 1.0 // 1.0 = Normal, 0.5 = Slow
};

// --- Helpers ---

/**
 * Retrieves user settings or returns defaults
 */
const getSettings = (chatId) => {
    if (!userSettings.has(chatId)) {
        userSettings.set(chatId, { ...DEFAULT_SETTINGS });
    }
    return userSettings.get(chatId);
};

/**
 * Generates the Inline Keyboard for Settings
 * Highlights the currently selected options with a checkmark
 */
const createSettingsKeyboard = (chatId) => {
    const settings = getSettings(chatId);
    
    return Markup.inlineKeyboard([
        // Language Row
        [
            Markup.button.callback(
                `${settings.language === 'en' ? '✅ ' : ''}English`, 
                'set_lang_en'
            ),
            Markup.button.callback(                `${settings.language === 'fr' ? '✅ ' : ''}Français`, 
                'set_lang_fr'
            ),
        ],
        [
            Markup.button.callback(
                `${settings.language === 'es' ? '✅ ' : ''}Español`, 
                'set_lang_es'
            ),
            Markup.button.callback(
                `${settings.language === 'ar' ? '✅ ' : ''}العربية`, 
                'set_lang_ar'
            ),
        ],
        // Speed Row
        [
            Markup.button.callback(
                `${settings.speed === 1.0 ? '✅ ' : ''}Normal Speed`, 
                'set_speed_1'
            ),
            Markup.button.callback(
                `${settings.speed === 0.5 ? '✅ ' : ''}Slow Speed`, 
                'set_speed_0.5'
            ),
        ],
        // Utility Row
        [
            Markup.button.callback('🔄 Reset Defaults', 'reset_settings')
        ]
    ]);
};

/**
 * Fetches audio buffer from Google TTS URL
 */
const fetchAudioBuffer = async (url) => {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
};

// --- Middleware & Error Handling ---

bot.use(async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        console.error(`❌ Error for user ${ctx.from?.id}:`, error.message);
        // Don't crash the bot, but notify user if possible
        if (ctx.callbackQuery) {
            ctx.answerCbQuery('⚠️ An error occurred. Please try again.');        } else {
            ctx.reply('⚠️ Something went wrong processing your request.');
        }
    }
});

// --- Command Handlers ---

bot.command('start', (ctx) => {
    ctx.reply(
        `👋 Hello <b>${ctx.from.first_name}</b>!\n\n` +
        `I am a professional Text-to-Speech bot.\n` +
        `Send me any text, and I will read it aloud.\n\n` +
        `Use /settings to change my voice language and speed.`,
        { parse_mode: 'HTML' }
    );
});

bot.command('settings', (ctx) => {
    ctx.reply('⚙️ <b>Bot Settings</b>\nChoose your preferences:', {
        parse_mode: 'HTML',
        reply_markup: createSettingsKeyboard(ctx.chat.id)
    });
});

bot.command('status', (ctx) => {
    const settings = getSettings(ctx.chat.id);
    ctx.reply(
        `📊 <b>Current Configuration</b>\n\n` +
        `🌐 Language: <code>${settings.language}</code>\n` +
        `⚡ Speed: <code>${settings.speed}x</code>`,
        { parse_mode: 'HTML' }
    );
});

// --- Action Handlers (Inline Buttons) ---

bot.action(/^set_lang_(en|fr|es|ar)$/, async (ctx) => {
    const lang = ctx.match[1];
    const chatId = ctx.chat.id;
    
    // Update State
    const settings = getSettings(chatId);
    settings.language = lang;
    userSettings.set(chatId, settings);

    // Feedback
    await ctx.answerCbQuery(`Language set to ${lang.toUpperCase()}!`);
    
    // Edit Message to reflect new state (Professional UX)    await ctx.editMessageText('⚙️ <b>Bot Settings</b>\nChoose your preferences:', {
        parse_mode: 'HTML',
        reply_markup: createSettingsKeyboard(chatId)
    });
});

bot.action(/^set_speed_(1|0.5)$/, async (ctx) => {
    const speed = parseFloat(ctx.match[1]);
    const chatId = ctx.chat.id;

    // Update State
    const settings = getSettings(chatId);
    settings.speed = speed;
    userSettings.set(chatId, settings);

    // Feedback
    const label = speed === 1.0 ? 'Normal' : 'Slow';
    await ctx.answerCbQuery(`Speed set to ${label}!`);

    // Edit Message
    await ctx.editMessageText('⚙️ <b>Bot Settings</b>\nChoose your preferences:', {
        parse_mode: 'HTML',
        reply_markup: createSettingsKeyboard(chatId)
    });
});

bot.action('reset_settings', async (ctx) => {
    const chatId = ctx.chat.id;
    userSettings.set(chatId, { ...DEFAULT_SETTINGS });
    
    await ctx.answerCbQuery('Settings reset to defaults!');
    await ctx.editMessageText('⚙️ <b>Bot Settings</b>\nChoose your preferences:', {
        parse_mode: 'HTML',
        reply_markup: createSettingsKeyboard(chatId)
    });
});

// --- Core TTS Logic ---

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    const settings = getSettings(chatId);

    // Basic Validation
    if (!text || text.trim().length === 0) return;
    if (text.length > 200) {
        return ctx.reply('⚠️ Text is too long. Please keep it under 200 characters for TTS.');
    }
    try {
        // 1. Show Typing Action
        await ctx.sendChatAction('upload_voice');

        // 2. Generate TTS URL
        // google-tts-api uses 'slow' boolean. 
        // If speed is 0.5, slow=true. If 1.0, slow=false.
        const isSlow = settings.speed === 0.5;
        
        const audioUrl = await googleTTS.getAudioUrl(text, {
            lang: settings.language,
            slow: isSlow,
            host: 'https://translate.google.com',
        });

        // 3. Download Audio Buffer
        const audioBuffer = await fetchAudioBuffer(audioUrl);

        // 4. Send Voice Message
        await ctx.replyWithVoice({ source: audioBuffer, filename: 'speech.mp3' });

        console.log(`✅ TTS Generated for ${chatId} (${settings.language})`);

    } catch (error) {
        console.error('TTS Generation Failed:', error.message);
        ctx.reply('❌ Failed to generate voice. Please try again later.');
    }
});

// --- Graceful Shutdown ---

const stop = (reason) => {
    console.log(`🛑 Stopping bot: ${reason}`);
    bot.stop(reason);
    process.exit(0);
};

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

// --- Launch ---

bot.launch().then(() => {
    console.log('🚀 Bot is running...');
}).catch(err => {
    console.error('Failed to launch bot:', err);
    process.exit(1);
});
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Bot is Alive!'));
app.listen(PORT, () => console.log(`Health check listening on port ${PORT}`));
      
