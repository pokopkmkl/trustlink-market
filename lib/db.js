const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function filePath(name) {
  return path.join(DATA_DIR, name + '.json');
}

function ensureFile(name, defaultValue) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const fp = filePath(name);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, JSON.stringify(defaultValue, null, 2));
  }
}

function readAll(name) {
  ensureFile(name, []);
  const raw = fs.readFileSync(filePath(name), 'utf8');
  try {
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

function writeAll(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

function nextId(name) {
  const items = readAll(name);
  let max = 0;
  for (const it of items) if (it.id > max) max = it.id;
  return max + 1;
}

function insert(name, item) {
  const items = readAll(name);
  item.id = nextId(name);
  items.push(item);
  writeAll(name, items);
  return item;
}

function update(name, id, patch) {
  const items = readAll(name);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = Object.assign({}, items[idx], patch);
  writeAll(name, items);
  return items[idx];
}

function findById(name, id) {
  const items = readAll(name);
  return items.find((i) => i.id === id) || null;
}

function remove(name, id) {
  const items = readAll(name);
  const filtered = items.filter((i) => i.id !== id);
  writeAll(name, filtered);
  return filtered.length !== items.length;
}

module.exports = { readAll, writeAll, insert, update, findById, remove, ensureFile };
