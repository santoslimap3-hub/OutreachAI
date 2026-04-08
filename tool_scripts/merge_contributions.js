// Merge newly scraped contributions into existing tagged data
// SAFE: never overwrites existing posts/tags — only appends brand new posts
const fs = require("fs");
const path = require("path");

const EXISTING_PATH = path.join(__dirname, "..", "data", "posts_with_scott_reply_threads.json");
const NEW_PATH = path.join(__dirname, "..", "scraper", "output", "scott_synthesizer_posts.json");
const BACKUP_PATH = EXISTING_PATH.replace(".json", "_backup_pre_merge.json");

// 1. Load both
var existing = JSON.parse(fs.readFileSync(EXISTING_PATH, "utf8"));
var newData = JSON.parse(fs.readFileSync(NEW_PATH, "utf8"));

console.log("Existing posts: " + existing.length);
console.log("New scraped posts: " + newData.length);

// 2. Build URL index of existing posts (the key we match on)
var existingByUrl = {};
existing.forEach(function(p) {
    if (p.original_post && p.original_post.url) {
        // Normalize URL: strip trailing slashes and query params
        var key = p.original_post.url.split("?")[0].replace(/\/+$/, "");
        existingByUrl[key] = p;
    }
});

// 3. Find posts that are in the new data but NOT in existing
var toAdd = [];
var skipped = 0;
newData.forEach(function(p) {
    if (!p.original_post || !p.original_post.url) return;
    var key = p.original_post.url.split("?")[0].replace(/\/+$/, "");
    if (existingByUrl[key]) {
        skipped++;
    } else {
        toAdd.push(p);
    }
});

console.log("\nOverlap (already exist — SKIPPED, tags preserved): " + skipped);
console.log("Brand new posts to append: " + toAdd.length);

if (toAdd.length === 0) {
    console.log("\nNothing new to add. Exiting.");
    process.exit(0);
}

// 4. Backup the original file BEFORE any changes
fs.copyFileSync(EXISTING_PATH, BACKUP_PATH);
console.log("\nBackup saved: " + BACKUP_PATH);

// 5. Re-number and append
var nextId = existing.length + 1;
toAdd.forEach(function(p) {
    p.id = String(nextId).padStart(3, "0");
    nextId++;
    existing.push(p);
});

// 6. Write merged file
fs.writeFileSync(EXISTING_PATH, JSON.stringify(existing, null, 2));
console.log("Merged file saved: " + EXISTING_PATH);
console.log("Total posts now: " + existing.length);
console.log("\nDONE — no existing tags were modified.");