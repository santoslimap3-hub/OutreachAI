require 'json'

# ─── PATHS ───────────────────────────────────────
fresh_sin_path = File.expand_path('../scraper/output/skool_data.json', __dir__)
fresh_synth_path = File.expand_path('../scraper/output/synthesizer_data.json', __dir__)
tagged_path = File.expand_path('../data/posts_with_scott_reply.json', __dir__)
output_path = File.expand_path('../data/posts_with_scott_reply_updated.json', __dir__)

# ─── LOAD TAGGED DATA ────────────────────────────
tagged_posts = JSON.parse(File.read(tagged_path))
puts "Loaded #{tagged_posts.length} tagged posts"

# Build a lookup of tags by post title + author
# This is how we match old tagged posts to new fresh posts
tag_lookup = {}
tagged_posts.each do |post|
  title = (post.dig("original_post", "title") || "").strip.downcase
  author = (post.dig("original_post", "author") || "").strip.downcase
  key = "#{author}|||#{title}"
  tag_lookup[key] = post["tags"] if post["tags"]
end
puts "Found #{tag_lookup.length} posts with tags"

# ─── LOAD FRESH DATA ─────────────────────────────
fresh_posts = []

[fresh_sin_path, fresh_synth_path].each do |path|
  next unless File.exist?(path)
  data = JSON.parse(File.read(path))
  posts = data["interactions"] || data
  puts "Loaded #{posts.length} posts from #{File.basename(path)}"
  fresh_posts.concat(posts)
end

puts "Total fresh posts: #{fresh_posts.length}"

# ─── FILTER TO SCOTT ONLY & MERGE TAGS ────────────
result = []
matched_tags = 0
unmatched_tags = 0

fresh_posts.each do |post|
  scott_involved = (post["threads"] || []).any? do |thread|
    (thread.dig("comment", "author") || "").include?("Northwolf") ||
      (thread["replies"] || []).any? { |r| (r["author"] || "").include?("Northwolf") }
  end
  next unless scott_involved

  # Try to find existing tags for this post
  title = (post.dig("original_post", "title") || "").strip.downcase
  author = (post.dig("original_post", "author") || "").strip.downcase
  key = "#{author}|||#{title}"

  if tag_lookup[key]
    post["tags"] = tag_lookup[key]
    matched_tags += 1
  else
    post["tags"] = { "tone_tags" => [], "intent" => "", "sales_stage" => "" }
    unmatched_tags += 1
  end

  result << post
end

# ─── SAVE ─────────────────────────────────────────
File.write(output_path, JSON.pretty_generate(result))

puts ""
puts "═" * 50
puts "MERGE COMPLETE"
puts "═" * 50
puts "  Scott posts found:    #{result.length}"
puts "  Tags preserved:       #{matched_tags}"
puts "  New (untagged) posts: #{unmatched_tags}"
puts "  Saved to: #{output_path}"
puts "═" * 50
