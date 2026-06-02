import cors from "cors";

const express = require("express");
const app = express();
const PORT = 3000;

app.use(cors({ origin: "http://localhost:5173" }));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("<h1>Hello World</h1>");
});

app.get("/login", (req, res) => {});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
