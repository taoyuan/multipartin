"use strict";

var MultipartParser = require('../lib/multipart_parser').MultipartParser;
var s = require('./support');

describe('MultipartParser', function () {

    it('should parse buffers', function (done) {
        var size = 100 * 1024 * 1024;
        var buffers = s.createMultipartBuffers(size);

        var parser = new MultipartParser();

        parser.initWithBoundary(s.boundary);

        parser.onHeaderField = function(buffer, start, end) {
            console.log('onHeaderField', start, end);
        };

        parser.onHeaderValue = function(buffer, start, end) {
            console.log('onHeaderValue', start, end);
        };

        parser.onPartBegin = function(buffer, start, end) {
            console.log('onPartBegin', start, end);
        };

        parser.onPartData = function(buffer, start, end) {
            console.log('onPartData', start, end);
        };

        parser.onPartEnd = function(buffer, start, end) {
            console.log('onPartEnd', start, end);
        };

        parser.onEnd = function(buffer, start, end) {
            console.log('onEnd', start, end);
            done();
        };

        buffers.forEach(function (buffer) {
            parser.write(buffer)
        })
    });



});