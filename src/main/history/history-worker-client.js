'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

/**
 * Phia main dieu phoi history-worker: tao worker khi can, gan phan hoi ve dung
 * yeu cau, va tu dung lai neu worker chet.
 */

/**
 * Duong dan toi file worker.
 *
 * Khi app duoc dong goi, ma nguon nam trong kho luu tru app.asar. Electron va
 * lop fs cua no hieu duong dan trong asar, nhung worker_threads thi khong -
 * `new Worker(...)` se bao khong tim thay file. Vi vay history-worker.js va
 * transcript-parser.js duoc khai bao trong `asarUnpack` (xem package.json) va
 * o day phai tro thang vao thu muc da giai nen.
 */
const WORKER_PATH = path
  .join(__dirname, 'history-worker.js')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

let worker = null;
/** requestId -> handlers */
const listeners = new Map();
let requestCounter = 0;

function ensureWorker() {
  if (worker) return worker;

  worker = new Worker(WORKER_PATH);

  worker.on('message', (msg) => {
    const handlers = listeners.get(msg.requestId);
    if (!handlers) return;

    if (msg.type === 'hits') {
      handlers.onHits?.(handlers.decorateHits ? handlers.decorateHits(msg.hits) : msg.hits);
    } else if (msg.type === 'progress') {
      handlers.onProgress?.(msg);
    } else if (msg.type === 'error') {
      handlers.onError?.(msg.message);
      listeners.delete(msg.requestId);
    } else if (msg.type === 'done') {
      handlers.onDone?.(msg);
      listeners.delete(msg.requestId);
    }
  });

  worker.on('error', (err) => {
    for (const handlers of listeners.values()) handlers.onError?.(String(err));
    listeners.clear();
    worker = null;
  });

  worker.on('exit', () => {
    worker = null;
  });

  return worker;
}

function nextRequestId(prefix) {
  requestCounter += 1;
  return `${prefix}-${requestCounter}`;
}

/** Gui mot cong viec xuong worker; tra ve requestId de co the huy. */
function post(prefix, payload, handlers) {
  const requestId = nextRequestId(prefix);
  listeners.set(requestId, handlers);
  ensureWorker().postMessage({ ...payload, requestId });
  return requestId;
}

function cancel(requestId) {
  if (!listeners.has(requestId)) return;
  listeners.delete(requestId);
  worker?.postMessage({ type: 'cancel', requestId });
}

async function shutdown() {
  listeners.clear();
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

module.exports = { post, cancel, shutdown };
