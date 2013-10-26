# DNSJack

A simple DNS proxy that lets you intercept domains and route them to whatever IP you decide.

It's available through npm:

	npm install dnsjack

It's easy to use:

``` js
var jack = require('dnsjack').createServer();

jack.route('www.google.com', '127.0.0.1'); // route all requests to www.google.com to localhost
jack.listen(); // it listens on the standard DNS port of 53 per default

// route all domains to 127.0.0.1
jack.route(function(domain, callback) {
	callback(null, '127.0.0.1');
});

// route all google domains to 127.0.0.1
jack.route(['google.com', '*.google.com'], function(domain, callback) {
	callback(null, '127.0.0.1');
});

// now all requests to google.com should be routed localhost
require('http').createServer(function(req, res) {
	res.writeHead(200);
	res.end('jack says hi!');
}).listen(80);
```

You probably need to run the above example with `sudo` as we need to listen to port `80` and `53`.
Now change your local DNS server to `127.0.0.1` and visit `http://www.google.com` in your browser.

DNSJack will forward all request that you don't route yourself to Google's DNS server or whatever DNS
you provide in `.createServer()`.

You can also use it to monitor your DNS resolutions which can be super useful for debugging:

``` js
var jack = require('dnsjack').createServer();

jack.on('resolve', function(domain) {
	console.log('Someone is resolving', domain);
});
jack.listen();
```