import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { app } from '../server/src/app.js';

const PORT = 3456;

function captureViewport(width, height, outFile) {
  return new Promise((resolve, reject) => {
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cap-'));
    const edge = spawn(edgePath, [
      '--headless',
      '--disable-gpu',
      `--user-data-dir=${tmpProfile}`,
      '--virtual-time-budget=4000',
      `--window-size=${width},${height}`,
      `--screenshot=${outFile}`,
      `http://127.0.0.1:${PORT}`
    ]);

    edge.on('close', (code) => {
      console.log(`Viewport ${width}x${height} captured (code ${code}). Exists:`, fs.existsSync(outFile));
      try {
        fs.rmSync(tmpProfile, { recursive: true, force: true });
      } catch (e) {}
      resolve();
    });

    edge.on('error', (err) => {
      console.error(`Error on ${width}x${height}:`, err);
      reject(err);
    });
  });
}

const server = app.listen(PORT, '127.0.0.1', async () => {
  console.log(`Express server listening on http://127.0.0.1:${PORT}`);
  const baseDir = 'C:\\Users\\MCM\\.gemini\\antigravity\\brain\\2c892c98-8b77-4fef-9d8b-e5303d433fe0';

  try {
    await captureViewport(1200, 800, `${baseDir}\\desktop-preview.png`);
    await captureViewport(768, 1024, `${baseDir}\\tablet-preview.png`);
    await captureViewport(375, 812, `${baseDir}\\mobile-preview.png`);
    console.log('All viewports successfully captured.');
  } catch (err) {
    console.error('Capture error:', err);
  } finally {
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  }
});
