/**
 * Fix ALL post bodies in posts_with_scott_reply_threads.json
 * 
 * Problem: body contains metadata prefix (likes, author, badges, timestamp, category, title)
 * and metadata suffix (likes, comments count, "Last comment X ago")
 * 
 * Two formats:
 * - Posts 0-74: everything on ONE line, no newlines
 *   Pattern: {likes}{author}{badges}{ts} • {cat}{title}{BODY}{likes}{comments}Last comment X ago
 * - Posts 75-203: multiline with newlines
 *   Already fixed by fix_synth_posts2.js but some still have suffix cruft
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "posts_with_scott_reply_threads.json");
const BACKUP_PATH = DATA_PATH.replace(".json", "_backup_bodyfix.json");

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
console.log("Total posts:", data.length);

let fixed = 0;

for (let i = 0; i < data.length; i++) {
    const post = data[i];
    let body = post.original_post.body || "";
    const title = post.original_post.title || "";
    const author = post.original_post.author || "";

    if (!body || !title) continue;

    const originalBody = body;

    // ─── Strip prefix: everything up to and including the title ───
    // The title appears in the body, everything before it (including the title itself) is metadata
    const titleIdx = body.indexOf(title);
    if (titleIdx !== -1) {
        body = body.substring(titleIdx + title.length);
    }

    // ─── Strip suffix: trailing metadata ───
    // Pattern 1 (single line): "2541New comment 9h ago" or "510Last comment 23h ago"  
    // Pattern 2: "25Last comment 15h ago"
    // Pattern 3: just ends with "30 comments" or similar
    // General: {likes}{comments}(New|Last) comment {time} ago
    body = body.replace(/\d+\d*(New|Last) comment \S+ ago\s*$/, "");

    // Also strip trailing "{number}{number} comments" if present
    body = body.replace(/\d+\d+ comments?\s*$/, "");

    // Strip leading/trailing whitespace
    body = body.trim();

    if (body !== originalBody) {
        post.original_post.body = body;
        fixed++;

        if (i < 5 || [64, 100, 150, 203].includes(i)) {
            console.log(`[FIXED] Post ${i}: "${title.substring(0, 50)}"`);
            console.log(`  BEFORE (${originalBody.length}): ${originalBody.substring(0, 120)}...`);
            console.log(`  AFTER  (${body.length}): ${body.substring(0, 120)}${body.length > 120 ? "..." : ""}`);
            console.log("");
        }
    }
}

console.log("\n=== SUMMARY ===");
console.log("Fixed:", fixed, "of", data.length, "posts");

// Backup and save
fs.writeFileSync(BACKUP_PATH, fs.readFileSync(DATA_PATH));
console.log("Backup:", BACKUP_PATH);
fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log("Saved:", DATA_PATH);

// Verify
console.log("\n=== VERIFICATION ===");
const v = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
[0, 1, 3, 4, 64, 65, 76, 100, 150, 203].forEach(i => {
    const p = v[i];
    const b = p.original_post.body || "";
    const t = p.original_post.title || "";
    const hasTitleInBody = t && b.includes(t);
    const hasMetaSuffix = b.match(/(New|Last) comment .+ ago\s*$/);
    console.log(`Post ${i}: "${t.substring(0, 40)}" | body(${b.length}): "${b.substring(0, 80)}${b.length > 80 ? "..." : ""}" | title in body: ${hasTitleInBody} | suffix: ${!!hasMetaSuffix}`);
});