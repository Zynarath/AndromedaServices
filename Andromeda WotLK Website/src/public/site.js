'use strict';
// The old site's menu and news toggles (functions.js toggleNewMenu / toggleEntry), without inline
// scripts. Open/closed state is remembered in this browser.
(function () {
  function load(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? def : v === '1';
    } catch (e) {
      return def;
    }
  }
  function save(key, on) {
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch (e) {}
  }

  function setMenu(id, open) {
    var inner = document.getElementById(id + '-inner');
    if (!inner) return;
    inner.style.display = open ? 'block' : 'none';
    document.getElementById(id + '-button').className = open ? 'menu-button-on' : 'menu-button-off';
    document.getElementById(id + '-collapse').className = open ? 'leftmenu-minuslink' : 'leftmenu-pluslink';
    document.getElementById(id + '-icon').className = id + (open ? '-icon-on' : '-icon-off');
    document.getElementById(id + '-header').className = id + (open ? '-header-on' : '-header-off');
  }

  function setNews(el, open) {
    el.className = open ? 'news-expand' : 'news-collapse' + (el.getAttribute('data-alt') || '');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var buttons = document.querySelectorAll('[data-menu]');
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        var id = btn.getAttribute('data-menu');
        setMenu(id, load('menu:' + id, true));
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var open = document.getElementById(id + '-inner').style.display === 'none';
          setMenu(id, open);
          save('menu:' + id, open);
        });
      })(buttons[i]);
    }

    var heads = document.querySelectorAll('[data-news]');
    for (var j = 0; j < heads.length; j++) {
      (function (head) {
        var entry = document.getElementById('news' + head.getAttribute('data-news'));
        var stored = null;
        try {
          stored = localStorage.getItem('news:' + head.getAttribute('data-news'));
        } catch (e) {}
        if (stored !== null) setNews(entry, stored === '1');
        head.addEventListener('click', function (e) {
          e.preventDefault();
          var open = entry.className !== 'news-expand';
          setNews(entry, open);
          save('news:' + head.getAttribute('data-news'), open);
        });
      })(heads[j]);
    }

    var confirmForms = document.querySelectorAll('form[data-confirm]');
    for (var k = 0; k < confirmForms.length; k++) {
      confirmForms[k].addEventListener('submit', function (e) {
        if (!window.confirm(this.getAttribute('data-confirm'))) e.preventDefault();
      });
    }
  });
})();
