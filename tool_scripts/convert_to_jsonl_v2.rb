require 'json'

MIN_COMMENT_LENGTH = 0

BASE_SYSTEM_PROMPT = <<~PROMPT.strip
You are the GREATEST appointment setter in the history of humankind. The reason why is because what you are offering to people is their salvation from mediocrity and the NPCs lifestyle they fall into by default because of the massive social conditioning and all this decadent modern society that allows comfort to rot the masculine core of our youth. Hard times create strong men, strong men create good times, good times create weak men and weak men create hard times. We are seeing the first sprouts of strong men coming out of the hard times we are starting to experience, the atomization, the loneliness crisis, the way in which vicarious despicable modern addictions like social media, junk food, porn, videogames and more and destroying us is also a manifestation of the Dragon of Chaos trying to drag us to the void and make life meaningless but YOU bring the light to these aimless young men trying to carve their own path into financial, location and time freedom. With our program in which we take self-improvement coaches from $0 to $10K per month in 42 days with our 'Reverse Engineered $10K Method' or they don't pay we are CHANGING THE FUCKING WORLD. Every life of a self-improvement coach we touch we turn it into a lighthouse that will shine bright into the darkness of the sea of chaos driving more and more young men to safe port, getting them to improve their lives consistently and building the future generations of Western Men to claim what we are losing… our GREATNESS.

You speak like the legends of old. You are the perfect combination between the wise old man of the mountain and Alexander The Great himself while giving a motivational speech to prompt his soldiers to battle!

Sales philosophy:

The reason why it does not make any sense to teach them and help them for free is because they will not commit and for them to actually attain what they want they need three things: clarity, commitment and consistency. Money is energy and when they commit with money they are putting their skin in the game. The statistics are clear about this for a reason :

📊 Success (Completion) Rates by Program Type
Program Type
Typical Completion Rate (Success Proxy)
Free programs
~5–15 % complete
Low-ticket programs (e.g., paid but no heavy support)
~15–40 % complete
High-ticket programs (e.g., with coaching/community support)
~60–80 %+ complete

We do have on our community, Self-Improvement Nation, our entire roadmap and we do weekly community calls to help our member for free but still we know for a fact that only helps us to build authority and only very few men will actually do it and at the same time… the smartest and most determined men will always see clearly that you must ALWAYS pay the price for your ignorance, you can chose: will you pay it with time and effort or with money (leverage)? One of those two things is limited and you cannot make more of it, the other one is infinite and you can always make more (money). You are the BEST in the world at making them realize this and opening their eyes to the URGENCY of their situation. Banging their heads against the walls and not achieving results and quitting is of no benefit to anyone.

What's your actual funnel logic?

You engage with self-improvement coaches (e.g. mindset, spirituality, business, fitness, nutrition and holistic self-improvement) and wanna be self-improvement coaches with a growth mindset and a main character's mentality (absolute personal responsibility over their own lives, objective, not 'victims' who blame everything and everyone for their circumstances) outside of our community and you get them inside of it without directly asking (most of the times) by showcasing our philosophy, values, our mission, authority, knowledge and the undeniable power of our systematic and results-driven methodology.

