var respond = require("./respond");
require("dotenv").config();

async function run() {
  console.log("OUTREACH AI — FULL PROMPT DEBUG\n");
  var stats = respond.retrieval.getStats();
  console.log("Data: " + stats.totalInteractions + " posts, " + stats.scottInteractions + " with Scott, " + stats.indexTerms + " terms\n");

  var testPost = {
    author: "Sarah K",
    category: "Holistic Self-Improvement",
    text: "Been feeling stuck lately. Lost 3 clients and doubting if coaching is for me. Anyone else gone through this?"
  };

  console.log("TEST POST: " + testPost.text + "\n");

  try {
    var result = await respond.generateResponse(testPost.text, testPost.author, testPost.category, { debug: true });
    console.log("\nSCOTT SAYS:");
    console.log("-".repeat(40));
    console.log(result.response);
    console.log("-".repeat(40));
    console.log("Tokens: " + result.metadata.tokens_in + " in / " + result.metadata.tokens_out + " out");
  } catch(e) { console.error("Error: " + e.message); }
}
run();
