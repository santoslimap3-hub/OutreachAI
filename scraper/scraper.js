const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONFIG = {
  email: process.env.SKOOL_EMAIL,
  password: process.env.SKOOL_PASSWORD,
  communityUrl: process.env.SKOOL_COMMUNITY_URL || "https://www.skool.com/your-community",
  targetMember: process.env.TARGET_MEMBER || "Scott Northwolf",
  scrollPauseMs: 2000,
  maxScrollAttempts: 50,
  headless: false,
  outputDir: "./output",
  outputFile: "skool_data.json",
  rawPostsFile: "raw_posts.json",
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureOutputDir() {
  if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

function saveJSON(filename, data) {
  const fp = path.join(CONFIG.outputDir, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  console.log("Saved " + fp);
}

async function login(page) {
  console.log("Logging into Skool...");
  await page.goto("https://www.skool.com/login", { waitUntil: "networkidle" });
  await sleep(2000);
  await page.fill('input[name="email"], input[type="email"]', CONFIG.email);
  await sleep(500);
  await page.fill('input[name="password"], input[type="password"]', CONFIG.password);
  await sleep(500);
  await page.click('button[type="submit"]');
  await sleep(5000);
  if (page.url().includes("login")) throw new Error("Login failed");
  console.log("Logged in");
}

async function scrollToLoadAllPosts(page) {
  console.log("Scrolling to load all posts...");
  let prevH = 0, attempts = 0;
  while (attempts < CONFIG.maxScrollAttempts) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(CONFIG.scrollPauseMs);
    const curH = await page.evaluate(() => document.body.scrollHeight);
    if (curH === prevH) {
      await sleep(3000);
      const finalH = await page.evaluate(() => document.body.scrollHeight);
      if (finalH === prevH) break;
    }
    prevH = curH;
    attempts++;
  }
  console.log("All content loaded after " + attempts + " scrolls");
}

async function extractPostCards(page) {
  console.log("Extracting post cards...");
  const posts = await page.evaluate(() => {
    const cards = [];
    const allDivs = document.querySelectorAll("div");
    const elements = Array.from(allDivs).filter(div => {
      const text = div.textContent || "";
      const hasAuthor = div.querySelector("a[href*='/u/']");
      const hasTime = text.includes("ago") || text.includes("hr") || text.includes("min") || text.includes("day");
      const okSize = div.offsetHeight > 100 && div.offsetHeight < 800;
      return hasAuthor && hasTime && okSize;
    });
    elements.forEach((el, i) => {
      try {
        const authorEl = el.querySelector("a[href*='/u/']");
        const author = authorEl ? authorEl.textContent.trim() : "Unknown";
        const postLink = el.querySelector("a[href*='/post/']");
        const postUrl = postLink ? postLink.href : null;
        const titleEl = el.querySelector("h2, h3, strong, [class*='title'], [class*='Title']");
        const title = titleEl ? titleEl.textContent.trim() : "";
        const bodyEl = el.querySelector("p, [class*='body'], [class*='content']");
        const body = bodyEl ? bodyEl.textContent.trim() : "";
        const categoryEl = el.querySelector("[class*='category'], [class*='topic'], [class*='badge']");
        const category = categoryEl ? categoryEl.textContent.trim() : "";
        const likeEl = el.querySelector("[class*='like'], [class*='Like']");
        const commentEl = el.querySelector("[class*='comment'], [class*='Comment']");
        const likes = likeEl ? parseInt(likeEl.textContent.replace(/\D/g, "")) || 0 : 0;
        const comments = commentEl ? parseInt(commentEl.textContent.replace(/\D/g, "")) || 0 : 0;
        const timeEl = el.querySelector("time, [class*='time'], [class*='ago']");
        const timestamp = timeEl ? timeEl.textContent.trim() : "";
        cards.push({ index: i, author, title, body, category, likes, comments, timestamp, postUrl, fullText: el.textContent.trim().substring(0, 500) });
      } catch(e) {}
    });
    return cards;
  });
  console.log("Found " + posts.length + " posts");
  return posts;
}

async function extractPostWithComments(page, postUrl, idx) {
  if (!postUrl) return null;
  try {
    await page.goto(postUrl, { waitUntil: "networkidle" });
    await sleep(2000);
    let prevH = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(1000);
      const h = await page.evaluate(() => document.body.scrollHeight);
      if (h === prevH) break;
      prevH = h;
    }
    return await page.evaluate((targetName) => {
      const postBody = document.querySelector("[class*='PostBody'], [class*='post-body'], article, [class*='post-content']") || document.querySelector("main");
      const mainContent = postBody ? postBody.textContent.trim() : "";
      const commentEls = document.querySelectorAll("[class*='Comment'], [class*='comment'], [class*='Reply'], [class*='reply']");
      const comments = [];
      commentEls.forEach(el => {
        const authorEl = el.querySelector("a[href*='/u/']");
        const author = authorEl ? authorEl.textContent.trim() : "Unknown";
        const content = el.textContent.trim();
        const isTarget = author.toLowerCase() === targetName.toLowerCase();
        const likeEl = el.querySelector("[class*='like'], [class*='Like']");
        const likes = likeEl ? parseInt(likeEl.textContent.replace(/\D/g, "")) || 0 : 0;
        comments.push({ author, content: content.substring(0, 2000), likes, isTargetMember: isTarget });
      });
      return { fullContent: mainContent.substring(0, 5000), comments, targetResponses: comments.filter(c => c.isTargetMember), commentCount: comments.length };
    }, CONFIG.targetMember);
  } catch(e) {
    console.error("Error on post " + idx + ": " + e.message);
    return null;
  }
}

function buildDataset(feedPosts, detailedPosts) {
  const dataset = { metadata: { community: CONFIG.communityUrl, targetMember: CONFIG.targetMember, scrapedAt: new Date().toISOString(), totalPosts: feedPosts.length, postsWithTargetResponses: 0 }, interactions: [] };
  feedPosts.forEach((fp, i) => {
    const detail = detailedPosts[i];
    if (!detail) return;
    const targetResponses = detail.targetResponses || [];
    if (targetResponses.length > 0) dataset.metadata.postsWithTargetResponses++;
    dataset.interactions.push({
      id: String(i + 1).padStart(3, "0"),
      original_post: { author: fp.author, title: fp.title, body: fp.body || detail.fullContent.substring(0, 1000), category: fp.category, timestamp: fp.timestamp, likes: fp.likes, comment_count: fp.comments, url: fp.postUrl },
      target_responses: targetResponses.map(r => ({ content: r.content, likes: r.likes, tone_tags: [], intent: "", sales_stage: "" })),
      all_comments: detail.comments,
    });
  });
  return dataset;
}

async function main() {
  console.log("SKOOL COMMUNITY SCRAPER");
  if (!CONFIG.email || !CONFIG.password) { console.error("Missing credentials in .env"); process.exit(1); }
  ensureOutputDir();
  const browser = await chromium.launch({ headless: CONFIG.headless, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await login(page);
    console.log("Navigating to " + CONFIG.communityUrl);
    await page.goto(CONFIG.communityUrl, { waitUntil: "networkidle" });
    await sleep(3000);
    await scrollToLoadAllPosts(page);
    const feedPosts = await extractPostCards(page);
    saveJSON(CONFIG.rawPostsFile, feedPosts);
    console.log("Visiting individual posts...");
    const detailed = [];
    for (let i = 0; i < feedPosts.length; i++) {
      process.stdout.write("  Post " + (i+1) + "/" + feedPosts.length + "...\r");
      detailed.push(await extractPostWithComments(page, feedPosts[i].postUrl, i));
      await sleep(1000);
    }
    console.log("\nScraped " + detailed.filter(Boolean).length + " posts in detail");
    const dataset = buildDataset(feedPosts, detailed);
    saveJSON(CONFIG.outputFile, dataset);
    console.log("DONE!");
  } catch(e) {
    console.error("Error: " + e.message);
    await page.screenshot({ path: path.join(CONFIG.outputDir, "error_screenshot.png") });
  } finally {
    await browser.close();
  }
}

main();
SCRAPER_EOFcat << 'SCRAPER_EOF' > scraper.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONFIG = {
  email: process.env.SKOOL_EMAIL,
  password: process.env.SKOOL_PASSWORD,
  communityUrl: process.env.SKOOL_COMMUNITY_URL || "https://www.skool.com/your-community",
  targetMember: process.env.TARGET_MEMBER || "Scott Northwolf",
  scrollPauseMs: 2000,
  maxScrollAttempts: 50,
  headless: false,
  outputDir: "./output",
  outputFile: "skool_data.json",
  rawPostsFile: "raw_posts.json",
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureOutputDir() {
  if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

function saveJSON(filename, data) {
  const fp = path.join(CONFIG.outputDir, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  console.log("Saved " + fp);
}

async function login(page) {
  console.log("Logging into Skool...");
  await page.goto("https://www.skool.com/login", { waitUntil: "networkidle" });
  await sleep(2000);
  await page.fill('input[name="email"], input[type="email"]', CONFIG.email);
  await sleep(500);
  await page.fill('input[name="password"], input[type="password"]', CONFIG.password);
  await sleep(500);
  await page.click('button[type="submit"]');
  await sleep(5000);
  if (page.url().includes("login")) throw new Error("Login failed");
  console.log("Logged in");
}

async function scrollToLoadAllPosts(page) {
  console.log("Scrolling to load all posts...");
  let prevH = 0, attempts = 0;
  while (attempts < CONFIG.maxScrollAttempts) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(CONFIG.scrollPauseMs);
    const curH = await page.evaluate(() => document.body.scrollHeight);
    if (curH === prevH) {
      await sleep(3000);
      const finalH = await page.evaluate(() => document.body.scrollHeight);
      if (finalH === prevH) break;
    }
    prevH = curH;
    attempts++;
  }
  console.log("All content loaded after " + attempts + " scrolls");
}

async function extractPostCards(page) {
  console.log("Extracting post cards...");
  const posts = await page.evaluate(() => {
    const cards = [];
    const allDivs = document.querySelectorAll("div");
    const elements = Array.from(allDivs).filter(div => {
      const text = div.textContent || "";
      const hasAuthor = div.querySelector("a[href*='/u/']");
      const hasTime = text.includes("ago") || text.includes("hr") || text.includes("min") || text.includes("day");
      const okSize = div.offsetHeight > 100 && div.offsetHeight < 800;
      return hasAuthor && hasTime && okSize;
    });
    elements.forEach((el, i) => {
      try {
        const authorEl = el.querySelector("a[href*='/u/']");
        const author = authorEl ? authorEl.textContent.trim() : "Unknown";
        const postLink = el.querySelector("a[href*='/post/']");
        const postUrl = postLink ? postLink.href : null;
        const titleEl = el.querySelector("h2, h3, strong, [class*='title'], [class*='Title']");
        const title = titleEl ? titleEl.textContent.trim() : "";
        const bodyEl = el.querySelector("p, [class*='body'], [class*='content']");
        const body = bodyEl ? bodyEl.textContent.trim() : "";
        const categoryEl = el.querySelector("[class*='category'], [class*='topic'], [class*='badge']");
        const category = categoryEl ? categoryEl.textContent.trim() : "";
        const likeEl = el.querySelector("[class*='like'], [class*='Like']");
        const commentEl = el.querySelector("[class*='comment'], [class*='Comment']");
        const likes = likeEl ? parseInt(likeEl.textContent.replace(/\D/g, "")) || 0 : 0;
        const comments = commentEl ? parseInt(commentEl.textContent.replace(/\D/g, "")) || 0 : 0;
        const timeEl = el.querySelector("time, [class*='time'], [class*='ago']");
        const timestamp = timeEl ? timeEl.textContent.trim() : "";
        cards.push({ index: i, author, title, body, category, likes, comments, timestamp, postUrl, fullText: el.textContent.trim().substring(0, 500) });
      } catch(e) {}
    });
    return cards;
  });
  console.log("Found " + posts.length + " posts");
  return posts;
}

async function extractPostWithComments(page, postUrl, idx) {
  if (!postUrl) return null;
  try {
    await page.goto(postUrl, { waitUntil: "networkidle" });
    await sleep(2000);
    let prevH = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(1000);
      const h = await page.evaluate(() => document.body.scrollHeight);
      if (h === prevH) break;
      prevH = h;
    }
    return await page.evaluate((targetName) => {
      const postBody = document.querySelector("[class*='PostBody'], [class*='post-body'], article, [class*='post-content']") || document.querySelector("main");
      const mainContent = postBody ? postBody.textContent.trim() : "";
      const commentEls = document.querySelectorAll("[class*='Comment'], [class*='comment'], [class*='Reply'], [class*='reply']");
      const comments = [];
      commentEls.forEach(el => {
        const authorEl = el.querySelector("a[href*='/u/']");
        const author = authorEl ? authorEl.textContent.trim() : "Unknown";
        const content = el.textContent.trim();
        const isTarget = author.toLowerCase() === targetName.toLowerCase();
        const likeEl = el.querySelector("[class*='like'], [class*='Like']");
        const likes = likeEl ? parseInt(likeEl.textContent.replace(/\D/g, "")) || 0 : 0;
        comments.push({ author, content: content.substring(0, 2000), likes, isTargetMember: isTarget });
      });
      return { fullContent: mainContent.substring(0, 5000), comments, targetResponses: comments.filter(c => c.isTargetMember), commentCount: comments.length };
    }, CONFIG.targetMember);
  } catch(e) {
    console.error("Error on post " + idx + ": " + e.message);
    return null;
  }
}

function buildDataset(feedPosts, detailedPosts) {
  const dataset = { metadata: { community: CONFIG.communityUrl, targetMember: CONFIG.targetMember, scrapedAt: new Date().toISOString(), totalPosts: feedPosts.length, postsWithTargetResponses: 0 }, interactions: [] };
  feedPosts.forEach((fp, i) => {
    const detail = detailedPosts[i];
    if (!detail) return;
    const targetResponses = detail.targetResponses || [];
    if (targetResponses.length > 0) dataset.metadata.postsWithTargetResponses++;
    dataset.interactions.push({
      id: String(i + 1).padStart(3, "0"),
      original_post: { author: fp.author, title: fp.title, body: fp.body || detail.fullContent.substring(0, 1000), category: fp.category, timestamp: fp.timestamp, likes: fp.likes, comment_count: fp.comments, url: fp.postUrl },
      target_responses: targetResponses.map(r => ({ content: r.content, likes: r.likes, tone_tags: [], intent: "", sales_stage: "" })),
      all_comments: detail.comments,
    });
  });
  return dataset;
}

async function main() {
  console.log("SKOOL COMMUNITY SCRAPER");
  if (!CONFIG.email || !CONFIG.password) { console.error("Missing credentials in .env"); process.exit(1); }
  ensureOutputDir();
  const browser = await chromium.launch({ headless: CONFIG.headless, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await login(page);
    console.log("Navigating to " + CONFIG.communityUrl);
    await page.goto(CONFIG.communityUrl, { waitUntil: "networkidle" });
    await sleep(3000);
    await scrollToLoadAllPosts(page);
    const feedPosts = await extractPostCards(page);
    saveJSON(CONFIG.rawPostsFile, feedPosts);
    console.log("Visiting individual posts...");
    const detailed = [];
    for (let i = 0; i < feedPosts.length; i++) {
      process.stdout.write("  Post " + (i+1) + "/" + feedPosts.length + "...\r");
      detailed.push(await extractPostWithComments(page, feedPosts[i].postUrl, i));
      await sleep(1000);
    }
    console.log("\nScraped " + detailed.filter(Boolean).length + " posts in detail");
    const dataset = buildDataset(feedPosts, detailed);
    saveJSON(CONFIG.outputFile, dataset);
    console.log("DONE!");
  } catch(e) {
    console.error("Error: " + e.message);
    await page.screenshot({ path: path.join(CONFIG.outputDir, "error_screenshot.png") });
  } finally {
    await browser.close();
  }
}

main();
