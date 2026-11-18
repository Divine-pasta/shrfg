const express = require('express');
const { LiveChat } = require('youtube-chat');
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
let activeChat = null;
let messageTimestamps = [];
let lastSpikeTime = 0;

// Helper to extract 11-character YouTube Video ID from standard, live, or youtu.be links
function extractVideoId(url) {
  const match = url.match(/(?:v=|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

app.get('/', (req, res) => {
  res.send('Clipper Backend is Live');
});

app.post('/start', async (req, res) => {
  const { url, threshold = 15 } = req.body; // Default: 15 messages within 4 seconds triggers a spike
  const liveId = url ? extractVideoId(url) : null;

  if (!liveId) {
    return res.status(400).json({ error: 'Valid YouTube Live URL is required' });
  }

  // Stop any existing chat listener first
  if (activeChat) {
    activeChat.stop();
    activeChat = null;
  }

  messageTimestamps = [];
  latestSpikeDetected = false;
  activeChat = new LiveChat({ liveId });

  activeChat.on('start', (id) => {
    isMonitoring = true;
    console.log(`Connected to live chat for video: ${id}`);
  });

  activeChat.on('chat', () => {
    const now = Date.now();
    messageTimestamps.push(now);

    // Keep only messages from the last 4 seconds (4000 milliseconds)
    messageTimestamps = messageTimestamps.filter((t) => now - t <= 4000);

    // Trigger spike if velocity reaches 15 msgs in 4s and 30s cooldown has passed
    if (messageTimestamps.length >= threshold && now - lastSpikeTime > 30000) {
      lastSpikeTime = now;
      latestSpikeDetected = true;
      console.log(`Chat spike detected! (${messageTimestamps.length} msgs in 4s)`);
    }
  });

  activeChat.on('error', (err) => {
    console.error('LiveChat error:', err);
  });

  activeChat.on('end', () => {
    isMonitoring = false;
    console.log('Live chat ended.');
  });

  const started = await activeChat.start();
  if (!started) {
    isMonitoring = false;
    return res.status(500).json({ error: 'Failed to connect to stream chat. Ensure the stream is currently live.' });
  }

  res.json({ success: true, liveId, message: 'Monitoring live chat velocity' });
});

app.post('/stop', (req, res) => {
  if (activeChat) {
    activeChat.stop();
    activeChat = null;
  }
  isMonitoring = false;
  messageTimestamps = [];
  res.json({ success: true, message: 'Stopped monitoring' });
});

app.get('/poll', (req, res) => {
  res.json({
    isMonitoring,
    spikeDetected: latestSpikeDetected,
    messagesLast4s: messageTimestamps.filter((t) => Date.now() - t <= 4000).length
  });

  if (latestSpikeDetected) {
    latestSpikeDetected = false;
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Clipper backend running on port ${PORT}`);
});
