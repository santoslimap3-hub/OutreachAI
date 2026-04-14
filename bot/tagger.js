#!/usr/bin/env node

/**
 * tagger.js — Training Data Review & Feedback Tool
 *
 * Starts a local web server at http://localhost:3000
 * Reads raw bot outputs from  data/logs/
 * Saves Scott's feedback into data/logs_feedback/
 *   (files named identically but with "_feedback" appended before .json)
 * Original log files are NEVER modified.
 *
 * Usage:
 *   node tagger.js
 *   Then open http://localhost:3000 in your browser.
 */

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const FEEDBACK_DIR = path.join(DATA_DIR, 'logs_feedback');
const PORT = 3000;

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ─── File helpers ──────────────────────────────────────────────────────────────

function listRuns() {
    if (!fs.existsSync(LOGS_DIR)) return [];
    var runMap = {};
    fs.readdirSync(LOGS_DIR).forEach(function(f) {
        var m = f.match(/^(post_comment_log|dm_log)_(\d{4}-\d{2}-\d{2}_run\d+)\.json$/);
        if (!m) return;
        var run = m[2];
        if (!runMap[run]) runMap[run] = { run: run, dmCount: 0, postCount: 0 };
        try {
            var arr = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), 'utf8'));
            if (m[1] === 'dm_log') runMap[run].dmCount = arr.length;
            else runMap[run].postCount = arr.length;
        } catch (e) {}
    });
    return Object.values(runMap).sort(function(a, b) { return b.run.localeCompare(a.run); });
}

/**
 * Read original entries from data/logs/ then overlay any saved feedback
 * from data/logs_feedback/ so the tagger always shows previously saved feedback.
 */
function readEntries(type, run) {
    var prefix = type === 'dm' ? 'dm_log' : 'post_comment_log';

    // Load original entries (source of truth for content)
    var origPath = path.join(LOGS_DIR, prefix + '_' + run + '.json');
    var entries = [];
    if (fs.existsSync(origPath)) {
        try { entries = JSON.parse(fs.readFileSync(origPath, 'utf8')); } catch (e) {}
    }

    // Overlay feedback from logs_feedback/ (if any entries have been reviewed)
    var fbPath = path.join(FEEDBACK_DIR, prefix + '_' + run + '_feedback.json');
    if (fs.existsSync(fbPath)) {
        try {
            var fbEntries = JSON.parse(fs.readFileSync(fbPath, 'utf8'));
            // Build a lookup map: id → feedback text
            var fbMap = {};
            fbEntries.forEach(function(e) { if (e.id) fbMap[e.id] = e.feedback || ''; });
            // Overlay onto originals
            entries = entries.map(function(e) {
                if (e.id && fbMap[e.id] !== undefined) {
                    return Object.assign({}, e, { feedback: fbMap[e.id] });
                }
                return e;
            });
        } catch (e) {}
    }
    return entries;
}

/**
 * Upsert one entry (with its feedback) into data/logs_feedback/.
 * The feedback file is identical in structure to the original log file
 * but only contains entries that have been reviewed by Scott.
 * Original log files are never modified.
 */
