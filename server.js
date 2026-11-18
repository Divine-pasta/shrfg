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
let currentStreamUrl = null; // Store current stream URL for clipping
let isClipping = false;

// Helper to extract 11-character YouTube Video ID from standard, live, or youtu.be links
function extractVideoId(url) {
  const match = url.match(/(?:v=|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Function to trigger yt-dlp + ffmpeg clipping on chat spike
function triggerClipRecording(videoUrl) {
  if (isClipping) return;
  isClipping = true;

  console.log('Spike triggered! Extracting direct stream URL via yt-dlp...');

  // Step 1: Get the direct m3u8 stream link using yt-dlp
  const ytdlp = spawn('yt-dlp', ['-g', videoUrl]);
  let streamUrl = '';

  ytdlp.stdout.on('data', (data) => {
    streamUrl += data.toString();
  });

  ytdlp.on('close', (code) => {
    if (code !== 0 || !streamUrl.trim()) {
      console.error('Failed to get stream URL from yt-dlp');
      isClipping = false;
      return;
    }

    const directUrl = streamUrl.trim().split('\n')[0];
    const timestamp = Date.now();
    const outputPath = path.join(clipsDir, `clip-${timestamp}.mp4`);

    console.log('Recording 30s clip with ffmpeg...');

    // Step 2: Use ffmpeg to record 30 seconds (9:16 vertical crop for shorts/reels)
    const ffmpeg = spawn('ffmpeg', [
      '-ss', '00:00:00',
      '-i', directUrl,
      '-t', '30',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-y',
      outputPath
    ]);

    ffmpeg.on('close', (ffmpegCode) => {
      isClipping = false;
      if (ffmpegCode === 0) {
        console.log(`Successfully saved clip: ${outputPath}`);
      } else {
        console.error(`FFmpeg process exited with code ${ffmpegCode}`);
      }
    });
  });
}

app.get('/', (req, res) => {
  res.send('Clipper Backend is Live');
});

app.post('/start', async (req, res) => {
  const { url, threshold = 15 } = req.body; 
  const liveId = url ? extractVideoId(url) : null;

  if (!liveId) {
    return res.status(400).json({ error: 'Valid YouTube Live URL is required' });
  }

  currentStreamUrl = url; // Save URL for clipper

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

    // Keep only messages from the last 4 seconds
    messageTimestamps = messageTimestamps.filter((t) => now - t <= 4000);

    // Trigger spike if velocity reaches 15 msgs in 4s and 30s cooldown has passed
    if (messageTimestamps.length >= threshold && now - lastSpikeTime > 30000) {
      lastSpikeTime = now;
      latestSpikeDetected = true;
      console.log(`Chat spike detected! (${messageTimestamps.length} msgs in 4s)`);
      
      // Automatically run clipping process on server
      if (currentStreamUrl) {
        triggerClipRecording(currentStreamUrl);
      }
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
  currentStreamUrl = null;
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

// Serve recorded clips so you can download or view them
app.use('/clips', express.static(clipsDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Clipper backend running on port ${PORT}`);
});
