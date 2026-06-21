const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ⚠️ Environment Variables
const NEW_BOT_TOKEN = process.env.NEW_BOT_TOKEN || process.env.BOT_TOKEN; 
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
const WEB_URL = process.env.WEB_URL; 
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;
const BOT_USERNAME = process.env.BOT_USERNAME || "thenegedrasbot"; 

const DB_FILE = path.join(__dirname, 'users.json');

// ተጠቃሚዎችን ከፋይል ማንበብ
function loadUsers() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) {
        return {};
    }
}

// ተጠቃሚዎችን ወደ ፋይል መጻፍ
function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

// 🔐 ፓስወርድ የመፍጠሪያ ፈንክሽን
function generatePassword(name, phone) {
    let cleanName = name.trim().replace(/\s+/g, '_');
    let cleanPhone = phone.trim();
    return `${cleanName}@${cleanPhone}`; 
}

// ቴሌግрам መልእክት መላኪያ ፈንክሽን
async function sendTelegram(method, data) {
    try {
        return await axios.post(`https://api.telegram.org/bot${NEW_BOT_TOKEN}/${method}`, data);
    } catch (error) {
        console.error(`Telegram API Error (${method}):`, error.response ? error.response.data : error.message);
    }
}

// 🔄 አገልገሎቱ ሲጀምር ከGoogle Sheet መረጃዎችን አውርዶ JSON ፋይሉን የማደሻ ፈንክሽን (Render ጥበቃ)
async function syncFromGoogleSheets() {
    if (!GOOGLE_SHEET_URL) return;
    try {
        console.log("🔄 Syncing database from Google Sheets to protect against Render restarts...");
        const response = await axios.post(GOOGLE_SHEET_URL, { action: "get_all_users" });
        if (response.data && response.data.success && response.data.users) {
            const googleUsers = response.data.users;
            const localUsers = loadUsers();
            
            // የጎግል ሺቱን ዳታ ወደ የአካባቢው JSON ፋይል ማዋሃድ
            Object.keys(googleUsers).forEach(uid => {
                if (!localUsers[uid]) localUsers[uid] = {};
                localUsers[uid].points = googleUsers[uid].points || 0;
                localUsers[uid].name = googleUsers[uid].name || localUsers[uid].name;
                localUsers[uid].username = googleUsers[uid].username || localUsers[uid].username;
                if (googleUsers[uid].invited_by) localUsers[uid].invited_by = googleUsers[uid].invited_by;
            });
            
            saveUsers(localUsers);
            console.log("✅ Database sync complete! Users secured.");
        }
    } catch (err) {
        console.error("❌ Sync from Google Sheets failed:", err.message);
    }
}

// የደንበኛ ሪፈራል መረጃዎችን ወደ Google Sheet መላኪያ
function syncUserToGoogle(userId, userData) {
    if (!GOOGLE_SHEET_URL) return;
    axios.post(GOOGLE_SHEET_URL, {
        action: "sync_user",
        user_id: userId,
        name: userData.name,
        username: userData.username,
        points: userData.points || 0,
        invited_by: userData.invited_by || ""
    }).catch(e => console.error("❌ Sync user to Google Error:", e.message));
}

