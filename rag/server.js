var express = require("express");
var respond = require("./respond");
require("dotenv").config();

var app = express();
app.use(express.json());
app.use(function(req, res, next) { res.header("Access-Control-Allow-Origin", "*"); res.header("Access-Control-Allow-Headers", "Content-Type"); next(); });

app.get("/health", function(req, res) { res.json({ status: "ok" }); });
app.get("/stats", function(req, res) { res.json(respond.retrieval.getStats()); });

app.post("/respond", async function(req, res) {
  var body = req.body;
  if (!body.text) return res.status(400).json({ error: "Missing text" });
  console.log("\nRequest: " + (body.author || "?") + " — " + body.text.substring(0, 60) + "...");
  try {
    var result = await respond.generateResponse(body.text, body.author, body.category);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  var stats = respond.retrieval.getStats();
  console.log("OutreachAI on http://localhost:" + PORT);
  console.log(stats.scottInteractions + " Scott interactions loaded");
  console.log("POST /respond | GET /stats | GET /health");
});
