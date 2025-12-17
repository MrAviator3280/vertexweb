const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();

// 1. MySQL Connection (Using your Apollo Panel credentials)
const pool = mysql.createPool({
    host: "db-ash-04.apollopanel.com",
    user: "u211392_Ci1WrqVvks",
    password: "NUuDgvN@VbGlvBgSFd^^g@hS",
    database: "s211392_Vertex-Database",
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10
});

app.use(express.json());
app.use(session({ secret: 'vertex_secret', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// 2. Fetching manageable servers
app.get('/api/my-servers', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Login required" });

    try {
        // Translate Python: SELECT server_id, api_key FROM apisetup WHERE guild_id = ?
        const [dbServers] = await pool.query("SELECT guild_id FROM apisetup");
        const dbGuildIds = dbServers.map(s => s.guild_id);

        // Filter Discord guilds where user is Admin (0x8) or Owner AND is in our DB
        const manageable = req.user.guilds.filter(guild => 
            (guild.permissions & 0x8 || guild.owner) && dbGuildIds.includes(guild.id)
        );

        res.json(manageable);
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// 3. Get Players (GET /v1/server/players)
app.get('/api/players/:guildId', async (req, res) => {
    try {
        // Translation of your Python query
        const [rows] = await pool.execute(
            "SELECT server_id, api_key FROM apisetup WHERE guild_id = ?", 
            [req.params.guildId]
        );

        if (rows.length === 0) return res.status(404).json({ error: "API not setup for this guild" });

        const { server_id, api_key } = rows[0];

        const response = await axios.get('https://api.oxfd.re/v1/server/players', {
            headers: {
                'server-key': api_key,
                'server-id': server_id,
                'Accept': '*/*'
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch from Oxford" });
    }
});

// 4. Run Command (POST /v1/server/command)
app.post('/api/execute', async (req, res) => {
    const { guildId, type, target, reason } = req.body;

    try {
        const [rows] = await pool.execute(
            "SELECT server_id, api_key FROM apisetup WHERE guild_id = ?", 
            [guildId]
        );

        const { server_id, api_key } = rows[0];
        const fullCommand = `${type} ${target} ${reason}`;

        const response = await axios.post('https://api.oxfd.re/v1/server/command', 
            { command: fullCommand },
            {
                headers: {
                    'server-key': api_key,
                    'server-id': server_id,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({ message: `Executed: ${fullCommand}` });
    } catch (error) {
        res.status(500).json({ error: "Action failed" });
    }
});

app.listen(3000, () => console.log("Vertex Backend Online"));
