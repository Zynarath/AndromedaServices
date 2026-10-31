// Applies the saved theme (Black or Dark grey) before the page draws, so it never flashes the
// other one. Loaded as a plain script in <head>; the sidebar's Theme button calls window.setTheme.
(function () {
  var THEMES = ['black', 'grey'];
  function get() {
    try {
      var t = localStorage.getItem('andromeda-theme');
      return THEMES.indexOf(t) >= 0 ? t : 'black';
    } catch (e) {
      return 'black';
    }
  }
  function apply(t) {
    if (t === 'grey') document.documentElement.setAttribute('data-theme', 'grey');
    else document.documentElement.removeAttribute('data-theme');
  }
  window.getTheme = get;
  window.setTheme = function (t) {
    try {
      localStorage.setItem('andromeda-theme', t);
    } catch (e) {}
    apply(t);
  };
  apply(get());
})();
