const data = require("../data/posts_with_scott_reply_threads.json");

const synthPosts = data.map((p, i) => ({...p, _idx: i })).filter(p => p.original_post.url && p.original_post.url.includes("synthesizer"));

let broken = 0,
    good = 0;
const brokenIdxs = [];
const goodIdxs = [];

synthPosts.forEach(p => {
    const hasReplyInBody = p.original_post.body && p.original_post.body.includes("\nReply\n");
    const emptyCategory = !p.original_post.category;
    if (emptyCategory || hasReplyInBody) {
        broken++;
        brokenIdxs.push(p._idx);
    } else {
        good++;
        goodIdxs.push(p._idx);
    }
});

console.log("Good Synthesizer posts:", good);
console.log("Broken Synthesizer posts:", broken);
console.log("");

// Show good ones
console.log("=== GOOD POST INDICES ===");
console.log(goodIdxs.join(", "));
console.log("");

// Show a good one for reference
if (goodIdxs.length > 0) {
    const g = data[goodIdxs[0]];
    console.log("=== GOOD EXAMPLE (index " + goodIdxs[0] + ") ===");
    console.log("author:", g.original_post.author);
    console.log("title:", g.original_post.title);
    console.log("category:", g.original_post.category);
    console.log("timestamp:", g.original_post.timestamp);
    console.log("body (first 300):", g.original_post.body && g.original_post.body.substring(0, 300));
    console.log("threads:", g.threads.length);
    console.log("");
}

// Show broken one for comparison
if (brokenIdxs.length > 0) {
    const b = data[brokenIdxs[0]];
    console.log("=== BROKEN EXAMPLE (index " + brokenIdxs[0] + ") ===");
    console.log("author:", b.original_post.author);
    console.log("title:", b.original_post.title);
    console.log("category:", b.original_post.category);
    console.log("timestamp:", b.original_post.timestamp);
    console.log("body length:", b.original_post.body && b.original_post.body.length);
    console.log("body (first 300):", b.original_post.body && b.original_post.body.substring(0, 300));
    console.log("threads:", b.threads.length);
    console.log("scott_involved:", b.scott_involved);
}