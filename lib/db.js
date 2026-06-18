const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../botfmg.db');
const db = new Database(dbPath);

module.exports = db;
