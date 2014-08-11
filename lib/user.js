/*jslint nomen: true*/
"use strict";

var debug       = require('debug')('user');
var config      = require('../config');
var mongoose    = require('mongoose');
var Schema      = mongoose.Schema;

var userSchema = new Schema({
    name: String,
    userId: {type: Number, required: true, index: {unique: true}},
    avatar: String,
    onlineDate: Date,
    offlineDate: Date,
    online: Boolean,
    isAdmin: Boolean,
    messages: Number,
    created: Date,
    connectionId: String
});
var User = mongoose.model('User', userSchema, 'users');


var add = function (userinfo) {
    debug('add', userinfo);
    User.findOne({
        userId: userinfo.userId
    }, function (err, usr) {
        if (err) {
            debug('ERROR', err);
        }
        if (!usr) {
            usr = new User({
                userId: userinfo.userId,
                isAdmin: config.admin.indexOf(userinfo.name) !== -1,
                messages: 0,
                created: new Date()
            });
        }
        usr.name            = userinfo.name;
        usr.avatar          = userinfo.avatar;
        usr.onlineDate      = new Date();
        usr.online          = true;
        usr.connectionId    = userinfo.connectionId;
        usr.save();
    });
};
exports.add = add;

var offline = function (connectionId) {
    debug('offline', connectionId);
    User.findOneAndUpdate({
        connectionId: connectionId
    }, {
        online: false,
        offlineDate: new Date()
    }).exec();
};
exports.offline = offline;

var addMessageCount = function (connectionId) {
    debug('addMessageCount', connectionId);
    User.findOne({
        connectionId: connectionId
    }, function (err, usr) {
        if (err) {
            debug('ERROR', err);
        }
        usr.messages = usr.messages + 1;
        usr.save();
    });
};
exports.addMessageCount = addMessageCount;