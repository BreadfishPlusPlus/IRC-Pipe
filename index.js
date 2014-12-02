process.env.DEBUG = 'socket,irc,redis';

if (!process.env.PORT) {
    process.env.PORT = 8080;
}

if (!process.env.IRC_CHANNEL) {
    throw new Error('IRC_CHANNEL Umgebungsvariable ist nicht definiert!');
}
if (!process.env.IRC_HOST) {
    throw new Error('IRC_HOST Umgebungsvariable ist nicht definiert!');
}
if (!process.env.IRC_PORT) {
    throw new Error('IRC_PORT Umgebungsvariable ist nicht definiert!');
}
if (!process.env.IRC_NICK) {
    throw new Error('IRC_NICK Umgebungsvariable ist nicht definiert!');
}

if (!process.env.REDIS_HOST) {
    throw new Error('REDIS_HOST Umgebungsvariable ist nicht definiert!');
}
if (!process.env.REDIS_PORT) {
    throw new Error('REDIS_PORT Umgebungsvariable ist nicht definiert!');
}

var debug       = {
    irc: require('debug')('irc'),
    io: require('debug')('socket'),
    redis: require('debug')('redis')
};
var socket      = require('socket.io');
var coffea      = require('coffea');
var net         = require('net');
var _           = require('underscore');
var moment      = require('moment');
var request     = require('request');
var cheerio     = require('cheerio');
var crypto      = require('crypto');
var async       = require('async');
var util        = require('util');
var irc         = null;
var io          = null;
var redis       = null;
var ircUser     = [];
var topic       = '';

/*
 * 
 */

redis = require('redis').createClient(parseInt(process.env.REDIS_PORT, 10), process.env.REDIS_HOST);
if (process.env.REDIS_AUTH) {
    redis.auth(process.env.REDIS_AUTH);
}
redis.on('ready', function () {
    debug.redis('Connection ready');
});
redis.on('connect', function () {
    debug.redis('Connected');
});
redis.on('error', function (err) {
    debug.redis('Error ' + err);
});
redis.on('end', function () {
    debug.redis('Connection ended');
});

moment.locale('de');

/*
 * 
 */


var stream = net.connect({
    port: parseInt(process.env.IRC_PORT, 10),
    host: process.env.IRC_HOST
});
var irc = coffea(stream);
if (process.env.IRC_NICK) {
    irc.pass(process.env.IRC_PASS);
}
irc.nick(process.env.IRC_NICK);
irc.user(process.env.IRC_NICK, 'https://github.com/BreadfishPlusPlus/IRC-Pipe/wiki');

irc.on('motd', function () {
    irc.join(process.env.IRC_CHANNEL);
});
irc.on('data', function (data) {
    debug.irc(data.string);
});

/*
 * 
 */

var getSocketByName = function (name, callback) {
    callback(_.find(io.sockets.connected, function (socket) {
        return socket.userinfo.name === name;
    }));
};

var getHashed = function (str) {
    var h = crypto.createHash('md5');
    h.update(str);
    return h.digest('hex');
};

var isBanned = function (name, callback) {
    redis.sismember('banned', name, function (err, member) {
        callback(!err && member);
    });
};

var setBanned = function (name, banned) {
    if (banned) {
        redis.sadd('banned', name);
    } else {
        redis.srem('banned', name);
    }
};

var isLinked = function (name, callback) {
    redis.hgetall('linked:' + name, function (err, obj) {
        callback(err || !obj ? null : obj);
    });
};

var setLink = function (name, avatar, userId) {
    redis.hmset('linked:' + name, {
        'name': name,
        'avatar': avatar,
        'userId': userId
    });
};

var addIrcUser = function (nick) {
    isLinked(nick, function (linked) {
        if (linked) {
            ircUser.push(nick);
            ircUser = _.uniq(ircUser);
        }
    });
};
var remIrcUser = function (nick) {
    ircUser = _.without(ircUser, nick);
};

