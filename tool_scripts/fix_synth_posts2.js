/**
 * Fix broken Synthesizer posts in posts_with_scott_reply_threads.json
 *
 * Issues:
 * 1. body contains entire page dump including all comments
 * 2. category is empty (but embedded in body)
 * 3. timestamp is empty (but embedded in body)
 * 4. scott_involved is wrong (non-breaking space in author names)
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "posts_with_scott_reply_threads.json");
const BACKUP_PATH = DATA_PATH.replace(".json", "_backup_prefix.json");

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
console.log("Total posts:", data.length);

function isScott(name) {
    if (!name) return false;
    return name.replace(/\u00a0/g, " ").trim() === "Scott Northwolf";
}

// ─── PASS 1: Fix scott_involved for ALL posts ───
let scottFixCount = 0;
for (let i = 0; i < data.length; i++) {
    const post = data[i];
    let scottInvolved = false;

    // Check post author
    if (isScott(post.original_post.author)) {
        scottInvolved = true;
    }

    // Check thread comments and replies
    if (!scottInvolved && post.threads) {
        for (const thread of post.threads) {
            if (thread.comment && isScott(thread.comment.author)) {
                scottInvolved = true;
                break;
            }
            if (thread.replies) {
                for (const reply of thread.replies) {
                    if (isScott(reply.author)) {
                        scottInvolved = true;
                        break;
                    }
                }
            }
            if (scottInvolved) break;
        }
    }

    if (post.scott_involved !== scottInvolved) {
        scottFixCount++;
        post.scott_involved = scottInvolved;
    }
}
console.log("scott_involved fixed for", scottFixCount, "posts\n");

// ─── PASS 2: Fix broken body/category/timestamp for Synthesizer posts ───
let fixed = 0;
let skipped = 0;

for (let i = 75; i < data.length; i++) {
    const post = data[i];
    const body = post.original_post.body;
    const url = post.original_post.url || "";

    if (!url.includes("synthesizer")) { skipped++; continue; }
    if (!body || body.length === 0) {
        console.log(`[SKIP] Post ${i}: no body (${post.original_post.title || url})`);
        skipped++;
        continue;
    }

    // Check if body has the comment dump pattern
    const hasCommentDump = body.match(/\n(?:Like|Liked)\n/);
    if (!hasCommentDump) {
        // Also check if body ends with "N comments" without further dump
        if (!body.match(/\d+ comments?$/)) {
            console.log(`[SKIP] Post ${i}: body seems clean (${post.original_post.title})`);
            skipped++;
            continue;
        }
    }

    const lines = body.split("\n");
    let lineIdx = 0;

    // Skip like count line (standalone number)
    if (lines[0] && lines[0].match(/^\d+$/)) {
        lineIdx = 1;
    }

    // Skip author name line
    if (lines[lineIdx] && lines[lineIdx].replace(/\u00a0/g, " ").trim() === post.original_post.author.replace(/\u00a0/g, " ").trim()) {
        lineIdx++;
    }

    // Skip badge lines (short emoji lines like "🥷", "🔥", "⭐")
    while (lineIdx < lines.length) {
        const line = lines[lineIdx].trim();
        if (line.length > 0 && line.length <= 5 && !line.match(/[a-zA-Z0-9]{3,}/)) {
            lineIdx++;
        } else {
            break;
        }
    }

    // Parse "timestamp • category" line
    let parsedTimestamp = "";
    let parsedCategory = "";
    const currentLine = lines[lineIdx] || "";
    const tsMatch = currentLine.match(/^(.+?)\s*•\s*(.+)$/);
    if (tsMatch) {
        parsedTimestamp = tsMatch[1].trim().replace(/\s*\(edited\)\s*/, " ").trim();
        parsedCategory = tsMatch[2].trim();
        lineIdx++;
    }

    // Skip title line
    const title = post.original_post.title;
    if (title && lines[lineIdx] && lines[lineIdx].trim() === title) {
        lineIdx++;
    }

    // Collect body lines until Like/Liked marker
    const bodyLines = [];
    for (let j = lineIdx; j < lines.length; j++) {
        const line = lines[j];
        if ((line === "Like" || line === "Liked") && j + 1 < lines.length) {
            const nextLine = lines[j + 1];
            if (nextLine && nextLine.match(/^[\d,.]+k?$/i)) {
                break;
            }
        }
        bodyLines.push(line);
    }

    // Trim trailing empty lines
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
        bodyLines.pop();
    }

    const cleanBody = bodyLines.join("\n").trim();
    const oldLen = body.length;

    // Apply fixes
    if (!post.original_post.category && parsedCategory) {
        post.original_post.category = parsedCategory;
    }
    if (!post.original_post.timestamp && parsedTimestamp) {
        post.original_post.timestamp = parsedTimestamp;
    }
    post.original_post.body = cleanBody;

    fixed++;
    console.log(`[FIXED] Post ${i}: "${title}" | body: ${oldLen} → ${cleanBody.length} | cat: "${parsedCategory}" | ts: "${parsedTimestamp}" | scott: ${post.scott_involved}`);
}

console.log("\n=== SUMMARY ===");
console.log("Body fixed:", fixed);
console.log("Skipped:", skipped);
console.log("scott_involved fixed:", scottFixCount);

// Backup and save
fs.writeFileSync(BACKUP_PATH, fs.readFileSync(DATA_PATH));
console.log("\nBackup:", BACKUP_PATH);
fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log("Saved:", DATA_PATH);

// Verify
console.log("\n=== VERIFICATION ===");
const v = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
[0, 76, 100, 150, 203].forEach(i => {
    const p = v[i];
    const hasReply = p.original_post.body && p.original_post.body.includes("\nReply\n");
    console.log(`Post ${i}: "${(p.original_post.title || "").substring(0, 40)}" | cat: "${p.original_post.category}" | ts: "${p.original_post.timestamp}" | body: ${(p.original_post.body || "").length} | Reply in body: ${hasReply} | scott: ${p.scott_involved}`);
});

// Count scott_involved=true
const scottTrue = v.filter(p => p.scott_involved).length;
console.log("\nTotal posts with scott_involved=true:", scottTrue);