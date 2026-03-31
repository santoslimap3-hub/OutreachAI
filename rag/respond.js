var Anthropic = require("@anthropic-ai/sdk");
var RetrievalEngine = require("./retrieval");
require("dotenv").config();

var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
var retrieval = new RetrievalEngine(process.env.DATA_PATH);

var SCOTT_VOICE = 'You are Scott Northwolf, founder of Self-Improvement Nation on Skool.\n' +
'You run Answer 42, helping self-improvement coaches go from $0 to $10K/month in 42 days.\n\n' +
'YOUR VOICE:\n' +
'- Call people "brother," "bro," "king" — genuine, not cringe\n' +
'- Direct and no-BS but always warm\n' +
'- Use CAPS for emphasis on key words, not full sentences\n' +
'- Emojis sparingly but effectively (fire, muscle, map, target)\n' +
'- Swear occasionally when fired up — authentic not forced\n' +
'- Hype wins HARD — even small ones\n' +
'- Keep replies punchy — 2-4 sentences for acknowledgements, longer for advice\n\n' +
'YOUR SALES APPROACH:\n' +
'- NEVER hard-sell in community replies\n' +
'- Build genuine relationships first\n' +
'- For stuck people: empathize, reframe, offer to talk\n' +
'- For business questions: give real value first, THEN mention your program naturally\n' +
'- For intros: welcome warmly, ask a follow-up question\n' +
'- For wins: amplify their energy, make them feel seen\n' +
'- CTA is always soft: "DM me," "book a call," "link in bio"\n\n' +
'NEVER:\n' +
'- Sound like a generic AI or chatbot\n' +
'- Use corporate language\n' +
'- Give long motivational speeches\n' +
'- Ignore emotional content\n' +
'- Respond with just an emoji\n' +
'- Break character or reference being an AI';

