var vm = require('vm');
var path = require('path');
var fs = require('fs');

var loader = require('context-loader');

var builtins = require('../lib/builtins');

var defaults = require('../settings/options').inspector;
var names = require('../settings/text').names;
var style = require('../settings/styling');

var nameColors = style.context.names;
var nameIndex = 1;
var inspector = loader.loadScript(path.resolve(__dirname, 'inspect.js'));

var contexts = new WeakMap;
var scripts = new WeakMap;

var runInThisContext = vm.runInThisContext;



module.exports = Context;

function Context(isGlobal){

  Object.keys(defaults).forEach(function(s){ this[s] = defaults[s] }, this);

  this.name = names.shift().color(nameColors[nameIndex++ % nameColors.length]);

  if (isGlobal) {
    if (module.globalConfigured) return global;
    module.globalConfigured = true;

    this.global = this.ctx = global;

    Object.defineProperties(global, {
      module:   { value: module },
      require:  { value: require },
      exports:  { get: function( ){ return module.exports; },
                  set: function(v){ module.exports = v;    } }
    });

    scripts.set(this, []);
    this.history = [];
    this.createInspector();
  } else {
    this.initialize();
  }
}

Context.prototype = {
  constructor: Context,

  get ctx(){ return contexts.get(this) },
  set ctx(v){ contexts.set(this, v) },

  initialize: function initialize(){
    // initialize context
    this.ctx = vm.createContext();
    // the wrapper Context object is different from the actual global
    this.global = run('this', this.ctx);

    // hide 'Proxy' if --harmony until V8 correctly makes it non-enumerable
    'Proxy' in global && run('Object.defineProperty(this, "Proxy", { enumerable: false })', this.ctx);

    this.createInspector();
    scripts.set(this, []);
    this.history = [];
    return this;
  },

  createInspector: function createInspector(){
    var uuid = UUID();
    this.outputHandler(uuid);
    run('_ = "' + uuid + '"', this.ctx);
    inspector.runInContext(this.ctx);
  },

  globals: function globals(){
    return run('(function(g){return Object.getOwnPropertyNames(g).reduce(function(r,s){if(s!=="_")r[s]=g[s];return r},{})})(this)', this.ctx);
  },

  syntaxCheck: function syntaxCheck(src){
    var result;
    src = (src || '').replace(/^\s*function\s*([_\w\$]+)/, '$1=function $1');
    if ((result = parsify(src)) === true) return src;
    src += ';';
    if (parsify(src) === true) return src;
    src = '( ' + src + '\n)';
    if (parsify(src) === true) return src;
    return result;
  },

  runScript: function runScript(script){
    scripts.get(this).push(script);
    var globals = this.globals();
    var result = script.runInContext(this.ctx).result;
    globals = diffObject(this.globals(), globals);
    script.globals = Object.keys(globals);
    if (script.globals.length) {
      if (!inObject(globals, result)) {
        result = {
          completion: result,
          globals: globals
        };
      } else {
        result = {
          globals: globals
        };
      }
    } else {
      result = {
        completion: result
      }
    }
    this.history.push({
      code: script.code,
      result: result,
      globals: script.globals
    });
    return result;
  },

  runCode: function runCode(code, filename){
    var script = loader.wrap(code, filename);
    return this.runScript(script);
  },

  runFile: function runFile(filename){
    var script = loader.loadScript(filename);
    if (script) {
      return this.runScript(script);
    }
  },

  clone: function clone(){
    var context = new Context;
    context.builtins = this.builtins;
    context.hiddens = this.hiddens;
    context.colors = this.colors;
    context.depth = this.depth;
    this.scripts.forEach(context.runScript.bind(context));
    return context;
  },

  outputHandler: function outputHandler(id){
    var last, inspect, filter;
    var handler = save;

    function install(obj){
      filter = obj.filter;
      inspect = obj.inspect;
      handler = save;
    }

    function save(obj){
      last = obj;
    }

    var format = function(){
      if (typeof last === 'undefined') return '';

      var obj = last;

      if (!this.builtins && (obj === this.global || obj === this.ctx)) {
        obj = filter(obj, builtins.all);
      }

      return inspect(obj, this, style.inspector);
    }.bind(this);

    Object.defineProperty(this.ctx, '_', {
      get: function( ){ return format() },
      set: function(v){
        if (v === id) return handler = install;
        handler(v);
      }
    });
  },
};

function inArray(arr, val){
  return arr.some(function(s){ return egal(arr[s], val) });
}

function diffArray(arr, diff){
  return arr.filter(function(s){ return !inArray(diff, s) });
}

function diffObject(obj, diff){
  return Object.getOwnPropertyNames(obj).reduce(function(r,s){
    if (!inObject(diff, obj[s])) {
      r[s] = obj[s];
    }
    return r;
  }, {});
}

function inObject(obj, val){
  return Object.getOwnPropertyNames(obj).some(function(s){ return egal(obj[s], val) });
}


function egal(a, b){
  return a === b ? a !== 0 || 1 / a === 1 / b : a !== a && b !== b;
}


function UUID(seed){
  return seed ? (seed^Math.random() * 16 >> seed / 4).toString(16)
              : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, UUID);
}


function run(code, ctx, name){
  if (ctx === global) {
    return runInThisContext(code, name || 'global');
  } else {
    return vm.runInContext(code, ctx, name);
  }
}

function parsify(src){
  try { return Function(src), true; }
  catch (e) { return e }
}