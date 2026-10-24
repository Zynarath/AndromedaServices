// The file share page friends open. Access is decided by the server from the visitor's IP.
import { html, $, on, icon, toast, fmtBytes, fmtDate, copyText, confirmBox, modal } from './ui.js';

const root = $('#share');
const H = { 'X-Requested-With': 'AndromedaHosting' };
let cwd = new URLSearchParams(location.search).get('path') || '';
let me = null;

async function get(url) {
  const res = await fetch(url, { headers: H });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const join = (a, b) => (a ? `${a}/${b}` : b);
const dl = (p) => `/share/api/download?path=${encodeURIComponent(p)}`;

function denied() {
  root.innerHTML = html`<div class="share-card center">
    <img src="/img/icon.svg" alt="" class="share-logo"><h1>${me.title}</h1>
    <div class="callout callout-warn" style="text-align:left">${icon('shield')}<div><strong>Your connection isn't on the allowed list yet.</strong><br>
      Send this IP address to the person running the server so they can let you in:</div></div>
    <div class="address big-ip"><code>${me.ip}</code><button class="btn btn-sm" data-copy="${me.ip}">${icon('copy')}Copy</button></div>
    <p class="muted small">Once they've added it, refresh this page.</p></div>`.s;
}

async function draw() {
  let data;
  try {
    data = await get(`/share/api/list?path=${encodeURIComponent(cwd)}`);
  } catch (err) {
    if (err.status === 403) return denied();
    root.innerHTML = html`<div class="share-card"><div class="form-error">${err.message}</div></div>`.s;
    return;
  }
  cwd = data.path;
  history.replaceState(null, '', cwd ? `?path=${encodeURIComponent(cwd)}` : location.pathname);
  const parts = cwd ? cwd.split('/') : [];
  const total = data.entries.reduce((n, e) => n + (e.dir ? 0 : e.size), 0);
  root.innerHTML = html`
    <header class="share-head"><img src="/img/icon.svg" alt="" class="share-logo"><div><h1>${me.title}</h1>
      <p class="muted small">${me.canUpload ? 'You are on the host PC — you can upload and manage files.' : `Connected from ${me.ip}`}</p></div></header>
    <div class="panel files ${me.canUpload ? '' : 'readonly'}" id="drop">
      <div class="files-bar">
        <nav class="crumbs"><a href="#" data-cd="">${icon('folder')}Shared files</a>${parts.map((p, i) => html`<span>/</span><a href="#" data-cd="${parts.slice(0, i + 1).join('/')}">${p}</a>`)}</nav>
        <div class="btn-row">
          <a class="btn btn-sm" href="${dl(cwd)}" download>${icon('zip')}Download ${cwd ? 'this folder' : 'everything'} (.zip)</a>
          ${me.canUpload ? html`<button class="btn btn-sm" id="mkdir">${icon('folder')}New folder</button>
            <label class="btn btn-sm btn-primary">${icon('upload')}Upload<input type="file" id="upload" multiple hidden></label>` : ''}
        </div>
      </div>
      <div id="upload-status"></div>
      ${data.entries.length
        ? html`<table class="table files-table"><thead><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>
          ${cwd ? html`<tr><td colspan="4"><a href="#" data-cd="${parts.slice(0, -1).join('/')}">${icon('folder')} ..</a></td></tr>` : ''}
          ${data.entries.map((e) => html`<tr data-name="${e.name}">
            <td class="fname">${e.dir ? html`<a href="#" data-cd="${join(cwd, e.name)}">${icon('folder')}${e.name}</a>` : html`<a href="${dl(join(cwd, e.name))}" download>${icon('file')}${e.name}</a>`}</td>
            <td>${e.dir ? '' : fmtBytes(e.size)}</td><td class="muted">${fmtDate(e.mtime)}</td>
            <td class="right nowrap"><a class="icon-btn" href="${dl(join(cwd, e.name))}" title="Download${e.dir ? ' as .zip' : ''}" download>${icon('download')}</a>
              ${me.canUpload ? html`<button class="icon-btn" data-rename title="Rename">${icon('edit')}</button><button class="icon-btn" data-delete title="Delete">${icon('trash')}</button>` : ''}</td></tr>`)}
          </tbody></table>
          <p class="muted small">${data.entries.filter((e) => !e.dir).length} file(s), ${fmtBytes(total)} in this folder. Large downloads can be paused and resumed in your browser.</p>`
        : html`<p class="muted center">This folder is empty.${me.canUpload ? ' Drag files here to upload.' : ''}</p>`}
    </div>`.s;
  if (me.canUpload) {
    $('#upload').onchange = (e) => upload([...e.target.files].map((f) => ({ file: f, rel: f.name })));
    $('#mkdir').onclick = async () => {
      const name = await ask('New folder', 'Folder name');
      if (name) post('/share/api/mkdir', { path: cwd, name }).then(draw, (e) => toast(e.message, 'error'));
    };
  }
}

const ask = (title, label, value = '') =>
  modal({
    title,
    body: html`<label class="field"><span>${label}</span><input id="ask-in" value="${value}" autocomplete="off"></label>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'OK', kind: 'btn-primary', onClick: (w) => w.querySelector('#ask-in').value.trim() || null }],
  });

function upload(items) {
  if (!items.length) return;
  const status = $('#upload-status');
  let i = 0;
  const next = () => {
    if (i >= items.length) {
      toast(`Uploaded ${items.length} file(s)`, 'ok');
      return draw();
    }
    const { file, rel } = items[i++];
    status.innerHTML = html`<div class="mini-job"><div class="bar"><span id="up-bar" style="width:0%"></span></div><small>Uploading ${rel} (${i}/${items.length}, ${fmtBytes(file.size)})</small></div>`.s;
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/share/api/upload?path=${encodeURIComponent(cwd)}&name=${encodeURIComponent(rel)}`);
    xhr.setRequestHeader('X-Requested-With', 'AndromedaHosting');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && ($('#up-bar').style.width = `${(e.loaded / e.total) * 100}%`);
    xhr.onload = () => {
      if (xhr.status >= 300) toast(`${rel}: ${(JSON.parse(xhr.responseText || '{}').error) || 'upload failed'}`, 'error');
      next();
    };
    xhr.onerror = () => {
      toast(`${rel}: upload failed`, 'error');
      next();
    };
    xhr.send(file);
  };
  next();
}

