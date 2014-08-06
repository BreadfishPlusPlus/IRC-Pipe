"use strict";

process.env.DEBUG = "chat,user,message";

var debug       = require('debug')('chat');
var config      = require('../config');
var mongoose    = require('mongoose');

var Message = require('./message');
var User    = require('./user');
var io      = null;

var createSocket = function () {
    io = require('socket.io').listen(config.port);
    debug('Socket listening @ %s', config.port);

    io.on('connection', function (socket) {
        var connectionId = socket.conn.id;
        debug('New connection from %s', connectionId);

        socket.on('userinfo', function (userinfo) {
            debug('Connection %s is %s', connectionId, userinfo.name);
            User.add({
                avatar: userinfo.avatar,
                userId: userinfo.userId,
                name: userinfo.name,
                connectionId: connectionId
            });
            Message.getLastTen(function (messages) {
                messages.forEach(function (msg) {
                    socket.emit('smessage', msg);
                });
            });
        });
        socket.on('cmessage', function (message) {
            Message.add(connectionId, message, function (messageinfo) {
                User.addMessageCount(connectionId);
                socket.emit('smessage', messageinfo);
            });
        });
        socket.on('disconnect', function () {
            User.offline(connectionId);
        });
    });
};


mongoose.connect(config.mongodb);
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function () {
    debug('Connected to MongoDB');
    createSocket();
});