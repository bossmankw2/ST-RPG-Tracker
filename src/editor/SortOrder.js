// Return a new order while retaining the original item objects and their IDs.
export function moveItemToIndex(items, fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
    || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length
    || fromIndex === toIndex) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

// Reordering a visible group must not move fields from other status groups.
export function replaceGroupOrder(items, orderedGroup, getId = item => item.id) {
  const groupIds = new Set(orderedGroup.map(getId));
  const existingIds = items.filter(item => groupIds.has(getId(item))).map(getId);
  if (existingIds.length !== orderedGroup.length || groupIds.size !== orderedGroup.length
    || new Set(existingIds).size !== orderedGroup.length) return items;
  let index = 0;
  return items.map(item => groupIds.has(getId(item)) ? orderedGroup[index++] : item);
}
