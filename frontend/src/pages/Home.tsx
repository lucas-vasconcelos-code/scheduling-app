import { useState } from "react";

const SERVER_PORT = "http://localhost:3000";

// The four actions a user can take
type Action = "create" | "read" | "update" | "delete";

function Home() {
  // Which action the user selected
  const [action, setAction] = useState<Action>("create");

  // user's timezone
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(userTimeZone);

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

  async function submitPrompt() {
    try {
      let res = await fetch(SERVER_PORT + "/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt + "The user's time zone is " + userTimeZone,
        }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    }
  }

  async function handleSubmit() {
    try {
      let res;

      if (action === "create") {
        // POST with event details in the body
        res = await fetch(SERVER_PORT + "/calendar/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, start, end }),
        });
      } else if (action === "read") {
        // GET — no body needed, just fetch upcoming events
        res = await fetch("http://localhost:3000/calendar/events");
      } else if (action === "update") {
        // PUT with the event id and new details
        res = await fetch("http://localhost:3000/calendar/update", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, title, start, end }),
        });
      } else if (action === "delete") {
        // DELETE with just the event id
        res = await fetch("http://localhost:3000/calendar/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId }),
        });
      }

      const data = await res!.json();

      // Pretty-print the response so it's readable
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
            // Highlight the currently selected action
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
          {/* datetime-local gives a date+time picker in the browser */}
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
      <h3>Test Prompt: Hang out with Coral today at 12</h3>

      <div>
        <input
          type="text"
          placeholder="Describe what you want"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <button onClick={submitPrompt}>{">"}</button>
      </div>
    </div>
  );
}

export default Home;