const walk = async (entry, prefix = '') => {
  if (entry.isFile) return [await new Promise((r) => entry.file((f) => r({ file: f, rel: prefix + f.name })))];
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const all = [];
  for (;;) {
    const batch = await new Promise((r) => reader.readEntries(r));
    if (!batch.length) break;
    all.push(...batch);
  }
  return (await Promise.all(all.map((e) => walk(e, `${prefix}${entry.name}/`)))).flat();
};

root.addEventListener('dragover', (e) => {
  if (!me?.canUpload) return;
  e.preventDefault();
  $('#drop')?.classList.add('dragging');
});
root.addEventListener('dragleave', (e) => !root.contains(e.relatedTarget) && $('#drop')?.classList.remove('dragging'));
root.addEventListener('drop', async (e) => {
  if (!me?.canUpload) return;
  e.preventDefault();
  $('#drop')?.classList.remove('dragging');
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  upload((await Promise.all(entries.map((en) => walk(en)))).flat());
});
on(root, 'click', '[data-cd]', (e, el) => {
  e.preventDefault();
  cwd = el.dataset.cd;
  draw();
});
on(root, 'click', '[data-copy]', (_e, el) => copyText(el.dataset.copy));
on(root, 'click', '[data-delete]', async (_e, el) => {
  const name = el.closest('tr').dataset.name;
  if (await confirmBox('Delete?', `Delete ${name}? Folders are deleted with everything inside.`, { danger: true, confirm: 'Delete' }))
    post('/share/api/delete', { paths: [join(cwd, name)] }).then(draw, (e) => toast(e.message, 'error'));
});
on(root, 'click', '[data-rename]', async (_e, el) => {
  const old = el.closest('tr').dataset.name;
  const name = await ask('Rename', 'New name', old);
  if (name && name !== old) post('/share/api/rename', { from: join(cwd, old), name }).then(draw, (e) => toast(e.message, 'error'));
});

(async () => {
  try {
    me = await get('/share/api/whoami');
  } catch (err) {
    root.innerHTML = html`<div class="share-card"><div class="form-error">${err.message}</div></div>`.s;
    return;
  }
  document.title = me.title;
  if (!me.enabled) {
    root.innerHTML = html`<div class="share-card center"><img src="/img/icon.svg" alt="" class="share-logo"><h1>File share</h1><p class="muted">File sharing is turned off.</p></div>`.s;
    return;
  }
  if (!me.canDownload) return denied();
  draw();
})();
