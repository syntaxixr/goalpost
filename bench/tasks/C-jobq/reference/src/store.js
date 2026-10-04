'use strict';
const fs = require('fs/promises');

async function load(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { nextId: 1, jobs: [] };
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`corrupt queue file ${file}: ${e.message}`);
  }
}

async function save(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

module.exports = { load, save };
