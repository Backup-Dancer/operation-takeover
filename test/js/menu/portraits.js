/** Operator select portraits from assets/ui/operators/. Busts are lazy-loaded. */

const IDS = ['forge', 'quill', 'marrow', 'glyph', 'rivet', 'briar', 'husk', 'shade'];
const bustCache = new Map();

export function cardUrl(id) {
  return id ? `assets/ui/operators/${id}_card.webp` : '';
}

export function bustUrl(id) {
  return id ? `assets/ui/operators/${id}_bust.webp` : '';
}

export function hasPortrait(id) {
  return IDS.includes(id);
}

/** Prefetch a bust for the showcase; resolves when the image is decode-ready. */
export function loadBust(id) {
  if (!id) return Promise.resolve(null);
  if (bustCache.has(id)) return bustCache.get(id);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = bustUrl(id);
  });
  bustCache.set(id, p);
  return p;
}

export function prefetchBusts(ids = IDS) {
  for (const id of ids) loadBust(id);
}
