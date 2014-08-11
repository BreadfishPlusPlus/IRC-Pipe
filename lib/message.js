/*jslint nomen: true*/
"use strict";

var debug       = require('debug')('message');
var moment      = require('moment');
var mongoose    = require('mongoose');
var Schema      = mongoose.Schema;

moment.locale('de');

var messageSchema = new Schema({
    message: String,
    user: {type: Schema.Types.ObjectId, ref: 'User' },
    date: Date,
    dateTime: String,
    displayTime: String
});
var Message = mongoose.model('Message', messageSchema, 'messages');


var getMessage = function (_id, callback) {
    debug('getMessage', _id);
    Message.findById(_id).populate('user').exec(function (err, message) {
        if (err) {
            debug('ERROR', err);
        }
        debug('getMessage', 'populated', message);
        callback(message);
    });
};

var add = function (connectionId, message, callback) {
    debug('add', connectionId, message);
    mongoose.connection.model('User').findOne({
        connectionId: connectionId
    }, function (err, usr) {
        if (err) {
            debug('ERROR', err);
        }
        var msg = new Message({
            message: message,
            user: usr,
            date: new Date(),
            dateTime: moment().format("dddd, DD. MMMM YYYY, HH:mm:ss [Uhr]"),
            displayTime: moment().format("H:mm:ss")
        });
        msg.save(function (err, doc) {
            debug('message saved', err, doc);
            getMessage(doc._id, callback);
        });
    });
};
exports.add = add;


var getLastTen = function (callback) {
    debug('getLast');
    Message.find().sort('-dateTime').limit(10).populate('user').exec(function (err, messages) {
        if (err) {
            debug('ERROR', err);
        }
        debug('getLast', 'populated', messages);
        callback(messages);
    });
};
exports.getLastTen = getLastTen;