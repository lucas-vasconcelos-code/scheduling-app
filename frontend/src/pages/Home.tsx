import React, { useState } from "react";

function Home() {
  const [newDesc, setNewDesc] = useState("");

  function handleSubmit() {
    // Create a new request to the backend
    console.log(`Button was clicked! newDesc = ${newDesc}`);
  }

  return (
    <div>
      <h1>My Scheduler</h1>
      <div className="newCommandSection">
        <input
          placeholder="Describe what you want to do"
          value={newDesc}
          onChange={(e) => {
            setNewDesc(e.target.value);
          }}
        />

        <button
          className="submitBut"
          onClick={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          {">"}
        </button>
      </div>
    </div>
  );
}

export default Home;
