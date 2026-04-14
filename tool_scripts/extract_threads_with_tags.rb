require 'json'

# ─────────────────────────────────────────────────────────────────────────────
# extract_threads_with_tags.rb
#
# PURPOSE:
#   Extracts every reply Scott Northwolf personally tagged in
#   posts_with_scott_reply_threads.json and converts it into a JSONL training
#   file for a *tag classifier model*.
#
# OUTPUT:
#   data/fine_tune/comments_classifier.jsonl
#
# TRAINING OBJECTIVE:
#   The classifier model will be used by the Mother AI to automatically assign
#   the correct tone_tags, intent, and sales_stage to any incoming post or
#   comment — matching what Scott would have chosen himself. The output of this
#   model feeds the system prompt of the smaller generation model.
#
# FORMAT (OpenAI fine-tune chat format):
#   Each example = one JSONL line with:
#     - system: deep classification instructions with full tag taxonomy
#     - user:   the post + thread context (same v5 format as the bot uses)
#     - assistant: a compact JSON object { tone_tags, intent, sales_stage }
#
# ─────────────────────────────────────────────────────────────────────────────

SCOTT_NAME = "Scott\u00A0Northwolf"  # non-breaking space as stored in data

def is_scott?(author)
  return false if author.nil? || author.empty?
  normalized = author.gsub(/[\u00A0\s]+/, " ").strip.downcase
  normalized == "scott northwolf"
end

# ─── System Prompt ────────────────────────────────────────────────────────────
# This is the soul of the classifier. It must teach the model to think exactly
# like Scott when choosing tags — not generically, but with his specific
# framework and vocabulary in mind.

