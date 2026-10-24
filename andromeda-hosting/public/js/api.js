// API + WebSocket client.

async function request(method, url, body, { raw = false } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'AndromedaHosting' }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) {
      opts.body = body;
      opts.headers['Content-Type'] = 'application/octet-stream';
    } else {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, opts);
  if (raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new Event('hp:unauthorized'));
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  patch: (u, b = {}) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
  upload(url, file, onProgress) {
    // XHR gives upload progress; fetch does not.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('X-Requested-With', 'AndromedaHosting');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        xhr.status < 300 ? resolve(data) : reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Upload failed (network error)'));
      xhr.send(file);
    });
  },
};

// One shared socket with auto-reconnect; views register listeners.
const listeners = new Set();
let ws = null;
let subscribed = null;
let retry = 0;

export function connectSocket() {
  if (ws && ws.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    if (subscribed) ws.send(JSON.stringify({ type: 'subscribe', serverId: subscribed }));
    emit({ type: 'socket', connected: true });
  };
  ws.onmessage = (e) => {
    try { emit(JSON.parse(e.data)); } catch {}
  };
  ws.onclose = () => {
    emit({ type: 'socket', connected: false });
    ws = null;
    retry = Math.min(retry + 1, 6);
    setTimeout(connectSocket, 500 * 2 ** retry);
  };
}

export function disconnectSocket() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function emit(msg) {
  for (const fn of listeners) fn(msg);
}

export function onSocket(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribe(serverId) {
  subscribed = serverId;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: serverId ? 'subscribe' : 'unsubscribe', serverId }));
}
