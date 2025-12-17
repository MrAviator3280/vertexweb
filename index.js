const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');

const app = express();

// --- 1. CONFIGURATION (Change these to your real Bot details) ---
const CONFIG = {
    PORT: 3000,
    CLIENT_ID: '1449920915981733948',
    CLIENT_SECRET: '-vI11L4jmkzKJJiglLMYnV2RmKb1Zf3Y',
    CALLBACK_URL: 'https://vertexbot.co.uk/callback' 
};

// --- 2. MYSQL CONNECTION (Using your Apollo Panel DB) ---
const pool = mysql.createPool({
    host: "db-ash-04.apollopanel.com",
    user: "u211392_Ci1WrqVvks",
    password: "NUuDgvN@VbGlvBgSFd^^g@hS",
    database: "s211392_Vertex-Database",
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10
});

// --- 3. DISCORD OAUTH2 SETUP ---
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: CONFIG.CLIENT_ID,
    clientSecret: CONFIG.CLIENT_SECRET,
    callbackURL: CONFIG.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    // profile contains the user's guilds and ID
    process.nextTick(() => done(null, profile));
}));

// --- 4. MIDDLEWARE ---
app.use(express.json());
app.use(session({
    secret: 'vertex_secure_session_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));
app.use(passport.initialize());
app.use(passport.session());

// --- 5. AUTHENTICATION ROUTES ---

// Initial Login trigger
app.get('/login', passport.authenticate('discord'));

// The callback Discord sends the user to after they authorize
app.get('/callback', passport.authenticate('discord', { 
    failureRedirect: '/' 
}), (req, res) => {
    res.redirect('/testingmadness/dashboard.html');
});

// --- 6. DASHBOARD API ROUTES ---

// GET: Manageable Servers (Filtered by Admin perms & DB existence)
app.get('/api/user-servers', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    try {
        // Get all guilds from your apisetup table
        const [dbServers] = await pool.query("SELECT guild_id FROM apisetup");
        const activeGuildIds = dbServers.map(s => s.guild_id);

        // Filter user guilds: Must have Admin (0x8) or be Owner, and exist in DB
        const manageable = req.user.guilds.filter(guild => {
            const hasPerms = (guild.permissions & 0x8) || guild.owner;
            return hasPerms && activeGuildIds.includes(guild.id);
        });

        res.json(manageable);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

// GET: Live Players for a specific guild
app.get('/api/players/:guildId', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send("Unauthorized");

    try {
        const [rows] = await pool.execute(
            "SELECT server_id, api_key FROM apisetup WHERE guild_id = ?", 
            [req.params.guildId]
        );

        if (rows.length === 0) return res.status(404).json({ error: "No API setup found" });

        const { server_id, api_key } = rows[0];
        const response = await axios.get('https://api.oxfd.re/v1/server/players', {
            headers: { 'server-key': api_key, 'server-id': server_id }
        });
        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: "Oxford API unreachable" });
    }
});

// POST: Run Command (Ban/Kick)
app.post('/api/execute-command', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send("Unauthorized");
    const { guildId, type, targetUser, reason } = req.body;

    try {
        const [rows] = await pool.execute(
            "SELECT server_id, api_key FROM apisetup WHERE guild_id = ?", 
            [guildId]
        );

        const { server_id, api_key } = rows[0];
        const fullCommand = `${type} ${targetUser} ${reason}`;

        await axios.post('https://api.oxfd.re/v1/server/command', 
            { command: fullCommand },
            { headers: { 'server-key': api_key, 'server-id': server_id, 'Content-Type': 'application/json' }}
        );

        res.json({ success: true, message: `Command ${type} sent.` });
    } catch (err) {
        res.status(500).json({ error: "Command execution failed" });
    }
});

// --- 7. FILE SERVING & AUTH GUARD ---

// Protect the dashboard path
app.get('/testingmadness/dashboard.html', (req, res, next) => {
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, '/testingmadness/dashboard.html'));
    } else {
        res.redirect('/login');
    }
});

// Static folder for assets (css, images, etc.)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(CONFIG.PORT, () => {
    console.log(`Vertex Backend running on port ${CONFIG.PORT}`);
});