function saveFeedback(type, run, id, feedback) {
    var prefix = type === 'dm' ? 'dm_log' : 'post_comment_log';

    // Find the full original entry so we can copy it into the feedback file
    var origPath = path.join(LOGS_DIR, prefix + '_' + run + '.json');
    var origEntries = [];
    if (fs.existsSync(origPath)) {
        try { origEntries = JSON.parse(fs.readFileSync(origPath, 'utf8')); } catch (e) {}
    }
    var original = null;
    for (var i = 0; i < origEntries.length; i++) {
        if (origEntries[i].id === id) { original = origEntries[i]; break; }
    }
    if (!original) return false; // id not found in original

    // Read the existing feedback file (or start fresh)
    ensureDir(FEEDBACK_DIR);
    var fbPath = path.join(FEEDBACK_DIR, prefix + '_' + run + '_feedback.json');
    var fbEntries = [];
    if (fs.existsSync(fbPath)) {
        try { fbEntries = JSON.parse(fs.readFileSync(fbPath, 'utf8')); } catch (e) {}
    }

    // Upsert: find by id, or append
    var found = false;
    for (var j = 0; j < fbEntries.length; j++) {
        if (fbEntries[j].id === id) {
            fbEntries[j] = Object.assign({}, original, { feedback: feedback });
            found = true;
            break;
        }
    }
    if (!found) {
        fbEntries.push(Object.assign({}, original, { feedback: feedback }));
    }

    var tmp = fbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(fbEntries, null, 2), 'utf8');
    fs.renameSync(tmp, fbPath);
    return true;
}

// ─── HTTP handler ──────────────────────────────────────────────────────────────

function handleRequest(req, res) {
    var parsedUrl = new URL(req.url, 'http://localhost');
    var pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (pathname === '/api/runs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(listRuns()));
        return;
    }

    if (pathname === '/api/entries') {
        var type = parsedUrl.searchParams.get('type') || 'dm';
        var run = parsedUrl.searchParams.get('run') || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(readEntries(type, run)));
        return;
    }

    if (pathname === '/api/feedback' && req.method === 'POST') {
        var body = '';
        req.on('data', function(d) { body += d; });
        req.on('end', function() {
            try {
                var data = JSON.parse(body);
                var ok = saveFeedback(data.type, data.run, data.id, data.feedback);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: ok }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
        });
        return;
    }

    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
        return;
    }

    res.writeHead(404);
    res.end('Not found');
}

// ─── HTML / CSS / JS (single-file SPA) ────────────────────────────────────────

