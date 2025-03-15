const express = require("express");
const app = express();
const path = require("path");
const axios = require("axios");
const mysql = require("mysql");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const dotenv = require("dotenv");
const fs = require('fs');

require("dotenv").config();  // This loads the environment variables from the .env file

const port = 3000;

// Database connection with error handling
const db = mysql.createPool({
    host: "38.22.104.155",
    user: "u4464_d7d28C6qcy",
    password: "rs7.v00aJuSLvI!+1D+oi=IM",
    database: "s4464_test",
    connectionLimit: 10,
});

db.getConnection((err) => {
    if (err) {
        console.error("Database connection failed:", err);
    } else {
        console.log("Connected to MySQL database.");
    }
});

// Middleware
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(csurf({ cookie: true }));

// User session middleware
// User session middleware
app.use((req, res, next) => {
    const sessionToken = req.cookies.session_token;
    if (sessionToken) {
        db.query(
            "SELECT * FROM users WHERE session_cookie = ?",
            [sessionToken],
            (err, results) => {
                if (!err && results.length > 0) {
                    req.user = {
                        id: results[0].user_id,
                        username: results[0].username,
                        discordId: results[0].discord_id,
                        profilePicture: results[0].profile_picture,
                    };
                }
                next();
            }
        );
    } else {
        next();
    }
});


// Routes
app.get("/", (req, res) => {
    res.render("index", { title: "Tovix" });
});

app.get("/dashboard", (req, res) => {
    if (!req.user) {
        return res.redirect("/"); // If no user is logged in, redirect to home.
    }

    res.render("dashboard", { title: "Dashboard", user: req.user });
});

app.get("/auth/verify/api/code/", async (req, res) => {
    try {
        const response = await axios.get("http://localhost.polyonax-group.org:3000/api/verification-code");
        res.render("verify", { 
            title: "Tovix - Verify",
            verificationString: response.data.verificationString,
            error: null,
            csrfToken: req.csrfToken(),
        });
    } catch (error) {
        res.render("verify", { 
            title: "Tovix - Verify",
            verificationString: "",
            error: "Error fetching verification code.",
            csrfToken: req.csrfToken(),
        });
    }
});

app.post("/api/verify/check/", async (req, res) => {
    const { userId, verificationString } = req.body;
    if (!userId || !verificationString) {
        return res.json({ success: false, message: "Missing user ID or verification string." });
    }

    try {
        const bioResponse = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
        const userBio = bioResponse.data.description || "";
        const isVerified = userBio.split("\n").map(line => line.trim()).includes(verificationString);

        if (isVerified) {
            const userResponse = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
            const username = userResponse.data.name;
            const profilePictureResponse = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`);
            const profilePicture = profilePictureResponse.data.data[0].imageUrl;

            const sessionCookie = crypto.randomBytes(32).toString("hex");

            db.query(
                "INSERT INTO users (user_id, username, profile_picture, session_cookie) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username), profile_picture = VALUES(profile_picture), session_cookie = VALUES(session_cookie)",
                [userId, username, profilePicture, sessionCookie],
                (err) => {
                    if (err) {
                        console.error("Database error:", err);
                        return res.json({ success: false, message: "Database error." });
                    }
                    res.cookie("session_token", sessionCookie, { 
                        maxAge: 24 * 60 * 60 * 1000, 
                        httpOnly: true,
                        secure: process.env.NODE_ENV === "production",
                    });
                    return res.status(302).redirect("/workspace-selection");
                }
            );
        } else {
            return res.json({ success: false, message: "Verification failed. Ensure the code is on a separate line in your bio." });
        }
    } catch (error) {
        console.error("Error checking profile:", error);
        return res.json({ success: false, message: "Error checking profile. Try again later." });
    }
});

// Logout
app.get("/logout", (req, res) => {
    if (req.cookies.session_token) {
        db.query("UPDATE users SET session_cookie = NULL WHERE session_cookie = ?", [req.cookies.session_token], (err) => {
            if (err) console.error("Error removing session:", err);
        });
    }
    res.clearCookie("session_token");
    res.redirect("/");
});

app.get("/auth/link-roblox/bloxlink", (req, res) => {

});

app.get("/auth/verify/discord", (req, res) => {
        const discordAuthUrl = process.env.DISCORD_AUTH_URL;
        res.redirect(discordAuthUrl);
});

// Discord OAuth2 Callback Route
app.get("/api/auth/discord/callback", async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.redirect("/no-account"); // If there's no code, redirect to no-account.
    }

    try {
        // Step 1: Exchange the code for an access token
        const tokenResponse = await axios.post("https://discord.com/api/oauth2/token", new URLSearchParams({
            client_id: process.env.DISCORD_AUTH_CLIENTID,
            client_secret: process.env.DISCORD_AUTH_SECRET,
            code: code,
            grant_type: "authorization_code",
            redirect_uri: process.env.DISCORD_AUTH_CALLBACK_URL,
        }), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        const accessToken = tokenResponse.data.access_token;

        // Step 2: Use the access token to fetch the user's Discord information
        const discordUserResponse = await axios.get("https://discord.com/api/v10/users/@me", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        const discordId = discordUserResponse.data.id;
        const username = discordUserResponse.data.username;
        const discriminator = discordUserResponse.data.discriminator;

        // Step 3: Check if the Discord ID is already in the database
        db.query("SELECT * FROM users WHERE discord_id = ?", [discordId], (err, results) => {
            if (err) {
                console.error("Database error:", err);
                return res.redirect("/no-account");
            }

            if (results.length > 0) {
                // If the Discord ID exists, log the user in
                const sessionCookie = crypto.randomBytes(32).toString("hex");

                // Update or insert the user's Discord info into the database
                db.query(
                    "UPDATE users SET username = ?, discord_id = ?, session_cookie = ? WHERE discord_id = ?",
                    [username, discordId, sessionCookie, discordId],
                    (dbErr) => {
                        if (dbErr) {
                            console.error("Database error:", dbErr);
                            return res.redirect("/no-account");
                        }

                        // Set session cookie and redirect to the dashboard
                        res.cookie("session_token", sessionCookie, { 
                            maxAge: 24 * 60 * 60 * 1000, 
                            httpOnly: true,
                            secure: process.env.NODE_ENV === "production",
                        });
                        return res.redirect("/dashboard");
                    }
                );
            } else {
                // If the Discord ID does not exist, redirect to the no-account page
                return res.redirect("/no-account");
            }
        });
    } catch (error) {
        console.error("Error during Discord authentication:", error);
        return res.redirect("/no-account");
    }
});

app.get("/no-account", (req, res) => {
    res.render("no-account", { title: "No Account Found" });
});


//Start server
app.listen(port, () => {
console.log(`Server running.`);
});