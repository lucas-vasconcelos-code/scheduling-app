import "./App.css";

function App() {
  return (
    <div id="appWrapper">
      <div className="headerWrapper">
        <h1>Scheduling App</h1>
      </div>
      <div className="createNewEventSectionWrapper">
        <input type="text" placeholder="Describe New Event" />
        <input type="submit" className="submitNewPromptButton" />
      </div>
    </div>
  );
}

export default App;
