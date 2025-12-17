const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');

const app = express();

// --- CONFIGURATION ---
const PORT = 3000;
const DISCORD_CLIENT_ID = '1449920915981733948';
const DISCORD_CLIENT_SECRET = '-vI11L4jmkzKJJiglLMYnV2RmKb1Zf3Y';
const DISCORD_CALLBACK_URL = `https://vertexbot.co.uk/callback`;

// --- MYSQL CONNECTION ---
const pool = mysql.createPool({
    host: "db-ash-04.apollopanel.com",
    user: "u211392_Ci1WrqVvks",
    password: "NUuDgvN@VbGlvBgSFd^^g@hS",
    database: "s211392_Vertex-Database",
    port: 3306
});

// --- DISCORD AUTH SETUP ---
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

app.use(express.json());
app.use(session({ secret: 'vertex_secret_key', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// --- ROUTES ---

// 1. Auth Routes
app.get('/login', passport.authenticate('discord'));
app.get('/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/testingmadness/dashboard.html');
});

// 2. Get User's Manageable Servers
app.get('/api/user-servers', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    try {
        // SQL: Get all guilds that have an API setup
        const [dbServers] = await pool.query("SELECT guild_id FROM apisetup");
        const setupGuildIds = dbServers.map(s => s.guild_id);

        // Filter: Must be Admin (0x8) or Owner AND exist in MySQL
        const manageable = req.user.guilds.filter(guild => 
            ((guild.permissions & 0x8) || guild.owner) && setupGuildIds.includes(guild.id)
        );

        res.json(manageable);
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// 3. Fetch Players from Oxford API
app.get('/api/players/:guildId', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send("Unauthorized");

    try {
        // Python translate: SELECT server_id, api_key FROM apisetup WHERE guild_id = ?
        const [rows] = await pool.execute(
            "SELECT server_id, api_key FROM apisetup WHERE guild_id = ?", 
            [req.params.guildId]
        );

        if (rows.length === 0) return res.status(404).json({ error: "No setup found" });

        const { server_id, api_key } = rows[0];
        const response = await axios.get('https://api.oxfd.re/v1/server/players', {
            headers: { 'server-key': api_key, 'server-id': server_id }
        });
        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: "Oxford API Error" });
    }
});

// 4. Execute Command (Ban/Kick)
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

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Action failed" });
    }
});

// Serve the dashboard file
app.use('/testingmadness', (req, res, next) => {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}, express.static(path.join(__dirname, 'public/testingmadness')));

app.listen(PORT, () => console.log(`Vertex running on http://localhost:${PORT}`));
