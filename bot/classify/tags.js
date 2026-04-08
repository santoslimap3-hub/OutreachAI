/**
 * classify/tags.js
 *
 * Single source of truth for all valid classification tags.
 * Edit this file to add/remove/rename tags as Scott's style evolves.
 *
 * These definitions are injected into the classifier's system prompt
 * so the LLM knows exactly what each tag means in Scott's specific context.
 */

// ─── TONE TAGS (multi-select — a reply can have several) ──────────────────────
const TONE_TAGS = {
    "hype":                 "Maximum energy, excitement, ALL CAPS on key words. 'LETS FUCKIN GOOO'. Peak Scott mode.",
    "brotherhood":          "Raw male comradery. 'brother', 'bro', 'king'. Street-level loyalty, not corporate cheerfulness.",
    "motivational":         "Pushing someone forward with conviction. 'Only when the pain of staying the same outweighs...'",
    "authority":            "Scott positioning himself as THE expert. Drops credentials naturally. No arrogance — just certainty.",
    "direct":               "No fluff. Gets straight to the point. Short sentences. Often gives the answer in the first line.",
    "casual":               "Low-key, no agenda. Like texting a friend. 'lol', 'yeah bro'. Not trying to impress.",
    "self-aggrandization":  "Scott referencing his own wins or lifestyle — creates aspiration, not annoyance.",
    "teasing-future-value": "Hinting at something big coming without revealing it. Creates curiosity and FOMO.",
    "praise":               "Genuine recognition of effort or insight. Specific, not generic.",
    "humor":                "Light jokes or sarcasm. Never mean, always in good spirit.",
    "empathy":              "Acknowledging someone's struggle. Brief and real — he doesn't dwell. Then pivots.",
    "storytelling":         "Using a personal story or anecdote to make a point.",
    "vulnerability":        "Briefly revealing a personal challenge — creates trust. Rare and powerful.",
    "tough-love":           "Direct honest feedback that might sting but is said with care.",
    "mystery-teasing":      "Creating intrigue around Scott's methods or lifestyle. Makes people want to ask more.",
    "chit-chat":            "Pure social conversation. No agenda, no value delivery. Just being human.",
    "bonding-rapport":      "Building personal connection through shared experiences or references.",
    "gratitude":            "Scott expressing genuine thanks. Rare but real.",
    "curiosity":            "Scott asking a question because he genuinely wants to know more.",
};

// ─── INTENT (single — the primary purpose of the reply) ───────────────────────
const INTENTS = {
    "acknowledgement":      "Simply reacting to what was said. Emoji, 'fire', 'exactly'. No sales agenda — just being present.",
    "engagement-nurture":   "Keeping the conversation alive and building warmth. Makes the person feel seen and come back.",
    "community-building":   "Reinforcing the identity and culture of Self-Improvement Nation.",
    "authority-proofing":   "Demonstrating Scott's expertise or results without being asked. Builds credibility passively.",
    "value-delivery":       "Giving a specific, actionable insight or framework that is immediately useful.",
    "close-to-call":        "Inviting the person to book a call or DM. Only when they've shown clear buying signals.",
    "social-proof":         "Highlighting wins or transformations to attract others.",
    "redirect":             "Moving the conversation toward Scott's core offer. Smooth, not abrupt.",
    "info-gathering":       "Asking a question to learn more about the person's situation or goals.",
    "lead-qualification":   "Probing to determine if this person is a coach who could buy.",
    "pain-agitation":       "Amplifying someone's problem to make the need for a solution more urgent.",
    "objection-handling":   "Addressing a doubt or pushback and flipping it into a reason to move forward.",
    "funneling":            "Directing the person toward Scott's community, program, or resources.",
};

// ─── SALES STAGE (single — where this person is in the journey) ───────────────
const SALES_STAGES = {
    "awareness":  "Person just discovered Scott. Make a good first impression. No selling.",
    "engagement": "Person is active but hasn't shown buying intent. Deepen the relationship.",
    "nurture":    "Person is warm and trusts Scott. Stay top of mind, deliver value.",
    "ask":        "Person has shown buying signals. Move them toward a call.",
};

module.exports = { TONE_TAGS, INTENTS, SALES_STAGES };
