/* Run with:  node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const SK = require('../core/util.js');
const split = (t, o) => SK.util.splitEventTitle(t, Object.assign({ now: Date.parse('2026-10-11T12:00:00Z') }, o));

test('eBileta: month first, time in the same part, venue in capitals', () => {
  assert.deepEqual(split('Shqiperi - Finlande - November 12, 2026, 8:45 PM - Air Albania Stadium'),
    { name: 'Shqiperi - Finlande', date: '2026-11-12', time: '20:45', venue: 'Air Albania Stadium' });
  assert.deepEqual(split('Kosova - Republika e Irlandes - September 24, 2026, 8:45 PM - FADIL VOKRRI STADIUM'),
    { name: 'Kosova - Republika e Irlandes', date: '2026-09-24', time: '20:45', venue: 'Fadil Vokrri Stadium' });
});

test('Posttick: date and time in parts of their own', () => {
  assert.deepEqual(split('Max Amini - 27.11.2026 - 9:30 PM - Pallati i Kongreseve, Tirana'),
    { name: 'Max Amini', date: '2026-11-27', time: '21:30', venue: 'Pallati i Kongreseve, Tirana' });
});

test('eFinity: venue and date share a part; a title without a date stays whole', () => {
  assert.deepEqual(split('SENIDAH - SC Cair, 22.10.2026'), { name: 'SENIDAH', date: '2026-10-22', time: '', venue: 'SC Cair' });
  assert.deepEqual(split('Senidah Cair'), { name: 'Senidah Cair', date: '', time: '', venue: '' });
});

test('Albanian day and month names, and "ora"', () => {
  assert.deepEqual(split('Dua Lipa - E shtunë, 12 Nëntor 2026 ora 20:00 - Sheshi Skënderbej'),
    { name: 'Dua Lipa', date: '2026-11-12', time: '20:00', venue: 'Sheshi Skënderbej' });
});

test('a year in the name is not a date', () => {
  assert.deepEqual(split('Bruno Mars 2026 Tour'), { name: 'Bruno Mars 2026 Tour', date: '', time: '', venue: '' });
});

test('the date and venue the site gives on their own fill what the title lacks', () => {
  assert.deepEqual(split('Kosova - Republika e Irlandes', { date: 'September 24, 2026, 8:45 PM', venue: 'FADIL VOKRRI STADIUM' }),
    { name: 'Kosova - Republika e Irlandes', date: '2026-09-24', time: '20:45', venue: 'Fadil Vokrri Stadium' });
});

test('eventInfo prefers what was saved on the event', () => {
  const saved = { name: 'Saved', date: '2026-01-01', time: '', venue: '' };
  assert.equal(SK.util.eventInfo({ title: 'Other - 02.02.2026', extra: { info: saved } }), saved);
  assert.equal(SK.util.eventInfo({ title: 'Max Amini - 27.11.2026', extra: {} }).name, 'Max Amini');
});

test('the name keeps the site\'s own dashes', () => {
  assert.equal(split('Albania – Serbia - November 14, 2026, 8:45 PM - Air Albania Stadium').name, 'Albania – Serbia');
});
