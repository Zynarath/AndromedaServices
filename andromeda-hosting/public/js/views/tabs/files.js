import { api } from '../../api.js';
import { html, $, on, icon, toast, fmtBytes, fmtDate, confirmBox, modal } from '../../ui.js';

const EDITABLE = /\.(txt|json|json5|properties|cfg|conf|ini|toml|yml|yaml|log|js|zs|snbt|mcmeta|md|csv|xml|sh|bat|ps1|lang|nbt\.txt)$|^(eula\.txt|ops\.json)$/i;

export async function render(root, { server }) {
  let cwd = sessionStorage.getItem('hp-files-path') || '';
  sessionStorage.removeItem('hp-files-path');
  const base = `/api/servers/${server.id}/files`;
  const selected = new Set();
  let entries = [];

  const join = (a, b) => (a ? `${a}/${b}` : b);
  const crumbs = () => {
    const parts = cwd ? cwd.split('/') : [];
    return html`<nav class="crumbs"><a href="#" data-cd="">${icon('folder')}${server.name}</a>${parts.map((p, i) => html`<span>/</span><a href="#" data-cd="${parts.slice(0, i + 1).join('/')}">${p}</a>`)}</nav>`;
  };

  const load = async () => {
    try {
      const r = await api.get(`${base}?path=${encodeURIComponent(cwd)}`);
      cwd = r.path === '.' ? '' : r.path;
      entries = r.entries;
    } catch (err) {
      toast(err.message, 'error');
      if (cwd) {
        cwd = '';
        return load();
      }
      entries = [];
    }
    selected.clear();
    draw();
  };

  const draw = () => {
    root.innerHTML = html`
      <div class="panel files" id="drop">
        <div class="files-bar">${crumbs()}
          <div class="btn-row">
            <button class="btn btn-sm btn-danger-text" id="del-sel" hidden>${icon('trash')}Delete selected</button>
            <button class="btn btn-sm" id="new-folder">${icon('folder')}New folder</button>
            <button class="btn btn-sm" id="new-file">${icon('file')}New file</button>
            <label class="btn btn-sm btn-primary">${icon('upload')}Upload<input type="file" id="upload" multiple hidden></label>
          </div></div>
        <div id="upload-status"></div>
        <table class="table files-table"><thead><tr><th class="w-check"><input type="checkbox" id="sel-all" aria-label="Select all"></th><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead>
          <tbody>
            ${cwd ? html`<tr><td></td><td colspan="4"><a href="#" data-cd="${cwd.split('/').slice(0, -1).join('/')}">${icon('folder')} ..</a></td></tr>` : ''}
            ${entries.map((e) => html`<tr data-name="${e.name}" data-dir="${e.dir ? 1 : 0}">
              <td><input type="checkbox" data-sel aria-label="Select ${e.name}"></td>
              <td class="fname">${e.dir ? html`<a href="#" data-cd="${join(cwd, e.name)}">${icon('folder')}${e.name}</a>` : EDITABLE.test(e.name) ? html`<a href="#" data-edit>${icon('file')}${e.name}</a>` : html`<span>${icon(/\.zip$/i.test(e.name) ? 'zip' : 'file')}${e.name}</span>`}</td>
              <td>${e.dir ? '' : fmtBytes(e.size)}</td><td class="muted">${fmtDate(e.mtime)}</td>
              <td class="right nowrap">
                ${/\.zip$/i.test(e.name) ? html`<button class="icon-btn" data-extract title="Extract here">${icon('zip')}</button>` : ''}
                <button class="icon-btn" data-rename title="Rename">${icon('edit')}</button>
                <a class="icon-btn" href="${base}/download?path=${encodeURIComponent(join(cwd, e.name))}" title="Download${e.dir ? ' as .zip' : ''}" download>${icon('download')}</a>
                <button class="icon-btn" data-delete title="Delete">${icon('trash')}</button></td></tr>`)}
          </tbody></table>
        ${!entries.length ? html`<p class="muted center">This folder is empty. Drag files here to upload.</p>` : ''}
        <p class="muted small">Tip: drag &amp; drop files or folders onto this panel to upload. Stop the server before replacing files it has open.</p>
      </div>`.s;
    $('#upload').onchange = (e) => upload([...e.target.files].map((f) => ({ file: f, rel: f.name })));
    $('#new-folder').onclick = async () => {
      const name = await prompt('New folder', 'Folder name');
      if (!name) return;
      await api.post(`${base}/mkdir`, { path: cwd, name }).then(load, (e) => toast(e.message, 'error'));
    };
    $('#new-file').onclick = async () => {
      const name = await prompt('New file', 'File name, e.g. notes.txt');
      if (!name) return;
      try {
        await api.put(`${base}/write?path=${encodeURIComponent(join(cwd, name))}`, { content: '' });
        await load();
        edit(join(cwd, name));
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    $('#sel-all').onchange = (e) => {
      root.querySelectorAll('[data-sel]').forEach((c) => {
        c.checked = e.target.checked;
        const n = c.closest('tr').dataset.name;
        e.target.checked ? selected.add(n) : selected.delete(n);
      });
      $('#del-sel').hidden = !selected.size;
    };
    $('#del-sel').onclick = () => remove([...selected]);
  };

  const prompt = (title, label, value = '') =>
    modal({
      title,
      body: html`<label class="field"><span>${label}</span><input id="prompt-in" value="${value}" autocomplete="off"></label>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'OK', kind: 'btn-primary', onClick: (w) => w.querySelector('#prompt-in').value.trim() || null }],
      onOpen: (w, close) => {
        const i = w.querySelector('#prompt-in');
        i.onkeydown = (e) => e.key === 'Enter' && close(i.value.trim() || null);
        setTimeout(() => i.select(), 0);
      },
    });

  const remove = async (names) => {
    if (!(await confirmBox('Delete?', `Permanently delete ${names.length === 1 ? names[0] : names.length + ' items'}? Folders are deleted with everything inside.`, { danger: true, confirm: 'Delete' }))) return;
    try {
      await api.post(`${base}/delete`, { paths: names.map((n) => join(cwd, n)) });
      toast('Deleted', 'ok', 1500);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const edit = async (rel) => {
    let content;
    try {
      content = (await api.get(`${base}/read?path=${encodeURIComponent(rel)}`)).content;
    } catch (err) {
      return toast(err.message, 'error');
    }
    await modal({
      title: rel,
      wide: true,
      body: html`<textarea class="editor" id="editor" spellcheck="false">${content}</textarea>`,
      actions: [
        { label: 'Cancel', value: null },
        {
          label: 'Save',
          kind: 'btn-primary',
          onClick: async (w) => {
            await api.put(`${base}/write?path=${encodeURIComponent(rel)}`, { content: w.querySelector('#editor').value });
            toast('Saved', 'ok', 1500);
          },
        },
      ],
      onOpen: (w) => {
        const ta = w.querySelector('#editor');
        ta.onkeydown = (e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            w.querySelector('[data-action="1"]').click();
          }
        };
      },
    });
    load();
  };

  const upload = async (items) => {
    if (!items.length) return;
    const status = $('#upload-status');
    let done = 0;
    for (const { file, rel } of items) {
      status.innerHTML = html`<div class="mini-job"><div class="bar"><span id="up-bar" style="width:0%"></span></div><small>Uploading ${rel} (${done + 1}/${items.length}, ${fmtBytes(file.size)})</small></div>`.s;
      try {
        await api.upload(`${base}/upload?path=${encodeURIComponent(cwd)}&name=${encodeURIComponent(rel)}`, file, (p) => {
          const bar = $('#up-bar');
          if (bar) bar.style.width = `${p * 100}%`;
        });
        done++;
      } catch (err) {
        toast(`${rel}: ${err.message}`, 'error');
      }
    }
    toast(`Uploaded ${done} file(s)`, 'ok');
    load();
  };

  // Drag & drop, including whole folders.
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
    e.preventDefault();
    $('#drop')?.classList.add('dragging');
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget)) $('#drop')?.classList.remove('dragging');
  });
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    $('#drop')?.classList.remove('dragging');
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    const files = entries.length ? (await Promise.all(entries.map((en) => walk(en)))).flat() : [...e.dataTransfer.files].map((f) => ({ file: f, rel: f.name }));
    upload(files);
  });

  on(root, 'click', '[data-cd]', (e, el) => {
    e.preventDefault();
    cwd = el.dataset.cd;
    load();
  });
  on(root, 'click', '[data-edit]', (e, el) => {
    e.preventDefault();
    edit(join(cwd, el.closest('tr').dataset.name));
  });
  on(root, 'click', '[data-delete]', (_e, el) => remove([el.closest('tr').dataset.name]));
  on(root, 'click', '[data-rename]', async (_e, el) => {
    const old = el.closest('tr').dataset.name;
    const name = await prompt('Rename', 'New name', old);
    if (!name || name === old) return;
    api.post(`${base}/rename`, { from: join(cwd, old), name }).then(load, (e) => toast(e.message, 'error'));
  });
  on(root, 'click', '[data-extract]', async (_e, el) => {
    const name = el.closest('tr').dataset.name;
    if (!(await confirmBox('Extract zip?', `Extract ${name} into this folder? Existing files with the same names are overwritten.`, { confirm: 'Extract' }))) return;
    try {
      const r = await api.post(`${base}/extract`, { path: join(cwd, name) });
      toast(`Extracted ${r.files} files`, 'ok');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  on(root, 'change', '[data-sel]', (_e, el) => {
    const n = el.closest('tr').dataset.name;
    el.checked ? selected.add(n) : selected.delete(n);
    $('#del-sel').hidden = !selected.size;
  });

  await load();
}
