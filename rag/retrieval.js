const fs = require("fs");

const STOP_WORDS = new Set(["the","be","to","of","and","a","in","that","have","i","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","say","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","when","make","can","like","time","no","just","him","know","take","people","into","year","your","good","some","could","them","see","other","than","then","now","look","only","come","its","over","think","also","back","after","use","two","how","our","work","first","well","way","even","new","want","because","any","these","give","day","most","us","are","was","has","had","been","did","got","too","very","more","much","really","thing"]);

class RetrievalEngine {
  constructor(dataPath) {
    this.interactions = [];
    this.scottInteractions = [];
    this.idfScores = {};
    this.docVectors = [];
    if (dataPath) this.loadData(dataPath);
  }

  loadData(dataPath) {
    var raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    this.interactions = raw.interactions || raw;
    this.scottInteractions = this.interactions.filter(function(i) {
      if (i.scott_involved) return true;
      return (i.threads || []).some(function(t) {
        if (t.comment.isTargetMember) return true;
        return (t.replies || []).some(function(r) { return r.isTargetMember; });
      });
    });
    console.log("Loaded " + this.interactions.length + " total, " + this.scottInteractions.length + " with Scott");
    this._buildIndex();
  }

  _tokenize(text) {
    return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function(w) { return w.length > 2 && !STOP_WORDS.has(w); });
  }

  _getSearchableText(interaction) {
    var parts = [interaction.original_post.title || "", interaction.original_post.body || "", interaction.original_post.category || ""];
    (interaction.threads || []).forEach(function(t) {
      parts.push(t.comment.content || "");
      (t.replies || []).forEach(function(r) { parts.push(r.content || ""); });
    });
    return parts.join(" ");
  }

  _buildIndex() {
    var self = this;
    var docs = this.scottInteractions.map(function(i) { return self._getSearchableText(i); });
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
      var maxTf = Math.max.apply(null, Object.values(tf).concat([1]));
      var vector = {};
      Object.keys(tf).forEach(function(term) {
        vector[term] = (tf[term] / maxTf) * (self.idfScores[term] || 1);
      });
      return vector;
    });
    console.log("Index: " + Object.keys(this.idfScores).length + " terms");
  }

  _cosineSimilarity(vecA, vecB) {
    var allTerms = new Set(Object.keys(vecA).concat(Object.keys(vecB)));
    var dot = 0, magA = 0, magB = 0;
    allTerms.forEach(function(term) {
      var a = vecA[term] || 0, b = vecB[term] || 0;
      dot += a * b; magA += a * a; magB += b * b;
    });
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  _queryToVector(text) {
    var self = this;
    var tokens = this._tokenize(text);
    var tf = {};
    tokens.forEach(function(t) { tf[t] = (tf[t] || 0) + 1; });
    var maxTf = Math.max.apply(null, Object.values(tf).concat([1]));
    var vector = {};
    Object.keys(tf).forEach(function(term) {
      vector[term] = (tf[term] / maxTf) * (self.idfScores[term] || 1);
    });
    return vector;
  }

  retrieve(postText, classification, topK) {
    topK = topK || 4;
    var self = this;
    var queryVec = this._queryToVector(postText);
    var scored = this.scottInteractions.map(function(interaction, idx) {
      var score = 0;
      var textSim = self._cosineSimilarity(queryVec, self.docVectors[idx]);
      score += textSim * 0.5;
      if (classification && interaction.tags) {
        if (classification.intent && interaction.tags.intent === classification.intent) score += 0.25;
        if (classification.sales_stage && interaction.tags.sales_stage === classification.sales_stage) score += 0.15;
      }
      if (classification && classification.category && interaction.original_post.category) {
        if (interaction.original_post.category.toLowerCase().includes(classification.category.toLowerCase())) score += 0.1;
      }
      return { interaction: interaction, score: score, textSim: textSim, idx: idx };
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
  }

  formatExamples(results) {
    return results.map(function(r, i) {
      var inter = r.interaction, post = inter.original_post;
      var example = "EXAMPLE " + (i + 1);
      if (inter.tags && inter.tags.intent) example += " [intent: " + inter.tags.intent + "]";
      if (inter.tags && inter.tags.sales_stage) example += " [stage: " + inter.tags.sales_stage + "]";
      example += "\nSomeone posted in \"" + (post.category || "General") + "\":\n";
      example += "\"" + (post.title ? post.title + " - " : "") + (post.body || "").substring(0, 300) + "\"\n\n";
      (inter.threads || []).forEach(function(thread) {
        var scottInThread = thread.comment.isTargetMember || (thread.replies || []).some(function(r) { return r.isTargetMember; });
        if (!scottInThread) return;
        if (!thread.comment.isTargetMember) example += thread.comment.author + " commented: \"" + thread.comment.content.substring(0, 200) + "\"\n";
        if (thread.comment.isTargetMember) example += "You (Scott) replied: \"" + thread.comment.content + "\"\n";
        (thread.replies || []).forEach(function(reply) {
          if (reply.isTargetMember) example += "You (Scott) replied: \"" + reply.content + "\"\n";
          else example += reply.author + " said: \"" + reply.content.substring(0, 150) + "\"\n";
        });
        example += "\n";
      });
      return example.trim();
    }).join("\n\n---\n\n");
  }

  getStats() {
    var tagged = this.scottInteractions.filter(function(i) { return i.tags && i.tags.intent; });
    return {
      totalInteractions: this.interactions.length,
      scottInteractions: this.scottInteractions.length,
      taggedInteractions: tagged.length,
      categories: Array.from(new Set(this.interactions.map(function(i) { return i.original_post.category; }).filter(Boolean))),
      indexTerms: Object.keys(this.idfScores).length,
    };
  }
}

module.exports = RetrievalEngine;
