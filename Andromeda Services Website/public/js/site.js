'use strict';
// Header border on scroll, reveal-on-scroll, the typing console in the hero, and the waitlist form.
(function () {
  document.documentElement.classList.add('js');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();

  // Header gets a hairline once the page scrolls.
  const top = document.querySelector('.top');
  const onScroll = () => top && top.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Sections fade in as they come into view.
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.sec-head, .game, .feature, .steps li, .faq, .join').forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${(i % 4) * 60}ms`;
      io.observe(el);
    });
  }

  // The hero console types a few commands and prints what the server answers.
  const typing = document.querySelector('[data-typing]');
  const lines = document.querySelector('[data-console]');
  if (typing && lines && !reduced) {
    const script = [
      ['broadcast Raid night at 8!', 'Broadcast sent to 8 players.'],
      ['saveworld', 'World saved.'],
      ['listplayers', '8 players online.'],
      ['backup now', 'Backup created: 1.2 GB.'],
    ];
    let n = 0;
    const stamp = () => new Date().toTimeString().slice(0, 8);
    const print = (text) => {
      const p = document.createElement('p');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = `[${stamp()}] `;
      p.append(t, text);
      lines.append(p);
      while (lines.children.length > 3) lines.firstElementChild.remove();
    };
    const run = () => {
      const [cmd, answer] = script[n++ % script.length];
      let i = 0;
      typing.textContent = '';
      const tick = setInterval(() => {
        typing.textContent = cmd.slice(0, ++i);
        if (i >= cmd.length) {
          clearInterval(tick);
          setTimeout(() => { print(answer); typing.textContent = ''; setTimeout(run, 1400); }, 700);
        }
      }, 55);
    };
    setTimeout(run, 1600);
  }

  // Waitlist form.
  const form = document.getElementById('join-form');
  if (!form) return;
  const email = form.elements.email;
  const emailErr = document.getElementById('f-email-err');
  const msg = document.getElementById('form-msg');
  const button = form.querySelector('button[type=submit]');
  const setEmailError = (text) => {
    emailErr.textContent = text || '';
    emailErr.hidden = !text;
    email.setAttribute('aria-invalid', text ? 'true' : 'false');
    email.setAttribute('aria-describedby', text ? 'f-email-err' : '');
  };
  email.addEventListener('input', () => setEmailError(''));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    msg.className = 'form-msg';
    const value = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setEmailError(value ? "That email doesn't look right." : 'Enter your email so we can tell you when we open.');
      email.focus();
      return;
    }
    const body = {
      email: value,
      name: form.elements.name.value,
      players: form.elements.players.value,
      games: [...form.querySelectorAll('input[name=games]:checked')].map((c) => c.value),
      note: form.elements.note.value,
      website: form.elements.website.value,
    };
    button.disabled = true;
    button.textContent = 'Joining…';
    try {
      const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.field === 'email') { setEmailError(data.error); email.focus(); }
        else { msg.textContent = data.error || 'Something went wrong. Try again.'; msg.classList.add('bad'); }
        return;
      }
      const done = document.createElement('div');
      done.className = 'done';
      done.setAttribute('role', 'status');
      done.innerHTML = '<div class="badge" aria-hidden="true">✓</div><h3></h3><p></p>';
      done.querySelector('h3').textContent = data.again ? 'Your answers are updated.' : "You're on the list.";
      done.querySelector('p').textContent = `We'll email ${value} when servers open.`;
      form.replaceWith(done);
    } catch {
      msg.textContent = "Couldn't reach the server. Check your connection and try again.";
      msg.classList.add('bad');
    } finally {
      button.disabled = false;
      button.textContent = 'Join the waitlist';
    }
  });
})();
