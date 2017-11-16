/*!
 * crosstab JavaScript Library v0.2.12
 * https://github.com/tejacques/crosstab
 *
 * License: Apache 2.0 https://github.com/tejacques/crosstab/blob/master/LICENSE
 *
 *  Copyright 2015 Tom Jacques
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */
/* global define */
/* global global */
(function(window, define) {
  define('crosstab', function(require, exports, module) {
    'use strict';

    var localStorage;
    try {
      localStorage = window.localStorage;
      localStorage = window['ie8-eventlistener/storage'] || window.localStorage;
    } catch (e) {
      // New versions of Firefox throw a Security exception
      // if cookies are disabled. See
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1028153
    }

    // When Safari on OS X or iOS is in private browsing mode,
    // calling localStorage.setItem throws an exception.
    //
    // "QUOTA_EXCEEDED_ERR: DOM Exception 22: An attempt was made
    // to add something to storage that exceeded the quota."
    var setItemAllowed = true;
    try {
      localStorage.setItem('__crosstab', '');
      localStorage.removeItem('__crosstab');
    } catch (e) {
      setItemAllowed = false;
    }

    // Other reasons
    var frozenTabEnvironment = false;

    function notSupported() {
      if (crosstab.supported) return;
      var errorMsg = 'crosstab not supported';
      var reasons = [];
      if (!localStorage) {
        reasons.push('localStorage not availabe');
      }
      if (!window.addEventListener) {
        reasons.push('addEventListener not available');
      }
      if (frozenTabEnvironment) {
        reasons.push('frozen tab environment detected');
      }
      if (!setItemAllowed) {
        reasons.push('localStorage.setItem not allowed');
      }

      if (reasons.length > 0) {
        errorMsg += ': ' + reasons.join(', ');
      }

      throw new Error(errorMsg);
    }

    // --- Utility ---
    var util = {
      keys: {
        MESSAGE_KEY: 'crosstab.MESSAGE_KEY',
        TABS_KEY: 'crosstab.TABS_KEY',
        MASTER_TAB: 'MASTER_TAB',
        SUPPORTED_KEY: 'crosstab.SUPPORTED',
        FROZEN_TAB_ENVIRONMENT: 'crosstab.FROZEN_TAB_ENVIRONMENT'
      }
    };

    util.isArray =
      Array.isArray ||
      function(arr) {
        return arr instanceof Array;
      };

    util.isNumber = function(num) {
      return typeof num === 'number';
    };

    util.isFunction = function(fn) {
      return typeof fn === 'function';
    };

    util.forEachObj = function(obj, fn) {
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          fn.call(obj, obj[key], key, obj);
        }
      }
    };

    util.forEachArr = function(arr, fn) {
      var len = arr.length;
      for (var i = 0; i < len; i++) {
        fn.call(arr, arr[i], i, arr);
      }
    };

    util.forEach = function(thing, fn) {
      if (util.isArray(thing)) {
        util.forEachArr(thing, fn);
      } else {
        util.forEachObj(thing, fn);
      }
    };

    util.map = function(thing, fn) {
      var res = [];
      util.forEach(thing, function(item, key, obj) {
        res.push(fn(item, key, obj));
      });

      return res;
    };

    util.filter = function(thing, fn) {
      var isArr = util.isArray(thing);
      var res = isArr ? [] : {};

      if (isArr) {
        util.forEachArr(thing, function(value, key) {
          if (fn(value, key)) {
            res.push(value);
          }
        });
      } else {
        util.forEachObj(thing, function(value, key) {
          if (fn(value, key)) {
            res[key] = value;
          }
        });
      }

      return res;
    };

    util.reduce = function(thing, fn, accumulator) {
      var first = arguments.length < 3;

      util.forEach(thing, function(item, key, obj) {
        if (first) {
          accumulator = item;
          first = false;
        } else {
          accumulator = fn(accumulator, item, key, obj);
        }
      });

      return accumulator;
    };

    util.now = function() {
      return new Date().getTime();
    };

    util.tabs = getStoredTabs();

    util.eventTypes = {
      becomeMaster: 'becomeMaster',
      demoteFromMaster: 'demotedFromMaster',
      tabUpdated: 'tabUpdated',
      tabClosed: 'tabClosed',
      tabPromoted: 'tabPromoted'
    };

    util.storageEventKeys = util.reduce(
      util.keys,
      function(keys, val) {
        keys[val] = 1;
        return keys;
      },
      {}
    );

    // --- Events ---
    // node.js style events, with the main difference being able
    // to add/remove events by key.
    util.createEventHandler = function() {
      var events = {};
      var subscribeKeyToListener = {};

      var findHandlerByKey = function(event, key) {
        var handler;
        if (subscribeKeyToListener[event]) {
          handler = subscribeKeyToListener[event][key];
        }
        return handler;
      };

      var findHandlerIndex = function(event, listener) {
        var listenerIndex = -1;
        var eventList = events[event];
        if (eventList && listener) {
          var len = eventList.length || 0;
          for (var i = 0; i < len; i++) {
            if (eventList[i] === listener) {
              listenerIndex = i;
              break;
            }
          }
        }
        return listenerIndex;
      };

      var addListener = function(event, listener, key) {
        var handlers = listeners(event);

        var storedHandler = findHandlerByKey(event, key);
        var listenerIndex;

        if (storedHandler === undefined) {
          listenerIndex = handlers.length;
          handlers[listenerIndex] = listener;

          if (!subscribeKeyToListener[event]) {
            subscribeKeyToListener[event] = {};
          }

          if (key) {
            subscribeKeyToListener[event][key] = listener;
          }
        } else {
          listenerIndex = findHandlerIndex(event, storedHandler);
          handlers[listenerIndex] = listener;
        }

        return key || listener;
      };

      var removeListener = function(event, key) {
        var handler = util.isFunction(key) ? key : findHandlerByKey(event, key);

        var listenerIndex = findHandlerIndex(event, handler);
        if (listenerIndex === -1) return false;

        if (events[event] && events[event][listenerIndex]) {
          events[event].splice(listenerIndex, 1);
          delete subscribeKeyToListener[event][key];
          return true;
        }
        return false;
      };

      var removeAllListeners = function(event) {
        var successful = false;
        if (event) {
          if (events[event]) {
            delete events[event];
            successful = true;
          }
          if (subscribeKeyToListener[event]) {
            delete subscribeKeyToListener[event];
            successful = successful && true;
          }
        } else {
          events = {};
          subscribeKeyToListener = {};
          successful = true;
        }
        return successful;
      };

      var emit = function(event) {
        var args = Array.prototype.slice.call(arguments, 1);
        var handlers = listeners(event);

        util.forEach(handlers, function(listener) {
          if (util.isFunction(listener)) {
            listener.apply(this, args);
          }
        });
      };

      var once = function(event, listener, key) {
        // Generate a unique id for this listener
        while (!key || findHandlerByKey(event, key) !== undefined) {
          key = util.generateId();
        }

        addListener(
          event,
          function() {
            removeListener(event, key);
            var args = Array.prototype.slice.call(arguments);
            listener.apply(this, args);
          },
          key
        );

        return key;
      };

      var listeners = function(event) {
        var handlers = (events[event] = events[event] || []);
        return handlers;
      };

      var destructor = function() {
        clearInterval(crosstab.keepAliveInterval);
        removeAllListeners();
      };

      return {
        addListener: addListener,
        destructor: destructor,
        on: addListener,
        off: function(event, key) {
          var argsLen = arguments.length;
          if (!argsLen) {
            return removeAllListeners();
          } else if (argsLen === 1) {
            return removeAllListeners(event);
          } else {
            return removeListener(event, key);
          }
        },
        once: once,
        emit: emit,
        listeners: listeners,
        removeListener: removeListener,
        removeAllListeners: removeAllListeners
      };
    };

    // --- Setup Events ---
    var eventHandler = util.createEventHandler();

    // wrap eventHandler so that setting it will not blow up
    // any of the internal workings
    util.events = {
      addListener: eventHandler.addListener,
      on: eventHandler.on,
      off: eventHandler.off,
      once: eventHandler.once,
      emit: eventHandler.emit,
      listeners: eventHandler.listeners,
      removeListener: eventHandler.removeListener,
      removeAllListeners: eventHandler.removeAllListeners,
      destructor: eventHandler.destructor
    };

    var lastNewValue;
    var lastOldValue;
    function onStorageEvent(event) {
      // Only handle crosstab events
      if (!event || !(event.key in util.storageEventKeys)) {
        return;
      }

      var eventValue;
      try {
        eventValue = event.newValue ? JSON.parse(event.newValue) : {};
      } catch (e) {
        eventValue = {};
      }
      if (!eventValue || !eventValue.id || eventValue.id === crosstab.id) {
        // This is to force IE to behave properly
        return;
      }
      if (event.newValue === lastNewValue && event.oldValue === lastOldValue) {
        // Fix bug in IE11 where StorageEvents in iframes are sent twice.
        return;
      }
      lastNewValue = event.newValue;
      lastOldValue = event.oldValue;
      if (event.key === util.keys.MESSAGE_KEY) {
        var message = eventValue.data;
        // only handle if this message was meant for this tab.
        if (!message.destination || message.destination === crosstab.id) {
          eventHandler.emit(message.event, message);
        }
      } else if (event.key === util.keys.FROZEN_TAB_ENVIRONMENT) {
        frozenTabEnvironment = eventValue.data;
        crosstab.supported = crosstab.supported && !eventValue.data;
      } else if (event.key === util.keys.SUPPORTED_KEY) {
        crosstab.supported = crosstab.supported && eventValue.data;
      }
    }

    function setLocalStorageItem(key, data) {
      var storageItem = {
        id: crosstab.id,
        data: data,
        timestamp: util.now()
      };

      localStorage.setItem(key, JSON.stringify(storageItem));
    }

    function getLocalStorageItem(key) {
      var item = getLocalStorageRaw(key);
      return item.data;
    }

    function getLocalStorageRaw(key) {
      var json = localStorage ? localStorage.getItem(key) : null;
      var item = json ? JSON.parse(json) : {};
      return item;
    }

    function unload() {
      crosstab.stopKeepalive = true;
      var numTabs = 0;
      util.forEach(util.tabs, function(tab, key) {
        if (key !== util.keys.MASTER_TAB) {
          numTabs++;
        }
      });

      if (numTabs === 1) {
        util.tabs = {};
        setStoredTabs();
      } else {
        broadcast(util.eventTypes.tabClosed, crosstab.id);
      }
    }

    function restoreLoop() {
      crosstab.stopKeepalive = false;
      keepaliveLoop();
    }

    function swapUnloadEvents() {
      // `beforeunload` replaced by `unload` (IE11 will be smart now)
      window.removeEventListener('beforeunload', unload, false);
      window.addEventListener('unload', unload, false);
      restoreLoop();
    }

    function getMaster() {
      return util.tabs[util.keys.MASTER_TAB];
    }

    function setMaster(newMaster) {
      util.tabs[util.keys.MASTER_TAB] = newMaster;
    }

    function deleteMaster() {
      delete util.tabs[util.keys.MASTER_TAB];
    }

    function getMasterId() {
      var master = getMaster();

      return master ? master.id : 0;
    }

    function isMaster() {
      return getMasterId() === crosstab.id;
    }

    function masterTabElection() {
      var maxId = null;
      util.forEach(util.tabs, function(tab) {
        if (!maxId || tab.id < maxId) {
          maxId = tab.id;
        }
      });

      // only broadcast the promotion if I am the new master
      if (maxId === crosstab.id) {
        broadcast(util.eventTypes.tabPromoted, crosstab.id);
      } else {
        // this is done so that in the case where multiple tabs are being
        // started at the same time, and there is no current saved tab
        // information, we will still have a value set for the master tab
        setMaster({
          id: maxId,
          lastUpdated: util.now()
        });
      }
    }

    // Handle other tabs closing by updating internal tab model, and promoting
    // self if we are the lowest tab id
    eventHandler.addListener(util.eventTypes.tabClosed, function(message) {
      var id = message.data;
      if (id in util.tabs) {
        delete util.tabs[id];
      }

      var master = getMaster();
      if (!master || master.id === id) {
        // If the master was the closed tab, delete it and the highest
        // tab ID becomes the new master, which will save the tabs
        if (master) {
          deleteMaster();
        }
        masterTabElection();
      } else if (master.id === crosstab.id) {
        // If I am master, save the new tabs out
        setStoredTabs();
      }
    });

    eventHandler.addListener(util.eventTypes.tabUpdated, function(message) {
      var tab = message.data;
      util.tabs[tab.id] = tab;

      // If there is no master, hold an election
      if (!getMaster()) {
        masterTabElection();
      }

      if (getMasterId() === tab.id) {
        setMaster(tab);
      }
      if (isMaster()) {
        // If I am master, save the new tabs out
        setStoredTabs();
      }
    });

    var bullying;
    eventHandler.addListener(util.eventTypes.tabPromoted, function(message) {
      var id = message.data;
      var lastUpdated = message.timestamp;
      var previousMaster = getMasterId();

      // Bully out competing broadcasts if our id is lower
      if (crosstab.id < id) {
        if (!bullying) {
          bullying = setTimeout(function() {
            bullying = 0;
            broadcast(util.eventTypes.tabPromoted, crosstab.id);
          }, 0);
        }
        return;
      }

      setMaster({
        id: id,
        lastUpdated: lastUpdated
      });

      if (isMaster()) {
        // set the tabs in localStorage
        setStoredTabs();
      }
      if (isMaster() && previousMaster !== crosstab.id) {
        // emit the become master event so we can handle it accordingly
        util.events.emit(util.eventTypes.becomeMaster);
      } else if (!isMaster() && previousMaster === crosstab.id) {
        // emit the demoted from master event so we can clean up resources
        util.events.emit(util.eventTypes.demoteFromMaster);
      }
    });

    function pad(num, width, padChar) {
      padChar = padChar || '0';
      var numStr = num.toString();

      if (numStr.length >= width) {
        return numStr;
      }

      return new Array(width - numStr.length + 1).join(padChar) + numStr;
    }

    util.generateId = function() {
      /*jshint bitwise: false*/
      return util.now().toString() + pad((Math.random() * 0x7fffffff) | 0, 10);
    };

    // --- Setup message sending and handling ---
    function broadcast(event, data, destination) {
      if (!crosstab.supported) {
        notSupported();
      }

      var message = {
        id: util.generateId(),
        event: event,
        data: data,
        destination: destination,
        origin: crosstab.id,
        timestamp: util.now()
      };

      // If the destination differs from the origin send it out, otherwise
      // handle it locally
      if (message.destination !== message.origin) {
        setLocalStorageItem(util.keys.MESSAGE_KEY, message);
      }

      if (!message.destination || message.destination === message.origin) {
        eventHandler.emit(event, message);
      }
    }

    function broadcastMaster(event, data) {
      broadcast(event, data, getMaster().id);
    }

    // ---- Return ----
    var setupComplete = false;
    util.events.once('setupComplete', function() {
      setupComplete = true;
    });

    var crosstab = function(fn) {
      if (setupComplete) {
        fn();
      } else {
        util.events.once('setupComplete', fn);
      }
    };

    crosstab.id = util.generateId();
    crosstab.supported = !!localStorage && window.addEventListener && setItemAllowed;
    crosstab.util = util;
    crosstab.broadcast = broadcast;
    crosstab.broadcastMaster = broadcastMaster;
    crosstab.on = util.events.on;
    crosstab.once = util.events.once;
    crosstab.off = util.events.off;

    // 10 minute timeout
    var CACHE_TIMEOUT = 10 * 60 * 1000;

    // --- Crosstab supported ---
    // Check to see if the global frozen tab environment key or supported key has been set.
    if (!setupComplete && crosstab.supported) {
      var frozenTabsRaw = getLocalStorageRaw(util.keys.FROZEN_TAB_ENVIRONMENT);

      if (frozenTabsRaw.timestamp) {
        var frozenTabs = frozenTabsRaw.data;
        if (util.now() - frozenTabsRaw.timestamp > CACHE_TIMEOUT) {
          localStorage.removeItem(util.keys.FROZEN_TAB_ENVIRONMENT);
        } else if (frozenTabs === true) {
          frozenTabEnvironmentDetected();
        }
      }

      var supportedRaw = getLocalStorageRaw(util.keys.SUPPORTED_KEY);

      if (supportedRaw.timestamp) {
        var supported = supportedRaw.data;

        if (util.now() - supportedRaw.timestamp > CACHE_TIMEOUT) {
          localStorage.removeItem(util.keys.SUPPORTED_KEY);
        } else if (supported === false || supported === true) {
          // As long as it is explicitely set, use the value
          crosstab.supported = supported;
          util.events.emit('setupComplete');
        }
      }
    }

    function frozenTabEnvironmentDetected() {
      crosstab.supported = false;
      frozenTabEnvironment = true;
      setLocalStorageItem(util.keys.FROZEN_TAB_ENVIRONMENT, true);
      setLocalStorageItem(util.keys.SUPPORTED_KEY, false);
    }

    // --- Tab Setup ---
    // 3 second keepalive
    var TAB_KEEPALIVE = 3 * 1000;
    // 5 second timeout
    var TAB_TIMEOUT = 5 * 1000;
    // 500 ms ping timeout
    var PING_TIMEOUT = 500;

    function getStoredTabs() {
      var storedTabs = getLocalStorageItem(util.keys.TABS_KEY);
      util.tabs = storedTabs || util.tabs || {};
      return util.tabs;
    }

    function setStoredTabs() {
      setLocalStorageItem(util.keys.TABS_KEY, util.tabs);
    }

    function keepalive() {
      var now = util.now();

      var myTab = {
        id: crosstab.id,
        lastUpdated: now
      };

      // broadcast tabUpdated event
      broadcast(util.eventTypes.tabUpdated, myTab);

      // broadcast tabClosed event for each tab that timed out
      function stillAlive(tab) {
        return now - tab.lastUpdated < TAB_TIMEOUT;
      }

      function notAlive(tab, key) {
        return key !== util.keys.MASTER_TAB && !stillAlive(tab);
      }

      var deadTabs = util.filter(util.tabs, notAlive);
      util.forEach(deadTabs, function(tab) {
        broadcast(util.eventTypes.tabClosed, tab.id);
      });

      // check to see if setup is complete
      if (!setupComplete) {
        var master = getMaster();
        // ping master
        if (master && master.id !== myTab.id) {
          var timeout;
          var start;

          crosstab.util.events.once('PONG', function() {
            if (!setupComplete) {
              clearTimeout(timeout);
              // set supported to true / frozen to false
              setLocalStorageItem(util.keys.SUPPORTED_KEY, true);
              setLocalStorageItem(util.keys.FROZEN_TAB_ENVIRONMENT, false);
              util.events.emit('setupComplete');
            }
          });

          start = util.now();

          // There is a nested timeout here. We'll give it 100ms
          // timeout, with iters "yields" to the event loop. So at least
          // iters number of blocks of javascript will be able to run
          // covering at least 100ms
          var recursiveTimeout = function(iters) {
            var diff = util.now() - start;

            if (!setupComplete) {
              if (iters <= 0 && diff > PING_TIMEOUT) {
                frozenTabEnvironmentDetected();
                util.events.emit('setupComplete');
              } else {
                timeout = setTimeout(function() {
                  recursiveTimeout(iters - 1);
                }, 5);
              }
            }
          };

          var iterations = 5;
          timeout = setTimeout(function() {
            recursiveTimeout(5);
          }, PING_TIMEOUT - 5 * iterations);
          crosstab.broadcastMaster('PING');
        } else if (master && master.id === myTab.id) {
          util.events.emit('setupComplete');
        }
      }
    }

    function keepaliveLoop() {
      if (crosstab.supported && !crosstab.stopKeepalive) {
        keepalive();
      }
    }

    // --- Check if crosstab is supported ---
    if (!crosstab.supported) {
      crosstab.broadcast = notSupported;
    } else {
      // ---- Setup Storage Listener
      window.addEventListener('storage', onStorageEvent, false);
      // start with the `beforeunload` event due to IE11
      window.addEventListener('beforeunload', unload, false);
      // swap `beforeunload` to `unload` after DOM is loaded
      window.addEventListener('DOMContentLoaded', swapUnloadEvents, false);

      util.events.on('PING', function(message) {
        // only handle direct messages
        if (!message.destination || message.destination !== crosstab.id) {
          return;
        }

        if (util.now() - message.timestamp < PING_TIMEOUT) {
          crosstab.broadcast('PONG', null, message.origin);
        }
      });

      crosstab.keepAliveInterval = setInterval(keepaliveLoop, TAB_KEEPALIVE);
      keepaliveLoop();
    }

    module.exports = crosstab;

    /*!
 * UMD/AMD/Global context Module Loader wrapper
 *
 * This wrapper will try to use a module loader with the
 * following priority:
 *
 *  1.) AMD
 *  2.) CommonJS
 *  3.) Context Variable (this)
 *    - window in the browser
 *    - module.exports in node and browserify
 */
  });
})(
  // First arg -- the global object in the browser or node
  typeof window == 'object' ? window : global,
  // Second arg -- the define object
  typeof define == 'function' && define.amd
    ? define
    : (function(context) {
        'use strict';
        return typeof module == 'object'
          ? function(name, factory) {
              factory(require, exports, module);
            }
          : function(name, factory) {
              var module = {
                exports: {}
              };
              var require = function(n) {
                if (n === 'jquery') {
                  n = 'jQuery';
                }
                return context[n];
              };

              factory(require, module.exports, module);
              context[name] = module.exports;
            };
      })(this)
);
