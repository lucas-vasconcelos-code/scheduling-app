// ES module imports — keep everything as import, never mix with require()
import express from "express";
import cors from "cors";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// --- GOOGLE OAUTH SETUP ---

// Create the OAuth2 client using your credentials from .env
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Store tokens in memory for now (in production use a database)
let storedTokens = null;

// Return sign in status
app.get("/checkSignedIn", (req, res) => {
  if (storedTokens != null) res.status(200).json({ message: "Is signed in" });
  else res.status(400).json({ error: "User not signed in" });
});

// STEP 1: Send the user to Google's login page
// Visit http://localhost:3000/auth/google in your browser to kick off login
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // offline gets us a refresh token so we stay logged in
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  // Redirect the browser to Google's login page
  res.redirect(url);
});

// STEP 2: Google redirects back here with a ?code= in the URL
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;

  // Exchange the code for actual access tokens
  const { tokens } = await oauth2Client.getToken(code);

  // Save tokens so every future request can use them
  storedTokens = tokens;
  oauth2Client.setCredentials(tokens);

  // Send the user back to the React app
  res.redirect("http://localhost:5173");
});

// Helper — attach stored tokens before making any Calendar API call
function getAuthedClient() {
  if (!storedTokens) {
    throw new Error("Not authenticated. Visit /auth/google first.");
  }
  oauth2Client.setCredentials(storedTokens);
  return oauth2Client;
}

// --- CALENDAR ROUTES ---

// CREATE — POST /calendar/create
// Expects: { title, start, end }
// Example start/end: "2026-06-10T10:00:00-05:00"
app.post("/calendar/create", async (req, res) => {
  try {
    const auth = getAuthedClient();
    const calendar = google.calendar({ version: "v3", auth });

    const { title, start, end } = req.body;

    // Insert a new event into the user's primary calendar
    const result = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: title, // the title of the event
        start: { dateTime: start }, // must be ISO 8601 format
        end: { dateTime: end },
      },
    });

    // Send back the created event data
    res.json({ success: true, event: result.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ — GET /calendar/events
// Returns the next 10 upcoming events on the user's calendar
app.get("/calendar/events", async (req, res) => {
  try {
    const auth = getAuthedClient();
    const calendar = google.calendar({ version: "v3", auth });

    const result = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(), // only events from now onwards
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime", // sorted by soonest first
    });

    res.json({ events: result.data.items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE — PUT /calendar/update
// Expects: { eventId, title, start, end }
// You get the eventId from the READ route above
app.put("/calendar/update", async (req, res) => {
  try {
    const auth = getAuthedClient();
    const calendar = google.calendar({ version: "v3", auth });

    const { eventId, title, start, end } = req.body;

    const result = await calendar.events.update({
      calendarId: "primary",
      eventId, // which event to update
      requestBody: {
        summary: title,
        start: { dateTime: start },
        end: { dateTime: end },
      },
    });

    res.json({ success: true, event: result.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — DELETE /calendar/delete
// Expects: { eventId }
app.delete("/calendar/delete", async (req, res) => {
  try {
    const auth = getAuthedClient();
    const calendar = google.calendar({ version: "v3", auth });

    const { eventId } = req.body;

    // delete doesn't return event data, just a 204 No Content on success
    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

console.log("Server object:", server.address());

process.on("exit", (code) => {
  console.log("Process exiting with code:", code);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
