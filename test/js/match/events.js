/** Tiny event bus used by the MatchHandle. */

export function createBus() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => this.off(type, fn);
    },
    off(type, fn) {
      map.get(type)?.delete(fn);
    },
    once(type, fn) {
      const wrap = (p) => { this.off(type, wrap); fn(p); };
      return this.on(type, wrap);
    },
    emit(type, payload) {
      const list = map.get(type);
      if (!list) return;
      for (const fn of [...list]) {
        try { fn(payload); } catch (e) { console.warn('match event', type, e); }
      }
    },
    clear() { map.clear(); },
  };
}
