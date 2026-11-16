/* Seat Tracker - the full guide, rendered from core/help.js */
(function () {
  'use strict';
  const H = globalThis.SK.help;
  const toc = document.getElementById('toc');
  const content = document.getElementById('content');

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  for (const key of H.order) {
    const sec = H.sections[key];
    const a = el('a', null, sec.title);
    a.href = '#' + key;
    toc.append(a);

    const box = el('section');
    box.id = key;
    box.append(el('h2', null, sec.title));
    if (sec.intro) box.append(el('p', 'intro', sec.intro));
    for (const it of sec.items) {
      const item = el('div', 'help-item');
      const name = el('div', 'help-name', it.name);
      if (it.def) name.append(el('span', 'help-def', 'default: ' + it.def));
      item.append(name, el('div', 'help-text', it.text));
      box.append(item);
    }
    content.append(box);
  }

  chrome.storage.local.get('settings').then(({ settings }) => {
    const theme = settings && settings.theme;
    if (theme === 'dark' || theme === 'light') document.body.setAttribute('data-theme', theme);
  }).catch(() => {});

  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) setTimeout(() => target.scrollIntoView(), 30);
  }
})();
