import { useRef, useState } from "react";

const SERVER_PORT = "http://localhost:3000";

// The four actions a user can take
type Action = "create" | "read" | "update" | "delete";

function Home() {
  const [listening, setListening] = useState(false);
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

  const recognitionRef = useRef<any>(null);

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      setPrompt((prev) => prev + " " + transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error:", event.error);
    };

    // Restart automatically if it stops but user hasn't toggled off
    recognition.onend = () => {
      if (recognitionRef.current) {
        recognitionRef.current.start();
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
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

  return (
    <div>
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
        <button onClick={toggleListening}>{listening ? "⏹ Stop" : "🎤"}</button>
        <button onClick={submitPrompt}>{">"}</button>
      </div>
    </div>
  );
}

export default Home;
