var router = require('../index');

var dns = router.createServer();

dns.route('example.com', '127.0.0.1');

dns.on('resolve', function(domain) {
	console.log('wanna resolve ' + domain);
});

dns.listen();
