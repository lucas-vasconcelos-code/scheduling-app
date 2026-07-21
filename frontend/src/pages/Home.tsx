import { useRef, useState } from "react";

const SERVER_PORT = "http://localhost:3000";

// The four actions a user can take
type Action = "create" | "read" | "update" | "delete";

function Home() {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [action, setAction] = useState<Action>("create");

  // user's timezone
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // The user's prompt to ai
  const [prompt, setPrompt] = useState("");

  // Fields for create / update
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // Field for update / delete (need to know which event to target)
  const [eventId, setEventId] = useState("");

  // Store results/errors from the backend to show the user
  const [result, setResult] = useState<string>("");

  // MediaRecorder refs — replacing the old SpeechRecognition refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  async function toggleRecording() {
    // --- STOP ---
    if (recording) {
      mediaRecorderRef.current?.stop();
      // State is set to false inside the onstop handler below
      return;
    }

    // --- START ---
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      alert(`Microphone access denied: ${err.message}`);
      return;
    }

    // Pick a supported MIME type; Safari uses mp4, everyone else webm
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";

    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // Stop all mic tracks so the browser stops showing the recording indicator
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);

      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

      // Send to backend for whisper.cpp transcription
      setTranscribing(true);
      try {
        const formData = new FormData();
        // File extension hints the backend to rename correctly before whisper
        const extension = mimeType.includes("mp4") ? "mp4" : "webm";
        formData.append("audio", audioBlob, `recording.${extension}`);

        const res = await fetch(SERVER_PORT + "/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Transcription failed");
        }

        const { transcript } = await res.json();
        // Append transcript to the existing prompt, matching old SpeechRecognition behaviour
        setPrompt((prev) => (prev ? prev + " " + transcript : transcript));
      } catch (err: any) {
        setResult(`Transcription error: ${err.message}`);
      } finally {
        setTranscribing(false);
      }
    };

    mediaRecorder.onerror = (e: Event) => {
      console.error("MediaRecorder error:", e);
      setRecording(false);
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setRecording(true);
  }

  async function submitPrompt() {
    try {
      const res = await fetch(SERVER_PORT + "/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt + " The user's time zone is " + userTimeZone,
        }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      setPrompt(""); // clear after submit
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    }
  }

  async function handleSubmit() {
    try {
      let res;

      if (action === "create") {
        res = await fetch(SERVER_PORT + "/calendar/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, start, end }),
        });
      } else if (action === "read") {
        res = await fetch(SERVER_PORT + "/calendar/events");
      } else if (action === "update") {
        res = await fetch(SERVER_PORT + "/calendar/update", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, title, start, end }),
        });
      } else if (action === "delete") {
        res = await fetch(SERVER_PORT + "/calendar/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId }),
        });
      }

      const data = await res!.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    }
  }

  // Derive mic button label from state
  const micLabel = transcribing
    ? "⏳ Transcribing…"
    : recording
    ? "⏹ Stop"
    : "🎤";

  return (
    <div className="pageWrapper">
      <h1>My Scheduler</h1>

      {/* Let the user pick which action to perform */}
      <div>
        {(["create", "read", "update", "delete"] as Action[]).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            style={{ fontWeight: action === a ? "bold" : "normal" }}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Show title/start/end fields for create and update */}
      {(action === "create" || action === "update") && (
        <div>
          <input
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      )}

      {/* Show event ID field for update and delete */}
      {(action === "update" || action === "delete") && (
        <input
          placeholder="Event ID (from read)"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        />
      )}

      <button onClick={handleSubmit}>Submit</button>

      {/* Show whatever the backend returned */}
      {result && <pre>{result}</pre>}

      {/* Remind the user to authenticate first */}
      <p>
        Not authenticated?{" "}
        <a href="http://localhost:3000/auth/google">Sign in with Google</a>
      </p>

      {/* AI prompt input with mic and submit buttons */}
      <div>
        <input
          type="text"
          placeholder="Describe what you want"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button onClick={toggleRecording} disabled={transcribing}>
          {micLabel}
        </button>
        <button onClick={submitPrompt} disabled={recording || transcribing}>
          {">"}
        </button>
      </div>
    </div>
  );
}

export default Home;
