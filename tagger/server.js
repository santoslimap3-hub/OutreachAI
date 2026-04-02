const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, '..', 'data', 'posts_with_scott_reply_threads.json');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'views')));

app.get('/', (req, res) => res.redirect('/tagger.html'));

app.get('/api/posts', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/posts', (req, res) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
        res.json({ saved: req.body.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Tagger running at http://localhost:${PORT}/tagger.html`);
});