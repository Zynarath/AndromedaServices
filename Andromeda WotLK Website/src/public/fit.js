'use strict';
// The old site is a fixed ~1010px wide layout, which looks tiny in a full-screen window on a big or
// high-resolution screen. Scale the whole page up with the window (never down).
// Loaded in <head> without defer so the page is drawn at the right size from the start.
(function () {
  var WIDTH = 1300; // the layout is ~1010px wide; this leaves some of the background showing at the sides
  var MAX = 2.5;
  var root = document.documentElement;
  function fit() {
    var z = Math.min(MAX, Math.max(1, window.innerWidth / WIDTH));
    root.style.zoom = z > 1.02 ? String(Math.floor(z * 100) / 100) : '';
  }
  fit();
  window.addEventListener('resize', fit);
})();
