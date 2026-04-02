var Anthropic = require("@anthropic-ai/sdk");
var RetrievalEngine = require("./retrieval");
require("dotenv").config();

var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
var retrieval = new RetrievalEngine(process.env.DATA_PATH);

var SCOTT_VOICE = "You are Scott Northwolf. You are responding to posts in your Skool community called Self-Improvement Nation. " +
"You run Answer 42, helping self-improvement coaches go from $0 to $10K/month in 42 days with your Reverse Engineered $10K Method. " +
"\n\n" +
"CRITICAL RULES FOR YOUR VOICE:\n" +
"- Study the examples below VERY carefully. Match their exact energy, sentence structure, and word choices.\n" +
"- You say brother, bro, king naturally.\n" +
"- You use CAPS on one or two words per message for emphasis, never full sentences.\n" +
"- You use ... (ellipses) a lot mid-thought.\n" +
"- You swear when hyped: shit, fucking, etc. It feels natural.\n" +
"- You use fire emoji, muscle emoji, but sparingly.\n" +
"- Your sentences are SHORT and punchy. Not polished. Not grammatically perfect.\n" +
"- You sound like a real person texting, NOT like a professional writer.\n" +
"- You NEVER use phrases like: I hear you, I understand, That resonates, Lets unpack, Heres the thing, Heres the truth, Heres what I know.\n" +
"- You NEVER use bullet points or numbered lists.\n" +
"- You NEVER write more than 4-5 sentences unless giving specific tactical advice.\n" +
"- You NEVER sound motivational-speaker polished. You sound RAW.\n" +
"- DO NOT start responses with the persons name. Just dive in.\n" +
"\n" +
"SALES APPROACH:\n" +
"- Never hard-sell. Build relationships.\n" +
"- For stuck people: empathize briefly, reframe, then casually offer to talk.\n" +
"- For business questions: give ONE piece of real value, then mention your program naturally.\n" +
"- For intros: welcome them, ask what they are working on.\n" +
"- For wins: match their energy, amplify it.\n" +
"- CTA is always casual: DM me, book a call, link in bio. Never pushy.\n" +
"\n" +
"YOUR ACTUAL RESPONSES FROM THE COMMUNITY ARE BELOW. MIMIC THIS EXACT STYLE. DO NOT DEVIATE.\n";

async function classifyPost(postText, postAuthor, postCategory) {
  var response = await client.messages.create({
    model: process.env.CLASSIFY_MODEL || "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: "You classify community posts. Respond ONLY with valid JSON.",
    messages: [{ role: "user", content: "Classify this post:\nAuthor: " + (postAuthor || "Unknown") + "\nCategory: " + (postCategory || "General") + "\nPost: " + postText + "\n\nJSON: {\"emotional_state\":\"frustrated|excited|confused|neutral|vulnerable|motivated\",\"post_type\":\"introduction|question|win|vent|discussion\",\"intent\":\"engagement-nurture|value-delivery|social-proof|pain-agitation|objection-handling|close-to-call|community-building|acknowledgement\",\"sales_stage\":\"awareness|engagement|nurture|close\",\"category\":\"" + (postCategory || "General") + "\",\"urgency\":\"low|medium|high\"}" }],
  });
  try {
    var text = response.content[0].text.trim().replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    return { emotional_state: "neutral", post_type: "discussion", intent: "engagement-nurture", sales_stage: "engagement", category: postCategory || "General", urgency: "medium" };
  }
}

async function generateResponse(postText, postAuthor, postCategory, options) {
  options = options || {};
  var startTime = Date.now();

  console.log("  1. Classifying...");
  var classification = await classifyPost(postText, postAuthor, postCategory);
  console.log("     " + classification.post_type + " | " + classification.emotional_state + " | " + classification.sales_stage);

  console.log("  2. Retrieving context...");
  var maxEx = parseInt(process.env.MAX_EXAMPLES) || 4;
  var results = retrieval.retrieve(postText, classification, maxEx);
  var contextExamples = retrieval.formatExamples(results);
  console.log("     " + results.length + " examples found");

  var systemPrompt = SCOTT_VOICE + "\n---\n\n" + contextExamples + "\n\n---\nThe post is classified as: " + classification.emotional_state + " " + classification.post_type + " at " + classification.sales_stage + " stage.";

  var userPrompt = "New post in your community:\n\n" + (postAuthor || "Someone") + " posted in " + (postCategory || "General") + ":\n" + postText + "\n\nWrite your reply. Match the style from the examples EXACTLY. Be Scott.";

  // Print the full prompt if debug mode
  if (options.debug) {
    console.log("\n" + "=".repeat(60));
    console.log("FULL SYSTEM PROMPT SENT TO CLAUDE:");
    console.log("=".repeat(60));
    console.log(systemPrompt);
    console.log("=".repeat(60));
    console.log("\nUSER PROMPT:");
    console.log("=".repeat(60));
    console.log(userPrompt);
    console.log("=".repeat(60) + "\n");
  }

  console.log("  3. Generating...");
  var response = await client.messages.create({
    model: process.env.RESPONSE_MODEL || "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  var elapsed = Date.now() - startTime;
  console.log("  Done in " + (elapsed / 1000).toFixed(1) + "s");

  return {
    response: response.content[0].text,
    classification: classification,
    systemPrompt: systemPrompt,
    retrievedExamples: results.map(function(r) { return { title: r.interaction.original_post.title, score: r.score }; }),
    metadata: { model: process.env.RESPONSE_MODEL, examples_used: results.length, elapsed_ms: elapsed, tokens_in: response.usage.input_tokens, tokens_out: response.usage.output_tokens },
  };
}

module.exports = { generateResponse: generateResponse, classifyPost: classifyPost, retrieval: retrieval };
