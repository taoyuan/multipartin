"use strict";

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Stream = require('stream').Stream;
var StringDecoder = require('string_decoder').StringDecoder;
var MultipartParser = require('./multipart_parser').MultipartParser;

module.exports = Multipartin;

function Multipartin(opts) {
    if (!(this instanceof Multipartin)) return new Multipartin(opts);
    EventEmitter.call(this);

    opts = opts || {};

    this.error = null;
    this.ended = false;

    this.maxPartsSize = opts.maxPartsSize || 0;
    this.encoding = opts.encoding || 'utf-8';
    this.headers = null;
    this.type = null;
    this.hash = opts.hash || false;
    this.multiples = opts.multiples || false;

    this.bytesReceived = null;
    this.bytesExpected = null;

    this._parser = null;
    this._flushing = 0;
    this._partsSize = 0;

    return this;
}

util.inherits(Multipartin, EventEmitter);

Multipartin.prototype.parse = function(req, cb) {
    this.pause = function() {
        try {
            req.pause();
        } catch (err) {
            // the stream was destroyed
            if (!this.ended) {
                // before it was completed, crash & burn
                this._error(err);
            }
            return false;
        }
        return true;
    };

    this.resume = function() {
        try {
            req.resume();
        } catch (err) {
            // the stream was destroyed
            if (!this.ended) {
                // before it was completed, crash & burn
                this._error(err);
            }
            return false;
        }

        return true;
    };

    var self = this;

    // Setup callback first, so we don't miss anything from data events emitted
    // immediately.
    if (cb) {
        var parts = {};
        this
            .on('part', function(value, name) {
                parts[name] = value;
            })
            .on('error', function(err) {
                cb(err, parts);
            })
            .on('end', function() {
                cb(null, parts);
            });
    }

    // Parse headers and setup the parser, ready to start listening for data.
    this.writeHeaders(req.headers);

    // Start listening for data.
    req
        .on('error', function(err) {
            self._error(err);
        })
        .on('aborted', function() {
            self.emit('aborted');
            self._error(new Error('Request aborted'));
        })
        .on('data', function(buffer) {
            self.write(buffer);
        })
        .on('end', function() {
            if (self.error) {
                return;
            }

            var err = self._parser.end();
            if (err) {
                self._error(err);
            }
        });

    return this;
};

Multipartin.prototype.pipe = function () {
    var stream = new Stream();
    stream.readable = true;
    this.on('part', function (part) {
        stream.emit('data', part);
    });
    this.on('end', function () {
        stream.emit('end');
    });
    this.on('error', function (err) {
        stream.emit('error', err);
    });
    return stream.pipe.apply(stream, arguments);
};

Multipartin.prototype.writeHeaders = function(headers) {
    this.headers = headers;
    this._parseContentLength();
    this._parseContentType();
};

Multipartin.prototype.write = function(buffer) {
    if (this.error) {
        return;
    }
    if (!this._parser) {
        this._error(new Error('uninitialized parser'));
        return;
    }

    this.bytesReceived += buffer.length;
    this.emit('progress', this.bytesReceived, this.bytesExpected);

    var bytesParsed = this._parser.write(buffer);
    if (bytesParsed !== buffer.length) {
        this._error(new Error('parser error, '+bytesParsed+' of '+buffer.length+' bytes parsed'));
    }

    return bytesParsed;
};

Multipartin.prototype.pause = function() {
    // this does nothing, unless overwritten in Multipartin.parse
    return false;
};

Multipartin.prototype.resume = function() {
    // this does nothing, unless overwritten in Multipartin.parse
    return false;
};

Multipartin.prototype.onPart = function(part) {
    // this method can be overwritten by the user
    this.handlePart(part);
};

//Multipartin.prototype.handlePart = function(part) {
//    var self = this;
//
//    if (typeof part.filename !== 'string') {
//        var value = ''
//            , decoder = new StringDecoder(this.encoding);
//
//        part.on('data', function(buffer) {
//            self._partsSize += buffer.length;
//            if (self._partsSize > self.maxPartsSize) {
//                self._error(new Error('maxPartsSize exceeded, received '+self._partsSize+' bytes of part data'));
//                return;
//            }
//            value += decoder.write(buffer);
//        });
//
//        part.on('end', function() {
//            self.emit('part', value, part.name);
//        });
//    }
//};

Multipartin.prototype.handlePart = function(part) {
    var self = this;

    if (typeof part.filename !== 'string') {
        var value = null;

        part.on('data', function(buffer) {
            self._partsSize += buffer.length;
            if (self.maxPartsSize > 0 && self._partsSize > self.maxPartsSize) {
                self._error(new Error('maxPartsSize exceeded, received '+self._partsSize+' bytes of part data'));
                return;
            }
            if (!value) {
                value = new Buffer(buffer);
            } else {
                value = Buffer.concat([value, buffer], value.length + buffer.length);
            }
        });

        part.on('end', function() {
            self.emit('part', value, part.name);
        });
    }
};

