// Хеш-роутер: GitHub Pages отдаёт один index.html, глубокие ссылки работают без 404-трюков.
function parse() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}

export const route = $state(parse());

window.addEventListener('hashchange', () => {
  Object.assign(route, parse());
});

export function go(path: string) {
  if (location.hash.replace(/^#/, '') !== path) location.hash = path;
}
export const href = (path: string) => `#${path}`;
