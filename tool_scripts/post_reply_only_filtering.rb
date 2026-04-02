require 'json'

def clean_text(text)
  return text unless text.is_a?(String)
  text.gsub(/\u00A0/, ' ').gsub(/\s+/, ' ').strip
end

def clean_body(text)
  return "" if text.nil?

  text = text.gsub(/\u00A0/, ' ')

  # Remove leading garbage like "2Benjamin S.🔥11d •"
  text = text.gsub(/^\d+.*?•\s*/, '')

  # Remove "Last comment ..." stuff
  text = text.gsub(/Last comment.*$/i, '')

  # Fix merged words (lowercase-uppercase boundary)
  text = text.gsub(/([a-z])([A-Z])/, '\1 \2')

  # Remove extra symbols
  text = text.gsub(/[•]+/, '')

  # Normalize spaces
  text = text.gsub(/\s+/, ' ').strip

  text
end

# Read the JSON file
file_path = File.expand_path('../data/posts_with_scott_reply_threads.json', __dir__)
data = File.read(file_path)

# Parse and print the JSON
parsed_data = JSON.parse(data)
final_posts = []
parsed_data.each do |post|
  threads = post['threads']
  scott_comments = []
  threads.each do |thread|
    c = thread['comment']
    if c['author'].gsub(/\u00A0/, ' ') == "Scott Northwolf"
      scott_comments << c
    end
  end
  end_post = {}
  if scott_comments.any?
    end_post["id"] = post["id"]
    cleaned_post = post["original_post"].dup
    cleaned_post["body"] = clean_body(cleaned_post["body"])

    cleaned_post["author"] = clean_text(cleaned_post["author"])
    cleaned_post["title"]  = clean_text(cleaned_post["title"])
    cleaned_post["body"]   = clean_text(cleaned_post["body"])

    end_post["original_post"] = cleaned_post

    best = scott_comments.max_by { |r| (r["content"] || "").length }
    scotts_comment = best["content"].split(/To pick up a draggable item/i)[0]
    scotts_tags = best["tags"]
    scotts_comment = scotts_comment
  .gsub(/\.(?!\s)/, '. ')
  .gsub(/!(?!\s)/, '! ')
  .gsub(/\s+/, ' ')
  .strip

scotts_comment = clean_text(scotts_comment)
    end_post["comment"] = scotts_comment
    if scotts_tags.is_a?(Hash)
      end_post["tone"] = scotts_tags["tone_tags"] || []
      end_post["intent"] = scotts_tags["intent"] || ""
      end_post["sales_stage"] = scotts_tags["sales_stage"] || ""
    end
    final_posts << end_post
  end
end

# Write the final posts to a new JSON file
output_path = File.expand_path('../data/posts_with_scott_reply.json', __dir__)
File.write(output_path, JSON.pretty_generate(final_posts))