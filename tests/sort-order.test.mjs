import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/editor/SortOrder.js', import.meta.url), 'utf8');
const { moveItemToIndex, replaceGroupOrder } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('moving a character across a long list retains its identity, values and locks', () => {
  const characters = Array.from({ length: 12 }, (_, i) => ({
    id: `char_${i}`, name: `Character ${i}`, profile: { Height: `${i} cm` }, profileLocks: { Height: true },
  }));
  const result = moveItemToIndex(characters, 11, 1);
  assert.deepEqual(result.map(char => char.id), ['char_0', 'char_11', ...characters.slice(1, 11).map(char => char.id)]);
  assert.equal(result[1], characters[11]);
  assert.deepEqual(result[1].profileLocks, { Height: true });
  assert.equal(characters[11].id, 'char_11', 'The input list remains unchanged');
});

test('status-group reorder leaves interleaved unrelated schema entries untouched', () => {
  const schema = [
    { id: 'HP', type: 'consumable', isLocked: true },
    { id: 'Level', type: 'integer', isLocked: false },
    { id: 'MP', type: 'consumable', isLocked: false },
    { id: 'Condition', type: 'text', isLocked: true },
    { id: 'Energy', type: 'stacking', isLocked: true },
  ];
  const result = replaceGroupOrder(schema, [schema[4], schema[0], schema[2]]);
  assert.deepEqual(result.map(field => field.id), ['Energy', 'Level', 'HP', 'Condition', 'MP']);
  assert.equal(result[1], schema[1]);
  assert.equal(result[3], schema[3]);
  assert.equal(result[2], schema[0]);
  assert.equal(result[2].isLocked, true);
});

test('stale or duplicate group identities cannot replace unrelated fields', () => {
  const schema = [{ id: 'HP' }, { id: 'MP' }, { id: 'Level' }];
  assert.equal(replaceGroupOrder(schema, [{ id: 'HP' }, { id: 'removed' }]), schema);
  assert.equal(replaceGroupOrder(schema, [schema[0], schema[0]]), schema);
  const invalidSource = [{ id: 'HP' }, { id: 'HP' }];
  assert.equal(replaceGroupOrder(invalidSource, [{ id: 'HP' }, { id: 'MP' }]), invalidSource);
});

test('cancelled, empty and out-of-bounds moves preserve the original list', () => {
  const names = ['Race', 'Height', 'Appearance'];
  assert.equal(moveItemToIndex(names, 0, 0), names);
  assert.equal(moveItemToIndex(names, -1, 2), names);
  assert.equal(moveItemToIndex(names, 0, 3), names);
  assert.deepEqual(moveItemToIndex([], 0, 0), []);
  assert.deepEqual(moveItemToIndex(names, 0, 2), ['Height', 'Appearance', 'Race']);
});
