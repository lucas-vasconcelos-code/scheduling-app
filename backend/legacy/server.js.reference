import express from "express";
import cors from "cors";
import { google } from "googleapis";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { aiSystemInstructions } from "./ai-system-instructions.js";
import multer from "multer";
import { spawn, execFile } from "child_process";
import fs from "fs";
import os from "os";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const PORT = 3000;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ============================================================
// MULTER SETUP
// ============================================================

const upload = multer({
  dest: os.tmpdir(),
});

// ============================================================
// GOOGLE OAUTH SETUP
// ============================================================

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let storedTokens = null;

app.get("/checkSignedIn", (req, res) => {
  if (storedTokens != null) {
    res.status(200).json({ message: "Is signed in" });
  } else {
    res.status(400).json({ error: "User not signed in" });
  }
});

app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);

    storedTokens = tokens;
    oauth2Client.setCredentials(tokens);

    res.redirect("http://localhost:5173");
  } catch (err) {
    console.error("OAuth error:", err);
    res.status(500).send("Authentication failed.");
  }
});

function getAuthedClient() {
  if (!storedTokens) {
    throw new Error("Not authenticated. Visit /auth/google first.");
  }

  oauth2Client.setCredentials(storedTokens);

  return oauth2Client;
}

// ============================================================
// TRANSCRIPTION
// ============================================================

// These must exist in your .env file:
//
// WHISPER_CLI=/absolute/path/to/whisper-cli
// WHISPER_MODEL=/absolute/path/to/ggml-base.en.bin

const WHISPER_CLI = process.env.WHISPER_CLI;
const WHISPER_MODEL = process.env.WHISPER_MODEL;

// ------------------------------------------------------------
// POST /transcribe
// ------------------------------------------------------------

app.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "No audio file uploaded.",
    });
  }

  const inputPath = req.file.path;
  const outputPath = `${inputPath}.wav`;

  try {
    console.log("Received audio file:", inputPath);

    // Convert browser audio to a Whisper-compatible WAV file
    await convertToWav(inputPath, outputPath);

    console.log("Audio converted to WAV:", outputPath);

    // Run Whisper
    const transcript = await runWhisper(WHISPER_CLI, WHISPER_MODEL, outputPath);

    console.log("Final transcript:", transcript);

    res.json({
      transcript,
    });
  } catch (err) {
    console.error("Transcription error:", err);

    res.status(500).json({
      error: err.message,
    });
  } finally {
    // Delete original uploaded audio
    try {
      fs.unlinkSync(inputPath);
    } catch (_) {}

    // Delete converted WAV file
    try {
      fs.unlinkSync(outputPath);
    } catch (_) {}
  }
});

// ------------------------------------------------------------
// Convert browser audio to 16 kHz mono WAV
// ------------------------------------------------------------

function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        outputPath,
      ],
      (error, stdout, stderr) => {
        if (error) {
          console.error("FFmpeg error:");
          console.error(stderr);

          reject(new Error(`FFmpeg conversion failed:\n${stderr}`));

          return;
        }

        console.log("FFmpeg conversion successful.");

        resolve();
      }
    );
  });
}

// ------------------------------------------------------------
// Run whisper.cpp
// ------------------------------------------------------------

