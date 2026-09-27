/* A diary page's share card (1200×630, the Open Graph size): the page itself lying on the desk, drawn just
   as the 3D book draws its pages (raster.js), and beside it the journal's name, the day, the title, the first
   words and where it was written. Made in the admin's browser when a page is published, then uploaded
   (PUT /api/admin/entries/<id>/card); /p/<id> shares it. Built to public/assets/card.js (npm run build:3d). */
import { rasterize } from './book3d/raster.js';

const W = 1200, H = 630;
const INK = '#2a2724', SOFT = '#5a544c', OLIVE = '#8a9a2b', DESK = '#e8e6e1', DESK_INK = '#6d6a63';
const WD = '日一二三四五六';
const HAND = '"Long Cang","Ma Shan Zheng","Kaiti SC",KaiTi,cursive', TITLE = '"Ma Shan Zheng","Long Cang","Kaiti SC",KaiTi,cursive';
const PRINT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif';

// lines of `text` no wider than `max` (a character at a time: Chinese has no spaces to break at)
function lines(g, text, max, most) {
  const out = []; let cur = '';
  for (const ch of text) {
    if (g.measureText(cur + ch).width > max && cur) { out.push(cur); cur = ''; if (out.length === most) break; }
    cur += ch;
  }
  if (out.length < most && cur) out.push(cur);
  else if (out.length === most && cur) out[most - 1] = out[most - 1].replace(/.$/, '…');
  return out;
}

/** page: the page's first page (a live node, laid out); en: the entry; site: the settings. → JPEG Blob */
async function make(page, en, site) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // the desk, faintly woven
  g.fillStyle = DESK; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(120,110,90,.035)';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  // the page, a little askew, with its shadow
  const shot = await rasterize(page, 1.5, true);
  const ph = 560, pw = ph * 530 / 740;
  g.save(); g.translate(70 + pw / 2, H / 2); g.rotate(-2 * Math.PI / 180);
  g.shadowColor = 'rgba(40,30,10,.28)'; g.shadowBlur = 26; g.shadowOffsetY = 10;
  g.fillStyle = '#fbf8ee'; g.fillRect(-pw / 2, -ph / 2, pw, ph);
  g.shadowColor = 'transparent';
  g.drawImage(shot, -pw / 2, -ph / 2, pw, ph);
  g.restore();
  // the words beside it, in the journal's fonts
  const d = new Date(en.date + 'T00:00:00Z'), day = en.date.replace(/-/g, '.') + '  星期' + WD[d.getUTCDay()];
  const title = en.title || '（无题）', words = window.Techo.plainText(en.body || '');
  const meta = [en.place, en.weather].filter(Boolean).join(' · ');
  await Promise.all([`400 72px ${TITLE}`, `400 32px ${HAND}`, `500 22px ${PRINT}`].map((f) => document.fonts.load(f, title + words.slice(0, 80) + day + meta + (site.siteTitle || '')).catch(() => {})));
  const x = 120 + pw, max = W - x - 70;
  g.textBaseline = 'alphabetic';
  g.fillStyle = DESK_INK; g.font = `500 22px ${PRINT}`; g.fillText(site.siteTitle || '手帐', x, 108);
  g.fillStyle = OLIVE; g.font = `500 24px ${PRINT}`; g.fillText(day, x, 158);
  g.fillStyle = INK; g.font = `400 72px ${TITLE}`;
  const tl = lines(g, title, max, 2); tl.forEach((t, i) => g.fillText(t, x, 250 + i * 82));
  let y = 250 + (tl.length - 1) * 82 + 70;
  g.fillStyle = SOFT; g.font = `400 32px ${HAND}`;
  lines(g, words, max, Math.max(1, Math.min(4, Math.floor((H - 90 - y) / 46) + 1))).forEach((t, i) => g.fillText(t, x, y + i * 46));
  if (meta) { g.fillStyle = OLIVE; g.font = `400 20px ${PRINT}`; g.fillText('● ' + meta, x, H - 62); }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('分享图没画出来'))), 'image/jpeg', 0.88));
}

window.TechoCard = { make };