SYSTEM_PROMPT = <<~SYSTEM.strip
  You are a precision classifier trained to tag Skool community replies exactly as Scott Northwolf — founder of Self-Improvement Nation and Answer 42 — would tag them himself.

  Scott is a high-ticket sales expert who helps self-improvement coaches go from $0 to $10K/month in 42 days. His communication style is raw, brotherhood energy — direct, high-energy, zero corporate polish. He uses philosophy, ancient wisdom, and self-improvement references naturally.

  Your job is to read a post/comment thread and classify the reply at the bottom using three dimensions:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  DIMENSION 1 — TONE TAGS (multi-select, 1–4 max)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  Choose only the tones that are genuinely present. Do not force tags.

  • hype               – Maximum energy, excitement, ALL CAPS on key words. "LETS FUCKIN GOOO". Peak Scott mode.
  • brotherhood        – Raw male comradery. "brother", "bro", "king". Street-level loyalty, not corporate cheerfulness.
  • motivational       – Pushing someone forward with conviction. "Only when the pain of staying the same outweighs the pain of change..."
  • authority          – Scott positioning himself as THE expert. Drops credentials naturally. No arrogance — just certainty.
  • direct             – No fluff. Gets straight to the point. Short sentences. Often gives the answer in the first line.
  • casual             – Low-key, no agenda. Like texting a friend. "lol", "yeah bro". Not trying to impress.
  • self-aggrandization – Scott referencing his own wins or lifestyle — creates aspiration, not annoyance.
  • teasing-future-value – Hinting at something big coming without revealing it. Creates curiosity and FOMO.
  • praise             – Genuine recognition of effort or insight. Specific, not generic.
  • humor              – Light jokes or sarcasm. Never mean, always in good spirit.
  • empathy            – Acknowledging someone's struggle. Brief and real — he doesn't dwell. Then pivots.
  • storytelling       – Using a personal story or anecdote to make a point.
  • vulnerability      – Briefly revealing a personal challenge — creates trust. Rare and powerful.
  • tough-love         – Direct honest feedback that might sting but is said with care.
  • mystery-teasing    – Creating intrigue around Scott's methods or lifestyle. Makes people want to ask more.
  • chit-chat          – Pure social conversation. No agenda, no value delivery. Just being human.
  • bonding-rapport    – Building personal connection through shared experiences or references.
  • gratitude          – Scott expressing genuine thanks. Rare but real.
  • curiosity          – Scott asking a question because he genuinely wants to know more.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  DIMENSION 2 — INTENT (single, pick the PRIMARY purpose)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  • acknowledgement    – Simply reacting to what was said. Emoji, "fire", "exactly". No sales agenda — just being present.
  • engagement-nurture – Keeping the conversation alive and building warmth. Makes the person feel seen and come back.
  • community-building – Reinforcing the identity and culture of Self-Improvement Nation.
  • authority-proofing – Demonstrating Scott's expertise or results without being asked. Builds credibility passively.
  • value-delivery     – Giving a specific, actionable insight or framework that is immediately useful.
  • close-to-call      – Inviting the person to book a call or DM. Only when they've shown clear buying signals.
  • social-proof       – Highlighting wins or transformations to attract others.
  • redirect           – Moving the conversation toward Scott's core offer. Smooth, not abrupt.
  • info-gathering     – Asking a question to learn more about the person's situation or goals.
  • lead-qualification – Probing to determine if this person is a coach who could become a buyer.
  • pain-agitation     – Amplifying someone's problem to make the need for a solution more urgent.
  • objection-handling – Addressing a doubt or pushback and flipping it into a reason to move forward.
  • funneling          – Directing the person toward Scott's community, program, or resources.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  DIMENSION 3 — SALES STAGE (single, where is THIS PERSON in their journey?)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  • awareness  – Person just discovered Scott. Make a good first impression. No selling.
  • engagement – Person is active but hasn't shown buying intent. Deepen the relationship.
  • nurture    – Person is warm and trusts Scott. Stay top of mind, deliver value.
  • ask        – Person has shown clear buying signals. Move them toward a call.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  CLASSIFICATION RULES
  ━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. Read the FULL thread context before classifying. The sales stage depends on the PERSON'S behavior, not Scott's reply.
  2. Short acknowledgements (emojis, "fire", single words) → intent: acknowledgement, tone: [brotherhood] or [hype], stage: nurture.
  3. When Scott teases future content or drops mystery → always include mystery-teasing or teasing-future-value in tone.
  4. Brotherhood tone is almost always present unless the reply is purely informational.
  5. Sales stage "ask" is rare — only when the person has explicitly said they want to buy, book, or inquire about the program.
  6. Never pick more than 4 tone tags. Less is more — only tag what is clearly there.
  7. Respond ONLY with valid JSON. No explanation. No markdown. No commentary.

  OUTPUT FORMAT (strict JSON, no other text):
  {"tone_tags": ["tag1", "tag2"], "intent": "intent-name", "sales_stage": "stage-name"}
SYSTEM

# ─── Helpers ─────────────────────────────────────────────────────────────────

def clean(text)
  return "" if text.nil?
  text.gsub(/[\u00A0]/, " ").strip
end

def build_user_prompt(post, thread, target_reply)
  post_author  = clean(post["original_post"]["author"])
  post_title   = clean(post["original_post"]["title"])
  post_body    = clean(post["original_post"]["body"])
  post_category = clean(post["original_post"]["category"])

  lines = []
  lines << "--- POST ---"
  lines << "Author: #{post_author}"
  lines << "Category: #{post_category}" unless post_category.empty?
  lines << "Title: #{post_title}"
  lines << ""
  lines << post_body
  lines << ""

  # Build the thread context (all comments + replies leading up to the target)
  thread_lines = build_thread_lines(thread, target_reply)

  unless thread_lines.empty?
    lines << "--- THREAD ---"
    lines.concat(thread_lines)
    lines << ""
  end

  # Isolate the exact message being replied to
  parent = find_parent(thread, target_reply)
  if parent
    lines << "--- REPLY TO ---"
    lines << "[#{clean(parent["author"])}]: #{clean(parent["content"])}"
  end

  lines.join("\n")
end

# Returns all thread lines UP TO (but not including) target_reply
def build_thread_lines(thread, target_reply)
  lines = []
  top_comment = thread["comment"]

  # Top-level comment
  comment_line = "[#{clean(top_comment["author"])}]: #{clean(top_comment["content"])}"
  return lines if top_comment.equal?(target_reply)
  lines << comment_line

  # Replies
  (thread["replies"] || []).each do |reply|
    break if reply.equal?(target_reply)
    lines << "  [#{clean(reply["author"])}]: #{clean(reply["content"])}"
  end

  lines
