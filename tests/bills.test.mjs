/* the bills page (public/assets/bills.js): what a 账单 came to and what it went on */
import test from 'node:test';
import assert from 'node:assert/strict';
import { slice } from './helpers.mjs';

const kv = slice('public/assets/render.js', 'const kvOf=', 'function ticketFields');
const src = slice('public/assets/keep.js', 'const AMOUNT=', '  const dayOf=');
const bill = new Function(`${kv}\nconst T={kvOf};\n${src}\nreturn bill;`)();

test('groups (* name: ¥) are what it went on; the = line is what it came to', () => {
  const b = bill(['# 超市', '* 蔬菜: ¥30', '* 零食: ¥20', '= 合计: ¥50']);
  assert.equal(b.total, 50);
  assert.deepEqual(b.cats, [['蔬菜', 30], ['零食', 20]]);
});

test('without groups, the lines with an amount; without a = line, their sum', () => {
  const b = bill(['# 午饭', '- 拉面: ¥28', '- 可乐: ¥5.5', '> 谢谢惠顾']);
  assert.equal(b.total, 33.5);
  assert.deepEqual(b.cats, [['拉面', 28], ['可乐', 5.5]]);
});

test("what the groups don't add up to is 其他", () => {
  const b = bill(['* 交通: ¥40', '= 合计: ¥100']);
  assert.deepEqual(b.cats, [['交通', 40], ['其他', 60]]);
});

test('no lines at all: the title, and the total', () => {
  assert.deepEqual(bill(['# 电费', '= 合计: ¥120']).cats, [['电费', 120]]);
});

test('amounts: ¥, 元, thousands commas; a date is not an amount', () => {
  const b = bill(['- 房租: ¥1,280.50', '- 水费: 45 元', '- 日期: 2026年9月28日']);
  assert.deepEqual(b.cats, [['房租', 1280.5], ['水费', 45]]);
});
