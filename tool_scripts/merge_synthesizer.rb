require 'json'

# ─── PATHS ───────────────────────────────────────
existing_path    = File.expand_path('../data/posts_with_scott_reply_threads.json', __dir__)
backup_path      = File.expand_path('../data/posts_with_scott_reply_threads_backup.json', __dir__)
synthesizer_path = File.expand_path('../scraper/output/synthesizer_data.json', __dir__)

# ─── LOAD EXISTING TAGGED DATA ──────────────────
existing = JSON.parse(File.read(existing_path))
puts "Loaded #{existing.length} existing tagged posts"

# ─── BACKUP BEFORE ANYTHING ─────────────────────
File.write(backup_path, JSON.pretty_generate(existing))
puts "Backup saved to: #{backup_path}"

# ─── BUILD DEDUP KEY SET FROM EXISTING ───────────
existing_keys = Set.new
existing.each do |post|
  url   = (post.dig("original_post", "url") || "").strip.downcase
  title = (post.dig("original_post", "title") || "").strip.downcase
  existing_keys << url unless url.empty?
  existing_keys << title unless title.empty?
end

# ─── FIND HIGHEST EXISTING ID ───────────────────
max_id = existing.map { |p| p["id"].to_i }.max || 0
puts "Highest existing ID: #{max_id}"

# ─── LOAD SYNTHESIZER DATA ──────────────────────
synth_data = JSON.parse(File.read(synthesizer_path))
synth_posts = synth_data["interactions"] || synth_data
puts "Loaded #{synth_posts.length} synthesizer posts"

# ─── FILTER TO SCOTT-INVOLVED & APPEND ──────────
added = 0
skipped_no_scott = 0
skipped_duplicate = 0

synth_posts.each do |post|
  # Check if Scott is in any thread
  scott_in_threads = (post["threads"] || []).any? do |thread|
    (thread.dig("comment", "author") || "").include?("Northwolf") ||
      (thread["replies"] || []).any? { |r| (r["author"] || "").include?("Northwolf") }
  end

  unless scott_in_threads
    skipped_no_scott += 1
    next
  end

  # Check for duplicates by URL or title
  url   = (post.dig("original_post", "url") || "").strip.downcase
  title = (post.dig("original_post", "title") || "").strip.downcase

  if existing_keys.include?(url) || existing_keys.include?(title)
    skipped_duplicate += 1
    next
  end

  # Assign new sequential ID
  max_id += 1
  post["id"] = max_id.to_s.rjust(3, "0")

  # Add empty tags (for Scott to tag in the tagger UI)
  post["tags"] ||= { "tone_tags" => [], "intent" => "", "sales_stage" => "" }

  # Add empty tags on replies too (consistent with existing structure)
  (post["threads"] || []).each do |thread|
    comment = thread["comment"] || {}
    if (comment["author"] || "").include?("Northwolf")
      comment["tags"] ||= { "tone_tags" => [], "intent" => "", "sales_stage" => "" }
    end
    (thread["replies"] || []).each do |reply|
      if (reply["author"] || "").include?("Northwolf")
        reply["tags"] ||= { "tone_tags" => [], "intent" => "", "sales_stage" => "" }
      end
    end
  end

  existing << post
  existing_keys << url unless url.empty?
  existing_keys << title unless title.empty?
  added += 1
end

# ─── SAVE ────────────────────────────────────────
File.write(existing_path, JSON.pretty_generate(existing))

puts ""
puts "=" * 50
puts "MERGE COMPLETE"
puts "=" * 50
puts "  Previously tagged posts:  #{existing.length - added}"
puts "  Scott posts in synthesizer: #{added + skipped_duplicate}"
puts "  New posts added:          #{added}"
puts "  Duplicates skipped:       #{skipped_duplicate}"
puts "  Non-Scott skipped:        #{skipped_no_scott}"
puts "  Total posts now:          #{existing.length}"
puts "  New ID range:             #{(max_id - added + 1).to_s.rjust(3, '0')} - #{max_id.to_s.rjust(3, '0')}" if added > 0
puts "  Saved to: #{existing_path}"
puts "  Backup at: #{backup_path}"
puts "=" * 50