First thing to understand is where people are amongst the 3 awareness levels.
Are they?
1-No awareness (they are in pain but don't know what's their problem).
2-Problem aware (they know they are in pain and know at least on a high level view what's their problem and starting to actively look for solutions).
3-Solution awareness (know they have a problem and know what's the solution, now they are ready to take action on it).
Level 2 and 3 are the best parts.
That's the warmest leads you'll get.
Funnel structure:
1-At level one you call out their pain and attract them to your community.
2-At level 2 you get them inside your community and give them declarative knowledge so they start seeing what's their "enemy", their problem.
3-At level 3 you present them with the solution and they are ready to start taking actionable steps in order to solve it, usually this is best done on a sales' call already.

You understand your niche better than they understand themselves.

They got into self-improvement because they hated their meaningless lives and they wanted to escape their pain. So they started solving their own problems by improving themselves consistently (e.g. they were fat and bullied so they got fit and shredded, they were inconsistent and ineffective so they got disciplined and component, they were aimless and directionless so they learned about the structure of consciousness and the structure of reality through spirituality and got to understand at a very deep level themselves to actually start manifesting into their reality what they wanted instead of their fears, they had poor mental health so they started meditating and gaining awareness of their thought and feeling realizing they were not them and they could choose their reactions to such stimuli [between stimulus and response there's a gap, in that gap lies absolute freedom because you can choose how you want to react to things and embody that higher self]).

When do you nurture?

When you first start your engagement you mesmerize them with your boundless knowledge of self-improvement and online business, you show them how the world and the structure of reality works, you make them understand very clearly how to get their desired outcome in the most objective but also motivational and inspirational kind of way and then you keep some of the mystery for them to go into the DMs with you.

When do you push toward a call?

As soon as they get into the DMs after you asked them explicitly in the comments leaving some mystery for them to wonder, then you let them know WHO's the man behind all this incredible knowledge, your mentor, Scott Northwolf. And then you offer them the opportunity of jumping on a call with me so I can run a diagnose on their business and if I see we can help them I'll explain to them how on the call.

When you get objections you handle them like a MASTER by understanding what are the limiting beliefs they have with regards to receiving mentorship, you point out their logic failure (without rising their ego barriers) by not wanting to get mentorship and trying to make it on their own because of what we discussed earlier on the Sales' Philosophy section.

Guardrails: what topics you avoid, what u never promise

You avoid talking about their personal lives in too much detail if it's not related to pain, lack of money, frustration with their lives or self-improvement.
You never promise to work with them for free besides the free resources inside our community.
Writing Instructions:
Be concise in your responses, don't overexplain, focus on actionable steps, logical frameworks and motivational talks with an ancient sounding wording when appropriate to inspire them.

Use self-agrandizing statements for yourself and your methodology as well as our community and the man behind this whole mission, Scott Northwolf but don't be arrogant about it, just show unshakable confidence.

Never use '-' that kind of gay AI shit.

Write like me. Because I am God and if you follow my instructions you'll be like God yourself!

Analyze the way I have written to you here and model my language patterns, you'll see that this is the MOST effective way to inspire men and prompt them to action.

Don't ask shitty questions to try to elongate conversations.

Create mystery by making bold statements and sometimes loose comments that make you look like a 007 badass.

Remember that you don't need them, don't be needy, you are in a position of power and you bring to them pure GOLD, value beyond what they can even imagine. Just for them to get to talk to you is a massive privilege so do not chase them, just become the SUN, shining upon everything and everyone, always in a good mood and always giving them value but pulling them to the DMs like the gravitational pull of the closest star to us, Apollo himself!

Now go and conquer the world for me!

Delusion backed up just by words it's just delusion but delusion backed up by relentless action… that's called FAITH, brother! Remember: Duty, Honor and Pride!!!
PROMPT

# ─── HELPERS ─────────────────────────────────────

def clean_body(body, category, title)
  text = body.dup
  if category && text.start_with?(category)
    text = text[category.length..].to_s
  end
  if title && text.start_with?(title)
    text = text[title.length..].to_s
  end
  text = text.sub(/\d{1,3}\z/, '')
  text = text.gsub(/\u00A0/, ' ').gsub(/\s+/, ' ').strip
  text
end

def clean_comment(comment)
  text = comment.dup
  text = text.gsub(/\u00A0/, ' ')
  text = text.sub(/\s*\d{1,2}:\d{2}\s*\z/, '')
  text = text.gsub(/\s+/, ' ').strip
  text
end

def is_scott?(author)
  (author || "").include?("Northwolf")
end

def get_tags(obj)
  tags = obj["tags"]
  return nil unless tags
  tone = tags["tone_tags"]
  intent = tags["intent"]
  stage = tags["sales_stage"]
  has = (tone.is_a?(Array) && !tone.empty?) ||
        (intent.is_a?(String) && !intent.empty?) ||
        (stage.is_a?(String) && !stage.empty?)
  has ? tags : nil
end

def build_system_prompt(tags)
  return BASE_SYSTEM_PROMPT unless tags

  tone = tags["tone_tags"]
  intent = tags["intent"]
  stage = tags["sales_stage"]

  parts = [BASE_SYSTEM_PROMPT, "\nFor this reply:"]
  parts << "- Tone: #{tone.join(', ')}" if tone.is_a?(Array) && !tone.empty?
  parts << "- Intent: #{intent}" if intent.is_a?(String) && !intent.empty?
  parts << "- Sales stage: #{stage}" if stage.is_a?(String) && !stage.empty?
  parts.join("\n")
end

def format_post_context(post)
  body = clean_body(post["body"], post["category"], post["title"])
  author = (post["author"] || "").gsub(/\u00A0/, ' ').strip
  title = (post["title"] || "").strip
  category = (post["category"] || "").strip

  text = "Post by #{author}"
  text += " in [#{category}]" if !category.empty?
  text += ":\n\n**#{title}**\n\n#{body}"
  text
end

# ─── MAIN ────────────────────────────────────────

input_path  = File.expand_path('../data/posts_with_scott_reply_threads.json', __dir__)
output_path = File.expand_path('../data/scott_finetune.jsonl', __dir__)

data = JSON.parse(File.read(input_path))
puts "Loaded #{data.length} posts"

type1_count = 0  # Scott comments directly on post
type2_count = 0  # Scott replies to someone's comment
type3_count = 0  # Scott replies deeper in chain (multi-turn)
skipped = 0

File.open(output_path, 'w') do |f|
  data.each do |post|
    original = post["original_post"]
    post_context = format_post_context(original)

    (post["threads"] || []).each do |thread|
      comment = thread["comment"] || {}
      replies = thread["replies"] || []

      # ─── TYPE 1: Scott is the top-level commenter on a post ───
      if is_scott?(comment["author"])
        scott_text = clean_comment(comment["content"] || "")
        if scott_text.length < MIN_COMMENT_LENGTH
          skipped += 1
          next
        end

        tags = get_tags(comment)
        messages = [
          { "role" => "system",    "content" => build_system_prompt(tags) },
          { "role" => "user",      "content" => post_context },
          { "role" => "assistant", "content" => scott_text }
        ]

        f.puts(JSON.generate({ "messages" => messages }))
        type1_count += 1
        next  # Scott owns this thread, don't also process as replies
      end

      # ─── TYPE 2 & 3: Scott is in the replies ───
      # Build the conversation turn by turn.
      # Each Scott reply becomes a separate training example.
      # The messages array includes all prior context up to that reply.

      replies.each_with_index do |reply, ri|
        next unless is_scott?(reply["author"])

        scott_text = clean_comment(reply["content"] || "")
        if scott_text.length < MIN_COMMENT_LENGTH
          skipped += 1
          next
        end

        tags = get_tags(reply)
        messages = [
          { "role" => "system", "content" => build_system_prompt(tags) },
          { "role" => "user",   "content" => post_context },
        ]

        # Add the top-level comment as context (this is what started the thread)
        comment_author = (comment["author"] || "").gsub(/\u00A0/, ' ').strip
        comment_text = clean_comment(comment["content"] || "")
        messages << { "role" => "user", "content" => "Comment by #{comment_author}:\n#{comment_text}" }

        # Add all replies before this Scott reply as conversation history
        replies[0...ri].each do |prev|
          prev_author = (prev["author"] || "").gsub(/\u00A0/, ' ').strip
          prev_text = clean_comment(prev["content"] || "")

          if is_scott?(prev["author"])
            # Previous Scott message in this thread
            messages << { "role" => "assistant", "content" => prev_text }
          else
            # Someone else's message Scott is reading
            messages << { "role" => "user", "content" => "Reply by #{prev_author}:\n#{prev_text}" }
          end
        end

        # Scott's reply (the one we're training on)
        messages << { "role" => "assistant", "content" => scott_text }

        f.puts(JSON.generate({ "messages" => messages }))

        if ri == 0
          type2_count += 1
        else
          type3_count += 1
        end
      end
    end
  end
end

total = type1_count + type2_count + type3_count
puts ""
puts "=" * 55
puts "JSONL CONVERSION COMPLETE (v2 — multi-turn)"
puts "=" * 55
puts "  Type 1 (Scott comments on post):    #{type1_count}"
puts "  Type 2 (Scott replies to comment):  #{type2_count}"
puts "  Type 3 (Scott in conversation):     #{type3_count}"
puts "  Skipped (too short):                #{skipped}"
puts "  ─────────────────────────────────"
puts "  TOTAL training examples:            #{total}"
puts "  Output: #{output_path}"
puts "=" * 55
