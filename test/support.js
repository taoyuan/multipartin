"use strict";

var path = require('path');
var stream = require('stream');

var root = path.join(__dirname, '../');
exports.dir = {
    root    : root,
    lib     : root + '/lib',
    fixture : root + '/test/fixture',
    images  : root + '/test/images',
    tmp     : root + '/test/tmp'
};

var boundary = '-----------------------------168072824752491622650073';
exports.boundary = boundary;

exports.image = function (name) {
    return path.join(exports.dir.images, name + '.jpg');
};

exports.require = function(lib) {
    return require(exports.dir.lib + '/' + lib);
};

exports.assert = require('chai').assert;

exports.createMultipartBuffers = createMultipartBuffers;
function createMultipartBuffers(size) {

    return createBuffers([
        '--'+boundary+'\r\n',
        'Content-Type: image/jpeg\r\n',
        'Content-Length: '+size+'\r\n',
        '\r\n',
        new Buffer(size),
        '\r\n',
        '--'+boundary+'--\r\n'
    ]);
}

function createBuffer(data) {
    if (Buffer.isBuffer(data)) return data;
    var b = new Buffer(data.length);
    b.write(data, 'binary');
    return b;
}

function createBuffers(data) {
    var buffers = [];
    data = Array.isArray(data) ? data : [data];
    data.forEach(function (value) {
        buffers.push(createBuffer(value));
    });
    return buffers;
}



exports.readable = function (read) {
    var r = new stream.Readable();
    r._read = function () {
        if (read) {
            read.call(this);
        }
    };
    return r;
};

exports.writable = function (write) {
    var w = new stream.Writable();
    w._write = function (chunk, enc, next) {
        if (write) {
            if (write.length < 3) {
                write.call(this, chunk, enc);
                next();
            } else {
                write.call(this, chunk, enc, next);
            }
        } else {
            next();
        }
    };
    return w;
};

