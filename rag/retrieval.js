var fs = require("fs");

var STOP_WORDS = new Set(["the","be","to","of","and","a","in","that","have","i","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","say","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","when","make","can","like","time","no","just","him","know","take","people","into","year","your","good","some","could","them","see","other","than","then","now","look","only","come","its","over","think","also","back","after","use","two","how","our","work","first","well","way","even","new","want","because","any","these","give","day","most","us","are","was","has","had","been","did","got","too","very","more","much","really","thing"]);

function RetrievalEngine(dataPath) {
  this.interactions = [];
  this.scottDirectReplies = [];
  this.idfScores = {};
  this.docVectors = [];
  if (dataPath) this.loadData(dataPath);
}

RetrievalEngine.prototype.loadData = function(dataPath) {
  var raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  this.interactions = raw.interactions || raw;

  // Only keep posts where Scott made a TOP-LEVEL comment (not a nested reply)
  var self = this;
  this.scottDirectReplies = [];

  this.interactions.forEach(function(interaction) {
    var threads = interaction.threads || [];
    var scottTopLevel = [];

    threads.forEach(function(thread) {
      // Only grab threads where Scott IS the top-level commenter
      if (thread.comment.author && thread.comment.author.trim() === "Scott Northwolf") {
        scottTopLevel.push({
          content: thread.comment.content,
          replies: thread.replies || [],
        });
      }
    });

    if (scottTopLevel.length > 0) {
      self.scottDirectReplies.push({
        original_post: interaction.original_post,
        scott_replies: scottTopLevel,
        tags: interaction.tags || {},
      });
    }
  });

  console.log("Loaded " + this.interactions.length + " total posts");
  console.log("Posts where Scott replied directly: " + this.scottDirectReplies.length);
  this._buildIndex();
};

RetrievalEngine.prototype._tokenize = function(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function(w) { return w.length > 2 && !STOP_WORDS.has(w); });
};

RetrievalEngine.prototype._getSearchableText = function(item) {
  var parts = [item.original_post.title || "", item.original_post.body || "", item.original_post.category || ""];
  item.scott_replies.forEach(function(r) { parts.push(r.content || ""); });
  return parts.join(" ");
};

RetrievalEngine.prototype._buildIndex = function() {
  var self = this;
  var docs = this.scottDirectReplies.map(function(i) { return self._getSearchableText(i); });
  var N = docs.length;
  var df = {};
  docs.forEach(function(doc) {
    var tokens = new Set(self._tokenize(doc));
    tokens.forEach(function(t) { df[t] = (df[t] || 0) + 1; });
  });
  Object.keys(df).forEach(function(term) {
    self.idfScores[term] = Math.log(N / (df[term] + 1)) + 1;
  });
  this.docVectors = docs.map(function(doc) {
    var tokens = self._tokenize(doc);
    var tf = {};
    tokens.forEach(function(t) { tf[t] = (tf[t] || 0) + 1; });
    var vals = Object.values(tf);
    var maxTf = vals.length > 0 ? Math.max.apply(null, vals) : 1;
    var vector = {};
    Object.keys(tf).forEach(function(term) {
      vector[term] = (tf[term] / maxTf) * (self.idfScores[term] || 1);
    });
    return vector;
  });
  console.log("Index: " + Object.keys(this.idfScores).length + " terms");
};

RetrievalEngine.prototype._cosineSimilarity = function(vecA, vecB) {
  var allTerms = new Set(Object.keys(vecA).concat(Object.keys(vecB)));
  var dot = 0, magA = 0, magB = 0;
  allTerms.forEach(function(term) {
    var a = vecA[term] || 0, b = vecB[term] || 0;
    dot += a * b; magA += a * a; magB += b * b;
  });
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

RetrievalEngine.prototype._queryToVector = function(text) {
  var self = this;
  var tokens = this._tokenize(text);
  var tf = {};
  tokens.forEach(function(t) { tf[t] = (tf[t] || 0) + 1; });
  var vals = Object.values(tf);
  var maxTf = vals.length > 0 ? Math.max.apply(null, vals) : 1;
  var vector = {};
  Object.keys(tf).forEach(function(term) {
    vector[term] = (tf[term] / maxTf) * (self.idfScores[term] || 1);
  });
  return vector;
};

RetrievalEngine.prototype.retrieve = function(postText, classification, topK) {
  topK = topK || 4;
  var self = this;
  var queryVec = this._queryToVector(postText);
  var scored = this.scottDirectReplies.map(function(item, idx) {
    var score = 0;
    var textSim = self._cosineSimilarity(queryVec, self.docVectors[idx]);
    score += textSim * 0.5;
    if (classification && item.tags) {
      if (classification.intent && item.tags.intent === classification.intent) score += 0.25;
      if (classification.sales_stage && item.tags.sales_stage === classification.sales_stage) score += 0.15;
    }
    if (classification && classification.category && item.original_post.category) {
      if (item.original_post.category.toLowerCase().includes(classification.category.toLowerCase())) score += 0.1;
    }
    return { interaction: item, score: score, textSim: textSim, idx: idx };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  var selected = [], selectedVecs = [];
  for (var i = 0; i < scored.length; i++) {
    if (selected.length >= topK) break;
    var tooSimilar = false;
    for (var j = 0; j < selectedVecs.length; j++) {
      if (self._cosineSimilarity(self.docVectors[scored[i].idx], selectedVecs[j]) > 0.7) { tooSimilar = true; break; }
    }
    if (!tooSimilar) { selected.push(scored[i]); selectedVecs.push(self.docVectors[scored[i].idx]); }
  }
  return selected;
};

RetrievalEngine.prototype.formatExamples = function(results) {
  return results.map(function(r, i) {
    var item = r.interaction;
    var post = item.original_post;
    var example = "EXAMPLE " + (i + 1) + "\n";
    example += "Post by " + (post.author || "someone") + " in " + (post.category || "General") + ":\n";
    if (post.title) example += post.title + "\n";
    example += (post.body || "").substring(0, 400) + "\n\n";
    example += "Scott replied:\n";
    item.scott_replies.forEach(function(reply) {
      example += reply.content + "\n";
    });
    return example.trim();
  }).join("\n\n---\n\n");
};

RetrievalEngine.prototype.getStats = function() {
  var tagged = this.scottDirectReplies.filter(function(i) { return i.tags && i.tags.intent; });
  return {
    totalInteractions: this.interactions.length,
    scottDirectReplies: this.scottDirectReplies.length,
    taggedInteractions: tagged.length,
    categories: Array.from(new Set(this.interactions.map(function(i) { return i.original_post.category; }).filter(Boolean))),
    indexTerms: Object.keys(this.idfScores).length,
  };
};

module.exports = RetrievalEngine;
