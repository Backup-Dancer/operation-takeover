import { BUILD, TITLE } from './version.js?v=iv-3.7.0';
import { Game } from './game.js?v=iv-3.7.0';

const meta = document.querySelector('meta[name=build]');
if (meta && meta.content !== BUILD && !new URLSearchParams(location.search).get('v')) {
  // mismatch between HTML and JS (stale CDN) — force reload
  const u = new URL(location.href);
  u.searchParams.set('v', BUILD);
  location.replace(u.toString());
}

try {
  const game = new Game();
  window.__game = game;
  window.__IV = game;
  window.__IV_BUILD = BUILD;
  console.info(TITLE, BUILD);
} catch (e) {
  console.error('boot failed', e);
  if (window.__ivShowError) window.__ivShowError(e && (e.stack || e.message) || e);
  throw e;
}
