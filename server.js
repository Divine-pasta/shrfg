const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Ensure clips directory exists
const clipsDir = path.join(__dirname, 'clips');
if (!fs.existsSync(clipsDir)) {
  fs.mkdirSync(clipsDir);
}

let isMonitoring = false;
let latestSpikeDetected = false;
let currentStreamUrl = '';

// Endpoint to start monitoring a YouTube Live stream
app.post('/start', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'YouTube URL is required' });
  }

  currentStreamUrl = url;
  isMonitoring = true;
  latestSpikeDetected = false;
  
  console.log(`Started monitoring stream: ${url}`);
  res.json({ success: true, message: 'Started monitoring chat' });
});

// Endpoint to stop monitoring
app.post('/stop', (req, res) => {
  isMonitoring = false;
  currentStreamUrl = '';
  console.log('Stopped monitoring.');
  res.json({ success: true, message: 'Stopped monitoring' });
});

// Polling endpoint for the mobile app
app.get('/poll', (req, res) => {
  // Simulating or checking chat velocity spike flag
  res.json({
    isMonitoring,
    spikeDetected: latestSpikeDetected,
  });
  
  // Reset flag after poll so it triggers once per spike
  if (latestSpikeDetected) {
    latestSpikeDetected = false;
  }
});

// Helper function to trigger a clip download via yt-dlp & ffmpeg
function triggerClipGeneration(videoUrl) {
  console.log(`Triggering clip generation for: ${videoUrl}`);
  
  // Example command using yt-dlp to grab a recent segment / live chunk
  const outputPath = path.join(clipsDir, `clip_${Date.now()}.mp4`);
  
  const ytDlp = spawn('yt-dlp', [
    '-f', 'best[ext=mp4]',
    '--downloader', 'ffmpeg',
    '--download-sections', '*inf-30', // Grabs last 30 seconds roughly depending on stream type
    '-o', outputPath,
    videoUrl
  ]);

  ytDlp.stdout.on('data', (data) => {
    console.log(`yt-dlp: ${data}`);
  });

  ytDlp.stderr.on('data', (data) => {
    console.error(`yt-dlp error: ${data}`);
  });

  ytDlp.on('close', (code) => {
    console.log(`Clip process finished with code ${code}. Saved to ${outputPath}`);
  });
}

// Bind to 0.0.0.0 and process.env.PORT for Render / cloud hosting
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Clipper backend server running on port ${PORT}`);
});
