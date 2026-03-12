const { spawn } = require('child_process');

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request(url, options = {}) {
  const resp = await fetch(url, options);
  return { status: resp.status, body: await resp.json() };
}

async function run() {
  const procs = [
    spawn('node', ['apps/prediction-platform/server.js'], { stdio: 'ignore' }),
    spawn('node', ['apps/wallet-platform/server.js'], { stdio: 'ignore' }),
    spawn('node', ['apps/analytics-platform/server.js'], { stdio: 'ignore' })
  ];

  try {
    await wait(1000);

    const p = await request('http://localhost:4000/health');
    const w = await request('http://localhost:4001/health');
    const a = await request('http://localhost:4002/health');

    if (p.status !== 200 || w.status !== 200 || a.status !== 200) {
      throw new Error('health check failed');
    }

    console.log('smoke test passed');
  } finally {
    procs.forEach((p) => p.kill());
  }
}

run().catch((e) => {
  console.error('smoke test failed:', e.message);
  process.exit(1);
});
