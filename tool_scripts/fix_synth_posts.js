/**
 * Fix broken Synthesizer posts in posts_with_scott_reply_threads.json
 *
 * Issues:
 * 1. body contains entire page dump including all comments
 * 2. category is empty (but embedded in body)
 * 3. timestamp is empty (but embedded in body)
 * 4. scott_involved is wrong
 *
 * Broken posts: indices 75-203 (Synthesizer posts scraped with newline-preserving method)
 * Good posts: indices 0-74 (different scrape format, metadata concatenated on one line)
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "posts_with_scott_reply_threads.json");
const BACKUP_PATH = DATA_PATH.replace(".json", "_backup_prefix.json");

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

console.log("Total posts:", data.length);

// Known Synthesizer categories from Skool
const KNOWN_CATEGORIES = [
    "🎉Wins", "🤝Networking", "💅Other", "🍆Fun",
    "🤑 Monetization", "🤑Monetization", "📖 Learning", "📖Learning",
    "💰Money", "Money 💰", "🎯Goals", "🎯 Goals",
];

// First pass: fix scott_involved for ALL posts (non-breaking space issue)
function isScottGlobal(name) {
    if (!name) return false;
    return name.replace(/\u00a0/g, " ").trim() === "Scott Northwolf";
}

let scottFixCount = 0;
for (let i = 0; i < data.length; i++) {
    const post = data[i];
    let scottInvolved = false;
    if (post.threads) {
        for (const thread of post.threads) {
            if (thread.comment && isScottGlobal(thread.comment.author)) {
                scottInvolved = true;
                break;
            }
            if (thread.replies) {
                for (const reply of thread.replies) {
                    if (isScottGlobal(reply.author)) {
                        scottInvolved = true;
                        break;
                    }
                }
            }
            if (scottInvolved) break;
        }
    }
    // Also check if post author is Scott
    if (isScottGlobal(post.original_post.author)) {
        scottInvolved = true;
    }
    if (post.scott_involved !== scottInvolved) {
        scottFixCount++;
        post.scott_involved = scottInvolved;
    }
}
console.log("scott_involved fixed for", scottFixCount, "posts");

let fixed = 0;
let skipped = 0;
let errors = 0;

for (let i = 75; i < data.length; i++) {
    const post = data[i];
    const body = post.original_post.body;
    const url = post.original_post.url || "";

    // Skip non-Synthesizer or empty-body posts
    if (!url.includes("synthesizer")) {
        skipped++;
        continue;
    }

    if (!body || body.length === 0) {
        console.log(`[SKIP] Post ${i}: no body (${post.original_post.title || url})`);
        skipped++;
        continue;
    }

    // Check if body already looks clean (no comment dump)
    const hasCommentDump = body.match(/\n(?:Like|Liked)\n/);
    if (!hasCommentDump) {
        // Check if it's a post that never had the Like marker but still has comments
        // Some posts end with just "N comments" at the end of body without comments dumped
        const endsWithComments = body.match(/\d+ comments?$/);
        if (!endsWithComments) {
            console.log(`[SKIP] Post ${i}: body seems clean already (${post.original_post.title})`);
            skipped++;
            continue;
        }
    }

    const lines = body.split("\n");

    // Parse the header structure:
    // Line 0: like count (number)
    // Line 1: author name
    // Lines 2..N: optional badges (🥷, 🔥, ⭐, etc.) - single emoji/short lines
    // Next: "timestamp • category" line
    // Next: title line (matches post.original_post.title)
    // Rest: actual post body until Like/Liked marker

    let lineIdx = 0;

    // Skip like count line
    if (lines[0] && lines[0].match(/^\d+$/)) {
        lineIdx = 1;
    }

    // Skip author line
    if (lines[lineIdx] && lines[lineIdx].trim() === post.original_post.author) {
        lineIdx++;
    }

    // Skip badge lines (short lines with emoji-like content)
    while (lineIdx < lines.length) {
        const line = lines[lineIdx].trim();
        // Badge lines are very short (just emoji badges) like "🥷", "🔥", "⭐", "🥷\n🔥"
        if (line.length <= 5 && line.length > 0 && !line.match(/[a-zA-Z0-9]{3,}/)) {
            lineIdx++;
        } else {
            break;
        }
    }

    // Now we should be at the "timestamp • category" line
    let parsedTimestamp = "";
    let parsedCategory = "";

    const currentLine = lines[lineIdx] || "";
    const tsMatch = currentLine.match(/^(.+?)\s*•\s*(.+)$/);
    if (tsMatch) {
        parsedTimestamp = tsMatch[1].trim();
        parsedCategory = tsMatch[2].trim();
        lineIdx++;
    } else {
        // Try without bullet - might just be timestamp
        const tsOnly = currentLine.match(/^(\d+[dhm]|[A-Z][a-z]{2}\s+'\d{2}|[A-Z][a-z]{2}\s+\d{1,2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
        if (tsOnly) {
            parsedTimestamp = currentLine.trim();
            lineIdx++;
        }
    }

    // Handle (edited) in timestamp
    parsedTimestamp = parsedTimestamp.replace(/\s*\(edited\)\s*/, " ").trim();

    // Skip title line if it matches
    const title = post.original_post.title;
    if (title && lines[lineIdx] && lines[lineIdx].trim() === title) {
        lineIdx++;
    }

    // Now collect body lines until the Like/Liked marker
    const bodyLines = [];
    let foundLikeMarker = false;

    for (let j = lineIdx; j < lines.length; j++) {
        const line = lines[j];

        // Check for "Like" or "Liked" marker (standalone line followed by a number)
        if ((line === "Like" || line === "Liked") && j + 1 < lines.length) {
            const nextLine = lines[j + 1];
            // Next line should be a number (like count) or "1k", "2.5k" etc
            if (nextLine && nextLine.match(/^[\d,.]+k?$/i)) {
                foundLikeMarker = true;
                break;
            }
        }

        bodyLines.push(line);
    }

    // Clean up body: remove trailing empty lines
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
        bodyLines.pop();
    }

    const cleanBody = bodyLines.join("\n").trim();

    // Fix scott_involved: check all threads for Scott Northwolf
    // Note: some scraped data has non-breaking space (U+00A0) instead of regular space
    function isScott(name) {
        if (!name) return false;
        const normalized = name.replace(/\u00a0/g, " ").trim();
        return normalized === "Scott Northwolf";
    }

    let scottInvolved = false;
    if (post.threads) {
        for (const thread of post.threads) {
            if (thread.comment && isScott(thread.comment.author)) {
                scottInvolved = true;
                break;
            }
            if (thread.replies) {
                for (const reply of thread.replies) {
                    if (isScott(reply.author)) {
                        break;
                    }
                }
            }
            if (scottInvolved) break;
        }
    }

    // Apply fixes
    if (!post.original_post.category && parsedCategory) {
        post.original_post.category = parsedCategory;
    }
    if (!post.original_post.timestamp && parsedTimestamp) {
        post.original_post.timestamp = parsedTimestamp;
    }
    post.original_post.body = cleanBody;


    console.log("\n=== SUMMARY ===");
    console.log("Fixed:", fixed);
    console.log("Skipped:", skipped);
    console.log("Errors:", errors);

    // Create backup
    fs.writeFileSync(BACKUP_PATH, fs.readFileSync(DATA_PATH));
    console.log("\nBackup saved to:", BACKUP_PATH);

    // Write fixed data
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    console.log("Fixed data saved to:", DATA_PATH);

    // Verify a few posts
    console.log("\n=== VERIFICATION ===");
    const verify = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
    [76, 100, 150, 203].forEach(i => {
        if (i >= verify.length) return;
        const p = verify[i];
        const bodyHasReply = p.original_post.body && p.original_post.body.includes("\nReply\n");
        console.log(`Post ${i}: "${p.original_post.title ? p.original_post.title.substring(0, 40) : ""}" | cat: "${p.original_post.category}" | ts: "${p.original_post.timestamp}" | body len: ${p.original_post.body ? p.original_post.body.length : 0} | has Reply in body: ${bodyHasReply} | scott: ${p.scott_involved}`);
    });