const http = require('http');
const { spawn } = require('child_process');

// 1. Simple Health Check Server (Standard for Hugging Face)
const port = process.env.PORT || 7860;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
}).listen(port, '0.0.0.0', () => {
  console.log(`✅ Health check server is live on 0.0.0.0:${port}`);
});

// 2. Start the Worker using tsx
console.log('🚀 Starting LinkedIn Worker...');
const worker = spawn('npx', ['tsx', 'worker.ts'], {
  stdio: 'inherit',
  env: process.env
});

worker.on('exit', (code) => {
  console.log(`⚠️ Worker process exited with code ${code}`);
  process.exit(code);
});

worker.on('error', (err) => {
  console.error('❌ Failed to start worker:', err);
});
