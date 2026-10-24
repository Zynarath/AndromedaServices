import { api } from '../../api.js';
import { html, $, on, icon, toast } from '../../ui.js';

// Minecraft whitelist: who's allowed to join.
export async function render(root, { server }) {
  const base = `/api/servers/${server.id}/whitelist`;
  const draw = async () => {
    const w = await api.get(base);
    root.innerHTML = html`
      <div class="panel">
        <div class="panel-head"><h3>Whitelist <span class="count">${w.players.length + w.pending.length}</span></h3>
          <label class="switch"><input type="checkbox" id="wl-on" ${w.enabled ? 'checked' : ''}><span></span>${w.enabled ? 'Friends only' : 'Open to anyone'}</label></div>
        <p class="muted small">Minecraft has no join password, so the whitelist keeps the server private: only these players can join.
          ${w.enabled ? '' : html`<strong>The whitelist is off — anyone with the address can join.</strong>`}</p>
        <form class="input-row" id="wl-add"><input name="names" placeholder="Minecraft username(s), comma-separated" autocomplete="off"><button class="btn btn-primary">${icon('plus')}Add</button></form>
        <ul class="wl-list">
          ${w.players.map((n) => html`<li><img src="https://mc-heads.net/avatar/${n}/32" alt="" loading="lazy"><span>${n}</span>${w.online.includes(n) ? html`<span class="pill pill-ok">online</span>` : ''}<button class="icon-btn" data-remove="${n}" title="Remove">${icon('trash')}</button></li>`)}
          ${w.pending.map((n) => html`<li><span class="cf-noimg">${icon('clock')}</span><span>${n}</span><span class="pill pill-warn" title="Added when the server next starts">pending</span><button class="icon-btn" data-remove="${n}" title="Remove">${icon('trash')}</button></li>`)}
        </ul>
        ${!w.players.length && !w.pending.length ? html`<p class="muted">Nobody is whitelisted yet. Add yourself and your friends.</p>` : ''}
        ${w.pending.length ? html`<p class="muted small">Pending names are added automatically the next time the server is running (the server looks up their accounts).</p>` : ''}
      </div>`.s;
    $('#wl-add').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api.post(base, { names: e.target.names.value });
        toast(r.applied ? 'Added' : 'Added — applies when the server starts', 'ok');
        setTimeout(draw, 800);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    $('#wl-on').onchange = async (e) => {
      await api.put(`${base}/enabled`, { enabled: e.target.checked }).then(draw, (err) => toast(err.message, 'error'));
    };
  };
  on(root, 'click', '[data-remove]', async (_e, el) => {
    await api.del(`${base}/${encodeURIComponent(el.dataset.remove)}`).then(() => setTimeout(draw, 500), (err) => toast(err.message, 'error'));
  });
  await draw();
}
