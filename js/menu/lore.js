/** Lore JSON loader. Gameplay numbers in operators.js still win on conflict. */

let _lore = null;
let _pending = null;

export function loadLore() {
  if (_lore) return Promise.resolve(_lore);
  if (_pending) return _pending;
  _pending = fetch('js/data/operator-lore.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => { _lore = j || { setting: {}, operators: [] }; return _lore; })
    .catch(() => { _lore = { setting: {}, operators: [] }; return _lore; });
  return _pending;
}

export function loreFor(id) {
  const list = _lore?.operators || [];
  return list.find(o => o.id === id) || null;
}

export function loreUnits() {
  return _lore?.setting?.units || {
    attack: { shortName: 'Ashline', name: 'Ashline Entry Command' },
    defend: { shortName: 'Holdfast', name: 'Holdfast Protective Cadre' },
  };
}

export function loreReady() { return !!_lore; }
