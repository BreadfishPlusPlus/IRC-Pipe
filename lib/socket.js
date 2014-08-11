/*jslint nomen: true*/
"use strict";

var fs      = require('fs');
var debug   = require('debug')('socket');
var moment  = require('moment');
var _       = require('underscore');
var irc     = require(process.cwd() + '/lib/irc');
var config  = require(process.cwd() + '/config');

moment.locale('de');

var online  = {
    "chat": {},
    "irc": []
};

var saveConfig = function () {
    fs.writeFile(process.cwd() + '/config.json', JSON.stringify(config, null, 4), function (err) {
        if (err) {
            debug(err);
        } else {
            debug('Config gespeichert.');
        }
    });
};

var getOnline = function (callback) {
    var chat, irc;
    chat = _.map(online.chat, function (userinfo) {
        return userinfo.name;
    });
    chat = _.uniq(chat);
    irc = _.without(online.irc, config.irc.nick);
    callback('Zur Zeit ' + (chat.length === 1 ? 'ist' : 'sind') + ' ' + chat.length + ' Benutzer im Chat' + (chat.length > 0 ? (' (' + chat.join(', ') + ')') : '') + ' und ' + irc.length + ' Benutzer im IRC' + (irc.length > 0 ? (' (' + irc.join(', ') + ')')  : '') + '.');
};

var startSocketServer = function (channel) {
    var io = require('socket.io').listen(config.socket.port, {serveClient: config.socket.serveClient});
    debug('Socket listening at port %s', config.socket.port);

    io.on('connection', function (socket) {
        var connectionId = socket.conn.id;
        debug('New connection from %s', connectionId);

        socket.on('userinfo', function (userinfo) {
            /*{
                "name": "",
                "avatar": "",
                "userId": 0
            }*/
            debug('Connection %s is %s', connectionId, userinfo.name);
            channel.say('\u000307' + userinfo.name + '\u000309 (\u000310' + connectionId + '\u000309) hat den chat betreten.');
            online.chat[connectionId] = userinfo;
            getOnline(function (msg) {
                io.emit('smessage', {
                    "type": 'system',
                    "message": msg
                });
            });
        });
        socket.on('cmessage', function (message) {
            var userinfo = online.chat[connectionId];
            channel.say('\u000307' + userinfo.name + ':\u000f ' + message);
            io.emit('smessage', {
                "message": message,
                "user": userinfo,
                "dateTime": moment().format("dddd, DD. MMMM YYYY, HH:mm:ss [Uhr]"),
                "displayTime": moment().format("H:mm:ss")
            });
        });
        socket.on('disconnect', function () {
            var userinfo = online.chat[connectionId];
            channel.say('\u000307' + userinfo.name + '\u000309 (\u000310' + connectionId + '\u000309) hat den chat verlassen.');
            delete online.chat[connectionId];
        });
    });

    irc.on('message', function (event) {
        if (event.message[0] !== config.irc.ignorechar) {
            if (!config.linked.hasOwnProperty(event.user.getNick())) {
                irc.notice(event.user.getNick(), 'Du hast deinen Account noch nicht mit deinem Profil auf breadfish.de verlinkt.');
                irc.notice(event.user.getNick(), 'Bitte schau in der Wiki (https://github.com/BreadfishPlusPlus/IRC-Pipe/wiki) nach wie das geht,');
                irc.notice(event.user.getNick(), 'oder nutze "' + config.irc.ignorechar + '" vor deiner Nachricht damit sie nicht an den Chat weitergeleitet wird.');
            } else {
                io.emit('smessage', {
                    "message": event.message,
                    "user": config.linked[event.user.getNick()],
                    "dateTime": moment().format("dddd, DD. MMMM YYYY, HH:mm:ss [Uhr]"),
                    "displayTime": moment().format("H:mm:ss")
                });
            }
        } else if (event.message === '!clearchat') {
            if (event.channel.userHasMode(event.user, '!') || event.channel.userHasMode(event.user, '~') || event.channel.userHasMode(event.user, '&') || event.channel.userHasMode(event.user, '@') || event.channel.userHasMode(event.user, '%')) {
                io.emit('clearchat');
            }
        }
    });
    irc.on('privatemessage', function (event) {
        var match = event.message.match(/^(\d+),((?: |\S)+),(http:\/\/forum\.sa-mp\.de\/wcf\/images\/avatars\/avatar-(?:default|\d+)\.png)$/i);
        if (match !== null) {
            irc.send(event.user.getNick(), 'Du wurdest erfolgreich verlinkt');
            irc.send(event.user.getNick(), 'Benutzer ID: ' + match[1] + ', Benutzername: ' + match[2] + ', Avatar: ' + match[3]);
            config.linked[event.user.getNick()] = {
                name: match[2],
                avatar: match[3],
                userId: parseInt(match[1], 10)
            };
            saveConfig();
        } else {
            irc.send(event.user.getNick(), 'Error: /msg ' + config.irc.nick + ' <Deine Benutzer ID>,<Dein Benutzername>,<Die URL deines Avatars>');
        }
    });
};



irc.on('join', function (event) {
    if (event.channel.getName() === config.irc.chan) {
        if (event.user.getNick() === config.irc.nick) {
            startSocketServer(event.channel);
        } else {
            online.irc.push(event.user.getNick());
            online.irc = _.uniq(online.irc);
        }
    }
});
irc.on('part', function (event) {
    irc.write('NAMES ' + event.channel.getName());
});
irc.on('quit', function (event) {
    irc.write('NAMES ' + event.channel.getName());
});
irc.on('kick', function (event) {
    irc.write('NAMES ' + event.channel.getName());
});
irc.on('names', function (event) {
    if (event.channel.getName() === config.irc.chan) {
        online.irc = [];
        _.each(event.names, function (modes, nick) {
            online.irc.push(nick);
        });
    }
});