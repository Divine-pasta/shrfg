const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const clipsDir = path.join(__dirname, 'clips');
if (!fs.existsSync(clipsDir)) {
  fs.mkdirSync(clipsDir);
}

let isMonitoring = false;
let latestSpikeDetected = false;

app.post('/start', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  isMonitoring = true;
  res.json({ success: true });
});

app.post('/stop', (req, res) => {
  isMonitoring = false;
  res.json({ success: true });
});

app.get('/poll', (req, res) => {
  res.json({ isMonitoring, spikeDetected: latestSpikeDetected });
  if (latestSpikeDetected) latestSpikeDetected = false;
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
