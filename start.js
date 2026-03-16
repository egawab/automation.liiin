const http = require('http');
const { spawn } = require('child_process');

// Hugging Face uses PORT 7860 by default
const port = process.env.PORT || 7860;

// 1. Mandatory Health Check Server
// Hugging Face will 503 if this isn't responding on the correct port
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Worker is active\n');
}).listen(port, '0.0.0.0', () => {
  console.log(`✅ [SYSTEM] Health check server listening on port ${port}`);
});

// 2. Resilient Worker Supervisor
function runWorker() {
  console.log('🚀 [SYSTEM] Spawning worker.ts...');
  
  const worker = spawn('npx', ['tsx', 'worker.ts'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });

  worker.on('exit', (code) => {
    console.log(`⚠️ [SYSTEM] Worker exited with code ${code}. Restarting in 10s...`);
    setTimeout(runWorker, 10000);
  });

  worker.on('error', (err) => {
    console.error('❌ [SYSTEM] Spawn error:', err);
    setTimeout(runWorker, 10000);
  });
}

// Kick off the worker
runWorker();

// Keep supervisor alive on exceptions
process.on('uncaughtException', (err) => console.error('Supervisor error:', err));