function runWhisper(cliPath, modelPath, audioPath) {
  return new Promise((resolve, reject) => {
    if (!cliPath) {
      return reject(new Error("WHISPER_CLI is missing from your .env file."));
    }

    if (!modelPath) {
      return reject(new Error("WHISPER_MODEL is missing from your .env file."));
    }

    console.log("Whisper CLI:", cliPath);
    console.log("Whisper model:", modelPath);
    console.log("Whisper audio:", audioPath);

    const proc = spawn(cliPath, ["-m", modelPath, "-f", audioPath, "-nt"]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      console.log("Whisper exit code:", code);
      console.log("Whisper stdout:", JSON.stringify(stdout));
      console.log("Whisper stderr:", JSON.stringify(stderr));

      if (code !== 0) {
        reject(new Error(`whisper-cli exited with code ${code}:\n${stderr}`));

        return;
      }

      const transcript = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !(line.startsWith("[") && line.endsWith("]")))
        .join(" ")
        .trim();

      if (!transcript) {
        reject(
          new Error(
            "Whisper produced no output. Check the audio or model path."
          )
        );

        return;
      }

      resolve(transcript);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn whisper-cli: ${err.message}`));
    });
  });
}

// ============================================================
// GEMINI CALENDAR TOOLS
// ============================================================

const calendarTools = [
  {
    functionDeclarations: [
      {
        name: "create_event",
        description: "Create a new event on the user's Google Calendar",
        parameters: {
          type: "OBJECT",
          properties: {
            title: {
              type: "STRING",
              description: "Title of the event",
            },
            start: {
              type: "STRING",
              description: "Start time in ISO 8601 format",
            },
            end: {
              type: "STRING",
              description: "End time in ISO 8601 format",
            },
            timeZone: {
              type: "STRING",
              description: "IANA timezone name e.g. America/New_York",
            },
          },
          required: ["title", "start", "end", "timeZone"],
        },
      },

      {
        name: "delete_event",
        description: "Delete an event from the user's Google Calendar",
        parameters: {
          type: "OBJECT",
          properties: {
            eventId: {
              type: "STRING",
              description: "The ID of the event to delete",
            },
          },
          required: ["eventId"],
        },
      },

      {
        name: "update_event",
        description: "Update an existing event on the user's Google Calendar",
        parameters: {
          type: "OBJECT",
          properties: {
            eventId: {
              type: "STRING",
              description: "The ID of the event to update",
            },
            title: {
              type: "STRING",
              description: "New title of the event",
            },
            start: {
              type: "STRING",
              description: "New start time in ISO 8601 format",
            },
            end: {
              type: "STRING",
              description: "New end time in ISO 8601 format",
            },
            timeZone: {
              type: "STRING",
              description: "IANA timezone name e.g. America/New_York",
            },
          },
          required: ["eventId", "title", "start", "end", "timeZone"],
        },
      },

      {
        name: "get_events",
        description: "Get upcoming events from the user's Google Calendar",
        parameters: {
          type: "OBJECT",
          properties: {},
        },
      },
    ],
  },
];

// ============================================================
// AI ROUTE
// ============================================================

app.post("/ai", async (req, res) => {
  try {
    const { message } = req.body;

    const auth = getAuthedClient();

    const calendar = google.calendar({
      version: "v3",
      auth,
    });

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: calendarTools,
      systemInstruction: `Today is ${new Date().toISOString()}. ${aiSystemInstructions}`,
    });

    const result = await model.generateContent(`User request: ${message}`);

    const response = result.response;

    const candidate = response.candidates[0].content.parts[0];

    if (!candidate.functionCall) {
      return res.json({
        reply: candidate.text,
      });
    }

    const { name, args } = candidate.functionCall;

    let outcome;

    console.log(`Function called: ${name}`);
    console.log("Arguments:", args);

    if (name === "create_event") {
      const r = await calendar.events.insert({
        calendarId: "primary",

        requestBody: {
          summary: args.title,

          start: {
            dateTime: args.start,
            timeZone: args.timeZone,
          },

          end: {
            dateTime: args.end,
            timeZone: args.timeZone,
          },
        },
      });

      outcome = r.data;
    } else if (name === "delete_event") {
      await calendar.events.delete({
        calendarId: "primary",
        eventId: args.eventId,
      });

      outcome = {
        deleted: true,
      };
    } else if (name === "update_event") {
      const r = await calendar.events.update({
        calendarId: "primary",
        eventId: args.eventId,

        requestBody: {
          summary: args.title,

          start: {
            dateTime: args.start,
            timeZone: args.timeZone,
          },

          end: {
            dateTime: args.end,
            timeZone: args.timeZone,
          },
        },
      });

      outcome = r.data;
    } else if (name === "get_events") {
      const r = await calendar.events.list({
        calendarId: "primary",

        timeMin: new Date().toISOString(),

        maxResults: 10,

        singleEvents: true,

        orderBy: "startTime",
      });

      outcome = r.data.items;
    }

    res.json({
      functionCalled: name,
      result: outcome,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ============================================================
// CREATE EVENT
// ============================================================

app.post("/calendar/create", async (req, res) => {
  try {
    const auth = getAuthedClient();

    const calendar = google.calendar({
      version: "v3",
      auth,
    });

    const { title, start, end } = req.body;

    const result = await calendar.events.insert({
      calendarId: "primary",

      requestBody: {
        summary: title,

        start: {
          dateTime: start,
        },

        end: {
          dateTime: end,
        },
      },
    });

    res.json({
      success: true,
      event: result.data,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ============================================================
// READ EVENTS
// ============================================================

app.get("/calendar/events", async (req, res) => {
  try {
    const auth = getAuthedClient();

    const calendar = google.calendar({
      version: "v3",
      auth,
    });

    const result = await calendar.events.list({
      calendarId: "primary",

      timeMin: new Date().toISOString(),

      maxResults: 10,

      singleEvents: true,

      orderBy: "startTime",
    });

    res.json({
      events: result.data.items,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ============================================================
// UPDATE EVENT
// ============================================================

app.put("/calendar/update", async (req, res) => {
  try {
    const auth = getAuthedClient();

    const calendar = google.calendar({
      version: "v3",
      auth,
    });

    const { eventId, title, start, end } = req.body;

    const result = await calendar.events.update({
      calendarId: "primary",
      eventId,

      requestBody: {
        summary: title,

        start: {
          dateTime: start,
        },

        end: {
          dateTime: end,
        },
      },
    });

    res.json({
      success: true,
      event: result.data,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ============================================================
// DELETE EVENT
// ============================================================

app.delete("/calendar/delete", async (req, res) => {
  try {
    const auth = getAuthedClient();

    const calendar = google.calendar({
      version: "v3",
      auth,
    });

    const { eventId } = req.body;

    await calendar.events.delete({
      calendarId: "primary",
      eventId,
    });

    res.json({
      success: true,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ============================================================
// START SERVER
// ============================================================

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
