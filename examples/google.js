var jack = require('../').createServer();

jack.route('www.google.com', '127.0.0.1'); // route all requests to www.google.com to localhost
jack.listen(); // it listens on the standard DNS port of 53 per default

// now all requests to google.com should be routed localhost
require('http').createServer(function(req, res) {
	res.writeHead(200);
	res.end('jack says hi!');
}).listen(80);
