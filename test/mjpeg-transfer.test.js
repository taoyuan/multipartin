"use strict";

var fs = require('fs');
var http = require('http');
var Multipartin = require('../');
var s = require('./support');
var t = s.assert;
var request = require('request');

describe('Multipartin', function () {

    it.only('should parse mjpeg stream', function (done) {
        var count = 10;

        var sent = [], received = [];
        var server = http.createServer(function(req, res) {
            var m = new Multipartin();
            m.on('end', function () {
                res.writeHead(200);
                res.end('ok');
            });
            m.on('error', function (e) {
                res.writeHead(500);
                res.end(e.message);
            });
//            m.on('part', function (part) {
//                received.push(part);
//            });
            m.parse(req).pipe(s.writable(function (data) {
                received.push(data);
            }));
        });


        server.listen(0, function() {

            var req = request.post({
                url: 'http://127.0.0.1:' + server.address().port,
                headers: {
                    'Content-Type': 'multipart/x-mixed-replace; boundary=foo'
                }
            }, function callback(err, res, body) {
                t.notOk(err);
                t.equal(body, 'ok');
                t.deepEqual(sent, received);
                server.close();
                done();
            });


            var stream = s.readable();

            stream.pipe(req);

            var i = 0;
            (function sendNext() {
                if (i >= count) {
                    stream.push("--foo--\r\n");
                }
                fs.readFile(s.image(i++), function (err, data) {
                    sent.push(data);
                    stream.push("--foo\r\n");
                    stream.push("Content-Type: image/jpeg\r\n");
                    stream.push("Content-Length: " + data.length + "\r\n");
                    stream.push("\r\n");
                    stream.push(data, 'binary');
                    stream.push("\r\n");
                    sendNext();
                });
            })();

        });

    });



});