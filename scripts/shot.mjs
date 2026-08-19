/**
 * Screenshot the running app through the DevTools Protocol.
 *
 * `--headless --screenshot` is not usable here: it drives the page on a virtual
 * clock that races past IndexedDB's disk I/O, so the shot lands on the loading
 * state. This waits for a real selector on a real clock instead, and reports
 * whatever the page logged on the way.
 *
 * No dependencies — Node's built-in WebSocket does the talking.
 *
 *   node scripts/shot.mjs <url> <out.png> [--wait <selector>]
 *        [--eval <js> | --eval-file <path>] [--ms <timeout>] [--profile <dir>]
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT ?? 9333);

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: shot.mjs <url> <out.png> [--wait sel] [--eval js|--eval-file f] [--ms n]');
  process.exit(2);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const waitFor = arg('--wait', null);
// `--eval-file` because seeding a store means shipping the data with the script,
// and a corpus large enough to be worth looking at exceeds the command line.
const evalFile = arg('--eval-file', null);
const evalJs = evalFile ? readFileSync(evalFile, 'utf8') : arg('--eval', null);
const timeoutMs = Number(arg('--ms', 15000));
const width = Number(arg('--w', 1400));
const height = Number(arg('--h', 850));

const profile = mkdtempSync(join(tmpdir(), 'arlinje-shot-'));
const keepProfile = process.argv.includes('--keep-profile');
const profileDir = arg('--profile', profile);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${PORT}`,
  `--window-size=${width},${height}`,
  url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Chrome has not opened the port yet.
    }
    await sleep(150);
  }
  throw new Error('could not reach Chrome DevTools');
}

let nextId = 1;
function rpc(ws, method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

try {
  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const logs = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (msg.params.type === 'error' || msg.params.type === 'warning') {
        logs.push(`${msg.params.type}: ${text}`);
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push(`uncaught: ${d.exception?.description ?? d.text}`);
    }
  });

  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Page.enable');

  if (waitFor) {
    const deadline = Date.now() + timeoutMs;
    let seen = false;
    while (Date.now() < deadline) {
      const { result } = await rpc(ws, 'Runtime.evaluate', {
        expression: `!!document.querySelector(${JSON.stringify(waitFor)})`,
        returnByValue: true,
      });
      if (result.value === true) { seen = true; break; }
      await sleep(120);
    }
    if (!seen) {
      console.error(`TIMEOUT waiting for: ${waitFor}`);
      process.exitCode = 1;
    }
  } else {
    await sleep(1200);
  }

  if (evalJs) {
    const { result, exceptionDetails } = await rpc(ws, 'Runtime.evaluate', {
      expression: evalJs,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      logs.push(`eval: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    } else if (result?.value !== undefined) {
      console.log(`eval → ${JSON.stringify(result.value)}`);
    }
    await sleep(600);
  }

  const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out}`);
  if (logs.length > 0) console.log('page logged:\n  ' + logs.join('\n  '));
  ws.close();
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  chrome.kill();
  if (!keepProfile && profileDir === profile) {
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
