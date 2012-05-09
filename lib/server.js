/*
 TODO 
 - gzip cached content
  - gzip proxy response
  - read & watch chef file
  - log request in nginx format
  - error handling
  - manage xff headers
  - refactoring
 */

var redis = require('redis'),
    url = require('url'),
    Buffers = require('buffers'),
    fs = require('fs'),
    bouncy = require('bouncy');

var client = redis.createClient(null, null,{return_buffers: true});
var port = 80,
    portbounce = 4218,
    ipbounce = '192.168.56.11',
    chef;

client.on("error", function (err) {
  console.log("Error " + err);
});


client.on("ready", function () {
  console.log("Redis is ready ");
});

bouncy(function (req, bounce) {
  if (!/\.put$/.test(req.headers.host)) {
    if ((/no\-cache/.test(req.headers.pragma)) || (/no\-cache/.test(req.headers['cache-control'])) || (req.method != 'GET')) {
      bounce(ipbounce, portbounce);
    }
    else {
      client.hgetall('url:http://'+req.headers.host + req.url, function(err,replies) {
        if (replies != null) {
          var replyHeaders = JSON.parse(replies.headers);
          var statusCode = 200;

            //304 response : check LMT vs IMS
            var lmt = Date.parse(replyHeaders['last-modified']);
            if (req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) > lmt) {
              statusCode = 304;
              delete replyHeaders['last-modified'];
              delete replyHeaders['content-type'];
            } 

            //if accept encoding deflate/gzip and content-type text or application/js, body is the gzipped version
            if (/text/.test(replyHeaders['content-type']) || /application\/javascript/.test(replyHeaders['content-type'])) {
              //var _body = replies.gbody;
            }
            else {
              var _body = replies.body;
            }

            var _body = replies.body;
            var res = bounce.respond();
            res.headers = replyHeaders;
            res.setHeader('Date', ''+Date());
            res.writeHead(statusCode, res.headers);
            if (statusCode == 200) res.write(_body);
            res.end(); 
        }
        else { 
          bounce(ipbounce, portbounce)
        }
      });
    }
  }
  else {
    //put
    var expires = req.headers['memcached-expire'];
    var key = 'url:http://' + req.headers.host.replace(/\.put$/,'') + req.url;
    var body = Buffers(), headers, contentType;

    req.on('data', function (data) {
        body.push(data);
        });

    if (req.method === 'PUT') {
      req.on('end', function () {
        //extract headers & body
        body = body.toBuffer();
        //body = body.replace(/EXTRACT_HEADERS(.|\r\n)*?\r\n\r\n/gmi,'');
        var pos = 0;
        for (var i=0; i < body.length;i++) {
            if (body[i] == 13 && body[i+1] == 10 && body[i+2] == 13 && body[i+3] == 10) {
                pos = i+4;break;
            }
        }
        body = body.slice(pos);
        headers = body.slice(17,pos-4).toString();
        //headers = headers.replace(/EXTRACT_HEADERS\r\n((.|\r\n)*?)\r\n\r\n(.|\r|\n)*/gmi,'$1');
        headers = '{' + headers.replace(/([a-z\-]*): (.*)(\r\n)?/gi, function (str, name, value, sep) {return '"' + name.toLowerCase() + '": "' + value + '"' + (sep ? sep : '')}).split('\r\n').join(',') + '}';
        contentType = JSON.parse(headers)['content-type'];
        headers = new Buffer(headers);

        //store headers & body in a hash, and gzipped content if content type is text/html/js/css
        if (/text/.test(contentType)) {
          
        }
        client.hmset(key ,'body',_body,'headers',_headers, function(err) {
            if (expires && expires !== '0') {
              client.expire(key, parseInt(expires,10));
            }
            var res = bounce.respond();
            res.write('STORED');
            res.end();
          }
        );
      });
    }
    else {
      switch (true) {
        case /^\/flush$/.test(req.url):
          client.flushdb();
          var res = bounce.respond();
          res.write('OK');
          res.end();
          break;
        case /^\/flushns$/.test(req.url):
          //list keys for host
          client.keys('url:http://' + req.headers.host.replace(/\.put$/,'') + '*', function(err, keys) {
            //del all keys
            client.del(keys); 
          }); 
          var res = bounce.respond();
          res.write('OK');
          res.end();
          break;
        case /^\/stats$/.test(req.url):
          var res = bounce.respond();
          res.write('OK');
          res.end();
          break;
        case /^\/ping-fstrz.*/.test(req.url):
          if (/^\/ping-fstrz$/.test(req.url)) {
            //watch file /var/cache/chef, if changed update content in mem
            var res = bounce.respond();
            res.write(chef);
            res.end();
          }
          else {
            //bounce with this url
            bounce(ipbounce, portbounce);
          }
          break;
        }
    }
  }
}).listen(port);