async function classifyPost(postText, postAuthor, postCategory) {
  var response = await client.messages.create({
    model: process.env.CLASSIFY_MODEL || "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: "You classify community posts. Respond ONLY with valid JSON.",
    messages: [{ role: "user", content: 'Classify this post:\nAuthor: ' + (postAuthor || "Unknown") + '\nCategory: ' + (postCategory || "General") + '\nPost: "' + postText + '"\n\nJSON format:\n{"emotional_state":"frustrated|excited|confused|neutral|vulnerable|motivated","post_type":"introduction|question|win|vent|discussion","intent":"engagement-nurture|value-delivery|social-proof|pain-agitation|objection-handling|close-to-call|community-building|acknowledgement","sales_stage":"awareness|engagement|nurture|close","category":"' + (postCategory || "General") + '","urgency":"low|medium|high"}' }],
  });
  try {
    var text = response.content[0].text.trim().replace(/```json\s*|```\s*/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    return { emotional_state: "neutral", post_type: "discussion", intent: "engagement-nurture", sales_stage: "engagement", category: postCategory || "General", urgency: "medium" };
  }
}

async function generateResponse(postText, postAuthor, postCategory) {
  var startTime = Date.now();
  console.log("  1. Classifying...");
  var classification = await classifyPost(postText, postAuthor, postCategory);
  console.log("     " + classification.post_type + " | " + classification.emotional_state + " | " + classification.sales_stage);

  console.log("  2. Retrieving context...");
  var maxEx = parseInt(process.env.MAX_EXAMPLES) || 4;
  var results = retrieval.retrieve(postText, classification, maxEx);
  var contextExamples = retrieval.formatExamples(results);
  console.log("     " + results.length + " examples (

cat << 'RESEOF' > respond.js
var Anthropic = require("@anthropic-ai/sdk");
var RetrievalEngine = require("./retrieval");
require("dotenv").config();

var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
var retrieval = new RetrievalEngine(process.env.DATA_PATH);

var SCOTT_VOICE = 'You are Scott Northwolf, founder of Self-Improvement Nation on Skool.\n' +
'You run Answer 42, helping self-improvement coaches go from $0 to $10K/month in 42 days.\n\n' +
'YOUR VOICE:\n' +
'- Call people "brother," "bro," "king" — genuine, not cringe\n' +
'- Direct and no-BS but always warm\n' +
'- Use CAPS for emphasis on key words, not full sentences\n' +
'- Emojis sparingly but effectively (fire, muscle, map, target)\n' +
'- Swear occasionally when fired up — authentic not forced\n' +
'- Hype wins HARD — even small ones\n' +
'- Keep replies punchy — 2-4 sentences for acknowledgements, longer for advice\n\n' +
'YOUR SALES APPROACH:\n' +
'- NEVER hard-sell in community replies\n' +
'- Build genuine relationships first\n' +
'- For stuck people: empathize, reframe, offer to talk\n' +
'- For business questions: give real value first, THEN mention your program naturally\n' +
'- For intros: welcome warmly, ask a follow-up question\n' +
'- For wins: amplify their energy, make them feel seen\n' +
'- CTA is always soft: "DM me," "book a call," "link in bio"\n\n' +
'NEVER:\n' +
'- Sound like a generic AI or chatbot\n' +
'- Use corporate language\n' +
'- Give long motivational speeches\n' +
'- Ignore emotional content\n' +
'- Respond with just an emoji\n' +
'- Break character or reference being an AI';

async function classifyPost(postText, postAuthor, postCategory) {
  var response = await client.messages.create({
    model: process.env.CLASSIFY_MODEL || "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: "You classify community posts. Respond ONLY with valid JSON.",
    messages: [{ role: "user", content: 'Classify this post:\nAuthor: ' + (postAuthor || "Unknown") + '\nCategory: ' + (postCategory || "General") + '\nPost: "' + postText + '"\n\nJSON format:\n{"emotional_state":"frustrated|excited|confused|neutral|vulnerable|motivated","post_type":"introduction|question|win|vent|discussion","intent":"engagement-nurture|value-delivery|social-proof|pain-agitation|objection-handling|close-to-call|community-building|acknowledgement","sales_stage":"awareness|engagement|nurture|close","category":"' + (postCategory || "General") + '","urgency":"low|medium|high"}' }],
  });
  try {
    var text = response.content[0].text.trim().replace(/```json\s*|```\s*/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    return { emotional_state: "neutral", post_type: "discussion", intent: "engagement-nurture", sales_stage: "engagement", category: postCategory || "General", urgency: "medium" };
  }
}

async function generateResponse(postText, postAuthor, postCategory) {
  var startTime = Date.now();
  console.log("  1. Classifying...");
  var classification = await classifyPost(postText, postAuthor, postCategory);
  console.log("     " + classification.post_type + " | " + classification.emotional_state + " | " + classification.sales_stage);

  console.log("  2. Retrieving context...");
  var maxEx = parseInt(process.env.MAX_EXAMPLES) || 4;
  var results = retrieval.retrieve(postText, classification, maxEx);
  var contextExamples = retrieval.formatExamples(results);
  console.log("     " + results.length + " examples (scores: " + results.map(function(r){return r.score.toFixed(2)}).join(", ") + ")");

  var systemPrompt = SCOTT_VOICE + "\n\nCONTEXT — past interactions:\n\n" + contextExamples +
    "\n\n---\nCLASSIFICATION: " + classification.emotional_state + " | " + classification.post_type + " | stage: " + classification.sales_stage + " | urgency: " + classification.urgency;

  console.log("  3. Generating...");
  var response = await client.messages.create({
    model: process.env.RESPONSE_MODEL || "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: "user", content: 'New post:\nAuthor: ' + (postAuthor || "Someone") + '\nCategory: ' + (postCategory || "General") + '\nPost: "' + postText + '"\n\nRespond as Scott.' }],
  });

  var elapsed = Date.now() - startTime;
  console.log("  Done in " + (elapsed/1000).toFixed(1) + "s");

  return {
    response: response.content[0].text,
    classification: classification,
    retrievedExamples: results.map(function(r) { return { title: r.interaction.original_post.title, score: r.score }; }),
    metadata: { model: process.env.RESPONSE_MODEL, examples_used: results.length, elapsed_ms: elapsed, tokens_in: response.usage.input_tokens, tokens_out: response.usage.output_tokens },
  };
}

module.exports = { generateResponse: generateResponse, classifyPost: classifyPost, retrieval: retrieval };
