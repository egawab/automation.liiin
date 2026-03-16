const http = require('http');
const { spawn } = require('child_process');

const port = process.env.PORT || 7860;

// 1. SIMPLE HEALTH CHECK SERVER (Mandatory for Hugging Face)
// This must stay alive regardless of the worker's status
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Worker is supervised and health check is alive.');
}).listen(port, '0.0.0.0', () => {
  console.log(`✅ Hugging Face Health Check Server live on port ${port}`);
});

// 2. SUPERVISED WORKER EXECUTION
function startWorker() {
  console.log('🚀 Supervisor: Starting LinkedIn Worker (worker.ts)...');

  // We use npx tsx to execute the typescript file directly in the container
  const worker = spawn('npx', ['tsx', 'worker.ts'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });

  worker.on('exit', (code, signal) => {
    console.warn(`💥 Supervisor: Worker process exited with code ${code} and signal ${signal}`);
    
    // Auto-restart logic with a 5-second backoff
    console.log('🔄 Supervisor: Restarting worker in 5 seconds...');
    setTimeout(startWorker, 5000);
  });

  worker.on('error', (err) => {
    console.error('❌ Supervisor: Failed to start worker process:', err);
    setTimeout(startWorker, 10000);
  });
}

// Initial start
startWorker();

// Keep the process alive
process.on('uncaughtException', (err) => {
  console.error('⛔ Supervisor Header Exception:', err);
});