// 1. ከዳሽንቦርዱ ትዕዛዝ ሲመጣ
app.post('/api/order', async (req, res) => {
    try {
        const data = req.body;
        const customerPassword = generatePassword(data.name, data.phone);
        
        const sheetData = { 
            ...data, 
            action: "new_order", 
            package_type: data.package_type, 
            customer_password: customerPassword 
        };

        if (GOOGLE_SHEET_URL) {
            axios.post(GOOGLE_SHEET_URL, sheetData)
                .then(() => console.log("✅ Data successfully synced with Google Sheets!"))
                .catch(err => console.error("❌ Google Sheets Sync Error:", err.message));
        }

        const users = loadUsers();
        if (data.user_id) {
            if (!users[data.user_id]) users[data.user_id] = {};
            users[data.user_id].generated_password = customerPassword;
            users[data.user_id].phone = data.phone;
            users[data.user_id].name = data.name; 
            users[data.user_id].purchased_package = data.package_type; 
            saveUsers(users);
        }

        const adminMsg = `🚨 <b>አዲስ የሽያጭ ትዕዛዝ መጥቷል!</b>\n\n` +
            `🔥 <b>የተገዛው ጥቅል (Package):</b> 🔴 <b>[ ${data.package_type ? data.package_type.toUpperCase() : "N/A"} ]</b> 🔴\n` +
            `🛍️ <b>ዝርዝር መግለጫ:</b> ${data.book_title || "N/A"}\n` +
            `👤 <b>በዳሽቦርድ የሞላው ስም:</b> ${data.name || "N/A"}\n` +
            `📞 <b>ስልክ:</b> <code>${data.phone || "N/A"}</code>\n` +
            `📧 <b>ኢሜል:</b> ${data.email || "N/A"}\n` +
            `✈️ <b>Telegram:</b> ${data.telegram_username || "N/A"}\n` +
            `💰 <b>ዋጋ:</b> ${data.price || "0"} ETB\n\n` +
            `🆔 <b>የደንበኛ ID:</b> <code>${data.user_id || "N/A"}</code>\n` +
            `📄 <b>የደረሰኝ ፎቶ:</b> <a href="${data.receipt_url}">እዚህ ይጫኑ</a>\n\n` +
            `🔐 <b>ለዚህ ደንበኛ የተፈጠረ ፓስወርድ:</b> <code>${customerPassword}</code>\n\n` +
            `────────────────────\n` +
            `📥 <b>ፋይሉን ለመላክ፦</b>\n` +
            `Caption ላይ: <code>/sendfile ${data.user_id} ${customerPassword}</code>\n\n` +
            `📥 <b>መለእክት ለመላክ (Hint: ለ${data.name || "ደንበኛ"})፦</b>\n` +
            `<code>/reply ${data.user_id} 👋 ሰላም ${data.name || "ደንበኛ"}፦ </code>`;

        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendPhoto', {
                chat_id: adminId,
                photo: data.receipt_url,
                caption: adminMsg,
                parse_mode: "HTML"
            }); 
        }

        if (data.user_id && data.user_id !== "N/A") {
            const customerSuccessMsg = `✅ <b>ትዕዛዝዎ በተሳካ ሁኔታ ወደ አድሚኑ ተልኳል!</b>\n\n` +
                `እባክዎን አድሚኑ የክፍያ ደረሰኝዎን አረጋግጦ በዚሁ ቦት በኩል መጽሐፉን (PDF) ወይም የቪዲዮ ስልጠና ሊንኮችን በ 12 ሰዓታት ውስጥ ይልክሎታል እስከዛ በትዕግስት ይጠብቁ。\n\n` +
                `ስላዘዙ እናመሰግናለን! 🙏\n\n` +
                `ነጋድራሱ `;
                
            await sendTelegram('sendMessage', {
                chat_id: data.user_id,
                text: customerSuccessMsg,
                parse_mode: "HTML"
            }); 
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Order processing error:", error);
        res.status(500).json({ success: false });
    }
});

