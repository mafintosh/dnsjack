var common = require('common');
var dgram = require('dgram');
var net = require('net');
var dns = require('dns');

var bitSlice = function(b, offset, length) {	
	return (b >>> (7-(offset+length-1))) & ~(0xff << length);
};
var numify = function(ip) {
	ip = ip.split('.').map(function(n) {
		return parseInt(n, 10);
	});

	var result = 0;
	var base = 1;

	for (var i = ip.length-1; i >= 0; i--) {
		result += ip[i]*base;
		base *= 256;
	}

	return result;
};
var domainify = function(qname) {
	var parts = [];

	for (var i = 0; i < qname.length && qname[i];) {
		var length = qname[i];
		var offset = i+1;

		parts.push(qname.slice(offset,offset+length).toString());

		i = offset+length;
	}

	return parts.join('.');
};
var qnameify = function(domain) {
	var qname = new Buffer(domain.length+2);
	var offset = 0;

	domain = domain.split('.');

	for (var i = 0; i < domain.length; i++) {
		qname[offset] = domain[i].length;
		qname.write(domain[i], offset+1, domain[i].length, 'ascii');
		offset += qname[offset]+1;
	}

	qname[qname.length-1] = 0;

	return qname;
};

var parse = function(buf) {
	var header = {};
	var question = {};
	var b = buf.slice(2,3).toString('binary', 0, 1).charCodeAt(0);

	header.id = buf.slice(0,2);
	header.qr = bitSlice(b,0,1);
	header.opcode = bitSlice(b,1,4);
	header.aa = bitSlice(b,5,1);
	header.tc = bitSlice(b,6,1);
	header.rd = bitSlice(b,7,1);

	b = buf.slice(3,4).toString('binary', 0, 1).charCodeAt(0);

	header.ra = bitSlice(b,0,1);
	header.z = bitSlice(b,1,3);
	header.rcode = bitSlice(b,4,4);

	header.qdcount = buf.slice(4,6);
	header.ancount = buf.slice(6,8);
	header.nscount = buf.slice(8,10);
	header.arcount = buf.slice(10, 12);
	
	question.qname = buf.slice(12, buf.length-4);
	question.qtype = buf.slice(buf.length-4, buf.length-2);
	question.qclass = buf.slice(buf.length-2, buf.length);


	return {header:header, question:question};
};

var responseBuffer = function(query) {
	var question = query.question;
	var header = query.header;
	var qname = question.qname;
	var offset = 16+qname.length;
	var length = offset;

    for (var i = 0; i < query.rr.length; i++) {
		length += query.rr[i].qname.length+14;
    }

	var buf = new Buffer(length);
    
	header.id.copy(buf, 0, 0, 2);

	buf[2] = 0x00 | header.qr << 7 | header.opcode << 3 | header.aa << 2 | header.tc << 1 | header.rd;
	buf[3] = 0x00 | header.ra << 7 | header.z << 4 | header.rcode;

	buf.writeUInt16BE(header.qdcount, 4);
	buf.writeUInt16BE(header.ancount, 6);
	buf.writeUInt16BE(header.nscount, 8);
	buf.writeUInt16BE(header.arcount, 10);

    qname.copy(buf, 12);

	question.qtype.copy(buf, 12+qname.length, question.qtype, 2);
	question.qclass.copy(buf, 12+qname.length+2, question.qclass, 2);

	for (var i = 0; i < query.rr.length; i++) {
		var rr = query.rr[i];

		rr.qname.copy(buf, offset);

		offset += rr.qname.length;

		buf.writeUInt16BE(rr.qtype, offset);
		buf.writeUInt16BE(rr.qclass, offset+2);
		buf.writeUInt32BE(rr.ttl, offset+4);
		buf.writeUInt16BE(rr.rdlength, offset+8);
		buf.writeUInt32BE(rr.rdata, offset+10);

		offset += 14;
    }

    return buf;
};

var response = function(query, to) {
	var response = {};
	var header = response.header = {};
	var question = response.question = {};
	var rrs = resolve(query.question.qname, to);

	header.id = query.header.id;
	header.ancount = rrs.length;

	header.qr = 1;
	header.opcode = 0;
	header.aa = 0;
	header.tc = 0;
	header.rd = 1;
	header.ra = 0;
	header.z = 0;
	header.rcode = 0;
	header.qdcount = 1;
	header.nscount = 0;
	header.arcount = 0; 

	question.qname = query.question.qname;
	question.qtype = query.question.qtype;
	question.qclass = query.question.qclass;

	response.rr = rrs;

	return responseBuffer(response);	
};

var resolve = function(qname, to) {
	var r = {};

	r.qname = qname;
	r.qtype = 1;
	r.qclass = 1;
	r.ttl = 1;
	r.rdlength = 4;
	r.rdata = to;
	
	return [r];
};


exports.createServer = function(proxy) {
	proxy = proxy || '8.8.8.8';

	var that = common.createEmitter();
	var server = dgram.createSocket('udp4');
	var routes = [];

	server.on('message', function (message, rinfo) {
		var query = parse(message);
		var domain = domainify(query.question.qname);
		var to;

		var respond = function(buf) {
			server.send(buf, 0, buf.length, rinfo.port, rinfo.address);		
		};

		for (var i = 0; i < routes.length; i++) {
			if (routes[i].from.test(domain)) {
				to = routes[i].to;
				break;
			}
		}
		if (to) {
			that.emit('route', domain, to);
			respond(response(query, to));
			return;
		}

		var fallback = dgram.createSocket('udp4');

		that.emit('resolve', domain);

		fallback.send(message, 0, message.length, 53, proxy);
		fallback.on('message', function(response) {
			respond(response);
			fallback.close();
		});
	});

	that.route = function(from, to) {
		if (Array.isArray(from)) {
			from.forEach(function(item) {
				that.route(item, to);
			});
			return that;
		}
		if (!net.isIP(to)) {
			dns.lookup(to, function(err, ip) {
				if (err) {
					return;
				}
				that.route(from, ip);
			});
			return that;
		}

		from = from === '*' ? /.?/ : new RegExp('^'+from.replace(/\./g, '\\.').replace(/\*\\\./g, '(.+)\\.')+'$', 'i');
		to = numify(to);

		routes.push({from:from, to:to});

		return that;
	};
	that.listen = function(port) {
		server.bind(port || 53);

		return that;
	};

	return that;
};
