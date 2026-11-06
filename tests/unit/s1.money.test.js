import test from 'node:test';
import assert from 'node:assert/strict';
import { toMoney } from '../../paypal.js';

test('toMoney 240000 THB', () => {
  assert.deepEqual(toMoney(240000, 'THB'), { currency_code: 'THB', value: '2400.00' });
});
test('toMoney 1 satang', () => assert.equal(toMoney(1, 'THB').value, '0.01'));
test('toMoney 0 and 1050', () => {
  assert.equal(toMoney(0, 'THB').value, '0.00');
  assert.equal(toMoney(1050, 'USD').value, '10.50');
});
test('toMoney rejects non-integers and negatives', () => {
  assert.throws(() => toMoney(2.5));
  assert.throws(() => toMoney(-1));
  assert.throws(() => toMoney('100'));
  assert.throws(() => toMoney(NaN));
});
