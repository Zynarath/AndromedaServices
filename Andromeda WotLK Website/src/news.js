'use strict';
// News lives where SPP's site kept it: topics in the news forum (f_topics, forum_id 1) with the text
// in the topic's first post (f_posts), in the login database. Existing SPP news keeps showing.
const data = require('./data');
const { textToHtml } = require('./html');

const NEWS_FORUM = 1;

async function ensureTables() {
  await data.q('login', `CREATE TABLE IF NOT EXISTS f_topics (
    topic_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    topic_poster VARCHAR(255) NOT NULL DEFAULT '',
    topic_poster_id INT UNSIGNED NOT NULL DEFAULT 0,
    topic_name VARCHAR(255) NOT NULL DEFAULT '',
    topic_posted INT UNSIGNED NOT NULL DEFAULT 0,
    last_post INT UNSIGNED NOT NULL DEFAULT 0,
    last_post_id INT UNSIGNED NOT NULL DEFAULT 0,
    last_poster VARCHAR(255) NOT NULL DEFAULT '',
    num_views INT UNSIGNED NOT NULL DEFAULT 0,
    num_replies INT UNSIGNED NOT NULL DEFAULT 0,
    closed TINYINT UNSIGNED NOT NULL DEFAULT 0,
    sticky TINYINT UNSIGNED NOT NULL DEFAULT 0,
    redirect_url VARCHAR(255) NULL,
    forum_id INT UNSIGNED NOT NULL DEFAULT 0,
    KEY forum_id (forum_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`);
  await data.q('login', `CREATE TABLE IF NOT EXISTS f_posts (
    post_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    poster VARCHAR(255) NOT NULL DEFAULT '',
    poster_id INT UNSIGNED NOT NULL DEFAULT 0,
    poster_character_id INT UNSIGNED NOT NULL DEFAULT 0,
    poster_ip VARCHAR(40) NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    posted INT UNSIGNED NOT NULL DEFAULT 0,
    edited INT UNSIGNED NULL,
    edited_by VARCHAR(255) NULL,
    topic_id INT UNSIGNED NOT NULL DEFAULT 0,
    KEY topic_id (topic_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8`);
}

const missingTable = (err) => err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);

async function list(offset = 0, limit = 10) {
  try {
    const rows = await data.q('login', `SELECT t.topic_id, t.topic_name, t.topic_poster, t.topic_posted,
      (SELECT p.message FROM f_posts p WHERE p.topic_id = t.topic_id ORDER BY p.posted, p.post_id LIMIT 1) AS message
      FROM f_topics t WHERE t.forum_id = ? ORDER BY t.topic_posted DESC, t.topic_id DESC LIMIT ?, ?`, [NEWS_FORUM, offset, limit]);
    const total = Number((await data.q('login', 'SELECT COUNT(*) AS n FROM f_topics WHERE forum_id = ?', [NEWS_FORUM]))[0].n);
    return { rows, total };
  } catch (err) {
    if (missingTable(err)) return { rows: [], total: 0 };
    throw err;
  }
}

async function add(account, ip, title, text) {
  await ensureTables();
  const now = Math.floor(Date.now() / 1000);
  const t = await data.q('login', 'INSERT INTO f_topics SET ?', [{ topic_poster: account.username, topic_poster_id: account.id, topic_name: title, topic_posted: now, forum_id: NEWS_FORUM }]);
  const p = await data.q('login', 'INSERT INTO f_posts SET ?', [{ poster: account.username, poster_id: account.id, poster_character_id: 0, poster_ip: ip, message: textToHtml(text), posted: now, topic_id: t.insertId }]);
  await data.q('login', 'UPDATE f_topics SET last_post = ?, last_post_id = ?, last_poster = ? WHERE topic_id = ?', [now, p.insertId, account.username, t.insertId]).catch(() => {});
  return t.insertId;
}

async function remove(id) {
  const res = await data.q('login', 'DELETE FROM f_topics WHERE topic_id = ? AND forum_id = ?', [id, NEWS_FORUM]);
  if (res.affectedRows) await data.q('login', 'DELETE FROM f_posts WHERE topic_id = ?', [id]);
}

module.exports = { list, add, remove, ensureTables, missingTable };
