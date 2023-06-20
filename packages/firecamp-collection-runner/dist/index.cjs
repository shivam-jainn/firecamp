"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }

var _chunk3OSFNS7Zcjs = require('./chunk-3OSFNS7Z.cjs');
var _eventemitter3 = require('eventemitter3'); var _eventemitter32 = _interopRequireDefault(_eventemitter3);
var _types = require('./types');
const delay = async (ts) => {
  return new Promise((rs) => {
    setTimeout(() => {
      rs();
    }, ts);
  });
};
class Runner {
  constructor(collection, options) {
    _chunk3OSFNS7Zcjs.__publicField.call(void 0, this, "collection");
    _chunk3OSFNS7Zcjs.__publicField.call(void 0, this, "options");
    _chunk3OSFNS7Zcjs.__publicField.call(void 0, this, "folderRunSequence");
    _chunk3OSFNS7Zcjs.__publicField.call(void 0, this, "testResults", []);
    _chunk3OSFNS7Zcjs.__publicField.call(void 0, this, "emitter");
    _chunk3OSFNS7Zcjs.__publicField.call(void 0, this, "runStatistics", {
      stats: {
        iteration: { failed: 0, total: 0 },
        requests: { failed: 0, total: 0 },
        tests: { failed: 0, total: 0 }
      },
      timings: {
        runDuration: 0,
        responseAverage: 0,
        responseMax: 0,
        responseMin: 0
      },
      transfers: {
        responseTotal: 0
      }
    });
    this.collection = collection;
    this.options = options;
    this.folderRunSequence = /* @__PURE__ */ new Set();
    this.emitter = new (0, _eventemitter32.default)();
    this.validate();
    this.assignDefaultOptions();
    this.prepareFolderRunSequence();
  }
  assignDefaultOptions() {
    if (!this.options.hasOwnProperty("iterationCount"))
      this.options.iterationCount = 1;
    if (!this.options.hasOwnProperty("delayRequest"))
      this.options.delayRequest = 0;
    if (!this.options.hasOwnProperty("timeout"))
      this.options.timeout = 0;
    if (!this.options.hasOwnProperty("timeoutRequest"))
      this.options.timeoutRequest = 0;
    if (typeof this.options.iterationCount != "number")
      throw new Error("--iteration-count is invalid", { cause: "invalidOption" });
    if (typeof this.options.delayRequest != "number")
      throw new Error("--delay-request is invalid", { cause: "invalidOption" });
    if (typeof this.options.timeout != "number")
      throw new Error("--timeout is invalid", { cause: "invalidOption" });
    if (typeof this.options.timeoutRequest != "number")
      throw new Error("--timeout-request is invalid", { cause: "invalidOption" });
  }
  /**
   * validate that the collection format is valid
   * TODO: late we need to add the zod or json schema here for strong validation
   * 
   * @param collection "collection json payload"
   * @returns boolean
   */
  validate() {
    const { collection: _c, folders: _fs, requests: _rs, requestItems: _ris, __meta } = this.collection;
    if (!_optionalChain([__meta, 'optionalAccess', _ => _.version]))
      throw new Error("The collection format is invalid");
    if (_fs && !Array.isArray(_fs))
      throw new Error("The collection's folders format is invalid");
    if (_rs && !Array.isArray(_rs))
      throw new Error("The collection's requests format is invalid");
    if (_ris && !Array.isArray(_ris))
      throw new Error("The collection's request items format is invalid");
    return true;
  }
  prepareFolderRunSequence() {
    const { collection, folders } = this.collection;
    const folderMap = new Map(folders.map((folder) => [folder.__ref.id, folder]));
    const traverseFolders = (order) => order.flatMap(
      (folderId) => folderMap.has(folderId) ? [folderId, ...traverseFolders([folderMap.get(folderId).__ref.folderId])] : []
    );
    const ids = traverseFolders(collection.__meta.fOrders);
    ids.forEach(this.folderRunSequence.add, this.folderRunSequence);
  }
  updateResponseStatistics(response) {
    const {
      testResult: { total, passed, failed } = { total: 0, passed: 0, failed: 0 },
      code,
      status,
      responseSize,
      responseTime
    } = response;
    if (Number.isInteger(total))
      this.runStatistics.stats.tests.total += total;
    if (Number.isInteger(failed))
      this.runStatistics.stats.tests.failed += failed;
    if (Number.isInteger(responseSize))
      this.runStatistics.transfers.responseTotal += responseSize;
  }
  async runRequest(requestId) {
    const { folders, requests } = this.collection;
    const request = requests.find((r) => r.__ref.id == requestId);
    this.emitter.emit(_types.ERunnerEvents.BeforeRequest, {
      name: request.__meta.name,
      url: request.url.raw,
      method: request.method.toUpperCase(),
      path: fetchRequestPath(folders, request),
      id: request.__ref.id
    });
    await delay(this.options.delayRequest);
    const response = await this.options.executeRequest(request);
    this.updateResponseStatistics(response);
    this.emitter.emit(_types.ERunnerEvents.Request, {
      id: request.__ref.id,
      response
    });
    this.runStatistics.stats.requests.total += 1;
    return { request, response };
  }
  async runFolder(folderId) {
    const folder = this.collection.folders.find((f) => f.__ref.id == folderId);
    const requestIds = folder.__meta.rOrders || [];
    if (!requestIds.length)
      return;
    this.emitter.emit(_types.ERunnerEvents.BeforeFolder, {
      name: folder.name,
      id: folder.__ref.id
    });
    try {
      for (let i = 0; i < requestIds.length; i++) {
        const res = await this.runRequest(requestIds[i]);
        this.testResults.push(res);
      }
    } catch (e) {
      console.error(`Error while running the collection:`, e);
    }
    this.emitter.emit(_types.ERunnerEvents.Folder, {
      id: folder.__ref.id
    });
  }
  async runRootRequests() {
    const { collection } = this.collection;
    const requestIds = collection.__meta.rOrders || [];
    if (!requestIds.length)
      return;
    this.emitter.emit(_types.ERunnerEvents.BeforeFolder, {
      name: "./",
      id: collection.__ref.id
    });
    try {
      for (let i = 0; i < requestIds.length; i++) {
        const res = await this.runRequest(requestIds[i]);
        this.testResults.push(res);
      }
    } catch (e) {
      console.error(`Error while running the collection:`, e);
    }
    this.emitter.emit(_types.ERunnerEvents.Folder, {
      id: collection.__ref.id
    });
  }
  async runIteration() {
    try {
      const folderSet = this.folderRunSequence.values();
      const next = async () => {
        const { value: folderId, done } = folderSet.next();
        if (!done) {
          await this.runFolder(folderId);
          await next();
        }
      };
      await next();
      await this.runRootRequests();
    } catch (e) {
      console.error(`Error while running the collection:`, e);
    }
  }
  run() {
    setTimeout(async () => {
      const { collection } = this.collection;
      const startTs = (/* @__PURE__ */ new Date()).valueOf();
      this.emitter.emit(_types.ERunnerEvents.Start, {
        name: collection.name,
        id: collection.__ref.id
      });
      for (let i = 0; i < this.options.iterationCount; i++) {
        this.emitter.emit(_types.ERunnerEvents.BeforeIteration, {
          current: i + 1,
          total: this.options.iterationCount
        });
        await this.runIteration();
        this.emitter.emit(_types.ERunnerEvents.Iteration, {
          current: i + 1,
          total: this.options.iterationCount
        });
        this.runStatistics.stats.iteration.total += 1;
      }
      this.runStatistics.timings.runDuration = (/* @__PURE__ */ new Date()).valueOf() - startTs;
      this.emitter.emit(_types.ERunnerEvents.Done, this.runStatistics);
    });
    return this.exposeOnlyOn();
  }
  exposeOnlyOn() {
    return {
      on: (evt, fn) => {
        this.emitter.on(evt, fn);
        return this.exposeOnlyOn();
      }
    };
  }
}
const fetchRequestPath = (folders, request) => {
  const requestPath = [];
  const requestFolderId = request.__ref.folderId;
  let currentFolder = folders.find((folder) => folder.__ref.id === requestFolderId);
  while (currentFolder) {
    requestPath.unshift(currentFolder.name);
    const parentFolderId = currentFolder.__ref.folderId;
    currentFolder = folders.find((folder) => folder.__ref.id === parentFolderId);
  }
  return `./${requestPath.join("/")}`;
};


exports.default = Runner;
