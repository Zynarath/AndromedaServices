'use strict';
// The two helpers the website needs from Andromeda Hosting (src/util/misc.js).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { sleep, HttpError };
