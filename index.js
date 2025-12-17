const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
app.use(express.json());

// MySQL Connection using your Apollo Panel credentials
const pool = mysql.createPool({
    host: "db-ash-04.apollopanel.com",
    user: "u211392_Ci1WrqVvks",
    password: "NUuDgvN@VbGlvBgSFd^^g@hS",
    database: "s211392_Vertex-Database",
    port: 3306
});

// --- DISCORD AUTH LOGIC ---
passport.use(new DiscordStrategy({
    clientID: 'YOUR_DISCORD_CLIENT_ID',
    clientSecret: 'YOUR_DISCORD_CLIENT_SECRET',
    callbackURL: 'http://localhost:3000/callback',
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// --- API ROUTES ---

// 1. Get list of servers where user is Admin/Owner AND linked in DB
app.get('/api/user-servers', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    try {
        // Get all servers currently linked in your MySQL database
        const [dbServers] = await pool.query("SELECT guild_id, server_id FROM servers");
        
        // Filter Discord guilds: Must have Admin (0x8) or be Owner
        const manageable = req.user.guilds.filter(guild => {
            const isAuthorized = (guild.permissions & 0x8) || guild.owner;
            const isLinked = dbServers.some(db => db.guild_id === guild.id);
            return isAuthorized && isLinked;
        });

        res.json(manageable);
    } catch (err) {
        res.status(500).json({ error: "DB Error" });
    }
});

// 2. Fetch Live Players from Oxford API
app.get('/api/players/:guildId', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT server_id, api_key FROM servers WHERE guild_id = ?", [req.params.guildId]);
        if (rows.length === 0) return res.status(404).json({ error: "Server not configured" });

        const response = await axios.get('https://api.oxfd.re/v1/server/players', {
            headers: {
                'server-key': rows[0].api_key,
                'server-id': rows[0].server_id,
                'Accept': '*/*'
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Oxford API unreachable" });
    }
});

// 3. Execute Ban/Kick Command
app.post('/api/execute-command', async (req, res) => {
    const { guildId, type, targetUser, reason } = req.body;

    try {
        const [rows] = await pool.query("SELECT server_id, api_key FROM servers WHERE guild_id = ?", [guildId]);
        const server = rows[0];

        // Format: "ban PlayerName Reason" or "kick PlayerName Reason"
        const fullCommand = `${type} ${targetUser} ${reason}`;

        const response = await axios.post('https://api.oxfd.re/v1/server/command', 
        { command: fullCommand }, 
        {
            headers: {
                'server-key': server.api_key,
                'server-id': server.server_id,
                'Content-Type': 'application/json'
            }
        });

        res.json({ success: true, message: `Successfully executed: ${fullCommand}` });
    } catch (error) {
        res.status(500).json({ error: "Command failed" });
    }
});

app.listen(3000, () => console.log("Vertex Server Running"));