var getOnline = function (callback) {
    var chat;
    chat = _.map(_.filter(io.sockets.connected, function (socket) {
        return !!socket.userinfo;
    }), function (socket) {
        return '<a href="http://forum.sa-mp.de/index.php?page=User&userID=' + socket.userinfo.userId + '">' + socket.userinfo.name + '</a>';
    });
    chat = _.uniq(chat);

    async.map(ircUser, function (nick, cb) {
        isLinked(nick, function (linked) {
            if (linked) {
                cb(null, '<a href="http://forum.sa-mp.de/index.php?page=User&userID=' + linked.userId + '">' + linked.name + '</a>');
            } else {
                cb(null, null);
            }
        });
    }, function (err, ircuser) {
        ircuser = _.filter(ircuser, function (user) {
            return !_.isNull(user);
        });
        callback(util.format('Zur Zeit %s %s Benutzer im Chat%s und %s Benutzer im IRC%s.',
            chat.length === 1 ? 'ist' : 'sind',
            chat.length === 1 ? 'ein': chat.length,
            chat.length > 0 ? (' (' + chat.join(', ') + ')') : '',
            ircuser.length === 1 ? 'ein': ircuser.length,
            ircuser.length > 0 ? (' (' + ircuser.join(', ') + ')')  : ''
        ));
    });
};

var getLink = function (nick, userId, callback) {
    request({
        uri: 'http://forum.sa-mp.de/index.php?page=User&userID=' + userId,
        headers: {
            'User-Agent': 'Breadfish++ Chat Linkrequest (https://github.com/BreadfishPlusPlus/IRC-Pipe)'
        }
    }, function (error, res, body) {
        if (!error) {
            if (res.statusCode === 200) {
                var $ = cheerio.load(body),
                    name = $('.userName span').text(),
                    avatarUrl = 'http://forum.sa-mp.de/' + $('.userAvatar a img').attr('src');
                callback('Du wurdest erfolgreich verlinkt. Benutzer ID: ' + userId + ', Benutzername: ' + name + ', Avatar: ' + avatarUrl);
                //setLink
                setLink(name, avatarUrl, userId);
                addIrcUser(nick);
            } else {
                callback('Konnte Profil nicht aufrufen (' + res.statusCode + ')');
            }
        } else {
            callback('Konnte Profil nicht aufrufen (' + error + ')');
        }
    });
};

/*
 * 
 */

var startSocketServer = function (channel) {
    var app = require('http').createServer(function (req, res) {
        res.writeHead(200);
        res.end('Ok');
    });
    io = socket(app);
    app.listen(parseInt(process.env.PORT || 80, 10), function () {
        debug.io('Socket listening at port %s', process.env.PORT);
    });

    io.on('connection', function (socket) {
        var connectionId = getHashed(socket.handshake.address);
        debug.io('New connection from %s', connectionId);

        socket.on('userinfo', function (userinfo) {
            debug.io('Connection %s is %s', connectionId, userinfo.name);
            channel.say('\u000307' + userinfo.name + '\u000309 (\u000310' + connectionId + '\u000309) hat den Chat betreten.');
            socket.userinfo = userinfo;
            socket.emit('topic', topic);
            getOnline(function (msg) {
                socket.emit('smessage', {
                    type: 'system',
                    message: msg
                });
            });
            isBanned(userinfo.name, function (banned) {
                if (banned) {
                    socket.emit('banned');
                }
            });
        });

        socket.on('cmessage', function (message) {
            if (message.substr(0, 7) === '/online') {
                getOnline(function (msg) {
                    socket.emit('smessage', {
                        type: 'system',
                        message: msg
                    });
                });
                return;
            }
            isBanned(socket.userinfo.name, function (banned) {
                if (banned) {
                    socket.emit('banned');
                } else {
                    channel.say('\u000307' + socket.userinfo.name + ':\u000f ' + message);
                    io.emit('smessage', {
                        message: message,
                        user: socket.userinfo,
                        dateTime: moment().format('dddd, DD. MMMM YYYY, HH:mm:ss [Uhr]'),
                        displayTime: moment().format('H:mm:ss')
                    });
                }
            });
        });
        socket.on('disconnect', function () {
            if (socket.userinfo) {
                channel.say('\u000307' + socket.userinfo.name + '\u000309 (\u000310' + connectionId + '\u000309) hat den Chat verlassen.');
            }
        });
    });
};

/*
 *
 */

