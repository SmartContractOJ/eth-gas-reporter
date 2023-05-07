const mocha = require("mocha");
const Base = mocha.reporters.Base;
const utils = require("./lib/utils");
const Config = require("./lib/config");
const TransactionWatcher = require("./lib/transactionWatcher");
const GasTable = require("./lib/gasTable");
const SyncRequest = require("./lib/syncRequest");
const mochaStats = require("./lib/mochaStats");
const constants = require("mocha/lib/runner").constants;
const EVENT_RUN_BEGIN = constants.EVENT_RUN_BEGIN;
const EVENT_RUN_END = constants.EVENT_RUN_END;
const EVENT_HOOK_END = constants.EVENT_HOOK_END;
const EVENT_TEST_BEGIN = constants.EVENT_TEST_BEGIN;
const EVENT_TEST_END = constants.EVENT_TEST_END;
const EVENT_TEST_PENDING = constants.EVENT_TEST_PENDING;
const EVENT_TEST_PASS = constants.EVENT_TEST_PASS;
const EVENT_TEST_FAIL = constants.EVENT_TEST_FAIL;

/**
 * Based on the Mocha 'JSON' reporter. Watches an Ethereum test suite run
 * and collects data about method & deployments gas usage. Mocha executes the hooks
 * in this reporter synchronously so any client calls here should be executed
 * via low-level RPC interface using sync-request. (see /lib/syncRequest)
 * An exception is made for fetching gas & currency price data from coinmarketcap and
 * ethgasstation (we hope that single call will complete by the time the tests finish running)
 *
 * @param {Object} runner  mocha's runner
 * @param {Object} options reporter.options (see README example usage)
 */
function Gas(runner, options) {
  // JSON reporter
  Base.call(this, runner, options);

  // Initialize stats for Mocha 6+ epilogue
  if (!runner.stats) {
    mochaStats(runner);
    this.stats = runner.stats;
  }

  const self = this;
  const tests = [];
  const pending = [];
  const failures = [];
  const passes = [];

  // Gas reporter setup
  const config = new Config(options.reporterOptions);
  const sync = new SyncRequest(config.url);
  const watch = new TransactionWatcher(config);
  const table = new GasTable(config);

  // Expose internal methods to plugins
  if (typeof options.attachments === "object") {
    options.attachments.recordTransaction = watch.transaction.bind(watch);
  }

  // These call the cloud, start running them.
  utils.setGasAndPriceRates(config);

  // ------------------------------------  Runners -------------------------------------------------

  runner.on(EVENT_RUN_BEGIN, () => {
    watch.data.initialize(config);
  });

  runner.on(EVENT_TEST_END, function(test) {
    tests.push(test);
  });

  runner.on(EVENT_TEST_PENDING, test => {
    pending.push(test);
  });

  runner.on(EVENT_TEST_BEGIN, () => {
    if (!config.provider) {
      watch.beforeStartBlock = sync.blockNumber();
    }
    watch.data.resetAddressCache();
  });

  runner.on(EVENT_HOOK_END, hook => {
    if (hook.title.includes("before each") && !config.provider) {
      watch.itStartBlock = sync.blockNumber() + 1;
    }
  });

  runner.on(EVENT_TEST_PASS, test => {
    passes.push(test);
  });

  runner.on(EVENT_TEST_FAIL, test => {
    failures.push(test);
  });

  runner.on(EVENT_RUN_END, () => {
    const report = table.saveCodeChecksData(watch.data);

    const obj = {
      stats: self.stats,
      tests: tests.map(clean),
      pending: pending.map(clean),
      failures: failures.map(clean),
      passes: passes.map(clean),
      gasReport: report
    };

    runner.testResults = obj;
    const json = JSON.stringify(obj, null, 2);
    process.stdout.write(json);

    self.epilogue();
  });
}

/**
 * Return a plain-object representation of `test`
 * free of cyclic properties etc.
 *
 * @private
 * @param {Object} test
 * @return {Object}
 */
function clean(test) {
  var err = test.err || {};
  if (err instanceof Error) {
    err = errorJSON(err);
  }

  return {
    title: test.title,
    fullTitle: test.fullTitle(),
    file: test.file,
    duration: test.duration,
    currentRetry: test.currentRetry(),
    speed: test.speed,
    err: cleanCycles(err)
  };
}

/**
 * Replaces any circular references inside `obj` with '[object Object]'
 *
 * @private
 * @param {Object} obj
 * @return {Object}
 */
function cleanCycles(obj) {
  var cache = [];
  return JSON.parse(
    JSON.stringify(obj, function(key, value) {
      if (typeof value === "object" && value !== null) {
        if (cache.indexOf(value) !== -1) {
          // Instead of going in a circle, we'll print [object Object]
          return "" + value;
        }
        cache.push(value);
      }

      return value;
    })
  );
}

/**
 * Transform an Error object into a JSON object.
 *
 * @private
 * @param {Error} err
 * @return {Object}
 */
function errorJSON(err) {
  var res = {};
  Object.getOwnPropertyNames(err).forEach(function(key) {
    res[key] = err[key];
  }, err);
  return res;
}

module.exports = Gas;
