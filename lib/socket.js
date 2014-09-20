/*jslint nomen: true*/
"use strict";

var fs      = require('fs');
var debug   = require('debug')('socket');
var moment  = require('moment');
var _       = require('underscore');
var request = require('request');
var cheerio = require('cheerio');
var irc     = require(process.cwd() + '/lib/irc');
var config  = require(process.cwd() + '/config');

moment.locale('de');

var io      = null;

var ircOnline = [];

var started = false;

var saveConfig = function () {
    fs.writeFile(process.cwd() + '/config.json', JSON.stringify(config, null, 4), function (err) {
        if (err) {
            debug(err);
        } else {
            debug('Config gespeichert.');
        }
    });
};

var linkUser = function (nick, userId, callback) {
    request({
        "uri": "http://forum.sa-mp.de/index.php?page=User&userID=" + userId,
        "headers": {
            "User-Agent": "Breadfish++ Chat Linkrequest (https://github.com/BreadfishPlusPlus/IRC-Pipe)"
        }
    }, function (error, res, body) {
        if (!error) {
            if (res.statusCode === 200) {
                var $ = cheerio.load(body),
                    name = $('.userName span').text(),
                    avatarUrl = 'http://forum.sa-mp.de/' + $('.userAvatar a img').attr('src');
                callback('Du wurdest erfolgreich verlinkt. Benutzer ID: ' + userId + ', Benutzername: ' + name + ', Avatar: ' + avatarUrl);
                config.linked[nick] = {
                    name: name,
                    avatar: avatarUrl,
                    userId: userId
                };
                saveConfig();
            } else {
                callback('Konnte Profil nicht aufrufen (' + res.statusCode + ')');
            }
        } else {
            callback('Konnte Profil nicht aufrufen (' + error + ')');
        }
    });
};

var getSocketByName = function (name, callback) {
    callback(_.find(io.sockets.connected, function (socket) {
        return socket.userinfo.name === name;
    }));
};

var getOnline = function (callback) {
    var chat;
    chat = _.map(_.filter(io.sockets.connected, function (socket) {
        return !!socket.userinfo;
    }), function (socket) {
        return socket.userinfo.name;
    });
    chat = _.uniq(chat);
    callback('Zur Zeit ' + (chat.length === 1 ? 'ist' : 'sind') + ' ' + chat.length + ' Benutzer im Chat' + (chat.length > 0 ? (' (' + chat.join(', ') + ')') : '') + ' und ' + ircOnline.length + ' Benutzer im IRC' + (ircOnline.length > 0 ? (' (' + ircOnline.join(', ') + ')')  : '') + '.');
};

