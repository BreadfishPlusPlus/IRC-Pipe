"use strict";

var debug   = require('debug')('irc');
var coffea  = require('coffea');
var tls     = require('tls');
var config  = require(process.cwd() + '/config');

var stream = tls.connect(config.irc.port, config.irc.host, {
    rejectUnauthorized: false
}, function () {
    if (stream.authorized || stream.authorizationError === 'DEPTH_ZERO_SELF_SIGNED_CERT' || stream.authorizationError === 'CERT_HAS_EXPIRED' || stream.authorizationError === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        if (stream.authorizationError === 'CERT_HAS_EXPIRED') {
            debug('Connecting to server with expired certificate');
        }
    } else {
        debug('[SSL-Error]' + stream.authorizationError);
    }
});
var client = coffea(stream);
module.exports = client;
client.pass(config.irc.pass);
client.nick(config.irc.nick);
client.user(config.irc.user, config.irc.real);

client.on('motd', function () {
    client.join(config.irc.chan);
});
client.on('data', function (data) {
    debug(data.string);
});