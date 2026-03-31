var respond = require("./respond");
require("dotenv").config();

var TESTS = [
  { author: "New Member", category: "General", text: "Hey everyone, just joined! I am a fitness coach making $2k/month and want to scale. Excited to be here!" },
  { author: "Sarah K", category: "Holistic Self-Improvement", text: "Been feeling stuck lately. Lost 3 clients and doubting if coaching is for me. Anyone else gone through this?" },
  { author: "Mike Torres", category: "Money", text: "What is the best way to price a coaching package? I do $50/hour but feel like I am leaving money on the table." },
  { author: "Andreas", category: "The Hero's Journey", text: "Just signed my first $3k client using the framework from the roadmap! Can not believe this works!" },
  { author: "Quiet Observer", category: "Mindset", text: "Does anyone else feel like imposter syndrome is holding them back? I have the knowledge but freeze up putting myself out there." },
];

async function run() {
  console.log("OUTREACH AI — RAG TEST\n");
  var stats = respond.retrieval.getStats();
  console.log("Data: " + stats.totalInteractions + " posts, " + stats.scottInteractions + " with Scott, " + stats.indexTerms + " terms\n");

  for (var i = 0; i < TESTS.length; i++) {
    var t = TESTS[i];
    console.log("=".repeat(50));
    console.log("TEST " + (i+1) + ": " + t.author + " in " + t.category);
    console.log("POST: " + t.text.substring(0, 100) + "...\n");
    try {
      var result = await respond.generateResponse(t.text, t.author, t.category);
      console.log("\nSCOTT SAYS:\n" + result.response);
      console.log("\nExamples used: " + result.retrievedExamples.map(function(e){return (e.title||"?").substring(0,20)+"("+e.score.toFixed(2)+")"}).join(", "));
      console.log("Tokens: " + result.metadata.tokens_in + " in / " + result.metadata.tokens_out + " out | " + (result.metadata.elapsed_ms/1000).toFixed(1) + "s");
    } catch(e) { console.error("Error: " + e.message); }
    console.log("\n");
  }
}
run();
