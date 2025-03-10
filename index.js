const express = require("express");
const app = express();
const path = require("path");
const axios = require("axios");
const mysql = require("mysql");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");

const port = 3000;

// Database connection with error handling
const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "yourpassword",
    database: "yourdatabase",
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

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