// 2. ቴሌግራም ቦት ኮማንዶችን ለማስተናገድ (Webhook)
app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = msg.from.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    const users = loadUsers();
    
    // ቋሚ የኪቦርድ በተኖች መዋቅር
    const mainKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: "👥 የእኔ ሪፈራል ሊንክ" }, { text: "💰 የእኔ ባላንስ" }],
                [{ text: "📥 ብር ማውጫ (Withdraw)" }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    // --- ደረጃ በደረጃ የደንበኛውን የቴሌብር መልስ መቀበያ ሎጂክ ---
    if (users[userId] && users[userId].withdraw_step) {
        const step = users[userId].withdraw_step;

        // የቴሌብር ስልክ ቁጥር ሲያስገቡ
        if (step === "awaiting_telebirr_phone") {
            users[userId].temp_telebirr = text.trim();
            users[userId].withdraw_step = "awaiting_payout_name";
            saveUsers(users);

            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `👤 <b>ደረጃ 2/2፦ ሙሉ ስም</b>\n\nበጣም ጥሩ። አሁን ደግሞ በቴሌብር አካውንቱ ላይ ያለውን የእርስዎን ሙሉ ስም ያስገቡ፦`, 
                parse_mode: "HTML" 
            });
            return res.sendStatus(200);
        } 
        // ሙሉ ስም ሲያስገቡ (የመጨረሻ ደረጃ)
        else if (step === "awaiting_payout_name") {
            const currentPoints = users[userId].points || 0;
            const telebirrPhone = users[userId].temp_telebirr;
            const fullName = text.trim();
            
            const fullDetails = `የክፍያ መንገድ: ቴሌብር (telebirr) , ስልክ: ${telebirrPhone} , ስም: ${fullName}`;

            // 1. ለአድሚኑ (ለአንተ) በቴሌግራም መልእክት መላክ
            for (const adminId of ADMIN_IDS) {
                await sendTelegram('sendMessage', {
                    chat_id: adminId,
                    text: `💰 <b>አዲስ የቴሌብር ክፍያ ጥያቄ (Payout Request)!</b>\n\n` +
                          `👤 <b>ከደንበኛ:</b> ${msg.from.first_name}\n` +
                          `🆔 <b>ID:</b> <code>${userId}</code>\n` +
                          `💵 <b>የሚወጣው መጠን:</b> <b>${currentPoints} ETB</b>\n` +
                          `📱 <b>የቴሌብር ስልክ:</b> <code>${telebirrPhone}</code>\n` +
                          `👤 <b>የአካውንቱ ስም:</b> ${fullName}\n\n` +
                          `────────────────────\n` +
                          `ብሩን በቴሌብር ከላክህ በኋላ ለደንበኛው ለማሳወቅ፦\n` +
                          `<code>/reply ${userId} 👋 ሰላም የጠየቁት የ ${currentPoints} ብር የቴሌብር ክፍያ በቁጥርዎ (${telebirrPhone}) ተልኳል! እናመሰግናለን።</code>`,
                    parse_mode: "HTML"
                });
            }

            // 2. ወደ Google Sheets (Payouts ታብ) መላክ
            if (GOOGLE_SHEET_URL) {
                axios.post(GOOGLE_SHEET_URL, {
                    action: "payout_request",
                    user_id: userId,
                    name: msg.from.first_name,
                    amount: currentPoints,
                    bank_details: fullDetails
                }).catch(e => console.error(e.message));
            }

            // መረጃዎቹን በደህንነት ማጽዳት እና ባላንስን 0 ማድረግ
            users[userId].points = 0;
            delete users[userId].withdraw_step;
            delete users[userId].temp_telebirr;
            saveUsers(users);
            syncUserToGoogle(userId, users[userId]);

            // ለተጠቃሚው ማጠናቀቂያ መልእክት መላክ እና ዋናውን ኪቦርድ መመለስ
            await sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `✅ <b>የክፍያ ጥያቄዎ በተሳካ ሁኔታ ተመዝግቧል!</b>\n\nየቴሌብር መረጃዎ ለአድሚኑ ደርሷል። በዛሬው እለት ተጣርቶ በቴሌብር አካውንትዎ ይላክልዎታል። እናመሰግናለን!`,
                parse_mode: "HTML",
                ...mainKeyboard
            });
            return res.sendStatus(200);
        }
    }

    // አዲስ ተጠቃሚ መመዝገብ ወይም ማደስ
    if (!users[userId]) {
        users[userId] = { 
            name: msg.from.first_name, 
            username: msg.from.username || "N/A", 
            points: 0,
            joined_at: new Date().toLocaleString() 
        };

        // የሪፈራል ሊንክ መፈተሻ ሎጂክ (/start ref_xxxx)
        if (text.startsWith("/start ref_")) {
            const inviterId = text.split("_")[1];
            if (inviterId && inviterId !== userId && users[inviterId]) {
                users[userId].invited_by = inviterId;
                // ለጋባዡ ሰው ማሳወቂያ መላክ
                await sendTelegram('sendMessage', {
                    chat_id: inviterId,
                    text: `🔔 <b>አዲስ ግብዣ!</b>\n\n${msg.from.first_name} በእርስዎ ሊንክ ቦቱን ጀምሯል። መጽሐፉን ሲገዛ <b>50 ፖይንት (50 ብር)</b> አካውንትዎ ላይ ይጨመራል!`,
                    parse_mode: "HTML"
                });
            }
        }
        saveUsers(users);
        syncUserToGoogle(userId, users[userId]);
    } else {
        users[userId].name = msg.from.first_name;
        if (msg.from.username) users[userId].username = msg.from.username;
        if (users[userId].points === undefined) users[userId].points = 0;
        saveUsers(users);
    }

    // --- የ /start ኮማንድ ---
    if (text.startsWith("/start")) {
        const welcomeText = `📚 <b>እንኳን ወደ ነጋድራሱ በሰላም መጡ፣ ${msg.from.first_name}!</b> 👋🌟\n\n` +
            `<i>"የዛሬው አድዋ የኢኮኖሚ አድዋ ነው።"</i>\n\n` +
            `ይህ ቦት በናትናኤል ብሩክ የተዘጋጀውን የትሬዲንግ ስነ-ልቦና መቆጣጠሪያ <b>"ነጋድራሱ"</b> መጽሐፍ እና የቪዲዮ ስልጠናዎችን በይፋ የሚያገኙበት ቦታ ነው።\n\n` +
            `🔥 <b>የእኛ የሽያጭ አማራጮች (Packages)፦</b>\n\n` +
            `1️⃣ <b>"ነጋድራሱ" መጽሐፍ (PDF) ብቻ</b>\n` +
            `2️⃣ <b>በቅርብ ቀን (coming soon)30 ምርጥ የቪዲዮዎች ጥቅል (Videos Bundle)</b>\n` +
            `3️⃣ <b>በቅርብ ቀን (coming soon)ሁለቱንም በአንድ ላይ (መጽሐፍ + 30 ቪዲዮዎች)</b>\n` +
            
            `────────────────────\n\n` +
            `⚠️ <b>የአጠቃቀም መመሪያ፦</b>\n` +
            `• ከላይ ካሉት አማራጮች የፈለጉትን ለመምረጥ እና ትዕዛዝ ለመላክ ከታች በግራ በኩል ያለውን <b>'📚 order'</b> የሚለውን <b>Menu Button</b> ይጫኑ。\n` +
            `• ሰዎችን በመጋበዝ በሰው 50 ብር ለመስራት ከታች ያሉትን የሪፈራል በተኖች ይጠቀሙ!`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: "HTML",
            ...mainKeyboard
        });
        return res.sendStatus(200);
    }

    // --- 👥 ሪፈራል እና ባላንስ በተኖች አያያዝ ---
    else if (text === "👥 የእኔ ሪፈራል ሊንክ") {
        const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`; 
        
        const refText = `👥 <b>የእርስዎ መጋበዣ ሊንክ (Referral Link)</b>\n\n` +
            `ይህንን ሊንክ ለጓደኞችዎ ወይም በየግሩፑ በማጋራት፣ በእርስዎ ሊንክ ገብተው መጽሐፉን በሚገዙት እያንዳንዱ ሰው <b>50 ብር (50 ፖይንት)</b> ያግኙ!💰\n\n` +
            `🔗 <b>የእርስዎ ሊንክ፦</b>\n<code>${refLink}</code>`;
            
        await sendTelegram('sendMessage', { chat_id: chatId, text: refText, parse_mode: "HTML", ...mainKeyboard });
        return res.sendStatus(200);
    }

    else if (text === "💰 የእኔ ባላንስ") {
        const currentPoints = users[userId].points || 0;
        const balanceText = `💰 <b>የአካውንትዎ ይዘት (Balance)</b>\n\n` +
            `👤 <b>ስም:</b> ${msg.from.first_name}\n` +
            `💵 <b>ያለዎት ጠቅላላ ፖይንት:</b> <code>${currentPoints} ፖይንት (${currentPoints} ብር)</code>\n\n` +
            `<i>*ማሳሰቢያ: ክፍያ ለመጠየቅ ቢያንስ 50 ፖይንት ሊኖርዎት ይገባል።*</i>`;
            
        await sendTelegram('sendMessage', { chat_id: chatId, text: balanceText, parse_mode: "HTML", ...mainKeyboard });
        return res.sendStatus(200);
    }

    // --- 📥 ብር ማውጫ (Withdraw) በተን መጫን ---
    else if (text === "📥 ብር ማውጫ (Withdraw)") {
        const currentPoints = users[userId].points || 0;
        const today = new Date().getDay(); 
        
        if (today !== 0) { 
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `📅 <b>የክፍያ ቀን አይደለም!</b>\n\nየሪፈራል ክፍያ መጠየቅ የሚቻለው <b>እሁድ ቀን ብቻ</b> ነው። እባክዎን እሁድ ቀን ማለዳ ላይ መጥተው ይጠይቁ። እናመሰግናለን! 🙏`, 
                parse_mode: "HTML",
                ...mainKeyboard 
            });
        } 
        else if (currentPoints < 50) { 
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `❌ <b>ይቅርታ፣ ማውጣት አይችሉም!</b>\n\nየያዙት መጠን <code>${currentPoints} ብር</code> ነው። ክፍያ ለመጠየቅ ቢያንስ <b>50 ብር</b> ሊኖርዎት ይገባል። ሰዎችን በመጋበዝ ማሳደግ ይችላሉ!`, 
                parse_mode: "HTML",
                ...mainKeyboard 
            });
        } 
        else {
            users[userId].withdraw_step = "awaiting_telebirr_phone";
            saveUsers(users);
            
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `📱 <b>ደረጃ 1/2፦ የቴሌብር ስልክ ቁጥር</b>\n\nእባክዎን ብሩ እንዲላክበት የሚፈልጉትን የ <b>ቴሌብር (telebirr)</b> ስልክ ቁጥርዎን ብቻ ይጻፉልን፦`, 
                parse_mode: "HTML",
                reply_markup: { remove_keyboard: true } 
            });
        }
        return res.sendStatus(200);
    }

    // --- የአድሚን ኮማንዶች ---
    if (isAdmin) {
       if (text === "/users") {
            const userKeys = Object.keys(users);
            if (userKeys.length === 0) {
                await sendTelegram('sendMessage', { chat_id: chatId, text: "👥 እስካሁን የተመዘገበ ተጠቃሚ የለም。" });
            } else {
                await sendTelegram('sendMessage', { chat_id: chatId, text: `👥 <b>የተጠቃሚዎች ዝርዝር በመላክ ላይ ነው... (ጠቅላላ፡ ${userKeys.length})</b>`, parse_mode: "HTML" });
                
                let userListMsg = "";
                let batchSize = 15; // ቴሌግራም እንዳይዘጋው በየ 15 ሰው ከፍለን እንልካለን
                
                userKeys.forEach((uid, index) => {
                    const uName = users[uid].name || "ስም የሌለው";
                    const uPackage = users[uid].purchased_package ? ` [🛍️ ${users[uid].purchased_package}]` : ""; 
                    const uUser = users[uid].username !== "N/A" ? `@${users[uid].username}` : "ዩዘርኔም የሌለው";
                    
                    userListMsg += `${index + 1}. 👤 <b>${uName}</b>${uPackage} - ${uUser}\n🆔 <code>${uid}</code>\n💵 ፖይንት: ${users[uid].points || 0}\n────────────────────\n`;
                    
                    // 15 ሰው በሞላ ቁጥር መልእክቱን ልኮ አዲሱን ይጀምራል
                    if ((index + 1) % batchSize === 0 || (index + 1) === userKeys.length) {
                        sendTelegram('sendMessage', { chat_id: chatId, text: userListMsg, parse_mode: "HTML" });
                        userListMsg = ""; // መልእክቱን ባዶ ማድረግ ለቀጣዩ ዝርዝር
                    }
                });
            }
            return res.sendStatus(200); 
        }
        else if (text.startsWith("/broadcast ")) {
            const broadcastMsg = text.replace("/broadcast ", "");
            
            // 🚨 1. ለቴሌግራም ወዲያውኑ "እሺ ደርሶኛል" ብሎ መመለስ (ይህ መልእክቱ ድጋሚ እንዳይመጣ ይከላከላል)
            res.sendStatus(200); 

            // 🚨 2. የማሰራጨት ስራውን በጀርባ (Background) በራሱ ፍጥነት እንዲያከናውን ማድረግ
            (async () => {
                let allUniqueIds = new Set(Object.keys(users)); 

                if (GOOGLE_SHEET_URL) {
                    try {
                        const response = await axios.post(GOOGLE_SHEET_URL, { action: "get_all_users" });
                        if (response.data && response.data.success && response.data.users) {
                            const googleUsers = response.data.users;
                            Object.keys(googleUsers).forEach(uid => {
                                if (uid && uid !== "N/A") allUniqueIds.add(uid.toString());
                            });
                        }
                    } catch (err) {
                        console.error("⚠️ Broadcast sync from Google Sheets failed, using local file only:", err.message);
                    }
                }

                let count = 0;
                let failedCount = 0;
                
                // ለላከው አድሚን መላክ መጀመሩን በቦቱ ማሳወቅ
                await sendTelegram('sendMessage', { chat_id: chatId, text: `⏳ ብሮድካስት መላክ ተጀምሯል... ለ ${allUniqueIds.size} ተጠቃሚዎች በመላክ ላይ ነው።` });

                for (const uid of allUniqueIds) {
                    if (uid && uid !== "N/A") { 
                        try {
                            await sendTelegram('sendMessage', { 
                                chat_id: uid, 
                                text: `📢 <b>ማስታወቂያ ከነጋድራሱ</b>\n\n${broadcastMsg}\n\nነጋድራሱ`, 
                                parse_mode: "HTML" 
                            });
                            count++;
                            // በቴሌግራም ፍጥነት ገደብ (Rate Limit) እንዳይቆለፍ በየመልእክቱ መሃል 50ms ማረፍ
                            await new Promise(resolve => setTimeout(resolve, 50)); 
                        } catch (e) {
                            failedCount++;
                        }
                    }
                }
                
                // ሁሉም ተልኮ ሲያልቅ ማጠቃለያውን አንድ ጊዜ ብቻ መላክ
                await sendTelegram('sendMessage', { 
                    chat_id: chatId, 
                    text: `✅ <b>ብሮድካስት ተጠናቋል!</b>\n\n🎯 በተሳካ ሁኔታ የደረሳቸው፦ <b>${count}</b>\n❌ ያልደረሳቸው (ቦቱን ብሎክ ያደረጉ/ያጠፉ)፦ <b>${failedCount}</b>`,
                    parse_mode: "HTML"
                });
            })().catch(err => console.error("⚠️ Background broadcast error:", err));

            return; // የ do-post ሎጂክ እዚህ ላይ ያበቃል
        }
        else if (text.startsWith("/referral ")) {
            const targetId = text.replace("/referral ", "").trim();
            
            if (!targetId || isNaN(targetId)) {
                await sendTelegram('sendMessage', { 
                    chat_id: chatId, 
                    text: "❌ <b>ስህተት!</b> እባክህ ነጋድራሱ የተጠቃሚውን ID በትክክል አስገባ。\nምሳሌ፦ <code>/referral 123456789</code>",
                    parse_mode: "HTML"
                });
                return res.sendStatus(200);
            }

            if (users[targetId]) {
                const uName = users[targetId].name || "ስም የሌለው";
                const uUsername = users[targetId].username !== "N/A" ? `@${users[targetId].username}` : "ዩዘርኔም የለውም";
                const uPoints = users[targetId].points || 0;
                const inviterId = users[targetId].invited_by || "በቀጥታ ነው የገባው (ማንም አልጋበዘውም)";

                let inviterDetails = inviterId;
                if (users[inviterId]) {
                    inviterDetails = `👤 <b>${users[inviterId].name}</b> (🆔 <code>${inviterId}</code>)`;
                }

                const infoMsg = `🔍 <b>የተጠቃሚው የሪፈራል መረጃ፦</b>\n\n` +
                    `👤 <b>ስም፦</b> ${uName}\n` +
                    `✈️ <b>Username፦</b> ${uUsername}\n` +
                    `🆔 <b>User ID፦</b> <code>${targetId}</code>\n` +
                    `💰 <b>ያለው ባላንስ (ፖይንት)፦</b> <code>${uPoints} ፖይንት (${uPoints} ብር)</code>\n` +
                    `🔗 <b>የጋበዘው ሰው (Invited By)፦</b> ${inviterDetails}`;

                await sendTelegram('sendMessage', { chat_id: chatId, text: infoMsg, parse_mode: "HTML" });
            } else {
                await sendTelegram('sendMessage', { 
                    chat_id: chatId, 
                    text: `❌ <b>ይቅርታ!</b> ID <code>${targetId}</code> ያለው ተጠቃሚ በቦቱ ዳታቤዝ ውስጥ አልተገኘም።`,
                    parse_mode: "HTML"
                });
            }
            return res.sendStatus(200); 
        }

        // ✨ 🛠️ አዲሱ ባለ ፎቶ እና ጽሑፍ የጋራ /reply ሎጂክ እዚህ ጋር ገብቷል!
        else if (text.startsWith("/reply ") || (msg.photo && msg.caption && msg.caption.startsWith("/reply "))) {
            const isPhoto = msg.photo ? true : false;
            const captionOrText = isPhoto ? msg.caption : text;
            
            const parts = captionOrText.split(" ");
            const targetId = parts[1];
            
            let replyText = captionOrText.replace(`/reply ${targetId} `, "");
            
            if (!targetId || isNaN(targetId)) {
                await sendTelegram('sendMessage', { 
                    chat_id: chatId, 
                    text: "❌ <b>ስህተት!</b> እባክህ የተጠቃሚውን ID በትክክል አስገባ።\nምሳሌ፦ <code>/reply 123456789 መልእክትህ...</code>",
                    parse_mode: "HTML"
                });
                return res.sendStatus(200);
            }

            let telegramName = "ተጠቃሚ";
            try {
                if (users[targetId] && users[targetId].name) telegramName = users[targetId].name;
            } catch (e) {}

            const formattedMsg = `📩 <b>ከነጋድራሱ የተላከ ምላሽ:</b>\n\n${replyText}\n\nነጋድራሱ`;

            if (isPhoto) {
                const highestResPhoto = msg.photo[msg.photo.length - 1].file_id;
                await sendTelegram('sendPhoto', {
                    chat_id: targetId,
                    photo: highestResPhoto,
                    caption: formattedMsg,
                    parse_mode: "HTML"
                });
            } else {
                await sendTelegram('sendMessage', { 
                    chat_id: targetId, 
                    text: formattedMsg, 
                    parse_mode: "HTML" 
                });
            }
            
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ምላሹ (በ${isPhoto ? "ፎቶ" : "ጽሑፍ"}) ለደንበኛ <b>${telegramName}</b> (<code>${targetId}</code>) ተልኳል።`,
                parse_mode: "HTML" 
            });
            return res.sendStatus(200);
        }

        else if (text === "/stats") {
            // 1. በአካባቢው ፋይል ውስጥ ያሉትን IDs መውሰድ
            let allUniqueIds = new Set(Object.keys(users)); 

            // 2. ከGoogle Sheets ላይ ያሉትንም IDs መጨመር
            if (GOOGLE_SHEET_URL) {
                try {
                    const response = await axios.post(GOOGLE_SHEET_URL, { action: "get_all_users" });
                    if (response.data && response.data.success && response.data.users) {
                        const googleUsers = response.data.users;
                        Object.keys(googleUsers).forEach(uid => {
                            if (uid && uid !== "N/A") allUniqueIds.add(uid.toString());
                        });
                    }
                } catch (err) {
                    console.error("⚠️ Stats sync from Google Sheets failed:", err.message);
                }
            }

            // 3. እውነተኛውን ጠቅላላ ድምር ማሳየት
            const totalUsers = allUniqueIds.size;
            const statsMsg = `📊 <b>የነጋድራሱ ቦት እውነተኛ ስታቲስቲክስ:</b>\n\n` +
                             `👥 <b>ጠቅላላ እውነተኛ ተጠቃሚዎች፦</b> <code>${totalUsers} ሰው</code>\n` +
                             `<i>(ይህ ቁጥር የገዙትን፣ በሪፈራል የገቡትንና በ Users ታብ ያሉትን በሙሉ ያጠቃልላል)</i>`;

            await sendTelegram('sendMessage', { chat_id: chatId, text: statsMsg, parse_mode: "HTML" });
            return res.sendStatus(200); 
        }

        // 📥 የፋይል መላኪያ 
        else if (msg.document && msg.caption && msg.caption.startsWith("/sendfile ")) {
            const parts = msg.caption.trim().split(/\s+/);
            const targetId = parts[1];
            const inputPassword = parts[2]; 
            
            if (!targetId || !inputPassword) {
                await sendTelegram('sendMessage', { 
                    chat_id: chatId, 
                    text: `❌ <b>ስህተት!</b> እባክህ አጻጻፉን አስተካክል፦\n<code>/sendfile [ID] [ፓስወርድ]</code>` ,
                    parse_mode: "HTML"
                });
                return res.sendStatus(200);
            }

            let telegramName = "ተጠቃሚ";
            try {
                if (users[targetId] && users[targetId].name) telegramName = users[targetId].name;
            } catch (e) {}

            if (users[targetId] && users[targetId].invited_by) {
                const inviterId = users[targetId].invited_by;
                if (users[inviterId]) {
                    users[inviterId].points = (users[inviterId].points || 0) + 50;
                    saveUsers(users);
                    syncUserToGoogle(inviterId, users[inviterId]);

                    await sendTelegram('sendMessage', {
                        chat_id: inviterId,
                        text: `🎉 <b>እንኳን ደስ አለዎት!</b>\n\nእርስዎ የጋበዙት ደንበኛ (<b>${telegramName}</b>) መጽሐፉን ስለገዙ <b>50 ብር (50 ፖይንት)</b> አካውንትዎ ላይ ተጨምሯል!`,
                        parse_mode: "HTML"
                    });
                }
            }

            const warningMsg = `📩 <b>ከነጋድራሱ የተላከ መጽሐፍ:</b>\n\n` +
                `ስላዘዙ እናመሰግናለን! የ"ነጋድራሱ" መጽሐፍ (PDF)。\n\n` +
                `🔐 <b>የእርስዎ መክፈቻ ፓስወርድ (Password)፦</b> <code>${inputPassword}</code>\n\n` +
                `⚠️ <b>ማስጠንቀቂያ:</b> ይህ መጽሐፍ በባለቤትነት መብት የተጠበቀ እና የእርስዎ ስም እና ስልክ ቁጥር በፒዲኤፉ ውስጥ ተካቶ በፓስወርድ የተቆለፈ ነው። ለሌላ ሰው ማጋራት、ማሰራጨት ወይም መሸጥ በጥብቅ የተከለከለ እና በሕግም የሚያስቀጣ ይሆናል።\n\n` +
                `ነጋድራሱ`;
                
            await sendTelegram('sendDocument', {
                chat_id: targetId,
                document: msg.document.file_id,
                caption: warningMsg,
                parse_mode: "HTML"
            });
            
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ፋይሉ ለደንበኛ <b>${telegramName}</b> ተልኳል። የሪፈራል ቼክም ተከናውኗል።`,
                parse_mode: "HTML"
            });
            return res.sendStatus(200); 
        }
    }

    // --- ተራ ደንበኛ መልእክት ሲልክ ብቻ (አድሚን ካልሆነ) ---
    if (!text.startsWith("/")) {
        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: `📬 <b>አዲስ መልእክት ከደንበኛ!</b>\n\n` +
                      `👤 <b>የቴሌግራም ስም:</b> ${msg.from.first_name}\n` +
                      `✈ *Username:* ${msg.from.username ? '@'+msg.from.username : "የለውም"}\n` +
                      `🆔 <b>ID:</b> <code>${userId}</code>\n\n` +
                      `💬 <b>መልእክት:</b> ${text}\n\n` +
                      `────────────────────\n` +
                      `📥 <b>ለ${msg.from.first_name} ምላሽ ለመስጠት፦</b>\n` +
                      `<code>/reply ${userId} 👋 ሰላም ${msg.from.first_name}፦ </code>`,
                parse_mode: "HTML"
            });
        }
        await sendTelegram('sendMessage', { chat_id: chatId, text: "መልእክትዎ ደርሷል! እናመሰግናለን。" });
    }

    res.sendStatus(200);
});

// 3. Webhook ለማገናኘት
app.get('/api/set-webhook', async (req, res) => {
    const webhookUrl = `${WEB_URL}/api/telegram-webhook`;
    const response = await axios.get(`https://api.telegram.org/bot${NEW_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    res.json(response.data);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Keep-Alive Setup ---
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;
setInterval(async () => {
    if (WEB_URL) {
        try {
            const response = await axios.get(`${WEB_URL}`);
            console.log(`🤖 Keep-Alive Ping Sent! Status: ${response.status}`);
        } catch (error) {
            console.error("❌ Keep-Alive Ping Failed:", error.message);
        }
    }
}, KEEP_ALIVE_INTERVAL);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    setTimeout(syncFromGoogleSheets, 5000);
});
