var redis = require('redis'),
    url = require('url'),
    buf = require('buffer'),
    bouncy = require('bouncy');

var client = redis.createClient();
var port = 80;
var portbounce = 4218;
var ipbounce = '192.168.56.11';

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
            var lmt = replyHeaders['last-modified'];
            if (req.headers['if-modified-since'] && req.headers['if-modified-since'] < lmt) {
              statusCode = 304;
              delete replyHeaders['last-modified'];
              delete replyHeaders['content-type'];
            } 

            var res = bounce.respond();
            res.headers = replyHeaders;
            res.setHeader('Date', ''+Date());
            res.writeHead(statusCode, res.headers);
            if (statusCode == 200) res.write(replies.body);
            res.end(); 
//console.log('=>cache');
        }
        else { 
//console.log('=>proxy');
          bounce(ipbounce, portbounce)
        }
      });
    }
  }
  else {
    //put
    var expires = req.headers['memcached-expire'];
    var key = 'url:http://' + req.headers.host.replace(/\.put$/,'') + req.url;
    var body = new Buffer('');
    var headers = new Buffer('');
    

    req.on('data', function (data) {body +=data;});

    req.on('end', function () {
        //extract headers & body
        headers = body;
        body = body.replace(/EXTRACT_HEADERS(.|\r\n)*?\r\n\r\n/gmi,'');
        headers = headers.replace(/EXTRACT_HEADERS\r\n((.|\r\n)*?)\r\n\r\n(.|\r|\n)*/gmi,'$1');
        headers = headers.split('\r\n');
        headers  = '{' + headers.map(function (v,i,a) {
              return '"' + v.split(':')[0].toLowerCase() + '": "' + v.split(':')[1].trim() + '"';
            }).join(',') + '}';
        //store headers & body in a hash
        client.hmset(key ,'body',body,'headers',headers, function() {
            if (expires && expires !== '0') {
              client.expire(key, parseInt(expires,10));
            }
            var res = bounce.respond();
            res.write('STORED');
            res.end();
          }
        );
      }
    );


    //delete
  }
}).listen(port);


