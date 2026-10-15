// Connects to the app's shell page over the Chrome DevTools Protocol. The app
// must be running with --remote-debugging-port (see capture.mjs).
export async function connect(port = 9222) {
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.find((t) => t.url.includes('shell/index.html'))) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const shell = targets?.find((t) => t.url.includes('shell/index.html'));
  if (!shell) throw new Error('App not reachable on port ' + port);
  const ws = new WebSocket(shell.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const cmd = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { pending.get(m.id)(m.result ?? { error: m.error }); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const ev = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return { cmd, ev, wait, close: () => ws.close() };
}