var startSocketServer = function (channel) {
    started = true;
    io = require('socket.io').listen(config.socket.port, {
        serveClient: config.socket.serveClient
    });
    debug('Socket listening at port %s', config.socket.port);

    io.on('connection', function (socket) {
        var connectionId = socket.conn.id;
        debug('New connection from %s', connectionId);

        socket.on('userinfo', function (userinfo) {
            debug('Connection %s is %s', connectionId, userinfo.name);
            channel.say('\u000307' + userinfo.name + '\u000309 (\u000310' + connectionId + '\u000309) hat den Chat betreten.');
            socket.userinfo = userinfo;
            getOnline(function (msg) {
                socket.emit('smessage', {
                    "type": 'system',
                    "message": msg
                });
            });
            if (config.banned.indexOf(userinfo.name) > -1) {
                socket.emit('banned');
            }
        });
        socket.on('cmessage', function (message) {
            if (message.substr(0, 7) === '/online') {
                getOnline(function (msg) {
                    socket.emit('smessage', {
                        "type": 'system',
                        "message": msg
                    });
                });
                return;
            }
            if (config.banned.indexOf(socket.userinfo.name) > -1) {
                socket.emit('banned');
            } else {
                channel.say('\u000307' + socket.userinfo.name + ':\u000f ' + message);
                io.emit('smessage', {
                    "message": message,
                    "user": socket.userinfo,
                    "dateTime": moment().format("dddd, DD. MMMM YYYY, HH:mm:ss [Uhr]"),
                    "displayTime": moment().format("H:mm:ss")
                });
            }
        });
        socket.on('disconnect', function () {
            if (socket.userinfo) {
                channel.say('\u000307' + socket.userinfo.name + '\u000309 (\u000310' + connectionId + '\u000309) hat den Chat verlassen.');
            }
        });
    });

    irc.on('message', function (event) {
        if (event.message[0] !== config.irc.ignorechar) {
            if (!config.linked.hasOwnProperty(event.user.getNick())) {
                irc.notice(event.user.getNick(), 'Du hast deinen Account noch nicht mit deinem Profil auf breadfish.de verlinkt.');
                irc.notice(event.user.getNick(), 'Wie das geht findest du hier: http://git.io/L75Pyg');
            } else {
                io.emit('smessage', {
                    "message": event.message,
                    "user": config.linked[event.user.getNick()],
                    "dateTime": moment().format("dddd, DD. MMMM YYYY, HH:mm:ss [Uhr]"),
                    "displayTime": moment().format("H:mm:ss")
                });
            }
            return;
        }
        if (event.message === '!clearchat') {
            if (event.channel.userHasMode(event.user, '!') || event.channel.userHasMode(event.user, '~') || event.channel.userHasMode(event.user, '&') || event.channel.userHasMode(event.user, '@')) {
                io.emit('clearchat');
                event.channel.reply(event.user, 'Der Chatverlauf wurde für B++ Nutzer gelöscht.');
            }
            return;
        }
        if (event.message === '!online') {
            var chat;
            chat = _.map(io.sockets.connected, function (socket) {
                return socket.userinfo.name;
            });
            chat = _.uniq(chat);
            event.channel.reply(event.user, 'Zur Zeit ' + (chat.length === 1 ? 'ist' : 'sind') + ' ' + chat.length + ' Benutzer im Chat' + (chat.length > 0 ? (': ' + chat.join(', ')) : '') + '.');
        }
        var match = event.message.match(/^!link(?: ?)(\d*)$/i);
        if (match !== null) {
            if (match[1]) {
                linkUser(event.user.getNick(), match[1], function (message) {
                    channel.reply(event.user, message);
                });
            } else {
                channel.reply(event.user, '!link <Benutzer ID>');
            }
        }
        match = event.message.match(/^!ban(?: ?)((?: |\S)*)$/i);
        if (match !== null) {
            if (event.channel.userHasMode(event.user, '!') || event.channel.userHasMode(event.user, '~') || event.channel.userHasMode(event.user, '&') || event.channel.userHasMode(event.user, '@')) {
                if (match[1]) {
                    getSocketByName(match[1], function (socket) {
                        if (socket) {
                            socket.emit('banned', event.user.getNick());
                            channel.reply(event.user, socket.userinfo.name + ' wurde gebannt.');
                            config.banned.push(socket.userinfo.name);
                            saveConfig();
                        } else {
                            channel.reply(event.user, 'Kein Benutzer mit dem namen gefunden.');
                        }
                    });
                } else {
                    channel.reply(event.user, '!ban <Benutzername>');
                }
            }
        }
        match = event.message.match(/^!unban(?: ?)((?: |\S)*)$/i);
        if (match !== null) {
            if (event.channel.userHasMode(event.user, '!') || event.channel.userHasMode(event.user, '~') || event.channel.userHasMode(event.user, '&') || event.channel.userHasMode(event.user, '@')) {
                if (match[1]) {
                    if (config.banned.indexOf(match[1]) > -1) {
                        config.banned = _.without(config.banned, match[1]);
                        saveConfig();
                        channel.reply(event.user, match[1] + ' wurde entbannt.');
                        getSocketByName(match[1], function (socket) {
                            if (socket) {
                                socket.emit('unbanned', event.user.getNick());
                            }
                        });
                    } else {
                        channel.reply(event.user, 'Kein gebannter Benutzer mit dem namen gefunden.');
                    }
                } else {
                    channel.reply(event.user, '!unban <Benutzername>');
                }
            }
        }
    });
};



irc.on('join', function (event) {
    if (event.channel.getName() === config.irc.chan) {
        if (event.user.getNick() === irc.me.getNick() && !started) {
            startSocketServer(event.channel);
        }
        irc.write('NAMES ' + event.channel.getName());
    }
});
irc.on('part', function (event) {
    irc.write('NAMES ' + event.channel.getName());
});
irc.on('quit', function () {
    irc.write('NAMES ' + config.irc.chan);
});
irc.on('kick', function (event) {
    irc.write('NAMES ' + event.channel.getName());
});
irc.on('names', function (event) {
    if (event.channel.getName() === config.irc.chan) {
        ircOnline = [];
        _.each(event.names, function (modes, nick) {
            if (config.linked[nick]) {
                ircOnline.push(nick);
            }
        });
    }
});