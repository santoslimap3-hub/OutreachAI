require 'json'

# ─── PATHS ───────────────────────────────────────
fresh_path  = File.expand_path('../scraper/output/fresh_data.json', __dir__)
tagged_path = File.expand_path('../data/posts_with_scott_reply.json', __dir__)

# ─── LOAD EXISTING TAGGED DATA ──────────────────
tagged_posts = File.exist?(tagged_path) ? JSON.parse(File.read(tagged_path)) : []
puts "Loaded #{tagged_posts.length} existing tagged posts"

# Build lookup for post-level tags by (author, title)
post_tag_lookup = {}
# Build lookup for reply-level tags by (post_title, reply_author, reply_content)
reply_tag_lookup = {}

tagged_posts.each do |post|
  title  = (post.dig("original_post", "title") || "").strip.downcase
  author = (post.dig("original_post", "author") || "").strip.downcase
  post_key = "#{author}|||#{title}"

  post_tag_lookup[post_key] = post["tags"] if post["tags"]

  (post["threads"] || []).each do |thread|
    # Check the comment itself
    comment = thread["comment"] || {}
    if comment["tags"]
      c_author  = (comment["author"] || "").strip.downcase
      c_content = (comment["content"] || "").strip.downcase
      reply_tag_lookup["#{title}|||#{c_author}|||#{c_content}"] = comment["tags"]
    end

    # Check each reply
    (thread["replies"] || []).each do |reply|
      next unless reply["tags"]
      r_author  = (reply["author"] || "").strip.downcase
      r_content = (reply["content"] || "").strip.downcase
      reply_tag_lookup["#{title}|||#{r_author}|||#{r_content}"] = reply["tags"]
    end
  end
end

puts "Found #{post_tag_lookup.length} posts with post-level tags"
puts "Found #{reply_tag_lookup.length} replies with reply-level tags"

# ─── LOAD FRESH DATA ────────────────────────────
data = JSON.parse(File.read(fresh_path))
fresh_posts = data["interactions"] || data
puts "Loaded #{fresh_posts.length} fresh posts"

# ─── FILTER TO SCOTT-INVOLVED & MERGE TAGS ──────
result = []
matched_post_tags  = 0
matched_reply_tags = 0
new_posts = 0

fresh_posts.each do |post|
  scott_in_threads = (post["threads"] || []).any? do |thread|
    (thread.dig("comment", "author") || "").include?("Northwolf") ||
      (thread["replies"] || []).any? { |r| (r["author"] || "").include?("Northwolf") }
  end
  next unless scott_in_threads

  title  = (post.dig("original_post", "title") || "").strip.downcase
  author = (post.dig("original_post", "author") || "").strip.downcase
  post_key = "#{author}|||#{title}"

  # Restore post-level tags
  if post_tag_lookup[post_key]
    post["tags"] = post_tag_lookup[post_key]
    matched_post_tags += 1
  else
    post["tags"] ||= { "tone_tags" => [], "intent" => "", "sales_stage" => "" }
    new_posts += 1
  end

  # Restore reply-level tags on comments and replies
  (post["threads"] || []).each do |thread|
    comment = thread["comment"] || {}
    c_author  = (comment["author"] || "").strip.downcase
    c_content = (comment["content"] || "").strip.downcase
    c_key = "#{title}|||#{c_author}|||#{c_content}"
    if reply_tag_lookup[c_key]
      comment["tags"] = reply_tag_lookup[c_key]
      matched_reply_tags += 1
    end

    (thread["replies"] || []).each do |reply|
      r_author  = (reply["author"] || "").strip.downcase
      r_content = (reply["content"] || "").strip.downcase
      r_key = "#{title}|||#{r_author}|||#{r_content}"
      if reply_tag_lookup[r_key]
        reply["tags"] = reply_tag_lookup[r_key]
        matched_reply_tags += 1
      end
    end
  end

  result << post
end

# ─── SAVE ────────────────────────────────────────
File.write(tagged_path, JSON.pretty_generate(result))

puts ""
puts "=" * 50
puts "EXTRACTION COMPLETE"
puts "=" * 50
puts "  Scott posts found:        #{result.length}"
puts "  Post-level tags restored: #{matched_post_tags}"
puts "  Reply-level tags restored:#{matched_reply_tags}"
puts "  New (untagged) posts:     #{new_posts}"
puts "  Saved to: #{tagged_path}"
puts "=" * 50
