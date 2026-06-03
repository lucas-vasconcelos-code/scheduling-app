import { Routes, Route, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

const SERVER_PORT = "http://localhost:3000";
const SIGN_IN_PORT = "http://localhost:3000/auth/google";

function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkSignIn() {
      try {
        const response = await fetch(SERVER_PORT + "/checkSignedIn");

        if (!response.ok) {
          window.location.href = SIGN_IN_PORT;
          return;
        }

        setLoading(false);
      } catch (error) {
        window.location.href = SIGN_IN_PORT;
      }
    }

    checkSignIn();
  }, []);

  if (loading) return null;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