var HTML = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Training Data Tagger</title>',
    '<style>',
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    ':root{',
    '  --bg:#f0f2f5;--surface:#fff;--border:#e2e8f0;',
    '  --text:#1a202c;--muted:#718096;',
    '  --primary:#4f46e5;--primary-lt:#eef2ff;',
    '  --green:#10b981;--green-lt:#d1fae5;',
    '  --dm:#7c3aed;--post:#0891b2;--comment:#15803d;',
    '  --rad:12px;',
    '}',
    'body{background:var(--bg);color:var(--text);',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;',
    '  font-size:14px;line-height:1.5;}',

    /* ── topbar ── */
    '.topbar{position:sticky;top:0;z-index:100;background:#1a202c;color:#fff;',
    '  padding:10px 24px;display:flex;align-items:center;gap:16px;',
    '  box-shadow:0 2px 10px rgba(0,0,0,.35);}',
    '.topbar h1{font-size:15px;font-weight:800;white-space:nowrap;letter-spacing:-.3px;}',
    '.topbar h1 em{font-style:normal;color:#a78bfa;}',
    '.run-wrap{display:flex;align-items:center;gap:6px;}',
    '.run-wrap label{font-size:11px;color:#a0aec0;text-transform:uppercase;letter-spacing:.5px;}',
    '#run-select{background:#2d3748;color:#fff;border:1px solid #4a5568;',
    '  padding:5px 10px;border-radius:7px;font-size:12px;cursor:pointer;}',
    '.tabs{display:flex;gap:4px;margin-left:auto;}',
    '.tab-btn{padding:6px 16px;border:none;border-radius:7px;',
    '  font-size:12px;font-weight:700;cursor:pointer;',
    '  background:#2d3748;color:#a0aec0;transition:all .15s;}',
    '.tab-btn.active{background:var(--primary);color:#fff;}',
    '.count{display:inline-block;background:rgba(255,255,255,.18);',
    '  border-radius:10px;padding:0 7px;font-size:11px;margin-left:5px;}',

    /* ── main ── */
    '.main{max-width:920px;margin:0 auto;padding:20px 16px;}',
    '.empty{text-align:center;padding:70px 20px;color:var(--muted);}',
    '.empty .ico{font-size:44px;margin-bottom:12px;}',
    '.loading{text-align:center;padding:70px;color:var(--muted);font-size:15px;}',

    /* ── card ── */
    '.card{background:var(--surface);border:1px solid var(--border);',
    '  border-radius:var(--rad);margin-bottom:14px;overflow:hidden;',
    '  box-shadow:0 1px 3px rgba(0,0,0,.06);transition:box-shadow .15s;}',
    '.card:hover{box-shadow:0 4px 14px rgba(0,0,0,.1);}',

    /* header */
    '.card-hdr{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;',
    '  border-bottom:1px solid var(--border);cursor:pointer;user-select:none;}',
    '.card-hdr:hover{background:#fafbfc;}',
    '.badge{flex-shrink:0;padding:2px 9px;border-radius:20px;',
    '  font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;}',
    '.b-dm{background:#ede9fe;color:var(--dm);}',
    '.b-post{background:#e0f2fe;color:var(--post);}',
    '.b-comment{background:#dcfce7;color:var(--comment);}',
    '.card-title{flex:1;min-width:0;}',
    '.card-title .name{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.card-title .meta{font-size:11px;color:var(--muted);margin-top:1px;}',
    '.card-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-width:360px;}',
    '.tag{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;',
    '  background:#f1f5f9;color:#4a5568;border:1px solid #e2e8f0;}',
    '.t-intent{background:#fef3c7;color:#92400e;border-color:#fde68a;}',
    '.t-stage{background:#dbeafe;color:#1e40af;border-color:#bfdbfe;}',
    '.t-dmstage{background:#fce7f3;color:#9d174d;border-color:#fbcfe8;}',
    '.t-tone{background:#f3e8ff;color:#6b21a8;border-color:#e9d5ff;}',
    '.has-fb{color:var(--green);font-size:15px;flex-shrink:0;margin-left:4px;}',
    '.chevron{flex-shrink:0;color:var(--muted);font-size:11px;margin-top:2px;transition:transform .2s;}',
    '.card.open .chevron{transform:rotate(180deg);}',

    /* body */
    '.card-body{display:none;}',
    '.card.open .card-body{display:block;}',
    '.sec{border-top:1px solid var(--border);padding:12px 16px;}',
    '.sec-hdr{font-size:10px;font-weight:800;text-transform:uppercase;',
    '  letter-spacing:.8px;color:var(--muted);margin-bottom:8px;',
    '  display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;}',
    '.sec-hdr::after{content:"▾";font-size:9px;margin-left:auto;}',
    '.sec-hdr.coll::after{content:"▸";}',
    '.sec-body.coll{display:none;}',

    /* conversation */
    '.convo{display:flex;flex-direction:column;gap:6px;}',
    '.msg{padding:7px 11px;border-radius:8px;max-width:82%;font-size:13px;line-height:1.5;}',
    '.msg.partner{background:#f1f5f9;border:1px solid #e2e8f0;align-self:flex-start;}',
    '.msg.bot{background:var(--primary-lt);border:1px solid #c7d2fe;align-self:flex-end;}',
    '.msg-who{font-size:10px;font-weight:800;text-transform:uppercase;',
    '  letter-spacing:.4px;color:var(--muted);margin-bottom:3px;}',
    '.msg.bot .msg-who{color:var(--primary);}',

    /* post */
    '.post-blk{background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:12px;}',
    '.post-blk .by{font-size:11px;color:var(--muted);margin-bottom:4px;}',
    '.post-blk .ptitle{font-weight:700;font-size:14px;margin-bottom:6px;}',
    '.post-blk .pbody{font-size:13px;color:#374151;white-space:pre-wrap;word-break:break-word;}',
    '.comment-blk{margin-top:8px;background:#fffbeb;border:1px solid #fde68a;',
    '  border-radius:8px;padding:10px 12px;}',
    '.comment-blk .cwho{font-size:11px;font-weight:700;color:#92400e;margin-bottom:3px;}',
    '.comment-blk .ctext{font-size:13px;color:#374151;}',

    /* prompts */
    '.prompt-lbl{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;',
    '  letter-spacing:.5px;margin-bottom:4px;}',
    '.prompt-lbl+.prompt-lbl,.mt8{margin-top:8px;}',
    '.prompt-box{background:#1e1e2e;color:#cdd6f4;border-radius:6px;padding:10px 12px;',
    '  font-family:"SF Mono","Fira Code",Consolas,monospace;font-size:12px;line-height:1.6;',
    '  white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;}',
    '.reasoning{font-size:13px;color:#374151;padding:8px 10px;background:#f8fafc;',
    '  border-radius:6px;border-left:3px solid #a78bfa;font-style:italic;}',

    /* reply */
    '.reply-model{font-size:11px;color:var(--muted);font-family:monospace;margin-bottom:5px;}',
    '.reply-box{background:#f0fdf4;border:2px solid #86efac;border-radius:8px;padding:12px;',
    '  font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word;}',

    /* feedback */
    '.fb-sec{background:#fffdf5;}',
    '.fb-lbl{font-size:12px;font-weight:800;color:#92400e;margin-bottom:8px;',
    '  display:flex;align-items:center;gap:5px;}',
    'textarea.fb-in{width:100%;min-height:90px;border:1.5px solid #e2e8f0;',
    '  border-radius:8px;padding:10px;font-size:13px;font-family:inherit;',
    '  resize:vertical;line-height:1.5;transition:border-color .15s;}',
    'textarea.fb-in:focus{outline:none;border-color:var(--primary);',
    '  box-shadow:0 0 0 3px rgba(79,70,229,.1);}',
    '.fb-actions{display:flex;align-items:center;gap:10px;margin-top:8px;}',
    '.save-btn{padding:7px 20px;background:var(--primary);color:#fff;',
    '  border:none;border-radius:7px;font-size:13px;font-weight:700;',
    '  cursor:pointer;transition:all .15s;}',
    '.save-btn:hover{background:#4338ca;}',
    '.save-btn:disabled{background:#a5b4fc;cursor:not-allowed;}',
    '.save-btn.saved{background:var(--green);}',
    '.save-status{font-size:12px;color:var(--muted);}',
    '.save-status.ok{color:var(--green);font-weight:700;}',
    '.save-status.err{color:#ef4444;font-weight:700;}',

    /* scrollbar */
    '::-webkit-scrollbar{width:5px;height:5px}',
    '::-webkit-scrollbar-thumb{background:#cbd5e0;border-radius:3px}',
    '</style>',
    '</head>',
    '<body>',

    '<div class="topbar">',
    '  <h1>&#x1F916; <em>Training</em> Tagger</h1>',
    '  <div class="run-wrap">',
    '    <label>Run</label>',
    '    <select id="run-select"></select>',
    '  </div>',
    '  <div class="tabs">',
    '    <button class="tab-btn active" data-tab="dm">&#x1F4AC; DMs <span class="count" id="cnt-dm">0</span></button>',
    '    <button class="tab-btn" data-tab="post">&#x1F4DD; Posts/Comments <span class="count" id="cnt-post">0</span></button>',
    '  </div>',
    '</div>',

    '<div class="main" id="main"><div class="loading">Loading&#8230;</div></div>',

    '<script>',
    'var S={runs:[],run:null,tab:"dm",dms:[],posts:[]};',

    /* helpers */
    'function esc(s){return String(s||"")',
    '  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
    'function fmtDate(iso){if(!iso)return"";',
    '  var d=new Date(iso);',
    '  return d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});}',
    'async function api(url,opts){return(await fetch(url,opts)).json();}',

    /* init */
    'async function init(){',
    '  S.runs=await api("/api/runs");',
    '  var sel=document.getElementById("run-select");',
    '  if(!S.runs.length){',
    '    sel.innerHTML="<option>No runs yet</option>";',
    '    document.getElementById("main").innerHTML=',
    '      \'<div class="empty"><div class="ico">&#x1F4ED;</div><p>No training data yet. Run the bot first!</p></div>\';',
    '    return;',
    '  }',
    '  S.runs.forEach(function(r){',
    '    var o=document.createElement("option");',
    '    o.value=r.run;',
    '    var p=r.run.split("_");',
    '    o.textContent=p[0]+" \xb7 "+p[1].replace("run","Run ")+',
    '      " ("+r.dmCount+" DMs, "+r.postCount+" posts)";',
    '    sel.appendChild(o);',
    '  });',
    '  sel.onchange=function(){loadRun(sel.value);};',
    '  await loadRun(S.runs[0].run);',
    '}',

    'async function loadRun(run){',
    '  S.run=run;',
    '  document.getElementById("main").innerHTML=\'<div class="loading">Loading\u2026</div>\';',
    '  var res=await Promise.all([',
    '    api("/api/entries?type=dm&run="+encodeURIComponent(run)),',
    '    api("/api/entries?type=post&run="+encodeURIComponent(run))',
    '  ]);',
    '  S.dms=res[0]||[];S.posts=res[1]||[];',
    '  document.getElementById("cnt-dm").textContent=S.dms.length;',
    '  document.getElementById("cnt-post").textContent=S.posts.length;',
    '  render();',
    '}',

    /* tab switch */
    'document.querySelectorAll(".tab-btn").forEach(function(b){',
    '  b.onclick=function(){',
    '    document.querySelectorAll(".tab-btn").forEach(function(x){x.classList.remove("active");});',
    '    b.classList.add("active");S.tab=b.dataset.tab;render();',
    '  };',
    '});',

    'function render(){',
    '  var entries=S.tab==="dm"?S.dms:S.posts;',
    '  var main=document.getElementById("main");',
    '  if(!entries.length){',
    '    main.innerHTML=\'<div class="empty"><div class="ico">&#x1F4ED;</div><p>No entries in this run for this tab.</p></div>\';',
    '    return;',
    '  }',
    '  main.innerHTML="";',
    '  entries.slice().reverse().forEach(function(e){main.appendChild(mkCard(e,S.tab));});',
    '}',

    /* build tags */
    'function mkTags(tags){',
    '  if(!tags)return"";var h="";',
    '  if(tags.dm_stage)h+=\'<span class="tag t-dmstage">\u26a1 \'+esc(tags.dm_stage)+\'</span>\';',
    '  if(tags.intent)h+=\'<span class="tag t-intent">\ud83c\udfaf \'+esc(tags.intent)+\'</span>\';',
    '  if(tags.sales_stage)h+=\'<span class="tag t-stage">\ud83d\udcca \'+esc(tags.sales_stage)+\'</span>\';',
    '  (tags.tone_tags||[]).forEach(function(t){h+=\'<span class="tag t-tone">\ud83c\udfa4 \'+esc(t)+\'</span>\';});',
    '  return h;',
    '}',

    /* build card */
    'function mkCard(entry,type){',
    '  var card=document.createElement("div");',
    '  card.className="card";',
    '  var typeLabel=type==="dm"?"DM":(entry.type||"post");',
    '  var bCls=type==="dm"?"b-dm":(typeLabel==="comment"?"b-comment":"b-post");',
    '  var name=type==="dm"?(entry.partner||"?"):',
    '    (entry.type==="post"?(entry.post&&entry.post.author||"?"):(entry.comment&&entry.comment.author||"?"));',
    '  var sub=type==="post"&&entry.post&&entry.post.title',
    '    ?entry.post.title.substring(0,55)+(entry.post.title.length>55?"\u2026":""):"";',
    '  var hasFb=!!(entry.feedback&&entry.feedback.trim());',
    '  var tags=entry.classifier&&entry.classifier.tags;',

    '  card.innerHTML=',
    '    \'<div class="card-hdr">\'+',
    '    \'<span class="badge \'+bCls+\'">\'+typeLabel+\'</span>\'+',
    '    \'<div class="card-title">\'+',
    '      \'<div class="name">\'+esc(name)+\'</div>\'+',
    '      \'<div class="meta">\'+fmtDate(entry.timestamp)+(sub?\' \xb7 \'+esc(sub):"")+\'</div>\'+',
    '    \'</div>\'+',
    '    \'<div class="card-tags">\'+mkTags(tags)+\'</div>\'+',
    '    (hasFb?\'<span class="has-fb" title="Has feedback">\u2713</span>\':""),+',
    '    \'<span class="chevron">\u25bc</span>\'+',
    '    \'</div>\'+',
    '    \'<div class="card-body">\'+mkBody(entry,type)+\'</div>\';',

    '  card.querySelector(".card-hdr").onclick=function(){card.classList.toggle("open");};',

    '  card.querySelectorAll(".sec-hdr").forEach(function(h){',
    '    h.onclick=function(e){',
    '      e.stopPropagation();',
    '      h.classList.toggle("coll");',
    '      var b=h.nextElementSibling;',
    '      if(b&&b.classList.contains("sec-body"))b.classList.toggle("coll");',
    '    };',
    '  });',

    '  var btn=card.querySelector(".save-btn");',
    '  if(btn)btn.onclick=function(){doSave(card,entry,type);};',
    '  return card;',
    '}',

    /* build body */
    'function mkBody(e,type){',
    '  var h="";',

    /* context section */
    '  h+=\'<div class="sec">\';',
    '  if(type==="dm"){',
    '    h+=\'<div class="sec-hdr">\ud83d\udcac Conversation</div><div class="sec-body"><div class="convo">\';',
    '    (e.conversation||[]).forEach(function(m){',
    '      var c=m.role==="bot"?"bot":"partner";',
    '      h+=\'<div class="msg \'+c+\'">\'+',
    '        \'<div class="msg-who">\'+esc(m.author||(m.role==="bot"?"Scott":e.partner))+\'</div>\'+',
    '        esc(m.text)+\'</div>\';',
    '    });',
    '    h+=\'</div></div>\';',
    '  }else{',
    '    h+=\'<div class="sec-hdr">\ud83d\udcc4 Post</div><div class="sec-body">\';',
    '    if(e.post){',
    '      h+=\'<div class="post-blk">\'+',
    '        \'<div class="by">by \'+esc(e.post.author)+(e.community?\' \xb7 \'+esc(e.community):"")+\'</div>\'+',
    '        (e.post.title?\'<div class="ptitle">\'+esc(e.post.title)+\'</div>\':""),+',
    '        \'<div class="pbody">\'+esc((e.post.body||"").substring(0,900))+',
    '        (e.post.body&&e.post.body.length>900?"\n\u2026":"")+\'</div></div>\';',
    '    }',
    '    if(e.comment){',
    '      h+=\'<div class="comment-blk">\'+',
    '        \'<div class="cwho">\ud83d\udcac \'+esc(e.comment.author)+\'</div>\'+',
    '        \'<div class="ctext">\'+esc(e.comment.text)+\'</div></div>\';',
    '    }',
    '    h+=\'</div>\';',
    '  }',
    '  h+=\'</div>\';',

    /* classifier (collapsed by default) */
    '  if(e.classifier){',
    '    h+=\'<div class="sec">\'+',
    '      \'<div class="sec-hdr coll">\ud83d\udd2c Classifier Prompt</div>\'+',
    '      \'<div class="sec-body coll">\';',
    '    if(e.classifier.systemPrompt)',
    '      h+=\'<div class="prompt-lbl">SYSTEM</div><div class="prompt-box">\'+esc(e.classifier.systemPrompt)+\'</div>\';',
    '    if(e.classifier.userMessage)',
    '      h+=\'<div class="prompt-lbl mt8">USER</div><div class="prompt-box">\'+esc(e.classifier.userMessage)+\'</div>\';',
    '    if(e.classifier.tags&&e.classifier.tags.reasoning)',
    '      h+=\'<div class="prompt-lbl mt8">REASONING</div><div class="reasoning">\'+esc(e.classifier.tags.reasoning)+\'</div>\';',
    '    h+=\'</div></div>\';',
    '  }',

    /* generation (collapsed by default) */
    '  if(e.generation){',
    '    h+=\'<div class="sec">\'+',
    '      \'<div class="sec-hdr coll">\u2699\ufe0f Generation Prompt</div>\'+',
    '      \'<div class="sec-body coll">\';',
    '    if(e.generation.systemPrompt)',
    '      h+=\'<div class="prompt-lbl">SYSTEM</div><div class="prompt-box">\'+esc(e.generation.systemPrompt)+\'</div>\';',
    '    if(e.generation.userMessage)',
    '      h+=\'<div class="prompt-lbl mt8">USER</div><div class="prompt-box">\'+esc(e.generation.userMessage)+\'</div>\';',
    '    h+=\'</div></div>\';',
    '  }',

    /* reply */
    '  h+=\'<div class="sec">\'+',
    '    \'<div class="sec-hdr">\u2728 Generated Reply</div>\'+',
    '    \'<div class="sec-body">\';',
    '  if(e.generation&&e.generation.model)',
    '    h+=\'<div class="reply-model">model: \'+esc(e.generation.model)+\'</div>\';',
    '  h+=\'<div class="reply-box">\'+esc((e.generation&&e.generation.reply)||"")+\'</div>\'+',
    '  \'</div></div>\';',

    /* feedback */
    '  h+=\'<div class="sec fb-sec">\'+',
    '    \'<div class="fb-lbl">\u270f\ufe0f Scott\u2019s Feedback</div>\'+',
    '    \'<textarea class="fb-in" placeholder="What would you have said instead? Tone notes, corrections, strategy\u2026">\'+',
    '    esc(e.feedback||"")+\'</textarea>\'+',
    '    \'<div class="fb-actions">\'+',
    '    \'<button class="save-btn">Save Feedback</button>\'+',
    '    \'<span class="save-status"></span>\'+',
    '    \'</div></div>\';',

    '  return h;',
    '}',

    /* save */
    'async function doSave(card,entry,type){',
    '  var ta=card.querySelector(".fb-in");',
    '  var btn=card.querySelector(".save-btn");',
    '  var st=card.querySelector(".save-status");',
    '  btn.disabled=true;btn.textContent="Saving\u2026";',
    '  st.className="save-status";st.textContent="";',
    '  try{',
    '    var r=await api("/api/feedback",{',
    '      method:"POST",',
    '      headers:{"Content-Type":"application/json"},',
    '      body:JSON.stringify({type:type,run:S.run,id:entry.id,feedback:ta.value})',
    '    });',
    '    if(r.ok){',
    '      btn.textContent="\u2713 Saved";btn.classList.add("saved");',
    '      st.className="save-status ok";',
    '      st.textContent="Saved at "+new Date().toLocaleTimeString();',
    '      var hasFb=!!(ta.value&&ta.value.trim());',
    '      var existing=card.querySelector(".has-fb");',
    '      var hdr=card.querySelector(".card-hdr");',
    '      var chev=hdr.querySelector(".chevron");',
    '      if(hasFb&&!existing){',
    '        var ck=document.createElement("span");',
    '        ck.className="has-fb";ck.titl