function dummyParser(self) {
    return {
        end: function () {
            self.ended = true;
            self._maybeEnd();
            return null;
        }
    };
}

Multipartin.prototype._parseContentType = function() {
    if (this.bytesExpected === 0) {
        this._parser = dummyParser(this);
        return;
    }

    if (!this.headers['content-type']) {
        this._error(new Error('bad content-type header, no content-type'));
        return;
    }

    if (this.headers['content-type'].match(/multipart/i)) {
        var m = this.headers['content-type'].match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (m) {
            this._initMultipart(m[1] || m[2]);
        } else {
            this._error(new Error('bad content-type header, no multipart boundary'));
        }
        return;
    }

    this._error(new Error('bad content-type header, unknown content-type: '+this.headers['content-type']));
};

Multipartin.prototype._error = function(err) {
    if (this.error || this.ended) {
        return;
    }

    this.error = err;
    this.emit('error', err);
};

Multipartin.prototype._parseContentLength = function() {
    this.bytesReceived = 0;
    if (this.headers['content-length']) {
        this.bytesExpected = parseInt(this.headers['content-length'], 10);
    } else if (this.headers['transfer-encoding'] === undefined) {
        this.bytesExpected = 0;
    }

    if (this.bytesExpected !== null) {
        this.emit('progress', this.bytesReceived, this.bytesExpected);
    }
};

Multipartin.prototype._initMultipart = function(boundary) {
    this.type = 'multipart';

    var parser = new MultipartParser(),
        self = this,
        headerField,
        headerValue,
        part;

    parser.initWithBoundary(boundary);

    parser.onPartBegin = function() {
        part = new Stream();
        part.readable = true;
        part.headers = {};
        part.name = null;
        part.filename = null;
        part.mime = null;

        part.transferEncoding = 'binary';
        part.transferBuffer = '';

        headerField = '';
        headerValue = '';
    };

    parser.onHeaderField = function(b, start, end) {
        headerField += b.toString(self.encoding, start, end);
    };

    parser.onHeaderValue = function(b, start, end) {
        headerValue += b.toString(self.encoding, start, end);
    };

    parser.onHeaderEnd = function() {
        headerField = headerField.toLowerCase();
        part.headers[headerField] = headerValue;

        var m = headerValue.match(/\bname="([^"]+)"/i);
        if (headerField == 'content-disposition') {
            if (m) {
                part.name = m[1];
            }

            part.filename = self._fileName(headerValue);
        } else if (headerField == 'content-type') {
            part.mime = headerValue;
        } else if (headerField == 'content-transfer-encoding') {
            part.transferEncoding = headerValue.toLowerCase();
        }

        headerField = '';
        headerValue = '';
    };

    parser.onHeadersEnd = function() {
        switch(part.transferEncoding){
            case 'binary':
            case '7bit':
            case '8bit':
                parser.onPartData = function(b, start, end) {
                    part.emit('data', b.slice(start, end));
                };

                parser.onPartEnd = function() {
                    part.emit('end');
                };
                break;

            case 'base64':
                parser.onPartData = function(b, start, end) {
                    part.transferBuffer += b.slice(start, end).toString('ascii');

                    /*
                     four bytes (chars) in base64 converts to three bytes in binary
                     encoding. So we should always work with a number of bytes that
                     can be divided by 4, it will result in a number of buytes that
                     can be divided vy 3.
                     */
                    var offset = parseInt(part.transferBuffer.length / 4, 10) * 4;
                    part.emit('data', new Buffer(part.transferBuffer.substring(0, offset), 'base64'));
                    part.transferBuffer = part.transferBuffer.substring(offset);
                };

                parser.onPartEnd = function() {
                    part.emit('data', new Buffer(part.transferBuffer, 'base64'));
                    part.emit('end');
                };
                break;

            default:
                return self._error(new Error('unknown transfer-encoding'));
        }

        self.onPart(part);
    };


    parser.onEnd = function() {
        self.ended = true;
        self._maybeEnd();
    };

    this._parser = parser;
};

Multipartin.prototype._fileName = function(headerValue) {
    var m = headerValue.match(/\bfilename="(.*?)"($|; )/i);
    if (!m) return;

    var filename = m[1].substr(m[1].lastIndexOf('\\') + 1);
    filename = filename.replace(/%22/g, '"');
    filename = filename.replace(/&#([\d]{4});/g, function(m, code) {
        return String.fromCharCode(code);
    });
    return filename;
};

Multipartin.prototype._maybeEnd = function() {
    if (!this.ended || this._flushing || this.error) {
        return;
    }

    this.emit('end');
};