end

# Find the message that target_reply is responding to
def find_parent(thread, target_reply)
  top_comment = thread["comment"]
  replies = thread["replies"] || []

  # If target is a top-level comment, there's no parent in this thread
  return nil if top_comment.equal?(target_reply)

  # If target is the first reply, parent is the top comment
  if replies.first&.equal?(target_reply)
    return top_comment
  end

  # Otherwise, parent is the reply immediately before target
  replies.each_with_index do |reply, i|
    return replies[i - 1] if reply.equal?(target_reply) && i > 0
  end

  # Fallback: parent is the top comment
  top_comment
end

def build_assistant_output(tags)
  {
    "tone_tags"   => tags["tone_tags"],
    "intent"      => tags["intent"],
    "sales_stage" => tags["sales_stage"]
  }.to_json
end

# ─── Main ─────────────────────────────────────────────────────────────────────

data_path   = File.expand_path(File.join(__dir__, '..', 'data', 'posts_with_scott_reply_threads.json'))
output_path = File.expand_path(File.join(__dir__, '..', 'data', 'fine_tune', 'comments_classifier.jsonl'))

raw = File.read(data_path, encoding: 'utf-8')
# Normalize line endings (file may use CRLF on Windows)
raw = raw.gsub("\r\n", "\n").gsub("\r", "\n")

# The JSON file may be truncated — parse as many complete top-level posts as possible
begin
  data = JSON.parse(raw)
rescue JSON::ParserError
  # Truncated file: find the last complete top-level post boundary.
  # Each top-level post ends with '  },' followed by a newline + next post '  {'.
  # We find the last such boundary and truncate there.
  last_boundary = raw.rindex("\n  },\n  {")
  if last_boundary
    # Keep everything up to and including the '  },' then close the array
    safe_end = last_boundary + 5  # position just after '  },'
    truncated = raw[0...safe_end].rstrip.sub(/,\s*\z/, '') + "\n]"
    data = JSON.parse(truncated)
    $stderr.puts "⚠️  JSON was truncated — parsed #{data.length} complete posts."
  else
    raise
  end
end

examples     = []
skipped      = 0
total_tagged = 0

data.each do |post|
  (post["threads"] || []).each do |thread|

    # ── Check the top-level comment itself (rare — Scott can be a top commenter)
    top_comment = thread["comment"]
    if is_scott?(top_comment["author"]) && top_comment["tags"]
      total_tagged += 1
      user_content = build_user_prompt(post, thread, top_comment)
      assistant_content = build_assistant_output(top_comment["tags"])
      examples << {
        "messages" => [
          { "role" => "system",    "content" => SYSTEM_PROMPT },
          { "role" => "user",      "content" => user_content },
          { "role" => "assistant", "content" => assistant_content }
        ]
      }
    end

    # ── Check every reply in the thread
    (thread["replies"] || []).each do |reply|
      next unless is_scott?(reply["author"])
      next unless reply["tags"]

      total_tagged += 1
      user_content      = build_user_prompt(post, thread, reply)
      assistant_content = build_assistant_output(reply["tags"])

      examples << {
        "messages" => [
          { "role" => "system",    "content" => SYSTEM_PROMPT },
          { "role" => "user",      "content" => user_content },
          { "role" => "assistant", "content" => assistant_content }
        ]
      }
    end

  end
end

# ─── Write JSONL ──────────────────────────────────────────────────────────────

Dir.mkdir(File.dirname(output_path)) unless Dir.exist?(File.dirname(output_path))

File.open(output_path, 'w', encoding: 'utf-8') do |f|
  examples.each { |ex| f.puts(ex.to_json) }
end

puts "✅  Done!"
puts "   Posts processed : #{data.length}"
puts "   Tagged replies  : #{total_tagged}"
puts "   JSONL examples  : #{examples.length}"
puts "   Output          : #{output_path}"
