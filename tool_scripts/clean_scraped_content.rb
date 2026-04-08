require 'json'

# ─── PATHS ───────────────────────────────────────
data_path   = File.expand_path('../data/posts_with_scott_reply_threads.json', __dir__)
backup_path = File.expand_path('../data/posts_with_scott_reply_threads_backup_recent.json', __dir__)

# ─── LOAD ────────────────────────────────────────
data = JSON.parse(File.read(data_path))
puts "Loaded #{data.length} posts"

# ─── BACKUP ─────────────────────────────────────
File.write(backup_path, JSON.pretty_generate(data))
puts "Backup saved to: #{backup_path}"

# ─── GARBAGE PATTERNS ───────────────────────────
# These are UI artifacts from Skool's page that .textContent captures:
#   1. Drag-and-drop accessibility text
#   2. Emoji picker contents (categories + thousands of emojis)
#   3. "Drop files here to upload" from file upload UI
#   4. "Like" / "Reply" button text appended to content
#   5. Comment count text like "284 comments"
#   6. Timestamp/metadata cruft: "5New comment 1h ago"

GARBAGE_REGEXES = [
  # Drag-and-drop accessibility block (always starts with "\n    To pick up a draggable")
  /\n?\s*To pick up a draggable item.*?press escape to cancel\.\s*/m,

  # Emoji picker dump — starts with "Drop files here to upload" or "Recently Used" and runs to the end
  /\s*Drop files here to upload.*\z/m,
  /\s*Recently UsedSmileys & People.*\z/m,
  /\s*Recently Used.*(?:Flags|Symbols).*\z/m,

  # Individual emoji category headers that might appear without the full picker
  /\s*(?:Smileys & People|Animals & Nature|Food & Drink|Travel & Places|Activities|Objects|Symbols|Flags)[^\n]{0,20}(?=\z)/,

  # Trailing "Like" / "Reply" button text that gets captured
  /\d*\s*Reply\s*$/,

  # Trailing video timestamps like "3:42" or "2:05" at end of content  
  /\s+\d{1,2}:\d{2}\s*$/,
]

# ─── CLEAN FUNCTION ─────────────────────────────
def clean_content(text)
  return text if text.nil? || text.empty?

  cleaned = text.dup
  GARBAGE_REGEXES.each do |rx|
    cleaned.gsub!(rx, '')
  end
  cleaned.strip
end

def has_garbage?(text)
  return false if text.nil? || text.empty?
  t = text.downcase
  t.include?('pick up a draggable') ||
    t.include?('drop files here') ||
    t.include?('recently usedsmileys') ||
    t.include?('smileys & people') ||
    t.include?('animals & nature')
end

# ─── PROCESS ALL POSTS ──────────────────────────
cleaned_count = 0
field_count   = 0

data.each do |post|
  post_dirty = false

  # Clean original_post body
  body = post.dig("original_post", "body") || ""
  if has_garbage?(body)
    post["original_post"]["body"] = clean_content(body)
    post_dirty = true
    field_count += 1
  end

  # Clean threads
  (post["threads"] || []).each do |thread|
    # Clean comment content
    comment = thread["comment"] || {}
    content = comment["content"] || ""
    if has_garbage?(content)
      comment["content"] = clean_content(content)
      post_dirty = true
      field_count += 1
    end

    # Clean reply content
    (thread["replies"] || []).each do |reply|
      rc = reply["content"] || ""
      if has_garbage?(rc)
        reply["content"] = clean_content(rc)
        post_dirty = true
        field_count += 1
      end
    end
  end

  cleaned_count += 1 if post_dirty
end

# ─── VERIFY ─────────────────────────────────────
remaining = 0
data.each do |post|
  body = post.dig("original_post", "body") || ""
  remaining += 1 if has_garbage?(body)
  (post["threads"] || []).each do |thread|
    content = (thread["comment"] || {})["content"] || ""
    remaining += 1 if has_garbage?(content)
    (thread["replies"] || []).each do |reply|
      remaining += 1 if has_garbage?(reply["content"] || "")
    end
  end
end

# ─── SAVE ────────────────────────────────────────
File.write(data_path, JSON.pretty_generate(data))

puts ""
puts "=" * 50
puts "CLEANUP COMPLETE"
puts "=" * 50
puts "  Posts cleaned:         #{cleaned_count}"
puts "  Fields cleaned:        #{field_count}"
puts "  Remaining garbage:     #{remaining}"
puts "  Total posts:           #{data.length}"
puts "  Saved to: #{data_path}"
puts "  Backup at: #{backup_path}"
puts "=" * 50
puts ""
puts "NOTE: This only strips UI artifacts from text."
puts "Posts with 'see more' truncation still need re-scraping"
puts "with: cd scraper && node rescrape_see_more.js"