irc.on('message', function (event) {
    if (event.message[0] !== '!') {
        isLinked(event.user.getNick(), function (linked) {
            if (!linked) {
                irc.notice(event.user.getNick(), 'Du hast deinen Account noch nicht mit deinem Profil auf breadfish.de verlinkt.');
                irc.notice(event.user.getNick(), 'Wie das geht findest du hier: http://git.io/L75Pyg');
            } else {
                io.emit('smessage', {
                    message: event.message,
                    user: linked,
                    dateTime: moment().format('dddd, DD. MMMM YYYY, HH:mm:ss [Uhr]'),
                    displayTime: moment().format('H:mm:ss')
                });
            }
        });
        return;
    }

    if (event.message === '!clearchat') {
        if (event.channel.userHasMode(event.user, '!') || event.channel.userHasMode(event.user, '~') || 
            event.channel.userHasMode(event.user, '&') || event.channel.userHasMode(event.user, '@')) {
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
        event.channel.reply(event.user, util.format('Zur Zeit %s %s Benutzer im Chat%s',
            chat.length === 1 ? 'ist' : 'sind',
            chat.length === 1 ? 'ein' : chat.length,
            chat.length > 0 ? (': ' + chat.join(', ') + '.') : '.'
        ));
        return;
    }

    var match = event.message.match(/^!link(?: ?)(\d*)$/i);
    if (match !== null) {
        if (match[1]) {
            getLink(event.user.getNick(), match[1], function (message) {
                event.channel.reply(event.user, message);
            });
        } else {
            event.channel.reply(event.user, '!link <Benutzer ID>');
        }
        return;
    }

    match = event.message.match(/^!ban(?: ?)((?: |\S)*)$/i);
    if (match !== null) {
        if (event.channel.userHasMode(event.user, '!') || event.channel.userHasMode(event.user, '~') || 
            event.channel.userHasMode(event.user, '&') || event.channel.userHasMode(event.user, '@')) {
            if (match[1]) {
                isBanned(match[1], function (banned) {
                    if (banned) {
                        event.channel.reply(event.user, 'Dieser Benutzer ist bereits gebannt.');
                    } else {
                        setBanned(match[1], true);
                        event.channel.reply(event.user, match[1] + ' wurde gebannt.');
                        getSocketByName(match[1], function (socket) {
                            if (socket) {
                                socket.emit('banned', event.user.getNick());
                            }
                        });
                    }
                });
            } else {
                event.channel.reply(event.user, '!ban <Benutzername>');
            }
        }
        return;
    }

    match = event.message.match(/^!unban(?: ?)((?: |\S)*)$/i);
    if (match !== null) {
        if (event.channel.userHasMode(event.user, '!') || event.channel.userHasMode(event.user, '~') || 
            event.channel.userHasMode(event.user, '&') || event.channel.userHasMode(event.user, '@')) {
            if (match[1]) {
                isBanned(match[1], function (banned) {
                    if (banned) {
                        setBanned(match[1], false);
                        event.channel.reply(event.user, match[1] + ' wurde entbannt.');
                        getSocketByName(match[1], function (socket) {
                            if (socket) {
                                socket.emit('unbanned', event.user.getNick());
                            }
                        });
                    } else {
                        event.channel.reply(event.user, 'Dieser Benutzer ist nicht gebannt.');
                    }
                });
            } else {
                event.channel.reply(event.user, '!unban <Benutzername>');
            }
        }
        return;
    }
});

irc.on('join', function (event) {
    if (event.channel.getName() === process.env.IRC_CHANNEL) {
        if (event.user.getNick() === irc.me.getNick()) {
            startSocketServer(event.channel);
        }
        irc.write('NAMES ' + event.channel.getName());
    }
});
irc.on('part', function (event) {
    _.each(event.channels, function (channel) {
        if (channel.getName() === process.env.IRC_CHANNEL) {
            remIrcUser(event.user.getNick());
        }
    });
});
irc.on('quit', function (event) {
    remIrcUser(event.user.getNick());
});
irc.on('kick', function (event) {
    remIrcUser(event.user.getNick());
});
irc.on('whois', function (event) {
    if (event.user.away === null && _.has(event.user.channels, process.env.IRC_CHANNEL)) {
        addIrcUser(event.user.nick);
    } else {
        remIrcUser(event.user.nick);
    }
});
irc.on('names', function (event) {
    if (event.channel.getName() === process.env.IRC_CHANNEL) {
        _.each(_.keys(event.names), function (nick) {
            irc.whois(nick);
        });
    }
});
irc.on('topic', function (event) {
    if (event.channel.getName() === process.env.IRC_CHANNEL) {
        io.emit('topic', event.topic);
        topic = event.topic;
    }
});