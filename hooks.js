var ERR = require("async-stacktrace");
var path = require('path');
var express = require('express');
var async = require("async");
var padManager = require("ep_etherpad-lite/node/db/PadManager");
var authorManager = require("ep_etherpad-lite/node/db/AuthorManager");
var readOnlyManager = require("ep_etherpad-lite/node/db/ReadOnlyManager");
var Changeset = require("ep_etherpad-lite/static/js/Changeset");
eejs = require("ep_etherpad-lite/node/eejs");

exports.expressServer = function (hook_name, args, cb) {
  args.app.get('/copy', exports.onRequest);
}

exports.eejsBlock_editbarMenuLeft = function (hook_name, args, cb) {
  args.content = args.content + eejs.require("ep_copypad/templates/editbarButtons.ejs", {}, module);
  return cb();
}

exports.eejsBlock_styles = function (hook_name, args, cb) {
    args.content = args.content + eejs.require("ep_copypad/templates/styles.ejs", {}, module);
  return cb();
}

exports.eejsBlock_scripts = function (hook_name, args, cb) {
    args.content = args.content + eejs.require("ep_copypad/templates/scripts.ejs", {}, module);
  return cb();
}

exports.onRequest = function(req, res) {
  exports.createCopy(req.query.old, req.query.new, req.query.old_rev, function (err, padId) {
    if (err) return res.send(err, 500);
    res.redirect('/p/'+ padId);
  });
}


exports.formatAuthorData = function (historicalAuthorData) {
  var authors_all = [];
  for (var author in historicalAuthorData) {
    var n = historicalAuthorData[author].name;
    authors_all[n] = (authors_all[n]) ? 1+authors_all[n] : 1;
  }
  
  var authors = [];
  for (var n in authors_all) {
    if (n == "undefined") {
      authors.push("[unnamed author]");
    } else {
      authors.push(n);
    }
  }
  return authors;
}

exports.createCopy = function (oldPadId, newPadId, cloneRevNum, cb) {
  var newPad;
  var oldPad;
  var usedOldPadOd = oldPadId;
  var author_list;
  var header;
  var oldText;
  var oldAText;
  var oldPool;

  async.series([
    function (cb) {
      if (!oldPadId) return cb("No source pad specified");
      if (!newPadId) {
        newPadId = exports.randomPadName();
      }
      cb();
    },
    function (cb) {
      exports.getIds(oldPadId, function(err, value) {
        if(ERR(err, cb)) return;
        oldPadId = value.padId;
        cb();
      });
    },
    function (cb) {
      padManager.doesPadExists(oldPadId, function (err, exists) {
        if(ERR(err, cb)) return; 
        if (!exists) return cb("Old pad does not exist");
        cb();
      });
    },
    function (cb) {
      padManager.doesPadExists(newPadId, function (err, exists) {
        if(ERR(err, cb)) return; 
        if (exists) return cb("New pad already exist");
        cb();
      });
    },
    function (cb) {
      padManager.getPad(oldPadId, null, function(err, value) { if(ERR(err, cb)) return; oldPad = value; cb(); });
    },
    function (cb) {
      padManager.getPad(newPadId, "", function(err, value) { if(ERR(err, cb)) return; newPad = value; cb(); });
    },
    function (cb) {
      exports.buildHistoricalAuthorData(oldPad, function (err, data) {
        if(ERR(err, cb)) return;
        author_list = exports.formatAuthorData(data);
        cb();
      });
    },
    function (cb) {
      if (cloneRevNum == undefined) cloneRevNum = oldPad.getHeadRevisionNumber();
      cb();
    },
    function (cb) {
      exports.getRevisionText(oldPad, cloneRevNum, undefined, function(err, value) { if(ERR(err, cb)) return; oldText = value; cb(); });
    },
    function (cb) {
      oldPad.getInternalRevisionAText(cloneRevNum, function(err, value) { if(ERR(err, cb)) return; oldAText = value; cb(); });
    },
    function (dummy) {
      header = "This pad builds on [["+usedOldPadOd+"/rev."+cloneRevNum + "]], created by " + author_list.join(" & ") + "\n\n";

      var newPool = newPad.pool;
      newPool.fromJsonable(oldPad.pool.toJsonable());
      var assem = Changeset.smartOpAssembler();
      assem.appendOpWithText('+', header, [], newPool);
      Changeset.appendATextToAssembler(oldAText, assem);
      assem.endDocument();
      newPad.appendRevision(Changeset.pack(1, header.length + oldText.length + 1, assem.toString(), header + oldText));

      return cb(null, newPadId);
    }
  ]);
}



/* FIXME: These functions should be in core, but where left out when old etherpad was ported. */

/* Taken from src/templates/index.html. This should really be
 * accessible in some module, and do checking for existing names, like
 * randomUniquePadId used to do */

exports.randomPadName = function () {
  var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var string_length = 10;
  var randomstring = '';
  for (var i = 0; i < string_length; i++) {
    var rnum = Math.floor(Math.random() * chars.length);
    randomstring += chars.substring(rnum, rnum + 1);
  }
  return randomstring;
}

exports.buildHistoricalAuthorData = function (pad, cb) {
  var historicalAuthorData = {};

  async.forEach(
    pad.getAllAuthors(),
    function(authorId, cb) {
      authorManager.getAuthor(authorId, function(err, author) {
        if(ERR(err, cb)) return;
        delete author.timestamp;
        historicalAuthorData[authorId] = author;
        cb();
      });
    },
    function (err) {
     if(ERR(err, cb)) return;
     cb(null, historicalAuthorData);
    }
  );
}


exports.getInternalRevisionText = function(pad, r, optInfoObj, cb) {
  pad.getInternalRevisionAText(r, function (err, atext) {
    if(ERR(err, cb)) return;
    var text = atext.text;
    if (optInfoObj) {
      if (text.slice(-1) != "\n") {
        optInfoObj.badLastChar = text.slice(-1);
      }
    }
    cb(null, text);
  });
}

exports.getRevisionText = function(pad, r, optInfoObj, cb) {
  exports.getInternalRevisionText(pad, r, optInfoObj, function (err, internalText) {
    if(ERR(err, cb)) return;
    cb(null, internalText.slice(0, -1));
  });
}


/**
 * returns a the padId and readonlyPadId in an object for any id
 * @param {String} padIdOrReadonlyPadId read only id or real pad id
 */
exports.getIds = function(padIdOrReadonlyPadId, callback) {
  var handleRealPadId = function () {
    readOnlyManager.getReadOnlyId(padIdOrReadonlyPadId, function (err, value) {
      callback(null, {
        readOnlyPadId: value,
        padId: padIdOrReadonlyPadId,
        readonly: false
      });
    });
  }

  if (padIdOrReadonlyPadId.indexOf("r.") != 0)
    return handleRealPadId();

  readOnlyManager.getPadId(padIdOrReadonlyPadId, function (err, value) {
    if(ERR(err, callback)) return;
    if (value == null)
      return handleRealPadId();
    callback(null, {
      readOnlyPadId: padIdOrReadonlyPadId,
      padId: value,
      readonly: true
    });
  });
}